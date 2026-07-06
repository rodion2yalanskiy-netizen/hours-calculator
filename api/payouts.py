"""Роутер /payouts (Слой 3): недельные выплаты от босса.

Модель X: каждый пользователь вносит СВОИ выплаты (worker_id принудительно =
current_user.worker_id и для worker, и для supervisor). earned_by_hours не хранится —
считается из shifts на лету.
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
    week_start: str
    week_end: str
    amount_paid: float
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


class PayoutPatch(BaseModel):
    amount_paid: float | None = None
    receipt_id: str | None = None
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


class PayoutFromReceipt(BaseModel):
    receipt_id: str
    week_start: str
    week_end: str
    confirmed_amount: float
    shortfall_reason: str | None = None
    shortfall_note: str | None = None


def _parse_date(s: str, field: str) -> date_cls:
    try:
        return date_cls.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


def _own_worker_id(current: CurrentUser) -> int:
    if current.worker_id is None:
        raise HTTPException(status_code=400, detail="current user has no linked worker")
    return current.worker_id


async def _enrich(row, tenant: int) -> dict:
    """Добавить earned_by_hours / bonus / shortfall + статус ревью чека к строке payout."""
    ws, we = row["week_start"], row["week_end"]
    earned, _hours, _cnt = await logic.earned_for_week(row["worker_id"], tenant, ws, we)
    amount_paid = float(row["amount_paid"])

    # Статус ревью привязанного чека (7f): supervisor мог пометить invalid.
    review_status = None
    review_note = None
    if row["receipt_id"]:
        rec = await db.fetchrow(
            "SELECT review_status, review_note FROM receipts WHERE id=$1",
            row["receipt_id"],
        )
        if rec is not None:
            review_status = rec["review_status"]
            review_note = rec["review_note"]

    return {
        "id": str(row["id"]),
        "worker_id": row["worker_id"],
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "amount_paid": amount_paid,
        "shortfall_reason": row["shortfall_reason"],
        "shortfall_note": row["shortfall_note"],
        "paid_at": row["paid_at"].isoformat(),
        "receipt_id": str(row["receipt_id"]) if row["receipt_id"] else None,
        "review_status": review_status,
        "review_note": review_note,
        "earned_by_hours": round(earned, 2),
        "bonus": round(max(0.0, amount_paid - earned), 2),
        "shortfall": round(max(0.0, earned - amount_paid), 2),
    }


def _check_shortfall(amount: float, earned: float, reason: str | None, note: str | None) -> None:
    """Единая валидация недоплаты/причины/заметки для create-from-receipt и patch."""
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


@router.get("")
async def list_payouts(
    worker_id: int | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    current: CurrentUser = Depends(require_auth),
):
    where = []
    args = []
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
        "SELECT p.id, p.worker_id, p.week_start, p.week_end, p.amount_paid, "
        "       p.shortfall_reason, p.shortfall_note, p.paid_at, p.receipt_id "
        f"FROM weekly_payouts p {join} "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY p.week_start DESC",
        *args,
    )
    return [await _enrich(r, current.id) for r in rows]


@router.post("")
async def create_payout(body: PayoutCreate, current: CurrentUser = Depends(require_auth)):
    # Слой 6: ручной ввод суммы отключён — выплата только по чеку.
    raise HTTPException(
        status_code=400,
        detail="Для создания выплаты нужен чек. Используй /payouts/from-receipt",
    )


@router.post("/from-receipt")
async def create_payout_from_receipt(body: PayoutFromReceipt, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    ws = _parse_date(body.week_start, "week_start")
    we = _parse_date(body.week_end, "week_end")
    if not logic.is_monday(ws):
        raise HTTPException(status_code=400, detail="week_start must be a Monday")
    if we != logic.week_end_of(ws):
        raise HTTPException(status_code=400, detail="week_end must be week_start + 6 days (Sunday)")

    # Чек: свой, ещё не привязан. 7f: ИИ больше не блокирует — is_receipt_confirmed
    # не проверяем, обязательно только само наличие фото (receipt_id). Контроль —
    # за supervisor'ом через PATCH /receipts/{id}/review.
    rec = await db.fetchrow(
        "SELECT id, worker_id FROM receipts WHERE id=$1::uuid",
        body.receipt_id,
    )
    if rec is None or rec["worker_id"] != worker_id:
        raise HTTPException(status_code=404, detail="receipt not found")
    if await db.fetchval("SELECT 1 FROM weekly_payouts WHERE receipt_id=$1::uuid", body.receipt_id):
        raise HTTPException(status_code=400, detail="receipt already used for a payout")

    earned, _h, _c = await logic.earned_for_week(worker_id, current.id, ws, we)
    _check_shortfall(body.confirmed_amount, earned, body.shortfall_reason, body.shortfall_note)

    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE receipts SET confirmed_amount=$1 WHERE id=$2::uuid",
                    body.confirmed_amount, body.receipt_id,
                )
                row = await conn.fetchrow(
                    "INSERT INTO weekly_payouts "
                    "(worker_id, week_start, week_end, amount_paid, shortfall_reason, shortfall_note, receipt_id) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7::uuid) "
                    "RETURNING id, worker_id, week_start, week_end, amount_paid, "
                    "          shortfall_reason, shortfall_note, paid_at, receipt_id",
                    worker_id, ws, we, body.confirmed_amount, body.shortfall_reason,
                    body.shortfall_note, body.receipt_id,
                )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="payout for this week already exists")

    # 7f: работник прикрепил чек → push supervisor'у (себе не шлём).
    if current.role == "worker":
        asyncio.create_task(_notify_receipt_attached(
            current.id, current.worker_id, ws.isoformat(), float(body.confirmed_amount)
        ))
    return await _enrich(row, current.id)


async def _notify_receipt_attached(tenant: int, worker_id: int, week_start: str, amount: float) -> None:
    """Push supervisor'у: работник прикрепил чек за неделю."""
    sup_wid = await logic.supervisor_worker_id(tenant)
    if sup_wid is None or sup_wid == worker_id:
        return  # нет supervisor'а или это он сам — не шлём
    name = await db.fetchval("SELECT name FROM workers WHERE id=$1", worker_id) or "Работник"
    await notifier.push_to_worker(
        sup_wid, "Чек прикреплён",
        f"{name} прикрепил чек за неделю {week_start} — ${amount:.2f}", "/payouts",
    )


