"""Зависимости авторизации (Слой 2): require_auth / require_supervisor.

require_auth      — читает Bearer-токен, валидирует JWT, подгружает пользователя
                    из БД (свежие is_active/role/rate) и возвращает CurrentUser.
                    401 при отсутствии/недействительности токена или is_active=false.
require_supervisor— поверх require_auth; 403 если role != 'supervisor'.

ВАЖНО (Слой 2): CurrentUser.id = OWNER_ID — это legacy tenant-ключ (Telegram id
владельца), по которому фильтруют существующие таблицы (`WHERE user_id=$1`).
Так эндпоинты /shifts, /workers работают КАК РАНЬШЕ, только теперь под JWT.
Ролевую фильтрацию данных (worker видит лишь свои смены) вводим в Слое 3.
В Слое 2 существует ровно один пользователь — supervisor Родион, поэтому
привязка к OWNER_ID корректна.
"""
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

from config import OWNER_ID
from security import decode_access_token
import db


@dataclass
class CurrentUser:
    id: int             # legacy tenant-ключ (OWNER_ID) — для WHERE user_id=$1
    user_id: str        # UUID пользователя (users.id)
    email: str
    full_name: str
    role: str
    worker_id: int | None
    hourly_rate: float


def _extract_bearer(authorization: str) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="empty bearer token")
    return token


async def require_auth(authorization: str = Header(default="")) -> CurrentUser:
    """FastAPI-зависимость: валидирует JWT и возвращает текущего пользователя."""
    token = _extract_bearer(authorization)
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    uid = payload.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="invalid token payload")

    row = await db.fetchrow(
        "SELECT id, email, full_name, role, worker_id, hourly_rate, is_active "
        "FROM users WHERE id=$1::uuid",
        uid,
    )
    if row is None or not row["is_active"]:
        raise HTTPException(status_code=401, detail="user not found or inactive")

    return CurrentUser(
        id=OWNER_ID,
        user_id=str(row["id"]),
        email=row["email"],
        full_name=row["full_name"],
        role=row["role"],
        worker_id=row["worker_id"],
        hourly_rate=float(row["hourly_rate"]),
    )


async def require_supervisor(current: CurrentUser = Depends(require_auth)) -> CurrentUser:
    """Как require_auth, но требует роль supervisor. 403 для worker."""
    if current.role != "supervisor":
        raise HTTPException(status_code=403, detail="forbidden: supervisor only")
    return current
