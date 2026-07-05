import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin, me as apiMe, getToken, clearToken, AUTH_UNAUTHORIZED, type User } from '../api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Старт: если есть токен — подтягиваем пользователя. Битый/просроченный → чистим.
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    let cancelled = false;
    apiMe()
      .then((u) => { if (!cancelled) setUser(u); })
      .catch(() => { clearToken(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Любой защищённый 401 (истёк токен / сменён пароль) → разлогин.
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener(AUTH_UNAUTHORIZED, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED, onUnauthorized);
  }, [navigate]);

  const login = async (email: string, password: string) => {
    await apiLogin(email, password);
    const u = await apiMe();
    setUser(u);
  };

  const logout = () => {
    clearToken();
    setUser(null);
    navigate('/login', { replace: true });
  };

  const updateUser = (u: User) => setUser(u);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
