import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';
import {
  isPushSupportedInBrowser, isIOSNeedingInstall, hasActiveSubscription,
  requestPermissionAndSubscribe, unsubscribeFromPush, getPushPermissionStatus,
} from '../lib/push';

type PushSupport = 'loading' | 'ok' | 'unsupported' | 'ios-install';

export default function SettingsPage() {
  const [phone, setPhone] = useState('');
  const [orig, setOrig] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [pushSupport, setPushSupport] = useState<PushSupport>('loading');
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => { setOrig(s.boss_phone); setPhone(s.boss_phone ?? ''); })
      .catch(() => setError('Не удалось загрузить настройки'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isPushSupportedInBrowser()) { setPushSupport('unsupported'); return; }
    if (isIOSNeedingInstall()) { setPushSupport('ios-install'); return; }
    setPushSupport('ok');
    hasActiveSubscription().then(setPushOn).catch(() => setPushOn(false));
  }, []);

  const changed = phone.trim() !== (orig ?? '');
  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2000); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const s = await updateSettings({ boss_phone: phone.trim() || null });
      setOrig(s.boss_phone); setPhone(s.boss_phone ?? '');
      showToast('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setBusy(false); }
  };

  const enablePush = async () => {
    setPushBusy(true); setPushMsg(null);
    try {
      const ok = await requestPermissionAndSubscribe();
      if (ok) { setPushOn(true); setPushMsg(null); }
      else setPushMsg(getPushPermissionStatus() === 'denied'
        ? 'Браузер заблокировал уведомления. Разрешите их в настройках браузера.'
        : 'Не удалось включить уведомления.');
    } catch {
      setPushMsg('Не удалось включить уведомления.');
    } finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true); setPushMsg(null);
    try { await unsubscribeFromPush(); setPushOn(false); }
    finally { setPushBusy(false); }
  };

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-5">Настройки</h1>

      {/* Босс */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5 mb-4">
        <h2 className="font-semibold mb-3">Босс</h2>
        <label className="block">
          <span className="text-text-3 text-xs">Номер телефона босса</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            disabled={loading} placeholder="+1 (360) 555-1234"
            className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
          <span className="text-text-muted text-xs">Один на всю команду. Нужен для отправки отчётов боссу.</span>
        </label>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
        <button onClick={save} disabled={!changed || busy || loading}
          className={`w-full mt-4 rounded-2xl py-3 font-semibold ${!changed || busy || loading ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
          {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>

      {/* Уведомления */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Уведомления</h2>

        {pushSupport === 'unsupported' && (
          <p className="text-text-muted text-sm">Этот браузер не поддерживает push-уведомления.</p>
        )}

        {pushSupport === 'ios-install' && (
          <div className="text-sm text-text-2 space-y-1">
            <p className="font-medium mb-1">Для напоминаний на iPhone:</p>
            <p>1. Нажмите «Поделиться» в Safari</p>
            <p>2. Выберите «На экран „Домой“»</p>
            <p>3. Откройте приложение с главного экрана</p>
            <p>4. Вернитесь сюда и включите уведомления</p>
          </div>
        )}

        {pushSupport === 'ok' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Напоминания о недельном отчёте: <span className={pushOn ? 'text-accent font-medium' : 'text-text-muted'}>{pushOn ? 'Включены' : 'Выключены'}</span></span>
              {pushOn ? (
                <button onClick={disablePush} disabled={pushBusy} className="shrink-0 rounded-xl px-4 py-2 bg-bg-3 border border-border-2 text-sm">
                  {pushBusy ? '…' : 'Выключить'}
                </button>
              ) : (
                <button onClick={enablePush} disabled={pushBusy} className="shrink-0 rounded-xl px-4 py-2 bg-accent text-bg-2 text-sm font-semibold hover:bg-accent-2">
                  {pushBusy ? '…' : 'Включить'}
                </button>
              )}
            </div>
            {pushMsg && <p className="text-warning text-sm mt-2">{pushMsg}</p>}
            <p className="text-text-muted text-xs mt-3">Приходят по субботам в 19:00, 20:00, 21:00 и 22:00, если вы не отправили отчёт боссу.</p>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-success text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );
}
