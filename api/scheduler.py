"""Планировщик push-напоминаний (Слой 7b + 7c, APScheduler в процессе FastAPI).

Ежечасно в :00 проверяет локальное время работников (SUBSCRIBER_TIMEZONE) и в
19/20/21/22 шлёт:
  • ДНЕВНОЕ «Внеси смену» — каждый день, если за сегодня нет смены (Слой 7c);
  • НЕДЕЛЬНОЕ «Не забудь про отчёт» — по субботам, если есть смены за неделю и
    отчёт ещё не отправлен (Слой 7b).
Шлём только работникам с активной push-подпиской; мёртвые подписки удаляем.
"""
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:  # py<3.9 fallback (на Railway 3.11 не нужен)
    from backports.zoneinfo import ZoneInfo  # type: ignore

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import db
import notifier
from config import SUBSCRIBER_TIMEZONE, OWNER_ID

scheduler = AsyncIOScheduler(timezone="UTC")

_REMINDER_HOURS = {19, 20, 21, 22}


async def check_hourly_reminders() -> None:
    try:
        tz = ZoneInfo(SUBSCRIBER_TIMEZONE)
    except Exception:
        tz = ZoneInfo("America/Los_Angeles")
    now = datetime.now(tz)
    if now.hour not in _REMINDER_HOURS:
        return
    today = now.date()
    hh = f"{now.hour:02d}:00"

    # Только работники с подпиской (без неё push не доставить).
    workers = await db.fetch("SELECT DISTINCT worker_id FROM push_subscriptions")
    for w in workers:
        wid = w["worker_id"]

        # 1) Дневное: если за сегодня нет смены.
        has_today = await db.fetchval(
            "SELECT EXISTS (SELECT 1 FROM shifts WHERE worker_id=$1 AND user_id=$2 AND date=$3)",
            wid, OWNER_ID, today,
        )
        if not has_today:
            await notifier.push_to_worker(
                wid, "Внеси смену", f"Не забудь внести смену за сегодня — {hh}", "/shifts?new=1"
            )

        # 2) Недельное (суббота): есть смены на неделе и отчёт не отправлен.
        if now.weekday() == 5:  # суббота
            week_start = today - timedelta(days=today.weekday())
            has_week = await db.fetchval(
                "SELECT EXISTS (SELECT 1 FROM shifts WHERE worker_id=$1 AND user_id=$2 AND date>=$3)",
                wid, OWNER_ID, week_start,
            )
            reported = await db.fetchval(
                "SELECT EXISTS (SELECT 1 FROM weekly_reports WHERE worker_id=$1 AND week_start=$2)",
                wid, week_start,
            )
            if has_week and not reported:
                await notifier.push_to_worker(
                    wid, "Не забудь про отчёт",
                    f"Отправь недельный отчёт боссу — сейчас {hh}", "/shifts?mode=week",
                )


def start() -> None:
    scheduler.add_job(
        check_hourly_reminders, CronTrigger(minute=0),
        id="hourly_reminders", replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()


def stop() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
