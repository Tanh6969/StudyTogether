import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Captions } from 'lucide-react';
import { streamMeetingCaptions } from '../../../lib/meeting.api';
import { ApiError } from '../../../lib/apiClient';
import type { MeetingCaption } from '../../../lib/meeting.types';
import { getAvatarColor, getAvatarInitials } from '../../../utils/avatarUtils';
import { useMeetingContext } from './MeetingContext';

interface MeetingCaptionsProps {
  roomId: string;
  clientSessionId: string;
}

type StreamState = 'opening' | 'listening' | 'reconnecting' | 'unavailable';
const STATUS_TEXT: Record<StreamState, string> = {
  opening: 'Đang mở phụ đề…',
  listening: 'Đang tự động lưu lời thoại',
  reconnecting: 'Đang kết nối lại phụ đề…',
  unavailable: 'Tạm gián đoạn chép lời.',
};
const HISTORY_SIZE = 120;

export function MeetingCaptions(props: MeetingCaptionsProps) {
  const { captionsAvailable, connected } = useMeetingContext();
  if (!captionsAvailable || !connected) return null;
  return <ConnectedCaptions key={props.clientSessionId} {...props} />;
}

function ConnectedCaptions({ roomId, clientSessionId }: MeetingCaptionsProps) {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const participantSid = localParticipant.sid;
  const [enabled, setEnabled] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<StreamState>('opening');
  const [captions, setCaptions] = useState<MeetingCaption[]>([]);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const activeCapture = useRef<string | undefined>(undefined);
  const retries = useRef(0);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || !participantSid) {
      setCaptions((lines) => lines.filter((line) => line.final));
      setState('reconnecting');
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let blocked = false;
    setState('opening');

    void streamMeetingCaptions(roomId, clientSessionId, participantSid, (event) => {
      switch (event.type) {
        case 'ready':
          if (event.capture_id && event.capture_id !== activeCapture.current) {
            if (activeCapture.current) setCaptions([]);
            activeCapture.current = event.capture_id;
          }
          setState('listening');
          break;
        case 'reconnecting':
          setState('reconnecting');
          setCaptions((lines) => lines.filter((line) =>
            line.final || (event.speaker_id && line.speaker_id !== event.speaker_id)
          ));
          break;
        case 'caption':
          if (event.final && event.text) retries.current = 0;
          setState('listening');
          setCaptions((lines) => {
            const previous = lines.find((line) => line.id === event.id);
            if (previous?.final) return lines;
            if (!event.text) return lines.filter((line) => line.id !== event.id);
            if (previous) return lines.map((line) => line.id === event.id ? event : line);
            return [...lines, event].slice(-HISTORY_SIZE);
          });
          break;
      }
    }, controller.signal).catch((error: unknown) => {
      blocked = error instanceof ApiError && [401, 403, 404, 409].includes(error.status);
    }).finally(() => {
      if (controller.signal.aborted) return;
      setCaptions((lines) => lines.filter((line) => line.final));
      setState('unavailable');
      if (!blocked) {
        const delay = Math.min(1500 * 2 ** retries.current, 20_000);
        retries.current += 1;
        retryTimer = setTimeout(() => setRetry((attempt) => attempt + 1), delay);
      }
    });

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [clientSessionId, connectionState, participantSid, retry, roomId]);

  useLayoutEffect(() => {
    const list = scrollArea.current;
    if (followLatest.current && list) list.scrollTop = list.scrollHeight;
  }, [captions, enabled]);

  function toggleCaptions() {
    if (!enabled) followLatest.current = true;
    setEnabled(!enabled);
  }

  return (
    <>
      {!enabled && (
        <span
          role="status"
          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/90 px-3 py-1 text-xs text-slate-200"
        >
          {STATUS_TEXT[state]}
        </span>
      )}
      <button
        type="button"
        className={`flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-white ${enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
        onClick={toggleCaptions}
        aria-label="Phụ đề tiếng Việt"
        aria-pressed={enabled}
        title={enabled ? 'Tắt phụ đề tiếng Việt' : 'Bật phụ đề tiếng Việt'}
      >
        <Captions size={20} aria-hidden="true" />
      </button>
      {enabled && (
        <aside
          aria-label="Lời thoại trong cuộc gọi"
          className="absolute bottom-[calc(100%+10px)] left-1/2 z-10 w-[min(36rem,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-600 bg-slate-900 text-slate-100 shadow-xl"
        >
          <div
            ref={scrollArea}
            tabIndex={0}
            className="max-h-[min(13rem,30dvh)] min-h-12 space-y-2 overflow-y-auto px-3 py-3 sm:px-4"
            onScroll={(event) => {
              const list = event.currentTarget;
              followLatest.current = list.scrollHeight - list.clientHeight - list.scrollTop < 24;
            }}
          >
            {captions.map((line) => (
              <div key={line.id} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ background: getAvatarColor(line.speaker_name) }}
                >
                  {getAvatarInitials(line.speaker_name)}
                </span>
                <div className="min-w-0">
                  <div className="break-words text-xs font-semibold text-slate-300">{line.speaker_name}</div>
                  <div className={`break-words text-sm leading-snug sm:text-base ${line.final ? '' : 'text-slate-300'}`}>
                    {line.text}
                  </div>
                </div>
              </div>
            ))}
            {(!captions.length || state !== 'listening') && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <p role="status" className="m-0">{STATUS_TEXT[state]}</p>
                {state === 'unavailable' && (
                  <button
                    type="button"
                    onClick={() => setRetry((attempt) => attempt + 1)}
                    className="cursor-pointer rounded-md bg-slate-700 px-2.5 py-1 font-medium text-white hover:bg-slate-600"
                  >
                    Thử lại
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
