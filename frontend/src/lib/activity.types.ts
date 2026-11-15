import type { UserSummary } from './profile.types';

/** Mirrors backend/app/activities/dto/activity_dto.py. */
export type ActivityKind = 'game' | 'music';
export type ActivityGame = 'chalk';
export type ActivityStatus = 'lobby' | 'running' | 'ended';
export type MusicProvider = 'youtube' | 'soundcloud' | 'spotify';

export interface RoomActivity {
  id: string;
  room_id: string;
  kind: ActivityKind;
  game: ActivityGame | null;
  host_user_id: string;
  status: ActivityStatus;
  /** User ids in join order -- the order every client uses to elect a replacement host. */
  participants: string[];
  settings: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  snapshot_at: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  host: UserSummary;
}

export interface ActivityCreate {
  kind: ActivityKind;
  game?: ActivityGame;
  settings?: Record<string, unknown>;
}

export interface ActivityUpdate {
  status?: ActivityStatus;
  settings?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  host_user_id?: string;
}

export interface ResolvedTrack {
  provider: MusicProvider;
  provider_id: string;
  url: string;
  title: string;
  author: string | null;
  thumbnail_url: string | null;
  duration_ms: number | null;
  start_ms: number;
}

export interface QueueItem extends ResolvedTrack {
  id: string;
  activity_id: string;
  room_id: string;
  position: number;
  added_by: string;
  added_at: string;
  played_at: string | null;
  adder: UserSummary;
}

export interface WordPackItem {
  word: string;
  difficulty: 1 | 2 | 3;
}

export interface WordPackResponse {
  topic: string;
  words: WordPackItem[];
}
