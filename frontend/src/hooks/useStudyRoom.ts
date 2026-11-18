import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useStudyRoomMembersRealtime } from './useStudyRoomMembersRealtime';
import { useRoomModerationRealtime } from './useRoomModerationRealtime';
import { ApiError } from '../lib/apiClient';
import { listGroupMembers } from '../lib/group.api';
import type { GroupMember } from '../lib/group.types';
import { RoomRank, roomPermissionsFor, roomRankOf } from '../lib/roomPermissions';
import {
  deleteStudyRoom,
  getStudyRoom,
  getStudyRoomSession,
  joinStudyRoom,
  leaveStudyRoom,
  leaveStudyRoomOnUnload,
  listStudyRoomMembers,
  listStudyRoomModeration,
  logStudyRoomModeration,
  transferStudyRoomHost,
  updateStudyRoomMemberRole,
} from '../lib/studyRoom.api';
import type {
  ModerationAction,
  RoomModerationAction,
  StudyRoom,
  StudyRoomMember,
  StudyRoomMemberRole,
} from '../lib/studyRoom.types';

export interface StudyRoomError {
  status: number | null;
  message: string;
}

function toStudyRoomError(err: unknown): StudyRoomError {
  if (err instanceof ApiError) {
    return { status: err.status, message: err.message };
  }
  return { status: null, message: 'Đã xảy ra lỗi không xác định.' };
}

/** Derives, per user, the outcome of the most recent action in `pair` from the (newest-first) moderation log. */
function latestActionUserSet(
  actions: RoomModerationAction[],
  pair: [ModerationAction, ModerationAction]
): Set<string> {
  const [onAction] = pair;
  const seen = new Set<string>();
  const on = new Set<string>();
  for (const action of actions) {
    if (action.action !== pair[0] && action.action !== pair[1]) continue;
    if (seen.has(action.target_user_id)) continue;
    seen.add(action.target_user_id);
    if (action.action === onAction) on.add(action.target_user_id);
  }
  return on;
}

