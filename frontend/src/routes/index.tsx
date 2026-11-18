import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { PageLoadingSkeleton } from '../components/ui/Skeleton';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
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

// Preview can reuse existing Supabase Auth for login, but must not mutate the
// production Auth account registry/passwords until a staging Auth project exists.
const PREVIEW_MODE = import.meta.env.VITE_PREVIEW_MODE === 'true';
const PreviewAuthDisabled = () => (
  <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: 24, textAlign: 'center' }}>
    <h2>Chức năng tài khoản tạm khóa trên bản nghiệm thu</h2>
    <p>Bản thử nghiệm chỉ cho đăng nhập tài khoản đã có. Đăng ký và thay đổi mật khẩu đang tắt để bảo vệ tài khoản thật.</p>
    <a href="/login">Quay lại đăng nhập</a>
  </main>
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

// React Router can reuse the same route instance when only :id changes.
// Key the room subtree so no media/session state from room A can outlive a
// navigation to room B. The old room cleans up with its own join generation.
function RoomRouteBoundary() {
  const { id } = useParams();
  return (
    // A room render crash must never blank the whole application. Keying by
    // room id also resets the boundary when navigating into another room.
    <ErrorBoundary
      key={id}
      onError={(error, info) => console.error('[StudyRoom route render]', error, info.componentStack)}
      fallback={
        <main role="alert" style={{
          minHeight: '100vh', background: '#0F172A', color: '#F8FAFC',
          display: 'grid', placeContent: 'center', padding: 24, textAlign: 'center',
        }}>
          <h1 style={{fontSize: 20}}>Không thể hiển thị phòng học</h1>
          <p style={{maxWidth: 480, color: '#CBD5E1'}}>
            Giao diện phòng học gặp lỗi ngoài dự kiến. Bạn có thể thử tải lại
            hoặc quay về danh sách phòng. Không có dữ liệu phòng nào bị xóa.
          </p>
          <div style={{display: 'flex', gap: 12, justifyContent: 'center'}}>
            <button type="button" onClick={() => window.location.reload()}
              style={{padding: 12, cursor: 'pointer'}}>Tải lại phòng</button>
            <a href="/groups" style={{padding: 12, color: '#93C5FD'}}>Quay về nhóm</a>
          </div>
        </main>
      }
    >
      <StudyRoom key={id} />
    </ErrorBoundary>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={PREVIEW_MODE ? <PreviewAuthDisabled /> : <RegisterPage />} />
        <Route path="/forgot-password" element={PREVIEW_MODE ? <PreviewAuthDisabled /> : <ForgotPasswordPage />} />
        <Route path="/update-password" element={PREVIEW_MODE ? <PreviewAuthDisabled /> : <UpdatePasswordPage />} />
        <Route path="/room/:id" element={<ProtectedRoute><RoomRouteBoundary /></ProtectedRoute>} />
        <Route path="/" element={<Layout />}>
          <Route path="invitations/:secret" element={<InvitationPreviewPage />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route index element={<Navigate to="/groups" replace />} />
            <Route path="groups" element={<StudyRooms />} />
            <Route path="groups/:id" element={<StudyGroupDetail />} />
            <Route path="settings" element={PREVIEW_MODE ? <PreviewAuthDisabled /> : <AccountSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
