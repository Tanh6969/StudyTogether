/** Mirrors MeetingTokenResponse (app/meetings/dto/meeting_dto.py) */
export interface MeetingTokenResponse {
  server_url: string;
  participant_token: string;
}


/** The backend, not the device, decides who owns the active media connection. */
export interface MeetingSessionStatus {
  active: boolean;
}
