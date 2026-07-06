"""Роутер /payouts (Слой 8): гибкие выплаты.

Выплата = чек + произвольный набор смен, которые он покрывает (payout_shifts).
Смены могут быть из разных календарных недель/месяцев (рваный расчётный период).
earned_by_hours = сумма money выбранных смен (по их снапшот-ставкам).
Смена входит максимум в ОДНУ выплату (UNIQUE(shift_id) в payout_shifts).

Обратная совместимость: старые выплаты без payout_shifts считаются по диапазону
week_start..week_end (fallback), чтобы ничего не сломать.
"""
import asyncio
import os
from datetime import date as date_cls

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import db
import logic
import notifier
from deps import require_auth, CurrentUser

router = APIRouter(prefix="/payouts", tags=["payouts"])

_REASONS = ("debt", "fine")


class PayoutCreate(BaseModel):
    shift_ids: list[int]
    amount_paid: float
    receipt_id: str | None = None
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


class PayoutFromReceipt(BaseModel):
    shift_ids: list[int]
    receipt_id: str
    confirmed_amount: float
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


class PayoutPatch(BaseModel):
    amount_paid: float | None = None
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


def _own_worker_id(current: CurrentUser) -> int:
    if current.worker_id is None:
        raise HTTPException(status_code=400, detail="current user has no linked worker")
    return current.worker_id


def _parse_date(s: str, field: str) -> date_cls:
    try:
        return date_cls.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


def _check_shortfall(amount: float, earned: float, reason: str | None, note: str | None) -> None:
    """Валидация недоплаты/причины/заметки."""
    if amount < 0:
        raise HTTPException(status_code=400, detail="amount must be >= 0")
    if amount < earned:
        if reason not in _REASONS:
            raise HTTPException(
                status_code=400,
                detail="amount is below earned — shortfall_reason ('debt' or 'fine') is required",
            )
    elif reason is not None and reason not in _REASONS:
        raise HTTPException(status_code=400, detail="shortfall_reason must be 'debt' or 'fine'")
    if reason == "fine" and not (note and str(note).strip()):
        raise HTTPException(status_code=400, detail="shortfall_note is required when reason is 'fine'")


async def _covered_shifts(payout_id) -> list[dict]:
    """Смены, покрытые выплатой (для отображения + расчёта). Пусто → старая выплата."""
    rows = await db.fetch(
        "SELECT s.id, s.date, s.object_name, s.calculated_hours, s.hourly_rate_snapshot "
        "FROM payout_shifts ps JOIN shifts s ON s.id = ps.shift_id "
        "WHERE ps.payout_id=$1::uuid ORDER BY s.date",
        payout_id,
    )
    out = []
    for r in rows:
        hours = float(r["calculated_hours"]) if r["calculated_hours"] is not None else 0.0
        rate = float(r["hourly_rate_snapshot"]) if r["hourly_rate_snapshot"] is not None else 0.0
        out.append({
            "id": r["id"],
            "date": r["date"].isoformat(),
            "object_name": r["object_name"],
            "calculated_hours": hours,
            "money": logic.money(hours, rate),
        })
    return out


async def _enrich(row, tenant: int) -> dict:
    """Payout + earned_by_hours/bonus/shortfall + covered_shifts + ревью чека
    (одиночная выплата — используется вне списочного эндпоинта)."""
    covered = await _covered_shifts(row["id"])
    rec = None
    if row["receipt_id"]:
        rec = await db.fetchrow(
            "SELECT review_status, review_note FROM receipts WHERE id=$1", row["receipt_id"]
        )
    return await _build_enriched(row, tenant, covered, rec)


