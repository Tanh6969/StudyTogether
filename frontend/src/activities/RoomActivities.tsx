import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Gamepad2, Music2, Sparkles } from 'lucide-react';
import { ApiError } from '../lib/apiClient';
import type { RoomActivity } from '../lib/activity.types';
import type { UserSummary } from '../lib/profile.types';
import { getDisplayName } from '../utils/userDisplay';
import { useActivityBus } from './net/useActivityBus';
import type { ActivityBus } from './net/useActivityBus';
import { useRoomActivities } from './useRoomActivities';
import type { RoomActivitiesApi } from './useRoomActivities';
import { ActivityTray } from './ActivityTray';
import { useMusicQueue, useMusicSync } from '../music/useMusicSync';
import type { MusicController, MusicQueueApi } from '../music/useMusicSync';
import { PlayerDock } from '../music/PlayerDock';
import { MusicMiniPlayer } from '../music/MusicMiniPlayer';
import { MusicPanel } from '../music/MusicPanel';
import { useChalkGame } from '../games/chalk/useChalkGame';
import type { ChalkGameApi } from '../games/chalk/useChalkGame';
import { ChalkGame } from '../games/chalk/ChalkGame';
import type { ChalkPerson } from '../games/chalk/ChalkGame';

/**
 * Everything the in-call activities need, mounted INSIDE the LiveKit room (MeetingProvider) so
 * the data channel is available, and exposed to the room page's header / footer / sidebar /
 * center stage through small slot components below.
 */

interface ActivitiesContextValue {
  roomId: string;
  currentUserId: string;
  isManager: boolean;
  isParticipant: boolean;
  people: Record<string, ChalkPerson>;
  bus: ActivityBus;
  activities: RoomActivitiesApi;
  musicQueue: MusicQueueApi;
  music: MusicController;
  chalk: ChalkGameApi;
  setPlayerSlot: (el: HTMLElement | null) => void;
  setMiniSlot: (el: HTMLElement | null) => void;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  busy: boolean;
  trayError: string | null;
  startGame: () => Promise<void>;
  startMusic: () => Promise<void>;
  joinGame: () => Promise<void>;
  openGame: () => void;
  openMusic: () => void;
  nameOf: (user: UserSummary | null | undefined, userId: string) => string;
}

const ActivitiesContext = createContext<ActivitiesContextValue | null>(null);

function useActivities(): ActivitiesContextValue | null {
  return useContext(ActivitiesContext);
}

interface RoomActivitiesProviderProps {
  roomId: string;
  currentUserId: string | null;
  enabled: boolean;
  isManager: boolean;
  people: ChalkPerson[];
  /** Ask the page to show the game stage / the Nhạc sidebar tab. */
  onShowGame: () => void;
  onShowMusic: () => void;
  children: ReactNode;
}

