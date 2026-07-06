import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getPayouts, getUnpaidShifts, type Payout, type UnpaidShift } from '../api';
import { fmtUSD, fmtHours } from '../format';
import { IconCheckCircle, IconCoins, IconAlertTriangle, IconCamera, IconPaperclip } from '../components/icons';
import PayoutReasonModal from '../components/PayoutReasonModal';
import ReceiptViewer from '../components/ReceiptViewer';
import ReceiptReviewControls from '../components/ReceiptReviewControls';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Слой 8: выплаты по произвольным сменам. Сверху — неоплаченные смены + «создать
 * выплату»; ниже — список выплат, каждая показывает покрытые смены. */
export default function PayoutsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workerId = user?.worker_id ?? undefined;
  const role = user?.role === 'supervisor' ? 'supervisor' : 'worker';

  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [unpaid, setUnpaid] = useState<UnpaidShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editPayout, setEditPayout] = useState<Payout | null>(null);
  const [viewerReceiptId, setViewerReceiptId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (workerId == null) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [p, u] = await Promise.all([getPayouts({ worker_id: workerId }), getUnpaidShifts(workerId)]);
      setPayouts(p);
      setUnpaid(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [workerId]);
  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2000); };

  const unpaidHours = useMemo(() => round2(unpaid.reduce((a, s) => a + s.calculated_hours, 0)), [unpaid]);
  const unpaidEarned = useMemo(() => round2(unpaid.reduce((a, s) => a + s.money, 0)), [unpaid]);

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-4">Выплаты</h1>

      {/* Неоплаченные смены → создать выплату */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mb-4">
        {unpaid.length > 0 ? (
          <>
            <p className="text-sm text-text-muted mb-1">Не оплачено</p>
            <p className="text-lg font-semibold mb-3">
              {unpaid.length} смен · {fmtHours(unpaidHours)} · <span className="text-accent">{fmtUSD(unpaidEarned)}</span>
            </p>
            <button onClick={() => navigate('/payouts/receipt')}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold bg-accent text-bg-2 hover:bg-accent-2">
              <IconCamera className="w-4 h-4" /> Создать выплату (выбрать смены + чек)
            </button>
          </>
        ) : (
          <p className="text-text-muted text-sm text-center">Все смены оплачены 🎉</p>
        )}
      </div>

      {error && (
        <div className="bg-bg-2 border border-danger/40 rounded-2xl p-4 text-center">
          <p className="text-danger text-sm mb-3">Не удалось загрузить: {error}</p>
          <button onClick={load} className="rounded-xl px-4 py-2 bg-bg-3 text-text text-sm">Повторить</button>
        </div>
      )}
      {loading && !error && (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-32 bg-bg-2 border border-border rounded-2xl animate-pulse" />)}</div>
      )}
      {!loading && !error && payouts.length === 0 && (
        <p className="text-text-muted text-sm text-center py-8">Выплат пока нет.</p>
      )}

      {!loading && !error && payouts.length > 0 && (
        <div className="space-y-3">
          {payouts.map((p) => (
            <PayoutCard key={p.id} p={p} role={role}
              onEdit={() => setEditPayout(p)}
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

function periodLabel(p: Payout): string {
  if (!p.week_start || !p.week_end) return 'выплата';
  return p.week_start === p.week_end ? p.week_start : `${p.week_start} – ${p.week_end}`;
}

function PayoutCard({ p, role, onEdit, onViewReceipt, onReviewed }: {
  p: Payout; role: 'supervisor' | 'worker';
  onEdit: () => void; onViewReceipt: (receiptId: string) => void; onReviewed: () => void;
}) {
  return (
    <div className="bg-bg-2 border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{periodLabel(p)}</h3>
          <p className="text-text-muted text-xs mt-0.5">{p.covered_shifts.length} смен покрыто</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {p.receipt_id && (
            <button onClick={() => onViewReceipt(p.receipt_id!)} aria-label="Открыть чек"
              className="w-8 h-8 rounded-xl bg-bg-3 border border-border-2 flex items-center justify-center text-text-3 hover:text-accent">
              <IconPaperclip className="w-4 h-4" />
            </button>
          )}
          <button onClick={onEdit} className="rounded-xl px-3 py-1.5 text-sm font-medium bg-bg-3 border border-border-2 hover:border-accent">Изменить</button>
        </div>
      </div>

      <div className="text-sm space-y-1">
        <div className="flex justify-between"><span className="text-text-muted">Заработано</span><span>{fmtUSD(p.earned_by_hours)}</span></div>
        <div className="flex justify-between"><span className="text-text-muted">Получено</span><span>{fmtUSD(p.amount_paid)}</span></div>
      </div>

      {/* Покрытые смены */}
      {p.covered_shifts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-1">
          {p.covered_shifts.map((s) => (
            <div key={s.id} className="flex justify-between text-xs text-text-muted">
              <span className="truncate mr-2">{s.date} · {s.object_name}</span>
              <span className="shrink-0">{fmtHours(s.calculated_hours)} · {fmtUSD(s.money)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border">
        <StatusLine p={p} />
      </div>

      <ReceiptReviewControls payout={p} role={role} onReviewed={onReviewed} />
    </div>
  );
}

function StatusLine({ p }: { p: Payout }) {
  if (p.bonus > 0) {
    return <p className="flex items-center gap-2 text-success font-medium"><IconCheckCircle className="w-5 h-5" /> Бонус: +{fmtUSD(p.bonus)}</p>;
  }
  if (p.shortfall > 0) {
    if (p.shortfall_reason === 'fine') {
      return (
        <div className="text-danger">
          <p className="flex items-center gap-2 font-medium"><IconAlertTriangle className="w-5 h-5" /> Штраф: −{fmtUSD(p.shortfall)}</p>
          {p.shortfall_note && <p className="text-text-muted text-sm mt-1 pl-7">«{p.shortfall_note}»</p>}
        </div>
      );
    }
    return <p className="flex items-center gap-2 text-warning font-medium"><IconCoins className="w-5 h-5" /> Долг: −{fmtUSD(p.shortfall)} <span className="text-text-muted font-normal">(перенос)</span></p>;
  }
  return <p className="flex items-center gap-2 text-text-3 font-medium"><IconCheckCircle className="w-5 h-5" /> Оплачено ровно</p>;
}
