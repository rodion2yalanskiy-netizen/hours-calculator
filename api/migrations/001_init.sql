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
