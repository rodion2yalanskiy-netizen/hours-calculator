import { useState, type FormEvent, type ReactNode } from 'react';
import { updatePayout, deletePayout, type Payout } from '../api';
import { fmtUSD } from '../format';
import { formatWeekLabel } from '../lib/weeks';
import { haptic } from '../haptic';
import { IconCoins, IconAlertTriangle } from './icons';

// Урезанное редактирование выплаты (Слой 6): сумму менять нельзя (только новый чек),
// можно переклассифицировать причину недоплаты и удалить выплату.
export default function PayoutReasonModal({ payout, onClose, onSaved }: {
  payout: Payout; onClose: () => void; onSaved: () => void;
}) {
  const hasShortfall = payout.shortfall > 0;
  const [reason, setReason] = useState<'debt' | 'fine' | null>(payout.shortfall_reason);
  const [note, setNote] = useState(payout.shortfall_note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const noteOk = reason !== 'fine' || note.trim().length >= 5;
  const valid = !hasShortfall || (!!reason && noteOk);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hasShortfall) { onClose(); return; }
    setError(null); setBusy(true);
    try {
      await updatePayout(payout.id, { shortfall_reason: reason, ...(note.trim() ? { shortfall_note: note.trim() } : {}) });
      haptic('success'); onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Удалить выплату? Фото чека тоже будет удалено.')) return;
    setBusy(true);
    try { await deletePayout(payout.id); haptic('light'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-bg-2 border border-border w-full h-full overflow-y-auto md:h-auto md:max-w-[480px] md:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{payout.week_start && payout.week_end ? `Выплата за ${formatWeekLabel(payout.week_start, payout.week_end)}` : 'Выплата'}</h2>
          <button onClick={onClose} className="text-text-muted text-2xl leading-none">×</button>
        </div>

        <div className="bg-bg-3 border border-border rounded-xl p-4 mb-4 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-text-muted">Отработано</span><span>{fmtUSD(payout.earned_by_hours)}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">Получено (по чеку)</span><span>{fmtUSD(payout.amount_paid)}</span></div>
        </div>
        <p className="text-text-muted text-xs mb-4">Чтобы изменить сумму, удалите текущую выплату и внесите чек заново.</p>

        <form onSubmit={submit} className="space-y-4">
          {hasShortfall ? (
            <>
              <div className="flex items-center gap-2 bg-bg-3 text-warning rounded-xl px-4 py-3 text-sm"><IconAlertTriangle className="w-5 h-5" /> Недоплата: −{fmtUSD(payout.shortfall)}</div>
              <div>
                <p className="text-text-3 text-xs mb-2">Причина недоплаты</p>
                <div className="grid grid-cols-2 gap-3">
                  <ReasonBtn selected={reason === 'debt'} onClick={() => setReason('debt')} icon={<IconCoins className="w-5 h-5" />} title="Долг босса" sub="перенос" />
                  <ReasonBtn selected={reason === 'fine'} onClick={() => setReason('fine')} icon={<IconAlertTriangle className="w-5 h-5" />} title="Штраф" sub="за ошибку" />
                </div>
              </div>
              {reason === 'fine' && (
                <label className="block">
                  <span className="text-text-3 text-xs">За что штраф (мин. 5 символов)</span>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: Разбил окно у клиента"
                    className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
                </label>
              )}
            </>
          ) : (
            <p className="text-text-muted text-sm">Сумма покрывает расчёт — причина недоплаты не нужна.</p>
          )}

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={remove} disabled={busy} className="rounded-xl px-4 py-3 bg-bg-3 text-danger">Удалить</button>
            <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отмена</button>
            {hasShortfall && (
              <button type="submit" disabled={busy || !valid}
                className={`flex-1 rounded-xl py-3 font-semibold ${busy || !valid ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
                {busy ? 'Сохранение…' : 'Сохранить'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ReasonBtn({ selected, onClick, icon, title, sub }: {
  selected: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl px-3 py-3 text-left border ${selected ? 'bg-accent-dim border-accent text-text' : 'bg-bg-3 border-border-2 text-text-muted'}`}>
      <div className="flex items-center gap-2 font-semibold text-sm">{icon}{title}</div>
      <div className="text-xs mt-0.5 opacity-80">{sub}</div>
    </button>
  );
}
