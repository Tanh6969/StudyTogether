import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMaybeRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { supabase } from '../lib/supabase';
import { USE_MOCK } from '../mocks/config';
import { addToMusicQueue, listMusicQueue, removeMusicQueueItem, updateMusicQueueItem, updateRoomActivity } from '../lib/activity.api';
import type { MusicProvider, QueueItem, RoomActivity } from '../lib/activity.types';
import { ApiError } from '../lib/apiClient';
import type { ActivityBus } from '../activities/net/useActivityBus';
import { useBusEvent, useHostHeartbeat } from '../activities/net/useActivityBus';
import type { PlayerAdapter, PlayerErrorInfo } from './players/PlayerAdapter';
import { YouTubeAdapter } from './players/YouTubeAdapter';
import { SoundCloudAdapter } from './players/SoundCloudAdapter';
import { SpotifyAdapter } from './players/SpotifyAdapter';

/* ------------------------------------------------------------------------------------------
 * Shared music (docs/design/hoat-dong-trong-call.md §3). Discord's model: nobody streams audio
 * to anybody. The DJ (= the music activity's host) owns one small playback state; every browser
 * plays the same track locally through the provider's embedded player and keeps itself within
 * a few hundred ms of the DJ's clock.
 * ---------------------------------------------------------------------------------------- */

export type LoopMode = 'off' | 'one' | 'all';

export interface MusicState {
  currentId: string | null;
  isPlaying: boolean;
  /** Position (ms) at the instant `anchorAt` (DJ wall clock). */
  positionMs: number;
  anchorAt: number;
  loop: LoopMode;
  skipVotes: string[];
  updatedAt: number;
}

const EMPTY_STATE: MusicState = { currentId: null, isPlaying: false, positionMs: 0, anchorAt: 0, loop: 'off', skipVotes: [], updatedAt: 0 };

const DRIFT_IGNORE_MS = 400;
const DRIFT_SEEK_MS = 2000;
const TICK_MS = 2000;
const VOLUME_KEY = 'studytogether.music.volume';
const MUTED_KEY = 'studytogether.music.muted';
const DUCK_KEY = 'studytogether.music.duck';

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode etc.
  }
}

function parseSnapshot(snapshot: Record<string, unknown> | null | undefined): MusicState | null {
  if (!snapshot || typeof snapshot !== 'object' || !('updatedAt' in snapshot)) return null;
  const s = snapshot as Partial<MusicState>;
  return {
    currentId: typeof s.currentId === 'string' ? s.currentId : null,
    isPlaying: !!s.isPlaying,
    positionMs: typeof s.positionMs === 'number' ? s.positionMs : 0,
    anchorAt: typeof s.anchorAt === 'number' ? s.anchorAt : 0,
    loop: s.loop === 'one' || s.loop === 'all' ? s.loop : 'off',
    skipVotes: Array.isArray(s.skipVotes) ? s.skipVotes.filter((v): v is string => typeof v === 'string') : [],
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
  };
}

export function sortQueue(queue: QueueItem[]): QueueItem[] {
  return [...queue].sort((a, b) => a.position - b.position || a.added_at.localeCompare(b.added_at));
}

/** Which track the DJ should move to after `currentId` (null = stop). */
export function pickNext(queue: QueueItem[], currentId: string | null, loop: LoopMode): QueueItem | null {
  const ordered = sortQueue(queue);
  const current = ordered.find((i) => i.id === currentId) ?? null;
  if (loop === 'one' && current) return current;
  const idx = ordered.findIndex((i) => i.id === currentId);
  const after = ordered.slice(idx + 1).find((i) => !i.played_at);
  if (after) return after;
  const anyUnplayed = ordered.find((i) => !i.played_at && i.id !== currentId);
  if (anyUnplayed) return anyUnplayed;
  if (loop === 'all') return ordered[0] ?? null;
  return null;
}

// --- queue -----------------------------------------------------------------------------------

