-- Слой 7f: supervisor-контроль чеков. review_status по умолчанию 'confirmed'
-- (ИИ больше не блокирует — работник всегда прикрепляет фото+сумму, supervisor проверяет).
-- Идемпотентно.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'confirmed'
  CHECK (review_status IN ('confirmed', 'pending_review', 'invalid'));
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reviewed_by bigint;
