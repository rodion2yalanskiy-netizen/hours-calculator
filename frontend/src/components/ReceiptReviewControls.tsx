import { useState } from 'react';
import { reviewReceipt, type Payout, type ReviewStatus } from '../api';

const BADGE: Record<ReviewStatus, { dot: string; label: string; cls: string }> = {
  confirmed: { dot: '🟢', label: 'Чек подтверждён', cls: 'text-success' },
  pending_review: { dot: '🟡', label: 'Чек на проверке', cls: 'text-warning' },
  invalid: { dot: '🔴', label: 'Чек отклонён', cls: 'text-danger' },
};

/**
 * Статус ревью чека + управление (7f).
 * - Работник видит бейдж; при 'invalid' — красное сообщение «неделя не оплачена».
 * - Супервайзер видит кнопки Подтвердить / На проверку / Отклонить (+заметка) → PATCH /receipts/{id}/review.
 */
export default function ReceiptReviewControls({ payout, role, onReviewed }: {
  payout: Payout;
  role: 'supervisor' | 'worker';
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState<ReviewStatus | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(payout.review_note ?? '');
  const [error, setError] = useState<string | null>(null);

  // Нет чека или статуса — нечего показывать.
  if (!payout.receipt_id || !payout.review_status) return null;
  const status = payout.review_status;
  const badge = BADGE[status];

  const apply = async (next: ReviewStatus, withNote?: string) => {
    if (!payout.receipt_id) return;
    setBusy(next); setError(null);
    try {
      await reviewReceipt(payout.receipt_id, next, withNote);
      setNoteOpen(false);
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setBusy(null); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-medium ${badge.cls}`}>{badge.dot} {badge.label}</span>
      </div>

      {/* Работник: красное сообщение при отклонении */}
      {role === 'worker' && status === 'invalid' && (
        <p className="text-danger text-sm">
          Супервайзер отклонил чек{payout.review_note ? `: ${payout.review_note}` : ''}. Неделя не оплачена.
        </p>
      )}
      {role === 'worker' && status !== 'invalid' && payout.review_note && (
        <p className="text-text-muted text-sm">«{payout.review_note}»</p>
      )}

      {/* Супервайзер: кнопки управления */}
      {role === 'supervisor' && (
        <div className="space-y-2">
          {payout.review_note && <p className="text-text-muted text-sm">«{payout.review_note}»</p>}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => apply('confirmed')} disabled={busy != null}
              className={`rounded-xl py-2 text-sm font-medium border ${status === 'confirmed' ? 'bg-accent-dim border-accent text-accent' : 'bg-bg-3 border-border-2 text-text-muted hover:text-success'}`}>
              {busy === 'confirmed' ? '…' : 'Подтвердить'}
            </button>
            <button onClick={() => apply('pending_review')} disabled={busy != null}
              className={`rounded-xl py-2 text-sm font-medium border ${status === 'pending_review' ? 'bg-bg-3 border-warning text-warning' : 'bg-bg-3 border-border-2 text-text-muted hover:text-warning'}`}>
              {busy === 'pending_review' ? '…' : 'На проверку'}
            </button>
            <button onClick={() => { setNote(payout.review_note ?? ''); setNoteOpen((v) => !v); }} disabled={busy != null}
              className={`rounded-xl py-2 text-sm font-medium border ${status === 'invalid' ? 'bg-bg-3 border-danger text-danger' : 'bg-bg-3 border-border-2 text-text-muted hover:text-danger'}`}>
              Отклонить
            </button>
          </div>
          {noteOpen && (
            <div className="space-y-2">
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Причина отклонения (необязательно)"
                className="w-full bg-bg-3 border border-border-2 rounded-xl px-3 py-2 text-sm outline-none focus:border-danger" />
              <div className="flex gap-2">
                <button onClick={() => setNoteOpen(false)} className="flex-1 rounded-xl py-2 text-sm bg-bg-3 text-text-muted">Отмена</button>
                <button onClick={() => apply('invalid', note.trim() || undefined)} disabled={busy != null}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold bg-danger/90 text-bg-2 hover:bg-danger">
                  {busy === 'invalid' ? 'Отклоняем…' : 'Отклонить чек'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