export interface MusicQueueApi {
  queue: QueueItem[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  add: (url: string) => Promise<QueueItem>;
  remove: (itemId: string) => Promise<void>;
  reorder: (itemId: string, position: number) => Promise<void>;
  markPlayed: (itemId: string, played: boolean) => Promise<void>;
}

export function useMusicQueue(roomId: string | null, activityId: string | null): MusicQueueApi {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!roomId || !activityId) return;
    try {
      setQueue(sortQueue(await listMusicQueue(roomId, activityId)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được hàng đợi nhạc.');
    } finally {
      setIsLoading(false);
    }
  }, [roomId, activityId]);

  useEffect(() => {
    setQueue([]);
    setIsLoading(!!activityId);
    void reload();
  }, [reload, activityId]);

  useEffect(() => {
    if (USE_MOCK || !activityId) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 120);
    };
    const channel = supabase
      .channel(`room_music_queue:activity:${activityId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_music_queue', filter: `activity_id=eq.${activityId}` }, schedule)
      .subscribe();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [activityId, reload]);

  const add = useCallback(
    async (url: string) => {
      if (!roomId || !activityId) throw new Error('no activity');
      const item = await addToMusicQueue(roomId, activityId, url);
      setQueue((prev) => (prev.some((i) => i.id === item.id) ? prev : sortQueue([...prev, item])));
      return item;
    },
    [roomId, activityId]
  );
  const remove = useCallback(
    async (itemId: string) => {
      if (!roomId || !activityId) return;
      setQueue((prev) => prev.filter((i) => i.id !== itemId));
      try {
        await removeMusicQueueItem(roomId, activityId, itemId);
      } catch {
        void reload();
      }
    },
    [roomId, activityId, reload]
  );
  const reorder = useCallback(
    async (itemId: string, position: number) => {
      if (!roomId || !activityId) return;
      setQueue((prev) => sortQueue(prev.map((i) => (i.id === itemId ? { ...i, position } : i))));
      try {
        await updateMusicQueueItem(roomId, activityId, itemId, { position });
      } catch {
        void reload();
      }
    },
    [roomId, activityId, reload]
  );
  const markPlayed = useCallback(
    async (itemId: string, played: boolean) => {
      if (!roomId || !activityId) return;
      const played_at = played ? new Date().toISOString() : null;
      setQueue((prev) => prev.map((i) => (i.id === itemId ? { ...i, played_at } : i)));
      try {
        await updateMusicQueueItem(roomId, activityId, itemId, { played_at });
      } catch {
        void reload();
      }
    },
    [roomId, activityId, reload]
  );

  return { queue, isLoading, error, reload, add, remove, reorder, markPlayed };
}

// --- playback sync -----------------------------------------------------------------------------

export interface MusicController {
  state: MusicState;
  current: QueueItem | null;
  isDj: boolean;
  djId: string | null;
  /** Browsers only play sound after a user gesture; until then a joining listener sees a
   * "bấm để nghe cùng" button instead of silent playback. */
  unlocked: boolean;
  unlock: () => void;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  toggleMuted: () => void;
  ducking: boolean;
  setDucking: (on: boolean) => void;
  capabilities: { volume: boolean; rate: boolean };
  lastError: string | null;
  clearError: () => void;
  skipVotes: number;
  skipVotesNeeded: number;
  hasVotedSkip: boolean;
  // controls (DJ only, except voteSkip / claimDj)
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  playItem: (itemId: string) => void;
  setLoop: (mode: LoopMode) => void;
  voteSkip: () => void;
  claimDj: () => Promise<void>;
  /** Where the embedded player lives. Attach once to a persistent element. */
  attachContainer: (el: HTMLElement | null) => void;
}

interface UseMusicSyncArgs {
  roomId: string | null;
  activity: RoomActivity | null;
  queue: MusicQueueApi;
  bus: ActivityBus;
  currentUserId: string | null;
  onActivityUpdated: (activity: RoomActivity) => void;
}

export function useMusicSync({ roomId, activity, queue, bus, currentUserId, onActivityUpdated }: UseMusicSyncArgs): MusicController {
  const room = useMaybeRoomContext();
  const activityId = activity?.id ?? null;
  const djId = activity?.host_user_id ?? null;
  const isDj = !!currentUserId && djId === currentUserId;

  const [state, setStateRaw] = useState<MusicState>(() => parseSnapshot(activity?.snapshot) ?? EMPTY_STATE);
  const stateRef = useRef(state);
  const setState = useCallback((next: MusicState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const [unlocked, setUnlocked] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [volume, setVolumeRaw] = useState<number>(() => readStored(VOLUME_KEY, 0.6));
  const [muted, setMuted] = useState<boolean>(() => readStored(MUTED_KEY, false));
  const [ducking, setDuckingRaw] = useState<boolean>(() => readStored(DUCK_KEY, true));
  const [lastError, setLastError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState({ volume: true, rate: true });

  const containerRef = useRef<HTMLElement | null>(null);
  const wrappersRef = useRef<Map<MusicProvider, HTMLDivElement>>(new Map());
  const adaptersRef = useRef<Map<MusicProvider, PlayerAdapter>>(new Map());
  const activeAdapterRef = useRef<PlayerAdapter | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const loadingRef = useRef<Promise<void> | null>(null);
  const duckRef = useRef(1);
  const duckTimerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const queueRef = useRef(queue.queue);
  queueRef.current = queue.queue;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const isDjRef = useRef(isDj);
  isDjRef.current = isDj;
  const [, forceTick] = useState(0);

  const current = useMemo(() => queue.queue.find((i) => i.id === state.currentId) ?? null, [queue.queue, state.currentId]);

  useHostHeartbeat(bus, activityId, isDj);

  // Reset when the activity changes / ends.
  useEffect(() => {
    if (!activityId) {
      setState(EMPTY_STATE);
      loadedIdRef.current = null;
      activeAdapterRef.current?.pause();
      return;
    }
    const fromSnapshot = parseSnapshot(activity?.snapshot);
    if (fromSnapshot && fromSnapshot.updatedAt > stateRef.current.updatedAt) setState(fromSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, activity?.snapshot_at]);

  const expectedPosition = useCallback(
    (s: MusicState = stateRef.current) => {
      if (!s.isPlaying) return s.positionMs;
      const anchorLocal = djId ? bus.toLocalTime(djId, s.anchorAt) : s.anchorAt;
      return s.positionMs + (Date.now() - anchorLocal);
    },
    [bus, djId]
  );

  // --- player plumbing ---

  const applyVolume = useCallback(() => {
    const adapter = activeAdapterRef.current;
    if (!adapter) return;
    adapter.setVolume(muted ? 0 : volume * duckRef.current);
  }, [muted, volume]);

  const getAdapter = useCallback(
    async (provider: MusicProvider): Promise<PlayerAdapter | null> => {
      const container = containerRef.current;
      if (!container) return null;
      let adapter = adaptersRef.current.get(provider);
      if (!adapter) {
        adapter = provider === 'youtube' ? new YouTubeAdapter() : provider === 'soundcloud' ? new SoundCloudAdapter() : new SpotifyAdapter();
        const wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.inset = '0';
        wrapper.style.display = 'none';
        container.appendChild(wrapper);
        wrappersRef.current.set(provider, wrapper);
        adaptersRef.current.set(provider, adapter);
        adapter.on('error', (info: PlayerErrorInfo) => {
          setLastError(info.message);
          if (isDjRef.current && (info.code === 'embed_blocked' || info.code === 'not_found')) {
            // Skip a track nobody can play; everyone else learns via music.state.
            window.setTimeout(() => nextRef.current(), 400);
          }
        });
        adapter.on('duration', () => setDurationMs(activeAdapterRef.current?.getDuration() ?? null));
        adapter.on('play', () => {
          if (isDjRef.current) void djAnnounceRef.current(true);
        });
        adapter.on('pause', () => {
          if (isDjRef.current) void djAnnounceRef.current(false);
        });
        adapter.on('ended', () => {
          if (isDjRef.current) nextRef.current();
        });
        try {
          await adapter.mount(wrapper);
        } catch (err) {
          setLastError(err instanceof Error ? err.message : 'Không tải được trình phát.');
          return null;
        }
      }
      return adapter;
    },
    []
  );

  const showProvider = useCallback((provider: MusicProvider | null) => {
    wrappersRef.current.forEach((el, key) => {
      el.style.display = key === provider ? 'block' : 'none';
    });
  }, []);

  /** Make sure the player holds `item` (loads it if not), then play/pause per `s`. */
  const reconcile = useCallback(
    async (s: MusicState) => {
      const item = queueRef.current.find((i) => i.id === s.currentId) ?? null;
      if (!item) {
        activeAdapterRef.current?.pause();
        loadedIdRef.current = null;
        showProvider(null);
        return;
      }
      const wantAudio = s.isPlaying && (isDjRef.current || unlockedRef.current);
      if (loadingRef.current) await loadingRef.current;
      if (loadedIdRef.current !== item.id) {
        const adapter = await getAdapter(item.provider);
        if (!adapter) return;
        if (activeAdapterRef.current && activeAdapterRef.current !== adapter) activeAdapterRef.current.pause();
        activeAdapterRef.current = adapter;
        setCapabilities(adapter.capabilities);
        showProvider(item.provider);
        setDurationMs(item.duration_ms);
        setLastError(null);
        loadedIdRef.current = item.id;
        const startAt = Math.max(item.start_ms, isDjRef.current ? s.positionMs : expectedPosition(s));
        loadingRef.current = adapter
          .load({ provider: item.provider, provider_id: item.provider_id, start_ms: startAt }, wantAudio)
          .catch(() => undefined)
          .finally(() => {
            loadingRef.current = null;
          });
        await loadingRef.current;
        applyVolume();
        if (wantAudio) {
          adapter.play();
          if (!isDjRef.current) adapter.seek(expectedPosition(s));
        }
        return;
      }
      const adapter = activeAdapterRef.current;
      if (!adapter) return;
      if (wantAudio) {
        adapter.play();
        if (!isDjRef.current) {
          const pos = await adapter.getPosition();
          if (Math.abs(pos - expectedPosition(s)) > DRIFT_SEEK_MS) adapter.seek(expectedPosition(s));
        }
      } else {
        adapter.pause();
        if (!isDjRef.current && !s.isPlaying) adapter.seek(s.positionMs);
      }
    },
    [getAdapter, showProvider, expectedPosition, applyVolume]
  );

  // Re-parenting an iframe reloads it (and restarts playback), so the container is attached
  // once and wrappers are only moved if the container element really changed.
  const attachContainer = useCallback(
    (el: HTMLElement | null) => {
      if (!el || containerRef.current === el) return;
      containerRef.current = el;
      wrappersRef.current.forEach((w) => {
        if (w.parentElement !== el) el.appendChild(w);
      });
      void reconcile(stateRef.current);
    },
    [reconcile]
  );

  // Re-run reconcile when the track or play state changes, or when the queue finally has
  // the current item (late joiner: state arrives before the queue list).
  useEffect(() => {
    void reconcile(state);
  }, [state.currentId, state.isPlaying, current?.id, unlocked, reconcile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applyVolume();
  }, [applyVolume]);

  // --- DJ side ---

  const persist = useCallback(
    (next: MusicState) => {
      if (!roomId || !activityId) return;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        updateRoomActivity(roomId, activityId, { snapshot: next as unknown as Record<string, unknown> })
          .then(onActivityUpdated)
          .catch(() => undefined);
      }, 500);
    },
    [roomId, activityId, onActivityUpdated]
  );

  const publish = useCallback(
    (partial: Partial<MusicState>) => {
      const next: MusicState = { ...stateRef.current, ...partial, updatedAt: Date.now() };
      setState(next);
      bus.send('music', 'state', next);
      persist(next);
    },
    [bus, persist, setState]
  );

  const djAnnounceRef = useRef(async (_playing: boolean) => {});
  djAnnounceRef.current = async (playing: boolean) => {
    const adapter = activeAdapterRef.current;
    const pos = adapter ? await adapter.getPosition() : stateRef.current.positionMs;
    if (stateRef.current.isPlaying === playing && Math.abs(pos - expectedPosition()) < DRIFT_IGNORE_MS) return;
    publish({ isPlaying: playing, positionMs: pos, anchorAt: Date.now() });
  };

  const goTo = useCallback(
    (item: QueueItem | null) => {
      const previousId = stateRef.current.currentId;
      if (previousId && previousId !== item?.id) void queue.markPlayed(previousId, true);
      if (!item) {
        publish({ currentId: null, isPlaying: false, positionMs: 0, anchorAt: Date.now(), skipVotes: [] });
        return;
      }
      if (item.played_at) void queue.markPlayed(item.id, false);
      publish({ currentId: item.id, isPlaying: true, positionMs: item.start_ms, anchorAt: Date.now(), skipVotes: [] });
    },
    [publish, queue]
  );

  const next = useCallback(() => {
    if (!isDjRef.current) return;
    goTo(pickNext(queueRef.current, stateRef.current.currentId, stateRef.current.loop));
  }, [goTo]);
  const nextRef = useRef(next);
  nextRef.current = next;

  const prev = useCallback(() => {
    if (!isDjRef.current) return;
    const pos = expectedPosition();
    if (pos > 3000 || !stateRef.current.currentId) {
      activeAdapterRef.current?.seek(current?.start_ms ?? 0);
      publish({ positionMs: current?.start_ms ?? 0, anchorAt: Date.now() });
      return;
    }
    const played = sortQueue(queueRef.current).filter((i) => i.played_at && i.id !== stateRef.current.currentId);
    const last = played.sort((a, b) => (a.played_at ?? '').localeCompare(b.played_at ?? '')).pop();
    if (last) goTo(last);
  }, [expectedPosition, publish, goTo, current]);

  const play = useCallback(() => {
    if (!isDjRef.current) return;
    setUnlocked(true);
    if (!stateRef.current.currentId) {
      const first = pickNext(queueRef.current, null, stateRef.current.loop);
      if (first) goTo(first);
      return;
    }
    activeAdapterRef.current?.play();
    publish({ isPlaying: true, anchorAt: Date.now() });
  }, [goTo, publish]);

  const pause = useCallback(() => {
    if (!isDjRef.current) return;
    activeAdapterRef.current?.pause();
    void (async () => {
      const pos = activeAdapterRef.current ? await activeAdapterRef.current.getPosition() : expectedPosition();
      publish({ isPlaying: false, positionMs: pos, anchorAt: Date.now() });
    })();
  }, [publish, expectedPosition]);

  const togglePlay = useCallback(() => {
    if (stateRef.current.isPlaying) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback(
    (ms: number) => {
      if (!isDjRef.current) return;
      activeAdapterRef.current?.seek(ms);
      publish({ positionMs: ms, anchorAt: Date.now() });
    },
    [publish]
  );

  const playItem = useCallback(
    (itemId: string) => {
      if (!isDjRef.current) return;
      const item = queueRef.current.find((i) => i.id === itemId);
      if (item) goTo(item);
    },
    [goTo]
  );

  const setLoop = useCallback(
    (mode: LoopMode) => {
      if (!isDjRef.current) return;
      publish({ loop: mode });
    },
    [publish]
  );

  // DJ: auto-start when the queue gets its first track, and auto-advance if the current item
  // was deleted from under us.
  useEffect(() => {
    if (!isDj || !activityId) return;
    const s = stateRef.current;
    if (!s.currentId) {
      const first = pickNext(queue.queue, null, s.loop);
      if (first) goTo(first);
    } else if (!queue.queue.some((i) => i.id === s.currentId) && !queue.isLoading && queue.queue.length >= 0 && !queue.error) {
      if (queue.queue.length > 0 || s.currentId) next();
    }
  }, [isDj, activityId, queue.queue, queue.isLoading, queue.error, goTo, next]);

  // DJ: ticks (lossy) so listeners can correct drift / ads.
  useEffect(() => {
    if (!isDj || !activityId || !bus.connected) return;
    const timer = window.setInterval(async () => {
      const s = stateRef.current;
      if (!s.currentId) return;
      const adapter = activeAdapterRef.current;
      const pos = adapter ? await adapter.getPosition() : expectedPosition();
      if (s.isPlaying) {
        stateRef.current = { ...s, positionMs: pos, anchorAt: Date.now() };
      }
      bus.send('music', 'tick', { currentId: s.currentId, isPlaying: s.isPlaying, positionMs: pos, anchorAt: Date.now() }, { reliable: false });
      // Late joiner / reconnect: a full state every ~10 s costs nothing.
      if (Math.random() < 0.2) bus.send('music', 'state', stateRef.current);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isDj, activityId, bus, expectedPosition]);

  // DJ: answer explicit state requests from newcomers.
  useBusEvent<{ activityId: string }>(bus, 'music', 'req_state', (payload, packet) => {
    if (!isDjRef.current || payload.activityId !== activityId) return;
    bus.send('music', 'state', stateRef.current, { to: [packet.from] });
  });

  // Listener: ask the DJ for the state when we arrive.
  useEffect(() => {
    if (!activityId || isDj || !bus.connected) return;
    bus.send('music', 'req_state', { activityId });
  }, [activityId, isDj, bus]);

  // --- listener side ---

  useBusEvent<MusicState>(bus, 'music', 'state', (payload, packet) => {
    if (packet.from !== djId) return;
    if (payload.updatedAt < stateRef.current.updatedAt) return;
    setState(payload);
  });

  useBusEvent<{ currentId: string | null; isPlaying: boolean; positionMs: number; anchorAt: number }>(bus, 'music', 'tick', (payload, packet) => {
    if (packet.from !== djId || isDjRef.current) return;
    const s = stateRef.current;
    if (payload.currentId !== s.currentId || payload.isPlaying !== s.isPlaying) {
      // We missed a state packet; adopt the tick as state and let reconcile load the track.
      setState({ ...s, currentId: payload.currentId, isPlaying: payload.isPlaying, positionMs: payload.positionMs, anchorAt: payload.anchorAt, updatedAt: Date.now() });
      return;
    }
    stateRef.current = { ...s, positionMs: payload.positionMs, anchorAt: payload.anchorAt };
  });

  // Listener: drift correction loop.
  useEffect(() => {
    if (isDj || !activityId) return;
    let rateTimer: number | null = null;
    const timer = window.setInterval(async () => {
      const s = stateRef.current;
      const adapter = activeAdapterRef.current;
      if (!adapter || !s.isPlaying || !unlockedRef.current || loadedIdRef.current !== s.currentId) return;
      const pos = await adapter.getPosition();
      const drift = pos - expectedPosition(s);
      const abs = Math.abs(drift);
      if (abs < DRIFT_IGNORE_MS) return;
      if (abs < DRIFT_SEEK_MS && adapter.capabilities.rate) {
        adapter.setRate(drift > 0 ? 0.95 : 1.05);
        if (rateTimer !== null) window.clearTimeout(rateTimer);
        rateTimer = window.setTimeout(() => adapter.setRate(1), 3000);
      } else {
        adapter.setRate(1);
        adapter.seek(expectedPosition(s));
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      if (rateTimer !== null) window.clearTimeout(rateTimer);
      activeAdapterRef.current?.setRate(1);
    };
  }, [isDj, activityId, expectedPosition]);

  // Everyone: a cheap UI position ticker.
  useEffect(() => {
    if (!activityId) return;
    const timer = window.setInterval(async () => {
      const s = stateRef.current;
      if (!s.currentId) {
        setPositionMs(0);
        return;
      }
      const adapter = activeAdapterRef.current;
      if (adapter && loadedIdRef.current === s.currentId && (isDjRef.current || unlockedRef.current)) {
        setPositionMs(await adapter.getPosition());
        const d = adapter.getDuration();
        if (d) setDurationMs(d);
      } else {
        setPositionMs(Math.max(0, expectedPosition(s)));
      }
      forceTick((n) => (n + 1) % 1000);
    }, 500);
    return () => window.clearInterval(timer);
  }, [activityId, expectedPosition]);

  // --- skip votes ---

  const listenerIds = useMemo(() => {
    const ids = new Set<string>();
    bus.connectedIds.forEach((id) => {
      if (activity?.participants.includes(id) || id === djId) ids.add(id);
    });
    return ids;
  }, [bus.connectedIds, activity?.participants, djId]);
  const skipVotesNeeded = Math.floor(listenerIds.size / 2) + 1;

  useBusEvent<{ itemId: string }>(bus, 'music', 'vote_skip', (payload, packet) => {
    if (!isDjRef.current) return;
    const s = stateRef.current;
    if (!s.currentId || payload.itemId !== s.currentId) return;
    const votes = Array.from(new Set([...s.skipVotes, packet.from]));
    if (votes.length >= skipVotesNeeded) {
      next();
      return;
    }
    publish({ skipVotes: votes });
  });

  const voteSkip = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentId) return;
    if (isDjRef.current) {
      next();
      return;
    }
    bus.send('music', 'vote_skip', { itemId: s.currentId });
  }, [bus, next]);

  const claimDj = useCallback(async () => {
    if (!roomId || !activityId || !currentUserId) return;
    const updated = await updateRoomActivity(roomId, activityId, { host_user_id: currentUserId });
    onActivityUpdated(updated);
    bus.send('sys', 'activity_changed', {});
    // Continue from where we are so the music doesn't jump.
    const pos = activeAdapterRef.current ? await activeAdapterRef.current.getPosition() : expectedPosition();
    stateRef.current = { ...stateRef.current, positionMs: pos, anchorAt: Date.now() };
  }, [roomId, activityId, currentUserId, onActivityUpdated, bus, expectedPosition]);

  // --- ducking: lower the music while somebody else is talking ---

  useEffect(() => {
    if (!room) return;
    const onSpeakers = (speakers: Participant[]) => {
      const othersTalking = speakers.some((p) => p.identity !== currentUserId && p.isSpeaking);
      const target = ducking && othersTalking ? 0.3 : 1;
      if (duckTimerRef.current !== null) window.clearTimeout(duckTimerRef.current);
      if (target < duckRef.current) {
        duckRef.current = target;
        applyVolume();
      } else if (target > duckRef.current) {
        duckTimerRef.current = window.setTimeout(() => {
          duckRef.current = 1;
          applyVolume();
        }, 800);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers);
      if (duckTimerRef.current !== null) window.clearTimeout(duckTimerRef.current);
    };
  }, [room, ducking, currentUserId, applyVolume]);

  // --- cleanup ---

  useEffect(() => {
    const adapters = adaptersRef.current;
    const wrappers = wrappersRef.current;
    return () => {
      adapters.forEach((a) => a.destroy());
      adapters.clear();
      wrappers.forEach((w) => w.remove());
      wrappers.clear();
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    };
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeRaw(clamped);
    writeStored(VOLUME_KEY, clamped);
    if (clamped > 0) {
      setMuted(false);
      writeStored(MUTED_KEY, false);
    }
  }, []);
  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      writeStored(MUTED_KEY, !m);
      return !m;
    });
  }, []);
  const setDucking = useCallback((on: boolean) => {
    setDuckingRaw(on);
    writeStored(DUCK_KEY, on);
  }, []);
  const unlock = useCallback(() => setUnlocked(true), []);
  const clearError = useCallback(() => setLastError(null), []);

  return {
    state,
    current,
    isDj,
    djId,
    unlocked,
    unlock,
    positionMs,
    durationMs,
    volume,
    setVolume,
    muted,
    toggleMuted,
    ducking,
    setDucking,
    capabilities,
    lastError,
    clearError,
    skipVotes: state.skipVotes.length,
    skipVotesNeeded,
    hasVotedSkip: !!currentUserId && state.skipVotes.includes(currentUserId),
    play,
    pause,
    togglePlay,
    next,
    prev,
    seek,
    playItem,
    setLoop,
    voteSkip,
    claimDj,
    attachContainer,
  };
}
