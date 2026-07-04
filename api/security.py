"""Пароли (bcrypt) и JWT (HS256, срок 7 дней).

Низкоуровневые хелперы без FastAPI/БД — используются и роутером /auth, и
зависимостью require_auth в deps.py. Секрет подписи — из env JWT_SECRET.

Безопасность:
- Подписывать/проверять токены пустым/слабым JWT_SECRET нельзя (fail-fast).
- В payload есть token_version (tv): смена пароля инкрементит его в БД, что
  делает ранее выданные токены недействительными (отзыв сессий).
"""
import datetime as dt

import bcrypt
import jwt

from config import JWT_SECRET

JWT_ALGORITHM = "HS256"
JWT_TTL = dt.timedelta(days=7)
MIN_SECRET_LEN = 32  # openssl rand -hex 32 → 64 hex-символа


def _ensure_secret() -> None:
    """Не даём подписывать/проверять слабым секретом (дополнительно к проверке на старте)."""
    if not JWT_SECRET or len(JWT_SECRET) < MIN_SECRET_LEN:
        raise RuntimeError(
            f"JWT_SECRET must be set and at least {MIN_SECRET_LEN} characters long"
        )


def hash_password(plain: str) -> str:
    """bcrypt-хэш пароля (соль внутри хэша)."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Сверить пароль с хэшем. Любой битый хэш/тип → False (не роняем 500)."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str, role: str, worker_id: int | None, token_version: int = 0) -> str:
    """JWT с payload {user_id, role, worker_id, tv, iat, exp}. Срок — JWT_TTL."""
    _ensure_secret()
    now = dt.datetime.now(tz=dt.timezone.utc)
    payload = {
        "user_id": str(user_id),
        "role": role,
        "worker_id": worker_id,       # int | None
        "tv": int(token_version),     # версия токена (отзыв при смене пароля)
        "iat": now,
        "exp": now + JWT_TTL,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Проверить подпись/срок и вернуть payload. Бросает jwt.PyJWTError — ловит вызывающий."""
    _ensure_secret()
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
