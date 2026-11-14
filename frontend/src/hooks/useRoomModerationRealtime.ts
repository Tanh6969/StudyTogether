import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { USE_MOCK } from '../mocks/config';

/** Calls `onChange` whenever a `room_moderation_actions` row is inserted for `roomId`
 * (raise/lower hand, mute/unmute, kick). Same hydrate-via-REST pattern as
 * useStudyRoomMembersRealtime: the raw row is ignored and `onChange` refetches the audit log.
 *
 * Requires db/migrations/005_room_tasks.sql (adds the table to the Realtime publication and
 * a SELECT policy) -- before that, nobody but the actor ever saw a raised hand without a
 * full reload. */
export function useRoomModerationRealtime(roomId: string | null, onChange: () => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (USE_MOCK || !roomId) return;
    const channel = supabase
      .channel(`room_moderation_actions:room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_moderation_actions', filter: `room_id=eq.${roomId}` },
        () => onChangeRef.current()
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] room_moderation_actions subscription issue:', status, err);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);
}
