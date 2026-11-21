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
  /** Chung cho mọi nhiệm vụ của một lần áp dụng lộ trình AI (mỗi lộ trình là một làn riêng); null = tự thêm. */
  roadmap_id?: string | null;
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

export interface AIGroupTaskNode {
  title: string;
  assignee: string;
  due_date: string | null;
  notes: string[];
  children: AIGroupTaskNode[];
}

export interface AIGroupTaskSuggestion {
  title: string;
  nodes: AIGroupTaskNode[];
}

export interface AIGroupTaskGenerateResponse extends AIGroupTaskSuggestion {
  /** Số lượt tạo lộ trình AI còn lại hôm nay của người gọi. */
  remaining_today: number;
}

/** Hạn mức tạo lộ trình AI theo ngày (giờ Việt Nam), tính chung cho mọi nhóm của người dùng. */
export interface AIQuota { limit: number; remaining: number; }

/** Hạn mục tiêu phải trong khoảng (hôm nay, hôm nay + 730 ngày] — khớp AI_MAX_HORIZON_DAYS ở backend. */
export const AI_MAX_HORIZON_DAYS = 730;

const base = (groupId: string) => `/groups/${encodeURIComponent(groupId)}/tasks`;

export function getGroupTaskAiQuota(groupId: string) {
  return apiClient.get<AIQuota>(`${base(groupId)}/ai/quota`);
}

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

export function generateGroupTaskTree(
  groupId: string,
  data: { goal: string; due_date: string | null; hours_per_week: number; current_level: string }
) {
  return apiClient.post<AIGroupTaskGenerateResponse>(`${base(groupId)}/ai/generate`, data);
}

export function applyGroupTaskTree(
  groupId: string,
  data: { nodes: AIGroupTaskNode[]; replace_existing: boolean }
) {
  return apiClient.post<GroupTask[]>(`${base(groupId)}/ai/apply`, data);
}
