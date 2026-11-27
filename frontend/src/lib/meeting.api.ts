import { apiClient } from './apiClient';
import type { MeetingCaptionEvent, MeetingSessionStatus, MeetingTokenResponse } from './meeting.types';

/**
 * Caller is always derived from the bearer token on the backend; no user id is ever sent.
 * Authorization (`can_join_room_meeting`): active Group membership + active Room membership +
 * room not soft-deleted + room not ended -- enforced entirely server-side (403/404 on failure).
 * The browser only ever receives the LiveKit participant token this returns, never the
 * server's LiveKit API key/secret.
 */
/** Explicit intent from the pre-join lobby: this is the *only* takeover operation. */
export function claimMeetingSession(roomId: string, sessionId: string): Promise<MeetingSessionStatus> {
  return apiClient.post<MeetingSessionStatus>(`/study-rooms/${roomId}/meeting/claim`, {
    client_session_id: sessionId,
  });
}

/** Read-only, periodic check. No new tokens, no takeover. */
export function checkMeetingSession(roomId: string, sessionId: string): Promise<MeetingSessionStatus> {
  return apiClient.get<MeetingSessionStatus>(
    `/study-rooms/${roomId}/meeting/owner?client_session_id=${encodeURIComponent(sessionId)}`
  );
}

/** Token refresh can never replace another active tab/device. Backend returns 409. */
export function createMeetingToken(roomId: string, sessionId: string, signal?: AbortSignal): Promise<MeetingTokenResponse> {
  return apiClient.post<MeetingTokenResponse>(
    `/study-rooms/${roomId}/meeting/token`, { client_session_id: sessionId }, { signal }
  );
}

export async function streamMeetingCaptions(
  roomId: string,
  sessionId: string,
  participantSid: string,
  onEvent: (event: MeetingCaptionEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({ client_session_id: sessionId, participant_sid: participantSid });
  const stream = await apiClient.openStream(`/study-rooms/${roomId}/meeting/captions?${params}`, signal);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // A fetch chunk may split a line or straddle a multi-byte vowel/tone mark.
      const lines = (pending + decoder.decode(value, { stream: true })).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line && !signal.aborted) onEvent(JSON.parse(line) as MeetingCaptionEvent);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
