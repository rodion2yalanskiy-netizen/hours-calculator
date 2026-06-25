import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getWebApp, type TgWebApp } from './telegram';
import {
  listWorkers,
  listShifts,
  previewShift,
  createShift,
  type Worker,
  type Shift,
  type PreviewResult,
  type RoundResult,
} from './api';
import { hhmmToMinutes, fmtMoney, fmtHours, fmtCardDate, fmtRangeAmPm } from './format';

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ── Даты ──────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Понедельник недели, содержащей date. */
const weekStart = (d: Date) => addDays(d, -(((d.getDay() + 6) % 7)));
const weekEnd = (d: Date) => addDays(weekStart(d), 6);
/** Номер недели в рамках месяца её понедельника (счётчик понедельников). */
const weekNumOf = (d: Date) => Math.floor((weekStart(d).getDate() - 1) / 7) + 1;

function weekRangeLabel(ws: Date, we: Date): string {
  if (ws.getMonth() === we.getMonth()) {
    return `${ws.getDate()}–${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
  }
  return `${ws.getDate()} ${MONTHS_GEN[ws.getMonth()]} – ${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
}

function todayISO(): string {
  return isoOf(new Date());
}

function fireHaptic(tg: TgWebApp | null, kind: 'success' | 'impact'): void {
  const h = (tg as unknown as {
    HapticFeedback?: {
      notificationOccurred?: (t: string) => void;
      impactOccurred?: (t: string) => void;
    };
  } | null)?.HapticFeedback;
  if (kind === 'success') h?.notificationOccurred?.('success');
  else h?.impactOccurred?.('light');
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* фолбэк ниже */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch { /* no-op */ }
  document.body.removeChild(ta);
}

// ── Тексты копирования ──────────────────────────────────────────────────────────
function shiftDayText(s: Shift): string {
  const lines = [fmtCardDate(s.date), s.object_name];
  if (s.start_min != null && s.end_min != null) lines.push(fmtRangeAmPm(s.start_min, s.end_min));
  lines.push(fmtHours(s.calculated_hours));
  return lines.join('\n');
}

function weekText(weekN: number, range: string, shifts: Shift[]): string {
  const header = `Неделя ${weekN} (${range})`;
  const body = shifts.map(shiftDayText).join('\n\n');
  const total = shifts.reduce((a, s) => a + (s.calculated_hours || 0), 0);
  return `${header}\n\n${body}\n\nИтого за неделю: ${fmtHours(total)}`;
}

// ── Загрузка смен под режим ───────────────────────────────────────────────────
async function loadPeriodShifts(initData: string, mode: Mode, cursor: Date): Promise<Shift[]> {
  if (mode === 'month') {
    const list = await listShifts(initData, cursor.getFullYear(), cursor.getMonth() + 1);
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }
  const ws = weekStart(cursor);
  const we = weekEnd(cursor);
  // Неделя может пересекать границу месяца → грузим оба месяца.
  const keys = new Set([
    `${ws.getFullYear()}-${ws.getMonth() + 1}`,
    `${we.getFullYear()}-${we.getMonth() + 1}`,
  ]);
  const arrays = await Promise.all([...keys].map((k) => {
    const [y, m] = k.split('-').map(Number);
    return listShifts(initData, y, m);
  }));
  const lo = isoOf(ws);
  const hi = isoOf(we);
  return arrays.flat()
    .filter((s) => s.date >= lo && s.date <= hi)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Иконки (inline SVG, Tabler-стиль) ──────────────────────────────────────────
type IconProps = { className?: string };
const baseIcon = (className?: string) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, className,
});
const IconLock = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
const IconMapPin = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
);
const IconClock = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const IconReceipt = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M9 8h6M9 12h6" /></svg>
);
const IconRoad = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M4 20 8 4M20 20 16 4M12 6v2M12 11v2M12 16v2" /></svg>
);
const IconFileText = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);
const IconCopy = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
const IconChevL = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M15 6l-6 6 6 6" /></svg>
);
const IconChevR = ({ className }: IconProps) => (
  <svg {...baseIcon(className)}><path d="M9 6l6 6-6 6" /></svg>
);

