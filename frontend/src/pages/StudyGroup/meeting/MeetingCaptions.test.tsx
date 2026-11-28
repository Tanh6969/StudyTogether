import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { streamMeetingCaptions } from '../../../lib/meeting.api';
import type { MeetingCaptionEvent } from '../../../lib/meeting.types';
import { MeetingCaptions } from './MeetingCaptions';
import { MeetingContext } from './MeetingContext';

vi.mock('@livekit/components-react', () => ({
  useConnectionState: () => 'connected',
  useLocalParticipant: () => ({ localParticipant: { sid: 'PA_caller' } }),
}));

vi.mock('../../../lib/meeting.api', () => ({ streamMeetingCaptions: vi.fn() }));

it('receives captions automatically, keeps the speaker and continues receiving with CC hidden', async () => {
  let onEvent: (event: MeetingCaptionEvent) => void = () => {};
  let streamSignal: AbortSignal | undefined;
  vi.mocked(streamMeetingCaptions).mockImplementation((_room, _session, _participant, receive, signal) => {
    onEvent = receive;
    streamSignal = signal;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const { unmount } = render(
    <MeetingContext.Provider value={{
      status: 'ready', error: null, connected: true, captionsAvailable: true,
      liveKitError: null, transferred: false, retry: vi.fn(),
    }}>
      <MeetingCaptions roomId="room" clientSessionId="session" />
    </MeetingContext.Provider>,
  );

  const toggle = screen.getByRole('button', { name: 'Phụ đề tiếng Việt' });
  expect(streamMeetingCaptions).toHaveBeenCalledWith('room', 'session', 'PA_caller', expect.any(Function), streamSignal);
  await userEvent.click(toggle);

  act(() => {
    onEvent({ type: 'ready' });
    onEvent({ type: 'caption', id: '1', speaker_id: 'a', speaker_name: 'Hà', text: 'Giảng', final: false });
    onEvent({ type: 'caption', id: '2', speaker_id: 'b', speaker_name: 'Trung', text: 'Mở bài tập nhé.', final: true });
    onEvent({ type: 'caption', id: '1', speaker_id: 'a', speaker_name: 'Hà', text: 'Giải tích.', final: true });
  });
  expect(screen.getByText('Hà')).toBeVisible();
  expect(screen.getByText('Trung')).toBeVisible();
  expect(screen.getByText('Giải tích.')).toBeVisible();
  expect(screen.getByText('Mở bài tập nhé.')).toBeVisible();
  expect(screen.queryByText('Giảng')).not.toBeInTheDocument();

  await userEvent.click(toggle);
  expect(streamSignal?.aborted).toBe(false);
  expect(screen.queryByText('Giải tích.')).not.toBeInTheDocument();
  await userEvent.click(toggle);
  expect(screen.getByText('Giải tích.')).toBeVisible();
  expect(streamMeetingCaptions).toHaveBeenCalledTimes(1);
  unmount();
  expect(streamSignal?.aborted).toBe(true);
});
