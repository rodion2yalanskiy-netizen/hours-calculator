"""Подключение к Postgres + применение миграции.

Схема принадлежит ТОЛЬКО api: миграция применяется на старте идемпотентно
(CREATE TABLE IF NOT EXISTS) под Postgres advisory-lock — чтобы при нескольких
воркерах/перезапусках не было гонки за DDL. Бот схему не трогает.
"""
import pathlib
import asyncpg
from config import DATABASE_URL

_pool: asyncpg.Pool | None = None

# Произвольный фиксированный ключ для pg_advisory_lock (общий «замок» миграции).
_MIGRATION_LOCK_KEY = 4920215

_MIGRATION_FILE = pathlib.Path(__file__).parent / "migrations" / "001_init.sql"


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    return _pool


async def run_migrations() -> None:
    """Применить 001_init.sql под advisory-lock (единственный владелец схемы)."""
    pool = await get_pool()
    sql = _MIGRATION_FILE.read_text(encoding="utf-8")
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK_KEY)
        try:
            await conn.execute(sql)  # multi-statement DDL, все IF NOT EXISTS
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", _MIGRATION_LOCK_KEY)
