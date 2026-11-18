import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './index';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: true, loading: false }),
}));
vi.mock('../pages/StudyGroup/studyRoomPage', async () => {
  const { useParams } = await import('react-router-dom');
  return {
    LazyStudyRoom: () => {
      const { id } = useParams();
      if (id === 'crashing-room') throw new Error('Simulated room render error');
      return <div data-testid="healthy-room">Loaded {id}</div>;
    },
  };
});

describe('StudyRoom page crash isolation', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('does not leave a white screen and provides recovery controls', async () => {
    render(
      <MemoryRouter initialEntries={['/room/crashing-room']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    const fallback = await screen.findByRole('alert');
    expect(fallback).toHaveTextContent('Không thể hiển thị phòng học');
    expect(screen.getByRole('button', { name: 'Tải lại phòng' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay về nhóm' })).toHaveAttribute('href', '/groups');
  });

  it('resets the boundary on a different room, preserving navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/room/crashing-room']}>
        <Link to="/room/healthy-room">Mở phòng khác</Link>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByText('Không thể hiển thị phòng học');

    fireEvent.click(screen.getByRole('link', { name: 'Mở phòng khác' }));
    expect(await screen.findByTestId('healthy-room')).toHaveTextContent('healthy-room');
    expect(screen.queryByText('Không thể hiển thị phòng học')).not.toBeInTheDocument();
  });
});
