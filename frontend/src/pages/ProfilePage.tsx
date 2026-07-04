import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { changePassword } from '../api';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const roleLabel = user.role === 'supervisor' ? 'Супервайзер' : 'Работник';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-5">Профиль</h1>

      <div className="bg-bg-2 border border-border rounded-2xl p-5 space-y-4">
        <Field label="Имя" value={user.full_name} />
        <Field label="Email" value={user.email} />
        <Field label="Роль" value={roleLabel} />
        <Field label="Ставка" value={`$${user.hourly_rate}/час`} />
      </div>

      <button
        onClick={() => setOpen(true)}
        className="w-full mt-5 rounded-2xl py-3.5 font-semibold bg-bg-2 border border-border-2 hover:border-accent"
      >
        Сменить пароль
      </button>

      {open && <ChangePasswordModal onClose={() => setOpen(false)} onDone={logout} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border last:border-0 pb-3 last:pb-0">
      <span className="text-text-muted text-sm">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // После успеха токен инвалидирован (bump token_version) → разлогиниваем.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [done, onDone]);

  const valid = newPw.length >= 8 && /[A-Za-z]/.test(newPw) && /\d/.test(newPw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
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
                className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
            </label>
            <label className="block">
              <span className="text-text-3 text-xs">Новый пароль</span>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password"
                className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent" />
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
