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
import { hhmmToMinutes, fmtMoney, fmtHours } from './format';

// ── Русские названия ──────────────────────────────────────────────────────────
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAY_SHORT: Record<string, string> = {
  'Понедельник': 'Пн', 'Вторник': 'Вт', 'Среда': 'Ср', 'Четверг': 'Чт',
  'Пятница': 'Пт', 'Суббота': 'Сб', 'Воскресенье': 'Вс',
};

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-06-18" + "Четверг" → "Чт, 18 июня". */
function cardDate(dateISO: string, dayOfWeek: string): string {
  const day = parseInt(dateISO.slice(8, 10), 10);
  const monIdx = parseInt(dateISO.slice(5, 7), 10) - 1;
  const short = DAY_SHORT[dayOfWeek] ?? dayOfWeek;
  return `${short}, ${day} ${MONTHS_GEN[monIdx] ?? ''}`;
}

function fireSuccessHaptic(tg: TgWebApp | null): void {
  const h = (tg as unknown as {
    HapticFeedback?: { notificationOccurred?: (t: string) => void };
  } | null)?.HapticFeedback;
  h?.notificationOccurred?.('success');
}

// ── Inline SVG-иконки (без зависимостей; Tabler-стиль, stroke=currentColor) ────
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

// ── Вспомогательное по расчёту выбора ──────────────────────────────────────────
function activeRound(p: PreviewResult | null, lunch: 'with' | 'without' | null): RoundResult | null {
  if (!p) return null;
  if (p.needs_lunch_choice) {
    if (!lunch) return null;
    return lunch === 'with' ? p.with_lunch : p.without_lunch;
  }
  return p.round;
}

/** Краткий ярлык часов варианта обеда для кнопки. */
function branchHoursLabel(r: RoundResult): string {
  return r.needs_round_choice
    ? `${fmtHours(r.hours_down)}–${fmtHours(r.hours_up)}`
    : fmtHours(r.hours);
}

type Tab = 'shifts' | 'expenses' | 'mileage' | 'report';

