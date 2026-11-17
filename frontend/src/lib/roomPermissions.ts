import type { GroupMember } from './group.types';
import type { StudyRoomMember } from './studyRoom.types';

/**
 * Authority inside one study room, highest first. Mirrors `RoomRank` / `room_rank` in
 * backend/app/core/permissions.py -- the backend re-checks every action, this only decides
 * which controls to show.
 *
 * Core rule: kick / mute / drawing rights only ever target someone with a STRICTLY LOWER
 * rank, so a moderator can't act on another moderator, the host or the owner.
 */
export const RoomRank = {
  NONE: -1,
  PARTICIPANT: 0,
  EDITOR: 1,
  GROUP_MODERATOR: 2,
  HOST: 3,
  OWNER: 4,
} as const;
export type RoomRank = (typeof RoomRank)[keyof typeof RoomRank];

export function roomRankOf(
  userId: string | null | undefined,
  groupMembers: Pick<GroupMember, 'user_id' | 'role' | 'status'>[],
  roomMembers: Pick<StudyRoomMember, 'user_id' | 'role'>[]
): RoomRank {
  if (!userId) return RoomRank.NONE;
  const groupMember = groupMembers.find((m) => m.user_id === userId);
  if (!groupMember || groupMember.status !== 'active') return RoomRank.NONE;
  if (groupMember.role === 'owner') return RoomRank.OWNER;
  const roomMember = roomMembers.find((m) => m.user_id === userId);
  if (roomMember?.role === 'host') return RoomRank.HOST;
  if (groupMember.role === 'moderator') return RoomRank.GROUP_MODERATOR;
  if (roomMember?.role === 'editor') return RoomRank.EDITOR;
  return RoomRank.PARTICIPANT;
}

/** What the current viewer may do in the room. */
export function roomPermissionsFor(rank: RoomRank) {
  return {
    /** Rename / delete the room, hand over the host role. */
    canManageRoom: rank >= RoomRank.HOST,
    /** Open the moderation tools (drawing rights, invitations, stop activities). */
    canModerate: rank >= RoomRank.GROUP_MODERATOR,
    canDraw: rank >= RoomRank.EDITOR,
  };
}

/** May `actor` kick / mute / change the drawing rights of `target`? */
export function canActOn(actor: RoomRank, target: RoomRank): boolean {
  return actor >= RoomRank.GROUP_MODERATOR && target < actor;
}

export const ROOM_RANK_LABEL: Record<RoomRank, string> = {
  [RoomRank.NONE]: 'Khách',
  [RoomRank.PARTICIPANT]: 'Thành viên',
  [RoomRank.EDITOR]: 'Được vẽ',
  [RoomRank.GROUP_MODERATOR]: 'Điều hành viên',
  [RoomRank.HOST]: 'Chủ phòng',
  [RoomRank.OWNER]: 'Trưởng nhóm',
};
