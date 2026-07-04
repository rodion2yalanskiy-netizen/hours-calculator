-- Калькулятор часов — Слой 0, схема БД.
-- Единственный владелец схемы — сервис api (применяет идемпотентно на старте
-- под Postgres advisory-lock). Бот схему НЕ создаёт.
-- В Слое 0 данные НЕ пишем — только структура.
--
-- ПРАВИЛО НЕДЕЛЬ/МЕСЯЦЕВ (подтверждено владельцем):
--   • Главное измерение — МЕСЯЦ. Месячный итог = сумма недель этого месяца.
--   • Неделя ВСЕГДА внутри одного месяца (на стыке режется по месяцу).
--   • Неделя внутри месяца — по ЧИСЛУ дня: 1-7→1, 8-14→2, 15-21→3, 22-28→4, 29-31→5.
--   • Нумерация недель в каждом месяце начинается заново с 1.
-- Поэтому смена привязывается к (year, month, week_in_month). Эти три поля
-- ВЫЧИСЛЯЮТСЯ из date (GENERATED) — задать вручную нельзя, рассинхрон невозможен.
-- Так "неделя на стыке месяцев" автоматически режется правильно (год/месяц из той же date).

-- ── Смены ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
    id               bigserial PRIMARY KEY,
    user_id          bigint  NOT NULL,
    date             date    NOT NULL,
    day_of_week      text,                       -- полное рус. название: "Понедельник".."Воскресенье"
                                                 -- (заполняет приложение; косметика)
    object_name      text,                       -- объект/адрес
    start_time       time,                       -- время начала (тип time; см. примечание в README)
    end_time         time,                       -- время конца
    calculated_hours numeric(5,2),               -- считает приложение (НЕ генерим из time:
                                                 -- ночные смены/перерывы/округление)
    -- привязка к месяцу+неделе — строго из date (GENERATED ALWAYS):
    year             int GENERATED ALWAYS AS (EXTRACT(YEAR  FROM date)::int) STORED,
    month            int GENERATED ALWAYS AS (EXTRACT(MONTH FROM date)::int) STORED,
    week_in_month    int GENERATED ALWAYS AS (((EXTRACT(DAY FROM date)::int - 1) / 7) + 1) STORED,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shifts_user_month ON shifts (user_id, year, month, week_in_month);
CREATE INDEX IF NOT EXISTS idx_shifts_user_date  ON shifts (user_id, date);

-- ── Недели (агрегат на (user, year, month, week_in_month)) ───────────────────
-- week_in_month — номер недели ВНУТРИ месяца (1..5). Вместе с year+month
-- однозначно идентифицирует неделю, недели разных месяцев не путаются.
CREATE TABLE IF NOT EXISTS weeks (
    id                bigserial PRIMARY KEY,
    user_id           bigint NOT NULL,
    year              int NOT NULL,
    month             int NOT NULL,              -- 1..12
    week_in_month     int NOT NULL,              -- 1..5
    calculated_salary numeric(10,2),
    fact_paid         numeric(10,2),
    bonus             numeric(10,2),
    fine              numeric(10,2),
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','pending')),
    receipt_file_id   text,                      -- file_id чека в Telegram
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, year, month, week_in_month)
);
-- Месячный итог = SUM(calculated_salary) GROUP BY (user_id, year, month).
-- Отдельной таблицы "months" не нужно — месяц это агрегат над weeks.

-- ── Долги/закупки ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debts (
    id              bigserial PRIMARY KEY,
    user_id         bigint NOT NULL,
    date            date,
    store           text,                        -- магазин
    items_ru        text,                        -- что куплено (рус.)
    amount          numeric(10,2),
    paid            boolean NOT NULL DEFAULT false,
    receipt_file_id text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debts_user ON debts (user_id, paid);

-- ── Настройки (одна строка на пользователя) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    user_id     bigint PRIMARY KEY,
    hourly_rate numeric(10,2) NOT NULL DEFAULT 25,   -- $25/час по умолчанию
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Бригада (работники) — Слой 1а ────────────────────────────────────────────
-- Список людей, чьи смены ведём. Привязка к владельцу системы (user_id), как везде.
-- Удаление — мягкое, через active=false (историю смен не рвём).
-- ЗАСЕВ стартовой бригады делает КОД api на старте (из OWNER_ID, идемпотентно),
-- здесь — только структура (личный id владельца в SQL/git не попадает).
CREATE TABLE IF NOT EXISTS workers (
    id          bigserial PRIMARY KEY,
    user_id     bigint  NOT NULL,                    -- владелец системы (как в shifts/weeks/...)
    name        text    NOT NULL,                    -- имя работника
    is_owner    boolean NOT NULL DEFAULT false,      -- это сам владелец (Родион)
    count_money boolean NOT NULL DEFAULT false,      -- считать ли деньги по этому человеку
    active      boolean NOT NULL DEFAULT true,       -- сейчас в бригаде / убран
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)                           -- нужно для идемпотентного засева (ON CONFLICT)
);
CREATE INDEX IF NOT EXISTS idx_workers_user_active ON workers (user_id, active);

