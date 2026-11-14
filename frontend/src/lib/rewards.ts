import { Bell, Drum, Megaphone, PartyPopper, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiClient } from './apiClient';

/** Mirrors backend/app/rewards/catalog.py -- keep the two in step. `tier` is the group streak
 * (consecutive weeks with a recorded milestone) that unlocks the item. */
export interface FrameReward {
  id: string;
  label: string;
  hint: string;
  tier: number;
}

export interface CheerReward {
  id: string;
  label: string;
  hint: string;
  tier: number;
  icon: LucideIcon;
}

export const DEFAULT_CHEER = 'clap';

export const FRAMES: FrameReward[] = [
  { id: 'ring-sky', label: 'Vòng xanh', hint: 'Một vòng xanh gọn quanh avatar.', tier: 1 },
  { id: 'ring-sunset', label: 'Hoàng hôn', hint: 'Cam chuyển hồng.', tier: 2 },
  { id: 'ring-aurora', label: 'Cực quang', hint: 'Dải màu xoay chậm.', tier: 3 },
  { id: 'ring-gold', label: 'Vàng', hint: 'Viền vàng có ánh sáng.', tier: 5 },
];

export const CHEERS: CheerReward[] = [
  { id: 'clap', label: 'Vỗ tay', hint: 'Mặc định.', tier: 0, icon: PartyPopper },
  { id: 'drum', label: 'Trống', hint: 'Bốn nhịp trống dồn.', tier: 1, icon: Drum },
  { id: 'fanfare', label: 'Kèn', hint: 'Một hồi kèn ngắn.', tier: 2, icon: Megaphone },
  { id: 'sparkle', label: 'Chuông', hint: 'Ba tiếng chuông trong.', tier: 3, icon: Bell },
  { id: 'crowd', label: 'Khán đài', hint: 'Cả khán đài reo hò.', tier: 5, icon: Trophy },
];

export function cheerById(id: string | null | undefined): CheerReward {
  return CHEERS.find((c) => c.id === id) ?? CHEERS[0];
}

export function frameById(id: string | null | undefined): FrameReward | null {
  return FRAMES.find((f) => f.id === id) ?? null;
}

/** Mirrors GroupStreakResponse (app/rewards/dto/reward_dto.py). */
export interface GroupStreak {
  streak: number;
  total_milestones: number;
  current_week_key: string;
  current_week_recorded: boolean;
  next_tier: number | null;
  next_tier_items: string[];
  recent: Array<{ id: string; group_id: string; week_key: string; note: string; recorded_by: string | null; created_at: string }>;
}

export interface MilestoneRecorded {
  milestone: GroupStreak['recent'][number];
  streak: number;
  unlocked: string[];
}

export interface MyRewards {
  owned: string[];
  avatar_frame: string | null;
  cheer_style: string;
}

export function getGroupStreak(groupId: string): Promise<GroupStreak> {
  return apiClient.get<GroupStreak>(`/groups/${groupId}/streak`);
}

export function recordGroupMilestone(groupId: string, note = ''): Promise<MilestoneRecorded> {
  return apiClient.post<MilestoneRecorded>(`/groups/${groupId}/milestones`, { note });
}

export function getMyRewards(): Promise<MyRewards> {
  return apiClient.get<MyRewards>('/rewards/me');
}

export function updateMyRewards(data: { avatar_frame?: string | null; cheer_style?: string }): Promise<MyRewards> {
  return apiClient.put<MyRewards>('/rewards/me', data);
}

export function rewardLabel(id: string): string {
  return frameById(id)?.label ?? CHEERS.find((c) => c.id === id)?.label ?? id;
}
