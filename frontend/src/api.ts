// Запросы к API. В Слое 0 — только /me (проверка подписи + owner).

export interface Me {
  id: number;
  name: string;
  username?: string;
}

const API_URL = import.meta.env.VITE_API_URL;

export async function fetchMe(initData: string): Promise<Me> {
  if (!API_URL) throw new Error('VITE_API_URL не задан');
  const res = await fetch(`${API_URL}/me`, {
    headers: { 'X-Telegram-Init-Data': initData },
  });
  if (res.status === 401) throw new Error('Подпись не прошла (401)');
  if (res.status === 403) throw new Error('Доступ только владельцу (403)');
  if (!res.ok) throw new Error(`Ошибка API: ${res.status}`);
  return (await res.json()) as Me;
}
