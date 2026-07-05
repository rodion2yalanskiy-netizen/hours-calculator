import { useState, type FormEvent, type ReactNode } from 'react';
import { createPayout, updatePayout, deletePayout } from '../api';
import { fmtUSD, fmtHours } from '../format';
import { formatWeekLabel } from '../lib/weeks';
import { haptic } from '../haptic';
import { IconCheckCircle, IconCoins, IconAlertTriangle } from './icons';

export interface PayoutModalWeek {
  week_start: string;
  week_end: string;
  total_hours: number;
  earned_by_hours: number;
}
export interface PayoutModalExisting {
  id: string;
  amount_paid: number;
  shortfall_reason: 'debt' | 'fine' | null;
  shortfall_note: string | null;
}

export default function PayoutModal({
  week, existing, onClose, onSaved,
}: {
  week: PayoutModalWeek;
  existing: PayoutModalExisting | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(existing ? String(existing.amount_paid) : '');
  const [reason, setReason] = useState<'debt' | 'fine' | null>(existing?.shortfall_reason ?? null);
  const [note, setNote] = useState(existing?.shortfall_note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const earned = Math.round(week.earned_by_hours * 100) / 100;
  const rate = week.total_hours > 0 ? Math.round((earned / week.total_hours) * 100) / 100 : null;
  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum >= 0;
  const am = hasAmount ? Math.round(amountNum * 100) / 100 : 0;
  const bonus = hasAmount ? Math.round((am - earned) * 100) / 100 : 0;
  const shortfall = hasAmount ? Math.round((earned - am) * 100) / 100 : 0;

  const noteOk = reason !== 'fine' || note.trim().length >= 5;
  const valid = hasAmount && (shortfall <= 0 || (!!reason && noteOk));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (shortfall > 0) {
        const body = {
          amount_paid: am,
          shortfall_reason: reason as 'debt' | 'fine',
          ...(note.trim() ? { shortfall_note: note.trim() } : {}),
        };
        if (existing) await updatePayout(existing.id, body);
        else await createPayout({ week_start: week.week_start, week_end: week.week_end, ...body });
      } else {
        // Нет недоплаты — причину/заметку не шлём (при редактировании старая игнорируется статусом).
        if (existing) await updatePayout(existing.id, { amount_paid: am });
        else await createPayout({ week_start: week.week_start, week_end: week.week_end, amount_paid: am });
      }
      haptic('success');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить';
      setError(/already exists/i.test(msg) ? 'Выплата за эту неделю уже есть' : `Не удалось: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || !window.confirm('Точно удалить эту выплату?')) return;
    setBusy(true);
    try { await deletePayout(existing.id); haptic('light'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить'); }
    finally { setBusy(false); }
  };

  const label = formatWeekLabel(week.week_start, week.week_end);

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-bg-2 border border-border w-full h-full overflow-y-auto md:h-auto md:max-h-[90vh] md:max-w-[480px] md:rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{existing ? 'Изменить выплату' : 'Выплата'} за {label}</h2>
          <button onClick={onClose} className="text-text-muted text-2xl leading-none">×</button>
        </div>

        {/* Справка по неделе */}
        <div className="bg-bg-3 border border-border rounded-xl p-4 mb-4 text-sm">
          <p className="text-text-muted mb-1">За эту неделю:</p>
          <p className="font-medium">
            Отработано: {fmtHours(week.total_hours)}{rate != null && ` × ${fmtUSD(rate)}`} = <span className="text-accent">{fmtUSD(earned)}</span>
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-text-3 text-xs">Получено от босса, $</span>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={amount} autoFocus
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 text-lg outline-none focus:border-accent" />
          </label>

          {/* Live-расчёт */}
          {hasAmount && bonus > 0 && (
            <div className="flex items-center gap-2 bg-accent-dim text-success rounded-xl px-4 py-3">
              <IconCheckCircle className="w-5 h-5" /> Бонус: +{fmtUSD(bonus)}
            </div>
          )}
          {hasAmount && bonus === 0 && shortfall === 0 && (
            <div className="flex items-center gap-2 bg-bg-3 text-text-3 rounded-xl px-4 py-3">
              <IconCheckCircle className="w-5 h-5" /> Ровно по часам
            </div>
          )}
          {hasAmount && shortfall > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-bg-3 text-warning rounded-xl px-4 py-3">
                <IconAlertTriangle className="w-5 h-5" /> Недоплата: −{fmtUSD(shortfall)}
              </div>
              <div>
                <p className="text-text-3 text-xs mb-2">Причина (обязательно):</p>
                <div className="grid grid-cols-2 gap-3">
                  <ReasonBtn selected={reason === 'debt'} onClick={() => setReason('debt')}
                    icon={<IconCoins className="w-5 h-5" />} title="Долг босса" sub="перенос на будущее" />
                  <ReasonBtn selected={reason === 'fine'} onClick={() => setReason('fine')}
                    icon={<IconAlertTriangle className="w-5 h-5" />} title="Штраф" sub="за ошибку" />
                </div>
              </div>
              {reason === 'fine' && (
                <label className="block">
                  <span className="text-text-3 text-xs">За что штраф (обязательно)</span>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="например: Разбил окно у клиента"
                    className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
                </label>
              )}
              {reason === 'debt' && (
                <label className="block">
                  <span className="text-text-3 text-xs">Комментарий (необязательно)</span>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                    className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
                </label>
              )}
            </div>
          )}

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            {existing && (
              <button type="button" onClick={remove} disabled={busy}
                className="rounded-xl px-4 py-3 bg-bg-3 text-danger">Удалить</button>
            )}
            <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отмена</button>
            <button type="submit" disabled={busy || !valid}
              className={`flex-1 rounded-xl py-3 font-semibold ${busy || !valid ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
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
