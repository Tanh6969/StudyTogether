import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './Header';

const auth = vi.hoisted(() => ({ isLoggedIn: true }));
const bellProps = vi.hoisted(() => [] as Array<{ placement?: string; variant?: string }>);

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true })); // phone screen
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: auth.isLoggedIn, currentUser: { name: 'Test user' } }),
}));
vi.mock('../../contexts/auth-context', () => ({
  useAuthContext: () => ({ setDevSession: vi.fn(), profile: null }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('../../mocks/config', () => ({ USE_MOCK: false }));
vi.mock('../notifications/NotificationBell', () => ({
  NotificationBell: (props: { placement?: string; variant?: string }) => {
    bellProps.push(props);
    return <button type="button" aria-label="Thông báo" />;
  },
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/groups']}>
      <Header />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const island = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });
/** Accessible names of the island's links and buttons, in on-screen (DOM) order. */
const tabNames = () =>
  Array.from(island().querySelectorAll('a, button')).map((el) => el.getAttribute('aria-label'));

describe('Header on phones: icon-only search + rearranged bottom island', () => {
  beforeEach(() => {
    auth.isLoggedIn = true;
    bellProps.length = 0;
  });

  it('shows only a 🔍 icon in the island -- no search field until it is tapped', () => {
    renderHeader();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(island()).getByRole('button', { name: 'Tìm kiếm' })).toBeInTheDocument();
  });

  it('orders the island tabs: Nhóm · Tìm kiếm · Thông báo · Tôi · Thoát', () => {
    renderHeader();
    const names = tabNames();
    expect(names).toEqual(['Nhóm học', 'Tìm kiếm', 'Thông báo', 'Trang cài đặt', 'Đăng xuất']);
    expect(bellProps.at(-1)).toEqual({ placement: 'above', variant: 'tab' });
  });

  it('opens a focused search panel at the top; Enter searches and closes it', async () => {
    renderHeader();
    await userEvent.click(within(island()).getByRole('button', { name: 'Tìm kiếm' }));

    const panel = screen.getByRole('dialog', { name: 'Tìm nhóm học' });
    const input = within(panel).getByRole('searchbox', { name: 'Tìm nhóm học' });
    expect(input).toHaveFocus();

    await userEvent.type(input, 'toán');
    expect(within(panel).getByText('toán')).toBeInTheDocument(); // "Tìm nhóm có tên “toán”" row
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('location')).toHaveTextContent('/groups?q=to%C3%A1n');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears the text with ✕ and closes with "Hủy" or Escape, returning focus to the 🔍 tab', async () => {
    renderHeader();
    const searchTab = within(island()).getByRole('button', { name: 'Tìm kiếm' });

    await userEvent.click(searchTab);
    await userEvent.type(screen.getByRole('searchbox'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Xóa nội dung tìm kiếm' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(searchTab).toHaveFocus();

    await userEvent.click(searchTab);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('signed out: Nhóm · Tìm kiếm · Đăng nhập · Đăng ký', () => {
    auth.isLoggedIn = false;
    renderHeader();
    const names = tabNames();
    expect(names).toEqual(['Nhóm học', 'Tìm kiếm', 'Đăng nhập', 'Đăng ký']);
  });
});
