import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { describeAuthError, getEmailConfirmationRedirect, normalizeAuthEmail, resendSignupConfirmation, validateRegistration, isDuplicateSignup } from '../lib/authFlow';
import { useResendCooldown } from '../hooks/useResendCooldown';

export function RegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const busy = useRef(false);
  const { cooldown, start: startCooldown } = useResendCooldown();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || pendingEmail) return;
    setError(null);
    setInfo(null);
    const name = fullName.trim();
    const address = normalizeAuthEmail(email);
    const validation = validateRegistration(name, address, password, confirmPassword);
    if (validation) { setError(validation); return; }
    busy.current = true;
    setIsSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: { data: { full_name: name }, emailRedirectTo: getEmailConfirmationRedirect() },
      });
      if (signUpError) { setError(describeAuthError(signUpError)); return; }
      if (data.session) { navigate('/', { replace: true }); return; }
      if (isDuplicateSignup(data.user)) {
        setError('Email này đã được đăng ký. Vui lòng đăng nhập hoặc khôi phục mật khẩu.');
        return;
      }
      if (!data.user) { setError('Chưa thể hoàn tất đăng ký. Vui lòng thử lại.'); return; }
      setPendingEmail(address);
      setPassword('');
      setConfirmPassword('');
      startCooldown();
      setInfo('Vui lòng kiểm tra hộp thư đến và thư rác, sau đó mở liên kết xác nhận để kích hoạt tài khoản.');
    } catch {
      setError('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      busy.current = false;
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail || busy.current || cooldown > 0) return;
    busy.current = true;
    setIsResending(true);
    setError(null);
    setInfo(null);
    try {
      const { error: resendError } = await resendSignupConfirmation(pendingEmail);
      if (resendError) { setError(describeAuthError(resendError)); return; }
      setInfo('Yêu cầu gửi lại đã được tiếp nhận. Vui lòng kiểm tra hộp thư đến và thư rác.');
      startCooldown();
    } catch {
      setError('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      busy.current = false;
      setIsResending(false);
    }
  };

  return (
    <div style={{minHeight: '100vh', width: '100%', background: 'linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24}}>
      <div style={{width: '100%', maxWidth: 420, background: 'white', borderRadius: 24, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', overflow: 'hidden'}}>
        
        <div style={{padding: '40px 40px 32px'}}>
          <div style={{textAlign: 'center', marginBottom: 32}}>
            <h1 style={{fontSize: 28, fontWeight: '800', color: '#00236F', margin: '0 0 8px 0'}}>Tạo tài khoản</h1>
            <p style={{color: '#64748B', fontSize: 15, margin: 0}}>Tham gia cộng đồng học tập trực tuyến</p>
          </div>

          {pendingEmail ? (
            <section aria-label="Xác nhận email" style={{display: 'grid', gap: 16}}>
              <h2 style={{fontSize: 20, margin: 0, color: '#00236F'}}>Xác nhận email của bạn</h2>
              <p style={{overflowWrap: 'anywhere', margin: 0}}>Email: <strong>{pendingEmail}</strong></p>
              {info && <p role="status" style={{color: '#15803D', margin: 0}}>{info}</p>}
              {error && <p role="alert" style={{color: '#B91C1C', margin: 0}}>{error}</p>}
              <button type="button" disabled={isResending || cooldown > 0} onClick={handleResend} style={{padding: 12, border: '1px solid #CBD5E1', borderRadius: 12, color: '#00236F', background: '#F8FAFC', fontWeight: 600}}>
                {isResending ? 'Đang gửi...' : cooldown > 0 ? `Gửi lại email xác nhận (${cooldown}s)` : 'Gửi lại email xác nhận'}
              </button>
              <button type="button" disabled={isResending} onClick={() => { setPendingEmail(null); setInfo(null); setError(null); }} style={{padding: 12, color: '#00236F', borderRadius: 12, border: '1px solid #CBD5E1', background: 'white'}}>Dùng email khác</button>
              <Link to="/login">Đã xác nhận? Đăng nhập</Link>
            </section>
          ) : <form onSubmit={handleRegister} style={{display: 'flex', flexDirection: 'column', gap: 20}}>
            <div>
              <label style={{display: 'block', fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 8}} htmlFor="register-name">Họ và tên</label>
              <div style={{position: 'relative'}}>
                <User size={18} color="#94A3B8" style={{position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)'}} />
                <input
                  id="register-name"
                  autoComplete="name"
                  type="text"
                  maxLength={120}
                  disabled={isSubmitting}
                  required
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  style={{width: '100%', padding: '12px 16px 12px 42px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, outline: 'none', fontSize: 15, color: '#0F172A', boxSizing: 'border-box', transition: 'border-color 0.2s'}}
                  onFocus={e => e.currentTarget.style.borderColor = '#3B82F6'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                />
              </div>
            </div>

            <div>
              <label style={{display: 'block', fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 8}} htmlFor="register-email">Email</label>
              <div style={{position: 'relative'}}>
                <Mail size={18} color="#94A3B8" style={{position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)'}} />
                <input
                  id="register-email"
                  autoComplete="email"
                  type="email"
                  maxLength={254}
                  disabled={isSubmitting}
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nhapemail@example.com"
                  style={{width: '100%', padding: '12px 16px 12px 42px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, outline: 'none', fontSize: 15, color: '#0F172A', boxSizing: 'border-box', transition: 'border-color 0.2s'}}
                  onFocus={e => e.currentTarget.style.borderColor = '#3B82F6'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                />
              </div>
            </div>

            <div>
              <label style={{display: 'block', fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 8}} htmlFor="register-password">Mật khẩu</label>
              <div style={{position: 'relative'}}>
                <Lock size={18} color="#94A3B8" style={{position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)'}} />
                <input
                  id="register-password"
                  autoComplete="new-password"
                  type="password"
                  required
                  disabled={isSubmitting}
                  minLength={8}
                  maxLength={72}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{width: '100%', padding: '12px 16px 12px 42px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, outline: 'none', fontSize: 15, color: '#0F172A', boxSizing: 'border-box', transition: 'border-color 0.2s'}}
                  onFocus={e => e.currentTarget.style.borderColor = '#3B82F6'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                />
              </div>
            </div>

            <div>
              <label htmlFor="register-confirm" style={{display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8}}>Xác nhận mật khẩu</label>
              <input id="register-confirm" autoComplete="new-password" type="password" required disabled={isSubmitting} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{width: '100%', padding: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, boxSizing: 'border-box'}} />
              <p style={{fontSize: 12, color: '#64748B', margin: '8px 0 0'}}>Mật khẩu từ 8 ký tự trở lên.</p>
            </div>
            {error && (
              <div role="alert" style={{color: '#B91C1C', fontSize: 14}}>{error}{error.startsWith('Email này đã được đăng ký') && <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8}}><Link to="/login">Đăng nhập</Link><Link to="/forgot-password">Quên mật khẩu?</Link></div>}</div>
            )}
            {info && (
              <p style={{color: '#16A34A', fontSize: 14, margin: 0}}>{info}</p>
            )}

            <button type="submit" disabled={isSubmitting} style={{width: '100%', marginTop: 8, padding: '14px', background: '#00236F', color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: '600', cursor: isSubmitting ? 'default' : 'pointer', opacity: isSubmitting ? 0.7 : 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, transition: 'background 0.2s'}} onMouseOver={e => e.currentTarget.style.background = '#1E3A8A'} onMouseOut={e => e.currentTarget.style.background = '#00236F'}>
              {isSubmitting ? 'Đang đăng ký...' : 'Đăng ký tài khoản'}
              <ArrowRight size={18} />
            </button>
          </form>}

          <div style={{marginTop: 32, textAlign: 'center'}}>
            <p style={{color: '#64748B', fontSize: 14, margin: 0}}>
              Đã có tài khoản? <Link to="/login" style={{color: '#00236F', fontWeight: '700', textDecoration: 'none'}}>Đăng nhập ngay</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
