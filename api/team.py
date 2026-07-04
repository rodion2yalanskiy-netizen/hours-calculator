"""Роутер /team (Слой 3): управление командой (только supervisor).

GET  /team            — список членов команды (users с их worker'ами)
POST /team            — создать нового работника: worker + user разом (транзакция)
PATCH /team/{user_id} — изменить члена команды (имя/ставка/активность/пароль)
"""
import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from security import hash_password
from deps import require_supervisor, CurrentUser

router = APIRouter(prefix="/team", tags=["team"])


class TeamCreate(BaseModel):
    email: str
    password: str
    full_name: str
    hourly_rate: float


class TeamPatch(BaseModel):
    full_name: str | None = None
    hourly_rate: float | None = None
    is_active: bool | None = None
    new_password: str | None = None


def _member(row) -> dict:
    return {
        "worker_id": row["worker_id"],
        "user_id": str(row["user_id"]),
        "email": row["email"],
        "full_name": row["full_name"],
        "role": row["role"],
        "hourly_rate": float(row["hourly_rate"]),
        "is_active": row["is_active"],
        "created_at": row["created_at"].isoformat(),
    }


@router.get("")
async def list_team(current: CurrentUser = Depends(require_supervisor)):
    rows = await db.fetch(
        "SELECT u.id AS user_id, u.worker_id, u.email, u.full_name, u.role, "
        "       u.hourly_rate, u.is_active, u.created_at "
        "FROM users u JOIN workers w ON w.id = u.worker_id "
        "WHERE w.user_id=$1 AND u.is_active=true AND w.active=true "
        "ORDER BY (u.role='supervisor') DESC, u.full_name",
        current.id,
    )
    return [_member(r) for r in rows]


@router.post("")
async def create_team_member(body: TeamCreate, current: CurrentUser = Depends(require_supervisor)):
    email = body.email.strip().lower()
    full_name = body.full_name.strip()
    if not email:
        raise HTTPException(status_code=400, detail="email is required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    if not full_name:
        raise HTTPException(status_code=400, detail="full_name is required")
    if body.hourly_rate <= 0:
        raise HTTPException(status_code=400, detail="hourly_rate must be > 0")

    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                exists = await conn.fetchval("SELECT 1 FROM users WHERE lower(email)=$1", email)
                if exists:
                    raise HTTPException(status_code=409, detail="email already in use")
                worker_id = await conn.fetchval(
                    "INSERT INTO workers (user_id, name, is_owner, active) "
                    "VALUES ($1, $2, false, true) RETURNING id",
                    current.id, full_name,
                )
                user_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, role, worker_id, hourly_rate, is_active) "
                    "VALUES ($1, $2, $3, 'worker', $4, $5, true) RETURNING id",
                    email, hash_password(body.password), full_name, worker_id, body.hourly_rate,
                )
    except asyncpg.UniqueViolationError:
        # гонка/дубль по email или (user_id,name) в workers
        raise HTTPException(status_code=409, detail="email or worker name already in use")

    return {
        "user_id": str(user_id),
        "worker_id": worker_id,
        "email": email,
        "full_name": full_name,
        "hourly_rate": float(body.hourly_rate),
    }


@router.patch("/{user_id}")
async def patch_team_member(
    user_id: str, body: TeamPatch, current: CurrentUser = Depends(require_supervisor)
):
    target = await db.fetchrow(
        "SELECT u.id, u.worker_id, u.email, u.full_name, u.role, u.hourly_rate, "
        "       u.is_active, u.created_at, w.user_id AS tenant "
        "FROM users u LEFT JOIN workers w ON w.id = u.worker_id "
        "WHERE u.id=$1::uuid",
        user_id,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="user not found")

    is_self = str(target["id"]) == current.user_id
    in_team = target["tenant"] == current.id and target["role"] == "worker"
    if not (is_self or in_team):
        raise HTTPException(status_code=403, detail="forbidden: not your team member")

    sets, args = [], []
    if body.full_name is not None:
        name = body.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="full_name cannot be empty")
        sets.append(f"full_name=${len(args) + 1}")
        args.append(name)
    if body.hourly_rate is not None:
        if body.hourly_rate <= 0:
            raise HTTPException(status_code=400, detail="hourly_rate must be > 0")
        sets.append(f"hourly_rate=${len(args) + 1}")
        args.append(body.hourly_rate)
    if body.is_active is not None:
        if is_self:
            raise HTTPException(status_code=400, detail="cannot change is_active for yourself")
        sets.append(f"is_active=${len(args) + 1}")
        args.append(body.is_active)
    if body.new_password is not None:
        if len(body.new_password) < 8:
            raise HTTPException(status_code=400, detail="new_password must be at least 8 characters")
        sets.append(f"password_hash=${len(args) + 1}")
        args.append(hash_password(body.new_password))
        sets.append("token_version=token_version+1")  # инвалидация старых токенов
    if not sets:
        raise HTTPException(status_code=400, detail="nothing to update")
    sets.append("updated_at=now()")

    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                args_u = args + [user_id]
                updated = await conn.fetchrow(
                    f"UPDATE users SET {', '.join(sets)} WHERE id=${len(args_u)}::uuid "
                    f"RETURNING id AS user_id, worker_id, email, full_name, role, hourly_rate, is_active, created_at",
                    *args_u,
                )
                # имя — синхронизируем в workers.name для консистентности
                if body.full_name is not None and updated["worker_id"] is not None:
                    await conn.execute(
                        "UPDATE workers SET name=$1, updated_at=now() WHERE id=$2",
                        body.full_name.strip(), updated["worker_id"],
                    )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="worker name already in use")

    return _member(updated)
