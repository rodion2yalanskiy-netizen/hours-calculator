import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import ShiftsPage from './pages/ShiftsPage';
import ProfilePage from './pages/ProfilePage';
import TeamPage from './pages/TeamPage';
import TeamMemberPage from './pages/TeamMemberPage';
import PayoutsPage from './pages/PayoutsPage';
import PayoutReceiptCapture from './pages/PayoutReceiptCapture';
import SummaryPage from './pages/SummaryPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Всё остальное — под авторизацией и в оболочке приложения */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/shifts" element={<ShiftsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/payouts" element={<PayoutsPage />} />
          <Route path="/payouts/receipt" element={<PayoutReceiptCapture />} />
          <Route path="/summary" element={<SummaryPage />} />
          {/* Команда — только supervisor */}
          <Route element={<ProtectedRoute requireRole="supervisor" />}>
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/:userId" element={<TeamMemberPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>

      {/* "/" и неизвестные пути → /shifts (ProtectedRoute перекинет на /login, если не залогинен) */}
      <Route path="*" element={<Navigate to="/shifts" replace />} />
    </Routes>
  );
}
