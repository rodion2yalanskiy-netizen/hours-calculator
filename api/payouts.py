"""Роутер /payouts (Слой 3): недельные выплаты от босса.

Модель X: каждый пользователь вносит СВОИ выплаты (worker_id принудительно =
current_user.worker_id и для worker, и для supervisor). earned_by_hours не хранится —
считается из shifts на лету.
"""
from datetime import date as date_cls

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import db
import logic
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
    """Добавить earned_by_hours / bonus / shortfall к строке payout."""
    ws, we = row["week_start"], row["week_end"]
    earned, _hours, _cnt = await logic.earned_for_week(row["worker_id"], tenant, ws, we)
    amount_paid = float(row["amount_paid"])
    return {
        "id": str(row["id"]),
        "worker_id": row["worker_id"],
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "amount_paid": amount_paid,
        "shortfall_reason": row["shortfall_reason"],
        "shortfall_note": row["shortfall_note"],
        "paid_at": row["paid_at"].isoformat(),
        "earned_by_hours": round(earned, 2),
        "bonus": round(max(0.0, amount_paid - earned), 2),
        "shortfall": round(max(0.0, earned - amount_paid), 2),
    }


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
        "       p.shortfall_reason, p.shortfall_note, p.paid_at "
        f"FROM weekly_payouts p {join} "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY p.week_start DESC",
        *args,
    )
    return [await _enrich(r, current.id) for r in rows]


@router.post("")
async def create_payout(body: PayoutCreate, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    ws = _parse_date(body.week_start, "week_start")
    we = _parse_date(body.week_end, "week_end")

    if not logic.is_monday(ws):
        raise HTTPException(status_code=400, detail="week_start must be a Monday")
    if we != logic.week_end_of(ws):
        raise HTTPException(status_code=400, detail="week_end must be week_start + 6 days (Sunday)")
    if body.amount_paid < 0:
        raise HTTPException(status_code=400, detail="amount_paid must be >= 0")

    earned, _h, _c = await logic.earned_for_week(worker_id, current.id, ws, we)
    reason = body.shortfall_reason
    if body.amount_paid < earned:
        if reason not in _REASONS:
            raise HTTPException(
                status_code=400,
                detail="amount_paid is below earned — shortfall_reason ('debt' or 'fine') is required",
            )
    elif reason is not None and reason not in _REASONS:
        raise HTTPException(status_code=400, detail="shortfall_reason must be 'debt' or 'fine'")
    if reason == "fine" and not (body.shortfall_note and body.shortfall_note.strip()):
        raise HTTPException(status_code=400, detail="shortfall_note is required when reason is 'fine'")

    try:
        row = await db.fetchrow(
            "INSERT INTO weekly_payouts "
            "(worker_id, week_start, week_end, amount_paid, shortfall_reason, shortfall_note) "
            "VALUES ($1, $2, $3, $4, $5, $6) "
            "RETURNING id, worker_id, week_start, week_end, amount_paid, "
            "          shortfall_reason, shortfall_note, paid_at",
            worker_id, ws, we, body.amount_paid, reason, body.shortfall_note,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="payout for this week already exists")
    return await _enrich(row, current.id)


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

    new_reason = body.shortfall_reason if body.shortfall_reason is not None else existing["shortfall_reason"]
    new_note = body.shortfall_note if body.shortfall_note is not None else existing["shortfall_note"]
    if new_reason is not None and new_reason not in _REASONS:
        raise HTTPException(status_code=400, detail="shortfall_reason must be 'debt' or 'fine'")
    if body.amount_paid is not None and body.amount_paid < 0:
        raise HTTPException(status_code=400, detail="amount_paid must be >= 0")
    if new_reason == "fine" and not (new_note and str(new_note).strip()):
        raise HTTPException(status_code=400, detail="shortfall_note is required when reason is 'fine'")

    sets, args = [], []
    if body.amount_paid is not None:
        sets.append(f"amount_paid=${len(args) + 1}")
        args.append(body.amount_paid)
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
        "          shortfall_reason, shortfall_note, paid_at",
        *args,
    )
    return await _enrich(row, current.id)


@router.delete("/{payout_id}")
async def delete_payout(payout_id: str, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    deleted = await db.fetchval(
        "DELETE FROM weekly_payouts WHERE id=$1::uuid AND worker_id=$2 RETURNING id",
        payout_id, worker_id,
    )
    if deleted is None:
        raise HTTPException(status_code=404, detail="payout not found")
    return {"ok": True, "id": str(deleted)}
