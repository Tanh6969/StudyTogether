import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '../components/layout/Layout';
import { InvitationPreviewPage } from '../pages/invitations/InvitationPreviewPage';
import { StudyRooms } from '../pages/StudyGroup/StudyGroups';
import { StudyGroupDetail } from '../pages/StudyGroup/StudyGroupDetail';
import { StudyRoom } from '../pages/StudyGroup/StudyRoom';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { UpdatePasswordPage } from '../pages/UpdatePasswordPage';
import { AimPage } from '../pages/Aim';
import { AccountSettingsPage } from '../pages/AccountSettingsPage';
import { useAuth } from '../hooks/useAuth';
import { PageLoadingSkeleton } from '../components/ui/Skeleton';

const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return <PageLoadingSkeleton />;
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return children ? <>{children}</> : <Outlet />;
};

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route path="/room/:id" element={<ProtectedRoute><StudyRoom /></ProtectedRoute>} />
      <Route path="/" element={<Layout />}>
        <Route path="invitations/:secret" element={<InvitationPreviewPage />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route index element={<Navigate to="/groups" replace />} />
          <Route path="groups" element={<StudyRooms />} />
          <Route path="groups/:id" element={<StudyGroupDetail />} />
          <Route path="aim" element={<AimPage />} />
          <Route path="settings" element={<AccountSettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
