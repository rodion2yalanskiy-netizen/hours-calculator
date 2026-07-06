-- Слой 8: гибкие выплаты. Выплата = чек + произвольный набор смен, которые он
-- покрывает (в т.ч. из разных календарных недель/месяцев). Источник истины для
-- расчёта заработка выплаты — payout_shifts, а не диапазон недели.
-- Идемпотентно.

-- Связь выплата ↔ смены. shift_id bigint (shifts.id = bigserial), payout_id uuid.
CREATE TABLE IF NOT EXISTS payout_shifts (
    payout_id uuid   NOT NULL REFERENCES weekly_payouts(id) ON DELETE CASCADE,
    shift_id  bigint NOT NULL REFERENCES shifts(id)        ON DELETE CASCADE,
    PRIMARY KEY (payout_id, shift_id),
    UNIQUE (shift_id)   -- смена входит максимум в ОДНУ выплату
);
CREATE INDEX IF NOT EXISTS idx_payout_shifts_payout ON payout_shifts(payout_id);

-- Старое ограничение «одна выплата на календарную неделю» больше не действует:
-- теперь выплат у работника может быть несколько с любым week_start (= min дата
-- выбранных смен, хранится справочно). UNIQUE(receipt_id) из 007 остаётся.
ALTER TABLE weekly_payouts DROP CONSTRAINT IF EXISTS weekly_payouts_worker_id_week_start_key;

-- week_start/week_end остаются как справочный диапазон (min/max дат смен). NOT NULL
-- снимаем — вдруг понадобится выплата-справка; но на практике всегда заполняем.
ALTER TABLE weekly_payouts ALTER COLUMN week_start DROP NOT NULL;
ALTER TABLE weekly_payouts ALTER COLUMN week_end   DROP NOT NULL;
