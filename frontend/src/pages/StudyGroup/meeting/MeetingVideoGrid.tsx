import { useEffect, useMemo, useState } from 'react';
import { FramedAvatar } from '../../../components/ui/FramedAvatar';
import type { ReactNode } from 'react';
import { Track } from 'livekit-client';
import { isTrackReference, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { AlertTriangle, Loader2, Mic, MicOff, ScreenShare, VideoOff, MoreVertical, UserX } from 'lucide-react';
import type { StudyRoomMember } from '../../../lib/studyRoom.types';
import { getAvatarColor, getAvatarInitials } from '../../../utils/avatarUtils';
import { getDisplayName } from '../../../utils/userDisplay';
import { useMeetingContext } from './MeetingContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { canActOn, RoomRank } from '../../../lib/roomPermissions';

interface MeetingStatusMessageProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

function MeetingStatusMessage({ icon, title, subtitle, action }: MeetingStatusMessageProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#94A3B8', textAlign: 'center', padding: 24 }}>
      {icon}
      <div style={{ color: 'white', fontSize: 15, fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, maxWidth: 420 }}>{subtitle}</div>}
      {action && (
        <button
          onClick={action.onClick}
          style={{ marginTop: 4, background: '#2563EB', border: 'none', color: 'white', padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

interface MeetingVideoGridProps {
  members: StudyRoomMember[];
  currentUserId: string | null;
  currentUserName: string;
  currentUserAvatarUrl?: string | null;
  /** Set when the meeting is known to be unavailable without asking the backend (room ended) --
   * a UX shortcut only; the backend still independently rejects the token request either way. */
  unavailableReason?: string;
  onRetryMembership?: () => void;
  /** UI permission hints; the API re-verifies rank and current room membership. */
  rankOf?: (userId: string) => RoomRank;
  onModerate?: (userId: string, action: 'mute' | 'kick') => Promise<void>;
}

export function MeetingVideoGrid({ members, currentUserId, currentUserName, currentUserAvatarUrl, unavailableReason, onRetryMembership, rankOf, onModerate }: MeetingVideoGridProps) {
  const { status, error, retry, connected, liveKitError, transferred } = useMeetingContext();

  if (transferred) {
    return <MeetingStatusMessage
      icon={<AlertTriangle size={32} color="#FBBF24" />}
      title="Cuộc gọi đã chuyển sang tab hoặc thiết bị khác"
      subtitle="Phiên này đã kết thúc. Bạn có thể quay về nhóm và chủ động tham gia lại nếu muốn chuyển cuộc gọi về đây."
    />;
  }

  if (unavailableReason) {
    return <MeetingStatusMessage icon={<VideoOff size={32} />} title={unavailableReason} />;
  }

  if (status === 'idle') {
    return <MeetingStatusMessage
      icon={<AlertTriangle size={32} color="#FBBF24" />}
      title="Chưa thể bắt đầu cuộc gọi"
      subtitle="Chưa xác nhận được bạn đang tham gia phòng học. Hãy kiểm tra lại tư cách thành viên."
      action={onRetryMembership ? { label: 'Kiểm tra lại', onClick: onRetryMembership } : undefined}
    />;
  }

  if (status === 'loading') {
    return <MeetingStatusMessage icon={<Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />} title="Đang xin quyền kết nối cuộc gọi..." />;
  }

  if (status === 'error') {
    return (
      <MeetingStatusMessage
        icon={<AlertTriangle size={32} color="#F87171" />}
        title="Không thể kết nối cuộc gọi"
        subtitle={error?.message}
        action={{ label: 'Thử lại', onClick: retry }}
      />
    );
  }

  if (liveKitError) {
    return (
      <MeetingStatusMessage
        icon={<AlertTriangle size={32} color="#F87171" />}
        title="Không thể kết nối máy chủ video"
        subtitle={liveKitError.message || 'Lỗi LiveKit. Vui lòng kiểm tra cấu hình hoặc kết nối mạng.'}
        action={{ label: 'Kết nối lại', onClick: retry }}
      />
    );
  }

  if (!connected) {
    return <MeetingStatusMessage icon={<Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />} title="Đang thiết lập kết nối..." />;
  }

  return (
    <ConnectedGrid
      members={members}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      currentUserAvatarUrl={currentUserAvatarUrl}
      rankOf={rankOf}
      onModerate={onModerate}
    />
  );
}

function ConnectedGrid({ members, currentUserId, currentUserName, currentUserAvatarUrl, rankOf, onModerate }: Omit<MeetingVideoGridProps, 'unavailableReason'>) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  const participants = useParticipants();
  const cameraTrackRefs = useTracks([Track.Source.Camera], { onlySubscribed: false });
  // Screen-share tracks are identified via LiveKit's own `Track.Source.ScreenShare`, never by
  // guessing from track/participant shape -- a participant can have both a camera track and a
  // screen-share track published at the same time, and this keeps the two from colliding.
  const screenShareTrackRefs = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });

  const cameraTrackByIdentity = useMemo(() => {
    const map = new Map<string, TrackReference>();
    for (const trackRef of cameraTrackRefs) {
      if (isTrackReference(trackRef)) map.set(trackRef.participant.identity, trackRef);
    }
    return map;
  }, [cameraTrackRefs]);

  const activeScreenShares = useMemo(
    () => screenShareTrackRefs.filter((trackRef): trackRef is TrackReference => isTrackReference(trackRef) && !trackRef.publication.isMuted),
    [screenShareTrackRefs]
  );

  const memberByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const participantByIdentity = useMemo(() => new Map(participants.map((p) => [p.identity, p])), [participants]);
  const selectedParticipant = selectedId ? participantByIdentity.get(selectedId) : null;
  const selectedMember = selectedId ? memberByUserId.get(selectedId) : null;
  const canModerateSelected = !!selectedMember && !selectedMember.left_at && !!selectedId && selectedId !== currentUserId && !!rankOf && !!currentUserId && canActOn(rankOf(currentUserId), rankOf(selectedId));
  useEffect(() => {
    if (!selectedId || busy) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedId(null); setConfirmKick(false); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [selectedId, busy]);
  useEffect(() => {
    if (selectedId && (!selectedParticipant || !canModerateSelected) && !busy) {
      setSelectedId(null);
      setConfirmKick(false);
    }
  }, [selectedId, selectedParticipant, canModerateSelected, busy]);

  const runModeration = async (action: 'mute' | 'kick') => {
    if (!selectedId || !canModerateSelected || !onModerate || busy) return;
    setBusy(true);
    setModerationError(null);
    try {
      await onModerate(selectedId, action);
      setModerationNotice(action === 'kick' ? 'Đã mời thành viên rời khỏi cuộc gọi.' : 'Đã gửi lệnh tắt micro.');
      setSelectedId(null);
      setConfirmKick(false);
    } catch (error) {
      setModerationError(error instanceof Error ? error.message : 'Không thể thực hiện thao tác. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };
  const nameForIdentity = (identity: string) => {
    if (identity === currentUserId) return `${currentUserName} (Bạn)`;
    const member = memberByUserId.get(identity);
    if (member) return getDisplayName(member.user);
    return participantByIdentity.get(identity)?.name || 'Người dùng';
  };

  if (participants.length === 0) {
    return <MeetingStatusMessage icon={<Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />} title="Đang tham gia cuộc gọi..." />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      {activeScreenShares.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: activeScreenShares.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 16 }}>
          {activeScreenShares.map((trackRef) => (
            <div
              key={trackRef.publication.trackSid}
              style={{
                position: 'relative',
                aspectRatio: '16/9',
                background: '#000',
                borderRadius: 16,
                border: '2px solid #2563EB',
                boxShadow: '0 0 16px rgba(37, 99, 235, 0.35)',
                overflow: 'hidden',
              }}
            >
              <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(37, 99, 235, 0.9)', padding: '4px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'white', fontSize: 12, fontWeight: '600' }}>
                <ScreenShare size={14} />
                <span>{nameForIdentity(trackRef.participant.identity)} đang chia sẻ màn hình</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'grid',
          // Phones: a single tile fills the width; otherwise 2 columns (3 would be thumbnails).
          gridTemplateColumns: isMobile
            ? (participants.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr')
            : participants.length > 4 ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
          gap: isMobile ? 8 : 16,
          minWidth: 0,
          alignContent: 'start',
        }}
      >
      {participants.map((p) => {
        const isSelf = p.identity === currentUserId;
        const member = memberByUserId.get(p.identity);
        // Prefer the real Study Room member's profile (fresh, from the members API) over
        // the LiveKit-embedded `p.name` (only set once, at token creation -- see
        // study_room_router.create_meeting_token); `p.name` is a fallback for the rare case
        // where this participant isn't in our current members list (e.g. a race between
        // joining the call and the member roster refreshing), never a raw UUID fragment.
        const name = isSelf
          ? `${currentUserName} (Bạn)`
          : member
            ? getDisplayName(member.user)
            : p.name || 'Người dùng';
        const initial = getAvatarInitials(name);
        const color = getAvatarColor(name);
        const avatarUrl = isSelf ? currentUserAvatarUrl ?? null : member?.user.avatar_url ?? null;
        const cameraTrackRef = cameraTrackByIdentity.get(p.identity);
        const isCameraOn = !!cameraTrackRef && !cameraTrackRef.publication.isMuted;
        const isMicOn = p.isMicrophoneEnabled;
        const isHost = member?.role === 'host';
        const showModeration = !isSelf && !!member && !member.left_at && !!onModerate && !!rankOf && !!currentUserId && canActOn(rankOf(currentUserId), rankOf(p.identity));

        return (
          <div
            key={p.identity}
            style={{
              position: 'relative',
              aspectRatio: '16/9',
              background: isCameraOn ? '#334155' : '#1E293B',
              borderRadius: 16,
              border: p.isSpeaking ? '3px solid #10B981' : '1px solid #334155',
              boxShadow: p.isSpeaking ? '0 0 15px rgba(16, 185, 129, 0.4)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              transition: 'all 0.3s',
            }}
          >
            {isCameraOn && cameraTrackRef ? (
              <VideoTrack
                trackRef={cameraTrackRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: isSelf ? 'scaleX(-1)' : undefined }}
              />
            ) : (
              <FramedAvatar size={80} initials={initial} color={color} avatarUrl={avatarUrl} frame={member?.user.avatar_frame ?? null} alt={name} />
            )}

            <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', padding: '4px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, color: 'white', fontSize: 13, fontWeight: '500' }}>
              <span>{name}</span>
              {isHost && <span style={{ background: '#3B82F6', color: 'white', fontSize: 10, fontWeight: '700', padding: '2px 6px', borderRadius: 4 }}>HOST</span>}
            </div>

            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ background: isMicOn ? '#10B981' : '#EF4444', color: 'white', padding: 6, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isMicOn ? <Mic size={16} /> : <MicOff size={16} />}
              </div>
              {showModeration && (
                <button type="button" aria-label={`Điều hành ${name}`} title={`Điều hành ${name}`}
                  onClick={() => { setSelectedId(p.identity); setConfirmKick(false); setModerationError(null); setModerationNotice(null); }}
                  style={{ display: 'flex', padding: 7, border: '1px solid #64748B', borderRadius: 8, background: '#1E293B', color: 'white', cursor: 'pointer' }}>
                  <MoreVertical size={17} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>
      {moderationNotice && (
        <div role="status" style={{ color: '#BBF7D0', fontSize: 13, padding: 8 }}>
          {moderationNotice}
          <button type="button" onClick={() => setModerationNotice(null)} aria-label="Đóng thông báo" style={{ marginLeft: 12, color: 'white', background: 'none', border: 0, cursor: 'pointer' }}>×</button>
        </div>
      )}
      {selectedParticipant && canModerateSelected && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelectedId(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2, 6, 23, 0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-label="Điều hành thành viên" style={{ width: '100%', maxWidth: 380, background: '#1E293B', color: 'white', border: '1px solid #475569', padding: 20, borderRadius: 14, boxShadow: '0 16px 45px #020617' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>
              {confirmKick ? 'Xác nhận mời ra khỏi phòng' : 'Điều hành thành viên'}
            </div>
            <p style={{ color: '#CBD5E1', fontSize: 14, margin: '0 0 16px' }}>
              {nameForIdentity(selectedParticipant.identity)}
              {confirmKick ? ' sẽ bị ngắt khỏi cuộc gọi ngay lập tức.' : ' — thao tác chỉ áp dụng trong phòng học hiện tại.'}
            </p>
            {moderationError && <p role="alert" style={{ color: '#FCA5A5', fontSize: 13 }}>{moderationError}</p>}
            {confirmKick ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => setConfirmKick(false)} style={moderationButtonStyle}>Quay lại</button>
                <button type="button" disabled={busy} onClick={() => void runModeration('kick')} style={{ ...moderationButtonStyle, background: '#B91C1C' }}>{busy ? 'Đang xử lý…' : 'Mời ra khỏi phòng'}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <button type="button" disabled={busy || !selectedParticipant.isMicrophoneEnabled} onClick={() => void runModeration('mute')} style={{ ...moderationButtonStyle, opacity: selectedParticipant.isMicrophoneEnabled ? 1 : 0.55 }}>
                  <MicOff size={16} /> {selectedParticipant.isMicrophoneEnabled ? 'Tắt micro của thành viên' : 'Micro đang tắt'}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmKick(true)} style={{ ...moderationButtonStyle, background: '#7F1D1D' }}><UserX size={16} /> Mời ra khỏi phòng</button>
                <button type="button" disabled={busy} onClick={() => setSelectedId(null)} style={{ ...moderationButtonStyle, background: 'transparent' }}>Đóng</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const moderationButtonStyle = { display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: 8, border: '1px solid #475569', background: '#334155', color: 'white', padding: '11px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const;
