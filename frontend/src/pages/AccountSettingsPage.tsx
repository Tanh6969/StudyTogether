import { Award, Bell, Camera, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/auth-context';
import { updateProfile, uploadProfileAvatar } from '../lib/profile.api';
import { NotificationSettingsSection } from '../components/settings/NotificationSettingsSection';
import { RewardsSection } from '../components/settings/RewardsSection';
import {
  SETTINGS_BTN_PRIMARY,
  SETTINGS_BTN_SECONDARY,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SettingsSection,
} from '../components/settings/SettingsSection';
import { supabase } from '../lib/supabase';

const BIO_MAX = 500;

/** Section navigation. Desktop (≥ 1024px): a vertical list in the sticky left column.
 *  Phones/tablets: a row of chips that sticks under the top header. */
const NAV_ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'profile', label: 'Hồ sơ', icon: UserRound },
  { id: 'notifications', label: 'Thông báo', icon: Bell },
  { id: 'rewards', label: 'Phần thưởng', icon: Award },
  { id: 'security', label: 'Bảo mật', icon: ShieldCheck },
];

function formatJoinDate(iso: string | undefined): string {
  if (!iso) return 'Chưa rõ';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Chưa rõ';
  return `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
}

// Tính độ mạnh mật khẩu (0-3)
function getPwStrength(pw: string): number {
  if (pw.length < 6) return 0;
  if (pw.length < 10) return 1;
  if (pw.length < 14) return 2;
  return 3;
}
const STRENGTH_BAR = ['bg-red-500', 'bg-amber-500', 'bg-blue-500', 'bg-green-700'];
const STRENGTH_TEXT = ['text-red-500', 'text-amber-600', 'text-blue-600', 'text-green-700'];
const STRENGTH_LABELS = ['Quá ngắn', 'Yếu', 'Trung bình', 'Mạnh'];

/** Password input with a show/hide eye button inside it. */
function PasswordField({ label, value, onChange, placeholder, autoComplete, invalid, valid, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  invalid?: boolean;
  valid?: boolean;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const stateBorder = invalid ? 'border-red-500!' : valid ? 'border-green-700!' : '';
  return (
    <label className={SETTINGS_LABEL}>
      {label}
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className={`${SETTINGS_INPUT} pr-11 font-normal ${stateBorder}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-slate-400 hover:text-[#00236F]"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {children}
    </label>
  );
}

