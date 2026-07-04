import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/shifts" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/shifts', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-bg-2 border border-border rounded-2xl p-7">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="w-3 h-3 rounded-full bg-accent shadow-[0_0_14px_#34D399]" />
          <h1 className="text-lg font-bold tracking-wide">Axiom:Void · Painter</h1>
        </div>
        <p className="text-text-muted text-sm mb-6">Вход для бригады</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-text-3 text-xs">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent"
              placeholder="you@axiom-void.com"
            />
          </label>
          <label className="block">
            <span className="text-text-3 text-xs">Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full bg-bg-3 border border-border-2 rounded-xl px-4 py-3 outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !email || !password}
            className={`w-full rounded-2xl py-3.5 font-semibold text-lg ${
              busy || !email || !password ? 'bg-bg-3 text-text-muted' : 'bg-accent text-bg-2 hover:bg-accent-2'
            }`}
          >
            {busy ? 'Вход…' : 'Войти'}
          </button>

          {error && <p className="text-danger text-sm text-center">{error}</p>}
        </form>
      </div>
    </div>
  );
}
