/** Mirrors MeetingTokenResponse (app/meetings/dto/meeting_dto.py) */
export interface MeetingTokenResponse {
  server_url: string;
  participant_token: string;
  captions_available?: boolean;
}

export interface MeetingCaption {
  type: 'caption';
  id: string;
  speaker_id: string;
  speaker_name: string;
  text: string;
  final: boolean;
}

export type MeetingCaptionEvent = MeetingCaption
  | { type: 'reconnecting'; speaker_id?: string }
  | { type: 'ready' | 'heartbeat' | 'closed' | 'unavailable' };


/** The backend, not the device, decides who owns the active media connection. */
export interface MeetingSessionStatus {
  active: boolean;
}
