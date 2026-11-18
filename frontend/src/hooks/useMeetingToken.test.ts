import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../lib/apiClient';
import { createMeetingToken } from '../lib/meeting.api';
import { useMeetingToken } from './useMeetingToken';
import type { MeetingTokenResponse } from '../lib/meeting.types';

vi.mock('../lib/meeting.api', () => ({
  createMeetingToken: vi.fn(),
}));

const mockedCreateMeetingToken = vi.mocked(createMeetingToken);

describe('useMeetingToken', () => {
  beforeEach(() => {
    mockedCreateMeetingToken.mockReset();
  });

  it('stays idle and never calls the backend when disabled', () => {
    const { result } = renderHook(() => useMeetingToken('room-1', false));
    expect(result.current.status).toBe('idle');
    expect(mockedCreateMeetingToken).not.toHaveBeenCalled();
  });

  it('requests a token for the room and transitions loading -> ready', async () => {
    let resolveToken!: (value: MeetingTokenResponse) => void;
    mockedCreateMeetingToken.mockReturnValue(
      new Promise<MeetingTokenResponse>((resolve) => {
        resolveToken = resolve;
      })
    );

    const { result } = renderHook(() => useMeetingToken('room-1', true));

    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(mockedCreateMeetingToken).toHaveBeenCalledWith('room-1', expect.any(AbortSignal));

    act(() => resolveToken({ server_url: 'wss://livekit.example.com', participant_token: 'tok-123' }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ server_url: 'wss://livekit.example.com', participant_token: 'tok-123' });
    expect(result.current.error).toBeNull();
  });

  it('maps a 403 rejection to an "not authorized" error, mirroring the backend as authoritative', async () => {
    mockedCreateMeetingToken.mockRejectedValue(new ApiError(403, 'Forbidden'));

    const { result } = renderHook(() => useMeetingToken('room-1', true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toEqual({
      status: 403,
      message: 'Bạn không có quyền tham gia cuộc gọi của phòng học này.',
    });
    expect(result.current.data).toBeNull();
  });

  it('maps a 404 rejection to a "room unavailable" error', async () => {
    mockedCreateMeetingToken.mockRejectedValue(new ApiError(404, 'Not Found'));

    const { result } = renderHook(() => useMeetingToken('room-1', true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.status).toBe(404);
    expect(result.current.error?.message).toContain('không tồn tại');
  });

  it('resets to idle and discards any result once disabled again', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 't' });
    const { result, rerender } = renderHook(({ enabled }) => useMeetingToken('room-1', enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ enabled: false });

    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
  });

  it('retry() re-requests a fresh token', async () => {
    mockedCreateMeetingToken.mockResolvedValueOnce({ server_url: 'wss://x', participant_token: 'first' });
    const { result } = renderHook(() => useMeetingToken('room-1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockedCreateMeetingToken.mockResolvedValueOnce({ server_url: 'wss://x', participant_token: 'second' });
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.data?.participant_token).toBe('second');
    expect(mockedCreateMeetingToken).toHaveBeenCalledTimes(2);
  });
});

describe('useMeetingToken -- stalled or revoked requests', () => {
  it('aborts a stalled token request and shows a retryable timeout instead of indefinite loading', async () => {
    vi.useFakeTimers();
    try {
      mockedCreateMeetingToken.mockImplementation((_roomId, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const { result } = renderHook(() => useMeetingToken('room-1', true));
      expect(result.current.status).toBe('loading');

      await act(async () => { await vi.advanceTimersByTimeAsync(15001); });
      expect(result.current.status).toBe('error');
      expect(result.current.error?.message).toContain('quá thời gian chờ');
      expect(result.current.data).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an in-flight token response after participation is disabled', async () => {
    let resolveToken!: (value: MeetingTokenResponse) => void;
    mockedCreateMeetingToken.mockImplementation(() => new Promise<MeetingTokenResponse>((resolve) => {
      resolveToken = resolve;
    }));
    const { result, rerender } = renderHook(({ enabled }) => useMeetingToken('room-1', enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.status).toBe('loading'));
    rerender({ enabled: false });

    await act(async () => resolveToken({ server_url: 'wss://x', participant_token: 'late' }));
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
  });
});
