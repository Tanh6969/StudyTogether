import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudyRooms } from './StudyGroups';
import { getGroups, getMyGroups, getMemberCounts, getMyMemberships, joinGroup } from '../../lib/group.api';
import type { Group, GroupMember } from '../../lib/group.types';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me' }, getBan: () => null }),
}));
vi.mock('../../lib/group.api', () => ({
  getGroups: vi.fn(),
  getMyGroups: vi.fn(),
  getMemberCounts: vi.fn(),
  getMyMemberships: vi.fn(),
  createGroup: vi.fn(),
  joinGroup: vi.fn(),
}));
vi.mock('../../hooks/useLiveCollectionRefresh', () => ({
  useLiveCollectionRefresh: () => {},
}));
vi.mock('../../components/invitations/JoinByCodeModal', () => ({
  JoinByCodeModal: () => null,
}));

const group: Group = {
  id: 'g-1',
  name: 'Nhóm kiểm thử',
  description: 'Nhóm công khai',
  avatar_url: null,
  background_url: null,
  owner_id: 'other',
  invite_code: null,
  is_public: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function membership(status: GroupMember['status'], role: GroupMember['role'] = 'member'): GroupMember {
  return {
    id: 'membership-1',
    group_id: group.id,
    user_id: 'me',
    status,
    role,
    joined_at: group.created_at,
    user: { id: 'me', username: 'tester', display_name: 'Tester', avatar_url: null, role: 'user' },
  };
}

function loadGroup(status: GroupMember['status']) {
  vi.mocked(getGroups).mockResolvedValue([group]);
  vi.mocked(getMyGroups).mockResolvedValue(status === 'active' ? [group] : []);
  vi.mocked(getMemberCounts).mockResolvedValue({ [group.id]: status === 'active' ? 2 : 1 });
  vi.mocked(getMyMemberships).mockResolvedValue([membership(status, 'moderator')]);
  render(<MemoryRouter initialEntries={['/groups']}><StudyRooms /></MemoryRouter>);
}

describe('StudyGroups membership truth', () => {
  beforeEach(() => vi.resetAllMocks());

  it('displays a left member in discovery and offers to rejoin, not in my groups', async () => {
    loadGroup('left');
    await waitFor(() => expect(screen.getByText('Nhóm học của tôi (0)')).toBeInTheDocument());
    expect(screen.getByText('Khám phá nhóm học (1)')).toBeInTheDocument();
    const discovery = screen.getByRole('region', { name: 'Khám phá nhóm học' });
    expect(within(discovery).getByText('Tham gia')).toBeInTheDocument();
    expect(within(discovery).queryByText('Vào nhóm')).not.toBeInTheDocument();
  });

  it('does not offer self-join to a banned former member', async () => {
    loadGroup('banned');
    await waitFor(() => expect(screen.getByText('Nhóm học của tôi (0)')).toBeInTheDocument());
    const discovery = screen.getByRole('region', { name: 'Khám phá nhóm học' });
    expect(within(discovery).getByText('Đã bị cấm')).toBeInTheDocument();
    expect(within(discovery).queryByText('Tham gia')).not.toBeInTheDocument();
  });

  it('still keeps active private or public groups in my groups', async () => {
    loadGroup('active');
    await waitFor(() => expect(screen.getByText('Nhóm học của tôi (1)')).toBeInTheDocument());
    expect(screen.getByText('Khám phá nhóm học (0)')).toBeInTheDocument();
  });

  it('can rejoin a previously left public group', async () => {
    loadGroup('left');
    vi.mocked(joinGroup).mockImplementation(async () => {
      vi.mocked(getMyGroups).mockResolvedValue([group]);
      vi.mocked(getMyMemberships).mockResolvedValue([membership('active')]);
      return membership('active');
    });
    const discovery = await screen.findByRole('region', { name: 'Khám phá nhóm học' });
    fireEvent.click(within(discovery).getByText('Tham gia'));
    const modal = screen.getByRole('heading', { name: 'Tham gia nhóm' }).closest('div');
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal!.parentElement as HTMLElement).getByRole('button', { name: 'Tham gia' }));
    await waitFor(() => expect(screen.getByText('Nhóm học của tôi (1)')).toBeInTheDocument());
    expect(joinGroup).toHaveBeenCalledWith('g-1');
  });
});

describe('home sorting', () => {
  beforeEach(() => vi.resetAllMocks());
  it('sorts both membership and discovery, not just the label', async () => {
    const a = { ...group, id: 'a', name: 'Alpha', created_at: '2025-01-01T00:00:00Z', is_public: false };
    const b = { ...group, id: 'b', name: 'Beta', created_at: '2026-01-01T00:00:00Z' };
    const c = { ...group, id: 'c', name: 'Charlie', created_at: '2025-01-01T00:00:00Z' };
    const d = { ...group, id: 'd', name: 'Delta', created_at: '2026-01-01T00:00:00Z' };
    vi.mocked(getGroups).mockResolvedValue([c, d, b]);
    vi.mocked(getMyGroups).mockResolvedValue([a, b]);
    vi.mocked(getMyMemberships).mockResolvedValue([{ ...membership('active', 'owner'), group_id: 'a' }, { ...membership('active'), group_id: 'b' }]);
    vi.mocked(getMemberCounts).mockResolvedValue({ a: 9, b: 1, c: 8, d: 2 });
    render(<MemoryRouter initialEntries={['/groups']}><StudyRooms /></MemoryRouter>);
    const mine = await screen.findByRole('region', { name: 'Nhóm học của tôi' });
    const discovery = screen.getByRole('region', { name: 'Khám phá nhóm học' });
    const order = (region: HTMLElement, first: string, second: string) =>
      expect(within(region).getByText(first).compareDocumentPosition(within(region).getByText(second)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Sắp xếp nhóm học' });
    order(mine, 'Beta', 'Alpha'); order(discovery, 'Delta', 'Charlie');
    for (const value of ['oldest', 'members', 'name', 'role']) {
      fireEvent.change(select, { target: { value } });
      order(mine, 'Alpha', 'Beta');
      if (value !== 'role') order(discovery, 'Charlie', 'Delta');
    }
    fireEvent.change(select, { target: { value: 'newest' } });
    order(mine, 'Beta', 'Alpha'); order(discovery, 'Delta', 'Charlie');
    expect(within(discovery).queryByText('Alpha')).not.toBeInTheDocument();
  });
});
