import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StudyRoom } from './StudyRoom';
import { useStudyRoom } from '../../hooks/useStudyRoom';
import type { StudyRoom as StudyRoomType } from '../../lib/studyRoom.types';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { name: 'Người kiểm thử', initials: 'NK', color: '#2563EB', avatarUrl: null },
    getBan: () => null,
  }),
}));
vi.mock('../../hooks/useStudyRoom', () => ({ useStudyRoom: vi.fn() }));
vi.mock('../../hooks/useRoomMessages', () => ({
  useRoomMessages: () => ({
    messages: [], isLoading: false, loadError: null, isSending: false,
    sendError: null, sendMessage: vi.fn(), updateMessageReactions: vi.fn(),
  }),
}));
vi.mock('../../hooks/useMessageReactionActions', () => ({ useMessageReactionActions: () => vi.fn() }));
vi.mock('../../hooks/useMessageImageAttachment', () => ({
  ALLOWED_IMAGE_ACCEPT: 'image/*',
  useMessageImageAttachment: () => ({
    hasImage: false, isUploading: false, clearImage: vi.fn(), selectImage: vi.fn(), uploadImage: vi.fn(),
  }),
}));
vi.mock('../../lib/meeting.api', () => ({ claimMeetingSession: vi.fn().mockResolvedValue({ active: true }) }));
vi.mock('./meeting/WhiteboardPanel', () => ({ WhiteboardPanel: () => null }));
vi.mock('./meeting/PresentationViewer', () => ({ PresentationViewer: () => null }));
vi.mock('./meeting/MeetingVideoGrid', () => ({ MeetingVideoGrid: () => <div data-testid="video-grid" /> }));
vi.mock('./meeting/MeetingControls', () => ({ MeetingControls: () => null }));
vi.mock('./SessionTasksPanel', () => ({ SessionTasksPanel: () => null }));
vi.mock('./meeting/MeetingProvider', () => ({
  MeetingProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../activities/RoomActivities', () => ({
  ActivitiesButton: () => null,
  GameModeTab: () => null,
  GameStage: () => null,
  MusicMiniBar: () => null,
  MusicSidebarPanel: () => null,
  MusicTabButton: () => null,
  RoomActivitiesProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./meeting/PreJoinLobby', () => ({
  PreJoinLobby: ({ onJoin }: { onJoin: (choice: object) => void }) => (
    <section data-testid="prejoin-lobby">
      <button onClick={() => onJoin({ audioEnabled: false, videoEnabled: false })}>join</button>
    </section>
  ),
}));

const fakeRoom = {
  id: 'room-1', name: 'Phòng ABC', description: '', group_id: 'group-1', conversation_id: 'conversation-1',
} as StudyRoomType;

function hookResult(isMember: boolean, overrides: Record<string, unknown> = {}) {
  return {
    room: fakeRoom,
    members: [],
    loading: false,
    roomError: null,
    actionError: null,
    clearActionError: vi.fn(),
    currentUserId: 'user-1',
    currentMember: isMember ? { user_id: 'user-1', joined_at: new Date().toISOString(), left_at: null } : null,
    rankOf: vi.fn(),
    myRank: 'participant',
    permissions: { canModerate: false, canManageRoom: false },
    whiteboardEditorIds: new Set<string>(),
    isCurrentUserMember: isMember,
    handRaisedUserIds: new Set<string>(),
    moderationMutedUserIds: new Set<string>(),
    join: vi.fn(),
    leave: vi.fn(),
    deleteRoom: vi.fn(),
    moderate: vi.fn(),
    changeMemberRole: vi.fn(),
    transferHost: vi.fn(),
    refetchRoom: vi.fn(),
    refetchMembers: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useStudyRoom>;
}

const page = () => (
  <MemoryRouter initialEntries={['/room/room-1']}>
    <Routes>
      <Route path="/room/:id" element={<StudyRoom />} />
      <Route path="/groups/:groupId" element={<div data-testid="group-page" />} />
    </Routes>
  </MemoryRouter>
);

async function enterCall() {
  const view = render(page());
  await act(async () => {
    fireEvent.click(screen.getByText('join'));
  });
  expect(screen.getByTestId('video-grid')).toBeInTheDocument();
  return view;
}

describe('StudyRoom: membership closed while in the call (phone passive disconnect)', () => {
  beforeEach(() => {
    vi.mocked(useStudyRoom).mockReset();
    vi.mocked(useStudyRoom).mockReturnValue(hookResult(true));
  });

  it('shows a clear "disconnected" screen and lets the user rejoin via the lobby', async () => {
    const view = await enterCall();

    // Server closed the membership (LiveKit webhook) -- the user never pressed "Rời phòng".
    vi.mocked(useStudyRoom).mockReturnValue(hookResult(false));
    view.rerender(page());
    expect(screen.getByText('Bạn đã bị ngắt khỏi phòng học')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tham gia lại'));
    expect(screen.getByTestId('prejoin-lobby')).toBeInTheDocument();
  });

  it('does not show the disconnected screen when the user leaves on purpose', async () => {
    let finishLeave: () => void = () => {};
    const leave = vi.fn(() => new Promise<void>((resolve) => { finishLeave = resolve; }));
    vi.mocked(useStudyRoom).mockReturnValue(hookResult(true, { leave }));
    const view = await enterCall();

    // While the leave request is in flight the hook already reports "not a member";
    // that must not flash the "disconnected" screen.
    act(() => {
      fireEvent.click(screen.getByTitle('Thoát phòng học'));
    });
    vi.mocked(useStudyRoom).mockReturnValue(hookResult(false, { leave }));
    view.rerender(page());
    expect(leave).toHaveBeenCalled();
    expect(screen.queryByText('Bạn đã bị ngắt khỏi phòng học')).not.toBeInTheDocument();

    await act(async () => finishLeave());
    expect(screen.getByTestId('group-page')).toBeInTheDocument();
  });

  it('re-checks membership when the phone tab becomes visible or the network returns', async () => {
    const refetchMembers = vi.fn();
    const refetchRoom = vi.fn();
    vi.mocked(useStudyRoom).mockReturnValue(hookResult(true, { refetchMembers, refetchRoom }));
    await enterCall();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Mất kết nối mạng');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(refetchMembers).toHaveBeenCalledTimes(1);
    expect(refetchRoom).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refetchMembers).toHaveBeenCalledTimes(2);
  });
});
