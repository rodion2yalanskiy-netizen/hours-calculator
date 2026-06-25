// Запросы к API. Все эндпоинты owner-only → шлём заголовок X-Telegram-Init-Data.

const API_URL = import.meta.env.VITE_API_URL;

/** Базовая обёртка: ставит подпись, обрабатывает 401/403/!ok, возвращает json. */
export async function apiFetch<T>(
  path: string,
  initData: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'X-Telegram-Init-Data': initData,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error('Подпись не прошла (401)');
  if (res.status === 403) throw new Error('Доступ только владельцу (403)');
  if (!res.ok) throw new Error(`Ошибка API: ${res.status}`);
  return (await res.json()) as T;
}

// ── Типы ──────────────────────────────────────────────────────────────────────
export interface Me {
  id: number;
  name: string;
  username?: string;
}

export interface Worker {
  id: number;
  name: string;
  is_owner: boolean;
  count_money: boolean;
}

export interface Shift {
  date: string;
  day_of_week: string;
  object_name: string;
  worker_id: number;
  worker_name: string | null;
  count_money: boolean;
  calculated_hours: number;
  money: number | null;
}

/** Один сценарий округления из /shifts/preview. */
export type RoundResult =
  | { needs_round_choice: false; hours: number }
  | { needs_round_choice: true; hours_down: number; hours_up: number };

/** Ответ /shifts/preview. */
export type PreviewResult =
  | { needs_lunch_choice: true; with_lunch: RoundResult; without_lunch: RoundResult }
  | { needs_lunch_choice: false; lunch_deducted: boolean; round: RoundResult };

export interface ShiftCreateBody {
  worker_id: number;
  date: string;
  object_name: string;
  start_min: number;
  end_min: number;
  hours: number;
  lunch_deducted: boolean;
}

// ── Функции ─────────────────────────────────────────────────────────────────────
export async function fetchMe(initData: string): Promise<Me> {
  return apiFetch<Me>('/me', initData);
}

export async function listWorkers(initData: string): Promise<Worker[]> {
  return apiFetch<Worker[]>('/workers', initData);
}

export async function previewShift(
  initData: string,
  start_min: number,
  end_min: number,
): Promise<PreviewResult> {
  return apiFetch<PreviewResult>('/shifts/preview', initData, {
    method: 'POST',
    body: JSON.stringify({ start_min, end_min }),
  });
}

export async function createShift(initData: string, body: ShiftCreateBody): Promise<Shift> {
  return apiFetch<Shift>('/shifts', initData, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listShifts(
  initData: string,
  year: number,
  month: number,
): Promise<Shift[]> {
  return apiFetch<Shift[]>(`/shifts?year=${year}&month=${month}`, initData);
}
