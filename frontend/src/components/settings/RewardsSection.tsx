import { useEffect, useState } from 'react';
import { Award, Check, Lock, Volume2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { CHEERS, DEFAULT_CHEER, FRAMES, getMyRewards, progressText, rewardLabel, unlockText, updateMyRewards } from '../../lib/rewards';
import type { MyRewards } from '../../lib/rewards';
import { playCheer } from '../../utils/cheerSounds';
import { FramedAvatar } from '../ui/FramedAvatar';
import { SettingsSection } from './SettingsSection';

const GROUP_LABEL = 'm-0 mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500';

/** Frame tile: dark "stage" on top (most frames are designed to glow), name + unlock rule under it. */
function tileClasses(selected: boolean, locked: boolean) {
  return [
    'relative flex flex-col overflow-hidden rounded-xl border-[1.5px] p-0 text-left transition',
    selected ? 'border-[#00236F] bg-[#EEF3FF]' : 'border-slate-200 bg-white',
    locked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-[#0B1C30] hover:border-[#00236F]/50',
  ].join(' ');
}

const CORNER_BADGE = 'absolute right-2 top-2 grid h-5.5 w-5.5 place-items-center rounded-md text-white';

export function RewardsSection() {
  const { currentUser } = useAuth();
  const [mine, setMine] = useState<MyRewards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyRewards()
      .then(setMine)
      .catch(() => setError('Không tải được phần thưởng của bạn.'));
  }, []);

  const owned = new Set(mine?.owned ?? []);

  const save = async (data: { avatar_frame?: string | null; cheer_style?: string }) => {
    if (!mine || saving) return;
    const previous = mine;
    setMine({ ...mine, ...('avatar_frame' in data ? { avatar_frame: data.avatar_frame ?? null } : {}), ...(data.cheer_style ? { cheer_style: data.cheer_style } : {}) });
    setSaving(true);
    setError(null);
    try {
      const next = await updateMyRewards(data);
      setMine({ ...previous, ...next, progress: previous.progress, just_unlocked: [] });
    } catch {
      setMine(previous);
      setError('Không lưu được lựa chọn. Thử lại nhé.');
    } finally {
      setSaving(false);
    }
  };

  const avatar = { initials: currentUser.initials, color: currentUser.color, avatarUrl: currentUser.avatarUrl };

  return (
    <SettingsSection
      id="rewards"
      icon={Award}
      title="Phần thưởng"
      description="Khung viền mở bằng thành tựu của bạn và chuỗi tuần của nhóm. Kiểu cổ vũ mở theo chuỗi nhóm."
      className="rewards-section"
    >
      {error && <p role="alert" className="m-0 mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
      {mine && mine.just_unlocked.length > 0 && (
        <p role="status" className="m-0 mb-4 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          Bạn vừa mở khóa: <b>{mine.just_unlocked.map(rewardLabel).join(', ')}</b>.
        </p>
      )}

      <p className={GROUP_LABEL}>Khung viền avatar</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
        <button type="button" onClick={() => void save({ avatar_frame: null })} aria-pressed={!mine?.avatar_frame} className={tileClasses(!mine?.avatar_frame, false)}>
          <span className="relative grid h-22 w-full place-items-center bg-slate-900 sm:h-24">
            <FramedAvatar size={52} {...avatar} frame={null} />
            {!mine?.avatar_frame && <span className={`${CORNER_BADGE} bg-[#00236F]`}><Check size={13} /></span>}
          </span>
          <span className="flex flex-col gap-0.5 px-2.5 py-2">
            <span className="text-[13px] font-semibold">Không viền</span>
            <span className="text-xs text-slate-500">Mặc định</span>
          </span>
        </button>
        {FRAMES.map((frame) => {
          const locked = !owned.has(frame.id);
          const selected = mine?.avatar_frame === frame.id;
          const progress = locked ? progressText(frame.unlock, mine?.progress) : null;
          return (
            <button
              key={frame.id}
              type="button"
              onClick={() => !locked && void save({ avatar_frame: frame.id })}
              aria-pressed={selected}
              aria-disabled={locked}
              aria-label={`${frame.label}${locked ? ', chưa mở khóa' : ''}: ${unlockText(frame.unlock)}`}
              title={frame.hint}
              className={tileClasses(selected, locked)}
            >
              <span className={`relative grid h-22 w-full place-items-center sm:h-24 ${locked ? 'bg-slate-800' : 'bg-slate-900'}`}>
                <FramedAvatar size={52} {...avatar} frame={frame.id} />
                {locked && <span className={`${CORNER_BADGE} bg-slate-900`}><Lock size={12} /></span>}
                {selected && <span className={`${CORNER_BADGE} bg-[#00236F]`}><Check size={13} /></span>}
              </span>
              <span className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="text-[13px] font-semibold text-[#0B1C30]">{frame.label}</span>
                <span className={`text-xs leading-4 ${locked ? 'text-slate-400' : 'text-slate-500'}`}>
                  {unlockText(frame.unlock)}
                  {progress && <span className="tabular-nums"> · {progress}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className={`${GROUP_LABEL} mt-6`}>Kiểu cổ vũ</p>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
        {CHEERS.map((cheer) => {
          const locked = cheer.id !== DEFAULT_CHEER && !owned.has(cheer.id);
          const selected = (mine?.cheer_style ?? DEFAULT_CHEER) === cheer.id;
          const Icon = cheer.icon;
          return (
            <li
              key={cheer.id}
              className={`flex items-center gap-2.5 rounded-xl border-[1.5px] px-2.5 py-2 ${selected ? 'border-[#00236F] bg-[#EEF3FF]' : 'border-slate-200 bg-white'} ${locked ? 'text-slate-400' : 'text-[#0B1C30]'}`}
            >
              <button
                type="button"
                onClick={() => !locked && void save({ cheer_style: cheer.id })}
                aria-pressed={selected}
                aria-disabled={locked}
                className={`flex min-w-0 flex-1 items-center gap-2.5 border-none bg-transparent p-0 text-left text-sm text-inherit ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-[#00236F] text-white' : 'bg-slate-100'}`}>
                  <Icon size={16} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{cheer.label}</span>
                  <span className={`truncate text-xs ${locked ? 'text-slate-400' : 'text-slate-500'}`}>{locked ? unlockText(cheer.unlock) : cheer.hint}</span>
                </span>
              </button>
              {locked && <Lock size={14} aria-hidden className="shrink-0" />}
              <button
                type="button"
                onClick={() => playCheer(cheer.id)}
                aria-label={`Nghe thử ${cheer.label}`}
                title="Nghe thử"
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-[#00236F] hover:bg-slate-50"
              >
                <Volume2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
