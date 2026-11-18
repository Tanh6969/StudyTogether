import { useEffect, useState } from 'react';
import { listStudyRoomPresence } from '../lib/studyRoom.api';
import type { StudyRoomMember } from '../lib/studyRoom.types';

type Snapshot = {
  roomId: string;
  status: 'ready' | 'unavailable';
  members: StudyRoomMember[] | null;
};

/** One read-only LiveKit-backed roster for every room-presence UI surface.
 *
 * Member rows (left_at) are for authorization/history, not online status.
 * Supabase membership Realtime triggers a quick reconciliation but cannot
 * see WebRTC disconnects, so regular polling/focus reconciliation is essential.
 * An API error is UNKNOWN rather than a fabricated empty roster.
 */
export function useRoomPresence(roomId: string | null, refreshKey = 0) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!roomId) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    let latestRequest = 0;
    let inFlight = false;

    const refresh = async () => {
      // Single-flight: do not create an endless series of overlapping API
      // requests if LiveKit is slow or the network temporarily stalls.
      if (inFlight) return;
      inFlight = true;
      const request = ++latestRequest;
      try {
        const members = await listStudyRoomPresence(roomId);
        if (!cancelled && request === latestRequest) {
          setSnapshot({ roomId, members, status: 'ready' });
        }
      } catch {
        if (!cancelled && request === latestRequest) {
          setSnapshot({ roomId, members: null, status: 'unavailable' });
        }
      } finally {
        inFlight = false;
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 5000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [roomId, refreshKey]);

  return {
    members: snapshot?.roomId === roomId && snapshot.status === 'ready' ? snapshot.members : null,
    status: roomId && snapshot?.roomId === roomId ? snapshot.status : 'loading',
  };
}
