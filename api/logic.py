"""Общие вычисления Слоя 3: ставки, заработок за неделю, границы недель,
членство в команде, недельная сводка. Без FastAPI — только данные + БД.

Термины:
- tenant  = current_user.id (legacy Telegram OWNER_ID). Команда одного supervisor'а —
  это все workers, где workers.user_id = tenant, и все shifts с shifts.user_id = tenant.
- worker_id = строка в workers (bigint). users.worker_id ссылается на неё.
"""
import datetime as dt

import db


# ── Недели (Пн–Вс) ────────────────────────────────────────────────────────────
def is_monday(d: dt.date) -> bool:
    return d.weekday() == 0


def week_end_of(week_start: dt.date) -> dt.date:
    """Воскресенье = понедельник + 6 дней."""
    return week_start + dt.timedelta(days=6)


def monday_of(d: dt.date) -> dt.date:
    """Понедельник недели, содержащей дату d."""
    return d - dt.timedelta(days=d.weekday())


def iter_week_starts(from_d: dt.date, to_d: dt.date):
    """Понедельники всех недель, пересекающих [from_d, to_d]."""
    ws = monday_of(from_d)
    while ws <= to_d:
        yield ws
        ws = ws + dt.timedelta(days=7)


def money(hours, rate) -> float:
    """Деньги = часы × ставка, округление до центов."""
    return round(float(hours) * float(rate), 2)


# ── Ставки ────────────────────────────────────────────────────────────────────
async def resolve_hourly_rate(worker_id: int, tenant: int, fallback) -> float:
    """Реальная ставка для смены этого работника (snapshot):
    1) ставка user'а, привязанного к worker_id;
    2) иначе ставка supervisor'а команды;
    3) иначе fallback (ставка текущего пользователя).
    """
    r = await db.fetchval("SELECT hourly_rate FROM users WHERE worker_id=$1", worker_id)
    if r is not None:
        return float(r)
    r = await db.fetchval(
        "SELECT u.hourly_rate FROM users u JOIN workers w ON w.id = u.worker_id "
        "WHERE w.user_id=$1 AND u.role='supervisor' ORDER BY u.created_at LIMIT 1",
        tenant,
    )
    if r is not None:
        return float(r)
    return float(fallback)


# ── Заработок по часам за неделю ──────────────────────────────────────────────
async def earned_for_week(worker_id: int, tenant: int, week_start: dt.date, week_end: dt.date):
    """(earned, hours, shifts_count) за неделю: SUM(hours × hourly_rate_snapshot)."""
    r = await db.fetchrow(
        "SELECT COALESCE(SUM(calculated_hours * hourly_rate_snapshot), 0) AS earned, "
        "       COALESCE(SUM(calculated_hours), 0) AS hours, "
        "       COUNT(*) AS cnt "
        "FROM shifts "
        "WHERE user_id=$1 AND worker_id=$2 AND date BETWEEN $3 AND $4",
        tenant, worker_id, week_start, week_end,
    )
    return float(r["earned"]), float(r["hours"]), int(r["cnt"])


# ── Команда ───────────────────────────────────────────────────────────────────
async def is_team_worker(worker_id: int, tenant: int) -> bool:
    """worker_id принадлежит команде tenant'а (workers.user_id = tenant)."""
    return await db.fetchval(
        "SELECT 1 FROM workers WHERE id=$1 AND user_id=$2", worker_id, tenant
    ) is not None


async def supervisor_worker_id(tenant: int) -> int | None:
    """worker_id активного supervisor'а команды (для push-уведомлений ему)."""
    return await db.fetchval(
        "SELECT u.worker_id FROM users u JOIN workers w ON w.id = u.worker_id "
        "WHERE w.user_id=$1 AND u.role='supervisor' AND u.is_active=true ORDER BY u.created_at LIMIT 1",
        tenant,
    )


# ── Недельная сводка (используется /payouts, /summary) ────────────────────────
async def weekly_summary(worker_id: int, tenant: int, week_start: dt.date) -> dict:
    """Полная сводка по одному работнику за одну неделю."""
    week_end = week_end_of(week_start)
    earned, hours, cnt = await earned_for_week(worker_id, tenant, week_start, week_end)
    worker_name = await db.fetchval("SELECT name FROM workers WHERE id=$1", worker_id)

    p = await db.fetchrow(
        "SELECT amount_paid, shortfall_reason, shortfall_note, paid_at "
        "FROM weekly_payouts WHERE worker_id=$1 AND week_start=$2",
        worker_id, week_start,
    )

    payout = None
    bonus = 0.0
    shortfall = 0.0
    status = "unpaid"
    if p is not None:
        amount_paid = float(p["amount_paid"])
        payout = {
            "amount_paid": amount_paid,
            "shortfall_reason": p["shortfall_reason"],
            "shortfall_note": p["shortfall_note"],
            "paid_at": p["paid_at"].isoformat(),
        }
        bonus = round(max(0.0, amount_paid - earned), 2)
        shortfall = round(max(0.0, earned - amount_paid), 2)
        if shortfall > 0:
            status = "shortfall_" + (p["shortfall_reason"] or "debt")
        elif bonus > 0:
            status = "bonus"
        else:
            status = "paid"

    return {
        "worker_id": worker_id,
        "worker_name": worker_name,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "shifts_count": cnt,
        "total_hours": round(hours, 2),
        "earned_by_hours": round(earned, 2),
        "payout": payout,
        "bonus": bonus,
        "shortfall": shortfall,
        "status": status,
    }
