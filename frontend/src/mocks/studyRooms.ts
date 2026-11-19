/**
 * Mock-mode handlers for the in-room endpoints (/study-rooms/{id}/...), so the room page --
 * lobby, call layout, sidebar, phone UX, "disconnected" screen -- can be exercised with no
 * backend, no Supabase database and no LiveKit server.
 *
 * There is no video server in mock mode: the meeting token request fails on purpose, and the
 * video area shows that error while the rest of the room stays usable.
 */
import { getDb, newId, nowIso, saveDb } from './db';
import type { MockDb, MockRoomMember } from './seed';
import type { RoomModerationAction, StudyRoom, StudyRoomMember, StudyRoomSession } from '../lib/studyRoom.types';
import type { RoomTask, RoomTaskStatus } from '../lib/roomTask.api';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type MockRoomTask = Omit<RoomTask, 'user'>;
type RoomDb = MockDb & { roomTasks?: MockRoomTask[] };

const ROOM_SUBROUTE = /^\/study-rooms\/([^/]+)\/(.+)$/;

export class MockNotHandled extends Error {}

function userSummary(db: MockDb, userId: string) {
  const user = db.users.find((item) => item.id === userId);
  return user
    ? { id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, role: user.role }
    : { id: userId, username: 'unknown', display_name: 'Người dùng', avatar_url: null, role: 'user' };
}

function withUser(db: MockDb, member: MockRoomMember): StudyRoomMember {
  return { ...member, user: userSummary(db, member.user_id) } as StudyRoomMember;
}

function findRoom(db: MockDb, roomId: string): StudyRoom {
  const room = db.rooms.find((item) => item.id === roomId && !item.deleted_at);
  if (!room) throw new Error('Phòng học không tồn tại trong dữ liệu mẫu.');
  return room;
}