export function RoomActivitiesProvider({ roomId, currentUserId, enabled, isManager, people, onShowGame, onShowMusic, children }: RoomActivitiesProviderProps) {
  const bus = useActivityBus();
  const activities = useRoomActivities(roomId, currentUserId, bus, enabled);
  const musicQueue = useMusicQueue(enabled ? roomId : null, activities.music?.id ?? null);
  const music = useMusicSync({ roomId, activity: activities.music, queue: musicQueue, bus, currentUserId, onActivityUpdated: activities.applyLocal });
  const persistGame = useCallback(
    (activityId: string, snapshot: unknown, status: 'lobby' | 'running') => {
      void activities.patch(activityId, { snapshot: snapshot as Record<string, unknown>, status }).catch(() => undefined);
    },
    [activities]
  );
  const endGame = useCallback((activityId: string) => void activities.end(activityId).catch(() => undefined), [activities]);
  const chalk = useChalkGame({ bus, activity: activities.game, currentUserId, persist: persistGame, endActivity: endGame });

  const [playerSlot, setPlayerSlot] = useState<HTMLElement | null>(null);
  const [miniSlot, setMiniSlot] = useState<HTMLElement | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trayError, setTrayError] = useState<string | null>(null);

  const peopleMap = useMemo(() => Object.fromEntries(people.map((p) => [p.userId, p])), [people]);
  const nameOf = useCallback(
    (user: UserSummary | null | undefined, userId: string) => {
      if (userId === currentUserId) return 'bạn';
      return peopleMap[userId]?.name ?? getDisplayName(user);
    },
    [peopleMap, currentUserId]
  );

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setTrayError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setTrayError(err instanceof ApiError ? err.message : 'Không thực hiện được, thử lại nhé.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const startGame = useCallback(async () => {
    const ok = await run(() => activities.start({ kind: 'game', game: 'chalk' }));
    if (ok) {
      setTrayOpen(false);
      onShowGame();
    }
  }, [run, activities, onShowGame]);

  const joinGame = useCallback(async () => {
    const game = activities.game;
    if (!game || !currentUserId) return;
    if (!game.participants.includes(currentUserId)) await run(() => activities.join(game.id));
  }, [activities, currentUserId, run]);

  const startMusic = useCallback(async () => {
    const ok = await run(() => activities.start({ kind: 'music' }));
    if (ok) {
      music.unlock();
      setTrayOpen(false);
      onShowMusic();
    }
  }, [run, activities, onShowMusic, music]);

  const openGame = useCallback(() => {
    setTrayOpen(false);
    onShowGame();
    void joinGame();
  }, [onShowGame, joinGame]);

  const openMusic = useCallback(() => {
    setTrayOpen(false);
    music.unlock();
    onShowMusic();
    const m = activities.music;
    if (m && currentUserId && !m.participants.includes(currentUserId)) void activities.join(m.id).catch(() => undefined);
  }, [onShowMusic, music, activities, currentUserId]);

  const value = useMemo<ActivitiesContextValue | null>(
    () =>
      currentUserId
        ? {
            roomId,
            currentUserId,
            isManager,
            isParticipant: enabled,
            people: peopleMap,
            bus,
            activities,
            musicQueue,
            music,
            chalk,
            setPlayerSlot,
            setMiniSlot,
            trayOpen,
            setTrayOpen,
            busy,
            trayError,
            startGame,
            startMusic,
            joinGame,
            openGame,
            openMusic,
            nameOf,
          }
        : null,
    [roomId, currentUserId, isManager, enabled, peopleMap, bus, activities, musicQueue, music, chalk, trayOpen, busy, trayError, startGame, startMusic, joinGame, openGame, openMusic, nameOf]
  );

  return (
    <ActivitiesContext.Provider value={value}>
      {children}
      <PlayerDock attachContainer={music.attachContainer} panelSlot={playerSlot} miniSlot={miniSlot} hidden={!activities.music || !music.current} />
    </ActivitiesContext.Provider>
  );
}

// ------------------------------------------------------------------------------------------------
// Slots
// ------------------------------------------------------------------------------------------------

/** Footer button + the tray that opens above it. */
export function ActivitiesButton({ disabled }: { disabled: boolean }) {
  const ctx = useActivities();
  if (!ctx) return null;
  const { activities, trayOpen, setTrayOpen } = ctx;
  const liveCount = (activities.game ? 1 : 0) + (activities.music ? 1 : 0);
  const people = new Set([...(activities.game?.participants ?? []), ...(activities.music?.participants ?? [])]).size;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setTrayOpen(!trayOpen)}
        disabled={disabled}
        title="Hoạt động: game giải lao, nghe nhạc chung"
        aria-label="Hoạt động"
        aria-expanded={trayOpen}
        style={{
          position: 'relative',
          width: 42,
          height: 42,
          borderRadius: '50%',
          border: 'none',
          background: trayOpen ? '#2563EB' : '#334155',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.2s',
        }}
      >
        <Sparkles size={18} />
        {liveCount > 0 && (
          <span
            aria-label={`${people} người đang tham gia`}
            style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box', borderRadius: 999, background: '#10B981', border: '2px solid #1E293B', color: '#0F172A', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {people}
          </span>
        )}
      </button>
      <ActivityTray
        open={trayOpen}
        onClose={() => setTrayOpen(false)}
        game={activities.game}
        music={activities.music}
        currentUserId={ctx.currentUserId}
        busy={ctx.busy}
        error={ctx.trayError ?? activities.error}
        onStartGame={() => void ctx.startGame()}
        onOpenGame={ctx.openGame}
        onStartMusic={() => void ctx.startMusic()}
        onOpenMusic={ctx.openMusic}
      />
    </div>
  );
}

