import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getSummaryPeriod, getTeam,
  type PeriodSummary, type WorkerPeriod, type WeeklySummary, type TeamMember,
} from '../api';
import { getPresetRange, formatDateRange, PRESET_LABELS, type PresetKey } from '../lib/periods';
import { formatWeekLabel } from '../lib/weeks';
import { fmtUSD, fmtHours } from '../format';
import { IconCheckCircle, IconCoins, IconAlertTriangle, IconClock, IconChevDown } from '../components/icons';

const weekHours = (w: WorkerPeriod) => w.weeks.reduce((a, x) => a + x.total_hours, 0);

export default function SummaryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSupervisor = user?.role === 'supervisor';

  const [preset, setPreset] = useState<PresetKey>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [workerSel, setWorkerSel] = useState<string>('me'); // 'me' | 'team' | worker_id
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [data, setData] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const range = useMemo(() => (
    preset === 'custom' ? { from: customFrom, to: customTo } : getPresetRange(preset)
  ), [preset, customFrom, customTo]);
  const rangeReady = !!range.from && !!range.to && range.from <= range.to;

  // Список работников для селектора (supervisor).
  useEffect(() => {
    if (!isSupervisor) return;
    getTeam(true).then(setTeam).catch(() => setTeam([]));
  }, [isSupervisor]);
  const userIdByWorker = useMemo(
    () => Object.fromEntries(team.map((m) => [m.worker_id, m.user_id])) as Record<number, string>,
    [team],
  );
  const rateByWorker = useMemo(
    () => Object.fromEntries(team.map((m) => [m.worker_id, m.hourly_rate])) as Record<number, number>,
    [team],
  );
  const activeWorkers = team.filter((m) => m.role === 'worker' && m.is_active);

  const isTeamMode = isSupervisor && workerSel === 'team';

  const load = async () => {
    if (!rangeReady) { setLoading(false); return; }
    setLoading(true); setError(null);
    let workerId: number | undefined;
    if (!isSupervisor) workerId = undefined;              // worker → бэк форсит своего
    else if (workerSel === 'me') workerId = user?.worker_id ?? undefined;
    else if (workerSel === 'team') workerId = undefined;  // вся команда
    else workerId = Number(workerSel);
    try {
      setData(await getSummaryPeriod(range.from, range.to, workerId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сводку');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.from, range.to, workerSel, isSupervisor]);

  // Итоги
  const totalHours = data ? data.workers.reduce((a, w) => a + weekHours(w), 0) : 0;
  const net = data ? data.totals.total_bonus - data.totals.total_shortfall : 0;
  const workersInReport = data ? data.workers.filter((w) => weekHours(w) > 0) : [];
  const avgRate = workersInReport.length
    ? workersInReport.reduce((a, w) => a + (rateByWorker[w.worker_id] ?? 0), 0) / workersInReport.length
    : 0;

  const selectCls = 'w-full bg-bg-3 border border-border-2 rounded-xl px-3 py-2.5 outline-none focus:border-accent';

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-4">Сводка</h1>

      {/* Селекторы */}
      <div className="bg-bg-2 border border-border rounded-2xl p-4 mb-4 space-y-3">
        <label className="block">
          <span className="text-text-3 text-xs">Период</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as PresetKey)} className={`mt-1 ${selectCls}`}>
            {(Object.keys(PRESET_LABELS) as Array<Exclude<PresetKey, 'custom'>>).map((k) => (
              <option key={k} value={k}>{PRESET_LABELS[k]}</option>
            ))}
            <option value="custom">Кастом</option>
          </select>
        </label>

        {preset === 'custom' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-text-3 text-xs">С</span>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`mt-1 ${selectCls}`} />
            </label>
            <label className="block">
              <span className="text-text-3 text-xs">По</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`mt-1 ${selectCls}`} />
            </label>
          </div>
        ) : (
          <p className="text-text-muted text-sm">{formatDateRange(range.from, range.to)}</p>
        )}

        {isSupervisor && (
          <label className="block">
            <span className="text-text-3 text-xs">Работник</span>
            <select value={workerSel} onChange={(e) => setWorkerSel(e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="me">Я</option>
              <option value="team">Вся команда</option>
              {activeWorkers.map((m) => <option key={m.worker_id} value={String(m.worker_id)}>{m.full_name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Состояния */}
      {!rangeReady && preset === 'custom' && <p className="text-text-muted text-sm text-center py-8">Выберите даты периода.</p>}
      {error && (
        <div className="bg-bg-2 border border-danger/40 rounded-2xl p-4 text-center">
          <p className="text-danger text-sm mb-3">Не удалось загрузить сводку: {error}</p>
          <button onClick={load} className="rounded-xl px-4 py-2 bg-bg-3 text-text text-sm">Повторить</button>
        </div>
      )}
      {loading && !error && rangeReady && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 bg-bg-2 border border-border rounded-2xl animate-pulse" />)}
          </div>
          <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 bg-bg-2 border border-border rounded-2xl animate-pulse" />)}</div>
        </>
      )}

      {!loading && !error && data && (
        <>
          {/* Верхняя сводка */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Tile label="Часов" value={fmtHours(totalHours)} />
            <Tile label="Заработано" value={fmtUSD(data.totals.total_earned)} />
            <Tile label="Получено" value={fmtUSD(data.totals.total_paid)} />
            <Tile label="Бонус/недоплата"
              value={net > 0 ? `+${fmtUSD(net)}` : net < 0 ? `−${fmtUSD(-net)}` : '$0'}
              valueCls={net > 0 ? 'text-success' : net < 0 ? 'text-warning' : 'text-text-3'} />
          </div>

          {isTeamMode && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Tile label="Работников в отчёте" value={String(workersInReport.length)} />
              <Tile label="Средняя ставка" value={avgRate ? fmtUSD(Math.round(avgRate * 100) / 100) : '—'} />
            </div>
          )}

          {/* Разбивка по неделям */}
          {isTeamMode
            ? <TeamWeeks data={data} userIdByWorker={userIdByWorker} onWorker={(uid) => navigate(`/team/${uid}`)} />
            : <SingleWeeks worker={data.workers[0]} />}

          {/* Легенда */}
          <button onClick={() => setLegendOpen((v) => !v)}
            className="mt-5 flex items-center gap-1 text-text-muted text-sm">
            <IconChevDown className={`w-4 h-4 transition-transform ${legendOpen ? 'rotate-180' : ''}`} /> Что значат значки?
          </button>
          {legendOpen && (
            <div className="mt-2 bg-bg-2 border border-border rounded-2xl p-4 text-sm space-y-2">
              <Legend icon={<IconCheckCircle className="w-4 h-4 text-success" />} text="Бонус — босс заплатил больше расчёта" />
              <Legend icon={<IconCoins className="w-4 h-4 text-warning" />} text="Долг — босс не доплатил, перенесётся" />
              <Legend icon={<IconAlertTriangle className="w-4 h-4 text-danger" />} text="Штраф — списание за ошибку" />
              <Legend icon={<IconCheckCircle className="w-4 h-4 text-text-3" />} text="Ровно — совпало с расчётом" />
              <Legend icon={<IconClock className="w-4 h-4 text-text-muted" />} text="Ожидает — выплата ещё не введена" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="bg-bg-2 border border-border rounded-2xl p-4">
      <p className="text-text-muted text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueCls ?? ''}`}>{value}</p>
    </div>
  );
}

function Legend({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="flex items-center gap-2 text-text-2">{icon}<span>{text}</span></div>;
}

// ── Одна колонка (Я / работник) ────────────────────────────────────────────────
function SingleWeeks({ worker }: { worker?: WorkerPeriod }) {
  const weeks = (worker?.weeks ?? [])
    .filter((w) => w.total_hours > 0 || w.payout != null)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
  if (weeks.length === 0) return <p className="text-text-muted text-sm text-center py-8">За этот период нет данных.</p>;
  return (
    <div className="space-y-3">
      {weeks.map((wk) => (
        <div key={wk.week_start} className="bg-bg-2 border border-border rounded-2xl p-4">
          <h3 className="font-semibold mb-3">{formatWeekLabel(wk.week_start, wk.week_end)}</h3>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-text-muted">Отработано</span><span>{fmtHours(wk.total_hours)} · {fmtUSD(wk.earned_by_hours)}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Получено</span><span>{wk.payout ? fmtUSD(wk.payout.amount_paid) : <span className="text-text-muted">—</span>}</span></div>
          </div>
          <div className="mt-3 pt-3 border-t border-border"><StatusLine wk={wk} /></div>
        </div>
      ))}
    </div>
  );
}

// ── Командный режим (все работники по неделям) ──────────────────────────────────
function TeamWeeks({ data, userIdByWorker, onWorker }: {
  data: PeriodSummary; userIdByWorker: Record<number, string>; onWorker: (uid: string) => void;
}) {
  const base = data.workers[0]?.weeks ?? [];
  const rows = base
    .map((_, i) => data.workers.map((w) => w.weeks[i]).filter(Boolean))
    .filter((cells) => cells.some((c) => c.total_hours > 0 || c.payout != null))
    .sort((a, b) => b[0].week_start.localeCompare(a[0].week_start));

  if (rows.length === 0) return <p className="text-text-muted text-sm text-center py-8">За этот период нет данных.</p>;

  return (
    <div className="space-y-3">
      {rows.map((cells) => {
        const active = cells.filter((c) => c.total_hours > 0 || c.payout != null);
        const th = active.reduce((a, c) => a + c.total_hours, 0);
        const te = active.reduce((a, c) => a + c.earned_by_hours, 0);
        const tp = active.reduce((a, c) => a + (c.payout?.amount_paid ?? 0), 0);
        return (
          <div key={cells[0].week_start} className="bg-bg-2 border border-border rounded-2xl p-4">
            <h3 className="font-semibold mb-3">{formatWeekLabel(cells[0].week_start, cells[0].week_end)}</h3>
            <div className="space-y-2">
              {active.map((c) => {
                const uid = userIdByWorker[c.worker_id];
                const inner = (
                  <div className="flex items-center justify-between gap-2 bg-bg-3 rounded-xl px-3 py-2 text-sm w-full">
                    <span className="font-medium truncate">{c.worker_name}</span>
                    <span className="shrink-0 flex items-center gap-2">
                      <span className="text-text-muted">{fmtHours(c.total_hours)} · {fmtUSD(c.earned_by_hours)}</span>
                      <StatusChip wk={c} />
                    </span>
                  </div>
                );
                return uid
                  ? <button key={c.worker_id} onClick={() => onWorker(uid)} className="w-full text-left hover:opacity-80">{inner}</button>
                  : <div key={c.worker_id}>{inner}</div>;
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-sm text-text-2">
              Итого за неделю: <span className="font-medium">{fmtHours(th)} · {fmtUSD(te)}</span> · получено {fmtUSD(tp)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Статусы ─────────────────────────────────────────────────────────────────────
function StatusLine({ wk }: { wk: WeeklySummary }) {
  if (wk.status === 'bonus') return <p className="flex items-center gap-2 text-success font-medium"><IconCheckCircle className="w-5 h-5" /> Бонус: +{fmtUSD(wk.bonus)}</p>;
  if (wk.status === 'shortfall_debt') return <p className="flex items-center gap-2 text-warning font-medium"><IconCoins className="w-5 h-5" /> Долг: −{fmtUSD(wk.shortfall)} <span className="text-text-muted font-normal">(перенос)</span></p>;
  if (wk.status === 'shortfall_fine') return (
    <div className="text-danger">
      <p className="flex items-center gap-2 font-medium"><IconAlertTriangle className="w-5 h-5" /> Штраф: −{fmtUSD(wk.shortfall)}</p>
      {wk.payout?.shortfall_note && <p className="text-text-muted text-sm mt-1 pl-7">«{wk.payout.shortfall_note}»</p>}
    </div>
  );
  if (wk.status === 'paid') return <p className="flex items-center gap-2 text-text-3 font-medium"><IconCheckCircle className="w-5 h-5" /> Оплачено ровно</p>;
  return <p className="flex items-center gap-2 text-text-muted"><IconClock className="w-5 h-5" /> Ожидает выплаты</p>;
}

function StatusChip({ wk }: { wk: WeeklySummary }) {
  if (wk.status === 'bonus') return <span className="text-success font-medium">+{fmtUSD(wk.bonus)}</span>;
  if (wk.status === 'shortfall_debt') return <span className="text-warning font-medium">−{fmtUSD(wk.shortfall)}</span>;
  if (wk.status === 'shortfall_fine') return <span className="text-danger font-medium">−{fmtUSD(wk.shortfall)}</span>;
  if (wk.status === 'paid') return <span className="text-text-3">✓</span>;
  return <span className="text-text-muted">⚪</span>;
}
