import { Bell, Drum, Megaphone, PartyPopper, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiClient } from './apiClient';

/** Mirrors backend/app/rewards/catalog.py -- keep the two in step. */

export type UnlockType =
  | 'group_streak'
  | 'tasks_done'
  | 'sessions'
  | 'study_hours'
  | 'night_owl'
  | 'early_bird'
  | 'rooms_hosted'
  | 'day_streak';

export interface Unlock {
  type: UnlockType;
  threshold: number;
}

export interface FrameReward {
  id: string;
  label: string;
  hint: string;
  unlock: Unlock;
  /** Frames with SVG decorations outside the ring (components/ui/frameArt.tsx). */
  art?: boolean;
}

export interface CheerReward {
  id: string;
  label: string;
  hint: string;
  unlock: Unlock;
  icon: LucideIcon;
}

export const DEFAULT_CHEER = 'clap';

const gs = (threshold: number): Unlock => ({ type: 'group_streak', threshold });

export const FRAMES: FrameReward[] = [
  { id: 'ring-sky', label: 'Vòng xanh', hint: 'Một vòng xanh gọn.', unlock: gs(1) },
  { id: 'ring-sunset', label: 'Hoàng hôn', hint: 'Cam chuyển hồng.', unlock: gs(2) },
  { id: 'ring-aurora', label: 'Cực quang', hint: 'Dải màu xoay chậm.', unlock: gs(3) },
  { id: 'ring-gold', label: 'Vàng', hint: 'Viền vàng có ánh sáng.', unlock: gs(5) },
  { id: 'shadow', label: 'Hắc ám', hint: 'Khói đen bốc chậm quanh viền.', unlock: { type: 'sessions', threshold: 5 }, art: true },
  { id: 'frost', label: 'Băng giá', hint: 'Gai băng mọc từ vành.', unlock: { type: 'early_bird', threshold: 1 }, art: true },
  { id: 'storm', label: 'Lôi đình', hint: 'Tia sét nhấp nháy.', unlock: { type: 'tasks_done', threshold: 25 }, art: true },
  { id: 'void', label: 'Hư không', hint: 'Vành đai tím quay quanh hố đen.', unlock: { type: 'night_owl', threshold: 5 }, art: true },
  { id: 'neon', label: 'Neon', hint: 'Hai vòng cyan–hồng kiểu cyberpunk.', unlock: { type: 'sessions', threshold: 20 }, art: true },
  { id: 'inferno', label: 'Hỏa ngục', hint: 'Lửa liếm lên từ vành.', unlock: { type: 'day_streak', threshold: 7 }, art: true },
  { id: 'crown', label: 'Vương miện', hint: 'Vương miện vàng đính đá.', unlock: { type: 'rooms_hosted', threshold: 10 }, art: true },
  { id: 'galaxy', label: 'Thiên hà', hint: 'Sao lấp lánh trên nền vũ trụ.', unlock: { type: 'study_hours', threshold: 50 }, art: true },
  { id: 'toxic', label: 'Độc dược', hint: 'Axit xanh nhỏ giọt, bọt sủi.', unlock: { type: 'tasks_done', threshold: 100 }, art: true },
  { id: 'bloodmoon', label: 'Huyết nguyệt', hint: 'Trăng lưỡi liềm đỏ, máu nhỏ.', unlock: { type: 'night_owl', threshold: 30 }, art: true },
  { id: 'dragon', label: 'Long thần', hint: 'Sừng rồng và vảy ngọc.', unlock: { type: 'day_streak', threshold: 30 }, art: true },
];

export const CHEERS: CheerReward[] = [
  { id: 'clap', label: 'Vỗ tay', hint: 'Mặc định.', unlock: gs(0), icon: PartyPopper },
  { id: 'drum', label: 'Trống', hint: 'Bốn nhịp trống dồn.', unlock: gs(1), icon: Drum },
  { id: 'fanfare', label: 'Kèn', hint: 'Một hồi kèn ngắn.', unlock: gs(2), icon: Megaphone },
  { id: 'sparkle', label: 'Chuông', hint: 'Ba tiếng chuông trong.', unlock: gs(3), icon: Bell },
  { id: 'crowd', label: 'Khán đài', hint: 'Cả khán đài reo hò.', unlock: gs(5), icon: Trophy },
];

export function cheerById(id: string | null | undefined): CheerReward {
  return CHEERS.find((c) => c.id === id) ?? CHEERS[0];
}

export function frameById(id: string | null | undefined): FrameReward | null {
  return FRAMES.find((f) => f.id === id) ?? null;
}

/** How to earn it, in the user's words. */
export function unlockText(unlock: Unlock): string {
  const n = unlock.threshold;
  switch (unlock.type) {
    case 'group_streak':
      return `Nhóm giữ chuỗi ${n} tuần`;
    case 'tasks_done':
      return `Xong ${n} việc trong phòng học`;
    case 'sessions':
      return `Vào ${n} buổi học`;
    case 'study_hours':
      return `${n} giờ học trong phòng`;
    case 'night_owl':
      return n === 1 ? 'Xong một việc sau 23 giờ' : `Xong ${n} việc sau 23 giờ`;
    case 'early_bird':
      return n === 1 ? 'Xong một việc trước 7 giờ sáng' : `Xong ${n} việc trước 7 giờ sáng`;
    case 'rooms_hosted':
      return `Mở ${n} phòng học`;
    case 'day_streak':
      return `Học ${n} ngày liên tiếp`;
  }
}

/** "12/25" for personal counters; group streak progress lives on the group page. */
export function progressText(unlock: Unlock, progress: Record<string, number> | undefined): string | null {
  if (unlock.type === 'group_streak' || !progress) return null;
  const current = Math.min(progress[unlock.type] ?? 0, unlock.threshold);
  return `${current}/${unlock.threshold}`;
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
  progress: Record<string, number>;
  just_unlocked: string[];
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