export function useStudyRoom(roomId: string | undefined) {
  const { user, isLoggedIn } = useAuth();
  const currentUserId = user?.id ?? null;

  const [room, setRoom] = useState<StudyRoom | null>(null);
  const [members, setMembers] = useState<StudyRoomMember[]>([]);
  const [sessionMember, setSessionMember] = useState<StudyRoomMember | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [sessionError, setSessionError] = useState<StudyRoomError | null>(null);
  const [moderationActions, setModerationActions] = useState<RoomModerationAction[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomError, setRoomError] = useState<StudyRoomError | null>(null);
  const [membersError, setMembersError] = useState<StudyRoomError | null>(null);
  const [actionError, setActionError] = useState<StudyRoomError | null>(null);
  // All member-list refresh paths share one revision, so a slow old response cannot
  // overwrite the result of a newer refresh or a successful join/leave.
  const memberRequestRevision = useRef(0);
  const sessionRequestRevision = useRef(0);
  const moderationRequestRevision = useRef(0);

  const loadRoom = useCallback(async () => {
    if (!roomId) {
      setRoom(null);
      setRoomError({ status: null, message: 'Thiếu mã phòng học.' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setRoomError(null);
    try {
      const data = await getStudyRoom(roomId);
      setRoom(data);
    } catch (err) {
      setRoom(null);
      setRoomError(toStudyRoomError(err));
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Refresh metadata without unmounting an active LiveKit connection. A temporary
  // network error is not evidence that a previously loaded room has disappeared.
  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      setRoom(await getStudyRoom(roomId));
      setRoomError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setRoomError(toStudyRoomError(err));
        setRoom(null);
      } else {
        console.warn('[StudyRoom] Background refresh failed; retaining active call', err);
      }
    }
  }, [roomId]);

  // The current user's authority is not inferred from the roster: a roster GET
  // may fail or be stale while the authenticated user has an active session.
  const loadSession = useCallback(async () => {
    if (!roomId || !isLoggedIn) return;
    const revision = ++sessionRequestRevision.current;
    try {
      const snapshot = await getStudyRoomSession(roomId);
      if (revision !== sessionRequestRevision.current) return;
      setSessionMember(snapshot.member);
      setSessionResolved(true);
      setSessionError(null);
    } catch (err) {
      if (revision !== sessionRequestRevision.current) return;
      if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
        setSessionMember(null);
        setSessionResolved(true);
      }
      // Transient session-read failures preserve a last confirmed join. The
      // LiveKit token endpoint still independently checks server permissions.
      setSessionError(toStudyRoomError(err));
    }
  }, [roomId, isLoggedIn]);

  const loadMembers = useCallback(async () => {
    if (!roomId || !isLoggedIn) return;
    const revision = ++memberRequestRevision.current;
    try {
      const data = await listStudyRoomMembers(roomId, true);
      if (revision !== memberRequestRevision.current) return;
      setMembers(data);
      setMembersError(null);
    } catch (err) {
      if (revision !== memberRequestRevision.current) return;
      // Transport failure is UNKNOWN, not an empty roster. An explicit permission
      // denial or missing room, by contrast, must invalidate local participation.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) {
        setMembers([]);
        // The roster's visibility gate and /session share active group access.
        // Never retain local participation after an explicit access denial.
        sessionRequestRevision.current++;
        setSessionMember(null);
        setSessionResolved(true);
        setSessionError(toStudyRoomError(err));
      }
      setMembersError(toStudyRoomError(err));
    }
  }, [roomId, isLoggedIn]);

  const loadModeration = useCallback(async () => {
    if (!roomId || !isLoggedIn) return;
    const revision = ++moderationRequestRevision.current;
    try {
      const data = await listStudyRoomModeration(roomId);
      if (revision !== moderationRequestRevision.current) return;
      setModerationActions(data);
    } catch (err) {
      if (revision !== moderationRequestRevision.current) return;
      // Supplementary data failure must not interrupt video; retain the last
      // known indicators and emit a diagnostic rather than silently hiding it.
      console.warn('[StudyRoom] Moderation history unavailable', err);
    }
  }, [roomId, isLoggedIn]);

  // Group roles feed the room ranks (owner > host > group moderator > editor > participant,
  // lib/roomPermissions.ts). UX-only: the backend re-checks the same rule on every request.
  const groupId = room?.group_id ?? null;
  const loadGroupMembers = useCallback(async () => {
    if (!groupId || !isLoggedIn) return;
    try {
      setGroupMembers(await listGroupMembers(groupId));
    } catch {
      // Non-critical for read access -- only used to decide which controls to show.
      setGroupMembers([]);
    }
  }, [groupId, isLoggedIn]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  useEffect(() => {
    if (!room) return;
    void loadMembers();
    void loadSession();
  }, [room?.id, loadMembers, loadSession]);

  useEffect(() => {
    loadGroupMembers();
  }, [loadGroupMembers]);

  // `members` otherwise only refreshes after the current user's own join/leave/moderate
  // action -- an already-open tab never learns when someone ELSE joins or leaves, so the
  // member count/list silently goes stale (e.g. sidebar stuck showing "(2)" after a 3rd and
  // 4th person join). useStudyRoomMembersRealtime (below) is the primary, near-instant fix
  // once docs/db/migrations/026_enable_study_room_members_realtime.sql has been run live; this
  // poll is a resilience fallback that keeps working even if that Realtime channel is still
  // pending, disconnects, or misses an event (documented gap: Postgres Changes evaluates RLS
  // against an UPDATE's post-image, see 026's header) -- worst case is a 10s-stale count
  // instead of an indefinitely-stale one.
  const reconcileMembership = useCallback(() => {
    void loadMembers();
    void loadSession();
  }, [loadMembers, loadSession]);

  useEffect(() => {
    if (!room) return;
    const interval = setInterval(reconcileMembership, 10000);
    return () => clearInterval(interval);
  }, [room?.id, reconcileMembership]);

  // Near-instant member list refresh on any INSERT/UPDATE to this room's study_room_members
  // rows (join/leave/kick/role-change) -- see useStudyRoomMembersRealtime.ts and 026's header.
  useStudyRoomMembersRealtime(room ? roomId ?? null : null, reconcileMembership);
  // Raised hands / moderation mutes: without this, another participant's hand only showed
  // up after a full reload (see db/migrations/005_room_tasks.sql).

  // Session authority is never inferred from a possibly stale/shared roster.
  // No /session response yet means unconfirmed access, not active membership.
  const currentMember = sessionResolved ? sessionMember : null;

  const isCurrentUserMember = !!currentMember && !currentMember.left_at;

  // Read protected moderation data only after room membership is confirmed.
  // The chat hook already uses the same participation boundary.
  useEffect(() => {
    if (room && isCurrentUserMember) {
      void loadModeration();
    } else {
      // A late response from a prior membership generation must not reveal
      // moderation data after the user has left or been removed.
      moderationRequestRevision.current++;
      setModerationActions([]);
    }
  }, [room, isCurrentUserMember, loadModeration]);
  useRoomModerationRealtime(room && isCurrentUserMember ? roomId ?? null : null, loadModeration);

  const memberView = useMemo(() =>
    currentMember
      ? [...members.filter((member) => member.user_id !== currentUserId), currentMember]
      : members.filter((member) => member.user_id !== currentUserId),
    [members, currentMember, currentUserId]
  );
  const rankOf = useCallback(
    (userId: string | null | undefined) => roomRankOf(userId, groupMembers, memberView),
    [groupMembers, memberView]
  );
  const myRank = rankOf(currentUserId);
  const permissions = useMemo(() => roomPermissionsFor(myRank), [myRank]);
  // Everyone whose board strokes count: rank >= EDITOR (backend: can_edit_whiteboard).
  const whiteboardEditorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of groupMembers) if (rankOf(m.user_id) >= RoomRank.EDITOR) ids.add(m.user_id);
    return ids;
  }, [groupMembers, rankOf]);

  // Best-effort membership cleanup for tab close/reload/navigation-away, so a browser
  // departure doesn't leave `study_room_members.left_at` stale/NULL indefinitely (the
  // explicit "Rời phòng" button already calls `leave()` directly -- this only covers the
  // paths that skip it). `left_at` here means "explicitly left this room's membership", not
  // "currently connected to the LiveKit call" (see StudyRoomsService.leave / can_access_room)
  // -- the backend `leave` endpoint is idempotent, so firing this redundantly (e.g. right
  // after an explicit leave, or on every dev-mode double-mount) is harmless, just wasted.
  //
  // Two triggers, covering the two ways this page goes away:
  // - `pagehide`: tab close, reload, or a full browser navigation. `beforeunload` is
  //   deliberately not used -- it isn't reliably fired on mobile and defeats the back/forward
  //   cache, whereas `pagehide` fires in both the unload and bfcache-eligible cases.
  // - the effect's own cleanup: an in-SPA route change away from this room (e.g. clicking a
  //   nav link instead of "Rời phòng") unmounts this hook without ever firing `pagehide`.
  // A ref (not `isCurrentUserMember` in the cleanup's closure) is required for the second
  // case: effect cleanups close over the render they were created in, so without it the
  // cleanup could act on a stale membership flag from whenever the effect last re-ran.
  const activeJoinGenerationRef = useRef(isCurrentUserMember ? currentMember?.joined_at ?? null : null);
  activeJoinGenerationRef.current = isCurrentUserMember ? currentMember?.joined_at ?? null : null;

  useEffect(() => {
    if (!roomId) return;
    const handlePageHide = () => {
      if (activeJoinGenerationRef.current) leaveStudyRoomOnUnload(roomId, activeJoinGenerationRef.current);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      if (activeJoinGenerationRef.current) leaveStudyRoomOnUnload(roomId, activeJoinGenerationRef.current);
    };
  }, [roomId]);

  // Derived, real-data-backed indicators from the moderation audit log (latest action per user wins).
  // These are NOT LiveKit/media state — see studyRoom.types.ts ModerationAction.
  const handRaisedUserIds = useMemo(
    () => latestActionUserSet(moderationActions, ['raise_hand', 'lower_hand']),
    [moderationActions]
  );
  const moderationMutedUserIds = useMemo(
    () => latestActionUserSet(moderationActions, ['mute', 'unmute']),
    [moderationActions]
  );

  const join = useCallback(async () => {
    if (!roomId) return;
    setActionError(null);
    try {
      // POST /join is the authoritative acknowledgement for this user's session;
      // a separate roster GET must never turn a successful join into an idle call.
      const member = await joinStudyRoom(roomId);
      sessionRequestRevision.current++;
      setSessionMember(member);
      setSessionResolved(true);
      setSessionError(null);
      memberRequestRevision.current++;
      setMembers((previous) => [...previous.filter((entry) => entry.user_id !== member.user_id), member]);
      setMembersError(null);
      // Fetch the full roster independently; a transient failure retains the join acknowledgement.
      void loadMembers();
    } catch (err) {
      setActionError(toStudyRoomError(err));
      throw err;
    }
  }, [roomId, loadMembers]);

  const leave = useCallback(async () => {
    if (!roomId) return;
    setActionError(null);
    try {
      // A stale tab cannot close a newer join generation in another tab.
      // A successful conditional response still reports the database membership;
      // if its generation changed, close only this tab's local UI.
      const joinedAt = currentMember?.joined_at;
      const member = await leaveStudyRoom(roomId, joinedAt);
      sessionRequestRevision.current++;
      const superseded = !!joinedAt && member.joined_at !== joinedAt;
      setSessionMember(superseded ? null : member);
      setSessionResolved(true);
      setSessionError(null);
      memberRequestRevision.current++;
      if (!superseded) {
        setMembers((previous) => [...previous.filter((entry) => entry.user_id !== member.user_id), member]);
        void loadMembers();
      }
    } catch (err) {
      setActionError(toStudyRoomError(err));
      throw err;
    }
  }, [roomId, currentMember?.joined_at, loadMembers]);

  const moderate = useCallback(
    async (targetUserId: string, action: ModerationAction) => {
      if (!roomId || !currentUserId) return;
      setActionError(null);
      try {
        await logStudyRoomModeration(roomId, currentUserId, targetUserId, action);
        await Promise.all([loadMembers(), loadModeration()]);
      } catch (err) {
        setActionError(toStudyRoomError(err));
        throw err;
      }
    },
    [roomId, currentUserId, loadMembers, loadModeration]
  );

  /** Soft delete (see docs/db/migrations/010_soft_delete_study_rooms.sql). Deliberately does
   * NOT call loadRoom() afterward -- the room is no longer normally accessible, so the caller
   * (StudyRoom.tsx) is responsible for navigating away on success. */
  const deleteRoom = useCallback(async () => {
    if (!roomId) return;
    setActionError(null);
    try {
      await deleteStudyRoom(roomId);
    } catch (err) {
      setActionError(toStudyRoomError(err));
      throw err;
    }
  }, [roomId]);

  const changeMemberRole = useCallback(
    async (userId: string, role: Exclude<StudyRoomMemberRole, 'host'>) => {
      if (!roomId) return;
      setActionError(null);
      try {
        await updateStudyRoomMemberRole(roomId, userId, role);
        await loadMembers();
      } catch (err) {
        setActionError(toStudyRoomError(err));
        throw err;
      }
    },
    [roomId, loadMembers]
  );

  const transferHost = useCallback(
    async (userId: string) => {
      if (!roomId) return;
      setActionError(null);
      try {
        await transferStudyRoomHost(roomId, userId);
        await Promise.all([loadMembers(), refreshRoom()]);
      } catch (err) {
        setActionError(toStudyRoomError(err));
        throw err;
      }
    },
    [roomId, loadMembers, refreshRoom]
  );

  return {
    room,
    members,
    loading,
    roomError,
    membersError,
    sessionError,
    actionError,
    clearActionError: () => setActionError(null),
    currentUserId,
    currentMember,
    isCurrentUserMember,
    rankOf,
    myRank,
    permissions,
    whiteboardEditorIds,
    handRaisedUserIds,
    moderationMutedUserIds,
    join,
    leave,
    deleteRoom,
    moderate,
    changeMemberRole,
    transferHost,
    refetchMembers: reconcileMembership,
    refetchRoom: refreshRoom,
  };
}