/** Returns `undefined` handled-result as a value; throws MockNotHandled when the route isn't ours. */
export function handleStudyRoomSubroute(
  route: string, search: URLSearchParams, method: Method, body: unknown, viewerId: string,
): unknown {
  const match = ROOM_SUBROUTE.exec(route);
  if (!match) throw new MockNotHandled();
  const [, roomId, rest] = match;
  const db = getDb() as RoomDb;
  const room = findRoom(db, roomId);
  const mine = () => db.roomMembers.find((m) => m.room_id === roomId && m.user_id === viewerId);

  if (rest === 'session' && method === 'GET') {
    const member = mine();
    const session: StudyRoomSession = {
      room_id: roomId,
      room_status: room.status,
      member: member ? withUser(db, member) : null,
      can_connect: !!member && !member.left_at,
    };
    return session;
  }
  if (rest === 'members' && method === 'GET') {
    const activeOnly = search.get('active_only') === 'true';
    return db.roomMembers
      .filter((m) => m.room_id === roomId && (!activeOnly || !m.left_at))
      .map((m) => withUser(db, m));
  }
  if (rest === 'presence' && method === 'GET') {
    return db.roomMembers.filter((m) => m.room_id === roomId && !m.left_at).map((m) => withUser(db, m));
  }
  if (rest === 'join' && method === 'POST') {
    let member = mine();
    if (member && member.left_at) {
      member.joined_at = nowIso();
      member.left_at = null;
    } else if (!member) {
      member = { id: newId('rm'), room_id: roomId, user_id: viewerId, role: 'participant', joined_at: nowIso(), left_at: null };
      db.roomMembers.push(member);
    }
    saveDb();
    return withUser(db, member);
  }
  if (rest === 'leave' && method === 'POST') {
    const member = mine();
    if (!member) throw new Error('Thành viên không tồn tại trong dữ liệu mẫu.');
    const expected = search.get('expected_joined_at');
    // Same generation rule as the backend: a stale tab cannot close a newer join.
    if (!member.left_at && (!expected || expected === member.joined_at)) {
      member.left_at = nowIso();
      saveDb();
    }
    return withUser(db, member);
  }
  if (rest === 'moderation' && method === 'GET') {
    return db.roomModeration.filter((a) => a.room_id === roomId);
  }
  if (rest === 'moderation' && method === 'POST') {
    const input = body as Pick<RoomModerationAction, 'target_user_id' | 'action' | 'reason'>;
    const action: RoomModerationAction = {
      id: newId('mod'), room_id: roomId, moderator_id: viewerId,
      target_user_id: input.target_user_id, action: input.action, reason: input.reason ?? null, created_at: nowIso(),
    };
    db.roomModeration.push(action);
    if (action.action === 'kick') {
      const target = db.roomMembers.find((m) => m.room_id === roomId && m.user_id === action.target_user_id);
      if (target && !target.left_at) target.left_at = nowIso();
    }
    saveDb();
    return action;
  }
  if (rest === 'meeting/claim' && method === 'POST') return { active: true };
  if (rest === 'meeting/owner' && method === 'GET') return { active: true };
  if (rest === 'meeting/token' && method === 'POST') {
    throw new Error('Chế độ demo không có máy chủ video (LiveKit). Các phần khác của phòng vẫn dùng được.');
  }
  if (rest === 'activities' && method === 'GET') return [];

  if (rest === 'tasks' || rest.startsWith('tasks/')) {
    const all = db.roomTasks ?? [];
    const withTaskUser = (task: MockRoomTask): RoomTask => ({ ...task, user: userSummary(db, task.user_id) } as RoomTask);
    const taskId = rest.split('/')[1];
    if (!taskId && method === 'GET') return all.filter((t) => t.room_id === roomId).map(withTaskUser);
    if (!taskId && method === 'POST') {
      const timestamp = nowIso();
      const task: MockRoomTask = {
        id: newId('rtask'), room_id: roomId, user_id: viewerId, title: String((body as { title?: string })?.title ?? '').trim(),
        status: 'todo', done_at: null, created_at: timestamp, updated_at: timestamp,
      };
      db.roomTasks = [...all, task];
      saveDb();
      return withTaskUser(task);
    }
    const task = all.find((t) => t.id === taskId && t.room_id === roomId);
    if (!task) throw new Error('Nhiệm vụ không tồn tại trong dữ liệu mẫu.');
    if (method === 'PATCH') {
      const patch = body as Partial<Pick<RoomTask, 'title' | 'status'>>;
      if (patch.status === 'doing') {
        for (const other of all) if (other.user_id === task.user_id && other.status === 'doing') other.status = 'todo';
      }
      Object.assign(task, patch, {
        updated_at: nowIso(),
        done_at: patch.status === 'done' ? nowIso() : patch.status ? null : task.done_at,
      } satisfies Partial<MockRoomTask> & { status?: RoomTaskStatus });
      saveDb();
      return withTaskUser(task);
    }
    if (method === 'DELETE') {
      db.roomTasks = all.filter((t) => t.id !== taskId);
      saveDb();
      return undefined;
    }
  }

  throw new Error(`API mẫu ${method} ${route} chưa được giả lập.`);
}

/**
 * Dev helper (mock mode only): simulates what the LiveKit `participant_left` webhook does
 * on the server -- closes the current user's membership in a room -- so the phone
 * "disconnected" screen can be seen without any backend. Call it from the browser
 * console, then switch to another tab and back (or toggle the network) to trigger the
 * re-check:  mockPassiveDisconnect()            -- every room
 *            mockPassiveDisconnect('r-react-hooks')
 */
export function mockPassiveDisconnect(viewerId: string, roomId?: string): number {
  const db = getDb();
  let closed = 0;
  for (const member of db.roomMembers) {
    if (member.user_id === viewerId && !member.left_at && (!roomId || member.room_id === roomId)) {
      member.left_at = nowIso();
      closed += 1;
    }
  }
  saveDb();
  return closed;
}
