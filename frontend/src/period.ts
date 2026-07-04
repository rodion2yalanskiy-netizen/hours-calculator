// Хелперы месяцев/периодов для экранов Команды. Чистые функции.
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const monthStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const addMonths = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth() + n, 1);

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const monthLabel = (d: Date): string => `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;

/** Диапазон {from,to} для месяца m, где to не превышает сегодняшний день. */
export function monthRange(m: Date, today: Date): { from: string; to: string } {
  const end = monthEnd(m);
  const to = end.getTime() > today.getTime() ? today : end;
  return { from: isoOf(monthStart(m)), to: isoOf(to) };
}

/** Нельзя листать вперёд за текущий месяц. */
export function isFutureMonth(m: Date, today: Date): boolean {
  return m.getFullYear() > today.getFullYear()
    || (m.getFullYear() === today.getFullYear() && m.getMonth() >= today.getMonth());
}
