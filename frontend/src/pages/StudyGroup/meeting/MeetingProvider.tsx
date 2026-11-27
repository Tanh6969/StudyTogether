import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LiveKitRoom, RoomAudioRenderer, StartAudio, useParticipants } from '@livekit/components-react';
import { DisconnectReason } from 'livekit-client';
import { checkMeetingSession } from '../../../lib/meeting.api';
import { clearOwnedMediaSession } from '../../../lib/meetingOwnerState';
import { useMeetingToken } from '../../../hooks/useMeetingToken';
import { MeetingContext } from './MeetingContext';

/** LiveKit session roster. Study-room DB membership is authorization, not call presence. */
export interface ConnectedCallParticipant {
  identity: string;
  name: string;
  isMicrophoneEnabled: boolean;
}

/** Read the same LiveKit participant list as MeetingVideoGrid, not study_room_members. */
function LiveKitRosterObserver({ onChange }: { onChange: (participants: ConnectedCallParticipant[]) => void }) {
  const participants = useParticipants();
  useEffect(() => {
    onChange(participants.map((participant) => ({
      identity: participant.identity,
      name: participant.name ?? '',
      isMicrophoneEnabled: participant.isMicrophoneEnabled,
    })));
  }, [participants, onChange]);
  useEffect(() => () => onChange([]), [onChange]);
  return null;
}

interface MeetingProviderProps {
  roomId: string;
  /** Unique to the explicit pre-join action, never shared via localStorage. */
  clientSessionId: string;
  /** Whether the caller should currently be attempting to join the meeting -- gated by the
   * page on `isCurrentUserMember && room.status !== 'ended'`. The backend still independently
   * re-checks authorization on every token request regardless of this flag. */
  enabled: boolean;
  /** Initial mic/camera state and device picks, as chosen by the user in the pre-join lobby
   * (see PreJoinLobby.tsx). Defaults to both on with the system default device, matching the
   * previous hardcoded behavior, if the lobby is skipped. */
  initialAudioEnabled?: boolean;
  initialVideoEnabled?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  /** Invoked when the LiveKit session disconnects (kick, room end/delete closing the LiveKit
   * room server-side, or an unrecoverable connection loss -- LiveKit itself already retries
   * transient network blips internally and only calls `onDisconnected` once it gives up, so
   * this isn't fired for those). Used by the caller to refetch the room's current status so
   * the UI can show *why* (e.g. "phòng học đã kết thúc") instead of just going dark with no
   * explanation -- see StudyRoom.tsx. */
  onSessionEnded?: () => void;
  /** A different tab/device won; the old view must exit WITHOUT leaving shared room membership. */
  onTransferred?: () => void;
  /** The current LiveKit roster, including people with camera/microphone disabled. */
  onParticipantsChange?: (participants: ConnectedCallParticipant[]) => void;
  children: ReactNode;
}

/**
 * Owns the meeting-token request and the LiveKit room connection lifecycle. Always renders
 * `children` (video grid / controls read `useMeetingContext()` to know whether a live room is
 * actually available) so the rest of the Study Room page layout never has to branch on it.
 */
