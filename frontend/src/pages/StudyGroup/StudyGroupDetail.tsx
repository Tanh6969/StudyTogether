import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Hash,
    Video,
    FileText,
    Settings,
    Send,
    UserPlus,
    ChevronDown,
    Lock,
    LogOut,
    Plus,
    MoreVertical,
    Trash2,
    Ticket,
    Download,
    Image as ImageIcon,
    ShieldCheck,
    Flame,
    ListChecks,
    MessagesSquare,
    Users,
    Clock,
    Globe
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useChannelMessagesRealtime } from '../../hooks/useChannelMessagesRealtime';
import { useMessageReactionsRealtime } from '../../hooks/useMessageReactionsRealtime';
import { useMessageReactionActions } from '../../hooks/useMessageReactionActions';
import { useMessageImageAttachment, ALLOWED_IMAGE_ACCEPT } from '../../hooks/useMessageImageAttachment';
import { MessageAttachmentImage } from '../../components/chat/MessageAttachmentImage';
import { MessageReactions } from '../../components/chat/MessageReactions';
import { SelectedImagePreview } from '../../components/chat/SelectedImagePreview';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { RestrictionBanner } from '../../components/ui/RestrictionBanner';
import { useGroupTableRealtime } from '../../hooks/useGroupTableRealtime';
import { useGroupResources } from '../../hooks/useGroupResources';
import { useGroupNotes } from '../../hooks/useGroupNotes';
import { NotesStackPanel } from './NotesStackPanel';
import { TaskFlowBoard } from './TaskFlowBoard';
import { WorkspaceTabs, HeaderIconButton } from '../../components/groups/WorkspaceTabs';
import { ApiError } from '../../lib/apiClient';
import { getGroup, listGroupMembers, leaveGroup, removeMember, updateMemberRole } from '../../lib/group.api';
import { InviteModal } from '../../components/invitations/InviteModal';
import { JoinByCodeModal } from '../../components/invitations/JoinByCodeModal';
import { GroupSettingsModal } from '../../components/groups/GroupSettingsModal';
import { GroupMembersPanel } from '../../components/groups/GroupMembersPanel';
import { createChannel, deleteChannel, getChannel, listChannelMembers, listChannelsByGroup, removeChannelMember } from '../../lib/channel.api';
import { createStudyRoom, deleteStudyRoom, getStudyRoom, listStudyRoomMembers, listStudyRoomsByGroup } from '../../lib/studyRoom.api';
import { useStudyRoomMembersRealtime } from '../../hooks/useStudyRoomMembersRealtime';
import { listConversationMessages, sendConversationMessage } from '../../lib/message.api';
import { chatCache } from '../../lib/chatCache';
import type { Group, GroupMember } from '../../lib/group.types';
import type { Channel, ChannelMember } from '../../lib/channel.types';
import type { StudyRoom, StudyRoomMember } from '../../lib/studyRoom.types';
import type { Message, MessageReactionSummary } from '../../lib/message.types';
import { getAvatarInitials, getAvatarColor } from '../../utils/avatarUtils';
import { getDisplayName } from '../../utils/userDisplay';

/** Appends `message` unless a message with the same id is already present. REST send
 * responses and Realtime INSERT events for the sender's own message both resolve to the
 * same persisted row, so both paths must go through this to avoid rendering it twice --
 * regardless of which of the two arrives first. */
function appendMessageDeduped(prev: Message[], message: Message): Message[] {
  return prev.some((m) => m.id === message.id) ? prev : [...prev, message];
}

/** Composes the right-sidebar member list for the active Channel. A public channel's access
 * derives entirely from Group membership, so it keeps showing every active Group member
 * unchanged. A private channel's accessible-user set differs: explicit `channel_members` PLUS
 * Group owner/moderators, who can access a private channel via manager authority alone
 * (channel_router._require_channel_member_access) without ever getting a channel_members row
 * -- GET /channels/{id}/members does not include them (see channel.api.ts's
 * listChannelMembers doc comment). Composed frontend-side from two already-authorized lists
 * rather than having the backend fabricate channel_members rows for managers -- this is
 * presentation only, it grants no new access: every user included here already
 * independently passed backend authorization to be counted as a participant of this channel.
 * Deduped by user_id; when a channel member is also a tracked active Group member, the
 * existing GroupMember object is reused as-is (so "Điều hành viên"/"Host" labels and
 * owner-only promote/demote/remove controls keep working unchanged) rather than only
 * surfacing a bare UserSummary. */
export function composeDisplayedMembers(
  isPrivateChannel: boolean,
  activeMembers: GroupMember[],
  channelMembers: ChannelMember[],
  groupId: string
): GroupMember[] {
  if (!isPrivateChannel) return activeMembers;
  const byUserId = new Map<string, GroupMember>();
  for (const m of activeMembers) {
    if (m.role === 'owner' || m.role === 'moderator') byUserId.set(m.user_id, m);
  }
  for (const cm of channelMembers) {
    if (byUserId.has(cm.user_id)) continue;
    const asGroupMember = activeMembers.find((m) => m.user_id === cm.user_id);
    byUserId.set(
      cm.user_id,
      asGroupMember ?? {
        id: `channel-member-${cm.id}`,
        group_id: groupId,
        user_id: cm.user_id,
        role: 'member',
        status: 'active',
        joined_at: cm.joined_at,
        user: cm.user,
      }
    );
  }
  return Array.from(byUserId.values());
}

