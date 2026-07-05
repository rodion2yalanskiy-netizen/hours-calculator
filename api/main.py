"""Калькулятор часов — API (FastAPI).

Слой 3: ролевая модель. supervisor видит/ведёт всю команду, worker — только себя.
- /workers, /shifts — фильтрация по роли (см. ниже).
- /team    — управление командой (supervisor): worker + user разом.
- /payouts — недельные выплаты (каждый ведёт свои).
- /summary — сводки заработок/выплата/бонус/долг/штраф.
hourly_rate_snapshot в смене = реальная ставка работника на момент смены.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import date as date_cls, time

from fastapi import FastAPI, Depends, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from deps import require_auth, require_supervisor
from auth import router as auth_router
from team import router as team_router
from payouts import router as payouts_router
from summary import router as summary_router
from receipts import router as receipts_router, ensure_storage
from settings import router as settings_router
from push import router as push_router
import scheduler as sched
from db import run_migrations
from config import CORS_ORIGIN, JWT_SECRET
import calc
import logic
import notifier
import db

# Полные русские названия дней (date.weekday(): 0=понедельник).
_RU_DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]


def _min_to_time(m: int) -> time:
    """Минуты от полуночи → datetime.time (для колонок типа time). Заворачиваем по суткам."""
    m %= 24 * 60
    return time(m // 60, m % 60)


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t is not None else None


def _time_to_min(t: time | None) -> int | None:
    """datetime.time → минуты от полуночи (для фронта). None → None."""
    return t.hour * 60 + t.minute if t is not None else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-fast: без стойкого JWT_SECRET не стартуем (иначе токены подписывались бы
    # пустым/слабым ключом и подделывались). openssl rand -hex 32 → 64 символа.
    if not JWT_SECRET or len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be set and at least 32 characters long")
    ensure_storage()  # создать /data/receipts (Слой 6, Railway Volume)
    # Единственный владелец схемы: применяем миграцию + сиды на старте (идемпотентно, под lock).
    await run_migrations()
    sched.start()  # субботние push-напоминания (Слой 7b)
    try:
        yield
    finally:
        sched.stop()


app = FastAPI(title="Калькулятор часов API", lifespan=lifespan)

# CORS: фронт (Vercel) → API (Railway). На сборке CORS_ORIGIN="*", перед приёмкой — домен Vercel.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_ORIGIN == "*" else [CORS_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,  # JWT идёт в заголовке Authorization, cookie-креды не нужны
)

# Роутеры: аутентификация + команда + выплаты + сводки.
app.include_router(auth_router)
app.include_router(team_router)
app.include_router(payouts_router)
app.include_router(summary_router)
app.include_router(receipts_router)
app.include_router(settings_router)
app.include_router(push_router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/me")
async def me(user=Depends(require_auth)):
    # Совместимость со старым ответом {id, name, username}; данные — из JWT-пользователя.
    return {"id": user.user_id, "name": user.full_name, "username": None}


# ── Бригада (workers) ─────────────────────────────────────────────────────────
class WorkerCreate(BaseModel):
    name: str
    is_owner: bool = False


class WorkerPatch(BaseModel):
    name: str | None = None
    active: bool | None = None


@app.get("/workers")
async def list_workers(user=Depends(require_auth)):
    # supervisor → вся команда; worker → только он сам.
    if user.role == "worker":
        if user.worker_id is None:
            return []
        rows = await db.fetch(
            "SELECT id, name, is_owner FROM workers WHERE id=$1", user.worker_id
        )
    else:
        rows = await db.fetch(
            "SELECT id, name, is_owner FROM workers "
            "WHERE user_id=$1 AND active=true ORDER BY is_owner DESC, name",
            user.id,
        )
    return [dict(r) for r in rows]


@app.post("/workers")
async def create_worker(body: WorkerCreate, user=Depends(require_supervisor)):
    # Низкоуровневый эндпоинт: создаёт только запись в workers (без user-аккаунта).
    # Полноценного члена команды заводит POST /team (worker + user разом).
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    row = await db.fetchrow(
        "INSERT INTO workers (user_id, name, is_owner, active) "
        "VALUES ($1, $2, $3, true) "
        "ON CONFLICT (user_id, name) DO NOTHING "
        "RETURNING id, name, is_owner, active",
        user.id, name, body.is_owner,
    )
    if row is None:
        row = await db.fetchrow(
            "SELECT id, name, is_owner, active FROM workers WHERE user_id=$1 AND name=$2",
            user.id, name,
        )
    return dict(row)


@app.patch("/workers/{worker_id}")
async def patch_worker(worker_id: int, body: WorkerPatch, user=Depends(require_supervisor)):
    sets, args = [], []
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        sets.append(f"name=${len(args) + 1}")
        args.append(name)
    if body.active is not None:
        sets.append(f"active=${len(args) + 1}")
        args.append(body.active)
    if not sets:
        raise HTTPException(status_code=400, detail="nothing to update")
    sets.append("updated_at=now()")
    args.extend([worker_id, user.id])  # WHERE id=$, user_id=$ — только своя команда
    row = await db.fetchrow(
        f"UPDATE workers SET {', '.join(sets)} "
        f"WHERE id=${len(args) - 1} AND user_id=${len(args)} "
        f"RETURNING id, name, is_owner, active",
        *args,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="worker not found")
    return dict(row)


# ── Смены (shifts) ────────────────────────────────────────────────────────────
class PreviewBody(BaseModel):
    start_min: int
    end_min: int
    worker_id: int | None = None
    has_lunch: bool = True  # Слой 7e: явная галочка обеда


class ShiftCreate(BaseModel):
    worker_id: int
    date: str
    object_name: str
    start_min: int
    end_min: int
    hours: float | None = None       # опц.: фронт присылает финал при выборе округления (15–20 мин)
    has_lunch: bool = True            # Слой 7e: True → вычесть 30 мин обеда
    suppress_notification: bool = False  # supervisor при заносе задним числом — не слать push


def _resolve_hours(start_min: int, end_min: int, has_lunch: bool, provided: float | None) -> float:
    """Часы из preview_shift. При выборе округления (15–20 мин) принимаем клиентский
    provided ТОЛЬКО если он равен одному из двух валидных значений (иначе — манипуляция
    зарплатой). По умолчанию округляем вверх."""
    r = calc.preview_shift(start_min, end_min, has_lunch)["round"]
    if not r["needs_round_choice"]:
        return float(r["hours"])
    if provided is not None and float(provided) in (float(r["hours_down"]), float(r["hours_up"])):
        return float(provided)
    return float(r["hours_up"])


@app.post("/shifts/preview")
async def shifts_preview(body: PreviewBody, user=Depends(require_auth)):
    # Чистый расчёт часов + ставка (для показа денег на фронте).
    if user.role == "worker":
        rate = user.hourly_rate  # worker считает по своей ставке
    elif body.worker_id is not None:
        rate = await logic.resolve_hourly_rate(body.worker_id, user.id, user.hourly_rate)
    else:
        rate = user.hourly_rate
    res = calc.preview_shift(body.start_min, body.end_min, body.has_lunch)
    res["hourly_rate"] = float(rate)
    return res


async def _notify_lunch_skipped(tenant: int, worker_name: str, worker_id: int, d, object_name: str) -> None:
    """Push supervisor'у команды, что работник не вычел обед. Себе не шлём."""
    sup_worker_id = await db.fetchval(
        "SELECT u.worker_id FROM users u JOIN workers w ON w.id = u.worker_id "
        "WHERE w.user_id=$1 AND u.role='supervisor' AND u.is_active=true ORDER BY u.created_at LIMIT 1",
        tenant,
    )
    if sup_worker_id is None or sup_worker_id == worker_id:
        return
    await notifier.push_to_worker(
        sup_worker_id, "Обед не вычтен",
        f"{worker_name} не вычел обед — {d.isoformat()}, {object_name}",
        url=f"/shifts?worker_id={worker_id}",
    )


