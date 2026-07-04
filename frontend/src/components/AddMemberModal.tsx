import { useState, type FormEvent } from 'react';
import { createTeamMember } from '../api';
import { haptic } from '../haptic';

function genPassword(len = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function AddMemberModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (creds: { email: string; password: string }) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rateNum = parseFloat(rate);
  const valid =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    Number.isFinite(rateNum) && rateNum > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createTeamMember({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        hourly_rate: rateNum,
      });
      haptic('success');
      onCreated({ email: email.trim(), password });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось добавить';
      setError(/email/i.test(msg) ? 'Email уже используется другим работником' : msg);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex md:items-center md:justify-center" onClick={onClose}>
      <div
        className="bg-bg-2 border border-border w-full h-full overflow-y-auto md:h-auto md:max-w-[480px] md:rounded-2xl md:border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Добавить работника</h2>
          <button onClick={onClose} className="text-text-muted text-2xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-text-3 text-xs">Имя</span>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Дмитрий Иванов" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="off" placeholder="worker@example.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Пароль</span>
            <div className="mt-1 flex gap-2">
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="off" placeholder="минимум 8 символов"
                className="flex-1 bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent font-mono" />
              <button type="button" onClick={() => setPassword(genPassword())}
                className="shrink-0 px-3 rounded-xl bg-accent-dim text-accent text-sm font-medium">
                Сгенерировать
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Ставка, $/час</span>
            <input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)}
              placeholder="например, 22.00" className={inputCls} />
          </label>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отмена</button>
            <button type="submit" disabled={busy || !valid}
              className={`flex-1 rounded-xl py-3 font-semibold ${busy || !valid ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
              {busy ? 'Добавление…' : 'Добавить работника'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
