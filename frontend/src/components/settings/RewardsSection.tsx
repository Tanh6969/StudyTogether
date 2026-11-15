import { useEffect, useState } from 'react';
import { Check, Lock, Volume2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { CHEERS, DEFAULT_CHEER, FRAMES, getMyRewards, progressText, rewardLabel, unlockText, updateMyRewards } from '../../lib/rewards';
import type { MyRewards } from '../../lib/rewards';
import { playCheer } from '../../utils/cheerSounds';
import { FramedAvatar } from '../ui/FramedAvatar';

/* Colour tokens for this component (the settings page's light palette + a dark stage for
 * frame previews, since most frames are designed to glow). */
const T = {
  surface: '#FFF',
  line: '#DCE4F0',
  ink: '#151E34',
  text: '#172139',
  muted: '#51596B',
  faint: '#8A94A8',
  accent: '#062A78',
  accentSoft: '#EEF3FF',
  link: '#0A347F',
  chip: '#F1F5F9',
  danger: '#B91C1C',
  stage: '#0F172A',
  stageLocked: '#1E293B',
  success: '#047857',
  successSoft: '#ECFDF5',
} as const;

const cardStyle: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 9, padding: 24 };
const sectionTitle: React.CSSProperties = { margin: 0, color: T.ink, fontSize: 20, lineHeight: 1.35, fontWeight: 700 };
const mutedText: React.CSSProperties = { margin: '3px 0 0', color: T.muted, fontSize: 14, lineHeight: 1.45 };
const groupLabel: React.CSSProperties = { margin: '0 0 10px', color: T.text, fontSize: 14, fontWeight: 650 };

function tileStyle(selected: boolean, locked: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'grid',
    gap: 8,
    padding: 0,
    borderRadius: 10,
    border: `1.5px solid ${selected ? T.accent : T.line}`,
    background: selected ? T.accentSoft : T.surface,
    color: locked ? T.faint : T.text,
    cursor: locked ? 'not-allowed' : 'pointer',
    textAlign: 'left',
    overflow: 'hidden',
  };
}

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

  return (
    <section className="settings-card rewards-section" style={cardStyle} aria-labelledby="rewards-title">
      <h2 id="rewards-title" style={sectionTitle}>Phần thưởng</h2>
      <p style={mutedText}>Khung viền mở bằng thành tựu của riêng bạn và chuỗi tuần của nhóm. Kiểu cổ vũ mở theo chuỗi nhóm.</p>

      {error && <p role="alert" style={{ ...mutedText, color: T.danger, marginTop: 12 }}>{error}</p>}
      {mine && mine.just_unlocked.length > 0 && (
        <p role="status" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 8, background: T.successSoft, color: T.success, fontSize: 14 }}>
          Bạn vừa mở khóa: <b>{mine.just_unlocked.map(rewardLabel).join(', ')}</b>.
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        <p style={groupLabel}>Khung viền avatar</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          <button type="button" onClick={() => void save({ avatar_frame: null })} aria-pressed={!mine?.avatar_frame} style={tileStyle(!mine?.avatar_frame, false)}>
            <span style={{ display: 'grid', placeItems: 'center', height: 104, background: T.stage }}>
              <FramedAvatar size={56} initials={currentUser.initials} color={currentUser.color} avatarUrl={currentUser.avatarUrl} frame={null} />
            </span>
            <span style={{ padding: '0 10px 10px', display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 650 }}>Không viền</span>
              <span style={{ fontSize: 12, color: T.muted }}>Mặc định</span>
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
                style={tileStyle(selected, locked)}
              >
                <span style={{ position: 'relative', display: 'grid', placeItems: 'center', height: 104, background: locked ? T.stageLocked : T.stage }}>
                  <FramedAvatar size={56} initials={currentUser.initials} color={currentUser.color} avatarUrl={currentUser.avatarUrl} frame={frame.id} />
                  {locked && (
                    <span style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 6, background: T.stage, color: T.surface, display: 'grid', placeItems: 'center' }}><Lock size={12} /></span>
                  )}
                  {selected && (
                    <span style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 6, background: T.accent, color: T.surface, display: 'grid', placeItems: 'center' }}><Check size={13} /></span>
                  )}
                </span>
                <span style={{ padding: '0 10px 10px', display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{frame.label}</span>
                  <span style={{ fontSize: 12, color: locked ? T.faint : T.muted, lineHeight: 1.35 }}>
                    {unlockText(frame.unlock)}
                    {progress && <span style={{ fontVariantNumeric: 'tabular-nums' }}> · {progress}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <p style={groupLabel}>Kiểu cổ vũ</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {CHEERS.map((cheer) => {
            const locked = cheer.id !== DEFAULT_CHEER && !owned.has(cheer.id);
            const selected = (mine?.cheer_style ?? DEFAULT_CHEER) === cheer.id;
            const Icon = cheer.icon;
            return (
              <li key={cheer.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${selected ? T.accent : T.line}`, background: selected ? T.accentSoft : T.surface, color: locked ? T.faint : T.text }}>
                <button
                  type="button"
                  onClick={() => !locked && void save({ cheer_style: cheer.id })}
                  aria-pressed={selected}
                  aria-disabled={locked}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', color: 'inherit', cursor: locked ? 'not-allowed' : 'pointer', textAlign: 'left', padding: 0, fontSize: 14 }}
                >
                  <span style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', background: selected ? T.accent : T.chip, color: selected ? T.surface : 'inherit', flexShrink: 0 }}><Icon size={16} /></span>
                  <span style={{ display: 'grid' }}>
                    <span style={{ fontWeight: 650 }}>{cheer.label}</span>
                    <span style={{ fontSize: 12, color: locked ? T.faint : T.muted }}>{locked ? unlockText(cheer.unlock) : cheer.hint}</span>
                  </span>
                </button>
                <button type="button" onClick={() => playCheer(cheer.id)} aria-label={`Nghe thử ${cheer.label}`} title="Nghe thử" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${T.line}`, background: T.surface, color: T.link, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <Volume2 size={15} />
                </button>
                {locked && <Lock size={14} aria-hidden />}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
