import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { ChevronDown, ChevronUp, Link2, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Trash2, Volume2, VolumeX, Crown, X } from 'lucide-react';
import type { QueueItem, RoomActivity } from '../lib/activity.types';
import type { UserSummary } from '../lib/profile.types';
import { ApiError } from '../lib/apiClient';
import type { MusicController, MusicQueueApi } from './useMusicSync';
import { sortQueue } from './useMusicSync';
import { formatClock } from './MusicMiniPlayer';

interface MusicPanelProps {
  activity: RoomActivity;
  controller: MusicController;
  queue: MusicQueueApi;
  currentUserId: string | null;
  isManager: boolean;
  /** Receives the element the PlayerDock should cover. */
  onPlayerSlot: (el: HTMLElement | null) => void;
  onEnd: () => void;
  onLeave: () => void;
  resolveName: (user: UserSummary | null | undefined, userId: string) => string;
}

const T = { bg: '#1E293B', line: '#334155', text: '#E2E8F0', muted: '#94A3B8', accent: '#38BDF8', faint: '#64748B' };

const iconButton: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  background: 'transparent',
  color: T.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
};

const providerLabel: Record<QueueItem['provider'], string> = { youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify' };

export function MusicPanel({ activity, controller, queue, currentUserId, isManager, onPlayerSlot, onEnd, onLeave, resolveName }: MusicPanelProps) {
  const { current, state, isDj, unlocked, unlock, positionMs, durationMs, volume, setVolume, muted, toggleMuted, ducking, setDucking, capabilities, lastError, clearError } = controller;
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onPlayerSlot(slotRef.current);
    return () => onPlayerSlot(null);
  }, [onPlayerSlot]);

  const canControl = isDj;
  const djName = resolveName(activity.host, activity.host_user_id);
  const ordered = sortQueue(queue.queue);
  const upcoming = ordered.filter((i) => !i.played_at && i.id !== current?.id);
  const played = ordered.filter((i) => i.played_at && i.id !== current?.id);
  const needsUnlock = !isDj && !unlocked && state.isPlaying && !!current;
  const progress = durationMs && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const url = draft.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await queue.add(url);
      setDraft('');
      unlock();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Không thêm được bài này.');
    } finally {
      setAdding(false);
    }
  };

  const move = (item: QueueItem, direction: -1 | 1) => {
    const idx = upcoming.findIndex((i) => i.id === item.id);
    const target = upcoming[idx + direction];
    if (!target) return;
    const neighbour = upcoming[idx + direction * 2];
    const newPos = neighbour ? (target.position + neighbour.position) / 2 : target.position + direction;
    void queue.reorder(item.id, newPos);
  };

  const row = (item: QueueItem, options: { upcoming: boolean; index: number }) => {
    const mine = item.added_by === currentUserId;
    return (
      <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ width: 40, height: 40, borderRadius: 6, background: '#0F172A', overflow: 'hidden', flexShrink: 0 }}>
          {item.thumbnail_url && <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
          <div style={{ fontSize: 11, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {providerLabel[item.provider]} · {resolveName(item.adder, item.added_by)} thêm
            {item.provider === 'spotify' && <span title="Spotify chỉ cho nghe 30 giây nếu trình duyệt chưa đăng nhập Premium."> · xem trước 30s</span>}
          </div>
        </div>
        {canControl && (
          <button type="button" onClick={() => controller.playItem(item.id)} title="Phát ngay" aria-label={`Phát ngay: ${item.title}`} style={{ ...iconButton, width: 30, height: 30 }}>
            <Play size={14} />
          </button>
        )}
        {canControl && options.upcoming && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button type="button" onClick={() => move(item, -1)} disabled={options.index === 0} aria-label="Lên" style={{ ...iconButton, width: 22, height: 15, border: 'none', color: options.index === 0 ? T.faint : T.text }}>
              <ChevronUp size={12} />
            </button>
            <button type="button" onClick={() => move(item, 1)} disabled={options.index === upcoming.length - 1} aria-label="Xuống" style={{ ...iconButton, width: 22, height: 15, border: 'none', color: options.index === upcoming.length - 1 ? T.faint : T.text }}>
              <ChevronDown size={12} />
            </button>
          </div>
        )}
        {(mine || canControl || isManager) && (
          <button type="button" onClick={() => void queue.remove(item.id)} title="Xóa khỏi hàng đợi" aria-label={`Xóa: ${item.title}`} style={{ ...iconButton, width: 30, height: 30, color: T.muted }}>
            <Trash2 size={14} />
          </button>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Nghe nhạc chung" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', color: T.text, overflow: 'hidden' }}>
      {/* Player slot, outside the scroll area: the PlayerDock lays the real iframe over this box,
          so it can never scroll underneath the mini player or the tabs. */}
      <div style={{ padding: '14px 14px 0', flexShrink: 0 }}>
        <div ref={slotRef} style={{ width: '100%', maxHeight: '28vh', aspectRatio: current?.provider === 'youtube' ? '16 / 9' : current ? 'auto' : '16 / 9', height: current && current.provider !== 'youtube' ? 166 : undefined, borderRadius: 10, background: '#0F172A', border: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.faint, fontSize: 12, margin: '0 auto' }}>
          {!current && 'Dán link bên dưới để bắt đầu'}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {needsUnlock && (
          <button type="button" onClick={unlock} style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: T.accent, color: '#0F172A', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ▶ Nhạc đang phát, bấm để nghe cùng
          </button>
        )}

        {lastError && (
          <div onClick={clearError} style={{ padding: '8px 10px', background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, color: '#FCA5A5', fontSize: 12, cursor: 'pointer' }}>
            {lastError}
          </div>
        )}

        <div>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current ? current.title : 'Chưa phát bài nào'}</div>
          <div style={{ fontSize: 12, color: T.muted }}>
            {current ? `${current.author ?? ''}${current.author ? ' · ' : ''}${providerLabel[current.provider]}` : 'Hàng đợi trống'}
          </div>
        </div>

        {/* Progress */}
        <div>
          <div
            role={canControl ? 'slider' : undefined}
            aria-label="Tiến độ"
            aria-valuemin={0}
            aria-valuemax={durationMs ?? 0}
            aria-valuenow={Math.floor(positionMs)}
            onClick={(e) => {
              if (!canControl || !durationMs) return;
              const r = e.currentTarget.getBoundingClientRect();
              controller.seek(((e.clientX - r.left) / r.width) * durationMs);
            }}
            style={{ height: 6, borderRadius: 3, background: T.line, overflow: 'hidden', cursor: canControl && durationMs ? 'pointer' : 'default' }}
          >
            <div style={{ width: `${progress * 100}%`, height: '100%', background: T.accent }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.muted, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            <span>{formatClock(positionMs)}</span>
            <span>{formatClock(durationMs ?? current?.duration_ms ?? null)}</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={controller.prev} disabled={!canControl} title={canControl ? 'Bài trước / phát lại' : 'Chỉ DJ điều khiển'} style={{ ...iconButton, opacity: canControl ? 1 : 0.4 }}>
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            onClick={controller.togglePlay}
            disabled={!canControl}
            title={canControl ? (state.isPlaying ? 'Tạm dừng cho cả phòng' : 'Phát cho cả phòng') : 'Chỉ DJ điều khiển'}
            style={{ ...iconButton, width: 42, height: 42, background: canControl ? T.accent : 'transparent', color: canControl ? '#0F172A' : T.faint, border: 'none' }}
          >
            {state.isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            onClick={controller.voteSkip}
            disabled={!current || controller.hasVotedSkip}
            title={canControl ? 'Bỏ qua' : 'Bỏ phiếu bỏ qua bài này'}
            style={{ ...iconButton, width: 'auto', padding: '0 10px', gap: 6, fontSize: 12, opacity: current ? 1 : 0.4 }}
          >
            <SkipForward size={16} /> {canControl ? 'Bỏ qua' : `Bỏ qua ${controller.skipVotes}/${controller.skipVotesNeeded}`}
          </button>
          <button
            type="button"
            onClick={() => controller.setLoop(state.loop === 'off' ? 'all' : state.loop === 'all' ? 'one' : 'off')}
            disabled={!canControl}
            title={state.loop === 'off' ? 'Không lặp' : state.loop === 'all' ? 'Lặp cả hàng đợi' : 'Lặp một bài'}
            style={{ ...iconButton, color: state.loop === 'off' ? T.muted : T.accent, opacity: canControl ? 1 : 0.5 }}
          >
            {state.loop === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
          <div style={{ flex: 1 }} />
          {capabilities.volume ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={toggleMuted} title={muted ? 'Bật tiếng' : 'Tắt tiếng của tôi'} style={{ ...iconButton, border: 'none' }}>
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input type="range" min={0} max={100} value={muted ? 0 : Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} aria-label="Âm lượng của tôi" style={{ width: 90, accentColor: T.accent }} />
            </div>
          ) : (
            <span style={{ fontSize: 11, color: T.faint }}>Spotify không cho chỉnh âm lượng</span>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: capabilities.volume ? T.muted : T.faint }}>
          <input type="checkbox" checked={ducking} disabled={!capabilities.volume} onChange={(e) => setDucking(e.target.checked)} style={{ accentColor: T.accent }} />
          Giảm nhạc khi có người nói
        </label>

        {/* Add link */}
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#0F172A', border: `1px solid ${addError ? '#7F1D1D' : T.line}`, borderRadius: 10, padding: '0 10px' }}>
            <Link2 size={14} color={T.faint} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Dán link YouTube, SoundCloud, Spotify"
              aria-label="Link bài hát"
              disabled={adding}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 13, padding: '10px 0', fontFamily: 'inherit' }}
            />
          </div>
          <button type="submit" disabled={!draft.trim() || adding} style={{ padding: '0 14px', borderRadius: 10, border: 'none', background: draft.trim() ? T.accent : T.line, color: draft.trim() ? '#0F172A' : T.faint, fontWeight: 600, fontSize: 13, cursor: draft.trim() ? 'pointer' : 'default' }}>
            {adding ? '…' : 'Thêm'}
          </button>
        </form>
        {addError && <div style={{ fontSize: 12, color: '#FCA5A5', marginTop: -6 }}>{addError}</div>}
        {queue.error && <div style={{ fontSize: 12, color: '#FCA5A5' }}>{queue.error}</div>}

        {/* Upcoming */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Tiếp theo ({upcoming.length})</div>
            <div style={{ fontSize: 12, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Crown size={12} color="#F59E0B" /> DJ: {djName}
              {!isDj && (
                <button type="button" onClick={() => void controller.claimDj()} title="Nhận quyền DJ" style={{ border: `1px solid ${T.line}`, background: 'transparent', color: T.text, borderRadius: 6, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>
                  Nhận DJ
                </button>
              )}
            </div>
          </div>
          {upcoming.length === 0 ? (
            <div style={{ fontSize: 12, color: T.faint, padding: '8px 0' }}>{current ? 'Hết hàng đợi sau bài này · dán link để tiếp.' : 'Chưa có bài nào.'}</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{upcoming.map((item, index) => row(item, { upcoming: true, index }))}</ul>
          )}
        </div>

        {played.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowPlayed((v) => !v)} style={{ background: 'transparent', border: 'none', color: T.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              Đã phát ({played.length}) {showPlayed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showPlayed && <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{played.map((item, index) => row(item, { upcoming: false, index }))}</ul>}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${T.line}`, padding: '10px 14px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {(isDj || isManager) && (
          <button type="button" onClick={onEnd} style={{ ...iconButton, width: 'auto', padding: '0 12px', gap: 6, fontSize: 12, color: '#FCA5A5', borderColor: '#7F1D1D' }}>
            <X size={14} /> Tắt nhạc cả phòng
          </button>
        )}
        {!isDj && (
          <button type="button" onClick={onLeave} style={{ ...iconButton, width: 'auto', padding: '0 12px', fontSize: 12, color: T.muted }}>
            Rời phiên nghe
          </button>
        )}
      </div>
    </section>
  );
}
