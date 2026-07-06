"""Роутер /auth (Слой 2): login, me, change-password.

JWT + bcrypt вынесены в security.py; текущий пользователь — через deps.require_auth.
Прежняя Telegram-проверка (require_owner) удалена — доступ теперь по JWT.
"""
import asyncio
import re

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
import logic
import notifier
from security import verify_password, hash_password, create_access_token
from deps import require_auth, CurrentUser

router = APIRouter(prefix="/auth", tags=["auth"])

# Фиксированный «пустой» хэш: прогоняем bcrypt даже когда пользователя нет/он
# неактивен, чтобы все ветки логина занимали одинаковое время (против тайминг-
# атаки / перечисления пользователей по времени ответа).
_DUMMY_HASH = hash_password("timing-equalizer-not-a-real-password")


class LoginBody(BaseModel):
    email: str
    password: str


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str


class ProfilePatch(BaseModel):
    full_name: str | None = None
    hourly_rate: float | None = None


@router.post("/login")
async def login(body: LoginBody):
    """Вход по email+password → {token, user}. 401 при неверных кредах/is_active=false."""
    email = body.email.strip().lower()
    row = await db.fetchrow(
        "SELECT id, password_hash, full_name, role, hourly_rate, worker_id, is_active, token_version "
        "FROM users WHERE lower(email)=$1",
        email,
    )
    if row is None or not row["is_active"]:
        # Прогоняем bcrypt против dummy-хэша — время как в обычной ветке (без утечки).
        verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail="invalid credentials")
    if not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = create_access_token(
        str(row["id"]), row["role"], row["worker_id"], row["token_version"]
    )
    return {
        "token": token,
        "user": {
            "id": str(row["id"]),
            "full_name": row["full_name"],
            "role": row["role"],
            "hourly_rate": float(row["hourly_rate"]),
        },
    }


@router.get("/me")
async def me(current: CurrentUser = Depends(require_auth)):
    """Текущий пользователь по Bearer-токену."""
    return {
        "id": current.user_id,
        "email": current.email,
        "full_name": current.full_name,
        "role": current.role,
        "hourly_rate": current.hourly_rate,
        "worker_id": current.worker_id,
    }


async def _user_dict(user_id: str) -> dict:
    row = await db.fetchrow(
        "SELECT id, email, full_name, role, worker_id, hourly_rate FROM users WHERE id=$1::uuid",
        user_id,
    )
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "full_name": row["full_name"],
        "role": row["role"],
        "hourly_rate": float(row["hourly_rate"]),
        "worker_id": row["worker_id"],
    }


@router.patch("/me")
async def patch_me(body: ProfilePatch, current: CurrentUser = Depends(require_auth)):
    """Изменить своё имя и СВОЮ ставку (7f: worker тоже может). Вариант A: новая ставка
    применяется только к БУДУЩИМ сменам — hourly_rate_snapshot существующих НЕ пересчитываем.
    Имя синхронизируется в workers.name. При смене ставки работником — push supervisor'у."""
    sets, args = [], []
    new_name: str | None = None
    rate_changed = False
    old_rate = float(current.hourly_rate)
    new_rate = old_rate
    if body.full_name is not None:
        new_name = body.full_name.strip()
        if len(new_name) < 2:
            raise HTTPException(status_code=400, detail="full_name must be at least 2 characters")
        sets.append(f"full_name=${len(args) + 1}")
        args.append(new_name)
    # 7f: свою ставку меняет любой (worker тоже). Snapshot прошлых смен не трогается.
    if body.hourly_rate is not None:
        if body.hourly_rate <= 0:
            raise HTTPException(status_code=400, detail="hourly_rate must be > 0")
        new_rate = float(body.hourly_rate)
        if new_rate != old_rate:
            rate_changed = True
        sets.append(f"hourly_rate=${len(args) + 1}")
        args.append(body.hourly_rate)

    if not sets:
        return await _user_dict(current.user_id)

    sets.append("updated_at=now()")
    args.append(current.user_id)
    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    f"UPDATE users SET {', '.join(sets)} WHERE id=${len(args)}::uuid", *args,
                )
                # Синхронизируем имя в workers для консистентности списков/отчётов.
                if new_name is not None and current.worker_id is not None:
                    await conn.execute(
                        "UPDATE workers SET name=$1, updated_at=now() WHERE id=$2",
                        new_name, current.worker_id,
                    )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="worker name already in use")

    # 7f: работник сменил свою ставку → push supervisor'у. supervisor за себя — без self-push.
    if rate_changed and current.role == "worker" and current.worker_id is not None:
        asyncio.create_task(_notify_rate_change(
            current.id, current.full_name, current.worker_id, old_rate, new_rate,
        ))
    return await _user_dict(current.user_id)


async def _notify_rate_change(tenant: int, worker_name: str, worker_id: int,
                              old_rate: float, new_rate: float) -> None:
    """Push supervisor'у: работник изменил свою ставку. Себе не шлём."""
    sup_worker_id = await logic.supervisor_worker_id(tenant)
    if sup_worker_id is None or sup_worker_id == worker_id:
        return
    await notifier.push_to_worker(
        sup_worker_id, "Смена ставки",
        f"{worker_name} изменил свою ставку: ${old_rate:g} → ${new_rate:g}/час",
        url="/team",
    )


_HAS_LETTER = re.compile(r"[A-Za-z]")
_HAS_DIGIT = re.compile(r"\d")


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody, current: CurrentUser = Depends(require_auth)
):
    """Смена пароля. new_password: 8+ символов, буквы и цифры. 401 если old неверен."""
    new = body.new_password
    if len(new) < 8 or not _HAS_LETTER.search(new) or not _HAS_DIGIT.search(new):
        raise HTTPException(
            status_code=400,
            detail="new password must be at least 8 characters and contain letters and digits",
        )
    row = await db.fetchrow(
        "SELECT password_hash FROM users WHERE id=$1::uuid", current.user_id
    )
    if row is None or not verify_password(body.old_password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="old password is incorrect")

    # token_version += 1 → все ранее выданные токены становятся недействительными.
    await db.execute(
        "UPDATE users SET password_hash=$1, token_version=token_version+1, updated_at=now() "
        "WHERE id=$2::uuid",
        hash_password(new), current.user_id,
    )
    return {"ok": True}
