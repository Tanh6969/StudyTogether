import { apiClient } from './apiClient';
import type { UserSummary } from './profile.types';

/** Mirrors app/db/enums.py RoomTaskStatus. */
export type RoomTaskStatus = 'todo' | 'doing' | 'done';

/** Mirrors RoomTaskResponse (app/room_tasks/dto/room_task_dto.py). */
export interface RoomTask {
  id: string;
  room_id: string;
  user_id: string;
  title: string;
  status: RoomTaskStatus;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  user: UserSummary;
}

export function listRoomTasks(roomId: string): Promise<RoomTask[]> {
  return apiClient.get<RoomTask[]>(`/study-rooms/${roomId}/tasks`);
}

export function createRoomTask(roomId: string, title: string): Promise<RoomTask> {
  return apiClient.post<RoomTask>(`/study-rooms/${roomId}/tasks`, { title });
}

export function updateRoomTask(
  roomId: string,
  taskId: string,
  data: Partial<Pick<RoomTask, 'title' | 'status'>>
): Promise<RoomTask> {
  return apiClient.patch<RoomTask>(`/study-rooms/${roomId}/tasks/${taskId}`, data);
}

export function deleteRoomTask(roomId: string, taskId: string): Promise<void> {
  return apiClient.delete<void>(`/study-rooms/${roomId}/tasks/${taskId}`);
}
