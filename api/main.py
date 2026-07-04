"""Калькулятор часов — API (FastAPI).

Слой 2: аутентификация по JWT. Все прежние эндпоинты (/me, /workers, /shifts)
теперь требуют Bearer-токен через require_auth (вместо Telegram require_owner).
Логика фильтрации данных НЕ менялась — это Слой 3. count_money убран: деньги
считаются всегда.
"""
from contextlib import asynccontextmanager
from datetime import date as date_cls, time

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from deps import require_auth
from auth import router as auth_router
from db import run_migrations
from config import CORS_ORIGIN
import calc
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
    # Единственный владелец схемы: применяем миграцию + сиды на старте (идемпотентно, под lock).
    await run_migrations()
    yield


app = FastAPI(title="Калькулятор часов API", lifespan=lifespan)

# CORS: фронт (Vercel) → API (Railway). На сборке CORS_ORIGIN="*", перед приёмкой — домен Vercel.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_ORIGIN == "*" else [CORS_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,  # JWT идёт в заголовке Authorization, cookie-креды не нужны
)

# Роутер аутентификации: /auth/login, /auth/me, /auth/change-password.
app.include_router(auth_router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/me")
async def me(user=Depends(require_auth)):
    # Совместимость со старым ответом {id, name, username}; данные — из JWT-пользователя.
    return {"id": user.user_id, "name": user.full_name, "username": None}


# ── Слой 1а: бригада (workers) ────────────────────────────────────────────────
class WorkerCreate(BaseModel):
    name: str
    is_owner: bool = False


class WorkerPatch(BaseModel):
    name: str | None = None
    active: bool | None = None


@app.get("/workers")
async def list_workers(user=Depends(require_auth)):
    rows = await db.fetch(
        "SELECT id, name, is_owner FROM workers "
        "WHERE user_id=$1 AND active=true ORDER BY is_owner DESC, name",
        user.id,
    )
    return [dict(r) for r in rows]


@app.post("/workers")
async def create_worker(body: WorkerCreate, user=Depends(require_auth)):
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
        # конфликт по (user_id, name) — вернём существующего
        row = await db.fetchrow(
            "SELECT id, name, is_owner, active FROM workers "
            "WHERE user_id=$1 AND name=$2",
            user.id, name,
        )
    return dict(row)


@app.patch("/workers/{worker_id}")
async def patch_worker(worker_id: int, body: WorkerPatch, user=Depends(require_auth)):
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
    args.extend([worker_id, user.id])  # WHERE id=$, user_id=$ — чужих не трогаем
    row = await db.fetchrow(
        f"UPDATE workers SET {', '.join(sets)} "
        f"WHERE id=${len(args) - 1} AND user_id=${len(args)} "
        f"RETURNING id, name, is_owner, active",
        *args,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="worker not found")
    return dict(row)


# ── Слой 1а: смены (shifts) ───────────────────────────────────────────────────
class PreviewBody(BaseModel):
    start_min: int
    end_min: int


class ShiftCreate(BaseModel):
    worker_id: int
    date: str
    object_name: str
    start_min: int
    end_min: int
    hours: float
    lunch_deducted: bool


@app.post("/shifts/preview")
async def shifts_preview(body: PreviewBody, user=Depends(require_auth)):
    # Чистый расчёт без записи — для кнопок (обед/округление) на фронте.
    return calc.preview_shift(body.start_min, body.end_min)


@app.post("/shifts")
async def create_shift(body: ShiftCreate, user=Depends(require_auth)):
    object_name = body.object_name.strip()
    if not object_name:
        raise HTTPException(status_code=400, detail="object_name is required")

    # worker_id должен быть активным работником ЭТОГО владельца.
    worker = await db.fetchrow(
        "SELECT id FROM workers WHERE id=$1 AND user_id=$2 AND active=true",
        body.worker_id, user.id,
    )
    if worker is None:
        raise HTTPException(status_code=400, detail="worker not found or inactive")

    try:
        d = date_cls.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    day_of_week = _RU_DAYS[d.weekday()]

    # hourly_rate_snapshot не задаём явно — колонка имеет DEFAULT 27.00 (Слой 2).
    # В Слое 3 будем проставлять ставку конкретного работника на момент смены.
    shift = await db.fetchrow(
        "INSERT INTO shifts "
        "(user_id, worker_id, date, day_of_week, object_name, start_time, end_time, calculated_hours) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
        "RETURNING id, date, day_of_week, object_name, worker_id, calculated_hours, start_time, end_time",
        user.id, body.worker_id, d, day_of_week, object_name,
        _min_to_time(body.start_min), _min_to_time(body.end_min), body.hours,
    )

    hours = float(shift["calculated_hours"])
    return {
        "id": shift["id"],
        "worker_id": shift["worker_id"],
        "date": shift["date"].isoformat(),
        "day_of_week": shift["day_of_week"],
        "object_name": shift["object_name"],
        "start_time": _hhmm(shift["start_time"]),
        "end_time": _hhmm(shift["end_time"]),
        "calculated_hours": hours,
        "lunch_deducted": body.lunch_deducted,
        "money": calc.money(hours),  # деньги считаем всегда (count_money убран)
    }


@app.get("/shifts")
async def list_shifts(
    year: int = Query(...),
    month: int = Query(...),
    user=Depends(require_auth),
):
    rows = await db.fetch(
        "SELECT s.date, s.day_of_week, s.object_name, s.worker_id, s.calculated_hours, "
        "       s.start_time, s.end_time, w.name AS worker_name "
        "FROM shifts s LEFT JOIN workers w ON w.id = s.worker_id "
        "WHERE s.user_id=$1 AND s.year=$2 AND s.month=$3 "
        "ORDER BY s.date",
        user.id, year, month,
    )
    result = []
    for r in rows:
        hours = float(r["calculated_hours"]) if r["calculated_hours"] is not None else 0.0
        result.append({
            "date": r["date"].isoformat(),
            "day_of_week": r["day_of_week"],
            "object_name": r["object_name"],
            "worker_id": r["worker_id"],
            "worker_name": r["worker_name"],
            "calculated_hours": hours,
            # TIME → минуты от полуночи (фронт форматирует в AM/PM). None если не задано.
            "start_min": _time_to_min(r["start_time"]),
            "end_min": _time_to_min(r["end_time"]),
            "money": calc.money(hours),  # деньги считаем всегда (count_money убран)
        })
    return result