async def _build_enriched(row, tenant: int, covered: list[dict], rec) -> dict:
    """Собрать enriched-словарь из уже загруженных данных (без запросов к БД,
    кроме fallback earned_for_week для старых выплат без payout_shifts)."""
    if covered:
        earned = round(sum(c["money"] for c in covered), 2)
    elif row["week_start"] is not None and row["week_end"] is not None:
        e, _h, _c = await logic.earned_for_week(row["worker_id"], tenant, row["week_start"], row["week_end"])
        earned = round(e, 2)
    else:
        earned = 0.0

    amount_paid = float(row["amount_paid"])

    review_status = rec["review_status"] if rec is not None else None
    review_note = rec["review_note"] if rec is not None else None

    return {
        "id": str(row["id"]),
        "worker_id": row["worker_id"],
        "week_start": row["week_start"].isoformat() if row["week_start"] else None,
        "week_end": row["week_end"].isoformat() if row["week_end"] else None,
        "amount_paid": amount_paid,
        "shortfall_reason": row["shortfall_reason"],
        "shortfall_note": row["shortfall_note"],
        "paid_at": row["paid_at"].isoformat(),
        "receipt_id": str(row["receipt_id"]) if row["receipt_id"] else None,
        "review_status": review_status,
        "review_note": review_note,
        "covered_shifts": covered,
        "shift_ids": [c["id"] for c in covered],
        "earned_by_hours": earned,
        "bonus": round(max(0.0, amount_paid - earned), 2),
        "shortfall": round(max(0.0, earned - amount_paid), 2),
    }


_PAYOUT_COLS = (
    "id, worker_id, week_start, week_end, amount_paid, "
    "shortfall_reason, shortfall_note, paid_at, receipt_id"
)


# ── Список выплат ─────────────────────────────────────────────────────────────
@router.get("")
async def list_payouts(
    worker_id: int | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    current: CurrentUser = Depends(require_auth),
):
    where, args = [], []
    if current.role == "worker":
        args.append(_own_worker_id(current))
        where.append(f"p.worker_id=${len(args)}")
        join = ""
    else:
        args.append(current.id)
        where.append(f"w.user_id=${len(args)}")
        join = "JOIN workers w ON w.id = p.worker_id"
        if worker_id is not None:
            args.append(worker_id)
            where.append(f"p.worker_id=${len(args)}")
    if from_ is not None:
        args.append(_parse_date(from_, "from"))
        where.append(f"p.week_start>=${len(args)}")
    if to is not None:
        args.append(_parse_date(to, "to"))
        where.append(f"p.week_start<=${len(args)}")

    rows = await db.fetch(
        f"SELECT p.id, p.worker_id, p.week_start, p.week_end, p.amount_paid, "
        f"       p.shortfall_reason, p.shortfall_note, p.paid_at, p.receipt_id "
        f"FROM weekly_payouts p {join} "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY p.paid_at DESC",
        *args,
    )

    payout_ids = [r["id"] for r in rows]
    covered_map: dict = {}
    if payout_ids:
        shift_rows = await db.fetch(
            "SELECT ps.payout_id, s.id, s.date, s.object_name, s.calculated_hours, s.hourly_rate_snapshot "
            "FROM payout_shifts ps JOIN shifts s ON s.id = ps.shift_id "
            "WHERE ps.payout_id = ANY($1::uuid[]) ORDER BY s.date",
            payout_ids,
        )
        for r in shift_rows:
            hours = float(r["calculated_hours"]) if r["calculated_hours"] is not None else 0.0
            rate = float(r["hourly_rate_snapshot"]) if r["hourly_rate_snapshot"] is not None else 0.0
            covered_map.setdefault(r["payout_id"], []).append({
                "id": r["id"],
                "date": r["date"].isoformat(),
                "object_name": r["object_name"],
                "calculated_hours": hours,
                "money": logic.money(hours, rate),
            })

    receipt_ids = list({r["receipt_id"] for r in rows if r["receipt_id"]})
    receipts_map: dict = {}
    if receipt_ids:
        rec_rows = await db.fetch(
            "SELECT id, review_status, review_note FROM receipts WHERE id = ANY($1::uuid[])",
            receipt_ids,
        )
        receipts_map = {rr["id"]: rr for rr in rec_rows}

    return [
        await _build_enriched(r, current.id, covered_map.get(r["id"], []), receipts_map.get(r["receipt_id"]))
        for r in rows
    ]


