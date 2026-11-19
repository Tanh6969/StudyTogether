import { getDb, newId, nowIso, saveDb } from './db';
import { DEFAULT_MOCK_EMAIL } from './seed';
import { MOCK_LATENCY_MS, USE_MOCK } from './config';
import { handleStudyRoomSubroute, mockPassiveDisconnect, MockNotHandled } from './studyRooms';
import type { Group, GroupCreate, GroupMember } from '../lib/group.types';
import type { Profile } from '../lib/profile.types';
import type { Message, MessageListResponse } from '../lib/message.types';
import type { NotificationCategory, UnreadCounts } from '../types/notification';
import type { GroupTask, GroupTaskCreate, GroupTaskUpdate } from '../lib/groupTask.api';
import type { MockDb } from './seed';

const GROUP_TASKS_ROUTE = /^\/groups\/([^/]+)\/tasks(?:\/([^/]+))?$/;

/** Demo board shown the first time a group's task board is opened in mock mode. */
function seedGroupTasks(db: MockDb, groupId: string, viewerId: string): GroupTask[] {
  const timestamp = nowIso();
  const ids = new Map<string, string>();
  const idFor = (key: string) => { if (!ids.has(key)) ids.set(key, newId('gtask')); return ids.get(key)!; };
  const demo: Array<[key: string, title: string, assignee: string, done: boolean, parent: string | null, notes: string[]]> = [
    ['root', 'Xác định mục tiêu và tài liệu cần học', 'Minh Anh', false, null, ['Chốt phạm vi kiến thức', 'Tổng hợp nguồn tham khảo']],
    ['plan', 'Lập kế hoạch học nhóm', 'Tuấn', false, 'root', ['Chia việc theo từng buổi']],
    ['read', 'Ôn lý thuyết và ghi chú', 'Linh', false, 'root', ['Đọc chương 1–3']],
    ['practice', 'Làm bài tập thực hành', 'Hoàng', false, 'plan', ['Mỗi người chọn 3 bài']],
    ['review', 'Rà soát kết quả cùng nhóm', 'Cả nhóm', false, 'plan', []],
    ['room', 'Tạo phòng học và chia sẻ tài liệu', 'Minh Anh', true, null, []],
    ['kickoff', 'Thống nhất lịch học tuần này', 'Cả nhóm', true, null, []],
  ];
  const tasks = demo.map(([key, title, assignee, done, parent, notes]): GroupTask => ({
    id: idFor(key), group_id: groupId, parent_id: parent ? idFor(parent) : null, title, assignee,
    due_date: null, done, notes, position: null, created_by: viewerId, created_at: timestamp, updated_at: timestamp,
  }));
  db.groupTasks = [...(db.groupTasks ?? []), ...tasks];
  return tasks;
}

function handleGroupTasks(db: MockDb, method: MockMethod, groupId: string, taskId: string | undefined, body: unknown, viewerId: string): unknown {
  const all = db.groupTasks ?? [];
  const inGroup = all.filter((task) => task.group_id === groupId);
  if (!taskId && method === 'GET') {
    if (inGroup.length > 0) return inGroup;
    const seeded = seedGroupTasks(db, groupId, viewerId);
    saveDb();
    return seeded;
  }
  if (!taskId && method === 'POST') {
    const input = body as GroupTaskCreate;
    const timestamp = nowIso();
    const task: GroupTask = {
      id: newId('gtask'), group_id: groupId, parent_id: input.parent_id ?? null, title: input.title.trim(),
      assignee: (input.assignee ?? '').trim(), due_date: input.due_date ?? null, done: false, notes: input.notes ?? [],
      position: null, created_by: viewerId, created_at: timestamp, updated_at: timestamp,
    };
    db.groupTasks = [...all, task];
    saveDb();
    return task;
  }
  const task = inGroup.find((item) => item.id === taskId) ?? notFound('Nhiệm vụ');
  if (method === 'PATCH') {
    Object.assign(task, body as GroupTaskUpdate, { updated_at: nowIso() });
    saveDb();
    return task;
  }
  if (method === 'DELETE') {
    const removed = new Set([task.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of all) {
        if (item.parent_id && removed.has(item.parent_id) && !removed.has(item.id)) { removed.add(item.id); grew = true; }
      }
    }
    db.groupTasks = all.filter((item) => !removed.has(item.id));
    saveDb();
    return undefined;
  }
  return notFound(`API mẫu ${method} /groups/${groupId}/tasks`);
}

