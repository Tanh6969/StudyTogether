import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Globe,
  ImageIcon,
  Lock,
  Settings,
  Shield,
  ShieldOff,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { removeGroupBackground, updateGroup, uploadGroupBackground } from '../../lib/group.api';
import type { Group, GroupMember } from '../../lib/group.types';
import { getDisplayName } from '../../utils/userDisplay';

export interface GroupSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
  onUpdated: (updated: Group) => void;
  members: GroupMember[];
  /** Group details are owner-only; moderators can change only the background image. */
  isOwner: boolean;
  pendingMemberId: string | null;
  memberActionError: string | null;
  onPromote: (member: GroupMember) => void;
  onDemote: (member: GroupMember) => void;
}

type SettingsTab = 'overview' | 'members' | 'appearance';

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
  { id: 'overview', label: 'Tổng quan', icon: Settings },
  { id: 'members', label: 'Thành viên & vai trò', icon: UsersRound },
  { id: 'appearance', label: 'Giao diện', icon: ImageIcon },
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

export function GroupSettingsModal({
  isOpen,
  onClose,
  group,
  onUpdated,
  members,
  isOwner,
  pendingMemberId,
  memberActionError,
  onPromote,
  onDemote,
}: GroupSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [isPublic, setIsPublic] = useState(group.is_public);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('overview');
    setName(group.name);
    setDescription(group.description ?? '');
    setIsPublic(group.is_public);
    setSaving(false);
    setError(null);
    setSuccess(false);
    setBackgroundBusy(false);
    setBackgroundError(null);
  }, [isOpen, group]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !backgroundBusy && pendingMemberId === null) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, saving, backgroundBusy, pendingMemberId, onClose]);

  if (!isOpen) return null;

  const activeMembers = members.filter((member) => member.status === 'active');
  const trimmedName = name.trim();
  const busy = saving || backgroundBusy || pendingMemberId !== null;

  const handleSave = async () => {
    if (saving) return;
    if (!trimmedName) {
      setError('Tên nhóm không được để trống');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateGroup(group.id, {
        name: trimmedName,
        description: description.trim() || null,
        is_public: isPublic,
      });
      onUpdated(updated);
      setSuccess(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleBackgroundFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const updated = await uploadGroupBackground(group.id, file);
      onUpdated(updated);
    } catch (err) {
      setBackgroundError(errorMessage(err));
    } finally {
      setBackgroundBusy(false);
    }
  };

  const handleRemoveBackground = async () => {
    if (backgroundBusy) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const updated = await removeGroupBackground(group.id);
      onUpdated(updated);
    } catch (err) {
      setBackgroundError(errorMessage(err));
    } finally {
      setBackgroundBusy(false);
    }
  };

  const visibilityButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '11px 14px',
    borderRadius: 8,
    border: `1px solid ${active ? '#4F46E5' : '#E2E8F0'}`,
    background: active ? '#EEF2FF' : 'white',
    color: active ? '#4338CA' : '#64748B',
    fontWeight: 600,
    fontSize: 13,
    cursor: saving || !isOwner ? 'not-allowed' : 'pointer',
  });

  const sectionTitle = (title: string, subtitle: string) => (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: 0, color: '#0F172A', fontSize: 20, fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: '7px 0 0', color: '#64748B', fontSize: 13, lineHeight: 1.55 }}>{subtitle}</p>
    </div>
  );

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(15, 23, 42, 0.68)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
        style={{
          width: 'min(960px, 96vw)',
          height: 'min(700px, 92vh)',
          display: 'flex',
          overflow: 'hidden',
          background: 'white',
          borderRadius: 14,
          boxShadow: '0 24px 70px rgba(2, 6, 23, 0.35)',
        }}
      >
        <nav
          aria-label="Danh mục cài đặt nhóm"
          style={{
            width: 232,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 14px',
            background: '#F8FAFC',
            borderRight: '1px solid #E2E8F0',
          }}
        >
          <div style={{ padding: '0 10px 24px' }}>
            <div style={{ color: '#64748B', fontSize: 10, fontWeight: 800, letterSpacing: 1.1 }}>CÀI ĐẶT NHÓM</div>
            <div style={{ marginTop: 7, color: '#0F172A', fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</div>
          </div>
          <div role="tablist" aria-orientation="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {TABS.map(({ id, label, icon: Icon }) => {
              const selected = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`group-settings-tab-${id}`}
                  aria-selected={selected}
                  aria-controls="group-settings-panel"
                  onClick={() => setActiveTab(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 12px',
                    border: 0,
                    borderRadius: 8,
                    background: selected ? '#E0E7FF' : 'transparent',
                    color: selected ? '#3730A3' : '#475569',
                    fontSize: 13,
                    fontWeight: selected ? 700 : 550,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={16} /> {label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', padding: '14px 10px 0', color: '#94A3B8', fontSize: 11, lineHeight: 1.5 }}>
            Quyền truy cập được áp dụng theo vai trò của từng thành viên.
          </div>
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 28px', borderBottom: '1px solid #E2E8F0' }}>
            <div>
              <h2 id="group-settings-title" style={{ margin: 0, color: '#0F172A', fontSize: 18, fontWeight: 700 }}>Cài đặt nhóm học</h2>
              <div style={{ marginTop: 4, color: '#64748B', fontSize: 12 }}>{TABS.find((tab) => tab.id === activeTab)?.label}</div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Đóng cài đặt" style={{ display: 'flex', padding: 8, border: 0, borderRadius: 7, background: 'transparent', color: '#64748B', cursor: busy ? 'not-allowed' : 'pointer' }}>
              <X size={20} />
            </button>
          </header>

          <div
            id="group-settings-panel"
            role="tabpanel"
            aria-labelledby={`group-settings-tab-${activeTab}`}
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 34px' }}
          >
            {activeTab === 'overview' && (
              <div style={{ maxWidth: 640 }}>
                {sectionTitle('Tổng quan nhóm', 'Quản lý thông tin cơ bản và khả năng tìm thấy nhóm của bạn.')}
                {!isOwner && (
                  <div style={{ marginBottom: 18, padding: '11px 13px', borderRadius: 8, background: '#F8FAFC', color: '#64748B', fontSize: 12 }}>
                    Chỉ trưởng nhóm mới có thể chỉnh sửa thông tin và chế độ hiển thị.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 20 }}>
                  <label htmlFor="group-settings-name" style={{ color: '#0F172A', fontSize: 13, fontWeight: 650 }}>Tên nhóm *</label>
                  <input
                    id="group-settings-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving || !isOwner}
                    maxLength={100}
                    style={{ padding: '11px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 22 }}>
                  <label htmlFor="group-settings-description" style={{ color: '#0F172A', fontSize: 13, fontWeight: 650 }}>Mô tả</label>
                  <textarea
                    id="group-settings-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={saving || !isOwner}
                    placeholder="Mô tả ngắn về nhóm học (không bắt buộc)"
                    style={{ padding: '11px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, outline: 'none', resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ color: '#0F172A', fontSize: 13, fontWeight: 650 }}>Chế độ hiển thị</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" onClick={() => isOwner && !saving && setIsPublic(true)} disabled={saving || !isOwner} style={visibilityButtonStyle(isPublic)}>
                      <Globe size={16} /> Công khai
                    </button>
                    <button type="button" onClick={() => isOwner && !saving && setIsPublic(false)} disabled={saving || !isOwner} style={visibilityButtonStyle(!isPublic)}>
                      <Lock size={16} /> Riêng tư
                    </button>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.5 }}>
                    {isPublic ? 'Nhóm công khai có thể được tìm thấy và xem thông tin cơ bản.' : 'Nhóm riêng tư không xuất hiện trong danh sách khám phá.'}
                  </div>
                </div>
                {error && <div role="alert" style={{ marginTop: 18, color: '#DC2626', fontSize: 13 }}>{error}</div>}
                {success && !error && <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, color: '#16A34A', fontSize: 13 }}><Check size={15} /> Đã lưu thay đổi</div>}
              </div>
            )}

            {activeTab === 'members' && (
              <div style={{ maxWidth: 700 }}>
                {sectionTitle('Thành viên & vai trò', 'Chọn những thành viên đáng tin cậy để hỗ trợ điều hành nhóm.')}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, marginBottom: 18, borderRadius: 9, background: '#F5F3FF', color: '#5B21B6', fontSize: 12, lineHeight: 1.55 }}>
                  <Shield size={18} style={{ flexShrink: 0 }} />
                  <span><b>Điều hành viên</b> có thể mời thành viên, quản lý kênh và phòng học, và thay hình nền. Chỉ trưởng nhóm được thay đổi vai trò hoặc xóa thành viên.</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeMembers.map((member) => {
                    const isPending = pendingMemberId === member.id;
                    const displayName = getDisplayName(member.user);
                    return (
                      <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '11px 12px', border: '1px solid #E2E8F0', borderRadius: 9 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                          {member.user.avatar_url ? (
                            <img src={member.user.avatar_url} alt="" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div aria-hidden="true" style={{ width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: '#E2E8F0', color: '#475569', fontWeight: 700, fontSize: 13 }}>
                              {(displayName.trim()[0] || '?').toUpperCase()}
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: '#0F172A', fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                            <div style={{ marginTop: 3, color: member.role === 'moderator' ? '#6D28D9' : '#64748B', fontSize: 11 }}>
                              {member.role === 'owner' ? 'Trưởng nhóm' : member.role === 'moderator' ? 'Điều hành viên' : 'Thành viên'}
                            </div>
                          </div>
                        </div>
                        {isOwner && member.role !== 'owner' && (
                          <button
                            type="button"
                            onClick={() => member.role === 'moderator' ? onDemote(member) : onPromote(member)}
                            disabled={isPending || pendingMemberId !== null}
                            title={member.role === 'moderator' ? 'Hạ xuống thành viên' : 'Cấp quyền điều hành viên'}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '8px 10px', border: '1px solid #DDD6FE', borderRadius: 7, background: 'white', color: '#6D28D9', fontSize: 12, fontWeight: 650, cursor: pendingMemberId !== null ? 'not-allowed' : 'pointer', opacity: isPending ? 0.6 : 1 }}
                          >
                            {member.role === 'moderator' ? <ShieldOff size={14} /> : <Shield size={14} />}
                            {isPending ? 'Đang lưu…' : member.role === 'moderator' ? 'Thu hồi quyền' : 'Cấp moderator'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {activeMembers.length === 0 && <div style={{ padding: 20, border: '1px dashed #CBD5E1', borderRadius: 9, color: '#94A3B8', textAlign: 'center', fontSize: 13 }}>Chưa có thành viên trong nhóm.</div>}
                </div>
                {!isOwner && <div style={{ marginTop: 14, color: '#94A3B8', fontSize: 12 }}>Chỉ trưởng nhóm mới có thể cấp hoặc thu hồi quyền moderator.</div>}
                {memberActionError && <div role="alert" style={{ marginTop: 14, color: '#DC2626', fontSize: 13 }}>{memberActionError}</div>}
              </div>
            )}

            {activeTab === 'appearance' && (
              <div style={{ maxWidth: 640 }}>
                {sectionTitle('Giao diện nhóm', 'Tùy chỉnh hình nền để nhóm học có dấu ấn riêng.')}
                <div style={{ marginBottom: 9, color: '#0F172A', fontSize: 13, fontWeight: 650 }}>Hình nền nhóm</div>
                <div style={{ height: 220, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E2E8F0', borderRadius: 10, background: group.background_url ? '#E2E8F0' : '#F1F5F9' }}>
                  {group.background_url ? <img src={group.background_url} alt="Hình nền nhóm" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={34} color="#94A3B8" />}
                </div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleBackgroundFileChange} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={backgroundBusy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 13px', border: '1px solid #CBD5E1', borderRadius: 8, background: 'white', color: '#334155', fontWeight: 650, fontSize: 12, cursor: backgroundBusy ? 'not-allowed' : 'pointer' }}>
                    <Upload size={15} /> {backgroundBusy ? 'Đang tải lên...' : 'Tải ảnh lên'}
                  </button>
                  {group.background_url && (
                    <button type="button" onClick={handleRemoveBackground} disabled={backgroundBusy} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 13px', border: '1px solid #FECACA', borderRadius: 8, background: 'white', color: '#DC2626', fontWeight: 650, fontSize: 12, cursor: backgroundBusy ? 'not-allowed' : 'pointer' }}>
                      <Trash2 size={15} /> Xóa hình nền
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 10, color: '#94A3B8', fontSize: 12, lineHeight: 1.5 }}>
                  Trưởng nhóm và điều hành viên được thay đổi hình nền. Hỗ trợ JPEG, PNG, WebP hoặc GIF, tối đa 5 MB.
                </div>
                {backgroundError && <div role="alert" style={{ marginTop: 12, color: '#DC2626', fontSize: 13 }}>{backgroundError}</div>}
              </div>
            )}
          </div>

          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '14px 28px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
            <button type="button" onClick={onClose} disabled={busy} style={{ padding: '9px 14px', border: '1px solid #CBD5E1', borderRadius: 8, background: 'white', color: '#475569', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
              Đóng
            </button>
            {activeTab === 'overview' && isOwner && (
              <button type="button" onClick={handleSave} disabled={saving || !trimmedName} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', border: 0, borderRadius: 8, background: saving || !trimmedName ? '#94A3B8' : '#4F46E5', color: 'white', fontSize: 13, fontWeight: 650, cursor: saving || !trimmedName ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>,
    document.body
  );
}
