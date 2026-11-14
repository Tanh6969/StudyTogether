/**
 * Dữ liệu mẫu ban đầu cho mock mode. Mọi ngày giờ tính tương đối so với lúc seed,
 * để lịch nhiệm vụ / thông báo luôn trông "mới".
 */
import type { Profile } from '../lib/profile.types';
import type { Group, GroupMember, GroupStreak } from '../lib/group.types';
import type { Channel } from '../lib/channel.types';
import type { StudyRoom, StudyRoomMember, RoomModerationAction } from '../lib/studyRoom.types';
import type { Note } from '../lib/note.types';
import type { Resource } from '../lib/resource.types';
import type { StudyTask } from '../lib/task.api';
import type { Roadmap } from '../lib/roadmap.api';
import type { GroupTask } from '../lib/groupTask.api';
import type { NotificationItem } from '../types/notification';
import type { NotificationSettings } from '../lib/notification.api';
import type { Invitation } from '../lib/invitation.types';
import type { ConversationType } from '../lib/conversation.types';

export type MockUser = Profile & { email: string };
export type MockGroupMember = Omit<GroupMember, 'user'>;
export type MockChannelMember = { id: string; channel_id: string; user_id: string; joined_at: string };
export type MockRoomMember = Omit<StudyRoomMember, 'user'>;
export type MockMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  attachment_path: string | null;
  created_at: string;
  updated_at: string;
};
export type MockReaction = { message_id: string; user_id: string; emoji: string };
export type MockNote = Omit<Note, 'author'>;
export type MockResource = Omit<Resource, 'uploader'>;
export type MockInvitation = Invitation & { code: string | null };

export interface MockDb {
  version: number;
  users: MockUser[];
  groups: Group[];
  streaks: Record<string, GroupStreak>;
  groupMembers: MockGroupMember[];
  channels: Channel[];
  channelMembers: MockChannelMember[];
  conversations: { id: string; type: ConversationType }[];
  messages: MockMessage[];
  reactions: MockReaction[];
  rooms: StudyRoom[];
  roomMembers: MockRoomMember[];
  roomModeration: RoomModerationAction[];
  notes: MockNote[];
  resources: MockResource[];
  tasks: (StudyTask & { user_id: string })[];
  roadmaps: (Roadmap & { user_id: string })[];
  /** Bảng nhiệm vụ nhóm. Optional so demo DBs saved before this field existed keep loading;
   * mocks/api.ts seeds a group's demo board lazily on first read. */
  groupTasks?: GroupTask[];
  notifications: NotificationItem[];
  notificationSettings: Record<string, NotificationSettings>;
  invitations: MockInvitation[];
}

export const MOCK_DB_VERSION = 1;

