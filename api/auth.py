"""Роутер /auth (Слой 2): login, me, change-password.

JWT + bcrypt вынесены в security.py; текущий пользователь — через deps.require_auth.
Прежняя Telegram-проверка (require_owner) удалена — доступ теперь по JWT.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
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
