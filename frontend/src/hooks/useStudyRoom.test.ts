import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from './useAuth';
import { useStudyRoomMembersRealtime } from './useStudyRoomMembersRealtime';
import { listGroupMembers } from '../lib/group.api';
import { ApiError } from '../lib/apiClient';
import { setOwnedMediaSession, clearOwnedMediaSession } from '../lib/meetingOwnerState';
import {
  getStudyRoom,
  getStudyRoomSession,
  joinStudyRoom,
  leaveStudyRoom,
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
  getStudyRoomSession: vi.fn(),
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
const mockedGetSession = vi.mocked(getStudyRoomSession);
const mockedJoinRoom = vi.mocked(joinStudyRoom);
const mockedLeaveRoom = vi.mocked(leaveStudyRoom);
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
  mockedGetSession.mockReset().mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: null, can_connect: false });
  mockedJoinRoom.mockReset();
  mockedLeaveRoom.mockReset();
  mockedListMembers.mockReset().mockResolvedValue([]);
  mockedListModeration.mockReset().mockResolvedValue([]);
  mockedLeaveOnUnload.mockReset();
  clearOwnedMediaSession('room-1', 'media-1');
});

describe('useStudyRoom -- leave-on-unload cleanup', () => {
  it('fires a beacon leave on pagehide while the caller is an active room member', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    setOwnedMediaSession('room-1', 'media-1');
    window.dispatchEvent(new Event('pagehide'));

    expect(mockedLeaveOnUnload).toHaveBeenCalledWith('room-1', '2026-08-19T00:00:00Z', 'media-1');
  });

  it('does not let a superseded tab revoke the replacement session on pagehide', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    mockedListMembers.mockResolvedValue([makeMember()]);
    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    // This tab has a valid DB membership, but no media claim (superseded).
    window.dispatchEvent(new Event('pagehide'));
    expect(mockedLeaveOnUnload).not.toHaveBeenCalled();
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
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result, unmount } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    setOwnedMediaSession('room-1', 'media-1');
    unmount();

    expect(mockedLeaveOnUnload).toHaveBeenCalledWith('room-1', '2026-08-19T00:00:00Z', 'media-1');
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
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    mockedListMembers.mockResolvedValueOnce([makeMember()]);

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));

    mockedListMembers.mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    await act(async () => { await result.current.refetchMembers(); });
    expect(result.current.isCurrentUserMember).toBe(false);
    expect(result.current.membersError?.status).toBe(403);
  });

  it('ignores a moderation response from a membership that was revoked meanwhile', async () => {
    mockedGetSession.mockResolvedValueOnce({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true })
      .mockResolvedValueOnce({ room_id: 'room-1', room_status: 'active', member: null, can_connect: false });
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


describe('useStudyRoom -- authoritative backend session contract', () => {
  it('recognizes an active current user even when the shared roster is empty', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([]);
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.currentMember?.user_id).toBe(CURRENT_USER_ID));
    expect(result.current.isCurrentUserMember).toBe(true);
    expect(result.current.members).toEqual([]);
    expect(result.current.sessionError).toBeNull();
  });

  it('honors server revocation even if the shared roster still contains the caller', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([makeMember()]);
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember({ left_at: '2026-11-18T00:00:00Z' }), can_connect: false });
    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.currentMember?.left_at).toBe('2026-11-18T00:00:00Z'));
    expect(result.current.isCurrentUserMember).toBe(false);
    expect(result.current.members.length).toBe(1);
  });

  it('a definitive 403 session response invalidates prior membership', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([makeMember()]);
    mockedGetSession.mockResolvedValueOnce({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true })
      .mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    await act(async () => { await result.current.refetchMembers(); });
    expect(result.current.isCurrentUserMember).toBe(false);
    expect(result.current.sessionError?.status).toBe(403);
  });
});


describe('useStudyRoom -- cross-room identity and generation isolation', () => {
  it('discards the previous room participation on a same-component route change', async () => {
    mockedGetStudyRoom.mockImplementation(async (id) => makeRoom({ id, group_id: `group-${id}` }));
    mockedGetSession.mockImplementation((id) => id === 'room-1'
      ? Promise.resolve({ room_id: id, room_status: 'active', member: makeMember(), can_connect: true })
      : new Promise(() => {}));
    mockedListMembers.mockResolvedValue([makeMember()]);

    const { result, rerender } = renderHook(({ id }) => useStudyRoom(id), {
      initialProps: { id: 'room-1' },
    });
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    await act(async () => { rerender({ id: 'room-2' }); });

    // Even while the room-2 session request is pending, room-1 must never
    // enable the room-2 LiveKit provider or protected moderation request.
    expect(result.current.isCurrentUserMember).toBe(false);
    expect(result.current.currentMember).toBeNull();
    expect(result.current.room?.id).not.toBe('room-1');
    expect(result.current.members).toEqual([]);
    expect(mockedListModeration).not.toHaveBeenCalledWith('room-2');
    // Without a confirmed media owner this old view must never send a leave
    // that could invalidate a newer tab's membership.
    expect(mockedLeaveOnUnload).not.toHaveBeenCalled();
  });

  it('cannot call unconditional leave before our own join generation is confirmed', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([]);
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: null, can_connect: false });

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.leave(); });
    expect(mockedLeaveRoom).not.toHaveBeenCalled();
  });

  it('an explicit leave must include the current confirmed generation', async () => {
    mockedGetStudyRoom.mockResolvedValue(makeRoom());
    mockedListMembers.mockResolvedValue([makeMember()]);
    mockedGetSession.mockResolvedValue({ room_id: 'room-1', room_status: 'active', member: makeMember(), can_connect: true });
    mockedLeaveRoom.mockResolvedValue(makeMember({ left_at: '2026-11-18T00:00:00Z' }));

    const { result } = renderHook(() => useStudyRoom('room-1'));
    await waitFor(() => expect(result.current.isCurrentUserMember).toBe(true));
    await act(async () => { await result.current.leave(); });
    expect(mockedLeaveRoom).toHaveBeenCalledWith('room-1', makeMember().joined_at, null);
    expect(result.current.isCurrentUserMember).toBe(false);
  });
});
