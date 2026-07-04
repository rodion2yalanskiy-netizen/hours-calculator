import { useState, type FormEvent } from 'react';
import { updateTeamMember, type TeamMember } from '../api';
import { haptic } from '../haptic';

export default function EditMemberModal({
  member, onClose, onSaved,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: (changedPassword: string | null) => void;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [rate, setRate] = useState(String(member.hourly_rate));
  const [newPassword, setNewPassword] = useState('');
  const [isActive, setIsActive] = useState(member.is_active);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rateNum = parseFloat(rate);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const body: { full_name?: string; hourly_rate?: number; is_active?: boolean; new_password?: string } = {};
    if (fullName.trim() && fullName.trim() !== member.full_name) body.full_name = fullName.trim();
    if (Number.isFinite(rateNum) && rateNum > 0 && rateNum !== member.hourly_rate) body.hourly_rate = rateNum;
    if (newPassword) {
      if (newPassword.length < 8) { setError('Новый пароль — минимум 8 символов'); return; }
      body.new_password = newPassword;
    }
    if (isActive !== member.is_active) body.is_active = isActive;

    if (Object.keys(body).length === 0) { onClose(); return; }

    // Предупреждение при деактивации.
    if (body.is_active === false && !window.confirm('Работник не сможет войти. Продолжить?')) return;

    setBusy(true);
    try {
      await updateTeamMember(member.user_id, body);
      haptic('success');
      onSaved(body.new_password ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-bg-2 border border-border w-full h-full overflow-y-auto md:h-auto md:max-w-[480px] md:rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Изменить работника</h2>
          <button onClick={onClose} className="text-text-muted text-2xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-text-3 text-xs">Имя</span>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Ставка, $/час</span>
            <input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Новый пароль</span>
            <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="off" placeholder="оставьте пустым, если не меняете"
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent font-mono" />
          </label>

          <div className="flex items-center justify-between bg-bg-3 border border-border rounded-xl px-4 py-3">
            <span className="text-sm">Статус: {isActive ? 'Активен' : 'Неактивен'}</span>
            <button type="button" onClick={() => setIsActive((v) => !v)}
              className={`w-12 h-7 rounded-full relative transition-colors ${isActive ? 'bg-accent' : 'bg-border-2'}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-bg-2 transition-all ${isActive ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 bg-bg-3 text-text-muted">Отмена</button>
            <button type="submit" disabled={busy}
              className={`flex-1 rounded-xl py-3 font-semibold ${busy ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'}`}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
