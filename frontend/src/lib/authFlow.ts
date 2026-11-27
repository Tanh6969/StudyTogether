import type { AuthError, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Where Supabase should send users back to after clicking a signup confirmation link.
 * Uses the runtime origin so this works for local Vite dev and Vercel production alike. */
export function getEmailConfirmationRedirect(): string {
  return `${window.location.origin}/login`;
}

export const normalizeAuthEmail = (email: string) => email.trim().toLowerCase();

export function validateRegistration(name: string, email: string, password: string, confirmation: string): string | null {
  if (!name.trim() || name.trim().length > 120) return 'Vui lòng nhập họ và tên hợp lệ (tối đa 120 ký tự).';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Địa chỉ email không hợp lệ.';
  if (password.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự.';
  if (new TextEncoder().encode(password).length > 72) return 'Mật khẩu quá dài (tối đa 72 byte).';
  if (password !== confirmation) return 'Mật khẩu xác nhận không khớp.';
  return null;
}

/** Supabase may return an obfuscated user with no identities for an existing confirmed email. */
export function isDuplicateSignup(user: User | null): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}

export function resendSignupConfirmation(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email: normalizeAuthEmail(email),
    options: { emailRedirectTo: getEmailConfirmationRedirect() },
  });
}

/** Maps a Supabase AuthError to a Vietnamese message safe to show end users.
 * Falls back to a generic message rather than leaking raw Supabase/Postgres text. */
export function describeAuthError(err: AuthError): string {
  switch (err.code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Bạn đã yêu cầu gửi email quá nhiều lần. Vui lòng thử lại sau.';
    case 'email_address_not_authorized':
      return 'Hiện chưa thể gửi email xác nhận đến địa chỉ này. Vui lòng liên hệ bộ phận hỗ trợ.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Đăng ký bằng email hiện chưa khả dụng. Vui lòng thử lại sau.';
    case 'same_password':
      return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    case 'otp_expired':
      return 'Liên kết đã hết hạn. Vui lòng yêu cầu liên kết mới.';
    case 'email_address_invalid':
      return 'Địa chỉ email không hợp lệ.';
    case 'weak_password':
      return 'Mật khẩu quá yếu. Vui lòng chọn mật khẩu mạnh hơn.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.';
    case 'email_not_confirmed':
      return 'Email chưa được xác thực. Vui lòng kiểm tra hộp thư của bạn.';
    case 'invalid_credentials':
      return 'Email hoặc mật khẩu không đúng.';
    default:
      break;
  }
  if (!err.status) {
    return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.';
  }
  return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại sau.';
}

const AUTH_URL_ERROR_MESSAGE =
  'Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu gửi lại email xác nhận.';

/** Supabase reports expired/invalid confirmation links via `#error=...` (or `?error=...`)
 * on the redirect target instead of a normal API error, since no request is ever made. */
export function readAuthUrlError(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const search = window.location.search.replace(/^\?/, '');
  const params = [new URLSearchParams(hash), new URLSearchParams(search)];
  if (!params.some(p => p.has('error') || p.has('error_code'))) return null;
  return AUTH_URL_ERROR_MESSAGE;
}

export function clearAuthUrlError(): void {
  window.history.replaceState(null, '', window.location.pathname);
}
