-- Слой 7a: общие настройки приложения (singleton) — номер телефона босса.
-- Идемпотентно. ПРИМЕЧАНИЕ: users.id — uuid, поэтому updated_by uuid (в ТЗ был BIGINT — не подходит).

CREATE TABLE IF NOT EXISTS app_settings (
    id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- singleton: всегда ровно одна строка
    boss_phone text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES users (id)
);

INSERT INTO app_settings (id, boss_phone) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
