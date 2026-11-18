import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from './useAuth';
import { useStudyRoomMembersRealtime } from './useStudyRoomMembersRealtime';
import { listGroupMembers } from '../lib/group.api';
import { ApiError } from '../lib/apiClient';
import {
  getStudyRoom,
  joinStudyRoom,
  leaveStudyRoomOnUnload,
  listStudyRoomMembers,
  listStudyRoomModeration,
} from '../lib/studyRoom.api';
import { useStudyRoom } from './useStudyRoom';
import type { StudyRoom, StudyRoomMember } from '../lib/studyRoom.types';

vi.mock('./useAuth');
vi.mock('./useStudyRoomMembersRealtime', () => ({
  useStudyRoomMembersRealtime: vi.fn(),
}));
vi.mock('./useRoomModerationRealtime', () => ({
  useRoomModerationRealtime: vi.fn(),
}));
vi.mock('../lib/group.api', () => ({
  listGroupMembers: vi.fn(),
}));
vi.mock('../lib/studyRoom.api', () => ({
  getStudyRoom: vi.fn(),
  listStudyRoomMembers: vi.fn(),
  listStudyRoomModeration: vi.fn(),
  leaveStudyRoomOnUnload: vi.fn(),
  joinStudyRoom: vi.fn(),
  leaveStudyRoom: vi.fn(),
  deleteStudyRoom: vi.fn(),
  logStudyRoomModeration: vi.fn(),
  updateStudyRoomMemberRole: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseRealtime = vi.mocked(useStudyRoomMembersRealtime);
const mockedListGroupMembers = vi.mocked(listGroupMembers);
const mockedGetStudyRoom = vi.mocked(getStudyRoom);
const mockedJoinRoom = vi.mocked(joinStudyRoom);
const mockedListMembers = vi.mocked(listStudyRoomMembers);
const mockedListModeration = vi.mocked(listStudyRoomModeration);
const mockedLeaveOnUnload = vi.mocked(leaveStudyRoomOnUnload);

const CURRENT_USER_ID = 'user-1';

function makeRoom(overrides: Partial<StudyRoom> = {}): StudyRoom {
  return {
    id: 'room-1',
    group_id: 'group-1',
    name: 'Room',
    description: null,
    host_id: 'host-1',
    status: 'active',
    max_participants: 50,
    is_private: false,
    created_at: '2026-08-19T00:00:00Z',
    started_at: null,
    ended_at: null,
    deleted_at: null,
    deleted_by: null,
    conversation_id: 'conv-1',
    whiteboard_state: null,
    presentation_state: null,
    ...overrides,
  };
}

const summaryUser = { id: CURRENT_USER_ID, username: 'alice', display_name: 'Alice', avatar_url: null, role: 'user' as const };

function makeMember(overrides: Partial<StudyRoomMember> = {}): StudyRoomMember {
  return {
    id: 'member-1',
    room_id: 'room-1',
    user_id: CURRENT_USER_ID,
    role: 'participant',
    joined_at: '2026-08-19T00:00:00Z',
    left_at: null,
    user: summaryUser,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedUseAuth.mockReturnValue({
    user: { id: CURRENT_USER_ID },
    isLoggedIn: true,
  } as unknown as ReturnType<typeof useAuth>);
  mockedUseRealtime.mockReset();
  mockedListGroupMembers.mockReset().mockResolvedValue([]);
  mockedGetStudyRoom.mockReset();
  mockedJoinRoom.mockReset();
  mockedListMembers.mockReset().mockResolvedValue([]);
  mockedListModeration.mockReset().mockResolvedValue([]);
  mockedLeaveOnUnload.mockReset();
});

describe('useStudyRoom -- leave-on-unload cleanup', () => {
  it('fires a beacon leave on pagehide while the caller is an active room member', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    window.dispatchEvent(new Event('pagehide'));

    expect(mockedLeaveOnUnload).toHaveBeenCalledWith('room-1', '2026-08-19T00:00:00Z');
  });

  it('does not fire a beacon leave on pagehide when the caller has no active membership', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([]); // caller never joined

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    window.dispatchEvent(new Event('pagehide'));

    expect(mockedLeaveOnUnload).not.toHaveBeenCalled();
  });

  it('fires a best-effort leave on unmount (in-app navigation away) while an active member', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result, unmount } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    unmount();

    expect(mockedLeaveOnUnload).toHaveBeenCalledWith('room-1', '2026-08-19T00:00:00Z');
  });

  it('does not fire a leave on unmount when the caller was never an active member', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([]);

    const { result, unmount } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(mockedLeaveOnUnload).not.toHaveBeenCalled();
  });
});