/** The "Giải lao" button for the header's mode switcher; only while a game is live. */
export function GameModeTab({ active, onClick, style }: { active: boolean; onClick: () => void; style: (active: boolean) => CSSProperties }) {
  const ctx = useActivities();
  if (!ctx?.activities.game) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        void ctx.joinGame();
      }}
      style={style(active)}
    >
      <Gamepad2 size={16} /> Giải lao
      <span className="activity-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
    </button>
  );
}

/** The center stage while in "Giải lao" mode. */
export function GameStage({ onExit }: { onExit: () => void }) {
  const ctx = useActivities();
  const game = ctx?.activities.game ?? null;
  const loading = ctx?.activities.isLoading ?? true;
  useEffect(() => {
    if (!loading && !game) onExit();
  }, [loading, game, onExit]);
  if (!ctx || !game) return null;
  return (
    <ChalkGame
      game={ctx.chalk}
      roomId={ctx.roomId}
      currentUserId={ctx.currentUserId}
      people={ctx.people}
      isManager={ctx.isManager}
      isParticipant={ctx.isParticipant}
      onJoin={() => void ctx.joinGame()}
      onLeave={() => {
        void ctx.activities.leave(game.id).catch(() => undefined);
        onExit();
      }}
      onEnd={() => void ctx.activities.end(game.id).catch(() => undefined)}
      onExit={onExit}
    />
  );
}

/** Mini player strip above the sidebar tabs. */
export function MusicMiniBar({ onOpen }: { onOpen: () => void }) {
  const ctx = useActivities();
  if (!ctx?.activities.music) return null;
  const m = ctx.activities.music;
  return (
    <MusicMiniPlayer
      controller={ctx.music}
      djName={ctx.nameOf(m.host, m.host_user_id)}
      onDiscSlot={ctx.setMiniSlot}
      onOpen={() => {
        ctx.music.unlock();
        onOpen();
      }}
    />
  );
}

export function MusicTabButton({ active, onClick, style }: { active: boolean; onClick: () => void; style: (active: boolean) => CSSProperties }) {
  const ctx = useActivities();
  if (!ctx?.activities.music) return null;
  return (
    <button type="button" onClick={onClick} style={style(active)}>
      <Music2 size={16} /> Nhạc
    </button>
  );
}

export function MusicSidebarPanel({ onClosed }: { onClosed: () => void }) {
  const ctx = useActivities();
  const music = ctx?.activities.music ?? null;
  const loading = ctx?.activities.isLoading ?? true;
  useEffect(() => {
    if (!loading && !music) onClosed();
  }, [loading, music, onClosed]);
  // Opening the panel counts as listening: join the session so skip votes have the right quorum.
  const musicId = music?.id ?? null;
  const joined = !!music && !!ctx && music.participants.includes(ctx.currentUserId);
  useEffect(() => {
    if (!ctx || !musicId || joined) return;
    ctx.music.unlock();
    void ctx.activities.join(musicId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicId, joined]);
  if (!ctx || !music) return null;
  return (
    <MusicPanel
      activity={music}
      controller={ctx.music}
      queue={ctx.musicQueue}
      currentUserId={ctx.currentUserId}
      isManager={ctx.isManager}
      onPlayerSlot={ctx.setPlayerSlot}
      onEnd={() => void ctx.activities.end(music.id).catch(() => undefined)}
      onLeave={() => {
        if (!ctx.music.muted) ctx.music.toggleMuted();
        void ctx.activities.leave(music.id).catch(() => undefined);
        onClosed();
      }}
      resolveName={ctx.nameOf}
    />
  );
}

export type { RoomActivity };
