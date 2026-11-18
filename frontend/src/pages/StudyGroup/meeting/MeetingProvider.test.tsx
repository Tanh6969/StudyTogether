import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { LiveKitRoomProps } from '@livekit/components-react';
import { ApiError } from '../../../lib/apiClient';
import { checkMeetingSession, createMeetingToken } from '../../../lib/meeting.api';
import { DisconnectReason } from 'livekit-client';
import { MeetingProvider } from './MeetingProvider';
import { useMeetingContext } from './MeetingContext';

vi.mock('../../../lib/meeting.api', () => ({
  createMeetingToken: vi.fn(),
  checkMeetingSession: vi.fn(),
}));

let lastLiveKitRoomProps: LiveKitRoomProps | null = null;
let fakeParticipants: Array<{ identity: string; name: string }> = [];

// LiveKit's real Room/WebRTC connection is out of scope for a unit test -- this fake stands in
// for `<LiveKitRoom>`, calling the same lifecycle callbacks the real component would, so
// MeetingProvider's own wiring (props passed through, context updated) is what gets tested.
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: (props: LiveKitRoomProps) => {
    lastLiveKitRoomProps = props;
    useEffect(() => {
      props.onConnected?.();
      return () => {
        props.onDisconnected?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.token, props.serverUrl]);
    return <div data-testid="livekit-room">{props.children}</div>;
  },
  useParticipants: () => fakeParticipants,
  RoomAudioRenderer: () => null,
  StartAudio: () => null,
}));

const mockedCreateMeetingToken = vi.mocked(createMeetingToken);
const mockedCheckMeetingSession = vi.mocked(checkMeetingSession);

function StatusProbe() {
  const { status, connected, error, liveKitError } = useMeetingContext();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="error">{error?.message ?? ''}</span>
      <span data-testid="livekit-error">{liveKitError?.message ?? ''}</span>
    </div>
  );
}

describe('MeetingProvider', () => {
  beforeEach(() => {
    mockedCreateMeetingToken.mockReset();
    mockedCheckMeetingSession.mockReset().mockResolvedValue({ active: true });
    lastLiveKitRoomProps = null;
    fakeParticipants = [];
  });

  it('uses the LiveKit roster for connected user updates and clears it on disconnect', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });
    fakeParticipants = [{ identity: 'real-call-user', name: 'Online' }];
    const onParticipantsChange = vi.fn();
    const view = (enabled: boolean) => (
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled={enabled} onParticipantsChange={onParticipantsChange}>
        <StatusProbe />
      </MeetingProvider>
    );
    const { rerender } = render(view(true));

    await waitFor(() => expect(onParticipantsChange).toHaveBeenLastCalledWith([{ identity: 'real-call-user', name: 'Online' }]));
    fakeParticipants = [{ identity: 'other-user', name: 'New joiner' }];
    rerender(view(true));
    await waitFor(() => expect(onParticipantsChange).toHaveBeenLastCalledWith([{ identity: 'other-user', name: 'New joiner' }]));

    rerender(view(false));
    await waitFor(() => expect(onParticipantsChange).toHaveBeenLastCalledWith([]));
  });

  it('exposes a loading status while the token request is in flight, without connecting yet', async () => {
    mockedCreateMeetingToken.mockReturnValue(new Promise(() => {}));

    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled>
        <StatusProbe />
      </MeetingProvider>
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('loading'));
    expect(screen.getByTestId('connected').textContent).toBe('false');
    expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument();
  });

  it('connects to the LiveKit room with the token issued by the backend', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://livekit.example.com', participant_token: 'tok-123' });

    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled>
        <StatusProbe />
      </MeetingProvider>
    );

    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    expect(lastLiveKitRoomProps?.serverUrl).toBe('wss://livekit.example.com');
    expect(lastLiveKitRoomProps?.token).toBe('tok-123');
  });

  it('surfaces a 403 rejection as an error and never renders the LiveKit room', async () => {
    mockedCreateMeetingToken.mockRejectedValue(new ApiError(403, 'Forbidden'));

    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled>
        <StatusProbe />
      </MeetingProvider>
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('error').textContent).toContain('không có quyền');
    expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument();
  });

  it('disconnects (stops rendering the LiveKit room) once disabled', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });

    const { rerender } = render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));

    rerender(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled={false}>
        <StatusProbe />
      </MeetingProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument());
    expect(screen.getByTestId('connected').textContent).toBe('false');
  });

  it('does not treat deliberate participation disable as an unexpected LiveKit disconnect', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });
    const onSessionEnded = vi.fn();

    const { rerender } = render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled onSessionEnded={onSessionEnded}>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    expect(onSessionEnded).not.toHaveBeenCalled();

    // The mocked LiveKitRoom fires onDisconnected during unmount, but this was a
    // deliberate authorization/participation change rather than network failure.
    rerender(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled={false} onSessionEnded={onSessionEnded}>
        <StatusProbe />
      </MeetingProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument());
    expect(onSessionEnded).not.toHaveBeenCalled();
  });
});

