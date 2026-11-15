import { Music2, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MusicController } from './useMusicSync';

export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

interface MusicMiniPlayerProps {
  controller: MusicController;
  djName: string;
  onOpen: () => void;
  /** Receives the artwork element so the player can sit there while the panel is closed. */
  onDiscSlot?: (el: HTMLElement | null) => void;
}

/** Always-visible strip above the sidebar tabs (design §3.6). */
export function MusicMiniPlayer({ controller, djName, onOpen, onDiscSlot }: MusicMiniPlayerProps) {
  const { current, state, isDj, unlocked, unlock, positionMs, durationMs, muted, toggleMuted, togglePlay, voteSkip, capabilities, hasVotedSkip } = controller;
  const progress = durationMs && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const needsUnlock = !isDj && !unlocked && state.isPlaying && !!current;

  const iconBtn = (label: string, onClick: () => void, child: React.ReactNode, active = false, disabled = false) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: active ? '#38BDF8' : 'transparent', color: active ? '#0F172A' : disabled ? '#475569' : '#E2E8F0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}
    >
      {child}
    </button>
  );

  return (
    <div
      role="region"
      aria-label="Nhạc đang phát"
      onClick={onOpen}
      style={{ position: 'relative', height: 56, background: '#0B1220', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 12px', cursor: 'pointer', overflow: 'hidden' }}
    >
      <div
        ref={onDiscSlot}
        className={state.isPlaying && current ? 'music-disc-spin' : undefined}
        style={{ width: 36, height: 36, borderRadius: '50%', background: '#1E293B', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', border: '2px solid #334155' }}
      >
        {current?.thumbnail_url ? <img src={current.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={16} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current ? current.title : 'Chưa có bài nào · dán link để bắt đầu'}
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {needsUnlock ? 'Nhạc đang phát · bấm ▶ để nghe cùng' : current ? `${current.author ?? current.provider} · DJ: ${djName}` : `DJ: ${djName}`}
        </div>
      </div>
      {needsUnlock
        ? iconBtn('Nghe cùng', unlock, <Play size={15} />, true)
        : isDj
          ? iconBtn(state.isPlaying ? 'Tạm dừng' : 'Phát', togglePlay, state.isPlaying ? <Pause size={15} /> : <Play size={15} />, false, !current && controller.state.currentId === null && false)
          : null}
      {current && iconBtn(isDj ? 'Bỏ qua' : hasVotedSkip ? 'Đã bỏ phiếu bỏ qua' : 'Bỏ phiếu bỏ qua', voteSkip, <SkipForward size={15} />, hasVotedSkip, hasVotedSkip)}
      {capabilities.volume ? iconBtn(muted ? 'Bật tiếng' : 'Tắt tiếng của tôi', toggleMuted, muted ? <VolumeX size={15} /> : <Volume2 size={15} />) : null}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: '#1E293B' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: '#38BDF8', transition: 'width 0.5s linear' }} />
      </div>
    </div>
  );
}
