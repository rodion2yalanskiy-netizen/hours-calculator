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

_MIGRATIONS_DIR = pathlib.Path(__file__).parent / "migrations"
# Применяются по порядку на каждом старте (все идемпотентны: IF NOT EXISTS).
_MIGRATION_FILES = ["001_init.sql", "002_receipts.sql", "003_settings.sql", "004_push_and_reports.sql", "005_lunch_skipped.sql", "006_receipt_review.sql", "007_dedup_guards.sql", "008_payout_shifts.sql"]


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    return _pool


# ── Обёртки для запросов из эндпоинтов (raw asyncpg, прямые SQL-строки) ────────
async def fetch(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetch(sql, *args)


async def fetchrow(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetchrow(sql, *args)


async def execute(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.execute(sql, *args)


async def fetchval(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetchval(sql, *args)


async def run_migrations() -> None:
    """Применить все миграции по порядку + засеять бригаду и supervisor'а под advisory-lock."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK_KEY)
        try:
            for name in _MIGRATION_FILES:
                sql = (_MIGRATIONS_DIR / name).read_text(encoding="utf-8")
                await conn.execute(sql)  # multi-statement DDL, все IF NOT EXISTS
            await _seed_workers(conn)      # стартовая бригада (идемпотентно)
            await _seed_supervisor(conn)   # supervisor-аккаунт (Слой 2, идемпотентно)
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
    # count_money убран в Слое 2 (все считают деньги) — в INSERT его больше нет.
    await conn.execute(
        """
        INSERT INTO workers (user_id, name, is_owner, active) VALUES
            ($1, 'Родион', true,  true),
            ($1, 'Денис',  false, true),
            ($1, 'Дима',   false, true)
        ON CONFLICT (user_id, name) DO NOTHING
        """,
        OWNER_ID,
    )


async def _seed_supervisor(conn: asyncpg.Connection) -> None:
    """Засеять supervisor-аккаунт (Родион), если таблица users пуста (Слой 2).

    Данные — из env (секреты НЕ в коде/SQL): OWNER_EMAIL / OWNER_INITIAL_PASSWORD /
    OWNER_FULL_NAME. Пароль → bcrypt-хэш. role='supervisor', hourly_rate=27.00,
    worker_id — связь с существующим worker'ом Родиона (is_owner=true), созданным
    в _seed_workers. Идемпотентно: сеем только при полностью пустой таблице users
    и с ON CONFLICT(email) DO NOTHING как страховкой от гонки.
    """
    from config import OWNER_EMAIL, OWNER_INITIAL_PASSWORD, OWNER_FULL_NAME

    if OWNER_ID <= 0 or not (OWNER_EMAIL and OWNER_INITIAL_PASSWORD and OWNER_FULL_NAME):
        return  # нет обязательных env — не сеем (Railway задаст перед деплоем)

    existing = await conn.fetchval("SELECT count(*) FROM users")
    if existing and existing > 0:
        return  # уже есть пользователи — ничего не трогаем

    # worker Родиона (для связи users.worker_id); None не критично (колонка nullable).
    worker_id = await conn.fetchval(
        "SELECT id FROM workers WHERE user_id=$1 AND is_owner=true ORDER BY id LIMIT 1",
        OWNER_ID,
    )

    from security import hash_password  # локальный импорт: избегаем цикла на уровне модуля
    await conn.execute(
        """
        INSERT INTO users (email, password_hash, full_name, role, worker_id, hourly_rate)
        VALUES ($1, $2, $3, 'supervisor', $4, 27.00)
        ON CONFLICT (email) DO NOTHING
        """,
        OWNER_EMAIL.strip().lower(),
        hash_password(OWNER_INITIAL_PASSWORD),
        OWNER_FULL_NAME.strip(),
        worker_id,
    )
