import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LayoutGrid, LogIn, LogOut, Search, Settings, UserPlus, X } from 'lucide-react';
import { NavLink, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAuthContext } from '../../contexts/auth-context';
import { supabase } from '../../lib/supabase';
import { Avatar } from '../ui/Avatar';
import { NotificationBell } from '../notifications/NotificationBell';
import { USE_MOCK } from '../../mocks/config';
import { useIsMobile } from '../../hooks/useIsMobile';

/** Phones: below Tailwind's `sm` breakpoint. Layout.tsx pads the page by the same rule. */
export const PHONE_MEDIA_QUERY = '(max-width: 639.98px)';

/** One evenly sized slot of the phone bottom bar: icon on top, short label under it. */
const TAB_CLASSES =
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-none bg-transparent py-1.5 text-[10px] font-semibold no-underline transition-colors';
const TAB_IDLE = 'text-slate-500 active:bg-slate-100';
const TAB_ACTIVE = 'bg-[#00236F]/10 text-[#00236F]';

function BottomTab({ icon, label, className = '' }: { icon: ReactNode; label: string; className?: string }) {
  return (
    <>
      {icon}
      <span aria-hidden="true" className={`max-w-full truncate ${className}`}>{label}</span>
    </>
  );
}

/**
 * Phone search: a panel that slides down from the TOP of the screen over a dimmed page.
 * It opens at the top (not in the bottom bar) so the on-screen keyboard can never cover
 * the field. Escape, "Hủy" or tapping outside closes it; focus returns to the 🔍 tab.
 */
