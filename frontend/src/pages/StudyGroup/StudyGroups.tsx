import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, UserPlus, Users, ArrowRight, Flame } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getGroups, getMyGroups, createGroup, joinGroup, getMemberCounts, getMyMemberships } from '../../lib/group.api';
import { ApiError } from '../../lib/apiClient';
import { useLiveCollectionRefresh } from '../../hooks/useLiveCollectionRefresh';
import { JoinByCodeModal } from '../../components/invitations/JoinByCodeModal';
import type { Group, GroupMember, GroupMemberRole, GroupStreak } from '../../lib/group.types';
import { getAvatarInitials, getAvatarColor } from '../../utils/avatarUtils';
import { StudyGroupCardSkeleton } from '../../components/ui/Skeleton';
import { RestrictionBanner } from '../../components/ui/RestrictionBanner';

interface GroupWithMembership {
    group: Group;
    activeMembersCount: number;
    isMember: boolean;
    role: GroupMemberRole | null;
}

function roleLabel(role: GroupMemberRole | null): string {
    if (role === 'owner') return 'Trưởng nhóm';
    if (role === 'moderator') return 'Điều hành viên';
    return 'Thành viên';
}

/** Streak tiers: gray 0 · amber <3 · orange <10 · rose <30 · blue 30+ (text = icon color). */
function getStreakClasses(streak: number) {
    if (streak === 0) return 'text-slate-400 border-slate-400/20';
    if (streak < 3) return 'text-amber-500 border-amber-500/20';
    if (streak < 10) return 'text-orange-600 border-orange-600/20';
    if (streak < 30) return 'text-rose-600 border-rose-600/20';
    return 'text-blue-500 border-blue-500/20';
}

function GroupStreakBadge({ streak }: { streak?: GroupStreak }) {
    const currentStreak = streak?.current_streak || 0;

    return (
        <div className={`absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 shadow-md sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 ${getStreakClasses(currentStreak)}`}>
            <Flame fill="currentColor" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="text-xs font-bold sm:text-[13px]">{currentStreak}</span>
        </div>
    );
}

/** Prefers the group's custom background_url (set via GroupSettingsModal by the owner or a
 * moderator), then falls back to avatar_url, then to a deterministic color block. */
function GroupCover({ group }: { group: Group }) {
    if (group.background_url || group.avatar_url) {
        return (
            <img
                className="h-full w-full object-cover"
                src={group.background_url ?? group.avatar_url ?? undefined}
                alt={group.name}
            />
        );
    }
    return (
        // The color is computed per group at runtime, so it can't be a Tailwind class.
        <div className="flex h-full w-full items-center justify-center" style={{ background: getAvatarColor(group.id) }}>
            <span className="text-[32px] font-bold text-white">{getAvatarInitials(group.name)}</span>
        </div>
    );
}

/** One horizontal SLIDER at every screen size (replaces the old "Trước / Trang X / Y / Sau"
 *  pagination). How many cards are visible depends on the width of the section itself
 *  (Tailwind container queries on the `@container` wrapper in CardSlider, so a sidebar
 *  doesn't make cards too narrow):
 *    < 672px  → 2 cards  (phones / small screens)
 *    ≥ 672px  → 3 cards
 *    ≥ 896px  → 4 cards
 *    ≥ 1024px → 5 cards  (large screens)
 *  Card width = (100% − (n − 1) × gap) / n. The row scrolls sideways with snap; a thin
 *  scroll bar + the ← → buttons move it. pt-1/pb-3 leave room for the hover lift/shadow and
 *  the scroll bar. Cards and StudyGroupCardSkeleton get their width from the row (`[&>*]:`). */
const ROW_CLASSES = [
    'flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-3 pt-1 sm:gap-5',
    '[&>*]:shrink-0 [&>*]:snap-start',
    '[&>*]:w-[calc((100%-1rem)/2)] sm:[&>*]:w-[calc((100%-1.25rem)/2)]',
    '@2xl:[&>*]:w-[calc((100%-2*1.25rem)/3)]',
    '@4xl:[&>*]:w-[calc((100%-3*1.25rem)/4)]',
    '@5xl:[&>*]:w-[calc((100%-4*1.25rem)/5)]',
    // visible thin scroll bar ("thanh trượt"), Firefox + Chromium/Safari
    '[scrollbar-color:#94A3B8_#E2E8F0] [scrollbar-width:thin]',
    '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200',
    '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400',
].join(' ');

