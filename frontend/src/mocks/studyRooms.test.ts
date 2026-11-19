import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetMockDb } from './db';
import { handleStudyRoomSubroute, mockPassiveDisconnect, MockNotHandled } from './studyRooms';
import type { StudyRoomMember, StudyRoomSession } from '../lib/studyRoom.types';

const ROOM = 'r-react-hooks';
const VIEWER = 'u-quocbao';
const call = (route: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown, search = '') =>
  handleStudyRoomSubroute(route, new URLSearchParams(search), method, body, VIEWER);

describe('mock study-room endpoints (no backend, no database)', () => {
  beforeEach(() => resetMockDb());

  it('lets a demo account join, see its session, and leave', () => {
    expect((call(`/study-rooms/${ROOM}/session`) as StudyRoomSession).member).toBeNull();

    const joined = call(`/study-rooms/${ROOM}/join`, 'POST') as StudyRoomMember;
    expect(joined.left_at).toBeNull();
    expect(joined.user.id).toBe(VIEWER);
    const session = call(`/study-rooms/${ROOM}/session`) as StudyRoomSession;
    expect(session.can_connect).toBe(true);

    const left = call(`/study-rooms/${ROOM}/leave`, 'POST', undefined, `expected_joined_at=${encodeURIComponent(joined.joined_at)}`) as StudyRoomMember;
    expect(left.left_at).not.toBeNull();
  });

  it('a stale leave (older join generation) does not close a newer join', () => {
    call(`/study-rooms/${ROOM}/join`, 'POST');
    const member = call(`/study-rooms/${ROOM}/leave`, 'POST', undefined, 'expected_joined_at=2000-01-01T00:00:00Z') as StudyRoomMember;
    expect(member.left_at).toBeNull();
  });

  it('the meeting token fails clearly instead of pretending a video server exists', () => {
    expect(call(`/study-rooms/${ROOM}/meeting/claim`, 'POST')).toEqual({ active: true });
    expect(() => call(`/study-rooms/${ROOM}/meeting/token`, 'POST')).toThrow(/không có máy chủ video/);
  });

  it('mockPassiveDisconnect closes the membership like the LiveKit webhook would', () => {
    call(`/study-rooms/${ROOM}/join`, 'POST');
    expect(mockPassiveDisconnect(VIEWER, ROOM)).toBe(1);
    expect((call(`/study-rooms/${ROOM}/session`) as StudyRoomSession).can_connect).toBe(false);
    expect(getDb().roomMembers.find((m) => m.room_id === ROOM && m.user_id === VIEWER)?.left_at).not.toBeNull();
  });

  it('room tasks support create / doing / done / delete', () => {
    const task = call(`/study-rooms/${ROOM}/tasks`, 'POST', { title: '  Ôn hooks  ' }) as { id: string; title: string };
    expect(task.title).toBe('Ôn hooks');
    expect((call(`/study-rooms/${ROOM}/tasks/${task.id}`, 'PATCH', { status: 'done' }) as { done_at: string | null }).done_at).not.toBeNull();
    call(`/study-rooms/${ROOM}/tasks/${task.id}`, 'DELETE');
    expect(call(`/study-rooms/${ROOM}/tasks`)).toEqual([]);
  });

  it('ignores routes that are not in-room endpoints', () => {
    expect(() => call(`/study-rooms/${ROOM}`)).toThrow(MockNotHandled);
  });
});
