import { useEffect, useState } from 'react';
import { getWebApp } from './telegram';
import { fetchMe, type Me } from './api';

type State =
  | { status: 'loading' }
  | { status: 'ok'; me: Me }
  | { status: 'error'; error: string };

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  // ПЕРВЫЙ рендер-эффект: сразу tg.ready() — иначе бывает "Mini App not available".
  useEffect(() => {
    const tg = getWebApp();
    if (!tg) {
      setState({ status: 'error', error: 'Открой приложение из Telegram.' });
      return;
    }
    tg.ready();   // сигнал готовности Telegram
    tg.expand();  // на весь экран

    const initData = tg.initData;
    if (!initData) {
      setState({ status: 'error', error: 'Нет initData (открой из Telegram).' });
      return;
    }

    fetchMe(initData)
      .then((me) => setState({ status: 'ok', me }))
      .catch((e: unknown) =>
        setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }),
      );
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-white px-6">
      <div className="w-full max-w-sm text-center">
        <div className="font-mono text-xs tracking-[0.2em] uppercase text-accent/70 mb-6">
          Axiom:Void · Калькулятор часов
        </div>

        {state.status === 'loading' && (
          <p className="text-white/60">Загрузка…</p>
        )}

        {state.status === 'ok' && (
          <>
            <h1 className="text-2xl font-semibold mb-3">
              Привет, {state.me.name || 'друг'}
            </h1>
            <p className="text-accent font-medium">✓ подпись проверена</p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <h1 className="text-xl font-semibold mb-2 text-red-400">Не удалось</h1>
            <p className="text-white/60 text-sm">{state.error}</p>
          </>
        )}
      </div>
    </div>
  );
}