-- ── shifts: "чья это смена" ───────────────────────────────────────────────────
-- Nullable: старые/неуказанные смены не ломаются (данных пока нет → миграция мгновенна).
-- ON DELETE SET NULL: жёсткое удаление работника не уносит смену (штатно — мягко через active).
ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS worker_id bigint REFERENCES workers (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_worker ON shifts (worker_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Слой 2: аутентификация (users), snapshot ставки в сменах, недельные выплаты.
-- Идемпотентно (IF NOT EXISTS / IF EXISTS), применяется тем же run_migrations()
-- под advisory-lock. gen_random_uuid() — встроенная в PostgreSQL 13+ (Railway PG16).
--
-- ПРИМЕЧАНИЕ ПО ТИПАМ: в исходном ТЗ ссылки на работника были UUID, но фактически
-- workers.id — bigserial (bigint). Поэтому users.worker_id и weekly_payouts.worker_id
-- объявлены как bigint REFERENCES workers(id) — иначе внешний ключ не создать.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Пользователи веб-приложения (логин / роль / личная ставка) ───────────────
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    full_name     text NOT NULL,
    role          text NOT NULL CHECK (role IN ('supervisor', 'worker')),
    worker_id     bigint REFERENCES workers (id),   -- workers.id = bigserial (bigint)
    hourly_rate   numeric(6,2) NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_worker_id ON users (worker_id);

-- ── shifts: фиксация ставки на момент смены (snapshot) ────────────────────────
-- Историческая справедливость: существующие смены → $25 (ставка Родиона до 25 июня).
-- Новые смены по умолчанию 27.00 (текущая ставка); в Слое 3 будем проставлять
-- ставку конкретного работника явно. DEFAULT нужен, чтобы create_shift (который в
-- Слое 2 не меняем) не падал на NOT NULL при вставке без этого поля.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS hourly_rate_snapshot numeric(6,2);
UPDATE shifts SET hourly_rate_snapshot = 25.00 WHERE hourly_rate_snapshot IS NULL;
ALTER TABLE shifts ALTER COLUMN hourly_rate_snapshot SET DEFAULT 27.00;
ALTER TABLE shifts ALTER COLUMN hourly_rate_snapshot SET NOT NULL;

-- ── workers: count_money больше не нужен (все считают деньги) ─────────────────
ALTER TABLE workers DROP COLUMN IF EXISTS count_money;

-- ── Недельные выплаты от босса работнику ─────────────────────────────────────
-- earned_by_hours НЕ храним — считается на лету из shifts за неделю (Слой 3).
--   shortfall_reason IS NULL → недоплаты нет (amount_paid >= earned)
--   shortfall_reason='debt'  → босс недоплатил, обещал вернуть (переносится)
--   shortfall_reason='fine'  → штраф за ошибку (обязателен shortfall_note; проверка в API)
CREATE TABLE IF NOT EXISTS weekly_payouts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        bigint NOT NULL REFERENCES workers (id),  -- workers.id = bigserial
    week_start       date NOT NULL,                            -- понедельник недели
    week_end         date NOT NULL,                            -- воскресенье недели
    amount_paid      numeric(8,2) NOT NULL,                    -- сколько реально заплатил босс
    shortfall_reason text CHECK (shortfall_reason IN ('debt', 'fine')),
    shortfall_note   text,
    paid_at          timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (worker_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_payouts_worker_week ON weekly_payouts (worker_id, week_start);
