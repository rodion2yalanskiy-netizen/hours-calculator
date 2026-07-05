// Недельные хелперы (Пн–Вс) для экрана Выплат. Чистые функции, локальное время.
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string): Date => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date): Date => addDays(d, -(((d.getDay() + 6) % 7)));

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export interface WeekRef { week_start: string; week_end: string; is_current: boolean }

/** Понедельник текущей недели (ISO). */
export function getCurrentWeekStart(): string {
  return isoOf(mondayOf(new Date()));
}

/** Все недели (Пн), пересекающие месяц: от понедельника недели, содержащей 1-е число,
 *  до недели, чей понедельник ≤ последнего дня месяца. */
export function getWeeksInMonth(year: number, month: number): WeekRef[] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const curWs = getCurrentWeekStart();
  const out: WeekRef[] = [];
  let ws = mondayOf(first);
  while (ws.getTime() <= last.getTime()) {
    const wsIso = isoOf(ws);
    out.push({ week_start: wsIso, week_end: isoOf(addDays(ws, 6)), is_current: wsIso === curWs });
    ws = addDays(ws, 7);
  }
  return out;
}

/** "2026-07-08","2026-07-14" → "8–14 июля" (или межмесячно "29 июня – 5 июля"). */
export function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const ws = parseISO(weekStart);
  const we = parseISO(weekEnd);
  if (ws.getMonth() === we.getMonth()) {
    return `${ws.getDate()}–${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
  }
  return `${ws.getDate()} ${MONTHS_GEN[ws.getMonth()]} – ${we.getDate()} ${MONTHS_GEN[we.getMonth()]}`;
}

/** Неделя уже полностью прошла (её воскресенье раньше сегодня) — есть смысл ждать выплату. */
export function isPastWeek(weekEnd: string): boolean {
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parseISO(weekEnd).getTime() < todayMid.getTime();
}
