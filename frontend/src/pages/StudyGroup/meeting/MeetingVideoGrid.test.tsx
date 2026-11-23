import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Track } from 'livekit-client';
import { MeetingVideoGrid } from './MeetingVideoGrid';
import { MeetingContext } from './MeetingContext';
import type { MeetingContextValue } from './MeetingContext';
import type { StudyRoomMember } from '../../../lib/studyRoom.types';
import { RoomRank } from '../../../lib/roomPermissions';

interface FakeParticipant {
  identity: string;
  name: string;
  isMicrophoneEnabled: boolean;
  isSpeaking: boolean;
}

interface FakeTrackRef {
  participant: { identity: string };
  publication: { trackSid: string; isMuted: boolean };
}

const mockParticipants: FakeParticipant[] = [];
const mockCameraTrackRefs: FakeTrackRef[] = [];
const mockScreenShareTrackRefs: FakeTrackRef[] = [];

vi.mock('@livekit/components-react', () => ({
  useParticipants: () => mockParticipants,
  useTracks: (sources: unknown[]) => (sources[0] === Track.Source.ScreenShare ? mockScreenShareTrackRefs : mockCameraTrackRefs),
  isTrackReference: (trackRef: unknown) => !!trackRef && typeof trackRef === 'object' && 'publication' in trackRef,
  VideoTrack: ({ trackRef }: { trackRef: FakeTrackRef }) => <div data-testid={`video-track-${trackRef.publication.trackSid}`}>{trackRef.participant.identity}</div>,
}));

const members: StudyRoomMember[] = [
  {
    id: 'm1',
    room_id: 'room-1',
    user_id: 'user-1',
    role: 'host',
    joined_at: '2026-01-01T00:00:00Z',
    left_at: null,
    user: { id: 'user-1', username: null, display_name: 'Minh Anh', avatar_url: null, role: 'user' },
  },
];

function renderGrid(contextValue: Partial<MeetingContextValue>, unavailableReason?: string, options?: {
  roomMembers?: StudyRoomMember[];
  rankOf?: (userId: string) => RoomRank;
  onModerate?: (userId: string, action: 'mute' | 'kick') => Promise<void>;
}) {
  const value: MeetingContextValue = { status: 'idle', error: null, retry: vi.fn(), connected: false, liveKitError: null, transferred: false, ...contextValue };
  return render(
    <MeetingContext.Provider value={value}>
      <MeetingVideoGrid members={options?.roomMembers ?? members} currentUserId="user-1" currentUserName="Minh Anh" unavailableReason={unavailableReason} rankOf={options?.rankOf} onModerate={options?.onModerate} />
    </MeetingContext.Provider>
  );
}

