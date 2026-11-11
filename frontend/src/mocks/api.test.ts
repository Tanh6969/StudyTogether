import { beforeEach, describe, expect, it } from 'vitest';
import { mockApiRequest } from './api';
import { resetMockDb } from './db';
import type { Group } from '../lib/group.types';

describe('mock API', () => {
  beforeEach(() => {
    resetMockDb();
    localStorage.setItem('dev_session', JSON.stringify({ user: { id: 'u-minhanh' } }));
  });

  it('lists seeded public groups and supports searching', async () => {
    const groups = await mockApiRequest<Group[]>('/groups/?public_only=true&search=IELTS', 'GET');

    expect(groups.map((group) => group.id)).toEqual(['g-ielts']);
    expect(groups[0].streak?.current_streak).toBe(12);
  });

  it('creates a group and adds its owner membership', async () => {
    const created = await mockApiRequest<Group>('/groups/', 'POST', {
      name: 'Nhóm demo mới',
      description: 'Cùng học mỗi ngày',
      is_public: true,
    });
    const memberships = await mockApiRequest<Array<{ group_id: string; role: string }>>('/groups/me/memberships', 'GET');

    expect(created.name).toBe('Nhóm demo mới');
    expect(memberships).toContainEqual(expect.objectContaining({ group_id: created.id, role: 'owner' }));
  });

  it('joins a seeded group', async () => {
    await mockApiRequest('/groups/g-react/members', 'POST');
    const memberships = await mockApiRequest<Array<{ group_id: string }>>('/groups/me/memberships', 'GET');

    expect(memberships).toContainEqual(expect.objectContaining({ group_id: 'g-react' }));
  });
});
