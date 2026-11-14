/**
 * groupTask.api — Bảng nhiệm vụ chung của nhóm (TaskFlowBoard).
 * Backend: app/group_tasks (GET/POST /groups/{groupId}/tasks, PATCH/DELETE /groups/{groupId}/tasks/{taskId}).
 */
import { apiClient } from './apiClient';

export interface GroupTaskPosition { x: number; y: number; }

export interface GroupTask {
  id: string;
  group_id: string;
  parent_id: string | null;
  title: string;
  assignee: string;
  /** YYYY-MM-DD hoặc null nếu chưa đặt hạn. */
  due_date: string | null;
  done: boolean;
  notes: string[];
  /** Vị trí kéo thả trên canvas; null = để bảng tự sắp xếp. */
  position: GroupTaskPosition | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupTaskCreate {
  title: string;
  assignee?: string;
  due_date?: string | null;
  parent_id?: string | null;
  notes?: string[];
}

export type GroupTaskUpdate = Partial<Pick<GroupTask, 'title' | 'assignee' | 'due_date' | 'done' | 'parent_id' | 'notes' | 'position'>>;

const base = (groupId: string) => `/groups/${encodeURIComponent(groupId)}/tasks`;

export function listGroupTasks(groupId: string) {
  return apiClient.get<GroupTask[]>(base(groupId));
}

export function createGroupTask(groupId: string, data: GroupTaskCreate) {
  return apiClient.post<GroupTask>(base(groupId), data);
}

export function updateGroupTask(groupId: string, taskId: string, data: GroupTaskUpdate) {
  return apiClient.patch<GroupTask>(`${base(groupId)}/${encodeURIComponent(taskId)}`, data);
}

/** Xóa nhiệm vụ cùng toàn bộ nhánh con của nó. */
export function deleteGroupTask(groupId: string, taskId: string) {
  return apiClient.delete<void>(`${base(groupId)}/${encodeURIComponent(taskId)}`);
}