describe('MeetingVideoGrid', () => {
  beforeEach(() => {
    mockParticipants.length = 0;
    mockCameraTrackRefs.length = 0;
    mockScreenShareTrackRefs.length = 0;
  });

  it('shows a terminal transferred notice with no retry control', () => {
    renderGrid({ transferred: true, status: 'ready' });
    expect(screen.getByText('Cuộc gọi đã chuyển sang tab hoặc thiết bị khác')).toBeInTheDocument();
    expect(screen.queryByText('Kết nối lại')).not.toBeInTheDocument();
  });

  it('shows the ended-room message without waiting on a token request', () => {
    renderGrid({}, 'Phòng học này đã kết thúc, cuộc gọi không còn khả dụng.');
    expect(screen.getByText('Phòng học này đã kết thúc, cuộc gọi không còn khả dụng.')).toBeInTheDocument();
  });

  it('shows a loading state while the token request/connection is in progress', () => {
    renderGrid({ status: 'loading' });
    expect(screen.getByText('Đang xin quyền kết nối cuộc gọi...')).toBeInTheDocument();
  });

  it('distinguishes an idle request from an in-flight token request', () => {
    renderGrid({ status: 'idle' });
    expect(screen.getByText('Chưa thể bắt đầu cuộc gọi')).toBeInTheDocument();
    expect(screen.queryByText('Đang xin quyền kết nối cuộc gọi...')).not.toBeInTheDocument();
  });

  it('shows a retryable error state when the token request is rejected', async () => {
    const retry = vi.fn();
    renderGrid({ status: 'error', error: { status: 403, message: 'Bạn không có quyền tham gia cuộc gọi của phòng học này.' }, retry });

    expect(screen.getByText('Không thể kết nối cuộc gọi')).toBeInTheDocument();
    expect(screen.getByText('Bạn không có quyền tham gia cuộc gọi của phòng học này.')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Thử lại'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders the local participant and remote participants once connected', () => {
    mockParticipants.push(
      { identity: 'user-1', name: 'Minh Anh', isMicrophoneEnabled: true, isSpeaking: false },
      { identity: 'user-2', name: 'David Chen', isMicrophoneEnabled: false, isSpeaking: false }
    );

    renderGrid({ status: 'ready', connected: true });

    expect(screen.getByText('Minh Anh (Bạn)')).toBeInTheDocument();
    expect(screen.getByText('David Chen')).toBeInTheDocument();
    expect(screen.getByText('HOST')).toBeInTheDocument();
  });

  it('prefers the real Study Room member profile over the LiveKit-embedded name', () => {
    mockParticipants.push({ identity: 'user-1', name: 'stale-livekit-name', isMicrophoneEnabled: true, isSpeaking: false });

    renderGrid({ status: 'ready', connected: true });

    expect(screen.getByText('Minh Anh (Bạn)')).toBeInTheDocument();
    expect(screen.queryByText('stale-livekit-name')).not.toBeInTheDocument();
  });

  it('falls back to a generic label (never a raw UUID) for an unknown participant with no LiveKit name', () => {
    mockParticipants.push(
      { identity: 'user-1', name: 'Minh Anh', isMicrophoneEnabled: true, isSpeaking: false },
      { identity: 'user-unknown-id-1234', name: '', isMicrophoneEnabled: false, isSpeaking: false }
    );

    renderGrid({ status: 'ready', connected: true });

    expect(screen.getByText('Người dùng')).toBeInTheDocument();
    expect(screen.queryByText(/user-unknown/)).not.toBeInTheDocument();
  });

  it('renders an active screen-share track in its own spotlight tile, separate from the camera grid', () => {
    mockParticipants.push({ identity: 'user-2', name: 'David Chen', isMicrophoneEnabled: false, isSpeaking: false });
    mockScreenShareTrackRefs.push({ participant: { identity: 'user-2' }, publication: { trackSid: 'screen-1', isMuted: false } });

    renderGrid({ status: 'ready', connected: true });

    expect(screen.getByTestId('video-track-screen-1')).toBeInTheDocument();
    expect(screen.getByText('David Chen đang chia sẻ màn hình')).toBeInTheDocument();
  });

  it('does not render a screen-share spotlight when no one is sharing', () => {
    mockParticipants.push({ identity: 'user-1', name: 'Minh Anh', isMicrophoneEnabled: true, isSpeaking: false });

    renderGrid({ status: 'ready', connected: true });

    expect(screen.queryByText(/đang chia sẻ màn hình/)).not.toBeInTheDocument();
  });

  it('keeps a muted (stopped) screen-share publication out of the spotlight', () => {
    mockParticipants.push({ identity: 'user-2', name: 'David Chen', isMicrophoneEnabled: false, isSpeaking: false });
    mockScreenShareTrackRefs.push({ participant: { identity: 'user-2' }, publication: { trackSid: 'screen-1', isMuted: true } });

    renderGrid({ status: 'ready', connected: true });

    expect(screen.queryByTestId('video-track-screen-1')).not.toBeInTheDocument();
  });

  it('renders both a camera tile and a screen-share spotlight when the same participant publishes both', () => {
    mockParticipants.push({ identity: 'user-2', name: 'David Chen', isMicrophoneEnabled: true, isSpeaking: false });
    mockCameraTrackRefs.push({ participant: { identity: 'user-2' }, publication: { trackSid: 'camera-1', isMuted: false } });
    mockScreenShareTrackRefs.push({ participant: { identity: 'user-2' }, publication: { trackSid: 'screen-1', isMuted: false } });

    renderGrid({ status: 'ready', connected: true });

    expect(screen.getByTestId('video-track-camera-1')).toBeInTheDocument();
    expect(screen.getByTestId('video-track-screen-1')).toBeInTheDocument();
  });
});


describe('in-call moderation controls', () => {
  const secondMember: StudyRoomMember = {
    ...members[0], id: 'm2', user_id: 'user-2', role: 'participant',
    user: { ...members[0].user, id: 'user-2', display_name: 'Hoàng' },
  };
  const ownerRank = (id: string): RoomRank => id === 'user-1' ? RoomRank.OWNER : RoomRank.PARTICIPANT;

  beforeEach(() => {
    mockParticipants.length = 0;
    mockCameraTrackRefs.length = 0;
    mockScreenShareTrackRefs.length = 0;
    mockParticipants.push(
      { identity: 'user-1', name: 'Minh Anh', isMicrophoneEnabled: true, isSpeaking: false },
      { identity: 'user-2', name: 'Hoàng', isMicrophoneEnabled: true, isSpeaking: false },
    );
  });

  it('only offers moderation on another connected lower-ranked member', () => {
    const onModerate = vi.fn();
    renderGrid({ status: 'ready', connected: true }, undefined, {
      roomMembers: [...members, secondMember], rankOf: ownerRank, onModerate,
    });
    expect(screen.getByRole('button', { name: 'Điều hành Hoàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Điều hành Minh Anh (Bạn)' })).not.toBeInTheDocument();
  });

  it('hides moderator controls for ordinary participants and unknown identities', () => {
    renderGrid({ status: 'ready', connected: true }, undefined, {
      roomMembers: [...members, secondMember], rankOf: () => RoomRank.PARTICIPANT,
      onModerate: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /Điều hành/ })).not.toBeInTheDocument();
  });

  it('confirms a kick before issuing the backend action', async () => {
    const onModerate = vi.fn().mockResolvedValue(undefined);
    renderGrid({ status: 'ready', connected: true }, undefined, {
      roomMembers: [...members, secondMember], rankOf: ownerRank, onModerate,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Điều hành Hoàng' }));
    await user.click(screen.getByRole('button', { name: 'Mời ra khỏi phòng' }));
    expect(onModerate).not.toHaveBeenCalled();
    expect(screen.getByText('Xác nhận mời ra khỏi phòng')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mời ra khỏi phòng' }));
    await waitFor(() => expect(onModerate).toHaveBeenCalledWith('user-2', 'kick'));
  });

  it('offers mute, not remote unmute; shows an error when media enforcement fails', async () => {
    const onModerate = vi.fn().mockRejectedValue(new Error('LiveKit chưa xác nhận'));
    renderGrid({ status: 'ready', connected: true }, undefined, {
      roomMembers: [...members, secondMember], rankOf: ownerRank, onModerate,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Điều hành Hoàng' }));
    expect(screen.queryByRole('button', { name: /Bật micro/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Tắt micro của thành viên/ }));
    await waitFor(() => expect(onModerate).toHaveBeenCalledWith('user-2', 'mute'));
    expect(await screen.findByRole('alert')).toHaveTextContent('LiveKit chưa xác nhận');
  });
});
