import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Flame } from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { getGroupStreak, recordGroupMilestone, rewardLabel } from '../../lib/rewards';
import type { GroupStreak } from '../../lib/rewards';

interface GroupStreakStripProps {
  groupId: string;
  isManager: boolean;
}

/** One line of group momentum above the room card: the streak, this week's state, and (for
 * a manager) the one action that extends it. Rewards unlocked by a record are named inline
 * with a link to where they are chosen. */
export function GroupStreakStrip({ groupId, isManager }: GroupStreakStripProps) {
  const [streak, setStreak] = useState<GroupStreak | null>(null);
  const [unlocked, setUnlocked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStreak(null);
    setUnlocked(null);
    getGroupStreak(groupId).then(setStreak).catch(() => setStreak(null));
  }, [groupId]);

  const record = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordGroupMilestone(groupId);
      setUnlocked(result.unlocked);
      setStreak(await getGroupStreak(groupId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không ghi nhận được. Thử lại nhé.');
    } finally {
      setBusy(false);
    }
  };

  if (!streak) return null;

  const weeks = streak.streak;
  const nextIn = streak.next_tier !== null ? streak.next_tier - weeks : null;

  return (
    <section aria-label="Chuỗi nhóm" style={{ width: '100%', maxWidth: 680, padding: '12px 16px', borderRadius: 12, background: 'white', border: '1px solid #E2E8F0', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
          <Flame size={18} color={weeks > 0 ? '#F59E0B' : '#94A3B8'} />
          {weeks > 0 ? `Chuỗi nhóm: ${weeks} tuần` : 'Chưa có chuỗi'}
        </span>
        <span style={{ fontSize: 13, color: '#64748B' }}>
          {streak.current_week_recorded ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#047857' }}><Check size={14} /> Tuần này đã ghi nhận</span>
          ) : (
            'Tuần này chưa ghi nhận'
          )}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/settings" style={{ fontSize: 13, color: '#1D4ED8', fontWeight: 600 }}>Phần thưởng</Link>
          {isManager && !streak.current_week_recorded && (
            <button type="button" onClick={() => void record()} disabled={busy} style={{ padding: '7px 12px', border: 'none', borderRadius: 8, background: busy ? '#93A4C7' : '#00236F', color: 'white', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Đang ghi…' : 'Ghi nhận mốc tuần này'}
            </button>
          )}
        </span>
      </div>
      {unlocked && unlocked.length > 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: '#0F172A' }}>
          Cả nhóm vừa mở khóa: <b>{unlocked.map(rewardLabel).join(', ')}</b>. <Link to="/settings" style={{ color: '#1D4ED8' }}>Chọn trong Cài đặt</Link>.
        </p>
      ) : nextIn !== null && streak.next_tier_items.length > 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
          Còn {nextIn} tuần nữa mở khóa {streak.next_tier_items.map(rewardLabel).join(' và ')}.
        </p>
      ) : null}
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: '#B91C1C' }}>{error}</p>}
    </section>
  );
}
