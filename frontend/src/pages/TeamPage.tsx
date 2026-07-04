import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getTeam, getSummaryPeriod, type TeamMember } from '../api';
import { monthRange } from '../period';
import { fmtMoney, fmtHours } from '../format';
import { copyText } from '../clipboard';
import AddMemberModal from '../components/AddMemberModal';

interface MonthStat { hours: number; earned: number }

export default function TeamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [stats, setStats] = useState<Record<number, MonthStat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'active' | 'all'>('active');
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState<{ email: string; password: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const list = await getTeam(true); // все, фильтруем клиентски
      setMembers(list);
      const today = new Date();
      const { from, to } = monthRange(today, today);
      const entries = await Promise.all(list.map(async (m): Promise<[number, MonthStat]> => {
        try {
          const p = await getSummaryPeriod(from, to, m.worker_id);
          const w = p.workers[0];
          const hours = w ? w.weeks.reduce((a, x) => a + x.total_hours, 0) : 0;
          return [m.worker_id, { hours, earned: p.totals.total_earned }];
        } catch { return [m.worker_id, { hours: 0, earned: 0 }]; }
      }));
      setStats(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600); };
  const copyCreds = async () => {
    if (!notice) return;
    await copyText(`${notice.email}\n${notice.password}`);
    showToast('Креды скопированы');
  };

  const activeCount = members.filter((m) => m.is_active).length;
  const inactiveCount = members.length - activeCount;
  const shown = view === 'active' ? members.filter((m) => m.is_active) : members;
  const hasWorkers = members.some((m) => m.role !== 'supervisor');

  return (
    <div className="relative">
      {/* Заголовок */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Команда</h1>
          <p className="text-text-muted text-sm">{activeCount} активных, {inactiveCount} неактивных</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="shrink-0 rounded-2xl px-4 py-2.5 bg-accent text-bg-2 font-semibold hover:bg-accent-2">
          + Добавить
        </button>
      </div>

      {/* Уведомление о новом работнике (креды в открытом виде) */}
      {notice && (
        <div className="mb-4 bg-accent-dim border border-accent/40 rounded-2xl p-4">
          <p className="text-sm text-text-2 mb-2">Работник добавлен. Передайте ему креды — больше пароль не показывается:</p>
          <div className="font-mono text-sm bg-bg-3 rounded-xl px-3 py-2 mb-3 break-all">
            <div>{notice.email}</div>
            <div className="text-accent">{notice.password}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={copyCreds} className="rounded-xl px-3 py-2 bg-accent text-bg-2 text-sm font-semibold">Скопировать креды</button>
            <button onClick={() => setNotice(null)} className="rounded-xl px-3 py-2 bg-bg-3 text-text-muted text-sm">Закрыть</button>
          </div>
        </div>
      )}

      {/* Переключатель Активные/Все */}
      <div className="grid grid-cols-2 gap-1 bg-bg-2 border border-border rounded-2xl p-1 mb-4">
        {(['active', 'all'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-xl py-2 text-sm font-semibold ${view === v ? 'bg-accent text-bg-2' : 'text-text-muted'}`}>
            {v === 'active' ? 'Активные' : 'Все'}
          </button>
        ))}
      </div>

      {/* Ошибка */}
      {error && (
        <div className="bg-bg-2 border border-danger/40 rounded-2xl p-4 text-center">
          <p className="text-danger text-sm mb-3">Не удалось загрузить: {error}</p>
          <button onClick={load} className="rounded-xl px-4 py-2 bg-bg-3 text-text text-sm">Повторить</button>
        </div>
      )}

      {/* Скелетоны */}
      {loading && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-bg-2 border border-border rounded-2xl p-4 space-y-3">
              <div className="h-5 w-1/2 bg-bg-3 animate-pulse rounded-lg" />
              <div className="h-4 w-2/3 bg-bg-3 animate-pulse rounded-lg" />
              <div className="h-4 w-1/3 bg-bg-3 animate-pulse rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Список */}
      {!loading && !error && (
        <div className="space-y-3">
          {shown.map((m) => (
            <MemberCard key={m.user_id} m={m} isSelf={m.user_id === user?.id}
              stat={stats[m.worker_id]} onOpen={() => navigate(`/team/${m.user_id}`)} />
          ))}
          {!hasWorkers && (
            <div className="bg-bg-2 border border-border rounded-2xl p-6 text-center">
              <p className="text-text-muted text-sm">Пока в команде только вы. Нажмите «+ Добавить», чтобы пригласить кого-то.</p>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onCreated={(creds) => { setShowAdd(false); setNotice(creds); load(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-accent text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );
}

function MemberCard({ m, isSelf, stat, onOpen }: {
  m: TeamMember; isSelf: boolean; stat?: MonthStat; onOpen: () => void;
}) {
  const boss = m.role === 'supervisor';
  return (
    <button onClick={onOpen}
      className={`w-full text-left bg-bg-2 border border-border rounded-2xl p-4 hover:border-border-2 ${m.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          {m.full_name}{isSelf && <span className="text-text-muted font-normal"> (Я)</span>}
        </h3>
        {boss && <span className="shrink-0 text-accent text-xs font-semibold">★ Босс</span>}
      </div>
      <p className="text-text-muted text-sm truncate mt-0.5">{m.email}</p>
      {m.is_active ? (
        <>
          <p className="text-sm mt-2">Ставка: <span className="font-medium">${m.hourly_rate}/час</span></p>
          <p className="text-text-3 text-sm mt-0.5">
            Этот месяц: {stat ? `${fmtHours(stat.hours)} · ${fmtMoney(stat.earned)}` : '…'}
          </p>
        </>
      ) : (
        <p className="text-warning text-sm mt-2">Неактивен</p>
      )}
      <span className="inline-block mt-3 text-accent text-sm font-medium">Открыть →</span>
    </button>
  );
}
