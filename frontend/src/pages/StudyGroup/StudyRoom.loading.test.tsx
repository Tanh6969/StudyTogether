import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
vi.mock('../../hooks/useMessageReactionActions', () => ({
  useMessageReactionActions: () => vi.fn(),
}));
vi.mock('../../hooks/useMessageImageAttachment', () => ({
  ALLOWED_IMAGE_ACCEPT: 'image/*',
  useMessageImageAttachment: () => ({
    hasImage: false, isUploading: false, clearImage: vi.fn(),
    selectImage: vi.fn(), uploadImage: vi.fn(),
  }),
}));
// Heavy canvas/media modules are not mounted before the user confirms joining.
vi.mock('./meeting/WhiteboardPanel', () => ({ WhiteboardPanel: () => null }));
vi.mock('./meeting/PresentationViewer', () => ({ PresentationViewer: () => null }));
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
  PreJoinLobby: ({ roomName }: { roomName: string }) => (
    <section data-testid="prejoin-lobby">Phòng đã sẵn sàng: {roomName}</section>
  ),
}));

const fakeRoom = {
  id: 'room-1',
  name: 'Phòng ABC',
  description: '',
  group_id: 'group-1',
  conversation_id: 'conversation-1',
} as StudyRoomType;

function makeHookResult(loading: boolean, roomError: { status: number; message: string } | null = null) {
  return {
    room: loading || roomError ? null : fakeRoom,
    members: [],
    loading,
    roomError,
    actionError: null,
    clearActionError: vi.fn(),
    currentUserId: 'user-1',
    currentMember: null,
    rankOf: vi.fn(),
    myRank: null,
    permissions: { canModerate: false, canManageRoom: false },
    whiteboardEditorIds: new Set<string>(),
    isCurrentUserMember: false,
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
  } as unknown as ReturnType<typeof useStudyRoom>;
}

function renderPage() {
  const page = () => (
    <MemoryRouter initialEntries={['/room/room-1']}>
      <Routes>
        <Route path="/room/:id" element={<StudyRoom />} />
      </Routes>
    </MemoryRouter>
  );
  return { page, view: render(page()) };
}

describe('StudyRoom render lifecycle: no conditional hooks after loading', () => {
  beforeEach(() => vi.mocked(useStudyRoom).mockReset());

  it('transitions from loading to the prejoin lobby on the SAME component without crashing', () => {
    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(true));
    const { page, view } = renderPage();
    expect(screen.getByText('Đang tải phòng học...')).toBeInTheDocument();

    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(false));
    expect(() => view.rerender(page())).not.toThrow();
    expect(screen.getByTestId('prejoin-lobby')).toHaveTextContent('Phòng ABC');
    expect(screen.queryByText('Đang tải phòng học...')).not.toBeInTheDocument();
  });

  it('can transition loading → error → loaded without altering hook ordering', () => {
    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(true));
    const { page, view } = renderPage();

    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(false, {status: 503, message: 'Temporary outage'}));
    expect(() => view.rerender(page())).not.toThrow();
    expect(screen.getByText('Không thể tải phòng học')).toBeInTheDocument();

    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(false));
    expect(() => view.rerender(page())).not.toThrow();
    expect(screen.getByTestId('prejoin-lobby')).toBeInTheDocument();
  });

  it('can return from loaded to loading to loaded without breaking the call UI', () => {
    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(false));
    const { page, view } = renderPage();
    expect(screen.getByTestId('prejoin-lobby')).toBeInTheDocument();

    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(true));
    expect(() => view.rerender(page())).not.toThrow();
    expect(screen.getByText('Đang tải phòng học...')).toBeInTheDocument();

    vi.mocked(useStudyRoom).mockReturnValue(makeHookResult(false));
    expect(() => view.rerender(page())).not.toThrow();
    expect(screen.getByTestId('prejoin-lobby')).toBeInTheDocument();
  });
});
