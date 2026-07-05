// Хелперы форматирования времени и денег. Чистые функции, без зависимостей.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "13:30" → 810 (минуты от полуночи). Пустая/битая строка → NaN. */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** 810 → "1:30 PM". 0 → "12:00 AM", 720 → "12:00 PM". */
export function minutesToAmPm(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const mins = min % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(mins)} ${period}`;
}

/** Деньги без центов, всегда вниз. */
export function moneyFloor(x: number): number {
  return Math.floor(x);
}

/** "$262", "$1,234" — доллары, без центов (для смен/заработка). */
export function fmtMoney(x: number): string {
  return '$' + moneyFloor(x).toLocaleString('en-US');
}

/** "$1,200", "$1,147.50" — центы показываем только если они есть (для выплат). */
export function fmtUSD(x: number): string {
  const hasCents = Math.round(x * 100) % 100 !== 0;
  return '$' + x.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Целое → "9 ч"; половина → "10,5 ч" (запятая). */
export function fmtHours(h: number): string {
  const s = Number.isInteger(h) ? String(h) : String(h).replace('.', ',');
  return `${s} ч`;
}

// getDay(): 0=воскресенье.
const RU_DAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const RU_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** "2026-06-24" → локальная Date (без сдвига часового пояса). */
function parseISO(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** ISO-дата → полное рус. название дня ("Среда"). */
export function fullDayName(dateISO: string): string {
  return RU_DAYS_FULL[parseISO(dateISO).getDay()];
}

/** "2026-06-24" → "Среда, 24 июня" (полный день + число + месяц родительный, без года). */
export function fmtCardDate(dateISO: string): string {
  const dt = parseISO(dateISO);
  return `${RU_DAYS_FULL[dt.getDay()]}, ${dt.getDate()} ${RU_MONTHS_GEN[dt.getMonth()]}`;
}

/** (480, 1020) → "8:00 AM – 5:00 PM". */
export function fmtRangeAmPm(startMin: number, endMin: number): string {
  return `${minutesToAmPm(startMin)} – ${minutesToAmPm(endMin)}`;
}

/** Минуты → 12-часовой формат БЕЗ AM/PM, часы всегда 2 цифры: 480→"08:00", 870→"02:30", 1020→"05:00", 720→"12:00", 0→"12:00". */
export function to12h(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${pad2(h12)}:${pad2(m)}`;
}

/** Часы с запятой без "ч": 6.5→"6,5", 8→"8". */
export function hoursComma(h: number): string {
  return Number.isInteger(h) ? String(h) : String(h).replace('.', ',');
}

// ── Отчёты для копирования (Слой 7a, точный формат от Родиона) ──────────────────
interface ReportShift {
  date: string; object_name: string;
  start_min: number | null; end_min: number | null; calculated_hours: number;
}

/** Дневной отчёт (3 строки):
 *  Пятница 3 июля
 *  Объект Ванкувер 137 Женя
 *  С 08:00 - 02:30 = 6,5ч
 */
export function formatDayReport(s: ReportShift): string {
  const dt = parseISO(s.date);
  const lines = [
    `${RU_DAYS_FULL[dt.getDay()]} ${dt.getDate()} ${RU_MONTHS_GEN[dt.getMonth()]}`,
    `Объект ${s.object_name}`,
  ];
  if (s.start_min != null && s.end_min != null) {
    lines.push(`С ${to12h(s.start_min)} - ${to12h(s.end_min)} = ${hoursComma(s.calculated_hours)}ч`);
  }
  return lines.join('\n');
}

/** Недельный отчёт: блоки дней через пустую строку + "Итог: X,Yч". */
export function formatWeekReport(shifts: ReportShift[]): string {
  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date));
  const blocks = sorted.map(formatDayReport).join('\n\n');
  const total = sorted.reduce((a, s) => a + (s.calculated_hours || 0), 0);
  return `${blocks}\n\nИтог: ${hoursComma(total)}ч`;
}
