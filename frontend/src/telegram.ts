// Тонкая обёртка над официальным Telegram WebApp API (window.Telegram.WebApp)
// + мок для отладки в обычном браузере (вне Telegram).

export interface TgWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  colorScheme?: string;
}

/**
 * Мок для браузера: если приложение открыто НЕ в Telegram (нет window.Telegram)
 * и задан VITE_MOCK_INIT_DATA — подставляем фейковый WebApp с этой initData.
 * ВАЖНО: подпись нельзя подделать без токена бота, поэтому VITE_MOCK_INIT_DATA
 * должна быть РЕАЛЬНО подписанной тестовой строкой (получить из Telegram один раз),
 * иначе API корректно вернёт 401 — это ожидаемое поведение, не баг.
 */
function installMockIfNeeded(): void {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  if (w.Telegram?.WebApp) return;                 // настоящий Telegram — мок не нужен
  if (!import.meta.env.DEV) return;               // мок только в dev
  const raw = import.meta.env.VITE_MOCK_INIT_DATA;
  if (!raw) return;                               // нет тестовой initData — нечего мокать
  w.Telegram = {
    WebApp: {
      ready: () => {},
      expand: () => {},
      initData: raw,
      initDataUnsafe: {},
      colorScheme: 'dark',
    },
  };
}

export function getWebApp(): TgWebApp | null {
  installMockIfNeeded();
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp ?? null;
}
