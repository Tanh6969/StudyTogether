import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Gamepad2, Music2, Timer, Vote, X } from 'lucide-react';
import type { RoomActivity } from '../lib/activity.types';
import { getDisplayName } from '../utils/userDisplay';

interface ActivityTrayProps {
  open: boolean;
  onClose: () => void;
  game: RoomActivity | null;
  music: RoomActivity | null;
  currentUserId: string | null;
  busy: boolean;
  error: string | null;
  onStartGame: () => void;
  onOpenGame: () => void;
  onStartMusic: () => void;
  onOpenMusic: () => void;
}

const T = {
  bg: '#1E293B',
  line: '#334155',
  text: '#E2E8F0',
  muted: '#94A3B8',
  accent: '#38BDF8',
};

const cardStyle: CSSProperties = {
  background: '#0F172A',
  border: `1px solid ${T.line}`,
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
  textAlign: 'left',
  color: T.text,
  cursor: 'pointer',
  width: '100%',
  font: 'inherit',
};

function Card({ icon, title, subtitle, onClick, disabled, badge }: { icon: ReactNode; title: string; subtitle: string; onClick?: () => void; disabled?: boolean; badge?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...cardStyle, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1E293B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accent, flexShrink: 0 }}>{icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
          {badge && <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, border: `1px solid ${T.line}`, borderRadius: 999, padding: '1px 6px' }}>{badge}</span>}
        </div>
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.4 }}>{subtitle}</div>
      </div>
    </button>
  );
}

/**
 * The "Hoạt động" tray that pops up above the call controls
 * (docs/design/hoat-dong-trong-call.md §1.2): what is running, and what can be started.
 */
export function ActivityTray({ open, onClose, game, music, currentUserId, busy, error, onStartGame, onOpenGame, onStartMusic, onOpenMusic }: ActivityTrayProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer so the opening click doesn't immediately close it.
    const id = window.setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.clearTimeout(id);
    };
  }, [open, onClose]);

  if (!open) return null;

  const live: Array<{ activity: RoomActivity; title: string; icon: ReactNode; onOpen: () => void }> = [];
  if (game) live.push({ activity: game, title: 'Phấn Trắng', icon: <Gamepad2 size={18} />, onOpen: onOpenGame });
  if (music) live.push({ activity: music, title: 'Nghe chung', icon: <Music2 size={18} />, onOpen: onOpenMusic });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Hoạt động"
      style={{
        position: 'absolute',
        bottom: 84,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(92vw, 460px)',
        background: T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        padding: 16,
        zIndex: 60,
        color: T.text,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Hoạt động</h3>
        <button type="button" onClick={onClose} aria-label="Đóng" style={{ background: 'transparent', border: 'none', color: T.muted, cursor: 'pointer', padding: 4, display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, color: '#FCA5A5', fontSize: 12 }}>{error}</div>
      )}

      {live.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Đang diễn ra</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {live.map(({ activity, title, icon, onOpen }) => {
              const joined = !!currentUserId && activity.participants.includes(currentUserId);
              const hostName = activity.host_user_id === currentUserId ? 'bạn' : getDisplayName(activity.host);
              return (
                <button key={activity.id} type="button" onClick={onOpen} style={{ ...cardStyle, borderLeft: `3px solid ${T.accent}`, alignItems: 'center' }}>
                  <div style={{ color: T.accent, display: 'flex' }}>{icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {title} <span style={{ color: T.muted, fontWeight: 400 }}>· {hostName} làm chủ · {activity.participants.length} người</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.muted }}>{activity.status === 'lobby' ? 'Đang ở sảnh chờ' : 'Đang diễn ra'}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', background: T.accent, borderRadius: 8, padding: '6px 10px', whiteSpace: 'nowrap' }}>{joined ? 'Mở' : 'Tham gia'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Bắt đầu mới</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Card icon={<Gamepad2 size={18} />} title="Phấn Trắng" subtitle="Vẽ và đoán trên bảng phấn. 2 đến 10 người, một ván khoảng 7 phút." onClick={game ? onOpenGame : onStartGame} disabled={busy} />
        <Card icon={<Music2 size={18} />} title="Nghe chung" subtitle="Dán link YouTube, SoundCloud, Spotify. Cả phòng nghe cùng một lúc." onClick={music ? onOpenMusic : onStartMusic} disabled={busy} />
        <Card icon={<Timer size={18} />} title="Pomodoro chung" subtitle="Một đồng hồ 25/5 cho cả phòng." disabled badge="Sắp có" />
        <Card icon={<Vote size={18} />} title="Bình chọn nhanh" subtitle="Chốt nhanh học tiếp hay nghỉ." disabled badge="Sắp có" />
      </div>
    </div>
  );
}
