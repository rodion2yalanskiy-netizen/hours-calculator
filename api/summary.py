"""Роутер /summary (Слой 3): сводки заработок/выплата/бонус/долг/штраф.

/summary/weekly  — одна неделя, один работник.
/summary/period  — период по неделям; для supervisor без worker_id — по всей команде.
"""
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query

import db
import logic
from deps import require_auth, CurrentUser

router = APIRouter(prefix="/summary", tags=["summary"])


def _parse_date(s: str, field: str) -> date_cls:
    try:
        return date_cls.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


async def _resolve_worker(worker_id: int | None, current: CurrentUser) -> int:
    """Определить целевого worker_id с учётом роли/принадлежности к команде."""
    if current.role == "worker":
        if current.worker_id is None:
            raise HTTPException(status_code=400, detail="current user has no linked worker")
        return current.worker_id
    # supervisor
    if worker_id is None:
        raise HTTPException(status_code=400, detail="worker_id is required for supervisor")
    if not await logic.is_team_worker(worker_id, current.id):
        raise HTTPException(status_code=404, detail="worker not found in your team")
    return worker_id


@router.get("/weekly")
async def summary_weekly(
    week_start: str = Query(...),
    worker_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_auth),
):
    ws = _parse_date(week_start, "week_start")
    if not logic.is_monday(ws):
        raise HTTPException(status_code=400, detail="week_start must be a Monday")
    wid = await _resolve_worker(worker_id, current)
    return await logic.weekly_summary(wid, current.id, ws)


def _totals(weeks: list) -> dict:
    return {
        "total_earned": round(sum(w["earned_by_hours"] for w in weeks), 2),
        "total_paid": round(sum((w["payout"]["amount_paid"] if w["payout"] else 0.0) for w in weeks), 2),
        "total_bonus": round(sum(w["bonus"] for w in weeks), 2),
        "total_shortfall": round(sum(w["shortfall"] for w in weeks), 2),
    }


async def _worker_period(wid: int, tenant: int, from_d, to_d) -> dict:
    weeks = [await logic.weekly_summary(wid, tenant, ws) for ws in logic.iter_week_starts(from_d, to_d)]
    name = weeks[0]["worker_name"] if weeks else await db.fetchval(
        "SELECT name FROM workers WHERE id=$1", wid
    )
    return {"worker_id": wid, "worker_name": name, "weeks": weeks, "totals": _totals(weeks)}


@router.get("/period")
async def summary_period(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    worker_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_auth),
):
    from_d = _parse_date(from_, "from")
    to_d = _parse_date(to, "to")
    if to_d < from_d:
        raise HTTPException(status_code=400, detail="'to' must be on or after 'from'")

    if current.role == "worker":
        wids = [await _resolve_worker(None, current)]
    elif worker_id is not None:
        wids = [await _resolve_worker(worker_id, current)]
    else:
        rows = await db.fetch(
            "SELECT id FROM workers WHERE user_id=$1 AND active=true ORDER BY is_owner DESC, name",
            current.id,
        )
        wids = [r["id"] for r in rows]

    workers = [await _worker_period(wid, current.id, from_d, to_d) for wid in wids]
    all_weeks = [wk for wp in workers for wk in wp["weeks"]]
    return {
        "from": from_d.isoformat(),
        "to": to_d.isoformat(),
        "workers": workers,
        "totals": _totals(all_weeks),
    }
