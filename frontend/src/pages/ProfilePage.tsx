import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { changePassword, updateProfile } from '../api';
import NotificationsSection from '../components/NotificationsSection';

export default function ProfilePage() {
  const { user, logout, updateUser } = useAuth();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    if (user) { setName(user.full_name); setRate(String(user.hourly_rate)); }
  }, [user]);

  if (!user) return null;
  const isSup = user.role === 'supervisor';
  const roleLabel = isSup ? 'Супервайзер' : 'Работник';
  const rateNum = parseFloat(rate);
  const nameChanged = name.trim() !== user.full_name;
  // 7f: свою ставку теперь может менять и работник (применится только к будущим сменам).
  const rateChanged = Number.isFinite(rateNum) && rateNum !== user.hourly_rate;
  const changed = nameChanged || rateChanged;

  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2000); };

  const save = async () => {
    setBusy(true); setError(null);
    const body: { full_name?: string; hourly_rate?: number } = {};
    if (nameChanged) {
      if (name.trim().length < 2) { setError('Имя — минимум 2 символа'); setBusy(false); return; }
      body.full_name = name.trim();
    }
    if (rateChanged) {
      if (rateNum <= 0) { setError('Ставка должна быть больше 0'); setBusy(false); return; }
      body.hourly_rate = rateNum;
    }
    try {
      const updated = await updateProfile(body);
      updateUser(updated);  // обновляем шапку AppShell и т.д.
      showToast('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setBusy(false); }
  };

  const inputCls = 'mt-1 w-full min-w-0 bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent';

  return (
    <div className="relative">
      <h1 className="text-2xl font-bold mb-5 leading-tight">Профиль</h1>

      <div className="bg-bg-2 border border-border rounded-2xl p-5 space-y-4">
        <label className="block">
          <span className="text-text-3 text-xs">Имя</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>

        <div>
          <span className="text-text-3 text-xs">Email</span>
          <p className="mt-1 font-medium break-all">{user.email}</p>
        </div>

        <div>
          <span className="text-text-3 text-xs">Роль</span>
          <p className="mt-1 font-medium">{roleLabel}</p>
        </div>

        <div>
          <span className="text-text-3 text-xs">Ставка, $/час</span>
          <input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} />
          <span className="text-text-muted text-xs mt-1 block">
            {isSup
              ? 'Новая ставка применяется только к будущим сменам — прошлые не пересчитываются.'
              : 'Можешь менять свою ставку. Она применится только к будущим сменам (прошлые не меняются). Старший получит уведомление об изменении.'}
          </span>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <button onClick={save} disabled={!changed || busy}
          className={`w-full rounded-2xl py-3 font-semibold ${!changed || busy ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
          {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>

      <button onClick={() => setPwOpen(true)}
        className="w-full mt-4 rounded-2xl py-3.5 font-semibold bg-bg-2 border border-border-2 hover:border-accent">
        Сменить пароль
      </button>

      {/* Уведомления — доступны всем (перенесено из Настроек, недоступных работнику). */}
      <NotificationsSection />

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} onDone={logout} />}

      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-bg-2 text-success text-sm font-medium px-4 py-2 rounded-full shadow-lg border border-border">{toast}</div>
        </div>
      )}
    </div>
  );
}

function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [done, onDone]);

  const valid = newPw.length >= 8 && /[A-Za-z]/.test(newPw) && /\d/.test(newPw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await changePassword(oldPw, newPw); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сменить пароль'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-bg-2 border border-border rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent-dim flex items-center justify-center text-accent text-2xl">✓</div>
            <p className="text-success font-semibold">Пароль изменён</p>
            <p className="text-text-muted text-sm mt-1">Нужно войти заново…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-lg font-bold">Сменить пароль</h2>
            <label className="block">
              <span className="text-text-3 text-xs">Текущий пароль</span>
              <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password"
                className="mt-1 w-full min-w-0 bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
            </label>
            <label className="block">
              <span className="text-text-3 text-xs">Новый пароль</span>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password"
                className="mt-1 w-full min-w-0 bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
              <span className="text-text-muted text-xs">Минимум 8 символов, буквы и цифры</span>
            </label>
            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отмена</button>
              <button type="submit" disabled={busy || !oldPw || !valid}
                className={`flex-1 rounded-xl py-3 font-semibold ${busy || !oldPw || !valid ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
                {busy ? 'Смена…' : 'Сменить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
