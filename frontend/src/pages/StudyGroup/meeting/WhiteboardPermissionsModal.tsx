import { useState } from 'react';
import { Crown, Shield, ShieldOff, Users, X } from 'lucide-react';
import type { StudyRoomMember } from '../../../lib/studyRoom.types';
import { canActOn, RoomRank, ROOM_RANK_LABEL } from '../../../lib/roomPermissions';
import { getDisplayName } from '../../../utils/userDisplay';

interface WhiteboardPermissionsModalProps {
  isOpen: boolean;
  members: StudyRoomMember[];
  currentUserId: string | null;
  myRank: RoomRank;
  rankOf: (userId: string) => RoomRank;
  pendingUserId: string | null;
  error: string | null;
  onClose: () => void;
  onRoleChange: (userId: string, role: 'editor' | 'participant') => Promise<void>;
  onTransferHost: (userId: string) => Promise<void>;
}

const RANK_COLOR: Record<RoomRank, string> = {
  [RoomRank.NONE]: '#94A3B8',
  [RoomRank.PARTICIPANT]: '#94A3B8',
  [RoomRank.EDITOR]: '#93C5FD',
  [RoomRank.GROUP_MODERATOR]: '#C4B5FD',
  [RoomRank.HOST]: '#FCD34D',
  [RoomRank.OWNER]: '#FCA5A5',
};

/**
 * "Quyền trong phòng": who may draw, and who hosts the room. Rows are ordered by rank and every
 * control follows the backend rule (lib/roomPermissions.ts): you can only change people ranked
 * strictly below you. Owner / host / group moderators always draw, so they get no toggle.
 */