export default function App() {
  const [tg, setTg] = useState<TgWebApp | null>(null);
  const [initData, setInitData] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [tab, setTab] = useState<Tab>('shifts');

  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const owner = useMemo(() => workers.find((w) => w.is_owner) ?? null, [workers]);

  // ── Загрузка при старте ──
  useEffect(() => {
    const app = getWebApp();
    if (!app) {
      setError('Открой приложение из Telegram.');
      setLoading(false);
      return;
    }
    app.ready();
    app.expand();
    setTg(app);
    const id = app.initData;
    if (!id) {
      setError('Нет доступа (нет initData).');
      setLoading(false);
      return;
    }
    setInitData(id);
    Promise.all([listWorkers(id), listShifts(id, year, month)])
      .then(([ws, sh]) => {
        setWorkers(ws);
        setShifts(sh);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
        setLoading(false);
      });
  }, [year, month]);

  const reloadShifts = () => {
    if (!initData) return;
    listShifts(initData, year, month).then(setShifts).catch(() => {});
  };

  // ── Итоги месяца ──
  const hoursMonth = shifts.reduce((a, s) => a + (s.calculated_hours || 0), 0);
  const earnMonth = shifts.reduce((a, s) => a + (s.money ?? 0), 0);

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
    setFDate(todayISO());
    setFObject('');
    setFStart('');
    setFEnd('');
    setPreview(null);
    setPreviewErr(null);
    setLunchChoice(null);
    setRoundChoice(null);
    setShowForm(true);
  };

  // Пересчёт превью при изменении времени.
  useEffect(() => {
    if (!showForm || !initData) return;
    const sm = hhmmToMinutes(fStart);
    const em = hhmmToMinutes(fEnd);
    setPreview(null);
    setPreviewErr(null);
    if (Number.isNaN(sm) || Number.isNaN(em)) return;
    let cancelled = false;
    previewShift(initData, sm, em)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e: unknown) => { if (!cancelled) setPreviewErr(e instanceof Error ? e.message : 'Ошибка'); });
    return () => { cancelled = true; };
  }, [fStart, fEnd, showForm, initData]);

  // Дефолт «рекомендуемого»: обед — «Да −30» (with), округление — «Вверх» (up).
  useEffect(() => {
    setLunchChoice(preview?.needs_lunch_choice ? 'with' : null);
  }, [preview]);
  useEffect(() => {
    const r = activeRound(preview, lunchChoice);
    setRoundChoice(r?.needs_round_choice ? 'up' : null);
  }, [preview, lunchChoice]);

  // Финальные часы + был ли вычтен обед.
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
      fireSuccessHaptic(tg);
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

  const sortedShifts = [...shifts].reverse(); // новые сверху

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-28">
        {tab === 'shifts' ? (
          <>
            {/* Шапка */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-2xl font-bold leading-tight">Смены</h1>
                <p className="text-muted text-sm">{MONTHS_NOM[month - 1]} {year}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-accent text-accentInk flex items-center justify-center font-bold">
                {(owner?.name ?? '?').slice(0, 1)}
              </div>
            </div>

            {/* Две плитки */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-surface2 rounded-2xl p-4">
                <p className="text-muted text-xs mb-1">Часы за месяц</p>
                <p className="text-2xl font-bold">{fmtHours(hoursMonth)}</p>
              </div>
              <div className="bg-accentDim rounded-2xl p-4">
                <p className="text-muted text-xs mb-1 flex items-center gap-1">
                  <IconLock className="w-3.5 h-3.5" /> Заработок
                </p>
                <p className="text-2xl font-bold text-accent">{fmtMoney(earnMonth)}</p>
              </div>
            </div>

            {/* Кнопка / форма */}
            {!showForm ? (
              <button
                onClick={openForm}
                className="w-full bg-accent text-accentInk font-semibold rounded-2xl py-4 mb-6 text-lg"
              >
                + Записать смену
              </button>
            ) : (
              ShiftForm()
            )}

            {/* Список смен */}
            {sortedShifts.length === 0 ? (
              <p className="text-faint text-sm text-center py-8">Смен за этот месяц пока нет.</p>
            ) : (
              <div className="space-y-3">
                {sortedShifts.map((s, i) => (
                  <div key={i} className="bg-surface rounded-2xl p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm text-muted">{cardDate(s.date, s.day_of_week)}</div>
                      <div className="flex items-center gap-1 mt-1 font-medium truncate">
                        <IconMapPin className="w-4 h-4 text-faint shrink-0" />
                        <span className="truncate">{s.object_name}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-3">
                      <div className="font-semibold">{fmtHours(s.calculated_hours)}</div>
                      {s.count_money && s.money != null && (
                        <div className="text-accent text-sm">{fmtMoney(s.money)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-24 text-faint">
            <p className="text-lg font-semibold text-muted mb-1">Скоро</p>
            <p className="text-sm">Этот раздел появится позже.</p>
          </div>
        )}
      </div>

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

  // ── Подкомпонент: форма записи смены ──
  function ShiftForm() {
    return (
      <div className="bg-surface rounded-2xl p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Новая смена</h2>
          <button onClick={() => setShowForm(false)} className="text-muted text-sm">Отмена</button>
        </div>

        <label className="block">
          <span className="text-muted text-xs">Дата</span>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
            className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
        </label>

        <label className="block">
          <span className="text-muted text-xs">Объект</span>
          <input type="text" value={fObject} onChange={(e) => setFObject(e.target.value)}
            placeholder="Адрес / название" inputMode="text"
            className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none placeholder:text-faint" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-muted text-xs">Начало</span>
            <input type="time" value={fStart} onChange={(e) => setFStart(e.target.value)}
              className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
          </label>
          <label className="block">
            <span className="text-muted text-xs">Конец</span>
            <input type="time" value={fEnd} onChange={(e) => setFEnd(e.target.value)}
              className="mt-1 w-full bg-surface2 rounded-xl px-3 py-3 text-white outline-none" />
          </label>
        </div>

        {previewErr && <p className="text-red-400 text-sm">{previewErr}</p>}

        {/* Выбор обеда */}
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

        {/* Зелёная плашка обеда, когда выбора нет, но обед вычтен */}
        {preview && !preview.needs_lunch_choice && preview.lunch_deducted && (
          <div className="bg-okfill text-okline rounded-xl px-3 py-2 text-sm">Обед вычтен −30 мин</div>
        )}

        {/* Выбор округления (для активного варианта) */}
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

        {/* Итого */}
        {final && (
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <span className="text-muted">Итого</span>
            <span className="text-right">
              <span className="font-bold text-lg">{fmtHours(final.hours)}</span>
              {ownerMoney && (
                <span className="text-accent ml-2 font-semibold">{fmtMoney(final.hours * 25)}</span>
              )}
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

// ── Мелкие подкомпоненты ────────────────────────────────────────────────────────
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
