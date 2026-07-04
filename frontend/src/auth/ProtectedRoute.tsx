import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Гейт роутов: ждёт загрузку, затем пускает по логину и (опц.) роли. */
export default function ProtectedRoute({ requireRole }: { requireRole?: 'supervisor' }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-8 h-8 rounded-full border-2 border-border-2 border-t-accent animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requireRole && user.role !== requireRole) return <Navigate to="/shifts" replace />;
  return <Outlet />;
}