function MobileSearchPanel({ value, onChange, onSubmit, onClose }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Keep the page behind still while the panel is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const query = value.trim();
  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onSubmit(query);
  };

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-sm animate-[search-backdrop-in_150ms_ease-out] motion-reduce:animate-none"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhóm học"
        className="fixed inset-x-0 top-0 z-61 rounded-b-3xl bg-white px-4 pb-4 pt-[calc(12px+env(safe-area-inset-top))] shadow-2xl animate-[search-sheet-in_200ms_ease-out] motion-reduce:animate-none"
      >
        <form role="search" onSubmit={submit} className="flex items-center gap-2">
          <div className="relative flex h-12 min-w-0 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-100 transition focus-within:border-[#00236F]/40 focus-within:bg-white focus-within:ring-4 focus-within:ring-[#00236F]/10">
            <Search size={20} className="pointer-events-none absolute left-3.5 text-slate-400" />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              id="header-search-input"
              aria-label="Tìm nhóm học"
              placeholder="Tìm nhóm học..."
              value={value}
              onChange={(e) => onChange(e.target.value)}
              // 16px text: iOS Safari zooms the page into smaller inputs.
              className="h-full w-full min-w-0 rounded-2xl border-none bg-transparent pl-11 pr-10 text-base text-slate-800 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
            />
            {value && (
              <button
                type="button"
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => { onChange(''); inputRef.current?.focus(); }}
                className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-full border-none bg-slate-300/70 text-white active:bg-slate-400"
              >
                <X size={15} strokeWidth={3} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border-none bg-transparent px-1 text-[15px] font-semibold text-[#00236F]"
          >
            Hủy
          </button>
        </form>

        <div className="mt-3">
          {query ? (
            <button
              type="button"
              onClick={() => onSubmit(query)}
              className="flex w-full items-center gap-3 rounded-xl border-none bg-[#00236F]/5 px-3 py-3 text-left active:bg-[#00236F]/10"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00236F] text-white">
                <Search size={17} />
              </span>
              <span className="min-w-0 text-sm text-slate-700">
                Tìm nhóm có tên “<strong className="break-all font-semibold text-[#00236F]">{query}</strong>”
              </span>
            </button>
          ) : (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="m-0 text-[13px] text-slate-500">Nhập tên nhóm, ví dụ: IELTS, Giải tích…</p>
              <button
                type="button"
                onClick={() => onSubmit('')}
                className="shrink-0 border-none bg-transparent text-[13px] font-semibold text-[#00236F]"
              >
                Xem tất cả
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function Header() {
  const { isLoggedIn, currentUser } = useAuth();
  const { setDevSession, profile } = useAuthContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [headerSearch, setHeaderSearch] = useState(searchParams.get('q') || '');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const searchTabRef = useRef<HTMLButtonElement>(null);
  // Same breakpoint as Tailwind `sm` (640px): below it, search + user move to the bottom bar.
  const isPhone = useIsMobile(PHONE_MEDIA_QUERY);

  function runSearch(query: string) {
    navigate(query ? `/groups?q=${encodeURIComponent(query)}` : '/groups');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch(headerSearch.trim());
    if (e.key === 'Escape') setHeaderSearch('');
  }

  function closeMobileSearch() {
    setIsMobileSearchOpen(false);
    searchTabRef.current?.focus();
  }

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      // Supabase owns the real session. Never show a successful logout while its API failed.
      // Local scope signs out this browser without unexpectedly revoking other devices.
      if (!USE_MOCK) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
      setDevSession(null);
      navigate('/login', { replace: true });
    } catch {
      setSignOutError('Đăng xuất chưa thành công. Vui lòng thử lại.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const signOutAlert = signOutError && (
    <div role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-center text-xs text-red-600 md:px-8">
      {signOutError}
    </div>
  );

  const logo = (
    <Link to="/" className="shrink-0 text-lg font-bold tracking-tight text-[#00236F] no-underline sm:text-xl">
      StudyTogether
    </Link>
  );

  // ── Phone (< 640px): logo-only top bar + floating bottom "island" ──────────
  if (isPhone) {
    return (
      <>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center justify-center px-4">{logo}</div>
          {signOutAlert}
        </header>

        {/* Floating island above the iPhone home bar. Signed in: Nhóm · Tìm kiếm · Thông báo
            · Tôi · Thoát. Signed out: Nhóm · Tìm kiếm · Đăng nhập · Đăng ký. Logout sits last,
            in red, away from the thumb's most-used middle slots. */}
        <nav
          aria-label="Điều hướng chính"
          className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 flex h-15 items-stretch gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-[0_8px_30px_rgba(15,23,42,0.18)] backdrop-blur"
        >
          <NavLink
            to="/groups"
            aria-label="Nhóm học"
            className={({ isActive }) => `${TAB_CLASSES} ${isActive ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <BottomTab icon={<LayoutGrid size={21} strokeWidth={2.2} />} label="Nhóm" />
          </NavLink>

          <button
            ref={searchTabRef}
            type="button"
            aria-label="Tìm kiếm"
            aria-haspopup="dialog"
            aria-expanded={isMobileSearchOpen}
            onClick={() => setIsMobileSearchOpen(true)}
            className={`${TAB_CLASSES} ${isMobileSearchOpen || headerSearch ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <BottomTab icon={<Search size={21} strokeWidth={2.2} />} label="Tìm kiếm" />
          </button>

          {isLoggedIn ? (
            <>
              <NotificationBell placement="above" variant="tab" />
              <NavLink
                to="/settings"
                aria-label="Trang cài đặt"
                className={({ isActive }) => `${TAB_CLASSES} ${isActive ? TAB_ACTIVE : TAB_IDLE}`}
              >
                <BottomTab
                  icon={<Avatar name={currentUser.name} src={profile?.avatarUrl} size="xs" />}
                  label="Tôi"
                />
              </NavLink>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isSigningOut}
                aria-label="Đăng xuất"
                className={`${TAB_CLASSES} text-red-500 active:bg-red-50 disabled:opacity-60`}
              >
                <BottomTab icon={<LogOut size={21} strokeWidth={2.2} />} label={isSigningOut ? '...' : 'Thoát'} />
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/login"
                aria-label="Đăng nhập"
                className={({ isActive }) => `${TAB_CLASSES} ${isActive ? TAB_ACTIVE : TAB_IDLE}`}
              >
                <BottomTab icon={<LogIn size={21} strokeWidth={2.2} />} label="Đăng nhập" />
              </NavLink>
              <NavLink to="/register" aria-label="Đăng ký" className={`${TAB_CLASSES} bg-[#00236F] text-white`}>
                <BottomTab icon={<UserPlus size={21} strokeWidth={2.2} />} label="Đăng ký" />
              </NavLink>
            </>
          )}
        </nav>

        {isMobileSearchOpen && (
          <MobileSearchPanel
            value={headerSearch}
            onChange={setHeaderSearch}
            onClose={closeMobileSearch}
            onSubmit={(query) => {
              runSearch(query);
              setIsMobileSearchOpen(false);
            }}
          />
        )}
      </>
    );
  }

  // ── Tablet / desktop (≥ 640px): everything in the top header ──────────────
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full items-center justify-between gap-3 px-4 md:px-8">
        {logo}
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {/* Inline pill search, always visible; Enter searches, Esc / ✕ clears. */}
          <div role="search" className="relative">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              enterKeyHint="search"
              id="header-search-input"
              aria-label="Tìm nhóm học"
              placeholder="Tìm nhóm học..."
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-10 w-52 rounded-full border border-slate-200 bg-slate-50 pl-10 pr-9 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:w-64 focus:border-[#00236F]/40 focus:bg-white focus:ring-4 focus:ring-[#00236F]/10 lg:w-72 lg:focus:w-80 [&::-webkit-search-cancel-button]:hidden"
            />
            {headerSearch && (
              <button
                type="button"
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => setHeaderSearch('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border-none bg-slate-200 text-slate-500 hover:bg-slate-300"
              >
                <X size={13} strokeWidth={3} />
              </button>
            )}
          </div>

          {isLoggedIn ? (
            <>
              <NotificationBell />
              <Link
                to="/settings"
                aria-label="Cài đặt tài khoản"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[#00236F] hover:bg-slate-100"
              >
                <Settings size={21} strokeWidth={2.4} />
              </Link>
              <Link to="/settings" aria-label="Trang cài đặt" className="flex shrink-0 rounded-full">
                <Avatar name={currentUser.name} src={profile?.avatarUrl} size="sm" style={{ cursor: 'pointer' }} />
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isSigningOut}
                aria-label="Đăng xuất"
                title="Đăng xuất"
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-500 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
              >
                <LogOut size={18} />
                <span className="hidden md:inline">{isSigningOut ? 'Đang đăng xuất...' : 'Đăng xuất'}</span>
              </button>
            </>
          ) : (
            <div className="flex shrink-0 items-center gap-3">
              <NavLink to="/login" className="px-2 text-sm font-semibold text-slate-900 no-underline hover:text-[#00236F]">
                Đăng nhập
              </NavLink>
              <NavLink
                to="/register"
                className="rounded-lg bg-[#00236F] px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-[#001a52]"
              >
                Đăng ký
              </NavLink>
            </div>
          )}
        </div>
      </div>
      {signOutAlert}
    </header>
  );
}
