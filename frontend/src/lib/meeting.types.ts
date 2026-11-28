/** Mirrors MeetingTokenResponse (app/meetings/dto/meeting_dto.py) */
export interface MeetingTokenResponse {
  server_url: string;
  participant_token: string;
  captions_available?: boolean;
  recording_available?: boolean;
}

export interface MeetingCaption {
  type: 'caption';
  id: string;
  capture_id?: string;
  spoken_at?: string;
  speaker_id: string;
  speaker_name: string;
  text: string;
  final: boolean;
}

export type MeetingCaptionEvent = MeetingCaption
  | { type: 'reconnecting'; speaker_id?: string }
  | { type: 'ready'; capture_id?: string }
  | { type: 'heartbeat' | 'closed' | 'unavailable' };


/** The backend, not the device, decides who owns the active media connection. */
export interface MeetingSessionStatus {
  active: boolean;
}

export type MeetingRecordingStatus = 'starting' | 'active' | 'ending' | 'complete' | 'failed';

export interface MeetingRecording {
  id: string;
  status: MeetingRecordingStatus;
  started_at: string;
  ended_at: string | null;
}

export interface MeetingCapture {
  id: string;
  livekit_sid: string;
  started_at: string;
  ended_at: string | null;
  has_transcript: boolean;
  recordings: MeetingRecording[];
}

export interface MeetingRecordingControl {
  client_session_id: string;
  participant_sid: string;
}
