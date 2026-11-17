import { describe, expect, it } from 'vitest';
import { canActOn, RoomRank, roomPermissionsFor, roomRankOf } from './roomPermissions';

const g = (user_id: string, role: 'owner' | 'moderator' | 'member', status: 'active' | 'left' | 'banned' = 'active') => ({ user_id, role, status });
const r = (user_id: string, role: 'host' | 'editor' | 'participant') => ({ user_id, role });

const group = [g('owner', 'owner'), g('host', 'member'), g('mod', 'moderator'), g('modhost', 'moderator'), g('ed', 'member'), g('p', 'member'), g('gone', 'moderator', 'left')];
const room = [r('owner', 'participant'), r('host', 'host'), r('mod', 'participant'), r('ed', 'editor'), r('p', 'participant'), r('gone', 'host')];

describe('roomRankOf', () => {
  it('orders owner > host > group moderator > editor > participant', () => {
    expect(roomRankOf('owner', group, room)).toBe(RoomRank.OWNER);
    expect(roomRankOf('host', group, room)).toBe(RoomRank.HOST);
    expect(roomRankOf('mod', group, room)).toBe(RoomRank.GROUP_MODERATOR);
    expect(roomRankOf('ed', group, room)).toBe(RoomRank.EDITOR);
    expect(roomRankOf('p', group, room)).toBe(RoomRank.PARTICIPANT);
  });

  it('a group moderator who hosts the room ranks as host', () => {
    expect(roomRankOf('modhost', group, [r('modhost', 'host')])).toBe(RoomRank.HOST);
  });

  it('anyone no longer active in the group has no authority', () => {
    expect(roomRankOf('gone', group, room)).toBe(RoomRank.NONE);
    expect(roomRankOf('stranger', group, room)).toBe(RoomRank.NONE);
    expect(roomRankOf(null, group, room)).toBe(RoomRank.NONE);
  });
});

describe('canActOn', () => {
  it('only targets strictly lower ranks', () => {
    expect(canActOn(RoomRank.GROUP_MODERATOR, RoomRank.GROUP_MODERATOR)).toBe(false);
    expect(canActOn(RoomRank.GROUP_MODERATOR, RoomRank.HOST)).toBe(false);
    expect(canActOn(RoomRank.GROUP_MODERATOR, RoomRank.EDITOR)).toBe(true);
    expect(canActOn(RoomRank.HOST, RoomRank.GROUP_MODERATOR)).toBe(true);
    expect(canActOn(RoomRank.HOST, RoomRank.OWNER)).toBe(false);
    expect(canActOn(RoomRank.OWNER, RoomRank.HOST)).toBe(true);
    expect(canActOn(RoomRank.EDITOR, RoomRank.PARTICIPANT)).toBe(false);
  });
});

describe('roomPermissionsFor', () => {
  it('room settings belong to owner and host only', () => {
    expect(roomPermissionsFor(RoomRank.HOST).canManageRoom).toBe(true);
    expect(roomPermissionsFor(RoomRank.GROUP_MODERATOR).canManageRoom).toBe(false);
    expect(roomPermissionsFor(RoomRank.GROUP_MODERATOR).canModerate).toBe(true);
    expect(roomPermissionsFor(RoomRank.EDITOR).canDraw).toBe(true);
    expect(roomPermissionsFor(RoomRank.PARTICIPANT).canDraw).toBe(false);
  });
});
