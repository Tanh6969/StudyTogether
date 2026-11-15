import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_MOCK } from '../mocks/config';
import {
  endRoomActivity,
  joinRoomActivity,
  leaveRoomActivity,
  listRoomActivities,
  startRoomActivity,
  updateRoomActivity,
} from '../lib/activity.api';
import type { ActivityCreate, ActivityUpdate, RoomActivity } from '../lib/activity.types';
import { ApiError } from '../lib/apiClient';
import type { ActivityBus } from './net/useActivityBus';

/** How long a host may be absent from the call before the next participant takes over. */
const HOST_GRACE_MS = 5000;

export interface RoomActivitiesApi {
  activities: RoomActivity[];
  /** The live game / music activity of the room, if any. */
  game: RoomActivity | null;
  music: RoomActivity | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  start: (data: ActivityCreate) => Promise<RoomActivity>;
  join: (activityId: string) => Promise<RoomActivity>;
  leave: (activityId: string) => Promise<RoomActivity>;
  end: (activityId: string) => Promise<void>;
  patch: (activityId: string, data: ActivityUpdate) => Promise<RoomActivity>;
  /** Apply a fresher copy received over the data channel without a round trip. */
  applyLocal: (activity: RoomActivity) => void;
}

/**
 * The room's live activities (docs/design/hoat-dong-trong-call.md §1): REST for truth,
 * Supabase Realtime on `room_activities` to learn about changes made by others, and a
 * deterministic host election when the current host disappears from the call.
 */
export function useRoomActivities(roomId: string | null, currentUserId: string | null, bus: ActivityBus, enabled: boolean): RoomActivitiesApi {
  const [activities, setActivities] = useState<RoomActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hostMissingSinceRef = useRef<Map<string, number>>(new Map());
  const takingOverRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!roomId || !enabled) return;
    try {
      const data = await listRoomActivities(roomId);
      setActivities(data.filter((a) => !a.ended_at));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách hoạt động.');
    } finally {
      setIsLoading(false);
    }
  }, [roomId, enabled]);

  useEffect(() => {
    setActivities([]);
    setIsLoading(true);
    void refresh();
  }, [refresh]);

  // Realtime: any insert/update on this room's activities -> debounced refetch.
  useEffect(() => {
    if (USE_MOCK || !roomId || !enabled) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 150);
    };
    const channel = supabase
      .channel(`room_activities:room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_activities', filter: `room_id=eq.${roomId}` }, schedule)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] room_activities subscription issue:', status, err);
        }
      });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [roomId, enabled, refresh]);

  // Fast path: a host that just changed something tells the room directly.
  useEffect(() => {
    return bus.subscribe('sys', (packet) => {
      if (packet.type === 'activity_changed') void refresh();
    });
  }, [bus, refresh]);

  const applyLocal = useCallback((activity: RoomActivity) => {
    setActivities((prev) => {
      if (activity.ended_at) return prev.filter((a) => a.id !== activity.id);
      const idx = prev.findIndex((a) => a.id === activity.id);
      if (idx === -1) return [...prev, activity];
      const next = [...prev];
      next[idx] = activity;
      return next;
    });
  }, []);

  const announce = useCallback(() => bus.send('sys', 'activity_changed', {}), [bus]);

  const start = useCallback(
    async (data: ActivityCreate) => {
      if (!roomId) throw new Error('no room');
      const created = await startRoomActivity(roomId, data);
      applyLocal(created);
      announce();
      return created;
    },
    [roomId, applyLocal, announce]
  );

  const join = useCallback(
    async (activityId: string) => {
      if (!roomId) throw new Error('no room');
      const updated = await joinRoomActivity(roomId, activityId);
      applyLocal(updated);
      announce();
      return updated;
    },
    [roomId, applyLocal, announce]
  );

  const leave = useCallback(
    async (activityId: string) => {
      if (!roomId) throw new Error('no room');
      const updated = await leaveRoomActivity(roomId, activityId);
      applyLocal(updated);
      announce();
      return updated;
    },
    [roomId, applyLocal, announce]
  );

  const end = useCallback(
    async (activityId: string) => {
      if (!roomId) return;
      const updated = await endRoomActivity(roomId, activityId);
      applyLocal(updated);
      announce();
    },
    [roomId, applyLocal, announce]
  );

  const patch = useCallback(
    async (activityId: string, data: ActivityUpdate) => {
      if (!roomId) throw new Error('no room');
      const updated = await updateRoomActivity(roomId, activityId, data);
      applyLocal(updated);
      if (data.status || data.host_user_id || data.settings) announce();
      return updated;
    },
    [roomId, applyLocal, announce]
  );

  // Host election: when an activity's host has been out of the call for HOST_GRACE_MS, the
  // first participant (join order) who IS connected claims the role. Everyone runs the same
  // rule on the same inputs, so only one client ends up calling PATCH.
  useEffect(() => {
    if (!roomId || !currentUserId || !bus.connected) return;
    const check = () => {
      const now = Date.now();
      for (const activity of activities) {
        const hostConnected = bus.connectedIds.has(activity.host_user_id);
        if (hostConnected) {
          hostMissingSinceRef.current.delete(activity.id);
          continue;
        }
        if (!activity.participants.includes(currentUserId)) continue;
        const since = hostMissingSinceRef.current.get(activity.id) ?? now;
        hostMissingSinceRef.current.set(activity.id, since);
        if (now - since < HOST_GRACE_MS) continue;
        const candidate = activity.participants.find((p) => bus.connectedIds.has(p));
        if (candidate !== currentUserId || takingOverRef.current.has(activity.id)) continue;
        takingOverRef.current.add(activity.id);
        updateRoomActivity(roomId, activity.id, { host_user_id: currentUserId })
          .then((updated) => {
            applyLocal(updated);
            announce();
          })
          .catch(() => void refresh())
          .finally(() => {
            takingOverRef.current.delete(activity.id);
            hostMissingSinceRef.current.delete(activity.id);
          });
      }
    };
    check();
    const timer = window.setInterval(check, 2000);
    return () => window.clearInterval(timer);
  }, [roomId, currentUserId, activities, bus.connected, bus.connectedIds, applyLocal, announce, refresh]);

  const game = useMemo(() => activities.find((a) => a.kind === 'game' && !a.ended_at) ?? null, [activities]);
  const music = useMemo(() => activities.find((a) => a.kind === 'music' && !a.ended_at) ?? null, [activities]);

  return { activities, game, music, isLoading, error, refresh, start, join, leave, end, patch, applyLocal };
}
