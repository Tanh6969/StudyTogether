import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Check, ChevronDown, PartyPopper, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useRoomTasks } from '../../hooks/useRoomTasks';
import type { RoomTask } from '../../lib/roomTask.api';
import { getAvatarColor, getAvatarInitials } from '../../utils/avatarUtils';
import { getDisplayName } from '../../utils/userDisplay';

export interface SessionParticipant {
  userId: string;
  name: string;
  initial: string;
  color: string;
  avatarUrl?: string | null;
  isSelf: boolean;
}

interface SessionTasksPanelProps {
  roomId: string | null;
  currentUserId: string | null;
  participants: SessionParticipant[];
  /** Only an active participant may write; everyone who can see the room may read. */
  canEdit: boolean;
}

/* Panel tokens: the room's dark surfaces, one accent for selection/progress, one warm tone
 * for the "doing" state. Every colour below goes through these. */
const T = {
  bg: '#0F172A',
  surface: '#1E293B',
  line: '#334155',
  lineSoft: '#273449',
  text: '#E2E8F0',
  muted: '#94A3B8',
  faint: '#64748B',
  accent: '#38BDF8',
  accentInk: '#082F49',
  done: '#34D399',
  doing: '#FBBF24',
  doingInk: '#422006',
} as const;

const STATUS_ORDER: Record<RoomTask['status'], number> = { doing: 0, todo: 1, done: 2 };

interface PersonGroup {
  userId: string;
  name: string;
  initial: string;
  color: string;
  avatarUrl: string | null;
  isSelf: boolean;
  inRoom: boolean;
  tasks: RoomTask[];
  doneCount: number;
}

