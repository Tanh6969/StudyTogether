import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { supabase } from '../../lib/supabase';

const { setDevSession } = vi.hoisted(() => ({ setDevSession: vi.fn() }));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: true, currentUser: { name: 'Test user' } }),
}));
vi.mock('../../contexts/auth-context', () => ({
  useAuthContext: () => ({ setDevSession, profile: null }),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock('../../mocks/config', () => ({ USE_MOCK: false }));
vi.mock('../notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/groups']}>
      <LocationProbe />
      <Header />
    </MemoryRouter>,
  );
}

describe('Header logout lifecycle', () => {
  beforeEach(() => {
    setDevSession.mockReset();
    vi.mocked(supabase.auth.signOut).mockReset();
  });

  it('does not claim logout succeeded if Supabase failed', async () => {
    vi.mocked(supabase.auth.signOut).mockRejectedValue(new Error('Network unavailable'));
    renderHeader();

    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Đăng xuất chưa thành công');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/groups');
    expect(setDevSession).not.toHaveBeenCalled();
  });

  it('clears local auth state and navigates only after Supabase confirms sign out', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    renderHeader();

    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/login'));
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(setDevSession).toHaveBeenCalledWith(null);
  });
});