@app.post("/shifts")
async def create_shift(body: ShiftCreate, user=Depends(require_auth)):
    object_name = body.object_name.strip()
    if not object_name:
        raise HTTPException(status_code=400, detail="object_name is required")

    # worker пишет только за себя; supervisor — за любого работника своей команды.
    if user.role == "worker":
        if user.worker_id is None:
            raise HTTPException(status_code=400, detail="current user has no linked worker")
        worker_id = user.worker_id
    else:
        worker_id = body.worker_id
        w = await db.fetchrow(
            "SELECT id FROM workers WHERE id=$1 AND user_id=$2 AND active=true",
            worker_id, user.id,
        )
        if w is None:
            raise HTTPException(status_code=400, detail="worker not found or inactive")

    try:
        d = date_cls.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    day_of_week = _RU_DAYS[d.weekday()]

    # Реальная ставка на момент смены (snapshot) — передаём явно.
    rate = await logic.resolve_hourly_rate(worker_id, user.id, user.hourly_rate)
    hours_val = _resolve_hours(body.start_min, body.end_min, body.has_lunch, body.hours)
    lunch_skipped = not body.has_lunch

    shift = await db.fetchrow(
        "INSERT INTO shifts "
        "(user_id, worker_id, date, day_of_week, object_name, start_time, end_time, "
        " calculated_hours, hourly_rate_snapshot, lunch_skipped) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) "
        "RETURNING id, date, day_of_week, object_name, worker_id, calculated_hours, "
        "          start_time, end_time, hourly_rate_snapshot, lunch_skipped",
        user.id, worker_id, d, day_of_week, object_name,
        _min_to_time(body.start_min), _min_to_time(body.end_min), hours_val, rate, lunch_skipped,
    )

    # suppress_notification honor'им ТОЛЬКО у supervisor'а (worker не может заглушить алерт о себе).
    suppress = body.suppress_notification and user.role == "supervisor"
    # Обед не вычтен + создаёт РАБОТНИК (не supervisor) + не заглушено → push supervisor'у (не блокируя ответ).
    if lunch_skipped and not suppress and user.role == "worker":
        asyncio.create_task(_notify_lunch_skipped(user.id, user.full_name, worker_id, d, object_name))

    hours = float(shift["calculated_hours"])
    snapshot = float(shift["hourly_rate_snapshot"])
    return {
        "id": shift["id"],
        "worker_id": shift["worker_id"],
        "date": shift["date"].isoformat(),
        "day_of_week": shift["day_of_week"],
        "object_name": shift["object_name"],
        "start_time": _hhmm(shift["start_time"]),
        "end_time": _hhmm(shift["end_time"]),
        "calculated_hours": hours,
        "lunch_deducted": body.has_lunch,
        "lunch_skipped": shift["lunch_skipped"],
        "hourly_rate": snapshot,
        "money": logic.money(hours, snapshot),  # приоритет — snapshot, не фиксированная ставка
    }