function sortTasks(tasks: RoomTask[]): RoomTask[] {
  return [...tasks].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.status === 'done' && b.status === 'done') {
      return (b.done_at ?? '').localeCompare(a.done_at ?? '');
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

const iconButton: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${T.line}`,
  borderRadius: 6,
  background: 'transparent',
  color: T.muted,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export function SessionTasksPanel({ roomId, currentUserId, participants, canEdit }: SessionTasksPanelProps) {
  const { tasks, isLoading, error, reload, addTask, setStatus, removeTask, claps, clapPulse, clap } = useRoomTasks(
    roomId,
    currentUserId
  );
  const [draft, setDraft] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  // "Vừa xong" pills age out after two minutes; a slow tick is enough.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const groups = useMemo<PersonGroup[]>(() => {
    const byUser = new Map<string, RoomTask[]>();
    for (const task of tasks) {
      const list = byUser.get(task.user_id) ?? [];
      list.push(task);
      byUser.set(task.user_id, list);
    }
    const result: PersonGroup[] = participants.map((p) => {
      const list = sortTasks(byUser.get(p.userId) ?? []);
      byUser.delete(p.userId);
      return {
        userId: p.userId,
        name: p.name,
        initial: p.initial,
        color: p.color,
        avatarUrl: p.avatarUrl ?? null,
        isSelf: p.isSelf,
        inRoom: true,
        tasks: list,
        doneCount: list.filter((t) => t.status === 'done').length,
      };
    });
    // People who wrote tasks and then left the room: kept, so their effort still counts.
    for (const [userId, list] of byUser) {
      const name = getDisplayName(list[0].user);
      result.push({
        userId,
        name,
        initial: getAvatarInitials(name),
        color: getAvatarColor(name),
        avatarUrl: list[0].user.avatar_url,
        isSelf: userId === currentUserId,
        inRoom: false,
        tasks: sortTasks(list),
        doneCount: list.filter((t) => t.status === 'done').length,
      });
    }
    result.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(b.inRoom) - Number(a.inRoom));
    return result;
  }, [tasks, participants, currentUserId]);

  const totalDone = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const progress = total ? totalDone / total : 0;
  const peopleCount = participants.length;

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || isAdding) return;
    setIsAdding(true);
    try {
      await addTask(draft);
      setDraft('');
    } catch {
      // error is surfaced by the hook
    } finally {
      setIsAdding(false);
    }
  };

  const toggleCollapsed = (userId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  return (
    <section className="session-panel" aria-label="Buổi học hôm nay" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', color: T.text }}>
      <header style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Buổi học hôm nay</h2>
          <span style={{ fontSize: 13, color: T.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {total === 0 ? `${peopleCount} người` : `${totalDone}/${total} việc, ${peopleCount} người`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Tiến độ cả phòng"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={totalDone}
          style={{ marginTop: 10, height: 4, borderRadius: 2, background: T.line, overflow: 'hidden' }}
        >
          <div
            className="session-progress-fill"
            style={{ height: '100%', background: T.done, transformOrigin: 'left', transform: `scaleX(${progress})` }}
          />
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 0 16px' }}>
        {isLoading ? (
          <div style={{ padding: '8px 16px', display: 'grid', gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton-pulse" style={{ height: 40, borderRadius: 8, background: T.surface }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ margin: '8px 16px', padding: 12, borderRadius: 8, border: `1px solid ${T.line}`, fontSize: 13, color: T.muted, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span>{error}</span>
            <button type="button" onClick={() => void reload()} style={{ ...iconButton, width: 'auto', padding: '0 10px', fontSize: 12, color: T.text }}>
              Tải lại
            </button>
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.userId);
            const doingTask = group.tasks.find((t) => t.status === 'doing');
            return (
              <section key={group.userId} aria-label={group.name} style={{ padding: '6px 12px 4px', opacity: group.inRoom ? 1 : 0.6 }}>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(group.userId)}
                  aria-expanded={!isCollapsed}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', border: 'none', borderRadius: 8, background: 'transparent', color: T.text, cursor: 'pointer', textAlign: 'left' }}
                >
                  {group.avatarUrl ? (
                    <img src={group.avatarUrl} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', background: group.color, color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      {group.initial}
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.name}</span>
                    {!group.inRoom && <span style={{ fontSize: 11, color: T.faint }}>đã rời phòng</span>}
                    {isCollapsed && doingTask && (
                      <span style={{ fontSize: 12, color: T.doing, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>đang làm: {doingTask.title}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {group.tasks.length ? `${group.doneCount}/${group.tasks.length}` : ''}
                  </span>
                  <ChevronDown size={14} color={T.faint} style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />
                </button>

                {!isCollapsed && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 36px', display: 'grid', gap: 2 }}>
                    {group.tasks.length === 0 && !group.isSelf && (
                      <li style={{ padding: '6px 8px', fontSize: 12, color: T.faint }}>Chưa ghi việc</li>
                    )}
                    {group.tasks.map((task) => {
                      const justDone = task.status === 'done' && task.done_at !== null && now - new Date(task.done_at).getTime() < 120000;
                      const clapCount = claps[task.id] ?? 0;
                      const pulse = clapPulse[task.id];
                      const isDoing = task.status === 'doing';
                      const isDone = task.status === 'done';
                      return (
                        <li
                          key={task.id}
                          className={`session-row${justDone ? ' session-done-flash' : ''}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 5px 6px', borderRadius: 6, background: isDoing ? 'rgba(251, 191, 36, 0.08)' : 'transparent' }}
                        >
                          {group.isSelf && canEdit ? (
                            <button
                              type="button"
                              onClick={() => void setStatus(task.id, isDone ? 'todo' : 'done')}
                              aria-label={isDone ? `Mở lại: ${task.title}` : `Hoàn thành: ${task.title}`}
                              aria-pressed={isDone}
                              style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${isDone ? T.done : T.faint}`, background: isDone ? T.done : 'transparent', color: T.bg, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                            >
                              {isDone && <Check size={12} strokeWidth={3} />}
                            </button>
                          ) : (
                            <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${isDone ? T.done : isDoing ? T.doing : T.faint}`, background: isDone ? T.done : 'transparent', color: T.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              {isDone && <Check size={12} strokeWidth={3} />}
                            </span>
                          )}

                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35, color: isDone ? T.muted : T.text, textDecoration: isDone ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
                            {task.title}
                          </span>

                          {isDoing && (
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: T.doing, color: T.doingInk, whiteSpace: 'nowrap' }}>Đang làm</span>
                          )}
                          {justDone && !isDoing && (
                            <span style={{ fontSize: 11, color: T.done, whiteSpace: 'nowrap' }}>vừa xong</span>
                          )}

                          {isDone && !group.isSelf && (
                            <button
                              type="button"
                              onClick={() => clap(task.id)}
                              aria-label={`Cổ vũ ${group.name} đã xong ${task.title}`}
                              style={{ ...iconButton, width: 'auto', gap: 5, padding: '0 8px', color: clapCount ? T.text : T.muted, borderColor: clapCount ? T.faint : T.line }}
                            >
                              {/* Keyed on the latest clap so the pop replays without remounting the button. */}
                              <span key={pulse ?? 0} className={pulse ? 'session-clap-pop' : undefined} style={{ display: 'inline-flex' }}><PartyPopper size={14} /></span>
                              <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{clapCount ? clapCount : 'Cổ vũ'}</span>
                            </button>
                          )}
                          {isDone && group.isSelf && clapCount > 0 && (
                            <span key={pulse ?? 0} className={pulse ? 'session-clap-pop' : undefined} aria-label={`${clapCount} lượt cổ vũ`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.doing, fontVariantNumeric: 'tabular-nums' }}>
                              <PartyPopper size={14} /> {clapCount}
                            </span>
                          )}

                          {group.isSelf && canEdit && (
                            <span className="session-row-actions" style={{ display: 'inline-flex', gap: 4 }}>
                              {!isDone && (
                                <button
                                  type="button"
                                  onClick={() => void setStatus(task.id, isDoing ? 'todo' : 'doing')}
                                  aria-label={isDoing ? `Tạm dừng: ${task.title}` : `Bắt đầu làm: ${task.title}`}
                                  title={isDoing ? 'Tạm dừng' : 'Bắt đầu làm'}
                                  style={{ ...iconButton, color: isDoing ? T.doing : T.muted }}
                                >
                                  {isDoing ? <Square size={13} /> : <Play size={13} />}
                                </button>
                              )}
                              {isDone && (
                                <button type="button" onClick={() => void setStatus(task.id, 'todo')} aria-label={`Mở lại: ${task.title}`} title="Mở lại" style={iconButton}>
                                  <RotateCcw size={13} />
                                </button>
                              )}
                              <button type="button" onClick={() => void removeTask(task.id)} aria-label={`Xoá: ${task.title}`} title="Xoá" style={iconButton}>
                                <Trash2 size={13} />
                              </button>
                            </span>
                          )}
                        </li>
                      );
                    })}

                    {group.isSelf && canEdit && (
                      <li>
                        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={group.tasks.length ? 'Thêm việc…' : 'Bạn định làm gì trong buổi này?'}
                            aria-label="Việc mới cho buổi học này"
                            maxLength={200}
                            disabled={isAdding}
                            style={{ flex: 1, minWidth: 0, height: 34, padding: '0 10px', borderRadius: 6, border: `1px solid ${T.line}`, background: T.bg, color: T.text, fontSize: 13 }}
                          />
                          <button type="submit" disabled={!draft.trim() || isAdding} aria-label="Thêm việc" style={{ ...iconButton, width: 34, height: 34, background: draft.trim() ? T.accent : 'transparent', color: draft.trim() ? T.accentInk : T.faint, borderColor: draft.trim() ? T.accent : T.line, cursor: draft.trim() ? 'pointer' : 'default' }}>
                            <Plus size={16} />
                          </button>
                        </form>
                        {group.tasks.length === 0 && (
                          <p style={{ margin: '8px 0 0', fontSize: 12, color: T.faint, lineHeight: 1.45 }}>Cả phòng cùng thấy danh sách của nhau.</p>
                        )}
                      </li>
                    )}
                    {group.isSelf && !canEdit && group.tasks.length === 0 && (
                      <li style={{ padding: '6px 8px', fontSize: 12, color: T.faint }}>Vào phòng để ghi việc của bạn.</li>
                    )}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}
