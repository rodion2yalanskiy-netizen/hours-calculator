import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { haptic } from '../haptic';
import {
  IconClock, IconUsers, IconWallet, IconChart, IconChevDown, IconUser, IconLogout, IconSettings,
  type IconProps,
} from './icons';

interface NavItem { to: string; label: string; Icon: (p: IconProps) => JSX.Element; supervisorOnly?: boolean }

const NAV: NavItem[] = [
  { to: '/shifts', label: 'Смены', Icon: IconClock },
  { to: '/team', label: 'Команда', Icon: IconUsers, supervisorOnly: true },
  { to: '/payouts', label: 'Выплаты', Icon: IconWallet },
  { to: '/summary', label: 'Сводка', Icon: IconChart },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((n) => !n.supervisorOnly || user?.role === 'supervisor');
  const initial = (user?.full_name ?? '?').slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Верхняя панель */}
      <header className="sticky top-0 z-20 bg-bg/85 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <NavLink to="/shifts" className="flex items-center gap-2 font-bold tracking-wide">
            <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_12px_#34D399]" />
            Painter
          </NavLink>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full bg-bg-2 border border-border pl-1 pr-2 py-1"
            >
              <span className="w-7 h-7 rounded-full bg-accent text-bg-2 flex items-center justify-center font-bold text-sm">
                {initial}
              </span>
              <span className="text-sm text-text-2 max-w-[8rem] truncate">{user?.full_name}</span>
              <IconChevDown className="w-4 h-4 text-text-muted" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-44 z-20 bg-bg-2 border border-border rounded-2xl overflow-hidden shadow-xl">
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-bg-3"
                  >
                    <IconUser className="w-4 h-4 text-text-3" /> Профиль
                  </button>
                  {user?.role === 'supervisor' && (
                    <button
                      onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-bg-3 border-t border-border"
                    >
                      <IconSettings className="w-4 h-4 text-text-3" /> Настройки
                    </button>
                  )}
                  <button
                    onClick={() => { setMenuOpen(false); logout(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-danger hover:bg-bg-3 border-t border-border"
                  >
                    <IconLogout className="w-4 h-4" /> Выйти
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="md:flex md:max-w-4xl md:mx-auto">
        {/* Боковая панель (десктоп) */}
        <aside className="hidden md:block w-52 shrink-0 border-r border-border p-3">
          <nav className="space-y-1">
            {items.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => haptic('light')}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                    isActive ? 'bg-accent-dim text-accent' : 'text-text-muted hover:text-text hover:bg-bg-2'
                  }`
                }
              >
                <Icon className="w-5 h-5" /> {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Контент */}
        <main className="flex-1 w-full max-w-md mx-auto px-4 pt-5 pb-28 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Нижняя навигация (мобильно) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-bg-2 border-t border-border">
        <div
          className="max-w-md mx-auto grid"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => haptic('light')}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 ${isActive ? 'text-accent' : 'text-text-muted'}`
              }
            >
              <Icon className="w-6 h-6" />
              <span className="text-[11px]">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
