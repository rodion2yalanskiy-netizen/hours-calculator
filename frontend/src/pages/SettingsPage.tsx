import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';

/** Настройки supervisor'а: номер босса (для отчётов). Уведомления перенесены в Профиль
 * (доступны всем ролям — работник управляет своими push там). */
export default function SettingsPage() {
  const [phone, setPhone] = useState('');
  const [orig, setOrig] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => { setOrig(s.boss_phone); setPhone(s.boss_phone ?? ''); })
      .catch(() => setError('Не удалось загрузить настройки'))
      .finally(() => setLoading(false));
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

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-5 leading-tight">Настройки</h1>

      {/* Босс */}
      <div className="bg-bg-2 border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Босс</h2>
        <label className="block">
          <span className="text-text-3 text-xs">Номер телефона босса</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            disabled={loading} placeholder="+1 (360) 555-1234"
            className="mt-1 w-full min-w-0 bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
          <span className="text-text-muted text-xs">Один на всю команду. Нужен для отправки отчётов боссу.</span>
        </label>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
        <button onClick={save} disabled={!changed || busy || loading}
          className={`w-full mt-4 rounded-2xl py-3 font-semibold ${!changed || busy || loading ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
          {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-success text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );
}
