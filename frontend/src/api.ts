// Запросы к API. Авторизация — JWT в заголовке Authorization: Bearer <token>.

const API_URL = import.meta.env.VITE_API_URL;
const TOKEN_KEY = 'jwt_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/** Событие, на которое AuthProvider реагирует разлогином (401 от защищённого запроса). */
export const AUTH_UNAUTHORIZED = 'auth:unauthorized';

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j && typeof j.detail === 'string') return j.detail;
  } catch { /* тело не json */ }
  return `Ошибка API: ${res.status}`;
}

/** Авторизованный запрос. 401 → чистим токен и шлём событие разлогина. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED));
    throw new Error('Сессия истекла (401)');
  }
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()) as T;
}

// ── Типы ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string;                       // users.id (UUID)
  email: string;
  full_name: string;
  role: 'supervisor' | 'worker';
  hourly_rate: number;
  worker_id: number | null;
}

export interface Worker {
  id: number;
  name: string;
  is_owner: boolean;
}

export interface Shift {
  id: number;
  date: string;
  day_of_week: string;
  object_name: string;
  worker_id: number;
  worker_name: string | null;
  calculated_hours: number;
  hourly_rate: number;
  money: number;
  start_min: number | null;
  end_min: number | null;
}

export interface Settings {
  boss_phone: string | null;
}

export type RoundResult =
  | { needs_round_choice: false; hours: number }
  | { needs_round_choice: true; hours_down: number; hours_up: number };

export type PreviewResult =
  | { needs_lunch_choice: true; with_lunch: RoundResult; without_lunch: RoundResult; hourly_rate: number }
  | { needs_lunch_choice: false; lunch_deducted: boolean; round: RoundResult; hourly_rate: number };

export interface ShiftCreateBody {
  worker_id: number;
  date: string;
  object_name: string;
  start_min: number;
  end_min: number;
  hours: number;
  lunch_deducted: boolean;
}

export interface TeamMember {
  worker_id: number;
  user_id: string;
  email: string;
  full_name: string;
  role: 'supervisor' | 'worker';
  hourly_rate: number;
  is_active: boolean;
  created_at: string;
}

export interface Payout {
  id: string;
  worker_id: number;
  week_start: string;
  week_end: string;
  amount_paid: number;
  shortfall_reason: 'debt' | 'fine' | null;
  shortfall_note: string | null;
  paid_at: string;
  receipt_id: string | null;
  earned_by_hours: number;
  bonus: number;
  shortfall: number;
}

export interface ReceiptUploadResponse {
  receipt_id: string;
  is_receipt_confirmed: boolean;
  recognized_amount: number | null;
  notes: string;
  file_url: string;
}

export interface WeeklySummary {
  worker_id: number;
  worker_name: string | null;
  week_start: string;
  week_end: string;
  shifts_count: number;
  total_hours: number;
  earned_by_hours: number;
  payout: { amount_paid: number; shortfall_reason: string | null; shortfall_note: string | null; paid_at: string } | null;
  bonus: number;
  shortfall: number;
  status: 'paid' | 'unpaid' | 'shortfall_debt' | 'shortfall_fine' | 'bonus';
}

export interface PeriodTotals {
  total_earned: number;
  total_paid: number;
  total_bonus: number;
  total_shortfall: number;
}
export interface WorkerPeriod {
  worker_id: number;
  worker_name: string | null;
  weeks: WeeklySummary[];
  totals: PeriodTotals;
}
export interface PeriodSummary {
  from: string;
  to: string;
  workers: WorkerPeriod[];
  totals: PeriodTotals;
}

// ── Аутентификация ────────────────────────────────────────────────────────────
interface LoginResponse {
  token: string;
  user: { id: string; full_name: string; role: 'supervisor' | 'worker'; hourly_rate: number };
}

/** Логин. НЕ шлёт событие разлогина на 401 — возвращает понятную ошибку. */
export async function login(email: string, password: string): Promise<string> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) throw new Error('Неверный email или пароль');
  if (!res.ok) throw new Error(await errorDetail(res));
  const data = (await res.json()) as LoginResponse;
  setToken(data.token);
  return data.token;
}