@app.get("/shifts")
async def list_shifts(
    year: int = Query(...),
    month: int = Query(...),
    worker_id: int | None = Query(default=None),
    user=Depends(require_auth),
):
    args = []
    if user.role == "worker":
        if user.worker_id is None:
            return []
        args.extend([user.id, user.worker_id, year, month])
        where = "s.user_id=$1 AND s.worker_id=$2 AND s.year=$3 AND s.month=$4"
    else:
        args.extend([user.id, year, month])
        where = "w.user_id=$1 AND s.year=$2 AND s.month=$3"
        if worker_id is not None:
            args.append(worker_id)
            where += f" AND s.worker_id=${len(args)}"

    rows = await db.fetch(
        "SELECT s.id, s.date, s.day_of_week, s.object_name, s.worker_id, s.calculated_hours, "
        "       s.start_time, s.end_time, s.hourly_rate_snapshot, s.lunch_skipped, w.name AS worker_name "
        "FROM shifts s LEFT JOIN workers w ON w.id = s.worker_id "
        f"WHERE {where} "
        "ORDER BY s.date",
        *args,
    )
    result = []
    for r in rows:
        hours = float(r["calculated_hours"]) if r["calculated_hours"] is not None else 0.0
        rate = float(r["hourly_rate_snapshot"]) if r["hourly_rate_snapshot"] is not None else 0.0
        result.append({
            "id": r["id"],
            "date": r["date"].isoformat(),
            "day_of_week": r["day_of_week"],
            "object_name": r["object_name"],
            "worker_id": r["worker_id"],
            "worker_name": r["worker_name"],
            "calculated_hours": hours,
            "start_min": _time_to_min(r["start_time"]),
            "end_min": _time_to_min(r["end_time"]),
            "hourly_rate": rate,
            "lunch_skipped": r["lunch_skipped"],
            "money": logic.money(hours, rate),
        })
    return result


# ── Слой 7a: правка / удаление смены ──────────────────────────────────────────
class ShiftPatch(BaseModel):
    date: str | None = None
    object_name: str | None = None
    start_min: int | None = None
    end_min: int | None = None
    hours: float | None = None
    has_lunch: bool | None = None  # Слой 7e


async def _shift_for_edit(shift_id: int, user):
    """Смена, доступная пользователю (worker — своя, supervisor — команды), иначе None.
    shifts.user_id = tenant, поэтому фильтр по нему уже ограничивает командой."""
    row = await db.fetchrow(
        "SELECT id, worker_id, date, hourly_rate_snapshot, start_time, end_time, lunch_skipped "
        "FROM shifts WHERE id=$1 AND user_id=$2",
        shift_id, user.id,
    )
    if row is None:
        return None
    if user.role == "worker" and row["worker_id"] != user.worker_id:
        return None
    return row


