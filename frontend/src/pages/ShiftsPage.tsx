import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  getShifts, previewShift, createShift,
  type Shift, type PreviewResult, type RoundResult,
} from '../api';
import { hhmmToMinutes, fmtMoney, fmtHours, fmtCardDate, fmtRangeAmPm } from '../format';
import { haptic } from '../haptic';
import { IconLock, IconMapPin, IconCopy, IconChevL, IconChevR } from '../components/icons';

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ── Даты ──────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekStart = (d: Date) => addDays(d, -(((d.getDay() + 6) % 7)));
const weekEnd = (d: Date) => addDays(weekStart(d), 6);
const weekNumOf = (d: Date) => Math.floor((weekStart(d).getDate() - 1) / 7) + 1;
const todayISO = () => isoOf(new Date());

function weekRangeLabel(ws: Date, we: Date): string {
  if (ws.getMonth() === we.getMonth()) return `${ws.getDate()}–${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
  return `${ws.getDate()} ${MONTHS_GEN[ws.getMonth()]} – ${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
  } catch { /* фолбэк ниже */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch { /* no-op */ }
  document.body.removeChild(ta);
}

// ── Тексты копирования (формат зафиксирован — НЕ менять) ─────────────────────────
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

type Mode = 'month' | 'week';

async function loadPeriodShifts(mode: Mode, cursor: Date, workerId?: number): Promise<Shift[]> {
  if (mode === 'month') {
    const list = await getShifts(cursor.getFullYear(), cursor.getMonth() + 1, workerId);
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }
  const ws = weekStart(cursor); const we = weekEnd(cursor);
  const keys = new Set([`${ws.getFullYear()}-${ws.getMonth() + 1}`, `${we.getFullYear()}-${we.getMonth() + 1}`]);
  const arrays = await Promise.all([...keys].map((k) => {
    const [y, m] = k.split('-').map(Number);
    return getShifts(y, m, workerId);
  }));
  const lo = isoOf(ws); const hi = isoOf(we);
  return arrays.flat().filter((s) => s.date >= lo && s.date <= hi).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Выбор расчёта ─────────────────────────────────────────────────────────────
function activeRound(p: PreviewResult | null, lunch: 'with' | 'without' | null): RoundResult | null {
  if (!p) return null;
  if (p.needs_lunch_choice) { if (!lunch) return null; return lunch === 'with' ? p.with_lunch : p.without_lunch; }
  return p.round;
}
function branchHoursLabel(r: RoundResult): string {
  return r.needs_round_choice ? `${fmtHours(r.hours_down)}–${fmtHours(r.hours_up)}` : fmtHours(r.hours);
}

export default function ShiftsPage() {
  const { user } = useAuth();
  const workerId = user?.worker_id ?? undefined;
  const rate = user?.hourly_rate ?? 0;

  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const cursorTs = cursor.getTime();
  useEffect(() => {
    let cancelled = false;
    loadPeriodShifts(mode, cursor, workerId)
      .then((s) => { if (!cancelled) setShifts(s); })
      .catch(() => { if (!cancelled) setShifts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cursorTs, workerId]);

  const reloadShifts = () => { loadPeriodShifts(mode, cursor, workerId).then(setShifts).catch(() => {}); };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1500);
  };
  const doCopy = async (text: string) => { await copyText(text); haptic('light'); showToast('Скопировано'); };

  const ws = weekStart(cursor); const we = weekEnd(cursor);
  const periodLabel = mode === 'month'
    ? `${MONTHS_NOM[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `Неделя ${weekNumOf(cursor)} · ${weekRangeLabel(ws, we)}`;
  const canForward = mode === 'month'
    ? (cursor.getFullYear() < today.getFullYear() || (cursor.getFullYear() === today.getFullYear() && cursor.getMonth() < today.getMonth()))
    : weekStart(cursor).getTime() < weekStart(today).getTime();

  const goPrev = () => setCursor((c) => mode === 'month' ? new Date(c.getFullYear(), c.getMonth() - 1, 1) : addDays(c, -7));
  const goNext = () => { if (canForward) setCursor((c) => mode === 'month' ? new Date(c.getFullYear(), c.getMonth() + 1, 1) : addDays(c, 7)); };
  const switchMode = (m: Mode) => { setMode(m); setCursor(new Date()); };

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
    if (!showForm) return;
    const sm = hhmmToMinutes(fStart); const em = hhmmToMinutes(fEnd);
    setPreview(null); setPreviewErr(null);
    if (Number.isNaN(sm) || Number.isNaN(em)) return;
    let cancelled = false;
    previewShift(sm, em)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e: unknown) => { if (!cancelled) setPreviewErr(e instanceof Error ? e.message : 'Ошибка'); });
    return () => { cancelled = true; };
  }, [fStart, fEnd, showForm]);

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

  const canSave = !!final && fObject.trim().length > 0 && workerId != null && !saving;

  const save = async () => {
    if (!final || workerId == null) return;
    setSaving(true);
    try {
      await createShift({
        worker_id: workerId, date: fDate, object_name: fObject.trim(),
        start_min: hhmmToMinutes(fStart), end_min: hhmmToMinutes(fEnd),
        hours: final.hours, lunch_deducted: final.lunch_deducted,
      });
      haptic('success');
      setShowForm(false);
      reloadShifts();
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const listView = mode === 'month' ? [...shifts].reverse() : shifts;

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-4">Мои смены</h1>

      {/* Переключатель Месяц/Неделя */}
      <div className="grid grid-cols-2 gap-1 bg-bg-2 border border-border rounded-2xl p-1 mb-3">
        {(['month', 'week'] as Mode[]).map((m) => (
          <button key={m} onClick={() => switchMode(m)}
            className={`rounded-xl py-2 text-sm font-semibold ${mode === m ? 'bg-accent text-bg-2' : 'text-text-muted'}`}>
            {m === 'month' ? 'Месяц' : 'Неделя'}
          </button>
        ))}
      </div>

      {/* Навигатор периода */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={goPrev} className="w-9 h-9 rounded-full bg-bg-2 border border-border text-text-muted flex items-center justify-center">
          <IconChevL className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium text-center">{periodLabel}</span>
        <button onClick={goNext} disabled={!canForward}
          className={`w-9 h-9 rounded-full border border-border flex items-center justify-center ${canForward ? 'bg-bg-2 text-text-muted' : 'bg-bg-2/40 text-border-2'}`}>
          <IconChevR className="w-5 h-5" />
        </button>
      </div>

      {/* Плитки */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-bg-2 border border-border rounded-2xl p-4">
          <p className="text-text-muted text-xs mb-1">{mode === 'month' ? 'Часы за месяц' : 'Часы за неделю'}</p>
          <p className="text-2xl font-bold">{fmtHours(hoursSum)}</p>
        </div>
        <div className="bg-accent-dim rounded-2xl p-4">
          <p className="text-text-2 text-xs mb-1 flex items-center gap-1"><IconLock className="w-3.5 h-3.5" /> Заработок</p>
          <p className="text-2xl font-bold text-accent">{fmtMoney(earnSum)}</p>
        </div>
      </div>

      {/* Кнопка / форма */}
      {!showForm ? (
        <button onClick={openForm} className="w-full bg-accent text-bg-2 font-semibold rounded-2xl py-4 mb-6 text-lg hover:bg-accent-2">
          + Записать смену
        </button>
      ) : (
        renderForm()
      )}

      {/* Список */}
      {listView.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-8">Смен за этот период пока нет.</p>
      ) : (
        <div className="space-y-3">
          {listView.map((s, i) => <ShiftCard key={i} s={s} onCopy={() => doCopy(shiftDayText(s))} />)}
        </div>
      )}

      {/* Копировать неделю */}
      {mode === 'week' && shifts.length > 0 && (
        <button onClick={() => doCopy(weekText(weekNumOf(cursor), weekRangeLabel(ws, we), shifts))}
          className="w-full mt-5 bg-accent text-bg-2 font-semibold rounded-2xl py-3.5 flex items-center justify-center gap-2 hover:bg-accent-2">
          <IconCopy className="w-5 h-5" /> Скопировать неделю
        </button>
      )}

      {/* Тост */}
      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-accent text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );

  // ── Форма записи смены (функция, не компонент — чтобы input не терял фокус) ──
  function renderForm() {
    return (
      <div className="bg-bg-2 border border-border rounded-2xl p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Новая смена</h2>
          <button onClick={() => setShowForm(false)} className="text-text-muted text-sm">Отмена</button>
        </div>

        <label className="block">
          <span className="text-text-3 text-xs">Дата</span>
          <div className="mt-1 font-medium">{fmtCardDate(fDate)}</div>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
            className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-3 py-3 outline-none focus:border-accent" />
        </label>

        <label className="block">
          <span className="text-text-3 text-xs">Объект</span>
          <input type="text" value={fObject} onChange={(e) => setFObject(e.target.value)} placeholder="Адрес / название" inputMode="text"
            className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-3 py-3 outline-none focus:border-accent placeholder:text-text-muted" />
        </label>

        <div>
          <span className="text-text-3 text-xs">Время</span>
          <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input type="time" value={fStart} onChange={(e) => setFStart(e.target.value)}
              className="bg-bg-3 border border-border-2 rounded-xl px-3 py-3 outline-none focus:border-accent" />
            <span className="text-text-muted">—</span>
            <input type="time" value={fEnd} onChange={(e) => setFEnd(e.target.value)}
              className="bg-bg-3 border border-border-2 rounded-xl px-3 py-3 outline-none focus:border-accent" />
          </div>
        </div>

        {previewErr && <p className="text-danger text-sm">{previewErr}</p>}

        {preview?.needs_lunch_choice && (
          <div>
            <p className="text-text-muted text-xs mb-2">Вычитать обед?</p>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceBtn selected={lunchChoice === 'without'} onClick={() => setLunchChoice('without')} title="Нет, чистые" sub={branchHoursLabel(preview.without_lunch)} />
              <ChoiceBtn selected={lunchChoice === 'with'} onClick={() => setLunchChoice('with')} title="Да, −30 мин" sub={branchHoursLabel(preview.with_lunch)} />
            </div>
          </div>
        )}

        {preview && !preview.needs_lunch_choice && preview.lunch_deducted && (
          <div className="bg-accent-dim text-accent rounded-xl px-3 py-2 text-sm">Обед вычтен −30 мин</div>
        )}

        {(() => {
          const r = activeRound(preview, lunchChoice);
          if (!r || !r.needs_round_choice) return null;
          return (
            <div>
              <p className="text-text-muted text-xs mb-2">Округление</p>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceBtn selected={roundChoice === 'down'} onClick={() => setRoundChoice('down')} title="Вниз" sub={fmtHours(r.hours_down)} />
                <ChoiceBtn selected={roundChoice === 'up'} onClick={() => setRoundChoice('up')} title="Вверх" sub={fmtHours(r.hours_up)} />
              </div>
            </div>
          );
        })()}

        {final && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-text-muted">Итого</span>
            <span className="text-right">
              <span className="font-bold text-lg">{fmtHours(final.hours)}</span>
              <span className="text-accent ml-2 font-semibold">{fmtMoney(final.hours * rate)}</span>
            </span>
          </div>
        )}

        <button onClick={save} disabled={!canSave}
          className={`w-full font-semibold rounded-2xl py-4 text-lg ${canSave ? 'bg-accent text-bg-2 hover:bg-accent-2' : 'bg-bg-3 text-text-muted'}`}>
          {saving ? 'Сохранение…' : 'Сохранить смену'}
        </button>
      </div>
    );
  }
}

// ── Карточка смены ──────────────────────────────────────────────────────────────
function ShiftCard({ s, onCopy }: { s: Shift; onCopy: () => void }) {
  return (
    <div className="bg-bg-2 border border-border rounded-2xl p-4 flex items-start justify-between">
      <div className="min-w-0">
        <div className="font-medium">{fmtCardDate(s.date)}</div>
        <div className="flex items-center gap-1 mt-1 text-text-muted text-sm truncate">
          <IconMapPin className="w-4 h-4 text-text-muted shrink-0" />
          <span className="truncate">{s.object_name}</span>
        </div>
        {s.start_min != null && s.end_min != null && (
          <div className="text-text-3 text-sm mt-1">{fmtRangeAmPm(s.start_min, s.end_min)}</div>
        )}
      </div>
      <div className="text-right shrink-0 pl-3 flex flex-col items-end">
        <div className="font-semibold">{fmtHours(s.calculated_hours)}</div>
        {s.money != null && <div className="text-accent text-sm">{fmtMoney(s.money)}</div>}
        <button onClick={onCopy} className="mt-2 text-text-muted hover:text-text" aria-label="Скопировать">
          <IconCopy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ChoiceBtn({ selected, onClick, title, sub }: { selected: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} className={`rounded-xl px-3 py-3 text-left ${selected ? 'bg-accent text-bg-2' : 'bg-bg-3 text-text'}`}>
      <div className="font-semibold text-sm">{title}</div>
      <div className={`text-xs ${selected ? 'text-bg-2/80' : 'text-text-muted'}`}>{sub}</div>
    </button>
  );
}
