import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthApiError, type Session, type User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { RegisterPage } from './RegisterPage';

vi.mock('../lib/supabase', () => ({ supabase: { auth: { signUp: vi.fn(), resend: vi.fn() } } }));
const mockSignUp = vi.mocked(supabase.auth.signUp);
function renderPage() {
  return render(<MemoryRouter initialEntries={['/register']}><Routes>
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/" element={<div>Đã vào ứng dụng</div>} />
  </Routes></MemoryRouter>);
}
function fill(password = 'secret123', confirmation = password, name = ' Nguyen Van A ') {
  fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'A@Example.com' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu', { exact: true }), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký tài khoản' }));
}
describe('Registration lifecycle', () => {
  beforeEach(() => { mockSignUp.mockReset(); });
  it('normalizes input and enters app only with a session', async () => {
    mockSignUp.mockResolvedValue({ data: { session: {} as Session, user: {} as User }, error: null });
    renderPage(); fill();
    expect(await screen.findByText('Đã vào ứng dụng')).toBeInTheDocument();
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'secret123',
      options: { data: { full_name: 'Nguyen Van A' }, emailRedirectTo: window.location.origin + '/login' } });
  });
  it('provides a confirmation state and disables immediate resend', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'new', identities: [{}] } as User }, error: null });
    renderPage(); fill();
    expect(await screen.findByRole('heading', { name: 'Xác nhận email của bạn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gửi lại email xác nhận/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Đăng ký tài khoản' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng email khác' }));
    expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveValue('');
  });
  it('recognizes an existing confirmed email from empty identities', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: { identities: [] } as unknown as User }, error: null });
    renderPage(); fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email này đã được đăng ký');
    expect(screen.queryByRole('heading', { name: 'Xác nhận email của bạn' })).not.toBeInTheDocument();
  });
  it('recognizes an explicit duplicate error', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: new AuthApiError('duplicate', 422, 'user_already_exists') });
    renderPage(); fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email này đã được đăng ký');
  });
  it('rejects mismatched passwords without making a request', async () => {
    renderPage(); fill('secret123', 'secret456');
    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu xác nhận không khớp');
    expect(mockSignUp).not.toHaveBeenCalled();
  });
  it('rejects whitespace-only names', async () => {
    renderPage(); fill('secret123', 'secret123', '   ');
    expect(await screen.findByRole('alert')).toHaveTextContent('họ và tên hợp lệ');
    expect(mockSignUp).not.toHaveBeenCalled();
  });
  it('does not announce success on network failure', async () => {
    mockSignUp.mockRejectedValue(new Error('offline'));
    renderPage(); fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể kết nối');
    expect(screen.getByRole('button', { name: 'Đăng ký tài khoản' })).toBeEnabled();
  });
  it('handles rate limits without falsely reporting success', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: new AuthApiError('limit', 429, 'over_email_send_rate_limit') });
    renderPage(); fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('quá nhiều lần');
  });
  it('does not treat missing user and session as success', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    renderPage(); fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thể hoàn tất đăng ký');
  });
});
