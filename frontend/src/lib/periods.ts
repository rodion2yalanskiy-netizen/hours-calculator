// Пресеты периодов и форматирование диапазона дат для экрана Сводки.
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string): Date => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export type PresetKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'custom';

export const PRESET_LABELS: Record<Exclude<PresetKey, 'custom'>, string> = {
  this_month: 'Этот месяц',
  last_month: 'Прошлый месяц',
  this_quarter: 'Этот квартал',
  last_quarter: 'Прошлый квартал',
  this_year: 'Этот год',
};

/** {from,to} (ISO) для пресета. Кастом сюда не передаём. */
export function getPresetRange(preset: Exclude<PresetKey, 'custom'>, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'this_month':
      return { from: isoOf(new Date(y, m, 1)), to: isoOf(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: isoOf(new Date(y, m - 1, 1)), to: isoOf(new Date(y, m, 0)) };
    case 'this_quarter': {
      const qs = Math.floor(m / 3) * 3;
      return { from: isoOf(new Date(y, qs, 1)), to: isoOf(new Date(y, qs + 3, 0)) };
    }
    case 'last_quarter': {
      const qs = Math.floor(m / 3) * 3 - 3;
      return { from: isoOf(new Date(y, qs, 1)), to: isoOf(new Date(y, qs + 3, 0)) };
    }
    case 'this_year':
      return { from: isoOf(new Date(y, 0, 1)), to: isoOf(now) };
  }
}

/** "1 июля — 31 июля 2026" | "1 июня — 15 июля 2026" | "1 декабря 2025 — 15 января 2026". */
export function formatDateRange(fromIso: string, toIso: string): string {
  const f = parseISO(fromIso); const t = parseISO(toIso);
  const fPart = `${f.getDate()} ${MONTHS_GEN[f.getMonth()]}`;
  const tPart = `${t.getDate()} ${MONTHS_GEN[t.getMonth()]} ${t.getFullYear()}`;
  if (f.getFullYear() !== t.getFullYear()) return `${fPart} ${f.getFullYear()} — ${tPart}`;
  return `${fPart} — ${tPart}`;
}