export async function me(): Promise<User> {
  return apiFetch<User>('/auth/me');
}

export async function updateProfile(body: { full_name?: string; hourly_rate?: number }): Promise<User> {
  return apiFetch<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
}

export async function changePassword(old_password: string, new_password: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ old_password, new_password }),
  });
}

// ── Смены / работники ─────────────────────────────────────────────────────────
export async function getWorkers(): Promise<Worker[]> {
  return apiFetch<Worker[]>('/workers');
}

export async function previewShift(start_min: number, end_min: number, worker_id?: number): Promise<PreviewResult> {
  return apiFetch<PreviewResult>('/shifts/preview', {
    method: 'POST',
    body: JSON.stringify({ start_min, end_min, ...(worker_id != null ? { worker_id } : {}) }),
  });
}

export async function createShift(body: ShiftCreateBody): Promise<Shift> {
  return apiFetch<Shift>('/shifts', { method: 'POST', body: JSON.stringify(body) });
}

export async function getShifts(year: number, month: number, worker_id?: number): Promise<Shift[]> {
  const q = new URLSearchParams({ year: String(year), month: String(month) });
  if (worker_id != null) q.set('worker_id', String(worker_id));
  return apiFetch<Shift[]>(`/shifts?${q.toString()}`);
}

export async function updateShift(id: number, body: {
  date?: string; object_name?: string; start_min?: number; end_min?: number; hours?: number; lunch_deducted?: boolean;
}): Promise<Shift> {
  return apiFetch<Shift>(`/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** DELETE /shifts/{id} → 204 (без тела). 409 если у недели уже есть выплата. */
export async function deleteShift(id: number): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const res = await fetch(`${API_URL}/shifts/${id}`, {
    method: 'DELETE',
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });
  if (res.status === 401) { clearToken(); window.dispatchEvent(new Event(AUTH_UNAUTHORIZED)); throw new Error('Сессия истекла (401)'); }
  if (res.status === 204 || res.ok) return;
  throw new Error(await errorDetail(res));
}

// ── Отчёты / push (Layer 7b) ─────────────────────────────────────────────────────
export async function markWeekReported(week_start: string): Promise<void> {
  await apiFetch<{ success: boolean }>('/shifts/mark-week-reported', { method: 'POST', body: JSON.stringify({ week_start }) });
}
export async function getVapidPublicKey(): Promise<string> {
  const r = await apiFetch<{ public_key: string }>('/push/vapid-public-key');
  return r.public_key;
}
export async function subscribeToPush(body: {
  endpoint: string; keys: { p256dh: string; auth: string }; user_agent?: string;
}): Promise<void> {
  await apiFetch<{ subscription_id: string }>('/push/subscribe', { method: 'POST', body: JSON.stringify(body) });
}
export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  if (!API_URL) return;
  const res = await fetch(`${API_URL}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ endpoint }),
  });
  if (res.status === 401) { clearToken(); window.dispatchEvent(new Event(AUTH_UNAUTHORIZED)); return; }
  // 204 или ошибка — не критично для UI отписки
}

