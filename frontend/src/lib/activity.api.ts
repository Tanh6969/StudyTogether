import { apiClient } from './apiClient';
import type {
  ActivityCreate,
  ActivityUpdate,
  QueueItem,
  ResolvedTrack,
  RoomActivity,
  WordPackResponse,
} from './activity.types';

const base = (roomId: string) => `/study-rooms/${roomId}/activities`;

export function listRoomActivities(roomId: string): Promise<RoomActivity[]> {
  return apiClient.get<RoomActivity[]>(base(roomId));
}

/** Starts the activity, or joins the live one of the same kind if somebody beat us to it. */
export function startRoomActivity(roomId: string, data: ActivityCreate): Promise<RoomActivity> {
  return apiClient.post<RoomActivity>(base(roomId), data);
}

export function joinRoomActivity(roomId: string, activityId: string): Promise<RoomActivity> {
  return apiClient.post<RoomActivity>(`${base(roomId)}/${activityId}/join`);
}

export function leaveRoomActivity(roomId: string, activityId: string): Promise<RoomActivity> {
  return apiClient.post<RoomActivity>(`${base(roomId)}/${activityId}/leave`);
}

export function updateRoomActivity(roomId: string, activityId: string, data: ActivityUpdate): Promise<RoomActivity> {
  return apiClient.patch<RoomActivity>(`${base(roomId)}/${activityId}`, data);
}

export function endRoomActivity(roomId: string, activityId: string): Promise<RoomActivity> {
  return apiClient.delete<RoomActivity>(`${base(roomId)}/${activityId}`);
}

export function generateWordPack(roomId: string, topic?: string): Promise<WordPackResponse> {
  return apiClient.post<WordPackResponse>(`${base(roomId)}/word-pack`, { topic: topic ?? null });
}

// --- music ---

export function resolveMusicLink(url: string): Promise<ResolvedTrack> {
  return apiClient.post<ResolvedTrack>('/music/resolve', { url });
}

export function listMusicQueue(roomId: string, activityId: string): Promise<QueueItem[]> {
  return apiClient.get<QueueItem[]>(`${base(roomId)}/${activityId}/queue`);
}

export function addToMusicQueue(roomId: string, activityId: string, url: string): Promise<QueueItem> {
  return apiClient.post<QueueItem>(`${base(roomId)}/${activityId}/queue`, { url });
}

export function updateMusicQueueItem(
  roomId: string,
  activityId: string,
  itemId: string,
  data: { position?: number; played_at?: string | null }
): Promise<QueueItem> {
  return apiClient.patch<QueueItem>(`${base(roomId)}/${activityId}/queue/${itemId}`, data);
}

export function removeMusicQueueItem(roomId: string, activityId: string, itemId: string): Promise<void> {
  return apiClient.delete<void>(`${base(roomId)}/${activityId}/queue/${itemId}`);
}