export function StudyGroupDetail() {
  const navigate = useNavigate();
  const { id: groupId } = useParams();
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const { user, currentUser, getBan } = useAuth();
  const messageBan = getBan('message');
  const currentUserId = user?.id ?? null;

  // Dynamic States
  const [activeChannel, setActiveChannel] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [mainView, setMainView] = useState<'chat' | 'rooms' | 'documents' | 'tasks'>('tasks');

  // Group Settings & Dropdown Menu States
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  // Group Notes: shared content maintained by the Group Owner/Moderator (real, group-scoped,
  // persisted via backend -- see note_router.py). Displayed as a paper stack (see
  // NotesStackPanel): exactly one Note focused/visible at a time, navigated via Previous/Next.
  // All stack/composer/editor state lives in the hook -- this page only wires it to the panel.
  const groupNotesController = useGroupNotes(groupId);

  // Real Group/Channel/Study Room domain state (replaces the previous hard-coded mock group).
  const [group, setGroup] = useState<Group | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [studyRooms, setStudyRooms] = useState<StudyRoom[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  // Private-channel-only roster (see `displayedMembers` below) -- fetched separately from
  // groupMembers, only while the active channel is private. Left empty/unused for a public
  // channel, whose sidebar is driven by groupMembers directly (unchanged behavior).
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [isChannelMembersLoading, setIsChannelMembersLoading] = useState(false);
  const [channelMembersError, setChannelMembersError] = useState<string | null>(null);
  // "Xóa khỏi kênh" mutation state -- keyed by user_id (not a GroupMember.id) since a
  // channel_members row has no membership id of its own; mirrors memberActionPendingId/
  // memberActionError below, which is the equivalent tracker for "Xóa khỏi nhóm".
  const [channelActionPendingUserId, setChannelActionPendingUserId] = useState<string | null>(null);
  const [channelActionError, setChannelActionError] = useState<string | null>(null);
  
  // Independent loading states for Lazy Loading
  const [isGroupLoading, setIsGroupLoading] = useState(true);
  const [isChannelsLoading, setIsChannelsLoading] = useState(true);
  const [isRoomsLoading, setIsRoomsLoading] = useState(true);
  const [isMembersLoading, setIsMembersLoading] = useState(true);
  
  const [loadError, setLoadError] = useState<{ status: number | null; message: string } | null>(null);

  // Leave-group mutation state
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Group Settings modal state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Member role-change / removal mutation state -- a single pending action at a time,
  // mirrors the single-flag pattern used by isDeletingChannel/isDeletingRoom below.
  const [memberActionPendingId, setMemberActionPendingId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  // Create Study Room modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [channelToInvite, setChannelToInvite] = useState<Channel | null>(null);
  const [roomToInvite, setRoomToInvite] = useState<StudyRoom | null>(null);
  // Dedicated Join Study Room / Join Private Channel entry points (see JoinByCodeModal) --
  // distinct from the group-level "Mời thêm người" (create invitation) flow above.
  const [isJoinRoomModalOpen, setIsJoinRoomModalOpen] = useState(false);
  const [isJoinChannelModalOpen, setIsJoinChannelModalOpen] = useState(false);

  const [isCreateRoomModalOpen, setIsCreateRoomModalOpen] = useState(false);
  const [createRoomName, setCreateRoomName] = useState('');
  const [createRoomDescription, setCreateRoomDescription] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createRoomIsPrivate, setCreateRoomIsPrivate] = useState(false);
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);

  // Create Channel modal state
  const [isCreateChannelModalOpen, setIsCreateChannelModalOpen] = useState(false);
  const [createChannelName, setCreateChannelName] = useState('');
  const [createChannelDescription, setCreateChannelDescription] = useState('');
  const [createChannelIsPrivate, setCreateChannelIsPrivate] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);

  // Delete Channel: confirmation modal state (opened from the chat header "⋮" menu)
  const [channelPendingDelete, setChannelPendingDelete] = useState<Channel | null>(null);
  const [isDeletingChannel, setIsDeletingChannel] = useState(false);
  const [deleteChannelError, setDeleteChannelError] = useState<string | null>(null);

  // Delete Study Room: confirmation modal state (opened from the rooms header "⋮" menu)
  const [roomPendingDelete, setRoomPendingDelete] = useState<StudyRoom | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [deleteRoomError, setDeleteRoomError] = useState<string | null>(null);

  // Workspace header tabs: which room tab is open, and which header "more" menu is open.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'channel' | 'room' | null>(null);
  useEffect(() => {
    if (!openHeaderMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('[data-header-menu]')) setOpenHeaderMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenHeaderMenu(null); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openHeaderMenu]);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;

    setIsGroupLoading(true);
    setIsChannelsLoading(true);
    setIsRoomsLoading(true);
    setIsMembersLoading(true);
    setLoadError(null);

    // 1. Fetch Group Details
    getGroup(groupId as string)
      .then((data) => {
        if (!cancelled) {
          setGroup(data);
          setIsGroupLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError({
            status: err instanceof ApiError ? err.status : null,
            message: err instanceof ApiError ? err.message : 'Không thể tải dữ liệu nhóm học.',
          });
          setIsGroupLoading(false);
        }
      });

    // 2. Fetch Channels
    listChannelsByGroup(groupId as string)
      .then((data) => {
        if (!cancelled) {
          setChannels(data);
          setActiveChannel((prev) => (data.some((c) => c.id === prev) ? prev : (data[0]?.id ?? '')));
          setIsChannelsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsChannelsLoading(false);
      });

    // 3. Fetch Study Rooms
    listStudyRoomsByGroup(groupId as string)
      .then((data) => {
        if (!cancelled) {
          setStudyRooms(data);
          setIsRoomsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsRoomsLoading(false);
      });

    // 4. Fetch Members
    listGroupMembers(groupId as string)
      .then((data) => {
        if (!cancelled) {
          setGroupMembers(data);
          setIsMembersLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsMembersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Live-syncs Channels/Study Rooms as other Group members create/rename/edit them, on top of
  // the REST load above (see useGroupTableRealtime.ts). Both hydrate every INSERT/UPDATE via
  // GET /channels/{id} / GET /study-rooms/{id}: `conversation_id` on both Channel and StudyRoom
  // is a backend-computed field (a Python @property joined from the row's related Conversation,
  // not a real `channels`/`study_rooms` column), so the raw Realtime row can never be cast
  // directly to these types -- same reason Group Notes (useGroupNotesRealtime.ts) and messages
  // (useChannelMessagesRealtime.ts) hydrate instead of using the raw row. INSERT/UPDATE only:
  // both tables are soft-deleted via UPDATE, and Realtime does not reliably deliver an UPDATE
  // that flips a row from visible to invisible under RLS -- see useGroupTableRealtime.ts's
  // header for why that gap is deliberately not worked around here. The `deleted_at` branches
  // below are defense in depth for the rare case such an event *does* arrive and *does*
  // hydrate, not the primary removal path.
  useGroupTableRealtime<Channel>('channels', group?.id ?? null, getChannel, {
    onInsert: (channel) => {
      if (channel.deleted_at) return;
      setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [...prev, channel]));
    },
    onUpdate: (channel) => {
      setChannels((prev) => {
        if (channel.deleted_at) return prev.filter((c) => c.id !== channel.id);
        const idx = prev.findIndex((c) => c.id === channel.id);
        if (idx === -1) return [...prev, channel]; // e.g. newly visible: is_private flipped to false
        const next = [...prev];
        next[idx] = channel;
        return next;
      });
      if (channel.deleted_at) {
        setActiveChannel((prev) => (prev === channel.id ? '' : prev));
      }
    },
  });

  useGroupTableRealtime<StudyRoom>('study_rooms', group?.id ?? null, getStudyRoom, {
    onInsert: (room) => {
      if (room.deleted_at) return;
      setStudyRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [...prev, room]));
    },
    onUpdate: (room) => {
      setStudyRooms((prev) => {
        if (room.deleted_at) return prev.filter((r) => r.id !== room.id);
        const idx = prev.findIndex((r) => r.id === room.id);
        if (idx === -1) return [...prev, room];
        const next = [...prev];
        next[idx] = room;
        return next;
      });
    },
  });

  const activeMembers = groupMembers.filter((m) => m.status === 'active');
  const isOwner = !!group && !!currentUserId && group.owner_id === currentUserId;
  // Backend rule (POST /channels/ and POST /study-rooms/, both via is_group_manager): only
  // the group owner or an active moderator may create a channel or a study room -- a plain
  // member cannot (changed 2026-08-18: study room creation used to be open to any active
  // member, see STUDY_PLATFORM_DATABASE_SPEC.md §16).
  const isGroupManager =
    isOwner || (!!currentUserId && activeMembers.some((m) => m.user_id === currentUserId && m.role === 'moderator'));
  // Backend rule (DELETE /study-rooms/{id}): only an active group owner/moderator may delete
  // a room -- being its host is not sufficient on its own (2026-08-18 policy change: host_id
  // is creator metadata, not an independent authorization grant). This is UX-only; the
  // backend independently re-checks the same rule (study_room_router.delete_room).
  const canDeleteRoom = isGroupManager;

  const {
    resources,
    loading: resourcesLoading,
    listError: resourcesListError,
    uploadError: resourceUploadError,
    isUploading: isUploadingResource,
    pendingDeleteId: pendingDeleteResourceId,
    deleteError: resourceDeleteError,
    downloadError: resourceDownloadError,
    pendingDownloadId: pendingDownloadResourceId,
    upload: uploadResource,
    remove: removeResource,
    open: openResourceFile,
    download: downloadResourceFile,
    canDelete: canDeleteResource,
  } = useGroupResources(group?.id);
  const resourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [resourcePendingDelete, setResourcePendingDelete] = useState<{ id: string; name: string } | null>(null);

  function formatFileSize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleResourceFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await uploadResource(file);
    } catch {
      // uploadError state already surfaces this in the UI
    }
  }

  async function handleConfirmDeleteResource() {
    if (!resourcePendingDelete) return;
    try {
      await removeResource(resourcePendingDelete.id);
      setResourcePendingDelete(null);
    } catch {
      // deleteError state already surfaces this in the UI; keep the dialog open
    }
  }

  async function handleLeaveGroup() {
    if (!group || !currentUserId || isLeaving) return;
    const confirmMessage = isOwner
      ? `Bạn là trưởng nhóm "${group.name}". Rời nhóm sẽ không chuyển quyền trưởng nhóm cho ai khác. Bạn vẫn muốn rời nhóm?`
      : `Bạn có chắc muốn rời nhóm "${group.name}"?`;
    if (!window.confirm(confirmMessage)) return;

    setIsLeaving(true);
    setLeaveError(null);
    try {
      await leaveGroup(group.id, currentUserId);
      navigate('/groups');
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Không thể rời nhóm học.');
      setIsLeaving(false);
    }
  }

  // Owner-only; backend independently re-checks owner authority on both endpoints
  // (group_router.update_member_role / remove_member) -- these UI gates are UX-only.
  async function handlePromoteMember(member: GroupMember) {
    if (!group || memberActionPendingId) return;
    setMemberActionPendingId(member.id);
    setMemberActionError(null);
    try {
      const updated = await updateMemberRole(group.id, member.user_id, 'moderator');
      setGroupMembers((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
    } catch (err) {
      setMemberActionError(err instanceof ApiError ? err.message : 'Không thể thăng cấp thành viên.');
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function handleDemoteMember(member: GroupMember) {
    if (!group || memberActionPendingId) return;
    setMemberActionPendingId(member.id);
    setMemberActionError(null);
    try {
      const updated = await updateMemberRole(group.id, member.user_id, 'member');
      setGroupMembers((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
    } catch (err) {
      setMemberActionError(err instanceof ApiError ? err.message : 'Không thể hạ cấp điều hành viên.');
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function handleRemoveMember(member: GroupMember) {
    if (!group || memberActionPendingId) return;
    const display = memberDisplay(member);
    if (!window.confirm(`Bạn có chắc muốn xóa "${display.name}" khỏi nhóm học?`)) return;
    setMemberActionPendingId(member.id);
    setMemberActionError(null);
    try {
      await removeMember(group.id, member.user_id);
      setGroupMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setMemberActionError(err instanceof ApiError ? err.message : 'Không thể xóa thành viên.');
    } finally {
      setMemberActionPendingId(null);
    }
  }

  // "Xóa khỏi kênh" -- removes a member's explicit channel_members row for the active
  // private Channel (DELETE /channels/{id}/members/{user_id}; backend requires the caller to
  // be the channel's group owner/moderator -- see channel_router.remove_member). Only ever
  // invoked for a member GroupMembersPanel has confirmed has such a row (see its
  // `explicitChannelMemberUserIds` prop), never for a Group manager present only via
  // fallback access. Updates `channelMembers` directly on success -- `displayedMembers`
  // (composeDisplayedMembers) recomputes from it, so the sidebar/count reflect the removal
  // immediately without a full refetch.
  async function handleKickFromChannel(member: GroupMember) {
    if (!activeChannelObj || channelActionPendingUserId) return;
    const display = memberDisplay(member);
    if (!window.confirm(`Bạn có chắc muốn xóa "${display.name}" khỏi kênh riêng tư này?`)) return;
    setChannelActionPendingUserId(member.user_id);
    setChannelActionError(null);
    try {
      await removeChannelMember(activeChannelObj.id, member.user_id);
      setChannelMembers((prev) => prev.filter((cm) => cm.user_id !== member.user_id));
    } catch (err) {
      setChannelActionError(err instanceof ApiError ? err.message : 'Không thể xóa thành viên khỏi kênh.');
    } finally {
      setChannelActionPendingUserId(null);
    }
  }

  async function handleCreateRoom() {
    if (!group || !currentUserId || !createRoomName.trim() || isCreatingRoom) return;
    setIsCreatingRoom(true);
    setCreateRoomError(null);
    try {
      const newRoom = await createStudyRoom({
        group_id: group.id,
        name: createRoomName.trim(),
        description: createRoomDescription.trim() || null,
        is_private: createRoomIsPrivate,
      });
      // Real, persisted room returned by the backend -- append to reflect it immediately;
      // a refresh re-fetches from the backend and will show the same room.
      setStudyRooms((prev) => [...prev, newRoom]);
      setIsCreateRoomModalOpen(false);
      setCreateRoomName('');
      setCreateRoomDescription('');
      setCreateRoomIsPrivate(false);
      setActiveRoomId(newRoom.id);
      // A hidden room is useless until someone has its code -- hand the creator one right away.
      if (newRoom.is_private) setRoomToInvite(newRoom);
    } catch (err) {
      setCreateRoomError(err instanceof ApiError ? err.message : 'Không thể tạo phòng học.');
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function handleCreateChannel() {
    if (!group || !createChannelName.trim() || isCreatingChannel) return;
    setIsCreatingChannel(true);
    setCreateChannelError(null);
    try {
      const newChannel = await createChannel({
        group_id: group.id,
        name: createChannelName.trim(),
        description: createChannelDescription.trim() || null,
        is_private: createChannelIsPrivate,
      });
      // Real, persisted channel returned by the backend -- append and switch to it; a
      // refresh re-fetches from the backend and will show the same channel.
      setChannels((prev) => [...prev, newChannel]);
      setActiveChannel(newChannel.id);
      setMainView('chat');
      setIsCreateChannelModalOpen(false);
      setCreateChannelName('');
      setCreateChannelDescription('');
      setCreateChannelIsPrivate(false);
    } catch (err) {
      setCreateChannelError(err instanceof ApiError ? err.message : 'Không thể tạo kênh chat.');
    } finally {
      setIsCreatingChannel(false);
    }
  }

  async function handleConfirmDeleteChannel() {
    if (!channelPendingDelete || isDeletingChannel) return;
    const deletedId = channelPendingDelete.id;
    setIsDeletingChannel(true);
    setDeleteChannelError(null);
    try {
      await deleteChannel(deletedId);
      // Only touch local state after the backend confirms the delete -- no optimistic/fake
      // success. Removing it from `channels` also makes `activeChannelObj` resolve to null
      // if this was the active channel, which in turn clears its conversation_id and lets
      // the messages-loading effect and useChannelMessagesRealtime (both keyed off
      // activeChannelObj?.conversation_id) reset/unsubscribe on their own -- no separate
      // cleanup call needed here.
      setChannels((prev) => prev.filter((c) => c.id !== deletedId));
      setActiveChannel((prev) => (prev === deletedId ? '' : prev));
      setChannelPendingDelete(null);
    } catch (err) {
      // Keep the channel in the list and the modal open so the user can see the error and retry.
      setDeleteChannelError(err instanceof ApiError ? err.message : 'Không thể xóa kênh chat.');
    } finally {
      setIsDeletingChannel(false);
    }
  }

  async function handleConfirmDeleteRoom() {
    if (!roomPendingDelete || isDeletingRoom) return;
    const deletedId = roomPendingDelete.id;
    setIsDeletingRoom(true);
    setDeleteRoomError(null);
    try {
      await deleteStudyRoom(deletedId);
      // Only touch local state after the backend confirms the delete -- no optimistic/fake
      // success (mirrors handleConfirmDeleteChannel).
      setStudyRooms((prev) => prev.filter((r) => r.id !== deletedId));
      setRoomPendingDelete(null);
    } catch (err) {
      // Keep the room in the list and the modal open so the user can see the error and retry.
      setDeleteRoomError(err instanceof ApiError ? err.message : 'Không thể xóa phòng học.');
    } finally {
      setIsDeletingRoom(false);
    }
  }

  // Real persisted messages for the currently active channel. Channel messages are
  // addressed via the channel's conversation_id (GET/POST /conversations/{id}/messages),
  // not a /channels/{id}/messages route.
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [sendMessageError, setSendMessageError] = useState<string | null>(null);
  const imageAttachment = useMessageImageAttachment();
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks the channel each in-flight request belongs to, so a response for a channel the
  // user has since navigated away from is discarded instead of leaking into the new view.
  const activeChannelRef = useRef(activeChannel);
  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  const activeChannelObj = channels.find((c) => c.id === activeChannel) ?? null;

  // Right-sidebar roster for a PRIVATE channel: GET /channels/{id}/members only returns
  // explicit channel_members rows (see channel.api.ts's listChannelMembers), not Group
  // owners/moderators who can access the channel purely via their manager authority --
  // re-fetched below whenever the active channel changes. Guarded by activeChannelRef (same
  // pattern as the messages-loading effect above/below) so a slow response for a channel the
  // user has since navigated away from never overwrites the roster of the channel now on screen.
  useEffect(() => {
    if (!activeChannelObj?.is_private) {
      setChannelMembers([]);
      setIsChannelMembersLoading(false);
      setChannelMembersError(null);
      return;
    }
    const channelId = activeChannelObj.id;
    let cancelled = false;
    setIsChannelMembersLoading(true);
    setChannelMembersError(null);
    listChannelMembers(channelId)
      .then((data) => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        setChannelMembers(data);
      })
      .catch((err) => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        setChannelMembers([]);
        setChannelMembersError(err instanceof ApiError ? err.message : 'Không thể tải danh sách thành viên kênh riêng tư.');
      })
      .finally(() => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        setIsChannelMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChannelObj?.id, activeChannelObj?.is_private]);

  // Right-sidebar member list: a public channel's access derives entirely from Group
  // membership, so it keeps showing every active Group member (unchanged behavior). A
  // private channel's accessible-user set is different -- explicit channel_members PLUS
  // Group owner/moderators, who can access a private channel via manager authority alone
  // (channel_router._require_channel_member_access) without ever getting a channel_members
  // row. Composed frontend-side from the two already-authorized lists above rather than
  // having the backend fabricate channel_members rows for managers (see channel.api.ts's
  // listChannelMembers doc comment) -- this is presentation only, it grants no new access:
  // every user included here already independently passed backend authorization to be
  // countable as a participant of this channel. Deduped by user_id; when a channel member is
  // also a tracked active Group member, the existing GroupMember object is reused as-is (so
  // "Điều hành viên"/"Host" labels and owner-only promote/demote/remove controls keep working
  // unchanged) rather than only surfacing a bare UserSummary.
  const displayedMembers = useMemo(
    () => composeDisplayedMembers(!!activeChannelObj?.is_private, activeMembers, channelMembers, group?.id ?? ''),
    [activeChannelObj?.is_private, activeMembers, channelMembers, group?.id]
  );

  // Which `displayedMembers` rows have an explicit channel_members row for the active
  // Channel -- i.e. which of them "Xóa khỏi kênh" (DELETE /channels/{id}/members/{user_id})
  // can actually act on. A Group owner/moderator shown only via the manager-access fallback
  // in composeDisplayedMembers is deliberately NOT in this set (see GroupMembersPanel's prop
  // doc) -- there is no channel_members row to delete for them.
  const explicitChannelMemberUserIds = useMemo(
    () => new Set(channelMembers.map((cm) => cm.user_id)),
    [channelMembers]
  );

  useEffect(() => {
    const conversationId = activeChannelObj?.conversation_id ?? null;
    const channelId = activeChannel;
    
    setMessagesError(null);
    setSendMessageError(null);
    
    if (!channelId || !conversationId) {
      setMessages([]);
      setIsMessagesLoading(false);
      return;
    }

    let cancelled = false;

    // 1. SWR - Thử lấy từ cache trước
    const cached = chatCache.get(conversationId);
    if (cached && cached.length > 0) {
      setMessages(cached);
      // Nếu có cache, không hiện loading (để tạo cảm giác 0ms)
    } else {
      setMessages([]);
      setIsMessagesLoading(true);
    }

    // 2. Fetch ngầm dữ liệu mới
    listConversationMessages(conversationId)
      .then((res) => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        // Backend returns newest-first; reverse for standard oldest-to-newest chat display.
        const newMessages = [...res.items].reverse();
        setMessages(newMessages);
        chatCache.set(conversationId, newMessages);
      })
      .catch((err) => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        setMessagesError(err instanceof ApiError ? err.message : 'Không thể tải tin nhắn.');
      })
      .finally(() => {
        if (cancelled || activeChannelRef.current !== channelId) return;
        setIsMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChannel, activeChannelObj?.conversation_id]);

  // Live-appends new Channel messages (from any sender) as they're persisted, on top of
  // the REST history load above. Scoped to the active channel's conversation only -- see
  // useChannelMessagesRealtime for the RLS-backed access control this relies on.
  useChannelMessagesRealtime(activeChannelObj?.conversation_id ?? null, (incoming) => {
    setMessages((prev) => appendMessageDeduped(prev, incoming));
  });

  const updateMessageReactions = (messageId: string, reactions: MessageReactionSummary[]) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  };
  useMessageReactionsRealtime(activeChannelObj?.conversation_id ?? null, updateMessageReactions);
  const handleReactionSelect = useMessageReactionActions(updateMessageReactions);

  // Auto-scroll chat to bottom on new message or channel change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel, mainView]);

  // Study Rooms that can still be joined/watched (mirrors the backend's can_join_room lifecycle gate).
  const openRooms = studyRooms.filter((r) => r.status !== 'ended');
  const activeRoom = openRooms.find((r) => r.id === activeRoomId) ?? openRooms[0] ?? null;
  const liveRoomCount = openRooms.filter((r) => r.status === 'active').length;
  const activeRoomHost = activeRoom ? groupMembers.find((m) => m.user_id === activeRoom.host_id)?.user : undefined;
  const activeRoomIdForMembers = mainView === 'rooms' ? activeRoom?.id ?? null : null;

  // People currently inside the selected room (active_only) -- shown on the room card.
  const [roomPresence, setRoomPresence] = useState<{ roomId: string; members: StudyRoomMember[] } | null>(null);
  const [roomPresenceReload, setRoomPresenceReload] = useState(0);
  useStudyRoomMembersRealtime(activeRoomIdForMembers, () => setRoomPresenceReload((n) => n + 1));
  useEffect(() => {
    if (!activeRoomIdForMembers) return;
    let cancelled = false;
    listStudyRoomMembers(activeRoomIdForMembers, true)
      .then((members) => { if (!cancelled) setRoomPresence({ roomId: activeRoomIdForMembers, members }); })
      .catch(() => { if (!cancelled) setRoomPresence({ roomId: activeRoomIdForMembers, members: [] }); });
    return () => { cancelled = true; };
  }, [activeRoomIdForMembers, roomPresenceReload]);
  const activeRoomPresence = roomPresence && roomPresence.roomId === activeRoomIdForMembers ? roomPresence.members : null;

  const countBadge = (count: number) => (
    <span style={{minWidth: 22, padding: '1px 7px', borderRadius: 10, background: '#E2E8F0', color: '#475569', fontSize: 12, fontWeight: 600, textAlign: 'center', boxSizing: 'border-box'}}>{count}</span>
  );
  // One sidebar entry per feature; sub-items (channels, rooms) are tabs in the main header.
  const workspaceNav = [
    { key: 'tasks' as const, label: 'Bảng nhiệm vụ', icon: ListChecks, meta: null },
    { key: 'chat' as const, label: 'Kênh chat', icon: MessagesSquare, meta: isChannelsLoading ? null : countBadge(channels.length) },
    {
      key: 'rooms' as const, label: 'Phòng học', icon: Video,
      meta: liveRoomCount > 0
        ? <span style={{display: 'flex', alignItems: 'center', gap: 5, padding: '1px 8px', borderRadius: 10, background: '#D1FAE5', color: '#047857', fontSize: 11, fontWeight: 700}}><span className="workspace-live-dot" style={{width: 6, height: 6, borderRadius: '50%', background: '#10B981'}} />{liveRoomCount} LIVE</span>
        : isRoomsLoading ? null : countBadge(openRooms.length),
    },
    { key: 'documents' as const, label: 'Tài liệu', icon: FileText, meta: resourcesLoading ? null : countBadge(resources.length) },
  ];

  const headerMenuStyle: React.CSSProperties = {position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 180, padding: 6, background: 'white', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 10px 25px -5px rgba(15,23,42,0.15), 0 8px 10px -6px rgba(15,23,42,0.1)'};
  const headerMenuItemStyle = (danger = false): React.CSSProperties => ({width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', borderRadius: 6, background: 'transparent', color: danger ? '#DC2626' : '#0F172A', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left'});

  const handleJoinRoom = (roomId: string) => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    navigate(`/room/${roomId}`);
  };

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    const conversationId = activeChannelObj?.conversation_id ?? null;
    if ((!trimmed && !imageAttachment.hasImage) || !conversationId || isSendingMessage || imageAttachment.isUploading || messageBan) return;

    const targetChannelId = activeChannel;
    setIsSendingMessage(true);
    setSendMessageError(null);

    const isTextOnly = !imageAttachment.hasImage;
    const tempId = `temp-${Date.now()}`;
    let sent: Message | null = null;

    if (isTextOnly && activeChannelRef.current === targetChannelId) {
      const tempMsg: Message = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: currentUser.id,
        content: trimmed,
        attachment_path: null,
        attachment_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sender: {
          id: currentUser.id,
          username: null,
          display_name: currentUser.name,
          avatar_url: currentUser.avatarUrl || null,
          role: 'user',
        },
        reactions: []
      };
      setMessages((prev) => appendMessageDeduped(prev, tempMsg));
      setChatInput('');
    }

    try {
      // Upload first, create the message second
      const attachmentPath = imageAttachment.hasImage ? await imageAttachment.uploadImage(conversationId) : null;
      sent = await sendConversationMessage(conversationId, { content: trimmed || null, attachment_path: attachmentPath });
      
      if (activeChannelRef.current === targetChannelId) {
        if (isTextOnly) {
          setMessages((prev) => prev.map(m => m.id === tempId ? sent! : m));
        } else {
          setMessages((prev) => appendMessageDeduped(prev, sent!));
          setChatInput('');
          imageAttachment.clearImage();
        }
      }

      // Optimistically update group streak on the client side
      setGroup((prev) => {
        if (!prev) return prev;
        const streakObj = prev.streak || { current_streak: 0, highest_streak: 0, today_messages_count: 0, today_study_minutes: 0 };
        const newCount = streakObj.today_messages_count + 1;
        
        let newStreak = streakObj.current_streak;
        let newHighest = streakObj.highest_streak;
        
        // If it crosses the threshold of 5 messages today, and study minutes haven't already crossed 10
        if (newCount === 5 && streakObj.today_study_minutes < 10) {
          newStreak += 1;
          if (newStreak > newHighest) newHighest = newStreak;
        }
        
        return {
          ...prev,
          streak: {
            ...streakObj,
            today_messages_count: newCount,
            current_streak: newStreak,
            highest_streak: newHighest
          }
        };
      });

    } catch (err) {
      if (isTextOnly && activeChannelRef.current === targetChannelId) {
        setMessages((prev) => prev.filter(m => m.id !== tempId));
        setChatInput(trimmed); // Restore input
      }
      setSendMessageError(err instanceof ApiError ? err.message : 'Không thể gửi tin nhắn.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleChatImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) imageAttachment.selectImage(picked);
    e.target.value = '';
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  const memberDisplay = (member: GroupMember) => {
    const isSelf = member.user_id === currentUserId;
    const name = isSelf ? `${currentUser.name} (Bạn)` : getDisplayName(member.user);
    return {
      name,
      initials: isSelf ? currentUser.initials : getAvatarInitials(name),
      color: isSelf ? currentUser.color : getAvatarColor(name),
      avatarUrl: isSelf ? currentUser.avatarUrl : member.user.avatar_url,
    };
  };

  // GroupMemberResponse/MessageResponse now carry a real `user`/`sender` UserSummary (see
  // app/profiles/dto/profile_dto.py) -- resolved server-side via an eager-loaded Profile
  // join, not a per-sender frontend lookup.
  const senderDisplay = (message: Message) => {
    const isSelf = message.sender_id === currentUserId;
    const name = isSelf ? `${currentUser.name} (Bạn)` : getDisplayName(message.sender);
    // message.sender.role is the platform-wide moderator/admin role (app/db/enums.py
    // ProfileRole) -- deliberately distinct from GroupMember.role ('owner'/'moderator'/
    // 'member', the group's own điều hành viên concept used elsewhere in this file, e.g.
    // isGroupManager). A platform moderator's messages get a highlighted badge/color here
    // regardless of their role within this particular group.
    const isModerator = message.sender.role === 'moderator' || message.sender.role === 'admin';
    return {
      name,
      initials: isSelf ? currentUser.initials : getAvatarInitials(name),
      color: isSelf ? currentUser.color : getAvatarColor(name),
      avatarUrl: isSelf ? currentUser.avatarUrl : message.sender.avatar_url,
      isModerator,
    };
  };

  const formatMessageTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // --- Loading / error states (real backend data drives all of these) ---

  if (!groupId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 64px)', gap: 12, color: '#64748B' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#0F172A' }}>Thiếu mã nhóm học</div>
      </div>
    );
  }

  if (isGroupLoading) {
    return (
      <div style={{ display: 'flex', height: 'calc(100vh - 64px)', width: '100%', overflow: 'hidden' }}>
        {/* Left sidebar skeleton */}
        <div style={{ width: 280, flexShrink: 0, background: '#F8FAFC', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Group header */}
          <div style={{ padding: 16, borderBottom: '1px solid #E2E8F0' }}>
            <div className="skeleton-pulse" style={{ height: 18, borderRadius: 6, marginBottom: 8 }} />
            <div className="skeleton-pulse" style={{ width: '60%', height: 12, borderRadius: 4 }} />
          </div>
          {/* Channels */}
          <div style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="skeleton-pulse" style={{ width: '50%', height: 11, borderRadius: 4, marginBottom: 4 }} />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton-pulse" style={{ height: 32, borderRadius: 6 }} />
            ))}
            <div className="skeleton-pulse" style={{ width: '50%', height: 11, borderRadius: 4, marginTop: 12, marginBottom: 4 }} />
            {[...Array(2)].map((_, i) => (
              <div key={i} className="skeleton-pulse" style={{ height: 80, borderRadius: 8 }} />
            ))}
          </div>
        </div>
        {/* Center chat area skeleton */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white' }}>
          <div style={{ height: 60, borderBottom: '1px solid #E2E8F0', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="skeleton-pulse" style={{ width: 24, height: 24, borderRadius: 4 }} />
            <div className="skeleton-pulse" style={{ width: 120, height: 18, borderRadius: 6 }} />
          </div>
          <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[false, true, false, true, false].map((isSelf, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, flexDirection: isSelf ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                <div className="skeleton-pulse" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                <div className="skeleton-pulse" style={{ width: 140 + i * 20, height: 40, borderRadius: 12 }} />
              </div>
            ))}
          </div>
        </div>
        {/* Right member column removed from the group workspace. */}
        <div style={{ display: 'none' }}>
          <div className="skeleton-pulse" style={{ width: '60%', height: 12, borderRadius: 4 }} />
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="skeleton-pulse" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
              <div className="skeleton-pulse" style={{ flex: 1, height: 14, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !group) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 64px)', gap: 12, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#0F172A' }}>
          {loadError?.status === 404 ? 'Không tìm thấy nhóm học' : 'Không thể tải nhóm học'}
        </div>
        {loadError?.message && <div style={{ color: '#64748B', fontSize: 14, maxWidth: 420 }}>{loadError.message}</div>}
        <button
          onClick={() => navigate('/groups')}
          style={{ marginTop: 8, padding: '10px 18px', background: '#00236F', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Quay lại danh sách nhóm
        </button>
      </div>
    );
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', width: '100%', overflow: 'hidden'}}>
        {/* Main Content - Discord-like 3-pane layout */}
        <div style={{display: 'flex', flex: 1, overflow: 'hidden', background: 'white', width: '100%'}}>

            {/* Left Sidebar - Channels & Rooms */}
            <div style={{width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC', borderRight: '1px solid #E2E8F0'}}>
                {/* Group Info Header with Discord-style Menu */}
                <div style={{position: 'relative', borderBottom: '1px solid #E2E8F0'}}>
                    <div
                        onClick={() => setShowGroupMenu(!showGroupMenu)}
                        style={{
                            padding: '16px',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: group.background_url
                                ? `linear-gradient(180deg, rgba(15,23,42,0.15), rgba(15,23,42,0.55)), url(${group.background_url})`
                                : showGroupMenu ? '#F1F5F9' : 'transparent',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            transition: 'background 0.2s'
                        }}
                    >
                        <div style={{flex: 1, minWidth: 0, paddingRight: 8}}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{color: group.background_url ? '#FFFFFF' : '#0B1C30', fontSize: 16, fontFamily: 'Inter', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                    {group.name}
                                </div>
                                {(() => {
                                    const currentStreak = group.streak?.current_streak || 0;
                                    let color = '#3B82F6';
                                    if (currentStreak === 0) color = '#94A3B8';
                                    else if (currentStreak < 3) color = '#F59E0B';
                                    else if (currentStreak < 10) color = '#EA580C';
                                    else if (currentStreak < 30) color = '#E11D48';

                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(255,255,255,0.9)', padding: '2px 6px', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.1)', border: `1px solid ${color}33` }}>
                                            <Flame size={14} color={color} fill={color} />
                                            <span style={{ fontSize: 12, fontWeight: 700, color: color, fontFamily: 'Inter' }}>{currentStreak}</span>
                                        </div>
                                    );
                                })()}
                            </div>
                            <div style={{color: group.background_url ? '#E2E8F0' : '#64748B', fontSize: 12, fontFamily: 'Inter', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6}}>
                                <span style={{padding: '2px 6px', background: group.is_public ? '#DCFCE7' : '#FEF3C7', color: group.is_public ? '#15803D' : '#B45309', borderRadius: 4, fontSize: 10, fontWeight: '700'}}>
                                    {group.is_public ? 'Public' : 'Private'}
                                </span>
                                <span>• {activeMembers.length} thành viên</span>
                            </div>
                        </div>
                        <ChevronDown size={18} color={group.background_url ? '#FFFFFF' : '#64748B'} style={{transform: showGroupMenu ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s'}} />
                    </div>

                    {/* Discord-style Dropdown Menu */}
                    {showGroupMenu && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 8,
                                right: 8,
                                zIndex: 50,
                                background: 'white',
                                borderRadius: 8,
                                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                                border: '1px solid #E2E8F0',
                                padding: '6px',
                                marginTop: 4,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2
                            }}
                        >
                            {/* Group settings modal is reachable by owner OR active moderator -- the
                                background-image section inside it is owner-or-moderator (POST/DELETE
                                /groups/{id}/background), while name/description/visibility stay
                                owner-only (backend rejects PUT /groups/{id} for anyone else,
                                is_group_owner) and are disabled inside the modal for a non-owner. */}
                            {isGroupManager && (
                                <div
                                    onClick={() => { setIsSettingsModalOpen(true); setShowGroupMenu(false); }}
                                    style={{padding: '8px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: '500', color: '#1E293B', cursor: 'pointer'}}
                                    onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Settings size={16} color="#475569" /> Cài đặt nhóm
                                </div>
                            )}

                            <div
                                onClick={() => { alert('Đã sao chép liên kết mời tham gia nhóm học!'); setShowGroupMenu(false); }}
                                style={{padding: '8px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: '500', color: '#1E293B', cursor: 'pointer'}}
                                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <UserPlus size={16} color="#475569" /> Mời thêm người
                            </div>

                            <div style={{height: 1, background: '#E2E8F0', margin: '4px 0'}} />

                            <div
                                onClick={() => {
                                    if (isLeaving) return;
                                    setShowGroupMenu(false);
                                    handleLeaveGroup();
                                }}
                                style={{padding: '8px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: '500', color: isLeaving ? '#F1A9A0' : '#DC2626', cursor: isLeaving ? 'not-allowed' : 'pointer'}}
                                onMouseOver={e => !isLeaving && (e.currentTarget.style.background = '#FEF2F2')}
                                onMouseOut={e => !isLeaving && (e.currentTarget.style.background = 'transparent')}
                            >
                                <LogOut size={16} color={isLeaving ? '#F1A9A0' : '#DC2626'} /> {isLeaving ? 'Đang rời nhóm...' : 'Rời nhóm học'}
                            </div>
                        </div>
                    )}
                </div>

                {leaveError && (
                    <div style={{ margin: '12px 12px 0 12px', padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 12.5 }}>
                        {leaveError}
                    </div>
                )}

                {/* Group Notes -- paper stack, one focused Note at a time (see
                    NotesStackPanel); real, group-scoped, persisted via backend */}
                <NotesStackPanel {...groupNotesController} isGroupManager={isGroupManager} />

                {/* Workspace navigation -- one entry per feature. Channels and rooms are no longer
                    listed here; they open as tabs in the main area header (WorkspaceTabs). */}
                <nav aria-label="Không gian nhóm" style={{flex: 1, overflowY: 'auto', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2}}>
                    <div style={{padding: '4px 12px 8px', color: '#94A3B8', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase'}}>Không gian nhóm</div>
                    {workspaceNav.map(item => {
                        const isActive = mainView === item.key;
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className="workspace-nav-item"
                                aria-current={isActive ? 'page' : undefined}
                                onClick={() => { setMainView(item.key); setOpenHeaderMenu(null); }}
                                style={{position: 'relative', width: '100%', minHeight: 40, padding: '0 10px 0 14px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', borderRadius: 8, background: isActive ? '#E0E7FF' : 'transparent', color: isActive ? '#00236F' : '#475569', fontSize: 14, fontWeight: isActive ? 600 : 500, cursor: 'pointer', textAlign: 'left'}}
                            >
                                {isActive && <span aria-hidden="true" style={{position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 3, background: '#00236F'}} />}
                                <Icon size={18} color={isActive ? '#00236F' : '#64748B'} />
                                <span style={{flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{item.label}</span>
                                {item.meta}
                            </button>
                        );
                    })}
                </nav>
                <input
                    ref={resourceFileInputRef}
                    type="file"
                    style={{display: 'none'}}
                    onChange={handleResourceFileSelected}
                    disabled={isUploadingResource}
                />
            </div>

            {/* Center - Main Area */}
            {mainView === 'chat' ? (
                <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'white'}}>

                    <WorkspaceTabs
                        title="Kênh chat"
                        titleIcon={<MessagesSquare size={18} color="#64748B" />}
                        ariaLabel="Kênh chat của nhóm"
                        tabs={channels.map(channel => ({
                            id: channel.id,
                            label: channel.name,
                            icon: channel.is_private ? <Lock size={14} /> : <Hash size={15} />,
                            title: channel.description ? `#${channel.name} — ${channel.description}` : `#${channel.name}`,
                        }))}
                        activeId={activeChannelObj?.id ?? null}
                        onSelect={id => { setActiveChannel(id); setOpenHeaderMenu(null); }}
                        loading={isChannelsLoading}
                        emptyLabel="Chưa có kênh nào"
                        actions={<>
                            <HeaderIconButton label="Tham gia kênh riêng tư bằng mã" onClick={() => setIsJoinChannelModalOpen(true)}><Ticket size={17} /></HeaderIconButton>
                            {isGroupManager && (
                                <HeaderIconButton label="Tạo kênh chat mới" onClick={() => { setCreateChannelError(null); setIsCreateChannelModalOpen(true); }}><Plus size={18} /></HeaderIconButton>
                            )}
                            {isGroupManager && activeChannelObj && (
                                <div data-header-menu style={{position: 'relative'}}>
                                    <HeaderIconButton label={`Tùy chọn kênh #${activeChannelObj.name}`} active={openHeaderMenu === 'channel'} onClick={() => setOpenHeaderMenu(openHeaderMenu === 'channel' ? null : 'channel')}><MoreVertical size={17} /></HeaderIconButton>
                                    {openHeaderMenu === 'channel' && (
                                        <div role="menu" style={headerMenuStyle}>
                                            {activeChannelObj.is_private && (
                                                <button type="button" role="menuitem" className="workspace-icon-button" style={headerMenuItemStyle()} onClick={() => { setOpenHeaderMenu(null); setChannelToInvite(activeChannelObj); }}>
                                                    <UserPlus size={16} color="#00236F" /> Mời vào kênh
                                                </button>
                                            )}
                                            <button type="button" role="menuitem" className="workspace-icon-button" style={headerMenuItemStyle(true)} onClick={() => { setOpenHeaderMenu(null); setDeleteChannelError(null); setChannelPendingDelete(activeChannelObj); }}>
                                                <Trash2 size={16} color="#DC2626" /> Xóa kênh
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>}
                    />

                    {/* Messages List */}
                    <div style={{flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20}}>

                        {!activeChannelObj ? (
                            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '32px 0', color: '#94A3B8'}}>
                                <Hash size={48} color="#CBD5E1" style={{marginBottom: 16}} />
                                <div style={{fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 8}}>
                                    Nhóm học chưa có kênh chat nào
                                </div>
                            </div>
                        ) : isMessagesLoading ? (
                            <div style={{display: 'flex', justifyContent: 'center', margin: '32px 0', color: '#94A3B8', fontSize: 14}}>
                                Đang tải tin nhắn...
                            </div>
                        ) : messagesError ? (
                            <div style={{margin: '16px 0', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 13.5}}>
                                {messagesError}
                            </div>
                        ) : messages.length === 0 ? (
                            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '32px 0', color: '#94A3B8'}}>
                                <Hash size={48} color="#CBD5E1" style={{marginBottom: 16}} />
                                <div style={{fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 8}}>
                                    Chào mừng đến với #{activeChannelObj.name}!
                                </div>
                                <div style={{fontSize: 14}}>Đây là sự khởi đầu của kênh #{activeChannelObj.name}.</div>
                            </div>
                        ) : (
                            // Keyed by channel so a crash here (and the boundary it trips) resets
                            // on channel change instead of showing the fallback forever -- see
                            // ErrorBoundary.tsx.
                            <ErrorBoundary
                                key={activeChannelObj.conversation_id ?? activeChannel}
                                fallback={
                                    <div style={{margin: '16px 0', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 13.5}}>
                                        Không thể hiển thị tin nhắn trong kênh này.
                                    </div>
                                }
                            >
                                {messages.map((msg) => {
                                    const display = senderDisplay(msg);
                                    const isSelf = msg.sender_id === currentUserId;
                                    return (
                                        <div
                                            key={msg.id}
                                            style={{
                                                display: 'flex',
                                                gap: 16,
                                                padding: display.isModerator ? '6px 10px' : 0,
                                                margin: display.isModerator ? '-6px -10px' : 0,
                                                background: display.isModerator ? '#F5F3FF' : 'transparent',
                                                borderLeft: display.isModerator ? '3px solid #7C3AED' : '3px solid transparent',
                                                borderRadius: display.isModerator ? 8 : 0,
                                            }}
                                        >
                                            <>
                                                <div style={{position: 'relative', flexShrink: 0}}>
                                                    {display.avatarUrl ? (
                                                        <img src={display.avatarUrl} alt={display.name} style={{width: 40, height: 40, borderRadius: '50%', objectFit: 'cover'}} />
                                                    ) : (
                                                        <div style={{width: 40, height: 40, borderRadius: '50%', background: display.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700}}>
                                                            {display.initials}
                                                        </div>
                                                    )}
                                                    {display.isModerator && (
                                                        <div
                                                            title="Kiểm duyệt viên"
                                                            style={{position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: '#7C3AED', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                                                        >
                                                            <ShieldCheck size={10} color="white" strokeWidth={3} />
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                            <div>
                                                <div style={{display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4}}>
                                                    <span style={{color: display.isModerator ? '#7C3AED' : '#0F172A', fontSize: 15, fontWeight: '600'}}>{display.name}</span>
                                                    {display.isModerator && (
                                                        <span style={{display: 'flex', alignItems: 'center', gap: 3, color: '#7C3AED', fontSize: 11.5, fontWeight: 700, background: '#EDE9FE', padding: '1px 6px', borderRadius: 4}}>
                                                            <ShieldCheck size={11} /> Kiểm duyệt viên
                                                        </span>
                                                    )}
                                                    <span style={{color: '#94A3B8', fontSize: 12}}>{formatMessageTime(msg.created_at)}</span>
                                                </div>
                                                {msg.content && (
                                                    <div style={{color: '#334155', fontSize: 15, lineHeight: '1.5', wordBreak: 'break-word', marginBottom: msg.attachment_path ? 8 : 0}}>
                                                        {msg.content}
                                                    </div>
                                                )}
                                                {msg.attachment_path && <MessageAttachmentImage messageId={msg.id} initialUrl={msg.attachment_url} />}
                                                <MessageReactions
                                                    reactions={msg.reactions}
                                                    isSelf={isSelf}
                                                    onSelect={(emoji) => handleReactionSelect(msg, emoji)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </ErrorBoundary>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Chat Input */}
                    <div style={{padding: '0 24px 24px 24px'}}>
                        {messageBan && (
                            <div style={{marginBottom: 8}}>
                                <RestrictionBanner ban={messageBan} actionLabel="nhắn tin" />
                            </div>
                        )}
                        {(sendMessageError || imageAttachment.uploadError || imageAttachment.pickError) && (
                            <div style={{marginBottom: 8, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 12.5}}>
                                {sendMessageError || imageAttachment.uploadError?.message || imageAttachment.pickError}
                            </div>
                        )}
                        {imageAttachment.previewUrl && (
                            <SelectedImagePreview
                                previewUrl={imageAttachment.previewUrl}
                                onRemove={imageAttachment.clearImage}
                                disabled={isSendingMessage || imageAttachment.isUploading}
                            />
                        )}
                        <div style={{background: '#F1F5F9', borderRadius: 8, display: 'flex', alignItems: 'center', padding: '12px 16px', border: '1px solid #E2E8F0', transition: 'border-color 0.2s', gap: 8}}>
                            <input
                                type="file"
                                accept={ALLOWED_IMAGE_ACCEPT}
                                ref={chatImageInputRef}
                                onChange={handleChatImageSelected}
                                style={{display: 'none'}}
                            />
                            <button
                                type="button"
                                onClick={() => chatImageInputRef.current?.click()}
                                disabled={!activeChannelObj?.conversation_id || isSendingMessage || !!messageBan}
                                style={{background: 'transparent', border: 'none', padding: 0, display: 'flex', cursor: (!activeChannelObj?.conversation_id || isSendingMessage || messageBan) ? 'not-allowed' : 'pointer', opacity: (!activeChannelObj?.conversation_id || isSendingMessage || messageBan) ? 0.5 : 1}}
                                aria-label="Đính kèm ảnh"
                            >
                              <ImageIcon size={20} color="#64748B" />
                            </button>
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={handleKeyPress}
                                disabled={!activeChannelObj?.conversation_id || isSendingMessage || !!messageBan}
                                placeholder={messageBan ? 'Bạn đang bị hạn chế nhắn tin...' : activeChannelObj ? `Nhắn tin cho #${activeChannelObj.name}...` : 'Chọn một kênh để bắt đầu'}
                                style={{border: 'none', background: 'transparent', flex: 1, outline: 'none', fontSize: 15, color: '#0F172A'}}
                            />
                            <button
                                onClick={handleSendMessage}
                                disabled={(!chatInput.trim() && !imageAttachment.hasImage) || !activeChannelObj?.conversation_id || isSendingMessage || imageAttachment.isUploading || !!messageBan}
                                style={{background: 'transparent', border: 'none', padding: 0, display: 'flex', cursor: ((chatInput.trim() || imageAttachment.hasImage) && !isSendingMessage && !imageAttachment.isUploading && !messageBan) ? 'pointer' : 'not-allowed', opacity: ((chatInput.trim() || imageAttachment.hasImage) && !isSendingMessage && !imageAttachment.isUploading && !messageBan) ? 1 : 0.5}}
                            >
                              <Send size={20} color="#00236F" />
                            </button>
                        </div>
                    </div>
                </div>
            ) : mainView === 'rooms' ? (
                <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC'}}>
                    <WorkspaceTabs
                        title="Phòng học"
                        titleIcon={<Video size={18} color="#64748B" />}
                        ariaLabel="Phòng học của nhóm"
                        tabs={openRooms.map(room => ({
                            id: room.id,
                            label: room.name,
                            icon: room.is_private ? <Lock size={15} /> : <Video size={15} />,
                            indicator: room.status === 'active'
                                ? <span className="workspace-live-dot" aria-label="Đang diễn ra" style={{width: 7, height: 7, borderRadius: '50%', background: '#10B981', flexShrink: 0}} />
                                : undefined,
                        }))}
                        activeId={activeRoom?.id ?? null}
                        onSelect={id => { setActiveRoomId(id); setOpenHeaderMenu(null); }}
                        loading={isRoomsLoading}
                        emptyLabel="Chưa có phòng học nào đang mở"
                        actions={<>
                            <HeaderIconButton label="Tham gia phòng học bằng mã" onClick={() => setIsJoinRoomModalOpen(true)}><Ticket size={17} /></HeaderIconButton>
                            {isGroupManager && (
                                <HeaderIconButton label="Tạo phòng học mới" onClick={() => { setCreateRoomError(null); setIsCreateRoomModalOpen(true); }}><Plus size={18} /></HeaderIconButton>
                            )}
                            {canDeleteRoom && activeRoom && (
                                <div data-header-menu style={{position: 'relative'}}>
                                    <HeaderIconButton label={`Tùy chọn phòng ${activeRoom.name}`} active={openHeaderMenu === 'room'} onClick={() => setOpenHeaderMenu(openHeaderMenu === 'room' ? null : 'room')}><MoreVertical size={17} /></HeaderIconButton>
                                    {openHeaderMenu === 'room' && (
                                        <div role="menu" style={headerMenuStyle}>
                                            <button type="button" role="menuitem" className="workspace-icon-button" style={headerMenuItemStyle(false)} onClick={() => { setOpenHeaderMenu(null); setRoomToInvite(activeRoom); }}>
                                                <Ticket size={16} color="#475569" /> Mời bằng mã
                                            </button>
                                            <button type="button" role="menuitem" className="workspace-icon-button" style={headerMenuItemStyle(true)} onClick={() => { setOpenHeaderMenu(null); setDeleteRoomError(null); setRoomPendingDelete(activeRoom); }}>
                                                <Trash2 size={16} color="#DC2626" /> Xóa phòng học
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>}
                    />

                    <div style={{flex: 1, overflowY: 'auto', padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'flex-start'}}>
                        {isRoomsLoading ? (
                            <div className="skeleton-pulse" style={{width: '100%', maxWidth: 680, height: 360, borderRadius: 16}} />
                        ) : !activeRoom ? (
                            <div style={{marginTop: 48, maxWidth: 380, textAlign: 'center'}}>
                                <div style={{width: 64, height: 64, margin: '0 auto 16px', borderRadius: 16, background: '#EEF2FF', display: 'grid', placeItems: 'center'}}>
                                    <Video size={28} color="#4338CA" />
                                </div>
                                <div style={{fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6}}>Chưa có phòng học nào đang mở</div>
                                <div style={{fontSize: 14, color: '#64748B', lineHeight: 1.5, marginBottom: 20}}>
                                    {isGroupManager ? 'Tạo phòng để cả nhóm học cùng qua video và bảng trắng.' : 'Khi quản trị viên mở phòng, phòng sẽ xuất hiện ở đây.'}
                                </div>
                                <div style={{display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap'}}>
                                    {isGroupManager && (
                                        <button type="button" onClick={() => { setCreateRoomError(null); setIsCreateRoomModalOpen(true); }} style={{display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', borderRadius: 8, background: '#00236F', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer'}}>
                                            <Plus size={16} /> Tạo phòng học
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setIsJoinRoomModalOpen(true)} style={{display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: '1px solid #CBD5E1', borderRadius: 8, background: 'white', color: '#334155', fontSize: 14, fontWeight: 600, cursor: 'pointer'}}>
                                        <Ticket size={16} /> Tham gia bằng mã
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <article key={activeRoom.id} style={{width: '100%', maxWidth: 680, background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,0.06)'}}>
                                <div style={{padding: '28px 28px 24px', display: 'flex', alignItems: 'center', gap: 16, background: activeRoom.status === 'active' ? 'linear-gradient(135deg, #ECFDF5, #D1FAE5)' : 'linear-gradient(135deg, #EFF6FF, #E0E7FF)'}}>
                                    <div style={{width: 56, height: 56, flexShrink: 0, borderRadius: 14, background: 'white', display: 'grid', placeItems: 'center', boxShadow: '0 1px 3px rgba(15,23,42,0.08)'}}>
                                        <Video size={26} color={activeRoom.status === 'active' ? '#059669' : '#4338CA'} />
                                    </div>
                                    <div style={{minWidth: 0}}>
                                        {activeRoom.status === 'active' ? (
                                            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 999, background: '#10B981', color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: 0.4}}>
                                                <span className="workspace-live-dot" style={{width: 6, height: 6, borderRadius: '50%', background: 'white'}} /> ĐANG DIỄN RA
                                            </span>
                                        ) : (
                                            <span style={{display: 'inline-flex', padding: '2px 10px', borderRadius: 999, background: '#FEF3C7', color: '#B45309', fontSize: 11, fontWeight: 700, letterSpacing: 0.4}}>CHỜ BẮT ĐẦU</span>
                                        )}
                                        {activeRoom.is_private && (
                                            <span style={{display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, padding: '2px 10px', borderRadius: 999, background: '#1E293B', color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, verticalAlign: 'top'}}>
                                                <Lock size={11} /> PHÒNG ẨN
                                            </span>
                                        )}
                                        <h2 style={{margin: '8px 0 0', fontSize: 22, fontWeight: 700, color: '#0F172A', lineHeight: 1.3, overflowWrap: 'anywhere'}}>{activeRoom.name}</h2>
                                    </div>
                                </div>

                                <div style={{padding: 28, display: 'grid', gap: 24}}>
                                    <p style={{margin: 0, fontSize: 15, lineHeight: 1.6, color: activeRoom.description ? '#334155' : '#94A3B8'}}>
                                        {activeRoom.description || 'Chưa có mô tả cho phòng học này.'}
                                    </p>

                                    <dl style={{margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12}}>
                                        {[
                                            { icon: <UserPlus size={16} color="#64748B" />, label: 'Chủ phòng', value: getDisplayName(activeRoomHost) },
                                            activeRoom.is_private
                                                ? { icon: <Lock size={16} color="#64748B" />, label: 'Quyền vào', value: 'Chỉ người có mã mời' }
                                                : { icon: <Globe size={16} color="#64748B" />, label: 'Quyền vào', value: 'Cả nhóm' },
                                            {
                                                icon: <Clock size={16} color="#64748B" />,
                                                label: activeRoom.status === 'active' && activeRoom.started_at ? 'Bắt đầu lúc' : 'Tạo ngày',
                                                value: activeRoom.status === 'active' && activeRoom.started_at
                                                    ? new Date(activeRoom.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                                    : new Date(activeRoom.created_at).toLocaleDateString('vi-VN'),
                                            },
                                        ].map(item => (
                                            <div key={item.label} style={{padding: '12px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9', minWidth: 0}}>
                                                <dt style={{display: 'flex', alignItems: 'center', gap: 6, color: '#64748B', fontSize: 12, fontWeight: 500}}>{item.icon}{item.label}</dt>
                                                <dd style={{margin: '4px 0 0', color: '#0F172A', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{item.value}</dd>
                                            </div>
                                        ))}
                                    </dl>

                                    <section aria-label="Thành viên đang trong phòng" style={{display: 'grid', gap: 12}}>
                                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
                                            <h3 style={{margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155'}}>
                                                <Users size={16} color="#64748B" /> Đang trong phòng
                                            </h3>
                                            {activeRoomPresence && activeRoomPresence.length > 0 && countBadge(activeRoomPresence.length)}
                                        </div>
                                        {activeRoomPresence === null ? (
                                            <div className="skeleton-pulse" style={{height: 52, borderRadius: 10}} />
                                        ) : activeRoomPresence.length === 0 ? (
                                            <div style={{padding: '14px 16px', borderRadius: 10, border: '1px dashed #CBD5E1', color: '#64748B', fontSize: 13, textAlign: 'center'}}>
                                                Chưa có ai trong phòng. Hãy là người đầu tiên vào học!
                                            </div>
                                        ) : (
                                            <ul style={{margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8}}>
                                                {activeRoomPresence.map((member) => {
                                                    const isSelf = member.user_id === currentUserId;
                                                    const name = getDisplayName(member.user);
                                                    return (
                                                        <li key={member.id} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9', minWidth: 0}}>
                                                            {member.user.avatar_url ? (
                                                                <img src={member.user.avatar_url} alt="" style={{width: 32, height: 32, flexShrink: 0, borderRadius: '50%', objectFit: 'cover'}} />
                                                            ) : (
                                                                <span aria-hidden style={{width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: getAvatarColor(name), color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700}}>{getAvatarInitials(name)}</span>
                                                            )}
                                                            <span style={{minWidth: 0, display: 'grid'}}>
                                                                <span style={{fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{name}{isSelf ? ' (Bạn)' : ''}</span>
                                                                <span style={{fontSize: 11, color: '#64748B'}}>{member.role === 'host' ? 'Chủ phòng' : member.role === 'moderator' ? 'Điều phối' : 'Thành viên'}</span>
                                                            </span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </section>

                                    <button
                                        type="button"
                                        onClick={() => handleJoinRoom(activeRoom.id)}
                                        style={{width: '100%', padding: '13px 0', border: 'none', borderRadius: 10, background: activeRoom.status === 'active' ? '#059669' : '#00236F', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}
                                    >
                                        <Video size={18} /> {activeRoom.status === 'active' ? 'Vào phòng ngay' : 'Tham gia phòng'}
                                    </button>
                                </div>
                            </article>
                        )}
                    </div>
                </div>
            ) : mainView === 'tasks' ? (
                <TaskFlowBoard groupId={groupId ?? ''} />
            ) : (
                <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'white'}}>
                    <div style={{height: 56, flexShrink: 0, padding: '0 16px 0 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#0F172A', fontSize: 15, fontWeight: '700', background: 'white'}}>
                        <span style={{display: 'flex', alignItems: 'center', gap: 8}}><FileText size={18} color="#64748B" /> Tài liệu nhóm</span>
                        <button
                            onClick={() => resourceFileInputRef.current?.click()}
                            disabled={isUploadingResource}
                            style={{display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, background: isUploadingResource ? '#93C5FD' : '#3B82F6', color: 'white', border: 'none', fontSize: 13, fontWeight: 600, cursor: isUploadingResource ? 'not-allowed' : 'pointer'}}
                        >
                            <Plus size={16} /> {isUploadingResource ? 'Đang tải lên...' : 'Tải tài liệu lên'}
                        </button>
                    </div>

                    {resourceUploadError && (
                        <div style={{padding: '10px 24px', fontSize: 13, color: '#B91C1C', background: '#FEF2F2', borderBottom: '1px solid #FECACA'}}>
                            {resourceUploadError.message}
                        </div>
                    )}
                    {resourceDeleteError && (
                        <div style={{padding: '10px 24px', fontSize: 13, color: '#B91C1C', background: '#FEF2F2', borderBottom: '1px solid #FECACA'}}>
                            {resourceDeleteError.message}
                        </div>
                    )}
                    {resourceDownloadError && (
                        <div style={{padding: '10px 24px', fontSize: 13, color: '#B91C1C', background: '#FEF2F2', borderBottom: '1px solid #FECACA'}}>
                            {resourceDownloadError.message}
                        </div>
                    )}

                    {/* Bảng danh sách tài liệu (Zalo Style) */}
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 140px 140px 120px 76px', padding: '16px 24px', borderBottom: '1px solid #E2E8F0', fontSize: 13, color: '#64748B', fontWeight: '500', background: '#F8FAFC'}}>
                        <div>Tên</div>
                        <div>Người tải lên</div>
                        <div>Kích thước</div>
                        <div>Ngày gửi</div>
                        <div />
                    </div>
                    {/* Danh sách file */}
                    <div style={{flex: 1, overflowY: 'auto'}}>
                        {resourcesLoading ? (
                            <div style={{padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14}}>Đang tải danh sách tài liệu...</div>
                        ) : resourcesListError ? (
                            <div style={{padding: 32, textAlign: 'center', color: '#DC2626', fontSize: 14}}>{resourcesListError.message}</div>
                        ) : resources.length === 0 ? (
                            <div style={{padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14}}>Chưa có tài liệu nào trong nhóm này.</div>
                        ) : (
                            resources.map((resource) => (
                                <div
                                    key={resource.id}
                                    style={{display: 'grid', gridTemplateColumns: '1fr 140px 140px 120px 76px', padding: '16px 24px', borderBottom: '1px solid #F1F5F9', alignItems: 'center', transition: 'background 0.2s'}}
                                    onMouseOver={e => e.currentTarget.style.background = '#F8FAFC'}
                                    onMouseOut={e => e.currentTarget.style.background = 'white'}
                                >
                                    <div onClick={() => openResourceFile(resource.id)} style={{display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minWidth: 0}}>
                                        <div style={{width: 36, height: 36, borderRadius: 8, background: '#EFF6FF', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0}}>
                                            <FileText size={20} color="#3B82F6" />
                                        </div>
                                        <div style={{color: '#0F172A', fontSize: 14, fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{resource.name}</div>
                                    </div>
                                    <div style={{color: '#64748B', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{getDisplayName(resource.uploader)}</div>
                                    <div style={{color: '#64748B', fontSize: 13}}>{formatFileSize(resource.file_size)}</div>
                                    <div style={{color: '#64748B', fontSize: 13}}>{new Date(resource.created_at).toLocaleDateString('vi-VN')}</div>
                                    <div style={{display: 'flex', gap: 4}}>
                                        <button
                                            onClick={() => downloadResourceFile(resource.id)}
                                            disabled={pendingDownloadResourceId === resource.id}
                                            title="Tải xuống"
                                            style={{width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: pendingDownloadResourceId === resource.id ? 'not-allowed' : 'pointer', color: pendingDownloadResourceId === resource.id ? '#CBD5E1' : '#94A3B8'}}
                                            onMouseOver={e => { if (pendingDownloadResourceId !== resource.id) { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#3B82F6'; } }}
                                            onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = pendingDownloadResourceId === resource.id ? '#CBD5E1' : '#94A3B8'; }}
                                        >
                                            <Download size={16} />
                                        </button>
                                        {canDeleteResource(resource, isGroupManager) && (
                                            <button
                                                onClick={() => setResourcePendingDelete({ id: resource.id, name: resource.name })}
                                                disabled={pendingDeleteResourceId === resource.id}
                                                title="Xóa tài liệu"
                                                style={{width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: pendingDeleteResourceId === resource.id ? 'not-allowed' : 'pointer', color: '#94A3B8'}}
                                                onMouseOver={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#DC2626'; }}
                                                onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            <div style={{display:'none'}} aria-hidden="true">
            {/* Right Sidebar - Members. Public channel: every active Group member (unchanged).
                Private channel: the composed private-channel roster (see `displayedMembers`
                above) -- shows a skeleton (rather than a stale/incorrect flash of the previous
                channel's list) while that roster is loading, including while switching between
                two private channels. */}
            {isMembersLoading || (activeChannelObj?.is_private && isChannelMembersLoading) ? (
                <div style={{ width: 260, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="skeleton-pulse" style={{ height: 20, width: 100, borderRadius: 4 }}></div>
                    <div className="skeleton-pulse" style={{ height: 48, borderRadius: 8 }}></div>
                    <div className="skeleton-pulse" style={{ height: 48, borderRadius: 8 }}></div>
                    <div className="skeleton-pulse" style={{ height: 48, borderRadius: 8 }}></div>
                </div>
            ) : (
                <GroupMembersPanel
                    members={displayedMembers}
                    currentUserId={currentUserId}
                    currentUser={currentUser}
                    isOwner={isOwner}
                    isGroupManager={isGroupManager}
                    isPrivateChannel={!!activeChannelObj?.is_private}
                    explicitChannelMemberUserIds={explicitChannelMemberUserIds}
                    pendingMemberId={memberActionPendingId}
                    channelActionPendingUserId={channelActionPendingUserId}
                    error={channelMembersError ?? memberActionError ?? channelActionError}
                    onPromote={handlePromoteMember}
                    onDemote={handleDemoteMember}
                    onRemove={handleRemoveMember}
                    onKickFromChannel={handleKickFromChannel}
                    onInviteClick={() => setIsInviteModalOpen(true)}
                />
            )}
            </div>

        </div>

        {group && (
            <InviteModal
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                target={{ groupId: group.id }}
                targetLabel={group.name}
            />
        )}

        {group && isGroupManager && (
            <GroupSettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                group={group}
                isOwner={isOwner}
                onUpdated={(updated) => setGroup(updated)}
            />
        )}

        {channelToInvite && (
            <InviteModal
                isOpen={!!channelToInvite}
                onClose={() => setChannelToInvite(null)}
                target={{ channelId: channelToInvite.id }}
                targetLabel={channelToInvite.name}
            />
        )}

        {roomToInvite && (
            <InviteModal
                isOpen={!!roomToInvite}
                onClose={() => setRoomToInvite(null)}
                target={{ roomId: roomToInvite.id }}
                targetLabel={roomToInvite.name}
            />
        )}

        {/* Dedicated Join Study Room / Join Private Channel entry points -- same reusable
            flow as Join Group on the Groups list page, just target-aware (see
            JoinByCodeModal). A Group/Channel code entered here is rejected with a clear
            mismatch message rather than silently mishandled. */}
        <JoinByCodeModal
            isOpen={isJoinRoomModalOpen}
            onClose={() => setIsJoinRoomModalOpen(false)}
            expectedTarget="study_room"
        />
        <JoinByCodeModal
            isOpen={isJoinChannelModalOpen}
            onClose={() => setIsJoinChannelModalOpen(false)}
            expectedTarget="private_channel"
        />

        {/* Modal: Tạo phòng học mới */}
        {isCreateRoomModalOpen && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div style={{ background: 'white', borderRadius: 12, width: 440, padding: 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)' }}>
                    <button
                        onClick={() => { if (!isCreatingRoom) { setIsCreateRoomModalOpen(false); setCreateRoomError(null); } }}
                        disabled={isCreatingRoom}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: isCreatingRoom ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 18 }}
                    >
                        ✕
                    </button>

                    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', marginBottom: 20, fontFamily: 'Inter' }}>Tạo phòng học mới</h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', fontFamily: 'Inter' }}>Tên phòng học *</label>
                        <input
                            type="text"
                            value={createRoomName}
                            onChange={(e) => setCreateRoomName(e.target.value)}
                            placeholder="VD: Ôn tập Chương 3"
                            disabled={isCreatingRoom}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter' }}
                            autoFocus
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', fontFamily: 'Inter' }}>Mô tả</label>
                        <textarea
                            value={createRoomDescription}
                            onChange={(e) => setCreateRoomDescription(e.target.value)}
                            placeholder="Mô tả ngắn về nội dung buổi học (không bắt buộc)"
                            disabled={isCreatingRoom}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter', resize: 'vertical', minHeight: 72 }}
                        />
                    </div>

                    <fieldset style={{ border: 'none', margin: '0 0 24px', padding: 0, display: 'grid', gap: 8 }}>
                        <legend style={{ padding: 0, marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#334155', fontFamily: 'Inter' }}>Quyền vào</legend>
                        {[
                            { value: false, icon: <Globe size={18} />, title: 'Cả nhóm', hint: 'Mọi thành viên nhóm đều thấy và vào được.' },
                            { value: true, icon: <Lock size={18} />, title: 'Phòng ẩn', hint: 'Chỉ hiện với người có mã mời (và quản trị viên nhóm).' },
                        ].map((opt) => {
                            const selected = createRoomIsPrivate === opt.value;
                            return (
                                <label key={opt.title} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${selected ? '#00236F' : '#E2E8F0'}`, background: selected ? '#EEF2FF' : 'white', cursor: isCreatingRoom ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}>
                                    <input
                                        type="radio"
                                        name="create-room-access"
                                        checked={selected}
                                        onChange={() => setCreateRoomIsPrivate(opt.value)}
                                        disabled={isCreatingRoom}
                                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                                    />
                                    <span style={{ marginTop: 1, color: selected ? '#00236F' : '#64748B', display: 'flex' }}>{opt.icon}</span>
                                    <span style={{ display: 'grid', gap: 2 }}>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{opt.title}</span>
                                        <span style={{ fontSize: 12, color: '#64748B' }}>{opt.hint}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </fieldset>

                    {createRoomError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>
                            {createRoomError}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => { if (!isCreatingRoom) { setIsCreateRoomModalOpen(false); setCreateRoomError(null); } }}
                            disabled={isCreatingRoom}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: isCreatingRoom ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            Hủy
                        </button>
                        <button
                            onClick={handleCreateRoom}
                            disabled={isCreatingRoom || !createRoomName.trim()}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: (isCreatingRoom || !createRoomName.trim()) ? '#93A4C7' : '#00236F', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: (isCreatingRoom || !createRoomName.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            {isCreatingRoom ? 'Đang tạo...' : 'Tạo phòng học'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal: Tạo kênh chat mới */}
        {isCreateChannelModalOpen && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div style={{ background: 'white', borderRadius: 12, width: 440, padding: 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)' }}>
                    <button
                        onClick={() => { if (!isCreatingChannel) { setIsCreateChannelModalOpen(false); setCreateChannelError(null); } }}
                        disabled={isCreatingChannel}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: isCreatingChannel ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 18 }}
                    >
                        ✕
                    </button>

                    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', marginBottom: 20, fontFamily: 'Inter' }}>Tạo kênh chat mới</h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', fontFamily: 'Inter' }}>Tên kênh *</label>
                        <input
                            type="text"
                            value={createChannelName}
                            onChange={(e) => setCreateChannelName(e.target.value)}
                            placeholder="VD: thao-luan-chung"
                            disabled={isCreatingChannel}
                            maxLength={80}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter' }}
                            autoFocus
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', fontFamily: 'Inter' }}>Mô tả</label>
                        <textarea
                            value={createChannelDescription}
                            onChange={(e) => setCreateChannelDescription(e.target.value)}
                            placeholder="Mô tả ngắn về mục đích của kênh (không bắt buộc)"
                            disabled={isCreatingChannel}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter', resize: 'vertical', minHeight: 72 }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                        <input
                            type="checkbox"
                            id="create-channel-private"
                            checked={createChannelIsPrivate}
                            onChange={(e) => setCreateChannelIsPrivate(e.target.checked)}
                            disabled={isCreatingChannel}
                            style={{ width: 16, height: 16, cursor: isCreatingChannel ? 'not-allowed' : 'pointer' }}
                        />
                        <label htmlFor="create-channel-private" style={{ fontSize: 13, color: '#334155', fontFamily: 'Inter', cursor: isCreatingChannel ? 'not-allowed' : 'pointer' }}>
                            Kênh riêng tư (chỉ thành viên được thêm mới xem được)
                        </label>
                    </div>

                    {createChannelError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>
                            {createChannelError}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => { if (!isCreatingChannel) { setIsCreateChannelModalOpen(false); setCreateChannelError(null); } }}
                            disabled={isCreatingChannel}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: isCreatingChannel ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            Hủy
                        </button>
                        <button
                            onClick={handleCreateChannel}
                            disabled={isCreatingChannel || !createChannelName.trim()}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: (isCreatingChannel || !createChannelName.trim()) ? '#93A4C7' : '#00236F', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: (isCreatingChannel || !createChannelName.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            {isCreatingChannel ? 'Đang tạo...' : 'Tạo kênh'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal: Xác nhận xóa kênh chat */}
        {channelPendingDelete && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div style={{ background: 'white', borderRadius: 12, width: 420, padding: 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)' }}>
                    <button
                        onClick={() => { if (!isDeletingChannel) { setChannelPendingDelete(null); setDeleteChannelError(null); } }}
                        disabled={isDeletingChannel}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: isDeletingChannel ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 18 }}
                    >
                        ✕
                    </button>

                    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', marginBottom: 12, fontFamily: 'Inter' }}>
                        Xóa "{channelPendingDelete.name}"?
                    </h2>

                    <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 8, fontFamily: 'Inter' }}>
                        Kênh này sẽ không còn truy cập được nữa.
                    </p>
                    <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.5, marginBottom: 24, fontFamily: 'Inter' }}>
                        Thao tác này hiện chưa thể hoàn tác.
                    </p>

                    {deleteChannelError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>
                            {deleteChannelError}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => { if (!isDeletingChannel) { setChannelPendingDelete(null); setDeleteChannelError(null); } }}
                            disabled={isDeletingChannel}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingChannel ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            Hủy
                        </button>
                        <button
                            onClick={handleConfirmDeleteChannel}
                            disabled={isDeletingChannel}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: isDeletingChannel ? '#F1A9A0' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingChannel ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            {isDeletingChannel ? 'Đang xóa...' : 'Xóa kênh'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal: Xác nhận xóa phòng học */}
        {roomPendingDelete && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div style={{ background: 'white', borderRadius: 12, width: 420, padding: 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)' }}>
                    <button
                        onClick={() => { if (!isDeletingRoom) { setRoomPendingDelete(null); setDeleteRoomError(null); } }}
                        disabled={isDeletingRoom}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: isDeletingRoom ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 18 }}
                    >
                        ✕
                    </button>

                    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', marginBottom: 12, fontFamily: 'Inter' }}>
                        Xóa "{roomPendingDelete.name}"?
                    </h2>

                    <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 8, fontFamily: 'Inter' }}>
                        Phòng học này sẽ không còn truy cập được nữa.
                    </p>
                    <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.5, marginBottom: 24, fontFamily: 'Inter' }}>
                        Dữ liệu lịch sử (tin nhắn, thành viên, lịch sử kiểm duyệt) vẫn được lưu giữ. Thao tác này hiện chưa thể hoàn tác.
                    </p>

                    {deleteRoomError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>
                            {deleteRoomError}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => { if (!isDeletingRoom) { setRoomPendingDelete(null); setDeleteRoomError(null); } }}
                            disabled={isDeletingRoom}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingRoom ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            Hủy
                        </button>
                        <button
                            onClick={handleConfirmDeleteRoom}
                            disabled={isDeletingRoom}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: isDeletingRoom ? '#F1A9A0' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingRoom ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            {isDeletingRoom ? 'Đang xóa...' : 'Xóa phòng học'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal: Xác nhận xóa tài liệu */}
        {resourcePendingDelete && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div style={{ background: 'white', borderRadius: 12, width: 420, padding: 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.1)' }}>
                    <button
                        onClick={() => { if (!pendingDeleteResourceId) setResourcePendingDelete(null); }}
                        disabled={!!pendingDeleteResourceId}
                        style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: pendingDeleteResourceId ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 18 }}
                    >
                        ✕
                    </button>

                    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F172A', marginBottom: 12, fontFamily: 'Inter' }}>
                        Xóa "{resourcePendingDelete.name}"?
                    </h2>

                    <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 24, fontFamily: 'Inter' }}>
                        Tài liệu này sẽ bị xóa vĩnh viễn khỏi nhóm. Thao tác này không thể hoàn tác.
                    </p>

                    {resourceDeleteError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>
                            {resourceDeleteError.message}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => { if (!pendingDeleteResourceId) setResourcePendingDelete(null); }}
                            disabled={!!pendingDeleteResourceId}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#F1F5F9', color: '#475569', border: 'none', fontSize: 14, fontWeight: 600, cursor: pendingDeleteResourceId ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            Hủy
                        </button>
                        <button
                            onClick={handleConfirmDeleteResource}
                            disabled={!!pendingDeleteResourceId}
                            style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: pendingDeleteResourceId ? '#F1A9A0' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: pendingDeleteResourceId ? 'not-allowed' : 'pointer', fontFamily: 'Inter' }}
                        >
                            {pendingDeleteResourceId ? 'Đang xóa...' : 'Xóa tài liệu'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}