# ── Ядро создания выплаты по выбранным сменам ─────────────────────────────────
async def _validate_shifts(shift_ids: list[int], current: CurrentUser) -> tuple[int, list[dict], date_cls, date_cls, float]:
    """Проверить смены (принадлежность, не оплачены), вернуть
    (worker_id, shift_rows, week_start=min, week_end=max, earned)."""
    if not shift_ids:
        raise HTTPException(status_code=400, detail="shift_ids is required (выберите смены)")
    uniq_ids = list(dict.fromkeys(shift_ids))  # дедуп, сохраняя порядок

    rows = await db.fetch(
        "SELECT id, worker_id, date, calculated_hours, hourly_rate_snapshot "
        "FROM shifts WHERE id = ANY($1::bigint[]) AND user_id=$2",
        uniq_ids, current.id,
    )
    if len(rows) != len(uniq_ids):
        raise HTTPException(status_code=404, detail="Некоторые смены не найдены")

    worker_ids = {r["worker_id"] for r in rows}
    if len(worker_ids) != 1:
        raise HTTPException(status_code=400, detail="Все смены выплаты должны быть одного работника")
    wid = worker_ids.pop()

    if current.role == "worker" and wid != current.worker_id:
        raise HTTPException(status_code=403, detail="Нельзя создавать выплату по чужим сменам")

    # Ни одна смена не должна быть уже оплачена.
    taken = await db.fetchrow(
        "SELECT s.date FROM payout_shifts ps JOIN shifts s ON s.id = ps.shift_id "
        "WHERE ps.shift_id = ANY($1::bigint[]) ORDER BY s.date LIMIT 1",
        uniq_ids,
    )
    if taken is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Смена за {taken['date'].isoformat()} уже оплачена другим чеком",
        )

    earned = round(sum(
        logic.money(
            float(r["calculated_hours"] or 0),
            float(r["hourly_rate_snapshot"] or 0),
        ) for r in rows
    ), 2)
    week_start = min(r["date"] for r in rows)
    week_end = max(r["date"] for r in rows)
    return wid, rows, week_start, week_end, earned


async def _create_payout(
    current: CurrentUser, shift_ids: list[int], amount: float,
    receipt_id: str | None, reason: str | None, note: str | None,
) -> dict:
    wid, _rows, ws, we, earned = await _validate_shifts(shift_ids, current)
    _check_shortfall(amount, earned, reason, note)

    if receipt_id is not None:
        rec = await db.fetchrow("SELECT id, worker_id FROM receipts WHERE id=$1::uuid", receipt_id)
        if rec is None or rec["worker_id"] != wid:
            raise HTTPException(status_code=404, detail="receipt not found")
        if await db.fetchval("SELECT 1 FROM weekly_payouts WHERE receipt_id=$1::uuid", receipt_id):
            raise HTTPException(status_code=409, detail="Этот чек уже привязан к другой выплате")

    uniq_ids = list(dict.fromkeys(shift_ids))
    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                if receipt_id is not None:
                    await conn.execute(
                        "UPDATE receipts SET confirmed_amount=$1 WHERE id=$2::uuid", amount, receipt_id
                    )
                row = await conn.fetchrow(
                    f"INSERT INTO weekly_payouts "
                    f"(worker_id, week_start, week_end, amount_paid, shortfall_reason, shortfall_note, receipt_id) "
                    f"VALUES ($1, $2, $3, $4, $5, $6, $7::uuid) "  # $7 None → NULL
                    f"RETURNING {_PAYOUT_COLS}",
                    wid, ws, we, amount, reason, note, receipt_id,
                )
                await conn.executemany(
                    "INSERT INTO payout_shifts (payout_id, shift_id) VALUES ($1, $2)",
                    [(row["id"], sid) for sid in uniq_ids],
                )
    except asyncpg.UniqueViolationError as e:
        if e.constraint_name == "uq_payout_receipt":
            raise HTTPException(status_code=409, detail="Этот чек уже привязан к другой выплате")
        # payout_shifts.shift_id UNIQUE — смену перехватила другая выплата (гонка).
        raise HTTPException(status_code=409, detail="Одна из смен уже оплачена другим чеком")

    if current.role == "worker" and receipt_id is not None:
        asyncio.create_task(_notify_receipt_attached(
            current.id, wid, ws.isoformat(), we.isoformat(), float(amount)
        ))
    return await _enrich(row, current.id)


@router.post("")
async def create_payout(body: PayoutCreate, current: CurrentUser = Depends(require_auth)):
    """Слой 8: выплата по выбранным сменам. Чек (receipt_id) опционален."""
    return await _create_payout(
        current, body.shift_ids, body.amount_paid,
        body.receipt_id, body.shortfall_reason, body.shortfall_note,
    )


