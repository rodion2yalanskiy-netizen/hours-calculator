import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getSummaryPeriod, getPayouts,
  type WeeklySummary, type Payout,
} from '../api';
import { isoOf, monthStart, monthEnd, addMonths, monthLabel, isFutureMonth } from '../period';
import { formatWeekLabel, getCurrentWeekStart, isPastWeek } from '../lib/weeks';
import { fmtUSD, fmtHours } from '../format';
import { IconChevL, IconChevR, IconCheckCircle, IconCoins, IconAlertTriangle, IconClock, IconCamera, IconPaperclip } from '../components/icons';
import PayoutReasonModal from '../components/PayoutReasonModal';
import ReceiptViewer from '../components/ReceiptViewer';
import ReceiptReviewControls from '../components/ReceiptReviewControls';

export default function PayoutsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workerId = user?.worker_id ?? undefined;
  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => getCurrentWeekStart(), []);

  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [weeks, setWeeks] = useState<WeeklySummary[]>([]);
  const [totals, setTotals] = useState<{ earned: number; paid: number; bonus: number; shortfall: number }>({ earned: 0, paid: 0, bonus: 0, shortfall: 0 });
  const [payoutMap, setPayoutMap] = useState<Record<string, Payout>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editPayout, setEditPayout] = useState<Payout | null>(null);
  const [viewerReceiptId, setViewerReceiptId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const cursorTs = cursor.getTime();
  const load = async () => {
    if (workerId == null) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const from = isoOf(monthStart(cursor));
      const to = isoOf(monthEnd(cursor));
      const [period, allPayouts] = await Promise.all([
        getSummaryPeriod(from, to, workerId),
        getPayouts({ worker_id: workerId }),
      ]);
      const w = period.workers[0];
      setWeeks(w ? w.weeks : []);
      setTotals({
        earned: period.totals.total_earned, paid: period.totals.total_paid,
        bonus: period.totals.total_bonus, shortfall: period.totals.total_shortfall,
      });
      setPayoutMap(Object.fromEntries(allPayouts.map((p) => [p.week_start, p])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cursorTs, workerId]);

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2000); };

  // Показываем недели с часами ИЛИ с выплатой; свежие сверху.
  const shown = useMemo(
    () => weeks.filter((wk) => wk.total_hours > 0 || wk.payout != null)
      .sort((a, b) => b.week_start.localeCompare(a.week_start)),
    [weeks],
  );
  const unpaid = shown.filter((wk) => wk.status === 'unpaid' && wk.total_hours > 0 && isPastWeek(wk.week_end));
  const canNext = !isFutureMonth(addMonths(cursor, 1), today);

  const onCapture = (wk: WeeklySummary) => navigate(`/payouts/receipt?week_start=${wk.week_start}`);
  const onEdit = (wk: WeeklySummary) => { const p = payoutMap[wk.week_start]; if (p) setEditPayout(p); };
  const scrollToUnpaid = () => {
    const el = document.getElementById(`week-${unpaid[0]?.week_start}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="relative">
      {/* Заголовок + селектор месяца */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Выплаты</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor((c) => addMonths(c, -1))} className="w-8 h-8 rounded-full bg-bg-2 border border-border flex items-center justify-center text-text-muted">
            <IconChevL className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium w-28 text-center">{monthLabel(cursor)}</span>
          <button onClick={() => canNext && setCursor((c) => addMonths(c, 1))} disabled={!canNext}
            className={`w-8 h-8 rounded-full border border-border flex items-center justify-center ${canNext ? 'bg-bg-2 text-text-muted' : 'bg-bg-2/40 text-border-2'}`}>
            <IconChevR className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Верхняя сводка */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mb-4">
        <Row label="Отработано" value={`${fmtUSD(totals.earned)} (${fmtHours(shown.reduce((a, w) => a + w.total_hours, 0))})`} />
        <Row label="Получено" value={fmtUSD(totals.paid)} />
        {totals.bonus > 0 && <Row label="Бонус" value={`+${fmtUSD(totals.bonus)}`} valueCls="text-success" />}
        {totals.shortfall > 0 && <Row label="Недоплата" value={`−${fmtUSD(totals.shortfall)}`} valueCls="text-warning" />}
        {unpaid.length > 0 && (
          <button onClick={scrollToUnpaid}
            className="mt-3 w-full flex items-center justify-between gap-2 bg-bg-3 rounded-xl px-4 py-3 text-warning text-sm">
            <span className="flex items-center gap-2"><IconAlertTriangle className="w-4 h-4" /> {unpaid.length} нерассчитанн{unpaid.length === 1 ? 'ая неделя' : 'ых недель'}</span>
            <IconChevR className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Состояния */}
      {error && (
        <div className="bg-bg-2 border border-danger/40 rounded-2xl p-4 text-center">
          <p className="text-danger text-sm mb-3">Не удалось загрузить: {error}</p>
          <button onClick={load} className="rounded-xl px-4 py-2 bg-bg-3 text-text text-sm">Повторить</button>
        </div>
      )}
      {loading && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 bg-bg-2 border border-border rounded-2xl animate-pulse" />)}
        </div>
      )}
      {!loading && !error && shown.length === 0 && (
        <p className="text-text-muted text-sm text-center py-8">За этот месяц нет ни смен, ни выплат.</p>
      )}

      {/* Недели */}
      {!loading && !error && (
        <div className="space-y-3">
          {shown.map((wk) => (
            <WeekCard key={wk.week_start} wk={wk} payout={payoutMap[wk.week_start] ?? null}
              isCurrent={wk.week_start === currentWeek}
              role={user?.role === 'supervisor' ? 'supervisor' : 'worker'}
              onCapture={() => onCapture(wk)} onEdit={() => onEdit(wk)}
              onViewReceipt={(rid) => setViewerReceiptId(rid)}
              onReviewed={() => { showToast('Статус чека обновлён'); load(); }} />
          ))}
        </div>
      )}

      {editPayout && (
        <PayoutReasonModal
          payout={editPayout}
          onClose={() => setEditPayout(null)}
          onSaved={() => { setEditPayout(null); showToast('Сохранено'); load(); }}
        />
      )}
      {viewerReceiptId && <ReceiptViewer receiptId={viewerReceiptId} onClose={() => setViewerReceiptId(null)} />}

      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-success text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-text-muted text-sm">{label}</span>
      <span className={`font-semibold ${valueCls ?? ''}`}>{value}</span>
    </div>
  );
}

function WeekCard({ wk, payout, isCurrent, role, onCapture, onEdit, onViewReceipt, onReviewed }: {
  wk: WeeklySummary; payout: Payout | null; isCurrent: boolean;
  role: 'supervisor' | 'worker';
  onCapture: () => void; onEdit: () => void; onViewReceipt: (receiptId: string) => void;
  onReviewed: () => void;
}) {
  const paid = payout != null;
  return (
    <div id={`week-${wk.week_start}`} className="bg-bg-2 border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">{formatWeekLabel(wk.week_start, wk.week_end)}</h3>
          {isCurrent && <span className="text-[11px] bg-accent-dim text-accent px-2 py-0.5 rounded-full">Эта неделя</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {payout?.receipt_id && (
            <button onClick={() => onViewReceipt(payout.receipt_id!)} aria-label="Открыть чек"
              className="w-8 h-8 rounded-xl bg-bg-3 border border-border-2 flex items-center justify-center text-text-3 hover:text-accent">
              <IconPaperclip className="w-4 h-4" />
            </button>
          )}
          {paid ? (
            <button onClick={onEdit} className="rounded-xl px-3 py-1.5 text-sm font-medium bg-bg-3 border border-border-2 hover:border-accent">Изменить</button>
          ) : (
            <button onClick={onCapture} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium bg-accent text-bg-2 hover:bg-accent-2">
              <IconCamera className="w-4 h-4" /> Внести чек
            </button>
          )}
        </div>
      </div>

      <div className="text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-text-muted">Отработано</span>
          <span>{fmtHours(wk.total_hours)} · {fmtUSD(wk.earned_by_hours)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Получено</span>
          <span>{payout ? fmtUSD(payout.amount_paid) : <span className="text-text-muted">— ещё не рассчитались</span>}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        <StatusLine wk={wk} />
      </div>

      {payout && <ReceiptReviewControls payout={payout} role={role} onReviewed={onReviewed} />}
    </div>
  );
}

function StatusLine({ wk }: { wk: WeeklySummary }) {
  if (wk.status === 'bonus') {
    return <p className="flex items-center gap-2 text-success font-medium"><IconCheckCircle className="w-5 h-5" /> Бонус: +{fmtUSD(wk.bonus)}</p>;
  }
  if (wk.status === 'shortfall_debt') {
    return <p className="flex items-center gap-2 text-warning font-medium"><IconCoins className="w-5 h-5" /> Долг: −{fmtUSD(wk.shortfall)} <span className="text-text-muted font-normal">(перенос)</span></p>;
  }
  if (wk.status === 'shortfall_fine') {
    return (
      <div className="text-danger">
        <p className="flex items-center gap-2 font-medium"><IconAlertTriangle className="w-5 h-5" /> Штраф: −{fmtUSD(wk.shortfall)}</p>
        {wk.payout?.shortfall_note && <p className="text-text-muted text-sm mt-1 pl-7">«{wk.payout.shortfall_note}»</p>}
      </div>
    );
  }
  if (wk.status === 'paid') {
    return <p className="flex items-center gap-2 text-text-3 font-medium"><IconCheckCircle className="w-5 h-5" /> Оплачено ровно</p>;
  }
  return <p className="flex items-center gap-2 text-text-muted"><IconClock className="w-5 h-5" /> Ожидает выплаты</p>;
}