export function MeetingProvider({
  roomId,
  clientSessionId,
  enabled,
  onTransferred,
  initialAudioEnabled = true,
  initialVideoEnabled = true,
  audioDeviceId,
  videoDeviceId,
  onSessionEnded,
  onParticipantsChange,
  children,
}: MeetingProviderProps) {
  const [transferred, setTransferred] = useState(false);
  const transferredRef = useRef(false);
  const { status, data, error, retry } = useMeetingToken(roomId, enabled && !transferred, clientSessionId);
  const [connected, setConnected] = useState(false);
  const [liveKitError, setLiveKitError] = useState<Error | null>(null);

  const markTransferred = useCallback(() => {
    if (transferredRef.current) return;
    transferredRef.current = true;
    clearOwnedMediaSession(roomId, clientSessionId);
    setTransferred(true);
    setConnected(false);
    setLiveKitError(null);
    onTransferred?.();
  }, [roomId, clientSessionId, onTransferred]);

  const verifyOwnership = useCallback(async () => {
    try {
      const ownership = await checkMeetingSession(roomId, clientSessionId);
      if (!ownership.active) {
        markTransferred();
        return false;
      }
      return true;
    } catch {
      // An unreachable backend is UNKNOWN, not evidence another device took
      // over. LiveKit's reconnect logic can still recover a network outage.
      return null;
    }
  }, [roomId, clientSessionId, markTransferred]);

  // Cross-device takeover cannot be observed through BroadcastChannel.
  // Poll the authoritative, read-only backend and check promptly on focus.
  useEffect(() => {
    if (!enabled || status !== 'ready' || transferred) return;
    let active = true;
    const check = async () => {
      if (!active) return;
      try {
        const ownership = await checkMeetingSession(roomId, clientSessionId);
        if (active && !ownership.active) markTransferred();
      } catch {
        // Network failures are NOT a takeover signal.
      }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [roomId, clientSessionId, enabled, status, transferred, markTransferred]);

  useEffect(() => {
    if (status === 'error' && error?.status === 409) markTransferred();
  }, [status, error?.status, markTransferred]);
  // A token identifies one connection attempt. Ignore late callbacks from a
  // superseded attempt (e.g. the prior LiveKitRoom unmounting during retry).
  const activeTokenRef = useRef<string | null>(null);
  activeTokenRef.current = status === 'ready' && !transferred ? data?.participant_token ?? null : null;
  const retryConnection = () => {
    if (transferredRef.current) return;
    setLiveKitError(null);
    setConnected(false);
    void retry();
  };

  if (transferred || status !== 'ready' || !data) {
    return (
      <MeetingContext.Provider value={{ status, error, retry: retryConnection, connected: false, liveKitError: null, transferred }}>
        {children}
      </MeetingContext.Provider>
    );
  }

  return (
    <MeetingContext.Provider value={{ status, error, retry: retryConnection, connected, liveKitError, transferred, captionsAvailable: data.captions_available }}>
      {/* display:contents keeps LiveKitRoom's wrapper <div> out of the page's flex layout. */}
      <LiveKitRoom
        serverUrl={data.server_url}
        token={data.participant_token}
        connect
        audio={initialAudioEnabled}
        video={initialVideoEnabled}
        options={{
          audioCaptureDefaults: audioDeviceId ? { deviceId: audioDeviceId } : undefined,
          videoCaptureDefaults: videoDeviceId ? { deviceId: videoDeviceId } : undefined,
        }}
        onConnected={() => {
          if (activeTokenRef.current !== data.participant_token) return;
          setConnected(true);
          setLiveKitError(null);
          // A late LiveKit connect can race a newer takeover claim.
          void verifyOwnership();
        }}
        onDisconnected={(reason) => {
          if (activeTokenRef.current !== data.participant_token) return;
          setConnected(false);
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
            // Cross-tab and cross-device case. Verify backend authority to
            // distinguish a real transfer from any misleading SDK reason.
            void verifyOwnership().then((stillOwned) => {
              if (stillOwned !== false && !transferredRef.current) {
                setLiveKitError(new Error('Kết nối video bị thay thế. Vui lòng kiểm tra lại kết nối.'));
              }
            });
            return;
          }
          // Real disconnect without supersession: retry is safe because it
          // uses the SAME session ID and the backend refuses stale owners.
          setLiveKitError((previous) => previous ?? new Error('Kết nối video đã bị ngắt. Vui lòng thử kết nối lại.'));
          onSessionEnded?.();
        }}
        onError={(err) => {
          if (activeTokenRef.current !== data.participant_token) return;
          setConnected(false);
          setLiveKitError(err);
        }}
        style={{ display: 'contents' }}
      >
        {onParticipantsChange && <LiveKitRosterObserver onChange={onParticipantsChange} />}
        <RoomAudioRenderer />
        <StartAudio
          label="Bấm để bật âm thanh cuộc gọi"
          style={{
            position: 'fixed',
            top: 76,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            background: '#2563EB',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        />
        {children}
      </LiveKitRoom>
    </MeetingContext.Provider>
  );
}