type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function currentUserId(): string {
  try {
    const raw = localStorage.getItem('dev_session');
    if (raw) {
      const session = JSON.parse(raw) as { user?: { id?: string } };
      if (session.user?.id) return session.user.id;
    }
  } catch {
    // Fall back to the seeded account if browser storage is unavailable or malformed.
  }
  return getDb().users.find((user) => user.email === DEFAULT_MOCK_EMAIL)?.id ?? 'u-minhanh';
}

function userSummary(userId: string) {
  const user = getDb().users.find((item) => item.id === userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    role: user.role,
  };
}

function profile(userId: string): Profile | undefined {
  const user = getDb().users.find((item) => item.id === userId);
  if (!user) return undefined;
  const { email: _email, ...data } = user;
  return data;
}

function groupWithStreak(group: Group): Group {
  return { ...group, streak: getDb().streaks[group.id] };
}

function groupMemberWithUser(member: Omit<GroupMember, 'user'>): GroupMember | null {
  const user = userSummary(member.user_id);
  return user ? { ...member, user } : null;
}

function notFound(resource: string): never {
  throw new Error(`${resource} không tồn tại trong dữ liệu mẫu.`);
}

if (USE_MOCK && typeof window !== 'undefined') {
  // Browser-console helper, mock mode only -- see mockPassiveDisconnect in studyRooms.ts.
  (window as unknown as { mockPassiveDisconnect: (roomId?: string) => number }).mockPassiveDisconnect =
    (roomId?: string) => mockPassiveDisconnect(currentUserId(), roomId);
}

