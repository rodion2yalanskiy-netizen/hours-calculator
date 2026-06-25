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

/** "$262", "$1,234" — доллары, без центов. */
export function fmtMoney(x: number): string {
  return '$' + moneyFloor(x).toLocaleString('en-US');
}

/** Целое → "9 ч"; половина → "10,5 ч" (запятая). */
export function fmtHours(h: number): string {
  const s = Number.isInteger(h) ? String(h) : String(h).replace('.', ',');
  return `${s} ч`;
}
