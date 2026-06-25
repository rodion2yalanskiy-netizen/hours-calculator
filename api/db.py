"""Подключение к Postgres + применение миграции.

Схема принадлежит ТОЛЬКО api: миграция применяется на старте идемпотентно
(CREATE TABLE IF NOT EXISTS) под Postgres advisory-lock — чтобы при нескольких
воркерах/перезапусках не было гонки за DDL. Бот схему не трогает.
"""
import pathlib
import asyncpg
from config import DATABASE_URL, OWNER_ID

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
    """Применить 001_init.sql + засеять бригаду под advisory-lock (владелец схемы)."""
    pool = await get_pool()
    sql = _MIGRATION_FILE.read_text(encoding="utf-8")
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK_KEY)
        try:
            await conn.execute(sql)  # multi-statement DDL, все IF NOT EXISTS
            await _seed_workers(conn)  # стартовая бригада (идемпотентно)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", _MIGRATION_LOCK_KEY)


async def _seed_workers(conn: asyncpg.Connection) -> None:
    """Засеять стартовую бригаду из OWNER_ID (идемпотентно, ON CONFLICT DO NOTHING).

    user_id берём из OWNER_ID env — личный id НЕ хранится в SQL-файле/git.
    Родион — владелец и считает деньги; Денис/Дима — без денег; все active.
    Повторный старт ничего не дублирует (UNIQUE(user_id, name)).
    """
    if OWNER_ID <= 0:
        return  # OWNER_ID не задан — не засеваем мусорный user_id=0
    await conn.execute(
        """
        INSERT INTO workers (user_id, name, is_owner, count_money, active) VALUES
            ($1, 'Родион', true,  true,  true),
            ($1, 'Денис',  false, false, true),
            ($1, 'Дима',   false, false, true)
        ON CONFLICT (user_id, name) DO NOTHING
        """,
        OWNER_ID,
    )
