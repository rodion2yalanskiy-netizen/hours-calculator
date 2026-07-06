import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getTeam, getSummaryPeriod, getShifts, getPayouts,
  type TeamMember, type PeriodSummary, type Shift, type Payout,
} from '../api';
import { monthRange, monthLabel, addMonths, isFutureMonth } from '../period';
import { fmtMoney, fmtHours, fmtCardDate } from '../format';
import { IconChevL, IconChevR } from '../components/icons';
import EditMemberModal from '../components/EditMemberModal';
import ReceiptReviewControls from '../components/ReceiptReviewControls';

function payoutBadge(p: Payout): { label: string; cls: string } {
  if (p.bonus > 0) return { label: `Бонус +${fmtMoney(p.bonus)}`, cls: 'text-success' };
  if (p.shortfall > 0) {
    return p.shortfall_reason === 'fine'
      ? { label: `Штраф −${fmtMoney(p.shortfall)}`, cls: 'text-danger' }
      : { label: `Долг −${fmtMoney(p.shortfall)}`, cls: 'text-warning' };
  }
  return { label: 'Оплачено', cls: 'text-text-3' };
}

export default function TeamMemberPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);

  const [member, setMember] = useState<TeamMember | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [monthCursor, setMonthCursor] = useState<Date>(() => new Date());
  const [period, setPeriod] = useState<PeriodSummary | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [showAllPayouts, setShowAllPayouts] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const isSelf = userId === user?.id;

  const loadMember = async () => {
    try {
      const list = await getTeam(true);
      const m = list.find((x) => x.user_id === userId) ?? null;
      setMember(m); setNotFound(m === null);
    } catch { setNotFound(true); }
  };
  useEffect(() => { loadMember(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const wid = member?.worker_id ?? null;
  const monthTs = monthCursor.getTime();
  useEffect(() => {
    if (wid == null) return;
    let cancelled = false;
    const { from, to } = monthRange(monthCursor, today);
    Promise.all([
      getSummaryPeriod(from, to, wid),
      getShifts(monthCursor.getFullYear(), monthCursor.getMonth() + 1, wid),
      getPayouts({ worker_id: wid, from, to }),
    ]).then(([p, s, po]) => {
      if (cancelled) return;
      setPeriod(p); setShifts([...s].sort((a, b) => a.date.localeCompare(b.date))); setPayouts(po);
    }).catch(() => { if (!cancelled) { setPeriod(null); setShifts([]); setPayouts([]); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, monthTs, reloadTick]);

  if (notFound) {
    return (
      <div className="text-center py-16">
        <p className="text-text-muted mb-4">Работник не найден.</p>
        <button onClick={() => navigate('/team')} className="rounded-xl px-4 py-2 bg-bg-3">← К команде</button>
      </div>
    );
  }
  if (!member) return <div className="h-40 bg-bg-2 border border-border rounded-2xl animate-pulse" />;

  const w = period?.workers[0];
  const hours = w ? w.weeks.reduce((a, x) => a + x.total_hours, 0) : 0;
  const t = period?.totals;
  const canNext = !isFutureMonth(addMonths(monthCursor, 1), today);

  const onEdit = () => { if (isSelf) navigate('/profile'); else setShowEdit(true); };

  return (
    <div>
      <button onClick={() => navigate('/team')} className="flex items-center gap-1 text-text-muted text-sm mb-4">
        <IconChevL className="w-4 h-4" /> Назад
      </button>

      {/* Секция 1 — инфо */}
      <div className={`bg-bg-2 border border-border rounded-2xl p-5 ${member.is_active ? '' : 'opacity-70'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">
              {member.full_name}{member.role === 'supervisor' && <span className="text-accent text-sm font-semibold"> ★</span>}
              {isSelf && <span className="text-text-muted font-normal text-base"> (Я)</span>}
            </h1>
            <p className="text-text-muted text-sm truncate">{member.email}</p>
          </div>
          <button onClick={onEdit} className="shrink-0 rounded-xl px-3 py-2 bg-bg-3 border border-border-2 text-sm hover:border-accent">
            Изменить
          </button>
        </div>
        <div className="mt-3 text-sm space-y-1">
          <p>Ставка: <span className="font-medium">${member.hourly_rate}/час</span></p>
          <p>Статус: <span className={member.is_active ? 'text-accent' : 'text-warning'}>{member.is_active ? 'Активен' : 'Неактивен'}</span></p>
        </div>
      </div>

      {pwNotice && (
        <div className="mt-4 bg-accent-dim border border-accent/40 rounded-2xl p-4">
          <p className="text-sm text-text-2 mb-1">Пароль обновлён. Передайте работнику:</p>
          <p className="font-mono text-accent break-all">{pwNotice}</p>
          <button onClick={() => setPwNotice(null)} className="mt-2 text-text-muted text-sm">Закрыть</button>
        </div>
      )}

      {/* Секция 2 — сводка за месяц */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonthCursor((c) => addMonths(c, -1))} className="w-8 h-8 rounded-full bg-bg-3 flex items-center justify-center text-text-muted">
            <IconChevL className="w-4 h-4" />
          </button>
          <span className="font-semibold">{monthLabel(monthCursor)}</span>
          <button onClick={() => canNext && setMonthCursor((c) => addMonths(c, 1))} disabled={!canNext}
            className={`w-8 h-8 rounded-full flex items-center justify-center ${canNext ? 'bg-bg-3 text-text-muted' : 'bg-bg-3/40 text-border-2'}`}>
            <IconChevR className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2 text-sm">
          <Row label="Часов" value={fmtHours(hours)} />
          <Row label="Заработано по часам" value={fmtMoney(t?.total_earned ?? 0)} />
          <Row label="Получено от босса" value={fmtMoney(t?.total_paid ?? 0)} />
          {t && t.total_bonus > 0 && <Row label="Бонус" value={`+${fmtMoney(t.total_bonus)}`} valueCls="text-success" />}
          {t && t.total_shortfall > 0 && <Row label="Недоплата" value={`−${fmtMoney(t.total_shortfall)}`} valueCls="text-warning" />}
        </div>
      </div>

      {/* Секция 3 — смены */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Смены за месяц</h2>
          <span className="text-text-muted text-sm">{shifts.length}</span>
        </div>
        {shifts.length === 0 ? (
          <p className="text-text-muted text-sm">Смен нет.</p>
        ) : (
          <div className="space-y-2">
            {shifts.slice(0, 8).map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                <span className="truncate mr-2">{fmtCardDate(s.date)} · <span className="text-text-muted">{s.object_name}</span></span>
                <span className="shrink-0 font-medium">{fmtHours(s.calculated_hours)}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => navigate(`/shifts?worker_id=${member.worker_id}`)}
          className="mt-3 w-full rounded-xl py-2.5 bg-bg-3 text-sm hover:text-accent">
          Все смены работника →
        </button>
      </div>

      {/* Секция 4 — выплаты */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mt-4 mb-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Выплаты за месяц</h2>
          <span className="text-text-muted text-sm">{payouts.length}</span>
        </div>
        {payouts.length === 0 ? (
          <p className="text-text-muted text-sm">Выплат нет.</p>
        ) : (
          <div className="space-y-2">{payouts.map((p) => (
            <PayoutRow key={p.id} p={p} role={user?.role === 'supervisor' ? 'supervisor' : 'worker'} onReviewed={() => setReloadTick((t) => t + 1)} />
          ))}</div>
        )}
        <button onClick={() => setShowAllPayouts(true)} className="mt-3 w-full rounded-xl py-2.5 bg-bg-3 text-sm hover:text-accent">
          Все выплаты работника →
        </button>
      </div>

      {showEdit && member && (
        <EditMemberModal
          member={member}
          onClose={() => setShowEdit(false)}
          onSaved={(pw) => { setShowEdit(false); setPwNotice(pw); loadMember(); setMonthCursor((c) => new Date(c)); }}
        />
      )}

      {showAllPayouts && (
        <div className="fixed inset-0 z-40 bg-black/60 flex md:items-center md:justify-center" onClick={() => setShowAllPayouts(false)}>
          <div className="bg-bg-2 border border-border w-full h-full overflow-y-auto md:h-auto md:max-h-[80vh] md:max-w-[480px] md:rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Выплаты · {member.full_name}</h2>
              <button onClick={() => setShowAllPayouts(false)} className="text-text-muted text-2xl leading-none">×</button>
            </div>
            {payouts.length === 0 ? (
              <p className="text-text-muted text-sm">За выбранный месяц выплат нет. Полный список — в разделе Выплаты (скоро).</p>
            ) : (
              <div className="space-y-2">{payouts.map((p) => (
                <PayoutRow key={p.id} p={p} detailed role={user?.role === 'supervisor' ? 'supervisor' : 'worker'} onReviewed={() => setReloadTick((t) => t + 1)} />
              ))}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={`font-medium ${valueCls ?? ''}`}>{value}</span>
    </div>
  );
}

function PayoutRow({ p, detailed, role, onReviewed }: {
  p: Payout; detailed?: boolean;
  role: 'supervisor' | 'worker'; onReviewed: () => void;
}) {
  const badge = payoutBadge(p);
  return (
    <div className="border-b border-border last:border-0 pb-2 last:pb-0">
      <div className="flex items-center justify-between text-sm">
        <div className="min-w-0">
          <div className="truncate">{p.week_start} – {p.week_end}</div>
          {detailed && <div className="text-text-muted text-xs">заработано {fmtMoney(p.earned_by_hours)} · получено {fmtMoney(p.amount_paid)}</div>}
        </div>
        <span className={`shrink-0 font-medium ${badge.cls}`}>{badge.label}</span>
      </div>
      {p.receipt_id && <ReceiptReviewControls payout={p} role={role} onReviewed={onReviewed} />}
    </div>
  );
}
