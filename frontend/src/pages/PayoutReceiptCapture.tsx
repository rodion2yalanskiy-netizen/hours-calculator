import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  uploadReceipt, createPayoutFromReceipt, deleteReceipt, getSummaryWeekly,
  type ReceiptUploadResponse, type WeeklySummary,
} from '../api';
import { formatWeekLabel } from '../lib/weeks';
import { fmtUSD, fmtHours } from '../format';
import { haptic } from '../haptic';
import { IconCheckCircle, IconCoins, IconAlertTriangle } from '../components/icons';

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function weekEndOf(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + 6));
}

type Step = 'capture' | 'uploading' | 'result' | 'saving' | 'saved';

export default function PayoutReceiptCapture() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const weekStart = params.get('week_start') ?? '';
  const weekEnd = useMemo(() => (weekStart ? weekEndOf(weekStart) : ''), [weekStart]);
  const workerId = user?.worker_id ?? undefined;

  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [step, setStep] = useState<Step>('capture');
  const [uploaded, setUploaded] = useState<ReceiptUploadResponse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'debt' | 'fine' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileSizeMb, setFileSizeMb] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!weekStart || workerId == null) return;
    getSummaryWeekly(weekStart, workerId).then(setSummary).catch(() => setSummary(null));
  }, [weekStart, workerId]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const earned = summary?.earned_by_hours ?? 0;
  const hours = summary?.total_hours ?? 0;
  const rate = hours > 0 ? Math.round((earned / hours) * 100) / 100 : (user?.hourly_rate ?? 0);

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum >= 0;
  const am = hasAmount ? Math.round(amountNum * 100) / 100 : 0;
  const bonus = hasAmount ? Math.round((am - earned) * 100) / 100 : 0;
  const shortfall = hasAmount ? Math.round((earned - am) * 100) / 100 : 0;
  const noteOk = reason !== 'fine' || note.trim().length >= 5;
  const canConfirm = hasAmount && (shortfall <= 0 || (!!reason && noteOk));

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileSizeMb(file.size / (1024 * 1024));
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setStep('uploading');
    try {
      const res = await uploadReceipt(file);
      setUploaded(res);
      setAmount(res.recognized_amount != null ? String(res.recognized_amount) : '');
      setReason(null); setNote('');
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
      setStep('capture');
    }
  };

  const retry = async () => {
    if (uploaded) { try { await deleteReceipt(uploaded.receipt_id); } catch { /* уже нет */ } }
    setUploaded(null); setAmount(''); setError(null);
    if (preview) { URL.revokeObjectURL(preview); setPreview(null); }
    setStep('capture');
    fileRef.current?.click();
  };

  const cancel = async () => {
    if (uploaded) { try { await deleteReceipt(uploaded.receipt_id); } catch { /* ignore */ } }
    navigate('/payouts');
  };

  const confirm = async () => {
    if (!uploaded || !canConfirm) return;
    setStep('saving'); setError(null);
    try {
      await createPayoutFromReceipt({
        receipt_id: uploaded.receipt_id,
        week_start: weekStart, week_end: weekEnd,
        confirmed_amount: am,
        ...(shortfall > 0 ? { shortfall_reason: reason as 'debt' | 'fine' } : {}),
        ...(shortfall > 0 && note.trim() ? { shortfall_note: note.trim() } : {}),
      });
      haptic('success');
      setStep('saved');
      window.setTimeout(() => navigate('/payouts'), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
      setStep('result');
    }
  };

  if (!weekStart) {
    return <div className="text-center py-16"><p className="text-text-muted mb-4">Неделя не указана.</p>
      <button onClick={() => navigate('/payouts')} className="rounded-xl px-4 py-2 bg-bg-3">← К выплатам</button></div>;
  }

  const notReceipt = step === 'result' && uploaded && !uploaded.is_receipt_confirmed;
  const noAmount = step === 'result' && uploaded && uploaded.is_receipt_confirmed && uploaded.recognized_amount == null;
  const good = step === 'result' && uploaded && uploaded.is_receipt_confirmed && uploaded.recognized_amount != null;

  return (
    <div className="relative">
      <button onClick={cancel} className="text-text-muted text-sm mb-4">← Отменить</button>
      <h1 className="text-2xl font-bold mb-4">Внести чек</h1>

      {/* Справка по неделе */}
      <div className="bg-bg-2 border border-border rounded-2xl p-4 mb-4 text-sm">
        <p className="font-semibold">{formatWeekLabel(weekStart, weekEnd)}</p>
        <p className="text-text-muted mt-1">
          Отработано: {fmtHours(hours)}{rate > 0 && ` × ${fmtUSD(rate)}`} = <span className="text-accent">{fmtUSD(earned)}</span>
        </p>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />

      {/* Шаг: съёмка */}
      {step === 'capture' && (
        <div className="text-center py-6">
          <button onClick={() => fileRef.current?.click()}
            className="w-full bg-accent text-bg-2 font-semibold rounded-2xl py-4 text-lg hover:bg-accent-2">
            📷 Сфотографировать чек
          </button>
          <p className="text-text-muted text-xs mt-3">На телефоне откроется камера. Можно и выбрать фото из галереи.</p>
          {error && <p className="text-danger text-sm mt-3">{error}</p>}
        </div>
      )}

      {/* Шаг: загрузка */}
      {step === 'uploading' && (
        <div className="text-center py-10">
          <div className="w-8 h-8 mx-auto rounded-full border-2 border-border-2 border-t-accent animate-spin" />
          <p className="text-text-muted text-sm mt-4">Загружаем фото{fileSizeMb > 1 ? ` (${fileSizeMb.toFixed(1)} МБ)` : ''} и распознаём…</p>
        </div>
      )}

      {/* Превью фото */}
      {preview && step !== 'capture' && step !== 'uploading' && (
        <img src={preview} alt="Чек" className="w-full max-h-64 object-contain rounded-2xl border border-border mb-4 bg-bg-3" />
      )}

      {/* A. Не чек */}
      {notReceipt && (
        <div className="bg-bg-2 border border-danger/40 rounded-2xl p-4">
          <p className="text-danger font-medium mb-1">Похоже, это не чек</p>
          <p className="text-text-muted text-sm mb-3">На фотографии должен быть чек, банковская выписка или скриншот перевода. {uploaded?.notes}</p>
          <button onClick={retry} className="w-full rounded-xl py-3 bg-accent text-bg-2 font-semibold">Сфотографировать заново</button>
        </div>
      )}

      {/* B. Чек, но сумма не прочитана */}
      {noAmount && (
        <div className="bg-bg-2 border border-warning/40 rounded-2xl p-4">
          <p className="text-warning font-medium mb-1">Это похоже на чек, но сумму прочитать не удалось</p>
          <p className="text-text-muted text-sm mb-3">Сфотографируйте лучше — не в темноте, без бликов.</p>
          <button onClick={retry} className="w-full rounded-xl py-3 bg-accent text-bg-2 font-semibold">Сфотографировать заново</button>
        </div>
      )}

      {/* C. Чек + сумма → подтверждение */}
      {(good || step === 'saving' || step === 'saved') && uploaded && (
        <div className="space-y-4">
          <div className="bg-bg-3 border border-border rounded-xl p-4 text-center">
            <p className="text-text-muted text-xs">Распознано на чеке</p>
            <p className="text-3xl font-bold text-accent">{fmtUSD(uploaded.recognized_amount ?? 0)}</p>
          </div>

          <label className="block">
            <span className="text-text-3 text-xs">Получено от босса, $ (можно поправить)</span>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 text-lg outline-none focus:border-accent" />
          </label>

          <div className="bg-bg-3 rounded-xl px-4 py-2 text-sm text-text-muted">
            Отработано: {fmtUSD(earned)} · Распознано: {fmtUSD(uploaded.recognized_amount ?? 0)}
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
            <button onClick={cancel} disabled={step === 'saving'} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отменить</button>
            <button onClick={confirm} disabled={!canConfirm || step === 'saving' || step === 'saved'}
              className={`flex-1 rounded-xl py-3 font-semibold ${canConfirm && step !== 'saving' ? 'bg-accent text-bg-2 hover:bg-accent-2' : 'bg-bg-3 text-text-muted'}`}>
              {step === 'saving' ? 'Сохраняем…' : 'Подтвердить и сохранить'}
            </button>
          </div>
          <button onClick={retry} disabled={step === 'saving' || step === 'saved'} className="w-full text-text-muted text-sm">Сфотографировать заново</button>
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