export function WhiteboardPermissionsModal({
  isOpen,
  members,
  currentUserId,
  myRank,
  rankOf,
  pendingUserId,
  error,
  onClose,
  onRoleChange,
  onTransferHost,
}: WhiteboardPermissionsModalProps) {
  const [confirmHostUserId, setConfirmHostUserId] = useState<string | null>(null);
  if (!isOpen) return null;

  const canTransferHost = myRank >= RoomRank.HOST;
  const busy = pendingUserId !== null;
  const activeMembers = members
    .filter((member) => !member.left_at)
    .map((member) => ({ member, rank: rankOf(member.user_id) }))
    .sort((a, b) => b.rank - a.rank);

  const close = () => {
    if (busy) return;
    setConfirmHostUserId(null);
    onClose();
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(2, 6, 23, 0.72)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whiteboard-permissions-title"
        style={{ width: 'min(480px, 100%)', maxHeight: 'min(640px, 90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1E293B', border: '1px solid #475569', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid #334155' }}>
          <div>
            <h2 id="whiteboard-permissions-title" style={{ margin: 0, color: 'white', fontSize: 16 }}>Quyền trong phòng</h2>
            <p style={{ margin: '5px 0 0', color: '#94A3B8', fontSize: 12, lineHeight: 1.5 }}>
              Cho phép thành viên vẽ bảng và điều khiển slide.{canTransferHost ? ' Bạn cũng có thể trao quyền chủ phòng.' : ''}
            </p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Đóng" style={{ display: 'flex', padding: 6, border: 0, borderRadius: 6, background: 'transparent', color: '#94A3B8', cursor: busy ? 'not-allowed' : 'pointer' }}>
            <X size={18} />
          </button>
        </header>

        {error && <div role="alert" style={{ margin: '12px 16px 0', padding: '9px 11px', borderRadius: 8, background: '#450A0A', border: '1px solid #7F1D1D', color: '#FCA5A5', fontSize: 12 }}>{error}</div>}

        <div style={{ overflowY: 'auto', padding: 12 }}>
          {activeMembers.length === 0 ? (
            <div style={{ padding: 20, color: '#94A3B8', textAlign: 'center', fontSize: 13 }}>Chưa có thành viên đang ở trong phòng.</div>
          ) : activeMembers.map(({ member, rank }) => {
            const isSelf = member.user_id === currentUserId;
            const isEditor = rank === RoomRank.EDITOR;
            const alwaysDraws = rank >= RoomRank.GROUP_MODERATOR;
            const canToggleDraw = !alwaysDraws && canActOn(myRank, rank);
            const canMakeHost = canTransferHost && !isSelf && rank !== RoomRank.HOST && rank !== RoomRank.NONE;
            const isPending = pendingUserId === member.user_id;
            const isConfirmingHost = confirmHostUserId === member.user_id;
            const displayName = getDisplayName(member.user);
            const drawLabel = alwaysDraws ? 'Luôn được vẽ' : isEditor ? 'Được phép vẽ' : 'Chỉ xem bảng';
            return (
              <div key={member.id} style={{ padding: '10px 8px', borderBottom: '1px solid #334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {member.user.avatar_url ? (
                      <img src={member.user.avatar_url} alt="" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#334155', color: 'white', fontWeight: 700, fontSize: 13 }}>
                        {(displayName.trim()[0] || '?').toUpperCase()}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', color: 'white', fontSize: 13, fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}{isSelf ? ' (Bạn)' : ''}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ color: RANK_COLOR[rank], fontWeight: 700 }}>{ROOM_RANK_LABEL[rank]}</span>
                        <span style={{ color: '#64748B' }}>·</span>
                        <span style={{ color: alwaysDraws || isEditor ? '#93C5FD' : '#94A3B8' }}>{drawLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {canMakeHost && !isConfirmingHost && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmHostUserId(member.user_id)}
                        title="Trao quyền chủ phòng cho người này"
                        aria-label={`Trao quyền chủ phòng cho ${displayName}`}
                        style={{ display: 'flex', alignItems: 'center', padding: 7, border: '1px solid #475569', borderRadius: 7, background: 'transparent', color: '#FCD34D', cursor: busy ? 'not-allowed' : 'pointer' }}
                      >
                        <Crown size={13} />
                      </button>
                    )}
                    {canToggleDraw && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void onRoleChange(member.user_id, isEditor ? 'participant' : 'editor').catch(() => undefined);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 9px', border: `1px solid ${isEditor ? '#475569' : '#1D4ED8'}`, borderRadius: 7, background: isEditor ? '#334155' : '#1D4ED8', color: 'white', fontSize: 11, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: isPending ? 0.65 : 1 }}
                      >
                        {isEditor ? <ShieldOff size={13} /> : <Shield size={13} />}
                        {isPending ? 'Đang lưu…' : isEditor ? 'Thu hồi' : 'Cho phép vẽ'}
                      </button>
                    )}
                  </div>
                </div>

                {isConfirmingHost && (
                  <div role="group" aria-label="Xác nhận trao quyền chủ phòng" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#0F172A', border: '1px solid #854D0E', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: '#FDE68A', fontSize: 12, lineHeight: 1.4 }}>
                      Trao quyền chủ phòng cho <b>{displayName}</b>?{myRank === RoomRank.HOST ? ' Bạn sẽ trở thành thành viên thường.' : ''}
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" disabled={busy} onClick={() => setConfirmHostUserId(null)} style={{ padding: '6px 10px', border: '1px solid #475569', borderRadius: 6, background: 'transparent', color: '#CBD5E1', fontSize: 11, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                        Hủy
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void onTransferHost(member.user_id).then(() => setConfirmHostUserId(null)).catch(() => undefined);
                        }}
                        style={{ padding: '6px 10px', border: 0, borderRadius: 6, background: '#CA8A04', color: 'white', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
                      >
                        {isPending ? 'Đang chuyển…' : 'Xác nhận'}
                      </button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <footer style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '12px 18px', borderTop: '1px solid #334155', color: '#94A3B8', fontSize: 11, lineHeight: 1.5 }}>
          <Users size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Trưởng nhóm › Chủ phòng › Điều hành viên › Thành viên. Bạn chỉ thay đổi được quyền của người có vai trò thấp hơn mình.</span>
        </footer>
      </section>
    </div>
  );
}
