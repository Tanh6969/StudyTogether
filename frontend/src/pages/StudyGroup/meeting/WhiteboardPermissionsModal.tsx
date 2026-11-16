import { Shield, ShieldOff, Users, X } from 'lucide-react';
import type { StudyRoomMember } from '../../../lib/studyRoom.types';
import { getDisplayName } from '../../../utils/userDisplay';

interface WhiteboardPermissionsModalProps {
  isOpen: boolean;
  members: StudyRoomMember[];
  pendingUserId: string | null;
  error: string | null;
  onClose: () => void;
  onRoleChange: (userId: string, role: 'moderator' | 'participant') => Promise<void>;
}

export function WhiteboardPermissionsModal({
  isOpen,
  members,
  pendingUserId,
  error,
  onClose,
  onRoleChange,
}: WhiteboardPermissionsModalProps) {
  if (!isOpen) return null;

  const activeMembers = members.filter((member) => !member.left_at);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && pendingUserId === null) onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(2, 6, 23, 0.72)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whiteboard-permissions-title"
        style={{ width: 'min(460px, 100%)', maxHeight: 'min(620px, 90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1E293B', border: '1px solid #475569', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid #334155' }}>
          <div>
            <h2 id="whiteboard-permissions-title" style={{ margin: 0, color: 'white', fontSize: 16 }}>Quyền bảng trắng</h2>
            <p style={{ margin: '5px 0 0', color: '#94A3B8', fontSize: 12, lineHeight: 1.5 }}>
              Cấp quyền cho thành viên vẽ và chỉnh sửa bảng. Có thể cấp cho nhiều người.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={pendingUserId !== null} aria-label="Đóng" style={{ display: 'flex', padding: 6, border: 0, borderRadius: 6, background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </header>

        {error && <div role="alert" style={{ margin: '12px 16px 0', padding: '9px 11px', borderRadius: 8, background: '#450A0A', border: '1px solid #7F1D1D', color: '#FCA5A5', fontSize: 12 }}>{error}</div>}

        <div style={{ overflowY: 'auto', padding: 12 }}>
          {activeMembers.length === 0 ? (
            <div style={{ padding: 20, color: '#94A3B8', textAlign: 'center', fontSize: 13 }}>Chưa có thành viên đang ở trong phòng.</div>
          ) : activeMembers.map((member) => {
            const isHost = member.role === 'host';
            const isEditor = member.role === 'moderator';
            const isPending = pendingUserId === member.user_id;
            const displayName = getDisplayName(member.user);
            return (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 8px', borderBottom: '1px solid #334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {member.user.avatar_url ? (
                    <img src={member.user.avatar_url} alt="" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#334155', color: 'white', fontWeight: 700, fontSize: 13 }}>
                      {(displayName.trim()[0] || '?').toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', color: 'white', fontSize: 13, fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                    <div style={{ color: isHost || isEditor ? '#93C5FD' : '#94A3B8', fontSize: 11 }}>
                      {isHost ? 'Chủ phòng · Có quyền vẽ' : isEditor ? 'Được phép vẽ' : 'Chỉ xem bảng'}
                    </div>
                  </div>
                </div>
                {isHost ? (
                  <span style={{ flexShrink: 0, color: '#93C5FD', fontSize: 11, fontWeight: 700 }}>CHỦ PHÒNG</span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingUserId !== null}
                    onClick={() => {
                      void onRoleChange(member.user_id, isEditor ? 'participant' : 'moderator').catch(() => undefined);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '7px 9px', border: `1px solid ${isEditor ? '#475569' : '#1D4ED8'}`, borderRadius: 7, background: isEditor ? '#334155' : '#1D4ED8', color: 'white', fontSize: 11, fontWeight: 600, cursor: pendingUserId !== null ? 'not-allowed' : 'pointer', opacity: isPending ? 0.65 : 1 }}
                  >
                    {isEditor ? <ShieldOff size={13} /> : <Shield size={13} />}
                    {isPending ? 'Đang lưu…' : isEditor ? 'Thu hồi' : 'Cho phép vẽ'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '12px 18px', borderTop: '1px solid #334155', color: '#94A3B8', fontSize: 11 }}>
          <Users size={14} /> Chủ phòng và quản trị viên nhóm luôn có quyền chỉnh sửa.
        </footer>
      </section>
    </div>
  );
}
