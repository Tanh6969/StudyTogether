import { useMemo, useState } from 'react';
import { Crown, Search, X } from 'lucide-react';
import type { GroupMember } from '../../lib/group.types';
import { getAvatarColor, getAvatarInitials } from '../../utils/avatarUtils';
import { getDisplayName } from '../../utils/userDisplay';
import { FramedAvatar } from '../ui/FramedAvatar';

interface OwnerLeaveModalProps {
  groupName: string;
  /** Active members other than the owner. */
  candidates: GroupMember[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (successorId: string) => void;
  /** Only offered when there is nobody to hand the group to. */
  onDeleteGroup: () => void;
}

/**
 * The owner cannot just walk away: the backend answers a plain leave with 409. They pick who
 * becomes the new owner (moderators listed first, since they already help run the group), or,
 * when they are the last member, leaving means deleting the group.
 */
export function OwnerLeaveModal({ groupName, candidates, pending, error, onCancel, onConfirm, onDeleteGroup }: OwnerLeaveModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((m) => !q || getDisplayName(m.user).toLowerCase().includes(q) || (m.user.username ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'moderator' ? -1 : 1;
        return getDisplayName(a.user).localeCompare(getDisplayName(b.user), 'vi');
      });
  }, [candidates, query]);
  const selected = candidates.find((m) => m.user_id === selectedId) ?? null;
  const isLastMember = candidates.length === 0;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 16 }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-leave-title"
        style={{ background: 'white', borderRadius: 12, width: 'min(460px, 100%)', maxHeight: 'min(640px, 92vh)', display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)', fontFamily: 'Inter' }}
      >
        <button
          type="button"
          aria-label="Đóng"
          onClick={() => { if (!pending) onCancel(); }}
          disabled={pending}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: pending ? 'not-allowed' : 'pointer', color: '#64748B' }}
        >
          <X size={18} />
        </button>

        <div style={{ padding: '28px 28px 0' }}>
          <h2 id="owner-leave-title" style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', margin: '0 0 8px', paddingRight: 24 }}>
            Rời nhóm "{groupName}"
          </h2>
          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, margin: 0 }}>
            {isLastMember
              ? 'Bạn là thành viên duy nhất của nhóm nên không có ai để nhận quyền trưởng nhóm. Rời nhóm đồng nghĩa với xóa nhóm.'
              : 'Bạn đang là trưởng nhóm. Hãy chọn người sẽ làm trưởng nhóm mới trước khi rời.'}
          </p>
        </div>

        {!isLastMember && (
          <>
            {candidates.length > 6 && (
              <label style={{ margin: '16px 28px 0', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 8 }}>
                <Search size={15} color="#94A3B8" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm thành viên"
                  aria-label="Tìm thành viên"
                  style={{ flex: 1, border: 0, outline: 'none', fontSize: 14, fontFamily: 'inherit' }}
                />
              </label>
            )}
            <div role="radiogroup" aria-label="Trưởng nhóm mới" style={{ margin: '12px 20px 0', overflowY: 'auto', display: 'grid', gap: 4, minHeight: 0 }}>
              {sorted.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Không tìm thấy thành viên phù hợp.</div>
              ) : sorted.map((m) => {
                const name = getDisplayName(m.user);
                const checked = m.user_id === selectedId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={pending}
                    onClick={() => setSelectedId(m.user_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 8px', border: `1px solid ${checked ? '#00236F' : 'transparent'}`, borderRadius: 10, background: checked ? '#EEF2FF' : 'transparent', cursor: pending ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                  >
                    <FramedAvatar size={34} initials={getAvatarInitials(name)} color={getAvatarColor(name)} avatarUrl={m.user.avatar_url} frame={m.user.avatar_frame ?? null} />
                    <span style={{ flex: 1, minWidth: 0, display: 'grid' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 12, color: m.role === 'moderator' ? '#6D28D9' : '#64748B' }}>{m.role === 'moderator' ? 'Điều hành viên' : 'Thành viên'}</span>
                    </span>
                    <span aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', border: `2px solid ${checked ? '#00236F' : '#CBD5E1'}`, display: 'grid', placeItems: 'center' }}>
                      {checked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00236F' }} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div style={{ padding: '16px 28px 28px' }}>
          {selected && (
            <p style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 13, lineHeight: 1.45 }}>
              <Crown size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span><b>{getDisplayName(selected.user)}</b> sẽ trở thành trưởng nhóm. Nếu sau này quay lại, bạn sẽ là thành viên thường.</span>
            </p>
          )}
          {error && (
            <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: pending ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
            >
              Hủy
            </button>
            {isLastMember ? (
              confirmDelete ? (
                <button
                  type="button"
                  onClick={onDeleteGroup}
                  disabled={pending}
                  style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: pending ? '#F1A9A0' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: pending ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {pending ? 'Đang xóa...' : 'Chắc chắn xóa nhóm'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: 'white', color: '#DC2626', border: '1px solid #FCA5A5', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Xóa nhóm
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => selectedId && onConfirm(selectedId)}
                disabled={pending || !selectedId}
                style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: pending || !selectedId ? '#F1A9A0' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: pending || !selectedId ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                {pending ? 'Đang rời nhóm...' : 'Chuyển quyền và rời nhóm'}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
