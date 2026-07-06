import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getUnpaidShifts, uploadReceipt, createPayout, createPayoutFromReceipt, deleteReceipt,
  type UnpaidShift, type ReceiptUploadResponse,
} from '../api';
import { formatWeekLabel } from '../lib/weeks';
import { fmtUSD, fmtHours } from '../format';
import { haptic } from '../haptic';
import { IconCheckCircle, IconCoins, IconAlertTriangle } from '../components/icons';

const pad = (n: number) => String(n).padStart(2, '0');
function weekEndOf(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const e = new Date(y, m - 1, d + 6);
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

type Step = 'select' | 'receipt' | 'uploading' | 'confirm' | 'saving' | 'saved';

/** Слой 8: создание выплаты по выбранным сменам (можно из разных недель) + чек. */
export default function PayoutReceiptCapture() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workerId = user?.worker_id ?? undefined;

  const [shifts, setShifts] = useState<UnpaidShift[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('select');
  const [uploaded, setUploaded] = useState<ReceiptUploadResponse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'debt' | 'fine' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getUnpaidShifts(workerId)
      .then((s) => setShifts(s))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
  }, [workerId]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Группировка неоплаченных смен по неделям (Пн-Вс), свежие сверху.
  const groups = useMemo(() => {
    const map = new Map<string, UnpaidShift[]>();
    for (const s of shifts) {
      const arr = map.get(s.week_start) ?? [];
      arr.push(s);
      map.set(s.week_start, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [shifts]);

  const selectedShifts = useMemo(() => shifts.filter((s) => selected.has(s.id)), [shifts, selected]);
  const earned = round2(selectedShifts.reduce((a, s) => a + s.money, 0));
  const totalHours = round2(selectedShifts.reduce((a, s) => a + s.calculated_hours, 0));

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum >= 0;
  const am = hasAmount ? round2(amountNum) : 0;
  const bonus = hasAmount ? round2(am - earned) : 0;
  const shortfall = hasAmount ? round2(earned - am) : 0;
  const noteOk = reason !== 'fine' || note.trim().length >= 5;
  const canConfirm = hasAmount && selected.size > 0 && (shortfall <= 0 || (!!reason && noteOk));

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleWeek = (wk: UnpaidShift[]) => setSelected((prev) => {
    const next = new Set(prev);
    const allSel = wk.every((s) => next.has(s.id));
    wk.forEach((s) => (allSel ? next.delete(s.id) : next.add(s.id)));
    return next;
  });

  const onPickReceipt = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setStep('uploading');
    try {
      const res = await uploadReceipt(file);
      setUploaded(res);
      setAmount(res.recognized_amount != null ? String(res.recognized_amount) : (earned ? String(earned) : ''));
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
      setStep('receipt');
    }
  };

  const skipReceipt = () => {
    setUploaded(null);
    setAmount(earned ? String(earned) : '');
    setStep('confirm');
  };

  const cancel = async () => {
    if (uploaded) { try { await deleteReceipt(uploaded.receipt_id); } catch { /* ignore */ } }
    navigate('/payouts');
  };

  const confirm = async () => {
    if (!canConfirm) return;
    setStep('saving'); setError(null);
    const shift_ids = [...selected];
    const shortfallExtra = shortfall > 0
      ? { shortfall_reason: reason as 'debt' | 'fine', ...(note.trim() ? { shortfall_note: note.trim() } : {}) }
      : {};
    try {
      if (uploaded) {
        await createPayoutFromReceipt({ receipt_id: uploaded.receipt_id, shift_ids, confirmed_amount: am, ...shortfallExtra });
      } else {
        await createPayout({ shift_ids, amount_paid: am, ...shortfallExtra });
      }
      haptic('success');
      setStep('saved');
      window.setTimeout(() => navigate('/payouts'), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
      setStep('confirm');
    }
  };

  return (
    <div className="relative">
      <button onClick={cancel} className="text-text-muted text-sm mb-4">← Отменить</button>
      <h1 className="text-2xl font-bold mb-1">Новая выплата</h1>
      <p className="text-text-muted text-sm mb-4">Выберите смены, которые покрывает один чек — можно из разных недель.</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickReceipt} className="hidden" />

      {/* Превью фото */}
      {preview && (step === 'confirm' || step === 'saving' || step === 'saved') && (
        <img src={preview} alt="Чек" className="w-full max-h-56 object-contain rounded-2xl border border-border mb-4 bg-bg-3" />
      )}

      {/* ── Шаг 1: выбор смен ── */}
      {step === 'select' && (
        <>
          {loading ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 bg-bg-2 border border-border rounded-2xl animate-pulse" />)}</div>
          ) : shifts.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-10">Нет неоплаченных смен. Все смены уже закрыты чеками.</p>
          ) : (
            <div className="space-y-4 pb-40">
              {groups.map(([wk, list]) => {
                const allSel = list.every((s) => selected.has(s.id));
                return (
                  <div key={wk} className="bg-bg-2 border border-border rounded-2xl p-3">
                    <button onClick={() => toggleWeek(list)}
                      className="w-full flex items-center justify-between text-sm font-semibold mb-2">
                      <span>{formatWeekLabel(wk, weekEndOf(wk))}</span>
                      <span className={`text-xs ${allSel ? 'text-accent' : 'text-text-muted'}`}>{allSel ? 'снять всё' : 'выбрать всё'}</span>
                    </button>
                    <div className="space-y-1.5">
                      {list.map((s) => {
                        const on = selected.has(s.id);
                        return (
                          <button key={s.id} onClick={() => toggle(s.id)}
                            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left border ${on ? 'bg-accent-dim border-accent' : 'bg-bg-3 border-border-2'}`}>
                            <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent text-bg-2' : 'border-border-2'}`}>
                              {on && '✓'}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm truncate">{s.date} · {s.object_name}</span>
                              <span className="block text-text-muted text-xs">{fmtHours(s.calculated_hours)} · {fmtUSD(s.money)}{s.lunch_skipped ? ' · без обеда' : ''}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Плавающая панель итога */}
          {shifts.length > 0 && (
            <div className="fixed bottom-20 inset-x-0 px-4 z-20">
              <div className="max-w-md mx-auto bg-bg-2 border border-border rounded-2xl p-3 shadow-lg">
                <p className="text-sm text-text-muted mb-2">
                  Выбрано <span className="text-text font-semibold">{selected.size}</span> смен · {fmtHours(totalHours)} · заработано <span className="text-accent font-semibold">{fmtUSD(earned)}</span>
                </p>
                <button onClick={() => setStep('receipt')} disabled={selected.size === 0}
                  className={`w-full rounded-xl py-3 font-semibold ${selected.size ? 'bg-accent text-bg-2 hover:bg-accent-2' : 'bg-bg-3 text-text-muted'}`}>
                  Далее → чек
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Шаг 2: чек ── */}
      {step === 'receipt' && (
        <div className="space-y-4">
          <div className="bg-bg-3 rounded-xl px-4 py-3 text-sm text-text-muted">
            {selected.size} смен · {fmtHours(totalHours)} · заработано <span className="text-accent">{fmtUSD(earned)}</span>
          </div>
          <button onClick={() => fileRef.current?.click()}
            className="w-full bg-accent text-bg-2 font-semibold rounded-2xl py-4 text-lg hover:bg-accent-2">
            📷 Сфотографировать чек
          </button>
          <button onClick={skipReceipt} className="w-full rounded-2xl py-3 bg-bg-3 text-text-muted">
            Без чека — ввести сумму вручную
          </button>
          <button onClick={() => setStep('select')} className="w-full text-text-muted text-sm">← назад к выбору смен</button>
          {error && <p className="text-danger text-sm">{error}</p>}
        </div>
      )}

      {step === 'uploading' && (
        <div className="text-center py-10">
          <div className="w-8 h-8 mx-auto rounded-full border-2 border-border-2 border-t-accent animate-spin" />
          <p className="text-text-muted text-sm mt-4">Загружаем фото и распознаём…</p>
        </div>
      )}

      {/* ── Шаг 3: подтверждение суммы ── */}
      {(step === 'confirm' || step === 'saving' || step === 'saved') && (
        <div className="space-y-4">
          {uploaded && !uploaded.is_receipt_confirmed && (
            <div className="bg-bg-2 border border-warning/40 rounded-2xl p-4">
              <p className="text-warning font-medium mb-1">ИИ не распознал чек автоматически</p>
              <p className="text-text-muted text-sm">Впишите сумму сами — старший проверит фото вручную.</p>
            </div>
          )}
          {uploaded?.recognized_amount != null && (
            <div className="bg-bg-3 border border-border rounded-xl p-4 text-center">
              <p className="text-text-muted text-xs">Распознано на чеке</p>
              <p className="text-3xl font-bold text-accent">{fmtUSD(uploaded.recognized_amount)}</p>
            </div>
          )}

          <label className="block">
            <span className="text-text-3 text-xs">Получено от босса, $ (можно поправить)</span>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 text-lg outline-none focus:border-accent" />
          </label>

          <div className="bg-bg-3 rounded-xl px-4 py-2 text-sm text-text-muted">
            {selected.size} смен · {fmtHours(totalHours)} · заработано {fmtUSD(earned)}
          </div>

          {hasAmount && bonus > 0 && (
            <div className="flex items-center gap-2 bg-accent-dim text-success rounded-xl px-4 py-3"><IconCheckCircle className="w-5 h-5" /> Бонус: +{fmtUSD(bonus)}</div>
          )}
          {hasAmount && bonus === 0 && shortfall === 0 && (
            <div className="flex items-center gap-2 bg-bg-3 text-text-3 rounded-xl px-4 py-3"><IconCheckCircle className="w-5 h-5" /> Ровно по часам</div>
          )}
          {hasAmount && shortfall > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-bg-3 text-warning rounded-xl px-4 py-3"><IconAlertTriangle className="w-5 h-5" /> Недоплата: −{fmtUSD(shortfall)}</div>
              <div className="grid grid-cols-2 gap-3">
                <ReasonBtn selected={reason === 'debt'} onClick={() => setReason('debt')} icon={<IconCoins className="w-5 h-5" />} title="Долг босса" sub="перенос" />
                <ReasonBtn selected={reason === 'fine'} onClick={() => setReason('fine')} icon={<IconAlertTriangle className="w-5 h-5" />} title="Штраф" sub="за ошибку" />
              </div>
              {reason === 'fine' && (
                <label className="block">
                  <span className="text-text-3 text-xs">За что штраф (мин. 5 символов)</span>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: Разбил окно у клиента"
                    className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
                </label>
              )}
            </div>
          )}

          {error && <p className="text-danger text-sm">{error}</p>}
          {step === 'saved' && <p className="text-success text-center font-medium">✓ Выплата сохранена</p>}

          <div className="flex gap-3">
            <button onClick={() => setStep('receipt')} disabled={step === 'saving' || step === 'saved'} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">← Назад</button>
            <button onClick={confirm} disabled={!canConfirm || step === 'saving' || step === 'saved'}
              className={`flex-1 rounded-xl py-3 font-semibold ${canConfirm && step !== 'saving' ? 'bg-accent text-bg-2 hover:bg-accent-2' : 'bg-bg-3 text-text-muted'}`}>
              {step === 'saving' ? 'Сохраняем…' : 'Сохранить выплату'}
            </button>
          </div>
        </div>
      )}
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
