-- Слой 6: фото-чеки. Каждая новая выплата привязана к распознанному чеку.
-- Идемпотентно (IF NOT EXISTS) — применяется тем же run_migrations() под advisory-lock.
-- Существующие weekly_payouts (без чека) остаются с receipt_id = NULL (не трогаем).
-- NOT NULL на receipt_id НЕ ставим (сломало бы старые записи) — enforce на уровне API.

CREATE TABLE IF NOT EXISTS receipts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id            bigint NOT NULL REFERENCES workers (id),   -- workers.id = bigserial
    file_path            text NOT NULL,                             -- путь на Volume: /data/receipts/{wid}/{yyyy-mm}/{id}.{ext}
    file_size_bytes      int NOT NULL,
    mime_type            text NOT NULL,
    recognized_amount    numeric(8,2),                              -- что прочитал Gemini (может быть NULL)
    confirmed_amount     numeric(8,2),                              -- что подтвердил пользователь
    is_receipt_confirmed boolean NOT NULL DEFAULT false,            -- Gemini подтвердил, что это чек
    gemini_raw_response  jsonb,                                     -- полный ответ Gemini (аудит)
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipts_worker_id ON receipts (worker_id);

-- Связь выплаты с чеком (nullable для старых записей).
ALTER TABLE weekly_payouts ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES receipts (id);
CREATE INDEX IF NOT EXISTS idx_payouts_receipt_id ON weekly_payouts (receipt_id);