@router.post("/from-receipt")
async def create_payout_from_receipt(body: PayoutFromReceipt, current: CurrentUser = Depends(require_auth)):
    """Слой 8 (адаптация 7f): выплата по чеку + выбранным сменам. receipt_id обязателен."""
    return await _create_payout(
        current, body.shift_ids, body.confirmed_amount,
        body.receipt_id, body.shortfall_reason, body.shortfall_note,
    )


async def _notify_receipt_attached(tenant: int, worker_id: int, ws: str, we: str, amount: float) -> None:
    """Push supervisor'у: работник прикрепил чек за период."""
    sup_wid = await logic.supervisor_worker_id(tenant)
    if sup_wid is None or sup_wid == worker_id:
        return
    name = await db.fetchval("SELECT name FROM workers WHERE id=$1", worker_id) or "Работник"
    period = ws if ws == we else f"{ws}–{we}"
    await notifier.push_to_worker(
        sup_wid, "Чек прикреплён",
        f"{name} прикрепил чек за {period} — ${amount:.2f}", "/payouts",
    )


# ── Правка суммы/причины (смены выплаты не меняем здесь) ───────────────────────
@router.patch("/{payout_id}")
async def patch_payout(payout_id: str, body: PayoutPatch, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    existing = await db.fetchrow(
        f"SELECT {_PAYOUT_COLS} FROM weekly_payouts WHERE id=$1::uuid", payout_id
    )
    if existing is None or existing["worker_id"] != worker_id:
        raise HTTPException(status_code=404, detail="payout not found")

    new_amount = body.amount_paid if body.amount_paid is not None else float(existing["amount_paid"])
    new_reason = body.shortfall_reason if body.shortfall_reason is not None else existing["shortfall_reason"]
    new_note = body.shortfall_note if body.shortfall_note is not None else existing["shortfall_note"]

    # earned по покрытым сменам (или диапазону для старых выплат).
    enriched_before = await _enrich(existing, current.id)
    earned = enriched_before["earned_by_hours"]
    _check_shortfall(new_amount, earned, new_reason, new_note)

    sets, args = [], []
    if body.amount_paid is not None:
        sets.append(f"amount_paid=${len(args) + 1}"); args.append(body.amount_paid)
    if body.shortfall_reason is not None:
        sets.append(f"shortfall_reason=${len(args) + 1}"); args.append(body.shortfall_reason)
    if body.shortfall_note is not None:
        sets.append(f"shortfall_note=${len(args) + 1}"); args.append(body.shortfall_note)
    if not sets:
        raise HTTPException(status_code=400, detail="nothing to update")
    args.append(payout_id)
    row = await db.fetchrow(
        f"UPDATE weekly_payouts SET {', '.join(sets)} WHERE id=${len(args)}::uuid RETURNING {_PAYOUT_COLS}",
        *args,
    )
    return await _enrich(row, current.id)


@router.delete("/{payout_id}")
async def delete_payout(payout_id: str, current: CurrentUser = Depends(require_auth)):
    """Удалить выплату. payout_shifts удаляются каскадом → смены снова «не оплачены»."""
    worker_id = _own_worker_id(current)
    payout = await db.fetchrow(
        "SELECT id, receipt_id FROM weekly_payouts WHERE id=$1::uuid AND worker_id=$2",
        payout_id, worker_id,
    )
    if payout is None:
        raise HTTPException(status_code=404, detail="payout not found")

    file_path = None
    if payout["receipt_id"]:
        rec = await db.fetchrow("SELECT file_path FROM receipts WHERE id=$1", payout["receipt_id"])
        file_path = rec["file_path"] if rec else None

    pool = await db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # payout_shifts уйдут каскадом при удалении выплаты.
            await conn.execute("DELETE FROM weekly_payouts WHERE id=$1::uuid", payout_id)
            if payout["receipt_id"]:
                await conn.execute("DELETE FROM receipts WHERE id=$1", payout["receipt_id"])
    if file_path:
        try:
            os.remove(file_path)
        except OSError:
            pass
    return {"ok": True, "id": str(payout["id"])}
