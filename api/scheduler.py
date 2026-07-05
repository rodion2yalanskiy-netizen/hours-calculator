"""Планировщик субботних напоминаний (Слой 7b, APScheduler в процессе FastAPI).

Каждый час в :00 проверяет: суббота ли сейчас в локальном времени работников и
попадает ли час в {19,20,21,22}. Если да — каждому работнику с подпиской, у кого
есть часы за текущую неделю и НЕ отправлен недельный отчёт, шлём push.
"""
from datetime import datetime

try:
    from zoneinfo import ZoneInfo
except ImportError:  # py<3.9 fallback (на Railway 3.11 не понадобится)
    from backports.zoneinfo import ZoneInfo  # type: ignore

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import db
import logic
import notifier
from config import SUBSCRIBER_TIMEZONE, OWNER_ID

scheduler = AsyncIOScheduler(timezone="UTC")

_REMINDER_HOURS = {19, 20, 21, 22}


async def check_saturday_reminders() -> None:
    try:
        tz = ZoneInfo(SUBSCRIBER_TIMEZONE)
    except Exception:
        tz = ZoneInfo("America/Los_Angeles")
    now = datetime.now(tz)
    if now.weekday() != 5 or now.hour not in _REMINDER_HOURS:  # 5 = суббота
        return

    week_start = logic.monday_of(now.date())
    week_end = logic.week_end_of(week_start)

    workers = await db.fetch("SELECT DISTINCT worker_id FROM push_subscriptions")
    for w in workers:
        wid = w["worker_id"]
        _earned, hours, _cnt = await logic.earned_for_week(wid, OWNER_ID, week_start, week_end)
        if hours <= 0:
            continue  # нет смен на этой неделе — напоминать не о чем
        if await db.fetchval(
            "SELECT 1 FROM weekly_reports WHERE worker_id=$1 AND week_start=$2", wid, week_start
        ):
            continue  # отчёт уже отправлен

        subs = await db.fetch(
            "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE worker_id=$1", wid
        )
        for s in subs:
            sub = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
            try:
                await notifier.send_push(
                    sub, "Не забудь про отчёт",
                    f"Отправь недельный отчёт боссу — сейчас {now.strftime('%H:%M')}",
                    url="/shifts",
                )
            except notifier.SubscriptionExpired:
                await db.execute("DELETE FROM push_subscriptions WHERE id=$1", s["id"])
            except Exception:  # noqa: BLE001 — единичный сбой не должен рушить рассылку
                pass


def start() -> None:
    scheduler.add_job(
        check_saturday_reminders, CronTrigger(minute=0),
        id="saturday_reminders", replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()


def stop() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
