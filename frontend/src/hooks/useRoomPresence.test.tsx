import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listStudyRoomPresence } from '../lib/studyRoom.api';
import type { StudyRoomMember } from '../lib/studyRoom.types';
import { useRoomPresence } from './useRoomPresence';

vi.mock('../lib/studyRoom.api', () => ({ listStudyRoomPresence: vi.fn() }));

const member = { user_id: 'live-user-id' } as StudyRoomMember;

describe('useRoomPresence: actual LiveKit roster, never stale DB membership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders authoritative server roster without fabricating persisted members', async () => {
    vi.mocked(listStudyRoomPresence).mockResolvedValue([member]);
    const { result } = renderHook(() => useRoomPresence('room-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.members).toEqual([member]);
  });

  it('distinguishes unavailable from empty rather than reporting a false zero', async () => {
    vi.mocked(listStudyRoomPresence).mockRejectedValue(new Error('LiveKit unavailable'));
    const { result } = renderHook(() => useRoomPresence('room-1'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.members).toBeNull();
  });

  it('reconciles after unexpected disconnect even without DB Realtime updates', async () => {
    vi.mocked(listStudyRoomPresence)
      .mockResolvedValueOnce([member])
      .mockResolvedValueOnce([]);
    vi.useFakeTimers();
    const { result } = renderHook(() => useRoomPresence('room-1'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.members).toEqual([member]);
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
    expect(listStudyRoomPresence).toHaveBeenCalledTimes(2);
  });

  it('refreshes when returning to the foreground', async () => {
    vi.mocked(listStudyRoomPresence).mockResolvedValueOnce([member]).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useRoomPresence('room-1'));
    await waitFor(() => expect(result.current.members).toEqual([member]));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
  });

  it('a previous room or slower response cannot overwrite current room', async () => {
    let resolveOld!: (value: StudyRoomMember[]) => void;
    const oldResponse = new Promise<StudyRoomMember[]>((resolve) => { resolveOld = resolve; });
    vi.mocked(listStudyRoomPresence).mockImplementation((roomId) =>
      roomId === 'old' ? oldResponse : Promise.resolve([]));
    const { result, rerender } = renderHook(({ roomId }) => useRoomPresence(roomId), {
      initialProps: { roomId: 'old' },
    });
    rerender({ roomId: 'new' });
    await waitFor(() => expect(result.current.members).toEqual([]));
    await act(async () => { resolveOld([member]); await oldResponse; });
    expect(result.current.members).toEqual([]);
  });
});
