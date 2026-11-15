import { useState } from 'react';
import { Search, Settings } from 'lucide-react';
import { NavLink, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAuthContext } from '../../contexts/auth-context';
import { supabase } from '../../lib/supabase';
import { Avatar } from '../ui/Avatar';
import { NotificationBell } from '../notifications/NotificationBell';
import { USE_MOCK } from '../../mocks/config';

export function Header() {
  const { isLoggedIn, currentUser } = useAuth();
  const { setDevSession, profile } = useAuthContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [headerSearch, setHeaderSearch] = useState(searchParams.get('q') || '');

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const q = headerSearch.trim();
      navigate(q ? `/groups?q=${encodeURIComponent(q)}` : '/groups');
    }
  }

  const handleLogout = async () => {
    navigate('/login');
    setDevSession(null);
    if (!USE_MOCK) await supabase.auth.signOut().catch(() => {});
  };

  return (
    <div style={{width: '100%', background: 'white', borderBottom: '1px #E2E8F0 solid', display: 'flex', justifyContent: 'center', zIndex: 1000, position: 'sticky', top: 0}}>
        <div style={{width: '100%', maxWidth: '100%', paddingLeft: 32, paddingRight: 32, height: 64, justifyContent: 'space-between', alignItems: 'center', display: 'flex'}}>

            {/* ── LEFT: Logo + Nav ── */}
            <div style={{justifyContent: 'flex-start', alignItems: 'center', gap: 24, display: 'flex'}}>
                <Link to="/" style={{textDecoration: 'none'}}>
                    <div style={{color: '#00236F', fontSize: 20, fontFamily: 'Inter', fontWeight: '700', lineHeight: '28px'}}>StudyTogether</div>
                </Link>
            </div>

            {/* ── RIGHT: Search + User ── */}
            <div style={{justifyContent: 'flex-start', alignItems: 'center', gap: 24, display: 'flex'}}>

                {/* ── Group search ── */}
                <div style={{position: 'relative'}}>
                    <div style={{
                        width: 280,
                        paddingTop: 9, paddingBottom: 10, paddingLeft: 40, paddingRight: 12,
                        background: '#F8F9FF', borderRadius: 6,
                        outline: '1px #E2E8F0 solid', outlineOffset: '-1px',
                        display: 'flex', boxSizing: 'border-box',
                    }}>
                        <input
                            type="text"
                            id="header-search-input"
                            placeholder="Tìm nhóm học..."
                            value={headerSearch}
                            onChange={(e) => setHeaderSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            style={{
                                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                                color: '#374151', fontSize: 14, fontFamily: 'Inter', fontWeight: '400',
                            }}
                        />
                    </div>
                    <div style={{left: 12, top: '50%', transform: 'translateY(-50%)', position: 'absolute', display: 'flex', alignItems: 'center', pointerEvents: 'none'}}>
                        <Search size={17} color="#9CA3AF" />
                    </div>
                </div>

                {/* ── User controls ── */}
                {isLoggedIn ? (
                  <>
                    <NotificationBell />
                    <Link to="/settings" aria-label="Cài đặt tài khoản" style={{display: 'flex', alignItems: 'center', color: '#00236F'}}>
                        <Settings size={21} strokeWidth={2.4} />
                    </Link>
                    <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                        <Link to="/settings" aria-label="Trang cài đặt">
                          <Avatar name={currentUser.name} src={profile?.avatarUrl} size="sm" style={{ cursor: 'pointer' }} />
                        </Link>
                        <div
                          onClick={handleLogout}
                          style={{color: '#EF4444', fontSize: 14, fontWeight: '600', cursor: 'pointer'}}
                        >
                          Đăng xuất
                        </div>
                    </div>
                  </>
                ) : (
                  <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                    <NavLink to="/login" style={{color: '#0F172A', fontSize: 14, fontWeight: '600', textDecoration: 'none'}}>Đăng nhập</NavLink>
                    <NavLink to="/register" style={{padding: '8px 16px', background: '#00236F', color: 'white', fontSize: 14, fontWeight: '600', borderRadius: 8, textDecoration: 'none'}}>Đăng ký</NavLink>
                  </div>
                )}
            </div>
        </div>
    </div>
  );
}
