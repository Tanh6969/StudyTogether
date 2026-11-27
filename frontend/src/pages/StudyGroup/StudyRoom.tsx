import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Video as VideoIcon,
  Hand,
  PhoneOff,
  MessageSquare,
  Send,
  ArrowLeft,
  Share2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  UserPlus,
  UsersRound,
  Pencil,
  Trash2,
  Image as ImageIcon,
  WifiOff,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useStudyRoom } from '../../hooks/useStudyRoom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useRoomConnectionWatch } from '../../hooks/useRoomConnectionWatch';
import { claimMeetingSession } from '../../lib/meeting.api';
import { setOwnedMediaSession } from '../../lib/meetingOwnerState';
import { useRoomMessages } from '../../hooks/useRoomMessages';
import { useMessageReactionActions } from '../../hooks/useMessageReactionActions';
import { useMessageImageAttachment, ALLOWED_IMAGE_ACCEPT } from '../../hooks/useMessageImageAttachment';
import { MessageAttachmentImage } from '../../components/chat/MessageAttachmentImage';
import { MessageReactions } from '../../components/chat/MessageReactions';
import { SelectedImagePreview } from '../../components/chat/SelectedImagePreview';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { RestrictionBanner } from '../../components/ui/RestrictionBanner';
import { getAvatarInitials, getAvatarColor } from '../../utils/avatarUtils';
import { getDisplayName } from '../../utils/userDisplay';
import { InviteModal } from '../../components/invitations/InviteModal';
import { MeetingProvider } from './meeting/MeetingProvider';
import type { ConnectedCallParticipant } from './meeting/MeetingProvider';
import { MeetingVideoGrid } from './meeting/MeetingVideoGrid';
import { MeetingControls } from './meeting/MeetingControls';
import { WhiteboardPermissionsModal } from './meeting/WhiteboardPermissionsModal';
import { WhiteboardPanel } from './meeting/WhiteboardPanel';
import { PresentationViewer } from './meeting/PresentationViewer';
import {
  ActivitiesButton,
  GameModeTab,
  GameStage,
  MusicMiniBar,
  MusicSidebarPanel,
  MusicTabButton,
  RoomActivitiesProvider,
} from '../../activities/RoomActivities';
import { PreJoinLobby } from './meeting/PreJoinLobby';
import type { MediaJoinChoice } from './meeting/PreJoinLobby';
import { SessionTasksPanel } from './SessionTasksPanel';
import { ROOM_RANK_LABEL } from '../../lib/roomPermissions';


interface CenteredRoomMessageProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children?: ReactNode;
}

// `dvh` follows the phone's visible viewport (address bar shown/hidden); `vh` alone
// pushes the bottom controls under mobile browser chrome.
const FULL_HEIGHT = '100dvh';