export function AccountSettingsPage() {
  const { currentUser, user } = useAuth();
  const { profile, refreshProfile } = useAuthContext();
  const [name, setName] = useState(currentUser?.name || '');
  const [organization, setOrganization] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState(NAV_ITEMS[0].id);

  // ── Đổi mật khẩu ──────────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => { void refreshProfile(); }, []);
  useEffect(() => {
    if (profile) {
      setName(profile.displayName);
      setOrganization(profile.organization || '');
      setBio(profile.bio || '');
    }
  }, [profile]);

  // Highlight the nav item of the section currently in the middle of the screen.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    for (const item of NAV_ITEMS) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const goToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const savedName = profile?.displayName || currentUser?.name || '';
  const isDirty =
    name !== savedName || organization !== (profile?.organization || '') || bio !== (profile?.bio || '');

  const markEdited = () => { if (saveState !== 'idle') setSaveState('idle'); };

  const save = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      await updateProfile(user.id, { display_name: name.trim() || null, organization: organization.trim() || null, bio: bio.trim() || null });
      await refreshProfile();
      setSaveState('saved');
    } catch {
      setSaveState('error');
    } finally {
      setSaving(false);
    }
  };

  const resetProfileForm = () => {
    setName(savedName);
    setOrganization(profile?.organization || '');
    setBio(profile?.bio || '');
    setSaveState('idle');
  };

  const changeAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    setAvatarError(null);
    try { await uploadProfileAvatar(file); await refreshProfile(); }
    catch { setAvatarError('Không thể tải ảnh lên. Vui lòng thử lại.'); }
    finally { setUploadingAvatar(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (!currentPassword) { setPwError('Vui lòng nhập mật khẩu hiện tại.'); return; }
    if (newPassword.length < 6) { setPwError('Mật khẩu mới phải có ít nhất 6 ký tự.'); return; }
    if (newPassword !== confirmPassword) { setPwError('Mật khẩu xác nhận không khớp.'); return; }
    if (newPassword === currentPassword) { setPwError('Mật khẩu mới phải khác mật khẩu hiện tại.'); return; }
    setPwSubmitting(true);
    try {
      // Xác thực mật khẩu hiện tại bằng cách re-authenticate
      const email = user?.email;
      if (!email) { setPwError('Không tìm thấy email tài khoản.'); return; }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) {
        setPwError('Mật khẩu hiện tại không đúng. Vui lòng kiểm tra lại.');
        return;
      }
      // Mật khẩu cũ đúng → đổi sang mật khẩu mới
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setPwError(updateError.message);
      } else {
        setPwSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => { setPwSuccess(false); setPwOpen(false); }, 3000);
      }
    } catch {
      setPwError('Không thể kết nối. Vui lòng thử lại.');
    } finally {
      setPwSubmitting(false);
    }
  };

  const togglePwSection = () => {
    setPwOpen((v) => !v);
    setPwError(null);
    setPwSuccess(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const pwStrength = getPwStrength(newPassword);
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const confirmMatch = confirmPassword.length > 0 && confirmPassword === newPassword;
  const displayName = name.trim() || savedName || 'Người dùng';

  return (
    <main className="min-h-[calc(100vh-56px)] bg-slate-50 sm:min-h-[calc(100vh-64px)]">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-10 pt-5 sm:px-6 sm:pt-8 lg:px-8">
        {/* Page title */}
        <div className="mb-4 sm:mb-6">
          <h1 className="m-0 text-xl font-semibold leading-8 text-[#0B1C30] sm:text-[26px] sm:leading-9">Cài đặt tài khoản</h1>
          <p className="m-0 mt-0.5 text-[13px] text-[#444651] sm:text-sm">Quản lý hồ sơ, thông báo, phần thưởng và bảo mật.</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8">
          {/* Left column (desktop): profile summary + section nav, sticky while scrolling.
              Below 1024px `contents` lets the summary and the chip nav sit directly in the
              single-column grid, so the chip nav can stick to the top of the page. */}
          <aside className="contents lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-4">
            {/* Profile summary */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-col lg:gap-3 lg:p-6 lg:text-center">
              <div className="relative shrink-0">
                <div
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-[3px] border-[#E4ECFA] text-xl font-bold text-white lg:h-24 lg:w-24 lg:text-3xl"
                  // The color is computed per user at runtime, so it can't be a Tailwind class.
                  style={{ background: currentUser?.color }}
                >
                  {profile?.avatarUrl
                    ? <img src={profile.avatarUrl} alt="Ảnh đại diện" className="h-full w-full object-cover" />
                    : currentUser?.initials}
                </div>
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => void changeAvatar(event)} className="hidden" />
                <button
                  type="button"
                  aria-label="Thay đổi ảnh đại diện"
                  title="Thay đổi ảnh đại diện"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-[#00236F] p-0 text-white hover:bg-[#001a52] disabled:cursor-wait disabled:opacity-70"
                >
                  <Camera size={15} />
                </button>
              </div>

              <div className="min-w-0 flex-1 lg:w-full">
                <h2 className="m-0 truncate text-base font-semibold text-[#0B1C30] lg:text-lg">{displayName}</h2>
                <p className="m-0 truncate text-[13px] text-[#444651]">{user?.email || 'Chưa cập nhật'}</p>
                <span className="mt-1.5 inline-block rounded-full bg-[#EEF3FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#00236F]">Sinh viên</span>
                {avatarError && <p role="alert" className="m-0 mt-1.5 text-xs text-red-600">{avatarError}</p>}
              </div>

              {/* Extra details: desktop only (on phones the form right below shows them). */}
              <dl className="m-0 hidden w-full gap-2.5 border-t border-slate-100 pt-3 text-left text-[13px] lg:grid">
                <div>
                  <dt className="font-semibold text-[#0B1C30]">Tổ chức</dt>
                  <dd className="m-0 truncate text-[#444651]">{profile?.organization || 'Chưa cập nhật'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#0B1C30]">Tham gia</dt>
                  <dd className="m-0 text-[#444651]">{formatJoinDate(user?.created_at)}</dd>
                </div>
              </dl>
            </div>

            {/* Section nav */}
            <nav
              aria-label="Mục cài đặt"
              className="sticky top-14 z-30 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:top-16 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:p-2 lg:backdrop-blur-none"
            >
              <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 [scrollbar-width:none] lg:flex-col lg:gap-0.5 [&::-webkit-scrollbar]:hidden">
                {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                  const active = activeSection === id;
                  return (
                    <li key={id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => goToSection(id)}
                        aria-current={active ? 'true' : undefined}
                        className={[
                          'flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium transition',
                          // phones/tablets: pill chips
                          'h-9 rounded-full border px-3.5',
                          active ? 'border-[#00236F] bg-[#00236F] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100',
                          // desktop: plain list rows
                          'lg:h-10 lg:w-full lg:rounded-lg lg:border-transparent lg:px-3',
                          active ? 'lg:bg-[#EEF3FF] lg:text-[#00236F]' : 'lg:bg-transparent',
                        ].join(' ')}
                      >
                        <Icon size={16} aria-hidden />
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Right column: the settings sections */}
          <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
            {/* ── Hồ sơ ── */}
            <SettingsSection id="profile" icon={UserRound} title="Thông tin cá nhân" description="Tên và thông tin hiển thị với các thành viên khác.">
              <form
                onSubmit={(e) => { e.preventDefault(); void save(); }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <label className={SETTINGS_LABEL}>
                  Họ và tên
                  <input value={name} onChange={(e) => { setName(e.target.value); markEdited(); }} className={`${SETTINGS_INPUT} font-normal`} />
                </label>
                <label className={SETTINGS_LABEL}>
                  Địa chỉ email
                  <div className="relative">
                    <input
                      type="email"
                      value={user?.email || ''}
                      readOnly
                      className={`${SETTINGS_INPUT} cursor-not-allowed bg-slate-100 pr-10 font-normal text-slate-500 focus:border-slate-300 focus:ring-0`}
                    />
                    <Lock size={15} aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </label>
                <label className={`${SETTINGS_LABEL} sm:col-span-2`}>
                  Trường đại học / Tổ chức
                  <input value={organization} onChange={(e) => { setOrganization(e.target.value); markEdited(); }} placeholder="VD: Đại học Bách khoa Hà Nội" className={`${SETTINGS_INPUT} font-normal`} />
                </label>
                <label className={`${SETTINGS_LABEL} sm:col-span-2`}>
                  <span className="flex items-baseline justify-between">
                    Mô tả
                    <span className="text-xs font-normal tabular-nums text-slate-400">{bio.length}/{BIO_MAX}</span>
                  </span>
                  <textarea
                    value={bio}
                    onChange={(e) => { setBio(e.target.value); markEdited(); }}
                    maxLength={BIO_MAX}
                    rows={3}
                    placeholder="Giới thiệu ngắn về bạn"
                    className={`${SETTINGS_INPUT} h-auto min-h-22 resize-y py-2.5 font-normal`}
                  />
                </label>

                {/* Actions: full-width stacked on phones, right-aligned row from 640px. */}
                <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <span
                    role="status"
                    className={`text-center text-[13px] sm:mr-auto sm:text-left ${saveState === 'error' ? 'text-red-600' : 'text-green-700'}`}
                  >
                    {saveState === 'saved' && (
                      <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> Đã lưu thay đổi</span>
                    )}
                    {saveState === 'error' && 'Không thể lưu. Vui lòng thử lại.'}
                  </span>
                  <button type="button" onClick={resetProfileForm} disabled={!isDirty || saving} className={SETTINGS_BTN_SECONDARY}>
                    Hủy
                  </button>
                  <button type="submit" disabled={!isDirty || saving} className={SETTINGS_BTN_PRIMARY}>
                    {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </form>
            </SettingsSection>

            <NotificationSettingsSection />

            <RewardsSection />

            {/* ── Bảo mật / Đổi mật khẩu ── */}
            <SettingsSection
              id="security"
              icon={ShieldCheck}
              title="Mật khẩu"
              description="Cập nhật mật khẩu đăng nhập của bạn."
              action={
                !pwOpen && (
                  <button type="button" onClick={togglePwSection} className={`${SETTINGS_BTN_SECONDARY} h-9! px-3.5`}>
                    Đổi mật khẩu
                  </button>
                )
              }
            >
              {pwOpen && (pwSuccess ? (
                <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
                  <CheckCircle2 size={44} className="text-green-700" />
                  <p className="m-0 text-base font-semibold text-green-700">Đổi mật khẩu thành công!</p>
                  <p className="m-0 text-sm text-[#444651]">Vui lòng dùng mật khẩu mới trong lần đăng nhập tiếp theo.</p>
                </div>
              ) : (
                <form onSubmit={(e) => void handleChangePassword(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
                    <PasswordField
                      label="Mật khẩu hiện tại"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      placeholder="Nhập mật khẩu đang dùng"
                      autoComplete="current-password"
                    />
                  </div>

                  <PasswordField
                    label="Mật khẩu mới"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Tối thiểu 6 ký tự"
                    autoComplete="new-password"
                  >
                    {newPassword.length > 0 && (
                      <span className="flex flex-col gap-1 font-normal">
                        <span className="flex gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= pwStrength ? STRENGTH_BAR[pwStrength] : 'bg-slate-200'}`} />
                          ))}
                        </span>
                        <span className={`text-xs ${STRENGTH_TEXT[pwStrength]}`}>{STRENGTH_LABELS[pwStrength]}</span>
                      </span>
                    )}
                  </PasswordField>

                  <PasswordField
                    label="Xác nhận mật khẩu mới"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                    invalid={confirmMismatch}
                    valid={confirmMatch}
                  >
                    {confirmMismatch && <span className="text-xs font-normal text-red-500">Mật khẩu không khớp</span>}
                    {confirmMatch && <span className="text-xs font-normal text-green-700">✓ Khớp</span>}
                  </PasswordField>

                  {pwError && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 sm:col-span-2">
                      {pwError}
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:col-span-2 sm:flex-row sm:justify-end sm:gap-3">
                    <button type="button" onClick={togglePwSection} className={SETTINGS_BTN_SECONDARY}>Hủy</button>
                    <button type="submit" disabled={pwSubmitting} className={SETTINGS_BTN_PRIMARY}>
                      {pwSubmitting ? 'Đang xác thực...' : 'Lưu mật khẩu mới'}
                    </button>
                  </div>
                </form>
              ))}
            </SettingsSection>
          </div>
        </div>
      </div>
    </main>
  );
}
