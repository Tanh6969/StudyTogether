import { useEffect, useState } from 'react';
import { Check, Lock, Volume2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { CHEERS, DEFAULT_CHEER, FRAMES, getMyRewards, updateMyRewards } from '../../lib/rewards';
import type { MyRewards } from '../../lib/rewards';
import { playCheer } from '../../utils/cheerSounds';
import { FramedAvatar } from '../ui/FramedAvatar';

const cardStyle: React.CSSProperties = { background: '#FFF', border: '1px solid #DCE4F0', borderRadius: 9, padding: 24 };
const sectionTitle: React.CSSProperties = { margin: 0, color: '#151E34', fontSize: 20, lineHeight: 1.35, fontWeight: 700 };
const mutedText: React.CSSProperties = { margin: '3px 0 0', color: '#51596B', fontSize: 14, lineHeight: 1.45 };
const groupLabel: React.CSSProperties = { margin: '0 0 10px', color: '#172139', fontSize: 14, fontWeight: 650 };

function optionStyle(selected: boolean, locked: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'grid',
    justifyItems: 'center',
    gap: 8,
    padding: '14px 8px 10px',
    borderRadius: 8,
    border: `1.5px solid ${selected ? '#062A78' : '#DCE4F0'}`,
    background: selected ? '#EEF3FF' : '#FFF',
    color: locked ? '#8A94A8' : '#172139',
    cursor: locked ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center',
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
      setMine(await updateMyRewards(data));
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
      <p style={mutedText}>Nhóm giữ chuỗi tuần càng dài, cả nhóm mở khóa càng nhiều. Chọn khung viền và kiểu cổ vũ bạn muốn dùng.</p>

      {error && <p role="alert" style={{ ...mutedText, color: '#B91C1C', marginTop: 12 }}>{error}</p>}

      <div style={{ marginTop: 20 }}>
        <p style={groupLabel}>Khung viền avatar</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 10 }}>
          <button type="button" onClick={() => void save({ avatar_frame: null })} aria-pressed={!mine?.avatar_frame} style={optionStyle(!mine?.avatar_frame, false)}>
            <FramedAvatar size={48} initials={currentUser.initials} color={currentUser.color} avatarUrl={currentUser.avatarUrl} frame={null} />
            <span>Không viền</span>
          </button>
          {FRAMES.map((frame) => {
            const locked = !owned.has(frame.id);
            const selected = mine?.avatar_frame === frame.id;
            return (
              <button
                key={frame.id}
                type="button"
                onClick={() => !locked && void save({ avatar_frame: frame.id })}
                aria-pressed={selected}
                aria-disabled={locked}
                title={locked ? `Mở khi nhóm giữ chuỗi ${frame.tier} tuần` : frame.hint}
                style={optionStyle(selected, locked)}
              >
                <span style={{ opacity: locked ? 0.45 : 1, display: 'inline-flex' }}>
                  <FramedAvatar size={48} initials={currentUser.initials} color={currentUser.color} avatarUrl={currentUser.avatarUrl} frame={frame.id} />
                </span>
                <span>{frame.label}</span>
                {locked ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500 }}><Lock size={11} /> {frame.tier} tuần</span>
                ) : selected ? (
                  <span style={{ position: 'absolute', top: 6, right: 6, color: '#062A78', display: 'inline-flex' }}><Check size={14} /></span>
                ) : null}
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
              <li key={cheer.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${selected ? '#062A78' : '#DCE4F0'}`, background: selected ? '#EEF3FF' : '#FFF', color: locked ? '#8A94A8' : '#172139' }}>
                <button
                  type="button"
                  onClick={() => !locked && void save({ cheer_style: cheer.id })}
                  aria-pressed={selected}
                  aria-disabled={locked}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', color: 'inherit', cursor: locked ? 'not-allowed' : 'pointer', textAlign: 'left', padding: 0, fontSize: 14 }}
                >
                  <span style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', background: selected ? '#062A78' : '#F1F5F9', color: selected ? '#FFF' : 'inherit', flexShrink: 0 }}><Icon size={16} /></span>
                  <span style={{ display: 'grid' }}>
                    <span style={{ fontWeight: 650 }}>{cheer.label}</span>
                    <span style={{ fontSize: 12, color: locked ? '#8A94A8' : '#51596B' }}>{locked ? `Mở khi nhóm giữ chuỗi ${cheer.tier} tuần` : cheer.hint}</span>
                  </span>
                </button>
                <button type="button" onClick={() => playCheer(cheer.id)} aria-label={`Nghe thử ${cheer.label}`} title="Nghe thử" style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid #DCE4F0', background: '#FFF', color: '#0A347F', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
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