const SLIDER_BUTTON_CLASSES =
    'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white';

/** The card row of one section: a slider showing 2–5 cards (see ROW_CLASSES) with a scroll
 *  bar and ← → buttons. Each press moves by one "page" = the number of fully visible cards.
 *  The buttons only appear when there are more cards than fit. */
export function CardSlider({ label, children }: { label: string; children: ReactNode }) {
    const rowRef = useRef<HTMLDivElement>(null);
    const [canPrev, setCanPrev] = useState(false);
    const [canNext, setCanNext] = useState(false);

    const updateButtons = useCallback(() => {
        const row = rowRef.current;
        if (!row) return;
        setCanPrev(row.scrollLeft > 4);
        setCanNext(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    }, []);

    useEffect(() => {
        const row = rowRef.current;
        updateButtons();
        row?.addEventListener('scroll', updateButtons, { passive: true });
        window.addEventListener('resize', updateButtons);
        return () => {
            row?.removeEventListener('scroll', updateButtons);
            window.removeEventListener('resize', updateButtons);
        };
    }, [updateButtons, children]);

    const slide = (direction: -1 | 1) => {
        const row = rowRef.current;
        if (!row) return;
        const card = row.firstElementChild as HTMLElement | null;
        const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
        if (!card) {
            row.scrollBy?.({ left: direction * row.clientWidth, behavior: 'smooth' });
            return;
        }
        const cardStep = card.offsetWidth + gap;
        const perPage = Math.max(1, Math.floor((row.clientWidth + gap) / cardStep));
        row.scrollBy?.({ left: direction * perPage * cardStep, behavior: 'smooth' });
    };

    return (
        <div className="@container mt-2">
            <div ref={rowRef} role="region" aria-label={label} className={ROW_CLASSES}>
                {children}
            </div>
            {(canPrev || canNext) && (
                <div className="mt-2 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => slide(-1)} disabled={!canPrev} aria-label="Xem nhóm trước" className={SLIDER_BUTTON_CLASSES}>
                        <ChevronLeft size={18} />
                    </button>
                    <button type="button" onClick={() => slide(1)} disabled={!canNext} aria-label="Xem nhóm tiếp theo" className={SLIDER_BUTTON_CLASSES}>
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}

/** Bottom-right card action. The negative margin + padding gives a ~40px touch target on
 *  phones without changing the underlined-link look. Smaller text on phones, where two
 *  cards share the screen. */
const CTA_LINK_CLASSES =
    '-my-2 flex shrink-0 items-center gap-1 py-2 text-xs font-semibold no-underline sm:gap-1.5 sm:text-sm [&>span]:border-b-[1.5px] [&>span]:pb-0.5';

/** Small badge at the top of the card body (role / public-private). */
const CARD_BADGE_CLASSES = 'flex h-full items-center whitespace-nowrap rounded border px-2 text-[11px] sm:px-3 sm:text-xs';

/** One card, used by both sections; only the badge and the bottom-right action differ.
 *  The width comes from the row (1/2 … 1/5 of the slider, see ROW_CLASSES).
 *  Phones (< 640px, two ~160px cards side by side) use a compact version: cover 96px,
 *  padding 12px, name text-sm. From 640px: cover 128px, padding 20px, name text-lg.
 *
 *  EQUAL SIZE, whatever the text: every block has a fixed height, so all cards are the
 *  same height at every screen size (and the same width, set by the row):
 *    cover h-24 / sm:h-32 · badge row h-5 / sm:h-6 (one line, overflow hidden)
 *    name: always 2 lines reserved -- h-10 (2 × leading-5) / sm:h-12 (2 × leading-6)
 *    description: always 2 lines reserved -- h-8 (2 × leading-4) / sm:h-10 (2 × leading-5)
 *  Longer text is cut with "…" (line-clamp-2); shorter text leaves the space empty.
 *  StudyGroupCardSkeleton reserves exactly the same heights. */
function GroupCard({ group, activeMembersCount, badge, action }: {
    group: Group;
    activeMembersCount: number;
    badge: ReactNode;
    action: ReactNode;
}) {
    return (
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="relative h-24 shrink-0 bg-[#E5EEFF] sm:h-32">
                <GroupStreakBadge streak={group.streak} />
                <GroupCover group={group} />
            </div>
            <div className="flex flex-col p-3 sm:p-5">
                <div className="mb-2 flex h-5 gap-2 overflow-hidden sm:mb-3 sm:h-6">{badge}</div>
                <div title={group.name} className="mb-1 line-clamp-2 h-10 shrink-0 wrap-break-word text-sm font-semibold leading-5 text-[#0B1C30] sm:mb-2 sm:h-12 sm:text-lg sm:leading-6">
                    {group.name}
                </div>
                <div className="mb-3 line-clamp-2 h-8 shrink-0 wrap-break-word text-xs leading-4 text-[#444651] sm:mb-5 sm:h-10 sm:text-sm sm:leading-5">
                    {group.description || 'Chưa có mô tả.'}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-300 pt-2.5 sm:gap-3 sm:pt-4">
                    <div
                        title={`${activeMembersCount} thành viên`}
                        className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#E5EEFF] px-1 text-[10px] font-semibold text-[#00236F] sm:h-7 sm:min-w-7"
                    >
                        +{activeMembersCount}
                    </div>
                    {action}
                </div>
            </div>
        </div>
    );
}

/** Collapsible section header ("Nhóm học của tôi" / "Khám phá nhóm học"). */
function SectionHeader({ open, onToggle, title, subtitle }: {
    open: boolean;
    onToggle: () => void;
    title: string;
    subtitle: string;
}) {
    return (
        <>
            <div onClick={onToggle} className="flex cursor-pointer select-none items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    {open ? <ChevronDown size={22} className="shrink-0 text-[#0B1C30]" /> : <ChevronRight size={22} className="shrink-0 text-[#0B1C30]" />}
                    <div className="text-xl font-semibold leading-8 text-[#0B1C30] sm:text-2xl">{title}</div>
                </div>
                <div className="shrink-0 text-[13px] font-medium text-slate-500">
                    {open ? 'Ẩn danh sách' : 'Mở danh sách'}
                </div>
            </div>
            <div className="-mt-2 pl-8 text-[13px] text-[#444651] sm:text-sm">{subtitle}</div>
        </>
    );
}

const MODAL_OVERLAY = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4';
const MODAL_PANEL = 'relative flex w-full flex-col rounded-xl bg-white p-6 shadow-xl sm:p-8';
const MODAL_CLOSE = 'absolute right-4 top-4 border-none bg-transparent text-lg text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed';
const BTN_SECONDARY = 'rounded-md border-none bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:hover:bg-slate-100';
const BTN_PRIMARY = 'rounded-md border-none bg-[#00236F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#001a52] disabled:cursor-not-allowed disabled:bg-[#93A4C7]';
const ERROR_BOX = 'mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700';
const FIELD_INPUT = 'w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';

export function StudyRooms() {
    const navigate = useNavigate();
    const { user, getBan } = useAuth();
    const createGroupBan = getBan('create_group');
    const joinGroupBan = getBan('join_group');
    const currentUserId = user?.id ?? null;

    // State ẩn/hiện danh mục (nút mũi tên gập/mở)
    const [isMyGroupsOpen, setIsMyGroupsOpen] = useState(true);
    const [isDiscoverOpen, setIsDiscoverOpen] = useState(true);

    // Dropdown & Modal State
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    // Join-by-code (real invitation redemption -- see app/invitations/ and
    // JoinByCodeModal, which handles resolve -> preview/mismatch -> redeem -> navigate).
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [groupToJoin, setGroupToJoin] = useState<Group | null>(null);
    const [isJoining, setIsJoining] = useState(false);
    const [joinActionError, setJoinActionError] = useState<string | null>(null);

    // Create Group modal state
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createName, setCreateName] = useState('');
    const [createDescription, setCreateDescription] = useState('');
    const [createIsPublic, setCreateIsPublic] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const menuRef = useRef<HTMLDivElement>(null);

    // Đóng dropdown khi click ra ngoài
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // Discovery groups from GET /groups (public_only=true) merged with "My Groups" from
    // GET /groups/mine (active membership, public OR private -- see group.api.ts), enriched
    // with real membership from GET /groups/{id}/members so "Nhóm học của tôi" vs "Khám phá"
    // reflects backend truth. /groups/mine is what makes a Private Group the caller actively
    // belongs to still show up here after it's switched to private (it used to disappear
    // because only the public-discovery list was ever fetched).
    const [groups, setGroups] = useState<GroupWithMembership[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const loadSequence = useRef(0);
    
    const [searchParams] = useSearchParams();
    const searchQuery = searchParams.get('q') || '';

    const loadGroups = useCallback(async (silent = false) => {
        const sequence = ++loadSequence.current;
        if (!silent) setIsLoading(true);
        setLoadError(null);
        try {
            const [publicGroups, myGroupsList, memberCountsObj, myMemberships] = await Promise.all([
                getGroups(true, searchQuery),
                // Not swallowed: an empty "my groups" list would silently hide private groups
                // the user belongs to. A failure shows the error + retry instead.
                currentUserId ? getMyGroups() : Promise.resolve([]),
                getMemberCounts().catch(() => ({} as Record<string, number>)),
                currentUserId ? getMyMemberships() : Promise.resolve([]),
            ]);

            const merged = new Map<string, Group>();
            for (const group of publicGroups) merged.set(group.id, group);
            
            // For my groups, if there is a search query, filter them client-side
            for (const group of myGroupsList) {
                if (searchQuery && !group.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                    continue;
                }
                merged.set(group.id, group);
            }

            // Membership lookup
            const myMembershipMap = new Map<string, GroupMember>();
            for (const member of myMemberships) {
                myMembershipMap.set(member.group_id, member);
            }

            const enriched = Array.from(merged.values()).map((group): GroupWithMembership => {
                const mine = myMembershipMap.get(group.id);
                return {
                    group,
                    activeMembersCount: memberCountsObj[group.id] || 0,
                    isMember: !!mine,
                    role: mine?.role ?? null,
                };
            });

            if (sequence !== loadSequence.current) return;
            setGroups(enriched);
            setLoadError(null);
        } catch (err) {
            if (sequence === loadSequence.current) {
              setLoadError(err instanceof ApiError ? err.message : 'Không thể tải danh sách nhóm học.');
              if (!silent) setGroups(null);
            }
        } finally {
            if (sequence === loadSequence.current) setIsLoading(false);
        }
    }, [currentUserId, searchQuery]);

    useEffect(() => {
        void loadGroups();
        return () => { loadSequence.current += 1; };
    }, [loadGroups]);

    useLiveCollectionRefresh({
        enabled: !!currentUserId,
        watchPaths: ['/groups', '/invitations'],
        onRefresh: () => loadGroups(true),
    });

    async function handleConfirmJoin() {
        if (!groupToJoin || isJoining) return;
        setIsJoining(true);
        setJoinActionError(null);
        try {
            await joinGroup(groupToJoin.id);
            ++loadSequence.current;
            setGroupToJoin(null);
            setGroups((current) => current?.map((item) => item.group.id === groupToJoin.id
              ? { ...item, isMember: true, role: 'member', activeMembersCount: item.activeMembersCount + 1 }
              : item) ?? null);
            void loadGroups(true);
        } catch (err) {
            setJoinActionError(
                err instanceof ApiError ? err.message : 'Không thể tham gia nhóm học.'
            );
        } finally {
            setIsJoining(false);
        }
    }

    async function handleCreateGroup() {
        if (!createName.trim() || isCreating) return;
        setIsCreating(true);
        setCreateError(null);
        try {
            const newGroup = await createGroup({
                name: createName.trim(),
                description: createDescription.trim() || null,
                is_public: createIsPublic,
            });
            setIsCreateModalOpen(false);
            setCreateName('');
            setCreateDescription('');
            setCreateIsPublic(true);
            navigate(`/groups/${newGroup.id}`);
        } catch (err) {
            setCreateError(err instanceof ApiError ? err.message : 'Không thể tạo nhóm học.');
        } finally {
            setIsCreating(false);
        }
    }

    const myGroups = (groups?.filter((g) => g.isMember) ?? []).sort((a, b) => {
        const getPriority = (role: GroupMemberRole | null) => {
            if (role === 'owner') return 2;
            if (role === 'moderator') return 1;
            return 0;
        };
        const priorityDiff = getPriority(b.role) - getPriority(a.role);
        if (priorityDiff !== 0) return priorityDiff;
        // Secondary sort: by active members count or name could be added here if needed
        return b.activeMembersCount - a.activeMembersCount;
    });
    const discoverGroups = groups?.filter((g) => !g.isMember) ?? [];

    const menuItemClasses = (banned: boolean) =>
        `flex flex-col gap-0.5 px-4 py-3 ${banned ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50'}`;

    return (
        <div>
            {/* max-w keeps cards from stretching too wide on 2K/4K screens (5 cols max). */}
            <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-7 px-4 pb-3 pt-6 sm:gap-9 sm:px-6 sm:pt-8 lg:px-8">

                {/* TOP HEADER CONTROLS (Thanh điều hướng & nút Tạo nhóm ở đầu trang) */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
                    <div className="flex flex-col gap-1">
                        <h1 className="m-0 text-2xl font-semibold leading-9 text-[#0B1C30] sm:text-[28px]">
                            Quản lý & Khám phá nhóm học
                        </h1>
                        <p className="m-0 text-sm leading-5 text-[#444651]">
                            Tham gia, khởi tạo và theo dõi tiến độ các nhóm học tập của bạn.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-[#F8F9FF] px-3 py-2">
                            <span className="text-sm leading-5 text-[#0B1C30]">Sắp xếp: Mới nhất</span>
                            <ChevronDown size={16} className="text-gray-500" />
                        </div>
                        <div className="relative" ref={menuRef}>
                            <div
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className="flex cursor-pointer items-center gap-2 rounded-md bg-[#00236F] px-4 py-2 text-white hover:bg-[#001a52]"
                            >
                                <UserPlus size={16} />
                                <span className="text-sm font-semibold leading-5">Tham gia hoặc tạo nhóm</span>
                            </div>

                            {/* Dropdown Menu */}
                            {isMenuOpen && (
                                <div className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                                    <div
                                        onClick={() => {
                                            if (createGroupBan) return;
                                            setIsMenuOpen(false);
                                            setCreateError(null);
                                            setIsCreateModalOpen(true);
                                        }}
                                        title={createGroupBan ? 'Bạn đang bị hạn chế tạo nhóm học tập' : undefined}
                                        className={`${menuItemClasses(!!createGroupBan)} border-b border-slate-100`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <UserPlus size={18} className="text-slate-600" />
                                            <span className="text-sm font-medium text-slate-900">Tạo nhóm</span>
                                        </div>
                                        {createGroupBan && <span className="pl-7.5 text-[11px] text-amber-700">Đang bị hạn chế</span>}
                                    </div>
                                    <div
                                        onClick={() => {
                                            if (joinGroupBan) return;
                                            setIsMenuOpen(false);
                                            setIsJoinModalOpen(true);
                                        }}
                                        title={joinGroupBan ? 'Bạn đang bị hạn chế tham gia nhóm học tập' : undefined}
                                        className={menuItemClasses(!!joinGroupBan)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <UserPlus size={18} className="text-slate-600" />
                                            <span className="text-sm font-medium text-slate-900">Tham gia nhóm</span>
                                        </div>
                                        {joinGroupBan && <span className="pl-7.5 text-[11px] text-amber-700">Đang bị hạn chế</span>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Skeleton khi tải lần đầu */}
                {isLoading && (
                    <div className="flex flex-col gap-8">
                        {['w-[200px]', 'w-[220px]'].map((titleWidth) => (
                            <div key={titleWidth} className="flex flex-col gap-4">
                                <div className="flex items-center gap-2.5">
                                    <div className="skeleton-pulse h-5.5 w-5.5 rounded" />
                                    <div className={`skeleton-pulse h-7 rounded-md ${titleWidth}`} />
                                </div>
                                <CardSlider label="Đang tải nhóm học">
                                    {[...Array(5)].map((_, i) => <StudyGroupCardSkeleton key={i} />)}
                                </CardSlider>
                            </div>
                        ))}
                    </div>
                )}

                {!isLoading && loadError && (
                    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <span>{loadError}</span>
                        <button
                            type="button"
                            onClick={() => void loadGroups()}
                            className="shrink-0 rounded-md border border-red-300 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-red-700 hover:bg-red-50"
                        >
                            Thử lại
                        </button>
                    </div>
                )}

                {!isLoading && !loadError && groups && groups.length === 0 && (
                    <div className="py-6 text-sm text-slate-500">Chưa có nhóm học công khai nào.</div>
                )}

                {!isLoading && !loadError && groups && (
                <>
                {/* SECTION 1: NHÓM HỌC CỦA TÔI */}
                <section className="flex flex-col gap-4">
                    <SectionHeader
                        open={isMyGroupsOpen}
                        onToggle={() => setIsMyGroupsOpen(!isMyGroupsOpen)}
                        title={`Nhóm học của tôi (${myGroups.length})`}
                        subtitle="Các nhóm học bạn đã tham gia và đang hoạt động."
                    />
                    {isMyGroupsOpen && (
                        <CardSlider label="Nhóm học của tôi">
                            {myGroups.map(({ group, activeMembersCount, role }) => (
                                <GroupCard
                                    key={group.id}
                                    group={group}
                                    activeMembersCount={activeMembersCount}
                                    badge={
                                        <span className={`${CARD_BADGE_CLASSES} border-green-200 bg-green-100 font-semibold text-green-700`}>
                                            {roleLabel(role)}
                                        </span>
                                    }
                                    action={
                                        <Link to={`/groups/${group.id}`} className={`${CTA_LINK_CLASSES} text-[#00236F] [&>span]:border-[#00236F] hover:opacity-80`}>
                                            <span className="flex items-center gap-1 sm:gap-1.5">Vào nhóm <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></span>
                                        </Link>
                                    }
                                />
                            ))}
                        </CardSlider>
                    )}
                </section>

                {/* SECTION 2: KHÁM PHÁ NHÓM HỌC */}
                <section className="flex flex-col gap-4">
                    <SectionHeader
                        open={isDiscoverOpen}
                        onToggle={() => setIsDiscoverOpen(!isDiscoverOpen)}
                        title={searchQuery ? `Kết quả tìm kiếm cho "${searchQuery}" (${discoverGroups.length})` : `Khám phá nhóm học (${discoverGroups.length})`}
                        subtitle="Tìm và tham gia các nhóm học tập phù hợp với bạn."
                    />
                    {isDiscoverOpen && (
                        <CardSlider label={searchQuery ? 'Kết quả tìm kiếm nhóm học' : 'Khám phá nhóm học'}>
                            {discoverGroups.map(({ group, activeMembersCount }) => (
                                <GroupCard
                                    key={group.id}
                                    group={group}
                                    activeMembersCount={activeMembersCount}
                                    badge={
                                        <span className={`${CARD_BADGE_CLASSES} border-slate-200 bg-[#F8F9FF] text-[#757682]`}>
                                            {group.is_public ? 'Công khai' : 'Riêng tư'}
                                        </span>
                                    }
                                    action={
                                        <div
                                            onClick={() => { if (joinGroupBan) return; setJoinActionError(null); setGroupToJoin(group); }}
                                            title={joinGroupBan ? 'Bạn đang bị hạn chế tham gia nhóm học tập' : undefined}
                                            className={`${CTA_LINK_CLASSES} ${joinGroupBan
                                                ? 'cursor-not-allowed text-slate-400 [&>span]:border-slate-400'
                                                : 'cursor-pointer text-[#00236F] [&>span]:border-[#00236F] hover:opacity-80'}`}
                                        >
                                            <span className="flex items-center gap-1 sm:gap-1.5"><Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Tham gia</span>
                                        </div>
                                    }
                                />
                            ))}
                        </CardSlider>
                    )}
                </section>
                </>
                )}

                {/* Khoảng trống chân trang vừa đủ (~1cm = 36px) */}
                <div className="h-9 w-full shrink-0" />

            </div>

            {/* Join Group by code -- real invitation redemption (see app/invitations/ and
                JoinByCodeModal, shared with the Study Room/Private Channel entry points on
                StudyGroupDetail.tsx). A room/channel code entered here is rejected with a
                clear mismatch message, not silently treated as a Group join. */}
            <JoinByCodeModal isOpen={isJoinModalOpen} onClose={() => setIsJoinModalOpen(false)} expectedTarget="group" />

            {/* Modal: Xác nhận tham gia nhóm */}
            {groupToJoin && (
                <div className={MODAL_OVERLAY}>
                    <div className={`${MODAL_PANEL} max-w-100`}>
                        <button
                            onClick={() => { setGroupToJoin(null); setJoinActionError(null); }}
                            disabled={isJoining}
                            className={MODAL_CLOSE}
                        >
                            ✕
                        </button>

                        <h2 className="mb-3 text-lg font-semibold text-slate-900">Tham gia nhóm</h2>
                        <p className="mb-4 text-sm leading-5 text-slate-600">
                            Bạn muốn tham gia nhóm học <strong>{groupToJoin.name}</strong>.
                        </p>

                        {joinGroupBan && (
                            <div className="mb-4">
                                <RestrictionBanner ban={joinGroupBan} actionLabel="tham gia nhóm học tập" />
                            </div>
                        )}

                        {joinActionError && <div className={ERROR_BOX}>{joinActionError}</div>}

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setGroupToJoin(null); setJoinActionError(null); }}
                                disabled={isJoining}
                                className={BTN_SECONDARY}
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleConfirmJoin}
                                disabled={isJoining || !!joinGroupBan}
                                className={BTN_PRIMARY}
                            >
                                {isJoining ? 'Đang tham gia...' : 'Tham gia'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Tạo nhóm học mới */}
            {isCreateModalOpen && (
                <div className={MODAL_OVERLAY}>
                    <div className={`${MODAL_PANEL} max-w-110`}>
                        <button
                            onClick={() => { if (!isCreating) { setIsCreateModalOpen(false); setCreateError(null); } }}
                            disabled={isCreating}
                            className={MODAL_CLOSE}
                        >
                            ✕
                        </button>

                        <h2 className="mb-5 text-lg font-semibold text-slate-900">Tạo nhóm học mới</h2>

                        <div className="mb-4 flex flex-col gap-1.5">
                            <label className="text-[13px] font-semibold text-slate-700">Tên nhóm học *</label>
                            <input
                                type="text"
                                value={createName}
                                onChange={(e) => setCreateName(e.target.value)}
                                placeholder="VD: Nhóm ôn thi Toán rời rạc"
                                disabled={isCreating}
                                className={FIELD_INPUT}
                                autoFocus
                            />
                        </div>

                        <div className="mb-4 flex flex-col gap-1.5">
                            <label className="text-[13px] font-semibold text-slate-700">Mô tả</label>
                            <textarea
                                value={createDescription}
                                onChange={(e) => setCreateDescription(e.target.value)}
                                placeholder="Mô tả ngắn về mục tiêu của nhóm học (không bắt buộc)"
                                disabled={isCreating}
                                className={`${FIELD_INPUT} min-h-18 resize-y`}
                            />
                        </div>

                        <div className="mb-6 flex items-center gap-2.5">
                            <input
                                type="checkbox"
                                id="create-group-public"
                                checked={createIsPublic}
                                onChange={(e) => setCreateIsPublic(e.target.checked)}
                                disabled={isCreating}
                                className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <label
                                htmlFor="create-group-public"
                                className={`text-[13px] text-slate-700 ${isCreating ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                                Nhóm công khai (mọi người có thể tìm và tham gia)
                            </label>
                        </div>

                        {createGroupBan && (
                            <div className="mb-4">
                                <RestrictionBanner ban={createGroupBan} actionLabel="tạo nhóm học tập" />
                            </div>
                        )}

                        {createError && <div className={ERROR_BOX}>{createError}</div>}

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { if (!isCreating) { setIsCreateModalOpen(false); setCreateError(null); } }}
                                disabled={isCreating}
                                className={BTN_SECONDARY}
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleCreateGroup}
                                disabled={isCreating || !createName.trim() || !!createGroupBan}
                                className={BTN_PRIMARY}
                            >
                                {isCreating ? 'Đang tạo...' : 'Tạo nhóm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
