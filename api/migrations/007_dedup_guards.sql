-- Слой 7g: защита от дублей (аудит 🔴-1, 🟡-1). Идемпотентно + boot-safe:
-- перед созданием UNIQUE-индексов чистим возможные существующие дубли, чтобы
-- CREATE UNIQUE INDEX не уронил старт приложения на живых данных.

-- ── Дубли смен (двойной тап «Сохранить») ──────────────────────────────────────
-- Удаляем точные дубли, оставляя самую раннюю строку (наименьший id).
-- Дубль = тот же работник/дата/время/объект → безопасно убрать лишние.
DELETE FROM shifts a USING shifts b
WHERE a.id > b.id
  AND a.worker_id = b.worker_id
  AND a.date = b.date
  AND a.start_time IS NOT DISTINCT FROM b.start_time
  AND a.end_time  IS NOT DISTINCT FROM b.end_time
  AND a.object_name = b.object_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_dedup
  ON shifts (worker_id, date, start_time, end_time, object_name);

-- ── Один чек = одна выплата ───────────────────────────────────────────────────
-- Если чек оказался привязан к >1 выплате — оставляем связь у самой ранней,
-- у остальных обнуляем receipt_id (деньги-строки НЕ удаляем, только отвязываем чек).
UPDATE weekly_payouts p SET receipt_id = NULL
WHERE receipt_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM weekly_payouts q
    WHERE q.receipt_id = p.receipt_id AND q.id < p.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_receipt
  ON weekly_payouts (receipt_id) WHERE receipt_id IS NOT NULL;
