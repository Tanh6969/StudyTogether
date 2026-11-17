import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomRank } from '../../../lib/roomPermissions';
import type { StudyRoomMember } from '../../../lib/studyRoom.types';
import { WhiteboardPermissionsModal } from './WhiteboardPermissionsModal';

function member(userId: string, role: StudyRoomMember['role']): StudyRoomMember {
  return {
    id: `member-${userId}`,
    room_id: 'room-1',
    user_id: userId,
    role,
    joined_at: new Date().toISOString(),
    left_at: null,
    user: { id: userId, username: userId, display_name: userId.toUpperCase(), avatar_url: null, role: 'user' },
  };
}

const ranks: Record<string, RoomRank> = {
  host: RoomRank.HOST,
  'mod-a': RoomRank.GROUP_MODERATOR,
  'mod-b': RoomRank.GROUP_MODERATOR,
  'member-1': RoomRank.PARTICIPANT,
  'member-2': RoomRank.EDITOR,
};
const members = [member('host', 'host'), member('mod-a', 'participant'), member('mod-b', 'participant'), member('member-1', 'participant'), member('member-2', 'editor')];

function renderModal(props: Partial<Parameters<typeof WhiteboardPermissionsModal>[0]> = {}) {
  const handlers = { onRoleChange: vi.fn().mockResolvedValue(undefined), onTransferHost: vi.fn().mockResolvedValue(undefined) };
  render(
    <WhiteboardPermissionsModal
      isOpen
      members={members}
      currentUserId="mod-a"
      myRank={RoomRank.GROUP_MODERATOR}
      rankOf={(id) => ranks[id] ?? RoomRank.NONE}
      pendingUserId={null}
      error={null}
      onClose={vi.fn()}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('WhiteboardPermissionsModal', () => {
  it('lets a moderator grant and revoke drawing for members ranked below them', () => {
    const { onRoleChange } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cho phép vẽ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));

    expect(onRoleChange).toHaveBeenNthCalledWith(1, 'member-1', 'editor');
    expect(onRoleChange).toHaveBeenNthCalledWith(2, 'member-2', 'participant');
  });

  it('gives a moderator no controls over the host or another moderator, and no host transfer', () => {
    renderModal();

    // only the two members below a moderator get a toggle
    expect(screen.getAllByRole('button', { name: /Cho phép vẽ|Thu hồi/ })).toHaveLength(2);
    expect(screen.getAllByText('Luôn được vẽ')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Trao quyền chủ phòng/ })).not.toBeInTheDocument();
  });

  it('lets the host hand the room over after an inline confirmation', () => {
    const { onTransferHost } = renderModal({ currentUserId: 'host', myRank: RoomRank.HOST });

    fireEvent.click(screen.getByRole('button', { name: 'Trao quyền chủ phòng cho MEMBER-1' }));
    expect(onTransferHost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    expect(onTransferHost).toHaveBeenCalledWith('member-1');
  });

  it('displays permission errors', () => {
    renderModal({ error: 'Không có quyền' });
    expect(screen.getByRole('alert')).toHaveTextContent('Không có quyền');
  });
});
