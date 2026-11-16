import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('WhiteboardPermissionsModal', () => {
  it('allows a group manager to grant and revoke whiteboard editing for multiple members', () => {
    const onRoleChange = vi.fn().mockResolvedValue(undefined);
    render(
      <WhiteboardPermissionsModal
        isOpen
        members={[member('host', 'host'), member('member-1', 'participant'), member('member-2', 'moderator')]}
        pendingUserId={null}
        error={null}
        onClose={vi.fn()}
        onRoleChange={onRoleChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cho phép vẽ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));

    expect(onRoleChange).toHaveBeenNthCalledWith(1, 'member-1', 'moderator');
    expect(onRoleChange).toHaveBeenNthCalledWith(2, 'member-2', 'participant');
    expect(screen.getByText('CHỦ PHÒNG')).toBeInTheDocument();
  });

  it('does not allow changing the host role and displays permission errors', () => {
    render(
      <WhiteboardPermissionsModal
        isOpen
        members={[member('host', 'host')]}
        pendingUserId={null}
        error="Không có quyền"
        onClose={vi.fn()}
        onRoleChange={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Cho phép vẽ' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Không có quyền');
  });
});