// ── Выбор расчёта ─────────────────────────────────────────────────────────────
function activeRound(p: PreviewResult | null, lunch: 'with' | 'without' | null): RoundResult | null {
  if (!p) return null;
  if (p.needs_lunch_choice) {
    if (!lunch) return null;
    return lunch === 'with' ? p.with_lunch : p.without_lunch;
  }
  return p.round;
}
function branchHoursLabel(r: RoundResult): string {
  return r.needs_round_choice
    ? `${fmtHours(r.hours_down)}–${fmtHours(r.hours_up)}`
    : fmtHours(r.hours);
}

type Tab = 'shifts' | 'expenses' | 'mileage' | 'report';
type Mode = 'month' | 'week';

export default function App() {
  const [tg, setTg] = useState<TgWebApp | null>(null);
  const [initData, setInitData] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [tab, setTab] = useState<Tab>('shifts');
  const [toast, setToast] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const owner = useMemo(() => workers.find((w) => w.is_owner) ?? null, [workers]);

  // ── Старт: подпись + бригада ──
  useEffect(() => {
    const app = getWebApp();
    if (!app) { setError('Открой приложение из Telegram.'); setLoading(false); return; }
    app.ready();
    app.expand();
    setTg(app);
    const id = app.initData;
    if (!id) { setError('Нет доступа (нет initData).'); setLoading(false); return; }
    setInitData(id);
    listWorkers(id)
      .then((ws) => { setWorkers(ws); setLoading(false); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Ошибка загрузки'); setLoading(false); });
  }, []);

  // ── Загрузка смен под режим/период ──
  const cursorTs = cursor.getTime();
  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    loadPeriodShifts(initData, mode, cursor)
      .then((s) => { if (!cancelled) setShifts(s); })
      .catch(() => { if (!cancelled) setShifts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData, mode, cursorTs]);

  const reloadShifts = () => {
    if (!initData) return;
    loadPeriodShifts(initData, mode, cursor).then(setShifts).catch(() => {});
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1500);
  };
  const doCopy = async (text: string) => {
    await copyText(text);
    fireHaptic(tg, 'impact');
    showToast('Скопировано');
  };

  // ── Навигация периода ──
  const ws = weekStart(cursor);
  const we = weekEnd(cursor);
  const periodLabel = mode === 'month'
    ? `${MONTHS_NOM[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `Неделя ${weekNumOf(cursor)} · ${weekRangeLabel(ws, we)}`;

  const canForward = mode === 'month'
    ? (cursor.getFullYear() < today.getFullYear()
      || (cursor.getFullYear() === today.getFullYear() && cursor.getMonth() < today.getMonth()))
    : weekStart(cursor).getTime() < weekStart(today).getTime();

  const goPrev = () => setCursor((c) => mode === 'month'
    ? new Date(c.getFullYear(), c.getMonth() - 1, 1)
    : addDays(c, -7));
  const goNext = () => {
    if (!canForward) return;
    setCursor((c) => mode === 'month'
      ? new Date(c.getFullYear(), c.getMonth() + 1, 1)
      : addDays(c, 7));
  };
  const switchMode = (m: Mode) => { setMode(m); setCursor(new Date()); };

  // ── Итоги показанного набора ──
  const hoursSum = shifts.reduce((a, s) => a + (s.calculated_hours || 0), 0);
  const earnSum = shifts.reduce((a, s) => a + (s.money ?? 0), 0);

  // ── Форма ──
  const [showForm, setShowForm] = useState(false);
  const [fDate, setFDate] = useState(todayISO());
  const [fObject, setFObject] = useState('');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [lunchChoice, setLunchChoice] = useState<'with' | 'without' | null>(null);
  const [roundChoice, setRoundChoice] = useState<'down' | 'up' | null>(null);
  const [saving, setSaving] = useState(false);

  const openForm = () => {
    setFDate(todayISO()); setFObject(''); setFStart(''); setFEnd('');
    setPreview(null); setPreviewErr(null); setLunchChoice(null); setRoundChoice(null);
    setShowForm(true);
  };

  useEffect(() => {
    if (!showForm || !initData) return;
    const sm = hhmmToMinutes(fStart);
    const em = hhmmToMinutes(fEnd);
    setPreview(null); setPreviewErr(null);
    if (Number.isNaN(sm) || Number.isNaN(em)) return;
    let cancelled = false;
    previewShift(initData, sm, em)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e: unknown) => { if (!cancelled) setPreviewErr(e instanceof Error ? e.message : 'Ошибка'); });
    return () => { cancelled = true; };
  }, [fStart, fEnd, showForm, initData]);

  useEffect(() => { setLunchChoice(preview?.needs_lunch_choice ? 'with' : null); }, [preview]);
  useEffect(() => {
    const r = activeRound(preview, lunchChoice);
    setRoundChoice(r?.needs_round_choice ? 'up' : null);
  }, [preview, lunchChoice]);

  const final = useMemo((): { hours: number; lunch_deducted: boolean } | null => {
    if (!preview) return null;
    const r = activeRound(preview, lunchChoice);
    if (!r) return null;
    let hours: number;
    if (!r.needs_round_choice) hours = r.hours;
    else { if (!roundChoice) return null; hours = roundChoice === 'down' ? r.hours_down : r.hours_up; }
    const lunch_deducted = preview.needs_lunch_choice ? lunchChoice === 'with' : preview.lunch_deducted;
    return { hours, lunch_deducted };
  }, [preview, lunchChoice, roundChoice]);

  const ownerMoney = owner?.count_money ?? false;
  const canSave = !!final && fObject.trim().length > 0 && !!owner && !saving;

  const save = async () => {
    if (!final || !owner) return;
    setSaving(true);
    try {
      await createShift(initData, {
        worker_id: owner.id,
        date: fDate,
        object_name: fObject.trim(),
        start_min: hhmmToMinutes(fStart),
        end_min: hhmmToMinutes(fEnd),
        hours: final.hours,
        lunch_deducted: final.lunch_deducted,
      });
      fireHaptic(tg, 'success');
      setShowForm(false);
      reloadShifts();
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  // ── Рендер ──
  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white flex items-center justify-center">
        <p className="text-muted">Загрузка…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-bg text-white flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-lg font-semibold mb-1">Нет доступа</p>
          <p className="text-muted text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // month: новые сверху; week: по возрастанию (Пн→Вс)
  const listShiftsView = mode === 'month' ? [...shifts].reverse() : shifts;

  return (
    <div className="min-h-screen bg-bg text-white relative">
      <div className="max-w-md mx-auto px-4 pt-6 pb-28">
        {tab === 'shifts' ? (
          <>
            {/* Шапка */}
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold leading-tight">Смены</h1>
              <div className="w-10 h-10 rounded-full bg-accent text-accentInk flex items-center justify-center font-bold">
                {(owner?.name ?? '?').slice(0, 1)}
              </div>
            </div>

            {/* Переключатель Месяц/Неделя */}
            <div className="grid grid-cols-2 gap-1 bg-surface2 rounded-2xl p-1 mb-3">
              {(['month', 'week'] as Mode[]).map((m) => (
                <button key={m} onClick={() => switchMode(m)}
                  className={`rounded-xl py-2 text-sm font-semibold ${mode === m ? 'bg-accent text-accentInk' : 'text-muted'}`}>
                  {m === 'month' ? 'Месяц' : 'Неделя'}
                </button>
              ))}
            </div>

            {/* Навигатор периода */}
            <div className="flex items-center justify-between mb-5">
              <button onClick={goPrev} className="w-9 h-9 rounded-full bg-surface2 text-muted flex items-center justify-center">
                <IconChevL className="w-5 h-5" />
              </button>
              <span className="text-sm font-medium text-center">{periodLabel}</span>
              <button onClick={goNext} disabled={!canForward}
                className={`w-9 h-9 rounded-full flex items-center justify-center ${canForward ? 'bg-surface2 text-muted' : 'bg-surface2/40 text-faint'}`}>
                <IconChevR className="w-5 h-5" />
              </button>
            </div>

            {/* Плитки */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-surface2 rounded-2xl p-4">
                <p className="text-muted text-xs mb-1">{mode === 'month' ? 'Часы за месяц' : 'Часы за неделю'}</p>
                <p className="text-2xl font-bold">{fmtHours(hoursSum)}</p>
              </div>
              <div className="bg-accentDim rounded-2xl p-4">
                <p className="text-muted text-xs mb-1 flex items-center gap-1">
                  <IconLock className="w-3.5 h-3.5" /> Заработок
                </p>
                <p className="text-2xl font-bold text-accent">{fmtMoney(earnSum)}</p>
              </div>
            </div>

            {/* Кнопка / форма */}
            {!showForm ? (
              <button onClick={openForm}
                className="w-full bg-accent text-accentInk font-semibold rounded-2xl py-4 mb-6 text-lg">
                + Записать смену
              </button>
            ) : (
              ShiftForm()
            )}

            {/* Список */}
            {listShiftsView.length === 0 ? (
              <p className="text-faint text-sm text-center py-8">Смен за этот период пока нет.</p>
            ) : (
              <div className="space-y-3">
                {listShiftsView.map((s, i) => (
                  <ShiftCard key={i} s={s} ownerMoney={ownerMoney} onCopy={() => doCopy(shiftDayText(s))} />
                ))}
              </div>
            )}

            {/* Копировать неделю */}
            {mode === 'week' && shifts.length > 0 && (
              <button
                onClick={() => doCopy(weekText(weekNumOf(cursor), weekRangeLabel(ws, we), shifts))}
                className="w-full mt-5 bg-accent text-accentInk font-semibold rounded-2xl py-3.5 flex items-center justify-center gap-2">
                <IconCopy className="w-5 h-5" /> Скопировать неделю
              </button>
            )}
          </>
        ) : (
          <div className="text-center py-24 text-faint">
            <p className="text-lg font-semibold text-muted mb-1">Скоро</p>
            <p className="text-sm">Этот раздел появится позже.</p>
          </div>
        )}
      </div>

      {/* Тост */}
      {toast && (
        <div className="absolute bottom-24 inset-x-0 flex justify-center pointer-events-none">
          <div className="bg-surface text-accent text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-white/5">
            {toast}
          </div>
        </div>
      )}

      {/* Нижняя навигация */}
      <nav className="fixed bottom-0 inset-x-0 bg-surface border-t border-white/5">
        <div className="max-w-md mx-auto grid grid-cols-4">
          <NavBtn label="Смены" active={tab === 'shifts'} onClick={() => setTab('shifts')}><IconClock /></NavBtn>
          <NavBtn label="Расходы" active={tab === 'expenses'} onClick={() => setTab('expenses')}><IconReceipt /></NavBtn>
          <NavBtn label="Пробег" active={tab === 'mileage'} onClick={() => setTab('mileage')}><IconRoad /></NavBtn>
          <NavBtn label="Отчёт" active={tab === 'report'} onClick={() => setTab('report')}><IconFileText /></NavBtn>
        </div>
      </nav>
    </div>
  );

  // ── Форма записи смены ──
  function ShiftForm() {
    return (
      <div className="bg-surface rounded-2xl p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Новая смена</h2>
          <button onClick={() => setShowForm(false)} className="text-muted text-sm">Отмена</button>
        </div>

        <label className="block">
          <span className="text-muted text-xs">Дата</span>
          <div className="mt-1 font-medium">{fmtCardDate(fDate)}</div>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
            className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
        </label>

        <label className="block">
          <span className="text-muted text-xs">Объект</span>
          <input type="text" value={fObject} onChange={(e) => setFObject(e.target.value)}
            placeholder="Адрес / название" inputMode="text"
            className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none placeholder:text-faint" />
        </label>

        <div>
          <span className="text-muted text-xs">Время</span>
          <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input type="time" value={fStart} onChange={(e) => setFStart(e.target.value)}
              className="bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
            <span className="text-muted">—</span>
            <input type="time" value={fEnd} onChange={(e) => setFEnd(e.target.value)}
              className="bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
          </div>
        </div>

        {previewErr && <p className="text-red-400 text-sm">{previewErr}</p>}

        {preview?.needs_lunch_choice && (
          <div>
            <p className="text-muted text-xs mb-2">Вычитать обед?</p>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceBtn selected={lunchChoice === 'without'} onClick={() => setLunchChoice('without')}
                title="Нет, чистые" sub={branchHoursLabel(preview.without_lunch)} />
              <ChoiceBtn selected={lunchChoice === 'with'} onClick={() => setLunchChoice('with')}
                title="Да, −30 мин" sub={branchHoursLabel(preview.with_lunch)} />
            </div>
          </div>
        )}

        {preview && !preview.needs_lunch_choice && preview.lunch_deducted && (
          <div className="bg-okfill text-okline rounded-xl px-3 py-2 text-sm">Обед вычтен −30 мин</div>
        )}

        {(() => {
          const r = activeRound(preview, lunchChoice);
          if (!r || !r.needs_round_choice) return null;
          return (
            <div>
              <p className="text-muted text-xs mb-2">Округление</p>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceBtn selected={roundChoice === 'down'} onClick={() => setRoundChoice('down')}
                  title="Вниз" sub={fmtHours(r.hours_down)} />
                <ChoiceBtn selected={roundChoice === 'up'} onClick={() => setRoundChoice('up')}
                  title="Вверх" sub={fmtHours(r.hours_up)} />
              </div>
            </div>
          );
        })()}

        {final && (
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <span className="text-muted">Итого</span>
            <span className="text-right">
              <span className="font-bold text-lg">{fmtHours(final.hours)}</span>
              {ownerMoney && <span className="text-accent ml-2 font-semibold">{fmtMoney(final.hours * 25)}</span>}
            </span>
          </div>
        )}

        <button onClick={save} disabled={!canSave}
          className={`w-full font-semibold rounded-2xl py-4 text-lg ${canSave ? 'bg-accent text-accentInk' : 'bg-surface2 text-faint'}`}>
          {saving ? 'Сохранение…' : 'Сохранить смену'}
        </button>
      </div>
    );
  }
}

// ── Карточка смены ──────────────────────────────────────────────────────────────
function ShiftCard({ s, ownerMoney, onCopy }: { s: Shift; ownerMoney: boolean; onCopy: () => void }) {
  const showMoney = ownerMoney && s.count_money && s.money != null;
  return (
    <div className="bg-surface rounded-2xl p-4 flex items-start justify-between">
      <div className="min-w-0">
        <div className="font-medium">{fmtCardDate(s.date)}</div>
        <div className="flex items-center gap-1 mt-1 text-muted text-sm truncate">
          <IconMapPin className="w-4 h-4 text-faint shrink-0" />
          <span className="truncate">{s.object_name}</span>
        </div>
        {s.start_min != null && s.end_min != null && (
          <div className="text-accent/70 text-sm mt-1">{fmtRangeAmPm(s.start_min, s.end_min)}</div>
        )}
      </div>
      <div className="text-right shrink-0 pl-3 flex flex-col items-end">
        <div className="font-semibold">{fmtHours(s.calculated_hours)}</div>
        {showMoney && <div className="text-accent text-sm">{fmtMoney(s.money as number)}</div>}
        <button onClick={onCopy} className="mt-2 text-faint hover:text-muted" aria-label="Скопировать">
          <IconCopy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ChoiceBtn({ selected, onClick, title, sub }: {
  selected: boolean; onClick: () => void; title: string; sub: string;
}) {
  return (
    <button onClick={onClick}
      className={`rounded-xl px-3 py-3 text-left ${selected ? 'bg-accent text-accentInk' : 'bg-surface2 text-white'}`}>
      <div className="font-semibold text-sm">{title}</div>
      <div className={`text-xs ${selected ? 'text-accentInk/80' : 'text-muted'}`}>{sub}</div>
    </button>
  );
}

function NavBtn({ active, onClick, label, children }: {
  active: boolean; onClick: () => void; label: string; children: ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center gap-1 py-2.5 ${active ? 'text-accent' : 'text-faint'}`}>
      {children}
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
