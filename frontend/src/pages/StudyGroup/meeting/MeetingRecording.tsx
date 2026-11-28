import { useEffect, useState } from 'react';
import { useIsRecording, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { MeetingArchiveButton } from './MeetingArchive';
import { useMeetingContext } from './MeetingContext';

interface InCallProps {
  roomId: string;
  clientSessionId: string;
  canManage: boolean;
}

export function InCallArchiveButton(props: InCallProps) {
  const { captionsAvailable, recordingAvailable, connected } = useMeetingContext();
  if (!connected || (!captionsAvailable && !recordingAvailable)) return null;
  return <ConnectedArchive {...props} canManage={props.canManage && !!recordingAvailable} />;
}

function ConnectedArchive({ roomId, clientSessionId, canManage }: InCallProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const isRecording = useIsRecording(room);
  const [livekitSid, setLivekitSid] = useState('');

  useEffect(() => {
    let cancelled = false;
    void room.getSid().then((sid) => {
      if (!cancelled) setLivekitSid(sid);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [room, localParticipant.sid]);

  const control = canManage && localParticipant.sid && livekitSid
    ? { client_session_id: clientSessionId, participant_sid: localParticipant.sid }
    : undefined;

  return <MeetingArchiveButton roomId={roomId} inCall={{ livekitSid, isRecording, control }} />;
}

export function MeetingRecordingIndicator() {
  const { connected, recordingAvailable } = useMeetingContext();
  return connected && recordingAvailable ? <RecordingStatus /> : null;
}

function RecordingStatus() {
  const isRecording = useIsRecording();
  if (!isRecording) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 bg-rose-950 px-4 py-1.5 text-sm text-rose-100">
      <span aria-hidden="true" className="size-2 rounded-full bg-rose-400" />
      Đang ghi hình cuộc họp
    </div>
  );
}