// ── Настройки (Layer 7a) ────────────────────────────────────────────────────────
export async function getSettings(): Promise<Settings> {
  return apiFetch<Settings>('/settings');
}
export async function updateSettings(body: { boss_phone: string | null }): Promise<Settings> {
  return apiFetch<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Команда ────────────────────────────────────────────────────────────────────
export async function getTeam(includeInactive = false): Promise<TeamMember[]> {
  return apiFetch<TeamMember[]>(`/team${includeInactive ? '?include_inactive=1' : ''}`);
}
export async function createTeamMember(body: {
  email: string; password: string; full_name: string; hourly_rate: number;
}): Promise<TeamMember> {
  return apiFetch<TeamMember>('/team', { method: 'POST', body: JSON.stringify(body) });
}
export async function updateTeamMember(userId: string, body: {
  full_name?: string; hourly_rate?: number; is_active?: boolean; new_password?: string;
}): Promise<TeamMember> {
  return apiFetch<TeamMember>(`/team/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Выплаты (экраны — Layer 4c) ────────────────────────────────────────────────
export async function getPayouts(params: { worker_id?: number; from?: string; to?: string } = {}): Promise<Payout[]> {
  const q = new URLSearchParams();
  if (params.worker_id != null) q.set('worker_id', String(params.worker_id));
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  const qs = q.toString();
  return apiFetch<Payout[]>(`/payouts${qs ? `?${qs}` : ''}`);
}
export async function createPayout(body: {
  week_start: string; week_end: string; amount_paid: number;
  shortfall_reason?: 'debt' | 'fine'; shortfall_note?: string;
}): Promise<Payout> {
  return apiFetch<Payout>('/payouts', { method: 'POST', body: JSON.stringify(body) });
}
export async function updatePayout(id: string, body: {
  amount_paid?: number; receipt_id?: string; shortfall_reason?: 'debt' | 'fine' | null; shortfall_note?: string;
}): Promise<Payout> {
  return apiFetch<Payout>(`/payouts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deletePayout(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/payouts/${id}`, { method: 'DELETE' });
}

// ── Чеки (Layer 6) ──────────────────────────────────────────────────────────────
/** Загрузка фото чека (multipart) → распознавание Gemini. */
export async function uploadReceipt(file: File): Promise<ReceiptUploadResponse> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/receipts/upload`, {
    method: 'POST',
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }, // без Content-Type — браузер сам ставит boundary
    body: form,
  });
  if (res.status === 401) { clearToken(); window.dispatchEvent(new Event(AUTH_UNAUTHORIZED)); throw new Error('Сессия истекла (401)'); }
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()) as ReceiptUploadResponse;
}

export async function createPayoutFromReceipt(body: {
  receipt_id: string; week_start: string; week_end: string; confirmed_amount: number;
  shortfall_reason?: 'debt' | 'fine'; shortfall_note?: string;
}): Promise<Payout> {
  return apiFetch<Payout>('/payouts/from-receipt', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteReceipt(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/receipts/${id}`, { method: 'DELETE' });
}

export interface ReceiptMeta {
  id: string; worker_id: number;
  recognized_amount: number | null; confirmed_amount: number | null;
  created_at: string; file_url: string;
}
export async function getReceiptMeta(id: string): Promise<ReceiptMeta> {
  return apiFetch<ReceiptMeta>(`/receipts/${id}`);
}

/** Скачать файл чека с Bearer-заголовком и вернуть objectURL (для <img>). Освобождать через URL.revokeObjectURL. */
export async function fetchReceiptObjectUrl(id: string): Promise<string> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const res = await fetch(`${API_URL}/receipts/${id}/file`, {
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });
  if (res.status === 401) { clearToken(); window.dispatchEvent(new Event(AUTH_UNAUTHORIZED)); throw new Error('Сессия истекла (401)'); }
  if (!res.ok) throw new Error(await errorDetail(res));
  return URL.createObjectURL(await res.blob());
}

// ── Сводки (экраны — Layer 4d) ─────────────────────────────────────────────────
export async function getSummaryWeekly(week_start: string, worker_id?: number): Promise<WeeklySummary> {
  const q = new URLSearchParams({ week_start });
  if (worker_id != null) q.set('worker_id', String(worker_id));
  return apiFetch<WeeklySummary>(`/summary/weekly?${q.toString()}`);
}
export async function getSummaryPeriod(from: string, to: string, worker_id?: number): Promise<PeriodSummary> {
  const q = new URLSearchParams({ from, to });
  if (worker_id != null) q.set('worker_id', String(worker_id));
  return apiFetch<PeriodSummary>(`/summary/period?${q.toString()}`);
}