/** Tài khoản mặc định khi đăng nhập (mật khẩu: xem MOCK_PASSWORD). */
export const DEFAULT_MOCK_EMAIL = 'minhanh@study.local';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createSeed(): MockDb {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const dayOffset = (days: number) => dateKey(new Date(now + days * DAY));

  const user = (id: string, username: string, display_name: string, email: string, extra: Partial<Profile> = {}): MockUser => ({
    id, username, display_name, email,
    avatar_url: null, role: 'user', bio: null, organization: null,
    created_at: ago(90 * DAY), updated_at: ago(10 * DAY),
    ...extra,
  });

  const users: MockUser[] = [
    user('u-minhanh', 'minhanh', 'Minh Anh', DEFAULT_MOCK_EMAIL, { bio: 'Đang ôn IELTS và Giải tích 2.', organization: 'ĐH Bách khoa Hà Nội' }),
    user('u-hoangnam', 'hoangnam', 'Hoàng Nam', 'hoangnam@study.local', { organization: 'ĐH Bách khoa Hà Nội' }),
    user('u-thutrang', 'thutrang', 'Thu Trang', 'thutrang@study.local'),
    user('u-duchuy', 'duchuy', 'Đức Huy', 'duchuy@study.local'),
    user('u-lanphuong', 'lanphuong', 'Lan Phương', 'lanphuong@study.local'),
    user('u-quocbao', 'quocbao', 'Quốc Bảo', 'quocbao@study.local'),
  ];

  const group = (id: string, name: string, description: string, owner_id: string, is_public: boolean, createdDaysAgo: number): Group => ({
    id, name, description, owner_id, is_public,
    avatar_url: null, background_url: null, invite_code: null,
    created_at: ago(createdDaysAgo * DAY), updated_at: ago(2 * DAY),
  });

  const groups: Group[] = [
    group('g-ielts', 'Ôn thi IELTS 7.0', 'Cùng luyện 4 kỹ năng mỗi tối, mục tiêu 7.0 trước kỳ thi tháng 3.', 'u-minhanh', true, 40),
    group('g-giaitich', 'Giải tích 2 – K67', 'Chữa bài tập, chia sẻ đề cũ và ôn thi giữa kỳ, cuối kỳ.', 'u-hoangnam', true, 30),
    group('g-react', 'Lập trình Web với React', 'Học React + TypeScript từ cơ bản, làm project nhỏ mỗi tuần.', 'u-thutrang', true, 20),
    group('g-n3', 'Tiếng Nhật N3', 'Ôn từ vựng, ngữ pháp và đọc hiểu cho kỳ thi JLPT N3.', 'u-quocbao', true, 15),
    group('g-doan', 'Đồ án tốt nghiệp', 'Nhóm kín để họp và theo dõi tiến độ đồ án.', 'u-minhanh', false, 10),
  ];

  const streaks: Record<string, GroupStreak> = {
    'g-ielts': { current_streak: 12, highest_streak: 18, today_messages_count: 7, today_study_minutes: 95 },
    'g-giaitich': { current_streak: 4, highest_streak: 9, today_messages_count: 2, today_study_minutes: 40 },
    'g-react': { current_streak: 0, highest_streak: 5, today_messages_count: 0, today_study_minutes: 0 },
    'g-n3': { current_streak: 2, highest_streak: 6, today_messages_count: 1, today_study_minutes: 25 },
    'g-doan': { current_streak: 1, highest_streak: 3, today_messages_count: 0, today_study_minutes: 0 },
  };

  let gmSeq = 0;
  const gm = (group_id: string, user_id: string, role: MockGroupMember['role'], daysAgo: number): MockGroupMember => ({
    id: `gm-${++gmSeq}`, group_id, user_id, role, status: 'active', joined_at: ago(daysAgo * DAY),
  });
  const groupMembers: MockGroupMember[] = [
    gm('g-ielts', 'u-minhanh', 'owner', 40),
    gm('g-ielts', 'u-hoangnam', 'moderator', 38),
    gm('g-ielts', 'u-thutrang', 'member', 30),
    gm('g-ielts', 'u-duchuy', 'member', 12),
    gm('g-giaitich', 'u-hoangnam', 'owner', 30),
    gm('g-giaitich', 'u-minhanh', 'member', 28),
    gm('g-giaitich', 'u-lanphuong', 'member', 25),
    gm('g-giaitich', 'u-duchuy', 'member', 20),
    gm('g-react', 'u-thutrang', 'owner', 20),
    gm('g-react', 'u-quocbao', 'member', 18),
    gm('g-react', 'u-lanphuong', 'member', 10),
    gm('g-n3', 'u-quocbao', 'owner', 15),
    gm('g-n3', 'u-thutrang', 'member', 9),
    gm('g-doan', 'u-minhanh', 'owner', 10),
    gm('g-doan', 'u-hoangnam', 'member', 10),
  ];

  const conversations: MockDb['conversations'] = [];
  const conv = (id: string, type: ConversationType) => { conversations.push({ id, type }); return id; };

  const channel = (id: string, group_id: string, name: string, created_by: string, is_private = false, description: string | null = null): Channel => ({
    id, group_id, name, description, type: 'text', is_private, created_by,
    created_at: ago(20 * DAY), updated_at: ago(20 * DAY),
    conversation_id: conv(`conv-${id}`, 'channel'), deleted_at: null, deleted_by: null,
  });
  const channels: Channel[] = [
    channel('ch-ielts-chung', 'g-ielts', 'chung', 'u-minhanh', false, 'Kênh trao đổi chung của nhóm'),
    channel('ch-ielts-speaking', 'g-ielts', 'speaking-partner', 'u-minhanh', false, 'Tìm bạn luyện nói'),
    channel('ch-ielts-mods', 'g-ielts', 'ban-quan-tri', 'u-minhanh', true, 'Kênh riêng cho quản trị nhóm'),
    channel('ch-gt-chung', 'g-giaitich', 'chung', 'u-hoangnam'),
    channel('ch-gt-dethi', 'g-giaitich', 'de-thi-cu', 'u-hoangnam'),
    channel('ch-react-chung', 'g-react', 'chung', 'u-thutrang'),
    channel('ch-n3-chung', 'g-n3', 'chung', 'u-quocbao'),
    channel('ch-doan-chung', 'g-doan', 'chung', 'u-minhanh'),
  ];
  const channelMembers: MockChannelMember[] = [
    { id: 'cm-1', channel_id: 'ch-ielts-mods', user_id: 'u-minhanh', joined_at: ago(20 * DAY) },
    { id: 'cm-2', channel_id: 'ch-ielts-mods', user_id: 'u-hoangnam', joined_at: ago(20 * DAY) },
  ];

  const room = (id: string, group_id: string, name: string, host_id: string, status: StudyRoom['status'], description: string | null, startedAgo: number | null): StudyRoom => ({
    id, group_id, name, description, host_id, status, max_participants: 10, is_private: false,
    created_at: ago(3 * DAY), started_at: startedAgo === null ? null : ago(startedAgo), ended_at: null,
    deleted_at: null, deleted_by: null, conversation_id: conv(`conv-${id}`, 'room'),
    whiteboard_state: null, presentation_state: null,
  });
  const rooms: StudyRoom[] = [
    room('r-ielts-speaking', 'g-ielts', 'Luyện Speaking buổi tối', 'u-hoangnam', 'active', 'Part 2 + Part 3, mỗi người 2 đề.', 35 * MIN),
    room('r-ielts-writing', 'g-ielts', 'Chữa Writing Task 2', 'u-minhanh', 'waiting', 'Mang bài viết tuần này lên chữa chung.', null),
    room('r-gt-giuaky', 'g-giaitich', 'Chữa đề giữa kỳ 2024', 'u-hoangnam', 'active', 'Tích phân bội và tích phân đường.', 15 * MIN),
    room('r-react-hooks', 'g-react', 'React Hooks nâng cao', 'u-thutrang', 'waiting', null, null),
    room('r-n3-kanji', 'g-n3', 'Ôn Kanji tuần 5', 'u-quocbao', 'waiting', null, null),
  ];
  let rmSeq = 0;
  const rm = (room_id: string, user_id: string, role: MockRoomMember['role'], minsAgo: number): MockRoomMember => ({
    id: `rm-${++rmSeq}`, room_id, user_id, role, joined_at: ago(minsAgo * MIN), left_at: null,
  });
  const roomMembers: MockRoomMember[] = [
    rm('r-ielts-speaking', 'u-hoangnam', 'host', 35),
    rm('r-ielts-speaking', 'u-thutrang', 'participant', 30),
    rm('r-ielts-speaking', 'u-duchuy', 'participant', 12),
    rm('r-gt-giuaky', 'u-hoangnam', 'host', 15),
    rm('r-gt-giuaky', 'u-lanphuong', 'participant', 10),
  ];

  let msgSeq = 0;
  const messages: MockMessage[] = [];
  const msg = (conversation_id: string, sender_id: string, content: string, minsAgo: number) => {
    const id = `msg-${++msgSeq}`;
    const created_at = ago(minsAgo * MIN);
    messages.push({ id, conversation_id, sender_id, content, attachment_path: null, created_at, updated_at: created_at });
    return id;
  };
  msg('conv-ch-ielts-chung', 'u-hoangnam', 'Chào cả nhóm! Tối nay 8h mình mở phòng luyện Speaking nhé 🎤', 26 * 60);
  msg('conv-ch-ielts-chung', 'u-thutrang', 'Ok, mình sẽ vào. Có ai có bộ đề Part 2 quý này không?', 25 * 60);
  const welcome = msg('conv-ch-ielts-chung', 'u-minhanh', 'Mình vừa up bộ đề lên mục Tài liệu rồi đó, mọi người tải về nha.', 24 * 60);
  msg('conv-ch-ielts-chung', 'u-duchuy', 'Cảm ơn Minh Anh nhiều! 🙏', 23 * 60);
  msg('conv-ch-ielts-chung', 'u-hoangnam', 'Nhắc lại: deadline nộp Writing Task 2 là thứ 6 này.', 90);
  msg('conv-ch-ielts-chung', 'u-thutrang', 'Mình nộp rồi, mọi người chữa giúp mình với nhé.', 40);
  msg('conv-ch-ielts-speaking', 'u-duchuy', 'Ai rảnh luyện nói 30 phút lúc 9h sáng mai không?', 300);
  msg('conv-ch-ielts-speaking', 'u-thutrang', 'Mình rảnh nè!', 280);
  msg('conv-ch-ielts-mods', 'u-hoangnam', 'Tuần sau mình đổi lịch phòng Speaking sang thứ 3, 5 nhé.', 600);
  msg('conv-ch-gt-chung', 'u-hoangnam', 'Mọi người làm xong bài tập chương 3 chưa?', 8 * 60);
  msg('conv-ch-gt-chung', 'u-lanphuong', 'Câu 3.12 tích phân đường mình chưa ra, ai giải giúp với 😭', 7 * 60);
  msg('conv-ch-gt-chung', 'u-minhanh', 'Dùng định lý Green là ra nhanh đó, tối mình gửi lời giải.', 6 * 60);
  msg('conv-ch-gt-dethi', 'u-hoangnam', 'Đề giữa kỳ 3 năm gần nhất mình để trong Tài liệu nhé.', 3 * DAY / MIN);
  msg('conv-ch-react-chung', 'u-thutrang', 'Tuần này mình học useEffect và custom hooks nha mọi người.', 2 * 60);
  msg('conv-ch-n3-chung', 'u-quocbao', '今日も頑張りましょう！Hôm nay ôn 20 chữ Kanji bài 5.', 5 * 60);
  msg('conv-ch-doan-chung', 'u-hoangnam', 'Thứ 4 họp với thầy hướng dẫn lúc 14h nhé.', 20 * 60);
  msg('conv-r-ielts-speaking', 'u-hoangnam', 'Bắt đầu với đề "Describe a place you like to visit" nhé.', 30);
  msg('conv-r-ielts-speaking', 'u-thutrang', 'Ok, mình nói trước 2 phút.', 28);
  msg('conv-r-gt-giuaky', 'u-hoangnam', 'Câu 1 mọi người thử đổi sang toạ độ cực xem.', 12);

  const reactions: MockReaction[] = [
    { message_id: welcome, user_id: 'u-hoangnam', emoji: '❤️' },
    { message_id: welcome, user_id: 'u-duchuy', emoji: '❤️' },
    { message_id: welcome, user_id: 'u-thutrang', emoji: '👍' },
  ];

  const notes: MockNote[] = [
    {
      id: 'note-1', group_id: 'g-ielts', author_id: 'u-minhanh', title: 'Lịch học tuần này',
      content: 'Thứ 2, 4, 6: Speaking 20h–21h\nThứ 3, 5: Writing Task 2\nChủ nhật: Mock test full 4 kỹ năng',
      created_at: ago(3 * DAY), updated_at: ago(3 * DAY),
    },
    {
      id: 'note-2', group_id: 'g-ielts', author_id: 'u-hoangnam', title: 'Từ vựng chủ đề Environment',
      content: 'deforestation, carbon footprint, renewable energy, biodiversity, sustainable development',
      created_at: ago(DAY), updated_at: ago(DAY),
    },
    {
      id: 'note-3', group_id: 'g-giaitich', author_id: 'u-hoangnam', title: 'Phạm vi thi giữa kỳ',
      content: 'Chương 1–3: Tích phân bội, tích phân đường loại 1 & 2, định lý Green.',
      created_at: ago(2 * DAY), updated_at: ago(2 * DAY),
    },
  ];

  const resource = (id: string, group_id: string, uploader_id: string, name: string, file_type: string, file_size: number, daysAgo: number): MockResource => ({
    id, group_id, uploader_id, folder_id: null, name, file_path: `groups/${group_id}/${id}/${name}`,
    file_type, file_size, created_at: ago(daysAgo * DAY), updated_at: ago(daysAgo * DAY),
  });
  const resources: MockResource[] = [
    resource('res-1', 'g-ielts', 'u-minhanh', 'Bo-de-Speaking-Part2-Q4.pdf', 'application/pdf', 1_240_000, 1),
    resource('res-2', 'g-ielts', 'u-hoangnam', 'Writing-Task2-Sample-Band8.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 85_000, 4),
    resource('res-3', 'g-giaitich', 'u-hoangnam', 'De-giua-ky-2021-2023.pdf', 'application/pdf', 2_300_000, 3),
    resource('res-4', 'g-react', 'u-thutrang', 'react-hooks-cheatsheet.png', 'image/png', 410_000, 2),
  ];

  let taskSeq = 0;
  const task = (title: string, days: number, priority: 1 | 2 | 3, done = false) => ({
    id: `task-${++taskSeq}`, user_id: 'u-minhanh', title, due_date: dayOffset(days), priority,
    completed_at: done ? ago(days < 0 ? -days * DAY : HOUR) : null, created_at: ago(5 * DAY),
  });
  const tasks: MockDb['tasks'] = [
    task('Làm 2 đề Reading Cambridge 17', -2, 2, true),
    task('Học 30 từ vựng chủ đề Environment', -1, 2, true),
    task('Nộp Writing Task 2 – đề Technology', -1, 3),
    task('Luyện Speaking Part 2 (3 đề)', 0, 3),
    task('Giải bài tập Giải tích chương 3', 0, 2, true),
    task('Nghe Podcast BBC 6 Minute English', 0, 1),
    task('Ôn lại ghi chú buổi học nhóm', 0, 2),
    task('Chia mục tiêu tuần thành các bước nhỏ', 0, 3),
    task('Đã xem video bài giảng về tích phân', 0, 1, true),
    task('Ôn định lý Green + Stokes', 1, 3),
    task('Mock test Listening', 2, 2),
    task('Viết báo cáo tiến độ đồ án', 4, 3),
    task('Ôn Kanji bài 5', 6, 1),
  ];

  const roadmaps: MockDb['roadmaps'] = [
    {
      id: 'rm-ielts', user_id: 'u-minhanh', title: 'IELTS 7.0 trong 4 tháng', goal: 'Đạt IELTS overall 7.0, không kỹ năng nào dưới 6.5',
      due_date: dayOffset(110), created_at: ago(20 * DAY),
      phases: [
        { id: 'ph-1', name: 'Nền tảng từ vựng & ngữ pháp', position: 0, progress: 100 },
        { id: 'ph-2', name: 'Luyện kỹ năng Reading & Listening', position: 1, progress: 60 },
        { id: 'ph-3', name: 'Writing & Speaking chuyên sâu', position: 2, progress: 25 },
        { id: 'ph-4', name: 'Luyện đề full test', position: 3, progress: 0 },
      ],
    },
    {
      id: 'rm-giaitich', user_id: 'u-minhanh', title: 'Qua môn Giải tích 2 điểm A', goal: 'Đạt điểm A môn Giải tích 2 kỳ này',
      due_date: dayOffset(45), created_at: ago(15 * DAY),
      phases: [
        { id: 'ph-5', name: 'Tích phân bội', position: 0, progress: 80 },
        { id: 'ph-6', name: 'Tích phân đường & mặt', position: 1, progress: 40 },
        { id: 'ph-7', name: 'Chuỗi số & chuỗi hàm', position: 2, progress: 0 },
      ],
    },
  ];

  const notif = (id: string, type: NotificationItem['type'], category: NotificationItem['category'], minsAgo: number, data: NotificationItem['data'], extra: Partial<NotificationItem> = {}): NotificationItem => ({
    id, user_id: 'u-minhanh', type, category, actor_id: null, post_id: null, comment_id: null,
    group_id: null, invitation_id: null, data, is_read: false, created_at: ago(minsAgo * MIN), ...extra,
  });
  const notifications: NotificationItem[] = [
    notif('n-1', 'study_room_active', 'group', 30, { actor_name: 'Hoàng Nam', room_name: 'Luyện Speaking buổi tối', group_name: 'Ôn thi IELTS 7.0', user_count: 3 }, { actor_id: 'u-hoangnam', group_id: 'g-ielts' }),
    notif('n-2', 'task_daily_reminder', 'goal', 8 * 60, { task_count: 3 }),
    notif('n-3', 'group_new_resource', 'group', 24 * 60, { actor_name: 'Hoàng Nam', resource_name: 'De-giua-ky-2021-2023.pdf', group_name: 'Giải tích 2 – K67' }, { actor_id: 'u-hoangnam', group_id: 'g-giaitich' }),
    notif('n-4', 'task_due_soon', 'goal', 2 * 60, { task_title: 'Ôn định lý Green + Stokes', hours_left: 20 }, { is_read: true }),
    notif('n-5', 'group_role_changed', 'group', 3 * 24 * 60, { actor_name: 'Hoàng Nam', group_name: 'Giải tích 2 – K67', role: 'member' }, { actor_id: 'u-hoangnam', group_id: 'g-giaitich', is_read: true }),
  ];

  return {
    version: MOCK_DB_VERSION,
    users, groups, streaks, groupMembers, channels, channelMembers, conversations,
    messages, reactions, rooms, roomMembers, roomModeration: [], notes, resources,
    tasks, roadmaps, notifications,
    notificationSettings: {},
    invitations: [],
  };
}
