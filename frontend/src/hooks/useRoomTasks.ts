import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_MOCK } from '../mocks/config';
import { createRoomTask, deleteRoomTask, listRoomTasks, updateRoomTask } from '../lib/roomTask.api';
import type { RoomTask, RoomTaskStatus } from '../lib/roomTask.api';
import { playCheer } from '../utils/cheerSounds';

interface ClapPayload {
  task_id: string;
  user_id: string;
  /** Cheer style id (lib/rewards.ts) of whoever clapped. */
  style?: string;
}

/** Session tasks of a study room ("Buổi học hôm nay") for everyone in it.
 *
 * - Persistence: REST (`/study-rooms/{id}/tasks`). Own edits are applied optimistically and
 *   reconciled by the server response; on failure the list is reloaded.
 * - Sync: one Supabase channel per room carries both `postgres_changes` on `room_tasks`
 *   (any insert/update/delete -> debounced refetch, the same hydrate-via-REST pattern the
 *   rest of the app uses) and a `clap` broadcast. Claps are deliberately ephemeral: they
 *   are a moment of encouragement, not a record, so there is no table for them -- counts
 *   reset when you reopen the room. */
export function useRoomTasks(roomId: string | null, currentUserId: string | null, cheerStyle = 'clap') {
  const [tasks, setTasks] = useState<RoomTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claps, setClaps] = useState<Record<string, number>>({});
  /** task id -> timestamp of the latest clap, so the UI can replay a pop animation. */
  const [clapPulse, setClapPulse] = useState<Record<string, number>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastClapSentRef = useRef(0);

  const reload = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await listRoomTasks(roomId);
      setTasks(data);
      setError(null);
    } catch {
      setError('Không tải được danh sách việc của phòng.');
    } finally {
      setIsLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    setTasks([]);
    setClaps({});
    setIsLoading(true);
    void reload();
  }, [reload]);

  const registerClap = useCallback((taskId: string, style: string | undefined) => {
    setClaps((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));
    setClapPulse((prev) => ({ ...prev, [taskId]: Date.now() }));
    playCheer(style);
  }, []);

  useEffect(() => {
    if (USE_MOCK || !roomId) return;
    let timer: number | null = null;
    const scheduleReload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 150);
    };
    const channel = supabase
      .channel(`room_tasks:room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_tasks', filter: `room_id=eq.${roomId}` }, scheduleReload)
      .on('broadcast', { event: 'clap' }, ({ payload }: { payload: ClapPayload }) => {
        if (payload?.task_id) registerClap(payload.task_id, payload.style);
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] room_tasks subscription issue:', status, err);
        }
      });
    channelRef.current = channel;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, reload, registerClap]);

  const addTask = useCallback(
    async (title: string) => {
      if (!roomId) return;
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const created = await createRoomTask(roomId, trimmed);
        setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      } catch {
        setError('Không thêm được việc. Thử lại nhé.');
        throw new Error('create failed');
      }
    },
    [roomId]
  );

  const setStatus = useCallback(
    async (taskId: string, status: RoomTaskStatus) => {
      if (!roomId || !currentUserId) return;
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) return { ...t, status, done_at: status === 'done' ? new Date().toISOString() : null };
          // One focus at a time (mirrors the backend rule).
          if (status === 'doing' && t.user_id === currentUserId && t.status === 'doing') return { ...t, status: 'todo' };
          return t;
        })
      );
      try {
        const updated = await updateRoomTask(roomId, taskId, { status });
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch {
        setError('Không cập nhật được. Đang tải lại.');
        void reload();
      }
    },
    [roomId, currentUserId, reload]
  );

  const removeTask = useCallback(
    async (taskId: string) => {
      if (!roomId) return;
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      try {
        await deleteRoomTask(roomId, taskId);
      } catch {
        setError('Không xoá được. Đang tải lại.');
        void reload();
      }
    },
    [roomId, reload]
  );

  /** Cheer for someone's finished task. Plays locally right away and broadcasts to the room;
   * the sender does not receive its own broadcast, so no double count. Throttled to avoid
   * a held key spamming the channel. */
  const clap = useCallback(
    (taskId: string) => {
      const now = Date.now();
      if (now - lastClapSentRef.current < 250) return;
      lastClapSentRef.current = now;
      registerClap(taskId, cheerStyle);
      const payload: ClapPayload = { task_id: taskId, user_id: currentUserId ?? '', style: cheerStyle };
      void channelRef.current?.send({ type: 'broadcast', event: 'clap', payload });
    },
    [currentUserId, cheerStyle, registerClap]
  );

  return { tasks, isLoading, error, reload, addTask, setStatus, removeTask, claps, clapPulse, clap };
}
