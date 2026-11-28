import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { listMeetingCaptures, readMeetingTranscript, startMeetingRecording } from '../../../lib/meeting.api';
import { MeetingArchiveButton } from './MeetingArchive';

vi.mock('../../../lib/meeting.api', () => ({
  listMeetingCaptures: vi.fn(),
  readMeetingTranscript: vi.fn(),
  startMeetingRecording: vi.fn(),
}));

const startedAt = '2026-11-28T03:00:00Z';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('downloads the saved Vietnamese transcript after leaving the call', async () => {
  vi.mocked(listMeetingCaptures).mockResolvedValue([{
    id: 'capture', livekit_sid: 'RM_call', started_at: startedAt, ended_at: startedAt,
    has_transcript: true, recordings: [],
  }]);
  vi.mocked(readMeetingTranscript).mockResolvedValue('Hà: Không nộp thứ Ba.');
  const objectUrl = vi.fn(() => 'blob:transcript');
  const revokeObjectUrl = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = objectUrl;
    static revokeObjectURL = revokeObjectUrl;
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('ban-chep-loi-capture.txt');
    expect(this.href).toBe('blob:transcript');
  });

  render(<MeetingArchiveButton roomId="room" />);
  await userEvent.click(screen.getByRole('button', { name: 'Bản ghi cuộc họp' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Tải bản chép lời (.txt)' }));

  expect(readMeetingTranscript).toHaveBeenCalledWith('room', 'capture');
  expect(objectUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Bắt đầu ghi hình' })).not.toBeInTheDocument();
});

it('binds the recording control to the connected participant and media session', async () => {
  vi.mocked(listMeetingCaptures).mockResolvedValue([]);
  vi.mocked(startMeetingRecording).mockResolvedValue({
    id: 'recording', status: 'starting', started_at: startedAt, ended_at: null,
  });
  const control = { client_session_id: 'current-tab', participant_sid: 'PA_current' };

  render(<MeetingArchiveButton roomId="room" inCall={{ livekitSid: 'RM_call', isRecording: false, control }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Bản ghi cuộc họp' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Bắt đầu ghi hình' }));

  expect(startMeetingRecording).toHaveBeenCalledWith('room', control);
});