/** Handles the API endpoints needed by the basic, local-only demo. */
export async function mockApiRequest<T>(path: string, method: MockMethod, body?: unknown): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  const url = new URL(path, 'http://mock.local');
  const route = url.pathname.replace(/\/+$/, '') || '/';
  const db = getDb();
  const viewerId = currentUserId();
  let result: unknown;

  if (route === '/auth/me' && method === 'GET') {
    const user = db.users.find((item) => item.id === viewerId);
    result = user ? { id: user.id, email: user.email, role: user.role } : notFound('Tài khoản');
  } else if (route.startsWith('/profiles/') && method === 'GET') {
    result = profile(route.slice('/profiles/'.length)) ?? notFound('Hồ sơ');
  } else if (route === '/moderation/bans/me' && method === 'GET') {
    result = [];
  } else if (route === '/groups' && method === 'GET') {
    const publicOnly = url.searchParams.get('public_only') !== 'false';
    const search = (url.searchParams.get('search') ?? '').toLocaleLowerCase();
    result = db.groups
      .filter((group) => (!publicOnly || group.is_public) && group.name.toLocaleLowerCase().includes(search))
      .map(groupWithStreak);
  } else if (route === '/groups/mine' && method === 'GET') {
    const myGroupIds = new Set(db.groupMembers.filter((member) => member.user_id === viewerId && member.status === 'active').map((member) => member.group_id));
    result = db.groups.filter((group) => myGroupIds.has(group.id)).map(groupWithStreak);
  } else if (route === '/groups/me/memberships' && method === 'GET') {
    result = db.groupMembers
      .filter((member) => member.user_id === viewerId && member.status === 'active')
      .map(groupMemberWithUser)
      .filter((member) => member !== null);
  } else if (route === '/groups/stats/member-counts' && method === 'GET') {
    result = db.groups.reduce<Record<string, number>>((counts, group) => {
      counts[group.id] = db.groupMembers.filter((member) => member.group_id === group.id && member.status === 'active').length;
      return counts;
    }, {});
  } else if (route === '/groups' && method === 'POST') {
    const input = body as GroupCreate;
    const timestamp = nowIso();
    const group: Group = {
      id: newId('group'),
      name: input.name.trim(),
      description: input.description ?? null,
      avatar_url: input.avatar_url ?? null,
      background_url: null,
      owner_id: viewerId,
      invite_code: null,
      is_public: input.is_public ?? true,
      created_at: timestamp,
      updated_at: timestamp,
      streak: { current_streak: 0, highest_streak: 0, today_messages_count: 0, today_study_minutes: 0 },
    };
    db.groups.unshift(group);
    db.streaks[group.id] = group.streak!;
    db.groupMembers.push({
      id: newId('member'),
      group_id: group.id,
      user_id: viewerId,
      role: 'owner',
      status: 'active',
      joined_at: timestamp,
    });
    saveDb();
    result = group;
  } else if (GROUP_TASKS_ROUTE.test(route)) {
    // Must precede the generic '/groups/' branch below, which would otherwise claim it.
    const [, groupId, taskId] = route.match(GROUP_TASKS_ROUTE)!;
    result = handleGroupTasks(db, method, groupId, taskId, body, viewerId);
  } else if (route.startsWith('/groups/')) {
    const segments = route.slice('/groups/'.length).split('/');
    const groupId = segments[0];
    const group = db.groups.find((item) => item.id === groupId);
    if (!group) notFound('Nhóm học');

    if (segments.length === 1 && method === 'GET') {
      result = groupWithStreak(group);
    } else if (segments[1] === 'members' && segments.length === 2 && method === 'GET') {
      result = db.groupMembers
        .filter((member) => member.group_id === groupId && member.status === 'active')
        .map(groupMemberWithUser)
        .filter((member) => member !== null);
    } else if (segments[1] === 'members' && segments.length === 2 && method === 'POST') {
      const existing = db.groupMembers.find((member) => member.group_id === groupId && member.user_id === viewerId);
      if (existing) existing.status = 'active';
      else {
        db.groupMembers.push({
          id: newId('member'),
          group_id: groupId,
          user_id: viewerId,
          role: 'member',
          status: 'active',
          joined_at: nowIso(),
        });
      }
      result = groupMemberWithUser(db.groupMembers.find((member) => member.group_id === groupId && member.user_id === viewerId)!);
      saveDb();
    } else if (segments[1] === 'members' && segments[3] === 'status' && method === 'PUT') {
      const member = db.groupMembers.find((item) => item.group_id === groupId && item.user_id === segments[2]);
      if (!member) notFound('Thành viên');
      member.status = (url.searchParams.get('member_status') ?? 'left') as GroupMember['status'];
      saveDb();
      result = groupMemberWithUser(member);
    } else {
      notFound(`API nhóm ${method} ${route}`);
    }
  } else if (route === '/channels' && method === 'GET') {
    const groupId = url.searchParams.get('group_id');
    result = db.channels.filter((channel) => channel.group_id === groupId && !channel.deleted_at);
  } else if (route.startsWith('/channels/') && method === 'GET') {
    result = db.channels.find((channel) => channel.id === route.slice('/channels/'.length)) ?? notFound('Kênh');
  } else if (/^\/study-rooms\/[^/]+\/.+$/.test(route)) {
    // In-room endpoints (session, join/leave, members, meeting, tasks...) -- see studyRooms.ts.
    try {
      result = handleStudyRoomSubroute(route, url.searchParams, method, body, viewerId);
    } catch (error) {
      if (error instanceof MockNotHandled) notFound(`API mẫu ${method} ${route}`);
      throw error;
    }
  } else if (route === '/study-rooms' && method === 'GET') {
    const groupId = url.searchParams.get('group_id');
    result = db.rooms.filter((room) => room.group_id === groupId && !room.deleted_at);
  } else if (route.startsWith('/study-rooms/') && method === 'GET') {
    result = db.rooms.find((room) => room.id === route.slice('/study-rooms/'.length)) ?? notFound('Phòng học');
  } else if (route === '/notes' && method === 'GET') {
    result = db.notes
      .filter((note) => note.group_id === url.searchParams.get('group_id'))
      .map((note) => ({ ...note, author: userSummary(note.author_id) }));
  } else if (route.startsWith('/notes/') && method === 'GET') {
    const note = db.notes.find((item) => item.id === route.slice('/notes/'.length));
    result = note ? { ...note, author: userSummary(note.author_id) } : notFound('Ghi chú');
  } else if (route === '/resources/files' && method === 'GET') {
    result = db.resources
      .filter((resource) => resource.group_id === url.searchParams.get('group_id'))
      .map((resource) => ({ ...resource, uploader: userSummary(resource.uploader_id) }));
  } else if (/^\/conversations\/[^/]+\/messages$/.test(route) && method === 'GET') {
    const conversationId = route.split('/')[2];
    const items: Message[] = db.messages
      .filter((message) => message.conversation_id === conversationId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((message) => ({
        ...message,
        attachment_url: null,
        sender: userSummary(message.sender_id)!,
        reactions: db.reactions
          .filter((reaction) => reaction.message_id === message.id)
          .reduce<Message['reactions']>((summaries, reaction) => {
            const summary = summaries.find((item) => item.emoji === reaction.emoji);
            if (summary) {
              summary.count += 1;
              summary.reacted_by_me ||= reaction.user_id === viewerId;
            } else {
              summaries.push({ emoji: reaction.emoji, count: 1, reacted_by_me: reaction.user_id === viewerId });
            }
            return summaries;
          }, []),
      }));
    result = { items: items.slice(0, Number(url.searchParams.get('limit') ?? 50)), next_cursor: null } satisfies MessageListResponse;
  } else if (/^\/conversations\/[^/]+\/messages$/.test(route) && method === 'POST') {
    const conversationId = route.split('/')[2];
    const input = body as { content?: string | null; attachment_path?: string | null };
    const timestamp = nowIso();
    const message: Message = {
      id: newId('message'),
      conversation_id: conversationId,
      sender_id: viewerId,
      content: input.content ?? null,
      attachment_path: input.attachment_path ?? null,
      attachment_url: null,
      created_at: timestamp,
      updated_at: timestamp,
      sender: userSummary(viewerId)!,
      reactions: [],
    };
    db.messages.push({
      id: message.id,
      conversation_id: conversationId,
      sender_id: viewerId,
      content: message.content,
      attachment_path: message.attachment_path,
      created_at: timestamp,
      updated_at: timestamp,
    });
    saveDb();
    result = message;
  } else if (route === '/notifications' && method === 'GET') {
    result = db.notifications.filter((item) => item.user_id === viewerId);
  } else if (route === '/notifications/unread-counts' && method === 'GET') {
    const unread = db.notifications.filter((item) => item.user_id === viewerId && !item.is_read);
    const counts: UnreadCounts = { total: unread.length, forum: 0, group: 0, goal: 0, message: 0 };
    unread.forEach((item) => {
      if (item.category !== 'all' && item.category !== 'unread') counts[item.category as Exclude<NotificationCategory, 'all' | 'unread'>] += 1;
    });
    result = counts;
  } else if (route === '/notifications/settings' && method === 'GET') {
    result = db.notificationSettings[viewerId] ?? {
      enable_forum: true, enable_group: true, enable_goal: true, enable_message: true, enable_sound: true,
    };
  } else if (route === '/notifications/settings' && method === 'PUT') {
    db.notificationSettings[viewerId] = {
      enable_forum: true,
      enable_group: true,
      enable_goal: true,
      enable_message: true,
      enable_sound: true,
      ...(body as Partial<(typeof db.notificationSettings)[string]>),
    };
    saveDb();
    result = db.notificationSettings[viewerId];
  } else if (route.startsWith('/tasks') && method === 'GET') {
    result = db.tasks.filter((task) => task.user_id === viewerId);
  } else if (route === '/roadmaps' && method === 'GET') {
    result = db.roadmaps.filter((roadmap) => roadmap.user_id === viewerId);
  } else {
    notFound(`API mẫu ${method} ${route}`);
  }

  return result as T;
}
