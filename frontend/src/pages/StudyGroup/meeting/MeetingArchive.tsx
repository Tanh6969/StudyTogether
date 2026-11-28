import { useEffect, useState } from 'react';
import { Archive, Circle, Download, Square } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import {
  getMeetingRecordingDownload,
  listMeetingCaptures,
  readMeetingTranscript,
  startMeetingRecording,
  stopMeetingRecording,
} from '../../../lib/meeting.api';
import type { MeetingCapture, MeetingRecordingControl, MeetingRecordingStatus } from '../../../lib/meeting.types';

const buttonClass = 'inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-50';
const statusLabel: Record<MeetingRecordingStatus, string> = {
  starting: 'Đang chuẩn bị ghi hình',
  active: 'Đang ghi hình',
  ending: 'Đang xử lý video',
  complete: 'Video sẵn sàng',
  failed: 'Ghi hình gặp lỗi',
};

const timeFormat = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

interface ArchiveButtonProps {
  roomId: string;
  inCall?: {
    livekitSid: string;
    isRecording: boolean;
    control?: MeetingRecordingControl;
  };
}

function download(href: string, name?: string) {
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'noreferrer';
  if (name) link.download = name;
  else link.target = '_blank';
  document.body.append(link);
  link.click();
  link.remove();
}

export function MeetingArchiveButton({ roomId, inCall }: ArchiveButtonProps) {
  const [open, setOpen] = useState(false);
  const [captures, setCaptures] = useState<MeetingCapture[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [working, setWorking] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await listMeetingCaptures(roomId, controller.signal);
        if (controller.signal.aborted) return;
        setCaptures(next);
        setLoadError(false);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 4000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, refresh, roomId]);

  const current = captures?.find((capture) => capture.livekit_sid === inCall?.livekitSid);
  const running = current?.recordings.find(({ status }) =>
    status === 'starting' || status === 'active' || status === 'ending'
  );
  const hasRunningRecording = !!running || !!inCall?.isRecording;
  const stopReady = running?.status === 'active';

  async function act(action: () => Promise<void>) {
    setWorking(true);
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Không thể thực hiện thao tác.');
    } finally {
      setWorking(false);
    }
  }

  function toggleRecording() {
    const control = inCall?.control;
    if (!control) return;
    void act(async () => {
      try {
        if (running) await stopMeetingRecording(roomId, running.id, control);
        else await startMeetingRecording(roomId, control);
      } finally {
        setRefresh((attempt) => attempt + 1);
      }
    });
  }

  async function downloadTranscript(captureId: string) {
    const transcript = await readMeetingTranscript(roomId, captureId);
    const file = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    download(url, `ban-chep-loi-${captureId}.txt`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actualCaptures = captures?.filter((capture) =>
    capture.has_transcript || capture.recordings.length > 0 || capture.livekit_sid === inCall?.livekitSid
  );
  return (
    <>
      <button
        type="button"
        aria-label="Bản ghi cuộc họp"
        title="Bản ghi cuộc họp"
        onClick={() => setOpen(true)}
        className={inCall
          ? 'flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-700 text-white'
          : `${buttonClass} justify-center text-slate-700 hover:bg-slate-50`}
      >
        <Archive size={inCall ? 19 : 16} aria-hidden="true" />
        {!inCall && 'Bản ghi cuộc họp'}
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Bản ghi cuộc họp">
        {inCall?.control && (
          <div className="space-y-2">
            <button
              type="button"
              className={`${buttonClass} bg-rose-700 text-white`}
              disabled={working || !captures || loadError || (hasRunningRecording && !stopReady)}
              onClick={toggleRecording}
            >
              {hasRunningRecording ? <Square size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
              {hasRunningRecording ? (stopReady ? 'Dừng ghi hình' : statusLabel[running?.status ?? 'starting']) : 'Bắt đầu ghi hình'}
            </button>
            <p className="m-0 text-sm text-slate-600">Ghi âm thanh, camera và màn hình đang chia sẻ trong cuộc gọi.</p>
          </div>
        )}
        {actionError && <p role="alert" className="m-0 text-sm text-red-700">{actionError}</p>}
        {loadError && <p role="alert" className="m-0 text-sm text-red-700">Không tải được danh sách bản ghi.</p>}
        {!captures && !loadError && <p role="status" className="m-0 text-sm text-slate-500">Đang tải bản ghi…</p>}
        {actualCaptures?.length === 0 && <p className="m-0 text-sm text-slate-600">Chưa có bản ghi từ các cuộc gọi bạn đã tham gia.</p>}
        {actualCaptures?.map((capture) => (
          <section key={capture.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-slate-800">
            <h4 className="m-0 text-sm font-semibold">{timeFormat.format(new Date(capture.started_at))}</h4>
            {capture.has_transcript ? (
              <button type="button" disabled={working} className={buttonClass} onClick={() => void act(() => downloadTranscript(capture.id))}>
                <Download size={15} aria-hidden="true" /> Tải bản chép lời (.txt)
              </button>
            ) : capture.livekit_sid === inCall?.livekitSid && (
              <p className="m-0 text-sm text-slate-500">Chưa có lời thoại đã chốt.</p>
            )}
            {capture.recordings.map((video) => (
              <div key={video.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{statusLabel[video.status]} · {timeFormat.format(new Date(video.started_at))}</span>
                {video.status === 'complete' && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={working}
                    onClick={() => void act(async () => {
                      const { url } = await getMeetingRecordingDownload(roomId, video.id);
                      download(url);
                    })}
                  >
                    <Download size={15} aria-hidden="true" /> Tải video (.mp4)
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
      </Modal>
    </>
  );
}