function CenteredRoomMessage({ title, subtitle, onBack, children }: CenteredRoomMessageProps) {
  return (
    <div style={{width: '100%', minHeight: FULL_HEIGHT, boxSizing: 'border-box', background: '#0F172A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, fontFamily: 'Inter, sans-serif', textAlign: 'center'}}>
      <h1 style={{color: 'white', fontSize: 20, fontWeight: '700', margin: 0}}>{title}</h1>
      {subtitle && <p style={{color: '#94A3B8', fontSize: 14, margin: '4px 0 12px', maxWidth: 420}}>{subtitle}</p>}
      {children}
      {onBack && (
        <button
          onClick={onBack}
          style={{marginTop: 16, background: '#334155', border: 'none', color: 'white', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500'}}
        >
          Quay lại
        </button>
      )}
    </div>
  );
}

export function StudyRoom() {
  const navigate = useNavigate();
  const { id: roomId } = useParams();
  const { currentUser, getBan } = useAuth();
  const messageBan = getBan('message');

  const {
    room,
    members,
    loading,
    roomError,
    actionError,
    clearActionError,
    currentUserId,
    currentMember,
    rankOf,
    myRank,
    permissions,
    whiteboardEditorIds,
    isCurrentUserMember,
    handRaisedUserIds,
    join,
    leave,
    deleteRoom,
    moderate,
    changeMemberRole,
    transferHost,
    refetchRoom,
    refetchMembers,
  } = useStudyRoom(roomId);

  // Room states
  const [activeMode, setActiveMode] = useState<'video' | 'whiteboard' | 'game'>('video');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'tasks' | 'chat' | 'music'>('tasks');
  const [activeBoardTab, setActiveBoardTab] = useState<'whiteboard' | 'presentation'>('whiteboard');

  const isMobile = useIsMobile();
  // On a phone the sidebar is a full-screen sheet over the call, so it starts closed.
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);
  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);
  const openSidebarTab = useCallback((tab: 'tasks' | 'chat' | 'music') => {
    setActiveSidebarTab(tab);
    setIsSidebarOpen(true);
  }, []);
  const showGame = useCallback(() => setActiveMode('game'), []);
  const showMusic = useCallback(() => {
    setIsSidebarOpen(true);
    setActiveSidebarTab('music');
  }, []);
  const exitGame = useCallback(() => setActiveMode((m) => (m === 'game' ? 'video' : m)), []);
  const closeMusicTab = useCallback(() => setActiveSidebarTab((t) => (t === 'music' ? 'tasks' : t)), []);
  const [isJoining, setIsJoining] = useState(false);
  const [isDeleteRoomModalOpen, setIsDeleteRoomModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isWhiteboardPermissionsOpen, setIsWhiteboardPermissionsOpen] = useState(false);
  const [pendingRoomRoleUserId, setPendingRoomRoleUserId] = useState<string | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [lobbyConfirmed, setLobbyConfirmed] = useState(false);
  const [clientSessionId, setClientSessionId] = useState<string | null>(null);
  const [callTransferred, setCallTransferred] = useState(false);
  // Stable callback: StudyRoom's clock re-renders every second. An inline
  // callback here would constantly restart MeetingProvider's ownership poll.
  const handleCallTransferred = useCallback(() => setCallTransferred(true), []);
  const [mediaJoinError, setMediaJoinError] = useState<string | null>(null);
  const [callParticipants, setCallParticipants] = useState<ConnectedCallParticipant[]>([]);
  const handleCallParticipantsChange = useCallback((next: ConnectedCallParticipant[]) => {
    setCallParticipants((previous) =>
      previous.length === next.length && previous.every((p, index) => p.identity === next[index].identity && p.name === next[index].name && p.isMicrophoneEnabled === next[index].isMicrophoneEnabled)
        ? previous : next
    );
  }, []);
  const [mediaChoice, setMediaChoice] = useState<MediaJoinChoice>({ audioEnabled: true, videoEnabled: true });

  // Once opened, the board stays mounted (hidden) while you switch to video / slides / the game.
  // Unmounting it threw away the live Excalidraw scene, and the remount only had the stale
  // `room.whiteboard_state` from when the page loaded, so recent strokes vanished.
  const [whiteboardOpened, setWhiteboardOpened] = useState(false);
  useEffect(() => {
    if (activeMode === 'whiteboard') setWhiteboardOpened(true);
  }, [activeMode]);

  // Coming back to a backgrounded phone tab: the backend may have closed this
  // membership after a passive disconnect (LiveKit webhook) -- re-read it now.
  const resyncAfterResume = useCallback(() => {
    void refetchMembers();
    void refetchRoom();
  }, [refetchMembers, refetchRoom]);
  const { isOnline } = useRoomConnectionWatch(resyncAfterResume);
  // Keep the callback stable: a transient roster refresh must never remount the
  // media provider or trigger an accidental reconnect.
  const handleMediaSessionEnded = useCallback(() => {
    void refetchRoom();
    void refetchMembers();
  }, [refetchRoom, refetchMembers]);

  // Membership ended while this page was in the call, without the user pressing
  // "Rời phòng": a passive disconnect closed by the server, or a kick.
  const leavingRef = useRef(false);
  const wasInCallRef = useRef(false);
  const [membershipLost, setMembershipLost] = useState(false);
  useEffect(() => {
    if (!lobbyConfirmed) {
      wasInCallRef.current = false;
      return;
    }
    if (isCurrentUserMember) {
      wasInCallRef.current = true;
      setMembershipLost(false);
    } else if (wasInCallRef.current && !leavingRef.current) {
      setMembershipLost(true);
    }
  }, [lobbyConfirmed, isCurrentUserMember]);

  const handleRejoinAfterLoss = () => {
    setMembershipLost(false);
    wasInCallRef.current = false;
    setClientSessionId(null);
    setLobbyConfirmed(false);
    setCallParticipants([]);
  };

  const handleLeaveRoom = async () => {
    leavingRef.current = true;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    try {
      await leave();
    } catch {
      // Best-effort: still navigate away even if the leave call failed (e.g. already left).
    }
    navigate(room ? `/groups/${room.group_id}` : '/groups');
  };

  const handleWhiteboardRoleChange = async (userId: string, role: 'editor' | 'participant') => {
    if (pendingRoomRoleUserId || !permissions.canModerate) return;
    setPendingRoomRoleUserId(userId);
    try {
      await changeMemberRole(userId, role);
    } catch {
      // changeMemberRole records actionError for the permissions dialog.
    } finally {
      setPendingRoomRoleUserId(null);
    }
  };

  const handleTransferHost = async (userId: string) => {
    if (pendingRoomRoleUserId || !permissions.canManageRoom) return;
    setPendingRoomRoleUserId(userId);
    try {
      await transferHost(userId);
    } catch {
      // transferHost records actionError for the permissions dialog.
    } finally {
      setPendingRoomRoleUserId(null);
    }
  };

  const handleConfirmDeleteRoom = async () => {
    if (isDeletingRoom) return;
    setIsDeletingRoom(true);
    try {
      await deleteRoom();
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      // Only navigate away after the backend confirms the delete -- no optimistic/fake
      // success. There is no "room removed" state to fall back to in this hook, so leaving
      // the deleted room's page entirely (back to its Group) is the correct reset.
      navigate(room ? `/groups/${room.group_id}` : '/groups');
    } catch {
      // Keep the modal open so the user can see actionError (set by the hook) and retry.
    } finally {
      setIsDeletingRoom(false);
    }
  };

  // Optimistic hand state: the server round trip (log + two refetches) used to be the only
  // thing that flipped the button, so it lagged by a second or more. The override is held
  // until the audit-log refetch agrees, then dropped.
  const [handOverride, setHandOverride] = useState<boolean | null>(null);
  const serverHandRaised = currentUserId ? handRaisedUserIds.has(currentUserId) : false;
  const currentUserHandRaised = handOverride ?? serverHandRaised;
  useEffect(() => {
    if (handOverride !== null && handOverride === serverHandRaised) setHandOverride(null);
  }, [handOverride, serverHandRaised]);

  const handleToggleHand = async () => {
    if (!currentUserId || handOverride !== null) return;
    const next = !serverHandRaised;
    setHandOverride(next);
    try {
      await moderate(currentUserId, next ? 'raise_hand' : 'lower_hand');
    } catch {
      setHandOverride(null); // actionError is already populated by the hook.
    }
  };

  // The viewer's own study time for this visit, from their membership's joined_at (the same
  // value the "study hours" achievement is computed from). Rooms have no room-wide start/end.
  const joinedAt = isCurrentUserMember ? currentMember?.joined_at ?? null : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!joinedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [joinedAt]);

  const elapsedSeconds = joinedAt ? Math.max(0, Math.floor((now - new Date(joinedAt).getTime()) / 1000)) : null;

  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // The call counter, task roster and game roster must match the camera tile identities:
  // LiveKit supplies PRESENCE, while study_room_members supplies profiles and permissions.
  // A stale membership row is never counted as an active call participant.
  const participants = useMemo(() => {
    const membersById = new Map(members.map((member) => [member.user_id, member]));
    return callParticipants.map((callParticipant) => {
      const member = membersById.get(callParticipant.identity);
      const isSelf = callParticipant.identity === currentUserId;
      const name = isSelf
        ? `${currentUser.name} (Bạn)`
        : member ? getDisplayName(member.user) : callParticipant.name || 'Người dùng';
      return {
        id: callParticipant.identity,
        userId: callParticipant.identity,
        role: member?.role ?? 'participant',
        name,
        initial: isSelf ? currentUser.initials : getAvatarInitials(name),
        color: isSelf ? currentUser.color : getAvatarColor(name),
        avatarUrl: isSelf ? currentUser.avatarUrl : member?.user.avatar_url ?? null,
        frame: member?.user.avatar_frame ?? null,
        cheerStyle: member?.user.cheer_style ?? 'clap',
        isHost: member?.role === 'host',
        isSelf,
        // The audit records an attempted moderation action; the live track state
        // is the only source of truth about whether audio is actually muted.
        isMuted: !callParticipant.isMicrophoneEnabled,
        handRaised: isSelf ? currentUserHandRaised : handRaisedUserIds.has(callParticipant.identity),
      };
    });
  }, [callParticipants, members, currentUserId, currentUser, handRaisedUserIds, currentUserHandRaised]);

  // Hook must be called unconditionally, BEFORE loading/error early returns.
  // This is the connected media roster, not all stored members with left_at=NULL.
  const connectedRoomMembers = useMemo(() => {
    const identities = new Set(callParticipants.map((person) => person.identity));
    return members.filter((member) => !member.left_at && identities.has(member.user_id));
  }, [members, callParticipants]);

  // Real persisted messages for this room's ROOM Conversation (reuses the same
  // /conversations/{id}/messages REST API + Realtime subscription as Channel chat --
  // see useRoomMessages.ts). `room.conversation_id` is null only in the brief instant
  // before `room` has loaded; the chat panel treats that the same as "not ready yet".
  //
  // Gated on `isCurrentUserMember`, not just `room?.conversation_id`: the room GET has no
  // membership check, so conversation_id is available (and this hook would start fetching)
  // before the join API call has actually committed a study_room_members row. Fetching that
  // early hits the backend's can_access_room 403 ("You do not have access to this
  // conversation") and, since the hook only re-fetches when conversationId itself changes,
  // that error used to stick around even after join succeeded -- only a full reload (which
  // re-fetches after membership already exists) cleared it. Gating here makes conversationId
  // flip from null to real only once membership is actually confirmed, so the fetch is
  // correctly deferred instead of firing-then-erroring.
  const {
    messages,
    isLoading: isMessagesLoading,
    loadError: messagesError,
    isSending: isSendingMessage,
    sendError: sendMessageError,
    sendMessage,
    updateMessageReactions,
  } = useRoomMessages(isCurrentUserMember ? room?.conversation_id ?? null : null);
  const handleReactionSelect = useMessageReactionActions(updateMessageReactions);
  const [chatInput, setChatInput] = useState('');
  const imageAttachment = useMessageImageAttachment();
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);

  const senderDisplay = (message: (typeof messages)[number]) => {
    const isSelf = message.sender_id === currentUserId;
    const name = isSelf ? `${currentUser.name} (Bạn)` : getDisplayName(message.sender);
    return {
      name,
      initial: isSelf ? currentUser.initials : getAvatarInitials(name),
      color: isSelf ? currentUser.color : getAvatarColor(name),
      avatarUrl: isSelf ? currentUser.avatarUrl : message.sender.avatar_url,
      isSelf,
    };
  };

  const formatMessageTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    const conversationId = room?.conversation_id ?? null;
    if ((!trimmed && !imageAttachment.hasImage) || !conversationId || isSendingMessage || imageAttachment.isUploading || messageBan) return;
    try {
      // Upload first, create the message second -- a failed upload must never produce an
      // orphaned/misleading message record (see useMessageImageAttachment.uploadImage).
      const attachmentPath = imageAttachment.hasImage ? await imageAttachment.uploadImage(conversationId) : null;
      await sendMessage(trimmed, attachmentPath);
      setChatInput('');
      imageAttachment.clearImage();
    } catch {
      // sendMessageError / imageAttachment.uploadError is already populated; keep the draft
      // (and any selected image) so the user can retry.
    }
  };

  const handleChatImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) imageAttachment.selectImage(picked);
    e.target.value = '';
  };

  // --- Loading / error / not-yet-joined states (real backend data drives all of these) ---

  if (!roomId) {
    return (
      <CenteredRoomMessage title="Liên kết phòng học không hợp lệ" subtitle="Không tìm thấy mã phòng học trong đường dẫn." onBack={() => navigate('/groups')} />
    );
  }

  if (loading) {
    return <CenteredRoomMessage title="Đang tải phòng học..." />;
  }

  if (roomError || !room) {
    return (
      <CenteredRoomMessage
        title={roomError?.status === 404 ? 'Không tìm thấy phòng học' : 'Không thể tải phòng học'}
        subtitle={roomError?.message}
        onBack={() => navigate('/groups')}
      />
    );
  }

  const inRoomCount = participants.length;
  // Pre-join lobby: lets the user preview/toggle camera & mic (and pick a device) before the
  // LiveKit connection is made, instead of connecting with audio/video hardcoded on immediately.
  // Also doubles as the room-membership join step for first-time visitors -- "Tham gia phòng học"
  // both joins the room and confirms the media setup in one action, instead of a separate screen.
  if (callTransferred) {
    return (
      <div style={{ width: '100%', minHeight: FULL_HEIGHT, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', gap: 16, padding: isMobile ? 20 : 28,
        background: '#0F172A', color: '#E2E8F0', textAlign: 'center' }}>
        <VideoIcon size={42} color="#FBBF24" />
        <h2 style={{ margin: 0, fontSize: 22 }}>Cuộc gọi đã chuyển sang tab hoặc thiết bị khác</h2>
        <p style={{ maxWidth: 460, color: '#94A3B8', lineHeight: 1.6 }}>
          Phiên video tại đây đã kết thúc để tránh xung đột camera, micro và cuộc gọi.
          Tab hoặc thiết bị mới tiếp tục hoạt động. Nếu muốn chuyển cuộc gọi về đây,
          hãy quay lại danh sách phòng và chủ động bấm tham gia lần nữa.
        </p>
        <button onClick={() => navigate(`/groups/${room.group_id}`)}
          style={{ border: 0, borderRadius: 8, padding: '12px 20px',
            background: '#2563EB', color: 'white', cursor: 'pointer', fontWeight: 600 }}>
          Quay về nhóm
        </button>
      </div>
    );
  }

  if (membershipLost) {
    return (
      <CenteredRoomMessage
        title="Bạn đã bị ngắt khỏi phòng học"
        subtitle="Kết nối của bạn bị gián đoạn quá lâu (ví dụ: tắt màn hình, chuyển ứng dụng hoặc mất mạng), hoặc bạn đã được mời ra khỏi phòng."
      >
        <WifiOff size={36} color="#FBBF24" style={{ order: -1, marginBottom: 8 }} />
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, width: isMobile ? '100%' : 'auto', maxWidth: 360, marginTop: 8 }}>
          <button
            onClick={handleRejoinAfterLoss}
            style={{ border: 0, borderRadius: 10, padding: '12px 20px', background: '#2563EB', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: 15 }}
          >
            Tham gia lại
          </button>
          <button
            onClick={() => navigate(`/groups/${room.group_id}`)}
            style={{ border: 0, borderRadius: 10, padding: '12px 20px', background: '#334155', color: 'white', cursor: 'pointer', fontWeight: 500, fontSize: 15 }}
          >
            Quay về nhóm
          </button>
        </div>
      </CenteredRoomMessage>
    );
  }

  if (!lobbyConfirmed || !clientSessionId) {
    return (
      <PreJoinLobby
        roomName={room.name}
        roomSubtitle={room.description || undefined}
        userName={currentUser.name}
        userInitial={currentUser.initials}
        userColor={currentUser.color}
        userAvatarUrl={currentUser.avatarUrl ?? undefined}
        isJoining={isJoining}
        joinError={mediaJoinError ?? actionError?.message}
        restrictionBan={isCurrentUserMember ? undefined : getBan('join_room')}
        onJoin={async (choice) => {
          if (isJoining) return;
          setMediaChoice(choice);
          setMediaJoinError(null);
          setIsJoining(true);
          try {
            if (!isCurrentUserMember) await join();
            // Explicit interaction is the ONLY way to take over from another
            // tab/device. React effect retries must never silently take over.
            const nextSessionId = crypto.randomUUID();
            await claimMeetingSession(roomId, nextSessionId);
            setOwnedMediaSession(roomId, nextSessionId);
            setClientSessionId(nextSessionId);
            setLobbyConfirmed(true);
          } catch {
            setMediaJoinError('Không thể bắt đầu phiên gọi. Vui lòng kiểm tra quyền vào phòng hoặc thử tham gia lại.');
          } finally {
            setIsJoining(false);
          }
        }}
        onBack={() => navigate(`/groups/${room.group_id}`)}
      />
    );
  }

  return (
    <MeetingProvider
      roomId={roomId}
      clientSessionId={clientSessionId}
      enabled={isCurrentUserMember}
      onTransferred={handleCallTransferred}
      initialAudioEnabled={mediaChoice.audioEnabled}
      initialVideoEnabled={mediaChoice.videoEnabled}
      audioDeviceId={mediaChoice.audioDeviceId}
      videoDeviceId={mediaChoice.videoDeviceId}
      onSessionEnded={handleMediaSessionEnded}
      onParticipantsChange={handleCallParticipantsChange}
    >
    <RoomActivitiesProvider
      roomId={room.id}
      currentUserId={currentUserId}
      enabled={isCurrentUserMember}
      isManager={permissions.canModerate}
      people={participants}
      onShowGame={showGame}
      onShowMusic={showMusic}
    >
    <div style={{width: '100%', height: FULL_HEIGHT, minHeight: 0, background: '#0F172A', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, sans-serif'}}>

      {/* Top Header Bar -- one row on desktop; on phones the mode tabs drop to a second row. */}
      <header style={isMobile
        ? {background: '#1E293B', borderBottom: '1px solid #334155', padding: '8px 12px', paddingTop: 'max(8px, env(safe-area-inset-top))', flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: 8, columnGap: 8, zIndex: 20, position: 'relative'}
        : {height: 64, flexShrink: 0, background: '#1E293B', borderBottom: '1px solid #334155', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20, position: 'relative'}}>

        {/* Left Info & Back button */}
        <div style={{display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16, minWidth: 0, flex: isMobile ? 1 : undefined}}>
          <button
            onClick={handleLeaveRoom}
            aria-label="Rời phòng"
            style={{background: '#334155', border: 'none', color: 'white', padding: isMobile ? 8 : '8px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: '500', flexShrink: 0}}
          >
            <ArrowLeft size={16} /> {!isMobile && 'Rời phòng'}
          </button>

          {!isMobile && <div style={{height: 24, width: 1, background: '#475569'}} />}

          <div style={{display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, minWidth: 0}}>
            <div style={{width: 10, height: 10, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 10px #10B981', flexShrink: 0}} />
            {isMobile ? (
              <div style={{minWidth: 0, lineHeight: 1.25}}>
                <h1 style={{fontSize: 14, fontWeight: 600, color: 'white', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{room.name}</h1>
                <div style={{fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  {inRoomCount > 0 ? `${inRoomCount} người đang học` : 'Đang mở'} · {ROOM_RANK_LABEL[myRank]}
                </div>
              </div>
            ) : (
              <>
                <h1 style={{fontSize: 16, fontWeight: '600', color: 'white', margin: 0, whiteSpace: 'nowrap'}}>
                  {room.name} • <span style={{color: '#94A3B8', fontWeight: '400'}}>{inRoomCount > 0 ? `${inRoomCount} người đang học` : 'Đang mở'}</span>
                </h1>
                <span title="Vai trò của bạn trong phòng" style={{padding: '2px 8px', borderRadius: 999, background: '#334155', color: '#CBD5E1', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap'}}>
                  {ROOM_RANK_LABEL[myRank]}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Center Mode Switcher Tabs */}
        <div style={isMobile
          ? {order: 3, flexBasis: '100%', background: '#0F172A', padding: 3, borderRadius: 10, border: '1px solid #334155', display: 'flex', gap: 3}
          : {position: 'absolute', left: '50%', transform: 'translateX(-50%)', background: '#0F172A', padding: 4, borderRadius: 10, border: '1px solid #334155', display: 'flex', gap: 4}}>
          <button
            onClick={() => setActiveMode('video')}
            style={{
              flex: isMobile ? 1 : undefined,
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              padding: isMobile ? '7px 6px' : '6px 16px',
              borderRadius: 8, 
              border: 'none', 
              background: activeMode === 'video' ? '#2563EB' : 'transparent', 
              color: activeMode === 'video' ? 'white' : '#94A3B8', 
              fontSize: 13, 
              fontWeight: '600', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s'
            }}
          >
            <VideoIcon size={16} /> {isMobile ? `Video (${participants.length})` : `Gọi Video (${participants.length})`}
          </button>
          <button
            onClick={() => setActiveMode('whiteboard')}
            style={{
              flex: isMobile ? 1 : undefined,
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              padding: isMobile ? '7px 6px' : '6px 16px',
              borderRadius: 8, 
              border: 'none', 
              background: activeMode === 'whiteboard' ? '#2563EB' : 'transparent', 
              color: activeMode === 'whiteboard' ? 'white' : '#94A3B8', 
              fontSize: 13, 
              fontWeight: '600', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s'
            }}
          >
            <Pencil size={16} /> {isMobile ? 'Bảng' : 'Bảng Trắng'}
          </button>
          <GameModeTab
            active={activeMode === 'game'}
            onClick={() => setActiveMode('game')}
            style={(active) => ({flex: isMobile ? 1 : undefined, justifyContent: 'center', whiteSpace: 'nowrap', padding: isMobile ? '7px 6px' : '6px 16px', borderRadius: 8, border: 'none', background: active ? '#2563EB' : 'transparent', color: active ? 'white' : '#94A3B8', fontSize: 13, fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'})}
          />
        </div>

        {/* Right Timer & Status */}
        <div style={{display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 0}}>
          {actionError && !isMobile && (
            <div
              onClick={clearActionError}
              title="Bấm để ẩn thông báo"
              style={{color: '#F87171', fontSize: 12, maxWidth: 220, cursor: 'pointer'}}
            >
              {actionError.message}
            </div>
          )}
          {permissions.canModerate && (
            <button
              onClick={() => setIsInviteModalOpen(true)}
              title="Mời thêm người"
              style={{background: 'transparent', border: '1px solid #475569', color: '#94A3B8', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', display: 'flex', alignItems: 'center'}}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#00236F'; e.currentTarget.style.color = '#00236F'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              <UserPlus size={16} />
            </button>
          )}
          {permissions.canModerate && (
            <button
              onClick={() => {
                clearActionError();
                setIsWhiteboardPermissionsOpen(true);
              }}
              title="Quyền vẽ bảng và chủ phòng"
              style={{background: 'transparent', border: '1px solid #475569', color: '#94A3B8', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', display: 'flex', alignItems: 'center', gap: 6}}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.color = '#93C5FD'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              <UsersRound size={16} /> {!isMobile && 'Quyền trong phòng'}
            </button>
          )}
          {permissions.canManageRoom && (
            <button
              onClick={() => setIsDeleteRoomModalOpen(true)}
              title="Xóa phòng học"
              style={{background: 'transparent', border: '1px solid #475569', color: '#94A3B8', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', display: 'flex', alignItems: 'center'}}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#DC2626'; e.currentTarget.style.color = '#F87171'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              <Trash2 size={16} />
            </button>
          )}
          <div title="Thời gian bạn đã học trong phòng lần này" style={{background: '#334155', padding: isMobile ? '5px 8px' : '6px 14px', borderRadius: 8, color: '#38BDF8', fontSize: isMobile ? 12 : 14, fontFamily: 'monospace', fontWeight: '600'}}>
            {elapsedSeconds !== null ? formatTime(elapsedSeconds) : '00:00:00'}
          </div>
        </div>
      </header>

      {/* Connection / error banners: visible on every screen size, never squeezed into the header. */}
      {!isOnline && (
        <div role="status" style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#78350F', color: '#FEF3C7', fontSize: 13, zIndex: 19}}>
          <WifiOff size={16} style={{flexShrink: 0}} />
          <span>Mất kết nối mạng. Cuộc gọi sẽ tự kết nối lại khi có mạng — đừng tắt màn hình hoặc chuyển ứng dụng quá lâu.</span>
        </div>
      )}
      {actionError && isMobile && (
        <div role="alert" style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#450A0A', color: '#FCA5A5', fontSize: 13, zIndex: 19}}>
          <span style={{flex: 1}}>{actionError.message}</span>
          <button onClick={clearActionError} aria-label="Ẩn thông báo" style={{background: 'none', border: 'none', color: '#FCA5A5', padding: 4, cursor: 'pointer', display: 'flex'}}>
            <X size={16} />
          </button>
        </div>
      )}

      <InviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        target={{ roomId: room.id }}
        targetLabel={room.name}
      />
      {permissions.canModerate && (
        <WhiteboardPermissionsModal
          isOpen={isWhiteboardPermissionsOpen}
          members={connectedRoomMembers}
          currentUserId={currentUserId}
          myRank={myRank}
          rankOf={rankOf}
          pendingUserId={pendingRoomRoleUserId}
          error={actionError?.message ?? null}
          onClose={() => {
            setIsWhiteboardPermissionsOpen(false);
            clearActionError();
          }}
          onRoleChange={handleWhiteboardRoleChange}
          onTransferHost={handleTransferHost}
        />
      )}

      {/* Modal: Xác nhận xóa phòng học */}
      {isDeleteRoomModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200 }}>
          <div style={{ background: '#1E293B', borderRadius: 12, width: 'min(420px, calc(100% - 32px))', boxSizing: 'border-box', padding: isMobile ? 20 : 32, display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: '0px 10px 25px rgba(0, 0, 0, 0.3)', border: '1px solid #334155' }}>
            <button
              onClick={() => { if (!isDeletingRoom) { setIsDeleteRoomModalOpen(false); clearActionError(); } }}
              disabled={isDeletingRoom}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: isDeletingRoom ? 'not-allowed' : 'pointer', color: '#94A3B8', fontSize: 18 }}
            >
              ✕
            </button>

            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'white', marginBottom: 12 }}>
              Xóa "{room.name}"?
            </h2>

            <p style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 1.5, marginBottom: 8 }}>
              Phòng học này sẽ không còn truy cập được nữa.
            </p>
            <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.5, marginBottom: 24 }}>
              Dữ liệu lịch sử (tin nhắn, thành viên, lịch sử kiểm duyệt) vẫn được lưu giữ. Thao tác này hiện chưa thể hoàn tác.
            </p>

            {actionError && (
              <div style={{ background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, padding: 12, color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>
                {actionError.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { if (!isDeletingRoom) { setIsDeleteRoomModalOpen(false); clearActionError(); } }}
                disabled={isDeletingRoom}
                style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: '#334155', color: '#E2E8F0', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingRoom ? 'not-allowed' : 'pointer' }}
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmDeleteRoom}
                disabled={isDeletingRoom}
                style={{ padding: '10px 16px', borderRadius: 6, backgroundColor: isDeletingRoom ? '#7F1D1D' : '#DC2626', color: 'white', border: 'none', fontSize: 14, fontWeight: 600, cursor: isDeletingRoom ? 'not-allowed' : 'pointer' }}
              >
                {isDeletingRoom ? 'Đang xóa...' : 'Xóa phòng học'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div style={{flex: 1, minHeight: 0, minWidth: 0, display: 'flex', overflow: 'hidden', position: 'relative'}}>
        
        {/* MODE A: LIVEKIT VIDEO CALL VIEW */}
        {activeMode === 'video' && (
          <div style={{flex: 1, minHeight: 0, minWidth: 0, padding: isMobile ? 8 : 20, display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 16, overflowY: 'auto', background: '#0F172A'}}>
            <ErrorBoundary key={room.id} fallback={<div role="alert">Không thể hiển thị video. Các điều khiển cuộc gọi vẫn khả dụng.</div>}>
            <MeetingVideoGrid
              members={members}
              currentUserId={currentUserId}
              currentUserName={currentUser.name}
              currentUserAvatarUrl={currentUser.avatarUrl}
              onRetryMembership={refetchMembers}
              rankOf={rankOf}
              onModerate={(userId, action) => moderate(userId, action)}
            />
            </ErrorBoundary>
          </div>
        )}

        {/* MODE C: BREAK GAME (Phấn Trắng) -- see src/activities, src/games/chalk */}
        {activeMode === 'game' && <GameStage onExit={exitGame} />}

        {/* MODE B: WHITEBOARD & PRESENTATION VIEW */}
        {(activeMode === 'whiteboard' || whiteboardOpened) && (
          <div style={{flex: 1, display: activeMode === 'whiteboard' ? 'flex' : 'none', flexDirection: 'column', background: '#F8FAFC', minWidth: 0}}>
            
            {/* Board Sub-header */}
            <div style={{height: 48, flexShrink: 0, background: 'white', borderBottom: '1px solid #E2E8F0', padding: isMobile ? '0 8px' : '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, overflowX: 'auto'}}>
              <div style={{display: 'flex', gap: isMobile ? 4 : 8, whiteSpace: 'nowrap'}}>
                <button 
                  onClick={() => setActiveBoardTab('whiteboard')}
                  style={{padding: '6px 14px', borderRadius: 6, border: 'none', background: activeBoardTab === 'whiteboard' ? '#EFF6FF' : 'transparent', color: activeBoardTab === 'whiteboard' ? '#1D4ED8' : '#64748B', fontWeight: '600', fontSize: 13, cursor: 'pointer'}}
                >
                  🎨 Bảng trắng chung
                </button>
                <button 
                  onClick={() => setActiveBoardTab('presentation')}
                  style={{padding: '6px 14px', borderRadius: 6, border: 'none', background: activeBoardTab === 'presentation' ? '#EFF6FF' : 'transparent', color: activeBoardTab === 'presentation' ? '#1D4ED8' : '#64748B', fontWeight: '600', fontSize: 13, cursor: 'pointer'}}
                >
                  📄 {isMobile ? 'Slide' : `Slide Bài giảng${room.presentation_state ? ` (${room.presentation_state.file_name})` : ''}`}
                </button>
              </div>

              {/* Action buttons */}
              <div style={{display: isMobile ? 'none' : 'flex', gap: 12}}>
                <button style={{display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12, fontWeight: '500', color: '#334155', cursor: 'pointer'}}>
                  <Download size={14} /> Tải bảng (PNG)
                </button>
                <button style={{display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12, fontWeight: '500', color: '#334155', cursor: 'pointer'}}>
                  <Share2 size={14} /> Chia sẻ link
                </button>
              </div>
            </div>

            {/* Canvas Area */}
            <div style={{flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden'}}>
              
              <div style={{position: 'absolute', inset: 0, display: activeBoardTab === 'whiteboard' ? 'block' : 'none'}}>
                <WhiteboardPanel
                  roomId={room.id}
                  initialState={room.whiteboard_state}
                  isReadonly={!permissions.canDraw}
                  editorIds={whiteboardEditorIds}
                  selfName={currentUser.name}
                />
              </div>
              {activeBoardTab === 'whiteboard' ? null : (
                <div style={{position: 'absolute', inset: 0, background: '#FFFFFF', backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)', backgroundSize: '24px 24px'}}>
                  <PresentationViewer
                    roomId={room.id}
                    initialState={room.presentation_state}
                    isReadonly={!permissions.canDraw}
                  />
                </div>
              )}

            </div>

          </div>
        )}

        {/* RIGHT COLLAPSIBLE SIDEBAR WITH SLEEK EDGE TOGGLE */}
        {isSidebarOpen ? (
          <aside style={isMobile
            ? {position: 'absolute', inset: 0, background: '#1E293B', display: 'flex', flexDirection: 'column', zIndex: 40}
            : {width: 'min(40vw, 420px)', minWidth: 340, minHeight: 0, flexShrink: 0, background: '#1E293B', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column', zIndex: 10, position: 'relative'}}>

            {/* Phone: the sheet covers the call, so it needs its own visible close bar. */}
            {isMobile && (
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 6px 14px', background: '#0F172A', borderBottom: '1px solid #334155'}}>
                <span style={{color: '#E2E8F0', fontSize: 14, fontWeight: 600}}>Tiện ích phòng học</span>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  aria-label="Đóng thanh tiện ích"
                  style={{background: '#334155', border: 'none', color: 'white', borderRadius: 8, padding: 8, display: 'flex', cursor: 'pointer'}}
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Collapse Edge Handle */}
            <button
              onClick={() => setIsSidebarOpen(false)}
              style={{
                display: isMobile ? 'none' : 'flex',
                position: 'absolute',
                top: '50%',
                left: -14,
                transform: 'translateY(-50%)',
                background: '#1E293B',
                border: '1px solid #334155',
                borderRight: 'none',
                color: '#94A3B8',
                width: 26,
                height: 48,
                borderRadius: '8px 0 0 8px',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 25,
                boxShadow: '-2px 0 8px rgba(0,0,0,0.2)'
              }}
              title="Thu gọn thanh bên"
            >
              <ChevronRight size={18} />
            </button>

            {/* Shared music: always-visible mini player above the tabs. */}
            <MusicMiniBar onOpen={showMusic} />

            {/* Sidebar navigation: room tasks are the first tab. */}
            <div style={{display: 'flex', borderBottom: '1px solid #334155', background: '#0F172A'}}>
              <button
                onClick={() => setActiveSidebarTab('tasks')}
                style={{flex: 1, padding: '14px 0', border: 'none', background: 'transparent', color: activeSidebarTab === 'tasks' ? '#38BDF8' : '#94A3B8', borderBottom: activeSidebarTab === 'tasks' ? '2px solid #38BDF8' : '2px solid transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6}}
              >
                <Sparkles size={16} /> Nhiệm vụ
              </button>
              <button 
                onClick={() => setActiveSidebarTab('chat')}
                style={{
                  flex: 1, 
                  padding: '14px 0', 
                  border: 'none', 
                  background: 'transparent', 
                  color: activeSidebarTab === 'chat' ? '#38BDF8' : '#94A3B8', 
                  borderBottom: activeSidebarTab === 'chat' ? '2px solid #38BDF8' : '2px solid transparent',
                  fontWeight: '600', 
                  fontSize: 13, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <MessageSquare size={16} /> Trò chuyện
              </button>
              <MusicTabButton
                active={activeSidebarTab === 'music'}
                onClick={() => setActiveSidebarTab('music')}
                style={(active) => ({flex: 1, padding: '14px 0', border: 'none', background: 'transparent', color: active ? '#38BDF8' : '#94A3B8', borderBottom: active ? '2px solid #38BDF8' : '2px solid transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6})}
              />
            </div>

            {activeSidebarTab === 'music' && <MusicSidebarPanel onClosed={closeMusicTab} />}

            {activeSidebarTab === 'tasks' && (
              <SessionTasksPanel
                roomId={room?.id ?? null}
                currentUserId={currentUserId}
                participants={participants}
                canEdit={isCurrentUserMember}
              />
            )}

            {/* TAB CONTENT: CHAT */}
            {activeSidebarTab === 'chat' && (
              <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden'}}>
                
                {/* Messages List */}
                <div style={{flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16}}>
                  {isMessagesLoading ? (
                    <div style={{display: 'flex', justifyContent: 'center', margin: '32px 0', color: '#94A3B8', fontSize: 13}}>
                      Đang tải tin nhắn...
                    </div>
                  ) : messagesError ? (
                    <div style={{margin: '16px 0', padding: '12px 14px', background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, color: '#FCA5A5', fontSize: 12.5}}>
                      {messagesError.message}
                    </div>
                  ) : messages.length === 0 ? (
                    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '32px 0', color: '#94A3B8', fontSize: 13, textAlign: 'center', gap: 4}}>
                      <div>Chưa có tin nhắn nào trong phòng học này.</div>
                      <div>Hãy là người đầu tiên nói lời chào!</div>
                    </div>
                  ) : (
                    // Keyed by conversation so a crash here (and the boundary it trips) resets
                    // on room/conversation change instead of showing the fallback forever -- and
                    // so it can never take the sibling LiveKit meeting tree down with it (see
                    // ErrorBoundary.tsx).
                    <ErrorBoundary
                      key={room?.conversation_id ?? 'none'}
                      fallback={
                        <div style={{margin: '16px 0', padding: '12px 14px', background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, color: '#FCA5A5', fontSize: 12.5}}>
                          Không thể hiển thị tin nhắn trong phòng học này.
                        </div>
                      }
                    >
                      {messages.map((m) => {
                        const display = senderDisplay(m);
                        return (
                          <div key={m.id} style={{display: 'flex', gap: 10, flexDirection: display.isSelf ? 'row-reverse' : 'row'}}>
                            <>
                              {display.avatarUrl ? (
                                <img src={display.avatarUrl} alt={display.name} style={{width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0}} />
                              ) : (
                                <div style={{width: 32, height: 32, borderRadius: '50%', background: display.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: 12, flexShrink: 0}}>
                                  {display.initial}
                                </div>
                              )}
                            </>
                            <div style={{maxWidth: '75%', display: 'flex', flexDirection: 'column', alignItems: display.isSelf ? 'flex-end' : 'flex-start'}}>
                              <div style={{display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 4}}>
                                <span style={{color: '#94A3B8', fontSize: 11, fontWeight: '600'}}>{display.name}</span>
                                <span style={{color: '#64748B', fontSize: 10}}>{formatMessageTime(m.created_at)}</span>
                              </div>
                              <div style={{
                                padding: '10px 14px',
                                borderRadius: display.isSelf ? '14px 2px 14px 14px' : '2px 14px 14px 14px',
                                background: display.isSelf ? '#2563EB' : '#334155',
                                color: 'white',
                                fontSize: 13,
                                lineHeight: '1.4',
                                wordBreak: 'break-word'
                              }}>
                                {m.content && <div style={{marginBottom: m.attachment_path ? 6 : 0}}>{m.content}</div>}
                                {m.attachment_path && <MessageAttachmentImage messageId={m.id} initialUrl={m.attachment_url} />}
                              </div>
                              <MessageReactions
                                reactions={m.reactions}
                                isSelf={display.isSelf}
                                onSelect={(emoji) => handleReactionSelect(m, emoji)}
                                dark
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
                <div style={{padding: 16, background: '#0F172A', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8}}>
                  {messageBan && <RestrictionBanner ban={messageBan} actionLabel="nhắn tin" variant="dark" />}
                  {(sendMessageError || imageAttachment.uploadError || imageAttachment.pickError) && (
                    <div style={{padding: '8px 12px', background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 8, color: '#FCA5A5', fontSize: 12}}>
                      {sendMessageError?.message || imageAttachment.uploadError?.message || imageAttachment.pickError}
                    </div>
                  )}
                  {imageAttachment.previewUrl && (
                    <SelectedImagePreview
                      previewUrl={imageAttachment.previewUrl}
                      onRemove={imageAttachment.clearImage}
                      disabled={isSendingMessage || imageAttachment.isUploading}
                    />
                  )}
                  <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
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
                      disabled={!room?.conversation_id || isSendingMessage || !!messageBan}
                      aria-label="Đính kèm ảnh"
                      style={{background: '#1E293B', border: '1px solid #334155', color: '#94A3B8', padding: 10, borderRadius: 8, display: 'flex', cursor: !room?.conversation_id || isSendingMessage || messageBan ? 'default' : 'pointer', opacity: !room?.conversation_id || isSendingMessage || messageBan ? 0.6 : 1}}
                    >
                      <ImageIcon size={16} />
                    </button>
                    <input
                      type="text"
                      placeholder={messageBan ? 'Bạn đang bị hạn chế nhắn tin...' : 'Nhập tin nhắn vào phòng học...'}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      disabled={!room?.conversation_id || isSendingMessage || !!messageBan}
                      // 16px on phones: iOS Safari zooms the whole page into any smaller input.
                      style={{flex: 1, minWidth: 0, padding: '10px 14px', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, outline: 'none', color: 'white', fontSize: isMobile ? 16 : 13, opacity: !room?.conversation_id || isSendingMessage || messageBan ? 0.6 : 1}}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={(!chatInput.trim() && !imageAttachment.hasImage) || !room?.conversation_id || isSendingMessage || imageAttachment.isUploading || !!messageBan}
                      style={{background: '#2563EB', border: 'none', color: 'white', padding: 10, borderRadius: 8, cursor: ((!chatInput.trim() && !imageAttachment.hasImage) || !room?.conversation_id || isSendingMessage || imageAttachment.isUploading || messageBan) ? 'default' : 'pointer', opacity: ((!chatInput.trim() && !imageAttachment.hasImage) || !room?.conversation_id || isSendingMessage || imageAttachment.isUploading || messageBan) ? 0.6 : 1}}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

          </aside>
        ) : isMobile ? null : (
          /* Sleek Right-Edge Chevron Handle when closed (phones use the footer buttons) */
          <button
            onClick={() => setIsSidebarOpen(true)}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              background: '#2563EB',
              color: 'white',
              border: 'none',
              borderRadius: '10px 0 0 10px',
              padding: '16px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '-4px 0 16px rgba(37, 99, 235, 0.4)',
              cursor: 'pointer',
              zIndex: 30,
              transition: 'all 0.2s'
            }}
            title="Mở thanh tiện ích (Trò chuyện & Thành viên)"
          >
            <ChevronLeft size={22} />
          </button>
        )}

      </div>

      {/* Floating Bottom Control Dock */}
      <footer aria-label="Thanh công cụ phòng học" style={isMobile
        ? {flexShrink: 0, background: '#1E293B', borderTop: '1px solid #334155', padding: '8px 8px', paddingBottom: 'max(8px, env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 30, position: 'relative'}
        : {height: 60, flexShrink: 0, background: '#1E293B', borderTop: '1px solid #334155', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 30, position: 'relative'}}>

        {/* Left indicators */}
        {!isMobile && (
          <div style={{display: 'flex', alignItems: 'center', gap: 12, color: '#94A3B8', fontSize: 13}}>
            <Sparkles size={18} color="#38BDF8" />
            <span>StudyTogether Call Room v2.0</span>
          </div>
        )}

        {/* Center Control Buttons */}
        <div style={isMobile
          ? {display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', width: '100%', maxWidth: 420, gap: 6}
          : {position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12}}>
          
          {/* Mic / Camera — real LiveKit track state, see meeting/MeetingControls.tsx. */}
          <MeetingControls disabled={false} />

          {/* In-call activities: break game + shared music (src/activities). */}
          <ActivitiesButton disabled={!isCurrentUserMember} />

          {/* Raise Hand — real moderation action (self-service raise_hand/lower_hand). */}
          <button
            onClick={handleToggleHand}
            style={{
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: '50%',
              border: 'none',
              background: currentUserHandRaised ? '#F59E0B' : '#334155',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            title="Giơ tay phát biểu"
          >
            <Hand size={20} />
          </button>

          {/* Phone: the sidebar has no edge handle, so tasks/chat open from here. */}
          {isMobile && (
            <>
              <button
                onClick={() => openSidebarTab('tasks')}
                aria-label="Nhiệm vụ"
                title="Nhiệm vụ"
                style={{width: 42, height: 42, borderRadius: '50%', border: 'none', background: '#334155', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
              >
                <Sparkles size={20} />
              </button>
              <button
                onClick={() => openSidebarTab('chat')}
                aria-label="Trò chuyện"
                title="Trò chuyện"
                style={{width: 42, height: 42, borderRadius: '50%', border: 'none', background: '#334155', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
              >
                <MessageSquare size={20} />
              </button>
            </>
          )}

          {/* Leave Room Button */}
          <button 
            onClick={handleLeaveRoom}
            style={{
              width: 42, 
              height: 42, 
              borderRadius: '50%', 
              border: 'none', 
              background: '#DC2626', 
              color: 'white', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.4)',
              transition: 'all 0.2s'
            }}
            title="Thoát phòng học"
          >
            <PhoneOff size={20} />
          </button>

        </div>

      </footer>

    </div>
    </RoomActivitiesProvider>
    </MeetingProvider>
  );
}