@app.patch("/shifts/{shift_id}")
async def update_shift(shift_id: int, body: ShiftPatch, user=Depends(require_auth)):
    shift = await _shift_for_edit(shift_id, user)
    if shift is None:
        raise HTTPException(status_code=404, detail="shift not found")

    sets, args = [], []
    if body.date is not None:
        try:
            d = date_cls.fromisoformat(body.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        sets.append(f"date=${len(args) + 1}")
        args.append(d)
        sets.append(f"day_of_week=${len(args) + 1}")
        args.append(_RU_DAYS[d.weekday()])
    if body.object_name is not None:
        name = body.object_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="object_name cannot be empty")
        sets.append(f"object_name=${len(args) + 1}")
        args.append(name)
    if body.start_min is not None:
        sets.append(f"start_time=${len(args) + 1}")
        args.append(_min_to_time(body.start_min))
    if body.end_min is not None:
        sets.append(f"end_time=${len(args) + 1}")
        args.append(_min_to_time(body.end_min))

    # Слой 7e: если менялись время/обед/часы — пересчитываем calculated_hours и lunch_skipped.
    # hourly_rate_snapshot НЕ трогаем (ставка фиксируется при создании).
    if body.has_lunch is not None or body.start_min is not None or body.end_min is not None or body.hours is not None:
        eff_start = body.start_min if body.start_min is not None else _time_to_min(shift["start_time"])
        eff_end = body.end_min if body.end_min is not None else _time_to_min(shift["end_time"])
        eff_has_lunch = body.has_lunch if body.has_lunch is not None else (not shift["lunch_skipped"])
        if eff_start is not None and eff_end is not None:
            new_hours = _resolve_hours(eff_start, eff_end, eff_has_lunch, body.hours)
            sets.append(f"calculated_hours=${len(args) + 1}")
            args.append(new_hours)
        elif body.hours is not None:
            sets.append(f"calculated_hours=${len(args) + 1}")
            args.append(body.hours)
        sets.append(f"lunch_skipped=${len(args) + 1}")
        args.append(not eff_has_lunch)

    if not sets:
        raise HTTPException(status_code=400, detail="nothing to update")
    sets.append("updated_at=now()")
    args.append(shift_id)

    row = await db.fetchrow(
        f"UPDATE shifts SET {', '.join(sets)} WHERE id=${len(args)} "
        "RETURNING id, date, day_of_week, object_name, worker_id, calculated_hours, "
        "          start_time, end_time, hourly_rate_snapshot, lunch_skipped",
        *args,
    )

    # Слой 7e (fix): работник снял обед при правке (false→true) → тоже алертим supervisor'а.
    if user.role == "worker" and not shift["lunch_skipped"] and row["lunch_skipped"]:
        asyncio.create_task(_notify_lunch_skipped(
            user.id, user.full_name, row["worker_id"], row["date"], row["object_name"]))

    hours = float(row["calculated_hours"]) if row["calculated_hours"] is not None else 0.0
    rate = float(row["hourly_rate_snapshot"]) if row["hourly_rate_snapshot"] is not None else 0.0
    return {
        "id": row["id"],
        "date": row["date"].isoformat(),
        "day_of_week": row["day_of_week"],
        "object_name": row["object_name"],
        "worker_id": row["worker_id"],
        "calculated_hours": hours,
        "start_min": _time_to_min(row["start_time"]),
        "end_min": _time_to_min(row["end_time"]),
        "hourly_rate": rate,
        "lunch_skipped": row["lunch_skipped"],
        "money": logic.money(hours, rate),  # пересчёт денег, ставка та же
    }


@app.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: int, user=Depends(require_auth)):
    shift = await _shift_for_edit(shift_id, user)
    if shift is None:
        raise HTTPException(status_code=404, detail="shift not found")
    # Нельзя удалять смену недели, за которую уже создана выплата (нарушило бы earned).
    week_start = logic.monday_of(shift["date"])
    if await db.fetchval(
        "SELECT 1 FROM weekly_payouts WHERE worker_id=$1 AND week_start=$2",
        shift["worker_id"], week_start,
    ):
        raise HTTPException(
            status_code=409,
            detail="Нельзя удалить смену за неделю с уже созданной выплатой. Сначала удалите выплату.",
        )
    await db.execute("DELETE FROM shifts WHERE id=$1", shift_id)
    return Response(status_code=204)


# ── Слой 7b: отметка об отправке недельного отчёта (останавливает push) ────────
class WeekReportBody(BaseModel):
    week_start: str


@app.post("/shifts/mark-week-reported")
async def mark_week_reported(body: WeekReportBody, user=Depends(require_auth)):
    if user.worker_id is None:
        raise HTTPException(status_code=400, detail="current user has no linked worker")
    try:
        ws = date_cls.fromisoformat(body.week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="week_start must be YYYY-MM-DD")
    await db.execute(
        "INSERT INTO weekly_reports (worker_id, week_start) VALUES ($1, $2) "
        "ON CONFLICT (worker_id, week_start) DO UPDATE SET reported_at=now()",
        user.worker_id, ws,
    )
    return {"success": True}