@router.patch("/{payout_id}")
async def patch_payout(payout_id: str, body: PayoutPatch, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    existing = await db.fetchrow(
        "SELECT id, worker_id, week_start, week_end, amount_paid, shortfall_reason, shortfall_note, paid_at "
        "FROM weekly_payouts WHERE id=$1::uuid",
        payout_id,
    )
    if existing is None or existing["worker_id"] != worker_id:
        raise HTTPException(status_code=404, detail="payout not found")

    # Слой 6: сумму можно менять ТОЛЬКО с новым чеком (нельзя вручную).
    if body.amount_paid is not None and body.receipt_id is None:
        raise HTTPException(status_code=400, detail="to change the amount, attach a new receipt")
    if body.receipt_id is not None:
        if body.amount_paid is None:
            raise HTTPException(status_code=400, detail="amount_paid is required with receipt_id")
        rec = await db.fetchrow(
            "SELECT id, worker_id, is_receipt_confirmed FROM receipts WHERE id=$1::uuid",
            body.receipt_id,
        )
        if rec is None or rec["worker_id"] != worker_id:
            raise HTTPException(status_code=404, detail="receipt not found")
        if not rec["is_receipt_confirmed"]:
            raise HTTPException(status_code=400, detail="receipt is not confirmed as a receipt")
        used = await db.fetchval(
            "SELECT 1 FROM weekly_payouts WHERE receipt_id=$1::uuid AND id<>$2::uuid",
            body.receipt_id, payout_id,
        )
        if used:
            raise HTTPException(status_code=400, detail="receipt already used for another payout")

    new_amount = body.amount_paid if body.amount_paid is not None else float(existing["amount_paid"])
    new_reason = body.shortfall_reason if body.shortfall_reason is not None else existing["shortfall_reason"]
    new_note = body.shortfall_note if body.shortfall_note is not None else existing["shortfall_note"]
    earned, _h, _c = await logic.earned_for_week(worker_id, current.id, existing["week_start"], existing["week_end"])
    _check_shortfall(new_amount, earned, new_reason, new_note)

    sets, args = [], []
    if body.amount_paid is not None:
        sets.append(f"amount_paid=${len(args) + 1}")
        args.append(body.amount_paid)
    if body.receipt_id is not None:
        sets.append(f"receipt_id=${len(args) + 1}::uuid")
        args.append(body.receipt_id)
    if body.shortfall_reason is not None:
        sets.append(f"shortfall_reason=${len(args) + 1}")
        args.append(body.shortfall_reason)
    if body.shortfall_note is not None:
        sets.append(f"shortfall_note=${len(args) + 1}")
        args.append(body.shortfall_note)
    if not sets:
        raise HTTPException(status_code=400, detail="nothing to update")
    args.append(payout_id)
    row = await db.fetchrow(
        f"UPDATE weekly_payouts SET {', '.join(sets)} WHERE id=${len(args)}::uuid "
        "RETURNING id, worker_id, week_start, week_end, amount_paid, "
        "          shortfall_reason, shortfall_note, paid_at, receipt_id",
        *args,
    )
    return await _enrich(row, current.id)


@router.delete("/{payout_id}")
async def delete_payout(payout_id: str, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    payout = await db.fetchrow(
        "SELECT id, receipt_id FROM weekly_payouts WHERE id=$1::uuid AND worker_id=$2",
        payout_id, worker_id,
    )
    if payout is None:
        raise HTTPException(status_code=404, detail="payout not found")

    # Забираем путь к файлу чека, чтобы удалить с диска после удаления записей.
    file_path = None
    if payout["receipt_id"]:
        rec = await db.fetchrow("SELECT file_path FROM receipts WHERE id=$1", payout["receipt_id"])
        file_path = rec["file_path"] if rec else None

    pool = await db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM weekly_payouts WHERE id=$1::uuid", payout_id)
            if payout["receipt_id"]:  # FK: payout удалён раньше — receipt можно чистить
                await conn.execute("DELETE FROM receipts WHERE id=$1", payout["receipt_id"])
    if file_path:
        try:
            os.remove(file_path)
        except OSError:
            pass
    return {"ok": True, "id": str(payout["id"])}
