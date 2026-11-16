import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { RegisterPage } from './RegisterPage';

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signUp: vi.fn() } },
}));

const mockSignUp = vi.mocked(supabase.auth.signUp);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>Đã vào ứng dụng</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function fillRegistrationForm() {
  fireEvent.change(screen.getByPlaceholderText('Nguyễn Văn A'), { target: { value: 'Nguyen Van A' } });
  fireEvent.change(screen.getByPlaceholderText('nhapemail@example.com'), { target: { value: 'a@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng ký tài khoản' }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
  });

  it('enters the app immediately when Supabase returns a session', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: {} as Session, user: {} as User },
      error: null,
    });

    renderPage();
    fillRegistrationForm();

    expect(await screen.findByText('Đã vào ứng dụng')).toBeInTheDocument();
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'secret123',
      options: { data: { full_name: 'Nguyen Van A' } },
    });
  });

  it('explains that Supabase email confirmation must be disabled when no session is returned', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: {} as User },
      error: null,
    });

    renderPage();
    fillRegistrationForm();

    expect(await screen.findByText(/tắt “Confirm email” trong Authentication/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gửi lại email/i })).not.toBeInTheDocument();
  });
});
