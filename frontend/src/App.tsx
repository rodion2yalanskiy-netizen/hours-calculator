import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import ShiftsPage from './pages/ShiftsPage';
import ProfilePage from './pages/ProfilePage';
import TeamPage from './pages/TeamPage';
import TeamMemberPage from './pages/TeamMemberPage';
import PlaceholderPage from './pages/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Всё остальное — под авторизацией и в оболочке приложения */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/shifts" element={<ShiftsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/payouts" element={<PlaceholderPage title="Выплаты" layer="Layer 4c" />} />
          <Route path="/summary" element={<PlaceholderPage title="Сводка" layer="Layer 4d" />} />
          {/* Команда — только supervisor */}
          <Route element={<ProtectedRoute requireRole="supervisor" />}>
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/:userId" element={<TeamMemberPage />} />
          </Route>
        </Route>
      </Route>

      {/* "/" и неизвестные пути → /shifts (ProtectedRoute перекинет на /login, если не залогинен) */}
      <Route path="*" element={<Navigate to="/shifts" replace />} />
    </Routes>
  );
}