describe('useStudyRoom -- coordinated membership lifecycle', () => {
  it('does not request protected moderation history before membership is confirmed', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValueOnce([]).mockResolvedValueOnce([makeMember()]);
    mockedJoinRoom.mockResolvedValue(makeMember());

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(mockedListMembers).toHaveBeenCalled());
    expect(mockedListModeration).not.toHaveBeenCalled();

    await act(async () => { await result.current.join(); });
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    await waitFor(() => expect(mockedListModeration).toHaveBeenCalledTimes(1));
  });

  it('keeps the authoritative join acknowledgement when a roster refresh fails', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValueOnce([]);
    mockedJoinRoom.mockResolvedValue(makeMember());

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(mockedListMembers).toHaveBeenCalledTimes(1));

    mockedListMembers.mockRejectedValue(new Error('temporary network outage'));
    await act(async () => { await result.current.join(); });

    await waitFor(() => expect(result.current.membersError).not.toBeNull());
    expect(result.current.isCurrentUserMember).toBe(true);
    expect(result.current.currentMember?.user_id).toBe(CURRENT_USER_ID);
  });

  it('discards an old pre-join roster response that arrives after a successful join', async () => {
    let resolveOld!: (members: StudyRoomMember[]) => void;
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers
      .mockImplementationOnce(() => new Promise<StudyRoomMember[]>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([makeMember()]);
    mockedJoinRoom.mockResolvedValue(makeMember());

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(mockedListMembers).toHaveBeenCalledTimes(1));

    await act(async () => { await result.current.join(); });
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    await act(async () => { resolveOld([]); });
    expect(result.current.isCurrentUserMember).toBe(true);
  });

  it('refreshes room metadata without toggling the full-page loading state', async () => {
    mockedGetStudyRoom.mockResolvedValueOnce(makeRoom()).mockResolvedValueOnce(makeRoom({ name: 'Updated Room' }));
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.refetchRoom(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.room?.name).toBe('Updated Room');
  });
});


describe('useStudyRoom -- permissions and in-flight responses', () => {
  it('revokes local membership on a definitive 403 instead of treating it as transient', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValueOnce([makeMember()]);

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    mockedListMembers.mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    await act(async () => { await result.current.refetchMembers(); });
    expect(result.current.isCurrentUserMember).toBe(false);
    expect(result.current.membersError?.status).toBe(403);
  });

  it('ignores a moderation response from a membership that was revoked meanwhile', async () => {
    let resolveHistory!: (actions: { id: string; room_id: string; moderator_id: string; target_user_id: string; action: 'raise_hand'; reason: null; created_at: string }[]) => void;
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValueOnce([makeMember()]).mockResolvedValueOnce([]);
    mockedListModeration.mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve; }));

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    await waitFor(() => expect(mockedListModeration).toHaveBeenCalledTimes(1));

    await act(async () => { await result.current.refetchMembers(); });
    expect(result.current.isCurrentUserMember).toBe(false);
    await act(async () => {
      resolveHistory([{ id: 'old-1', room_id: 'room-1', moderator_id: 'user-2', target_user_id: CURRENT_USER_ID, action: 'raise_hand', reason: null, created_at: '2026-11-18T00:00:00Z' }]);
    });
    expect(result.current.handRaisedUserIds.size).toBe(0);
  });
});
