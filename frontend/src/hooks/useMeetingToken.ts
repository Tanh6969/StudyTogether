import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { createMeetingToken } from '../lib/meeting.api';
import type { MeetingTokenResponse } from '../lib/meeting.types';

export interface MeetingTokenError {
  status: number | null;
  message: string;
}

function toMeetingTokenError(err: unknown): MeetingTokenError {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return { status: 401, message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' };
    }
    if (err.status === 403) {
      return { status: 403, message: 'Bạn không có quyền tham gia cuộc gọi của phòng học này.' };
    }
    if (err.status === 409) {
      return { status: 409, message: 'Cuộc gọi đã được chuyển sang tab hoặc thiết bị khác.' };
    }
    if (err.status === 404) {
      return { status: 404, message: 'Phòng học không tồn tại hoặc không còn khả dụng.' };
    }
    return { status: err.status, message: err.message };
  }
  return { status: null, message: 'Không thể kết nối tới máy chủ cuộc gọi. Vui lòng thử lại.' };
}

export type MeetingTokenStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Fetches a fresh LiveKit participant token from the backend whenever `enabled` is true.
 * The backend (`can_join_room_meeting`) is the sole authority on whether the current user may
 * join the meeting -- this hook only relays its response or rejection, never second-guesses it.
 */
export function useMeetingToken(roomId: string | undefined, enabled: boolean, clientSessionId: string) {
  const [status, setStatus] = useState<MeetingTokenStatus>('idle');
  const [data, setData] = useState<MeetingTokenResponse | null>(null);
  const [error, setError] = useState<MeetingTokenError | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  // A stalled HTTP connection must never leave the call UI loading indefinitely.
  const TOKEN_TIMEOUT_MS = 15000;

  const fetchToken = useCallback(async () => {
    if (!roomId || !clientSessionId) return;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestId = ++requestIdRef.current;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TOKEN_TIMEOUT_MS);
    setStatus('loading');
    setError(null);
    try {
      const token = await createMeetingToken(roomId, clientSessionId, controller.signal);
      if (requestIdRef.current !== requestId) return;
      setData(token);
      setStatus('ready');
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setData(null);
      setError(timedOut
        ? { status: null, message: 'Yêu cầu tham gia cuộc gọi đã quá thời gian chờ. Vui lòng thử lại.' }
        : toMeetingTokenError(err));
      setStatus('error');
    } finally {
      clearTimeout(timeout);
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }, [roomId, clientSessionId]);

  useEffect(() => {
    if (!enabled) {
      // A late HTTP response must not re-enable a session after leave/kick.
      requestIdRef.current++;
      activeRequestRef.current?.abort();
      setStatus('idle');
      setData(null);
      setError(null);
      return;
    }
    void fetchToken();
    return () => {
      requestIdRef.current++;
      activeRequestRef.current?.abort();
    };
  }, [enabled, fetchToken]);

  return { status, data, error, retry: fetchToken };
}
