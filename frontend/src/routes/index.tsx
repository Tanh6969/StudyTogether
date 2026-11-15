import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { PageLoadingSkeleton } from '../components/ui/Skeleton';
import { LazyStudyRoom as StudyRoom } from '../pages/StudyGroup/studyRoomPage';

const Layout = lazy(() => import('../components/layout/Layout').then(({ Layout }) => ({ default: Layout })));
const InvitationPreviewPage = lazy(() =>
  import('../pages/invitations/InvitationPreviewPage').then(({ InvitationPreviewPage }) => ({ default: InvitationPreviewPage }))
);
const StudyRooms = lazy(() =>
  import('../pages/StudyGroup/StudyGroups').then(({ StudyRooms }) => ({ default: StudyRooms }))
);
const StudyGroupDetail = lazy(() =>
  import('../pages/StudyGroup/StudyGroupDetail').then(({ StudyGroupDetail }) => ({ default: StudyGroupDetail }))
);
const LoginPage = lazy(() => import('../pages/LoginPage').then(({ LoginPage }) => ({ default: LoginPage })));
const RegisterPage = lazy(() =>
  import('../pages/RegisterPage').then(({ RegisterPage }) => ({ default: RegisterPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('../pages/ForgotPasswordPage').then(({ ForgotPasswordPage }) => ({ default: ForgotPasswordPage }))
);
const UpdatePasswordPage = lazy(() =>
  import('../pages/UpdatePasswordPage').then(({ UpdatePasswordPage }) => ({ default: UpdatePasswordPage }))
);
const AccountSettingsPage = lazy(() =>
  import('../pages/AccountSettingsPage').then(({ AccountSettingsPage }) => ({ default: AccountSettingsPage }))
);

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
    <Suspense fallback={<PageLoadingSkeleton />}>
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
            <Route path="settings" element={<AccountSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