describe('MeetingProvider -- recoverable disconnect', () => {
  it('exposes a meaningful error when LiveKit disconnects and refreshes room metadata', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });
    const onSessionEnded = vi.fn();
    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled onSessionEnded={onSessionEnded}>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    await act(async () => { lastLiveKitRoomProps?.onDisconnected?.(); });
    expect(screen.getByTestId('connected').textContent).toBe('false');
    expect(screen.getByTestId('livekit-error').textContent).toContain('Kết nối video đã bị ngắt');
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });
});

function RetryConnectionProbe() {
  const { retry } = useMeetingContext();
  return <button onClick={retry}>Retry connection</button>;
}

describe('MeetingProvider -- connection attempt isolation', () => {
  it('does not confuse callbacks from a superseded LiveKit attempt with the new connection', async () => {
    mockedCreateMeetingToken
      .mockResolvedValueOnce({ server_url: 'wss://x', participant_token: 'old-token' })
      .mockResolvedValueOnce({ server_url: 'wss://x', participant_token: 'new-token' });
    const onSessionEnded = vi.fn();
    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled onSessionEnded={onSessionEnded}>
        <StatusProbe />
        <RetryConnectionProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    expect(lastLiveKitRoomProps?.token).toBe('old-token');
    const original = lastLiveKitRoomProps;

    await act(async () => { fireEvent.click(screen.getByText('Retry connection')); });
    await waitFor(() => expect(lastLiveKitRoomProps?.token).toBe('new-token'));
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    await act(async () => { original?.onDisconnected?.(); });
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(screen.getByTestId('livekit-error').textContent).toBe('');
  });
});


describe('MeetingProvider -- durable takeover fencing', () => {
  it('terminates a superseded connection without exposing retry', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });
    mockedCheckMeetingSession.mockResolvedValue({ active: true });
    const transferred = vi.fn();
    const onSessionEnded = vi.fn();
    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled
        onTransferred={transferred} onSessionEnded={onSessionEnded}>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    mockedCheckMeetingSession.mockResolvedValue({ active: false });
    await act(async () => {
      lastLiveKitRoomProps?.onDisconnected?.(DisconnectReason.DUPLICATE_IDENTITY);
    });
    await waitFor(() => expect(transferred).toHaveBeenCalledTimes(1));
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument();
  });

  it('does not mistake a temporary network failure for takeover', async () => {
    mockedCreateMeetingToken.mockResolvedValue({ server_url: 'wss://x', participant_token: 'tok' });
    mockedCheckMeetingSession.mockRejectedValue(new Error('Temporary network outage'));
    const transferred = vi.fn();
    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled onTransferred={transferred}>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(screen.getByTestId('connected').textContent).toBe('true'));
    await act(async () => { lastLiveKitRoomProps?.onDisconnected?.(); });
    expect(transferred).not.toHaveBeenCalled();
    expect(screen.getByTestId('livekit-error').textContent).toContain('Kết nối video đã bị ngắt');
  });

  it('a stale token response (HTTP 409) transfers the UI rather than offering another retry', async () => {
    mockedCreateMeetingToken.mockRejectedValue(new ApiError(409, 'Stale session'));
    const transferred = vi.fn();
    render(
      <MeetingProvider roomId="room-1" clientSessionId="client-1" enabled onTransferred={transferred}>
        <StatusProbe />
      </MeetingProvider>
    );
    await waitFor(() => expect(transferred).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('livekit-room')).not.toBeInTheDocument();
  });
});
