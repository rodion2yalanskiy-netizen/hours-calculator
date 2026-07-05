-- Слой 7e: явная галочка обеда. lunch_skipped=true → работник снял галочку
-- (обеда не было, 30 мин НЕ вычтены), supervisor должен это видеть.
-- Идемпотентно. Существующие смены → false (обед вычтен/автоопределён исторически).
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS lunch_skipped boolean NOT NULL DEFAULT false;
