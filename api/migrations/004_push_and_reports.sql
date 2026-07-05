-- Слой 7b: web-push подписки + отметки об отправке недельного отчёта.
-- Идемпотентно (CREATE TABLE IF NOT EXISTS). workers.id = bigserial → worker_id bigint.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id    bigint NOT NULL REFERENCES workers (id),
    endpoint     text NOT NULL UNIQUE,
    p256dh       text NOT NULL,
    auth         text NOT NULL,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_worker ON push_subscriptions (worker_id);

CREATE TABLE IF NOT EXISTS weekly_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id   bigint NOT NULL REFERENCES workers (id),
    week_start  date NOT NULL,
    reported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (worker_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_worker_week ON weekly_reports (worker_id, week_start);
