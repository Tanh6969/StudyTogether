import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomActivity } from '../../lib/activity.types';
import type { ActivityBus } from '../../activities/net/useActivityBus';
import { useBusEvent, useHostHeartbeat } from '../../activities/net/useActivityBus';
import { createInitialState, reduce, toPublic } from './engine/engine';
import type { ChalkSettings, Effect, EngineEvent, GameState, PublicState, WordEntry } from './engine/engine';
import { WORD_PACKS } from './words';
import { CHALK_BUDGET } from './ChalkCanvas';
import type { Stroke } from './ChalkCanvas';
import { chalkSounds } from './sounds';

/* -----------------------------------------------------------------------------------------------
 * Network glue for Phấn Trắng (design §2.7).
 * - The activity host runs the pure engine and broadcasts the PUBLIC projection (`state`).
 *   Secrets (word options, the word) go only to the drawer, via destination-limited packets.
 * - Everyone else sends `req` packets; the host stamps them with the transport-verified sender.
 * - Strokes go straight from the drawer to everybody: `draw_move` (lossy, incremental) while
 *   dragging, `draw_stroke` (reliable, complete) on release, so a lost lossy packet never
 *   leaves a wrong picture behind.
 * ---------------------------------------------------------------------------------------------*/

const LEAVE_AFTER_DISCONNECT_MS = 8000;
const MAX_STROKE_PTS = 1000;

type ReqEvent =
  | { type: 'settings'; settings: Partial<ChalkSettings> }
  | { type: 'start' }
  | { type: 'restart' }
  | { type: 'cancel' }
  | { type: 'pick_word'; index: number }
  | { type: 'guess'; text: string }
  | { type: 'chalk'; left: number }
  | { type: 'report_text' };

interface DrawMove {
  turn: string;
  id: string;
  by: string;
  tool: Stroke['tool'];
  color: string;
  width: number;
  from: number;
  pts: number[];
}

export function turnKeyOf(s: Pick<PublicState, 'roundIndex' | 'turnIndex' | 'usedWords' | 'phase'> | null): string {
  if (!s) return '';
  return `${s.roundIndex}-${s.turnIndex}-${s.usedWords.length}`;
}

interface UseChalkGameArgs {
  bus: ActivityBus;
  activity: RoomActivity | null;
  currentUserId: string | null;
  persist: (activityId: string, snapshot: PublicState, status: 'lobby' | 'running') => void;
  endActivity: (activityId: string) => void;
}

export interface ChalkGameApi {
  isHost: boolean;
  hostId: string | null;
  state: PublicState | null;
  myWord: string | null;
  myOptions: WordEntry[] | null;
  strokes: Stroke[];
  live: Record<string, Stroke>;
  chalkLeft: number;
  closeCallAt: number;
  blockedMessage: string | null;
  /** Convert a host-clock timestamp into local Date.now() time. */
  hostToLocal: (ts: number) => number;
  start: () => void;
  restart: () => void;
  cancel: () => void;
  updateSettings: (settings: Partial<ChalkSettings>) => void;
  pickWord: (index: number) => void;
  guess: (text: string) => void;
  reportText: () => void;
  strokeMove: (stroke: Stroke) => void;
  strokeEnd: (stroke: Stroke) => Stroke[];
  undo: () => void;
  clear: () => void;
  useChalk: (cost: number) => void;
}

export function useChalkGame({ bus, activity, currentUserId, persist, endActivity }: UseChalkGameArgs): ChalkGameApi {
  const activityId = activity?.id ?? null;
  const hostId = activity?.host_user_id ?? null;
  const isHost = !!currentUserId && hostId === currentUserId;

  const [state, setState] = useState<PublicState | null>(null);
  const stateRef = useRef<PublicState | null>(null);
  const engineRef = useRef<GameState | null>(null);
  const engineHostRef = useRef<string | null>(null);
  const [myWord, setMyWord] = useState<string | null>(null);
  const [myOptions, setMyOptions] = useState<WordEntry[] | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [live, setLive] = useState<Record<string, Stroke>>({});
  const [chalkLeft, setChalkLeft] = useState(1);
  const chalkRef = useRef(1);
  const lastChalkSentRef = useRef(0);
  const [closeCallAt, setCloseCallAt] = useState(0);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const disconnectedSinceRef = useRef<Map<string, number>>(new Map());
  const lastPersistedPhaseRef = useRef<string>('');
  const sentMoveLenRef = useRef<Record<string, number>>({});

  useHostHeartbeat(bus, activityId, isHost);

  const hostToLocal = useCallback((ts: number) => (hostId && !isHost ? bus.toLocalTime(hostId, ts) : ts), [bus, hostId, isHost]);

  const applyPublic = useCallback((next: PublicState) => {
    const prev = stateRef.current;
    stateRef.current = next;
    setState(next);
    const newTurn = turnKeyOf(prev) !== turnKeyOf(next) || (prev?.phase !== 'choosing' && next.phase === 'choosing') || next.phase === 'lobby';
    if (newTurn || !prev) {
      if (newTurn) {
        strokesRef.current = [];
        setStrokes([]);
        setLive({});
        chalkRef.current = 1;
        setChalkLeft(1);
      }
    }
    if (next.phase !== 'choosing') setMyOptions(null);
    if (next.phase === 'lobby' || next.phase === 'ended' || (prev && turnKeyOf(prev) !== turnKeyOf(next))) setMyWord(null);
  }, []);

  const setStrokesBoth = useCallback((next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
  }, []);

  // ---------------- host side ----------------

  const deliver = useCallback(
    (effects: Effect[]) => {
      for (const e of effects) {
        switch (e.type) {
          case 'word_options':
            if (e.userId === currentUserId) setMyOptions(e.options);
            else bus.send('game', 'word_options', { options: e.options }, { to: [e.userId] });
            break;
          case 'word':
            if (e.userId === currentUserId) setMyWord(e.word);
            else bus.send('game', 'word', { word: e.word }, { to: [e.userId] });
            break;
          case 'close_call':
            if (e.userId === currentUserId) {
              setCloseCallAt(Date.now());
              chalkSounds.closeCall();
            } else bus.send('game', 'close_call', {}, { to: [e.userId] });
            break;
          case 'guess_blocked':
            if (e.userId === currentUserId) setBlockedMessage(e.reason);
            else bus.send('game', 'blocked', { reason: e.reason }, { to: [e.userId] });
            break;
          case 'sound':
            bus.send('game', 'sound', { name: e.name });
            playSound(e.name);
            break;
        }
      }
    },
    [bus, currentUserId]
  );

  const broadcast = useCallback(
    (s: GameState) => {
      const pub = toPublic(s);
      applyPublic(pub);
      bus.send('game', 'state', pub);
      if (activityId && pub.phase !== lastPersistedPhaseRef.current) {
        lastPersistedPhaseRef.current = pub.phase;
        persist(activityId, pub, pub.phase === 'lobby' ? 'lobby' : 'running');
      }
    },
    [bus, applyPublic, activityId, persist]
  );

  const dispatch = useCallback(
    (event: EngineEvent) => {
      const current = engineRef.current;
      if (!current) return;
      const res = reduce(current, event, WORD_PACKS);
      engineRef.current = res.state;
      if (res.state.version !== current.version) broadcast(res.state);
      else if (res.state.chalkLeft !== current.chalkLeft) {
        const pub = toPublic(res.state);
        stateRef.current = pub;
        setState(pub);
        bus.send('game', 'chalk', { left: res.state.chalkLeft }, { reliable: false });
      }
      if (res.effects.length) deliver(res.effects);
    },
    [broadcast, deliver, bus]
  );

  // Become host: build the engine from what we know.
  useEffect(() => {
    if (!isHost || !activity || !currentUserId) {
      engineRef.current = null;
      engineHostRef.current = null;
      return;
    }
    if (engineRef.current && engineHostRef.current === activity.id) return;
    engineHostRef.current = activity.id;
    const known = stateRef.current ?? (activity.snapshot && 'phase' in activity.snapshot ? (activity.snapshot as unknown as PublicState) : null);
    let engine: GameState;
    if (known) {
      engine = { ...known, currentWord: null, wordOptions: null };
      if (known.phase === 'choosing' || known.phase === 'drawing') {
        // We inherited the host role mid-turn: the old host took the secret word with them.
        const now = Date.now();
        engine = {
          ...engine,
          phase: 'turn_end',
          lastAnswer: null,
          turnGains: {},
          phaseStartedAt: now,
          phaseEndsAt: now + 5000,
          feed: [...engine.feed, { id: engine.feedSeq + 1, userId: null, text: 'Chủ phòng đổi người, lượt này kết thúc sớm.', kind: 'system' as const, at: now }],
          feedSeq: engine.feedSeq + 1,
          version: engine.version + 1,
        };
      } else if (known.phase === 'turn_end' || known.phase === 'ended') {
        const now = Date.now();
        engine = { ...engine, phaseStartedAt: now, phaseEndsAt: now + (known.phase === 'ended' ? 30000 : 5000), version: engine.version + 1 };
      }
    } else {
      engine = createInitialState((activity.settings ?? {}) as Partial<ChalkSettings>);
      engine = { ...engine, version: 1 };
    }
    engineRef.current = engine;
    lastPersistedPhaseRef.current = '';
    broadcast(engine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, activity?.id, currentUserId]);

  // Host: keep the player list in step with activity participants + call connectivity.
  useEffect(() => {
    if (!isHost || !activity) return;
    const sync = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const now = Date.now();
      for (const userId of activity.participants) {
        const connected = bus.connectedIds.has(userId);
        if (connected) disconnectedSinceRef.current.delete(userId);
        const player = engine.players.find((p) => p.userId === userId);
        if (connected && (!player || player.left)) dispatch({ type: 'join', userId, at: now });
        if (!connected && player && !player.left) {
          const since = disconnectedSinceRef.current.get(userId) ?? now;
          disconnectedSinceRef.current.set(userId, since);
          if (now - since > LEAVE_AFTER_DISCONNECT_MS) dispatch({ type: 'leave', userId, at: now });
        }
      }
      for (const p of engineRef.current?.players ?? []) {
        if (!p.left && !activity.participants.includes(p.userId)) dispatch({ type: 'leave', userId: p.userId, at: now });
      }
    };
    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [isHost, activity, bus.connectedIds, dispatch]);

  // Host: clock.
  useEffect(() => {
    if (!isHost || !activityId) return;
    const timer = window.setInterval(() => {
      dispatch({ type: 'tick', at: Date.now(), random: Math.random });
      const engine = engineRef.current;
      if (engine?.phase === 'ended' && Date.now() > engine.phaseEndsAt + 30000) endActivity(activityId);
    }, 250);
    return () => window.clearInterval(timer);
  }, [isHost, activityId, dispatch, endActivity]);

  // Host: a full state every 10 s heals anyone who missed a packet.
  useEffect(() => {
    if (!isHost || !activityId) return;
    const timer = window.setInterval(() => {
      if (stateRef.current) bus.send('game', 'state', stateRef.current);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [isHost, activityId, bus]);

  useBusEvent<{ event: ReqEvent }>(bus, 'game', 'req', (payload, packet) => {
    if (!isHost || !currentUserId) return;
    const userId = packet.from;
    const at = Date.now();
    const e = payload?.event;
    if (!e || typeof e !== 'object') return;
    switch (e.type) {
      case 'guess':
        dispatch({ type: 'guess', userId, text: String(e.text ?? ''), at });
        break;
      case 'pick_word':
        dispatch({ type: 'pick_word', userId, index: Number(e.index) || 0, at });
        break;
      case 'chalk':
        dispatch({ type: 'chalk', userId, left: Number(e.left) });
        break;
      case 'report_text':
        dispatch({ type: 'report_text', userId, at });
        break;
      case 'settings':
        dispatch({ type: 'settings', userId, settings: e.settings ?? {}, hostId: currentUserId });
        break;
      case 'start':
      case 'restart':
        dispatch({ type: e.type, userId, at, hostId: currentUserId, random: Math.random });
        break;
      case 'cancel':
        dispatch({ type: 'cancel', userId, at, hostId: currentUserId });
        break;
    }
  });

  useBusEvent<Record<string, never>>(bus, 'game', 'req_state', (_p, packet) => {
    if (!isHost) return;
    const engine = engineRef.current;
    if (!engine) return;
    const to = [packet.from];
    bus.send('game', 'state', toPublic(engine), { to });
    if (strokesRef.current.length) bus.send('game', 'draw_snapshot', { turn: turnKeyOf(engine), strokes: strokesRef.current }, { to });
    if (engine.drawerId === packet.from) {
      if (engine.phase === 'choosing' && engine.wordOptions) bus.send('game', 'word_options', { options: engine.wordOptions }, { to });
      if (engine.phase === 'drawing' && engine.currentWord) bus.send('game', 'word', { word: engine.currentWord }, { to });
    }
  });

  // ---------------- everyone ----------------

  // Ask the host for the current state when we arrive or the host changes.
  useEffect(() => {
    if (!activityId || isHost || !bus.connected || !hostId) return;
    bus.send('game', 'req_state', {}, { to: [hostId] });
    const retry = window.setTimeout(() => {
      if (!stateRef.current) bus.send('game', 'req_state', {}, { to: [hostId] });
    }, 1500);
    return () => window.clearTimeout(retry);
  }, [activityId, isHost, hostId, bus]);

  // Seed from the persisted snapshot so the lobby renders before the first packet.
  useEffect(() => {
    if (!activity || stateRef.current || isHost) return;
    if (activity.snapshot && 'phase' in activity.snapshot) applyPublic(activity.snapshot as unknown as PublicState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  useEffect(() => {
    if (!activityId) {
      stateRef.current = null;
      setState(null);
      setStrokesBoth([]);
      setLive({});
      setMyWord(null);
      setMyOptions(null);
    }
  }, [activityId, setStrokesBoth]);

  useBusEvent<PublicState>(bus, 'game', 'state', (payload, packet) => {
    if (isHost || packet.from !== hostId) return;
    if (stateRef.current && payload.version < stateRef.current.version && turnKeyOf(payload) === turnKeyOf(stateRef.current)) return;
    applyPublic(payload);
  });
  useBusEvent<{ left: number }>(bus, 'game', 'chalk', (payload, packet) => {
    if (isHost || packet.from !== hostId || !stateRef.current) return;
    const next = { ...stateRef.current, chalkLeft: payload.left };
    stateRef.current = next;
    setState(next);
  });
  useBusEvent<{ options: WordEntry[] }>(bus, 'game', 'word_options', (payload, packet) => {
    if (packet.from === hostId) setMyOptions(payload.options);
  });
  useBusEvent<{ word: string }>(bus, 'game', 'word', (payload, packet) => {
    if (packet.from === hostId) setMyWord(payload.word);
  });
  useBusEvent<Record<string, never>>(bus, 'game', 'close_call', (_p, packet) => {
    if (packet.from !== hostId) return;
    setCloseCallAt(Date.now());
    chalkSounds.closeCall();
  });
  useBusEvent<{ reason: string }>(bus, 'game', 'blocked', (payload, packet) => {
    if (packet.from === hostId) setBlockedMessage(payload.reason);
  });
  useBusEvent<{ name: Effect extends { name: infer N } ? N : string }>(bus, 'game', 'sound', (payload, packet) => {
    if (packet.from === hostId && !isHost) playSound(String(payload.name));
  });

  useEffect(() => {
    if (!blockedMessage) return;
    const t = window.setTimeout(() => setBlockedMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [blockedMessage]);

  // ---- strokes ----

  const currentTurn = useCallback(() => turnKeyOf(stateRef.current), []);
  const isDrawerPacket = (from: string) => stateRef.current?.drawerId === from;

  useBusEvent<DrawMove>(bus, 'game', 'draw_move', (m, packet) => {
    if (!isDrawerPacket(packet.from) || m.turn !== currentTurn()) return;
    setLive((prev) => {
      const existing = prev[m.id];
      if (!existing && m.from !== 0) return prev;
      if (existing && m.from !== existing.pts.length) {
        if (m.from > existing.pts.length) return prev; // gap: wait for draw_stroke
        return { ...prev, [m.id]: { ...existing, pts: [...existing.pts.slice(0, m.from), ...m.pts] } };
      }
      const base: Stroke = existing ?? { id: m.id, by: m.by, tool: m.tool, color: m.color, width: m.width, pts: [] };
      return { ...prev, [m.id]: { ...base, pts: [...base.pts, ...m.pts] } };
    });
  });
  useBusEvent<{ turn: string; stroke: Stroke }>(bus, 'game', 'draw_stroke', (m, packet) => {
    if (!isDrawerPacket(packet.from) || m.turn !== currentTurn()) return;
    const stroke = { ...m.stroke, doneAt: performance.now() };
    if (!strokesRef.current.some((s) => s.id === stroke.id)) setStrokesBoth([...strokesRef.current, stroke]);
    setLive((prev) => {
      if (!prev[stroke.id]) return prev;
      const next = { ...prev };
      delete next[stroke.id];
      return next;
    });
  });
  useBusEvent<{ turn: string; id: string }>(bus, 'game', 'draw_undo', (m, packet) => {
    if (!isDrawerPacket(packet.from) || m.turn !== currentTurn()) return;
    setStrokesBoth(strokesRef.current.filter((s) => s.id !== m.id));
  });
  useBusEvent<{ turn: string }>(bus, 'game', 'draw_clear', (m, packet) => {
    if (!isDrawerPacket(packet.from) || m.turn !== currentTurn()) return;
    setStrokesBoth([]);
    setLive({});
  });
  useBusEvent<{ turn: string; strokes: Stroke[] }>(bus, 'game', 'draw_snapshot', (m, packet) => {
    if (packet.from !== hostId || m.turn !== currentTurn()) return;
    setStrokesBoth(m.strokes);
  });

  // ---------------- actions ----------------

  const request = useCallback(
    (event: ReqEvent) => {
      if (!currentUserId) return;
      if (isHost) {
        const at = Date.now();
        const me = currentUserId;
        switch (event.type) {
          case 'guess':
            return dispatch({ type: 'guess', userId: me, text: event.text, at });
          case 'pick_word':
            return dispatch({ type: 'pick_word', userId: me, index: event.index, at });
          case 'chalk':
            return dispatch({ type: 'chalk', userId: me, left: event.left });
          case 'report_text':
            return dispatch({ type: 'report_text', userId: me, at });
          case 'settings':
            return dispatch({ type: 'settings', userId: me, settings: event.settings, hostId: me });
          case 'start':
          case 'restart':
            return dispatch({ type: event.type, userId: me, at, hostId: me, random: Math.random });
          case 'cancel':
            return dispatch({ type: 'cancel', userId: me, at, hostId: me });
        }
      }
      if (hostId) bus.send('game', 'req', { event }, { to: [hostId] });
    },
    [currentUserId, isHost, dispatch, hostId, bus]
  );

  const strokeMove = useCallback(
    (stroke: Stroke) => {
      const from = sentMoveLenRef.current[stroke.id] ?? 0;
      if (stroke.pts.length <= from) return;
      sentMoveLenRef.current[stroke.id] = stroke.pts.length;
      const move: DrawMove = { turn: currentTurn(), id: stroke.id, by: stroke.by, tool: stroke.tool, color: stroke.color, width: stroke.width, from, pts: stroke.pts.slice(from) };
      bus.send('game', 'draw_move', move, { reliable: false });
    },
    [bus, currentTurn]
  );

  /** Finish a stroke. Very long strokes are split so each reliable packet stays small. */
  const strokeEnd = useCallback(
    (stroke: Stroke) => {
      delete sentMoveLenRef.current[stroke.id];
      const pieces: Stroke[] = [];
      for (let i = 0; i < stroke.pts.length; i += MAX_STROKE_PTS - 2) {
        const start = Math.max(0, i - 2);
        pieces.push({ ...stroke, id: i === 0 ? stroke.id : `${stroke.id}-${i}`, pts: stroke.pts.slice(start, i + MAX_STROKE_PTS - 2) });
      }
      const turn = currentTurn();
      for (const piece of pieces) {
        const { doneAt: _d, ...wire } = piece;
        void _d;
        bus.send('game', 'draw_stroke', { turn, stroke: wire });
      }
      setStrokesBoth([...strokesRef.current, ...pieces]);
      return pieces;
    },
    [bus, currentTurn, setStrokesBoth]
  );

  const undo = useCallback(() => {
    if (!currentUserId) return;
    const mine = [...strokesRef.current].reverse().find((s) => s.by === currentUserId);
    if (!mine) return;
    setStrokesBoth(strokesRef.current.filter((s) => s.id !== mine.id));
    bus.send('game', 'draw_undo', { turn: currentTurn(), id: mine.id });
  }, [bus, currentTurn, currentUserId, setStrokesBoth]);

  const clear = useCallback(() => {
    setStrokesBoth([]);
    bus.send('game', 'draw_clear', { turn: currentTurn() });
  }, [bus, currentTurn, setStrokesBoth]);

  const useChalk = useCallback(
    (cost: number) => {
      chalkRef.current = Math.max(0, chalkRef.current - cost / CHALK_BUDGET);
      setChalkLeft(chalkRef.current);
      const now = Date.now();
      if (now - lastChalkSentRef.current > 300 || chalkRef.current === 0) {
        lastChalkSentRef.current = now;
        request({ type: 'chalk', left: chalkRef.current });
      }
    },
    [request]
  );

  return useMemo(
    () => ({
      isHost,
      hostId,
      state,
      myWord,
      myOptions,
      strokes,
      live,
      chalkLeft,
      closeCallAt,
      blockedMessage,
      hostToLocal,
      start: () => request({ type: 'start' }),
      restart: () => request({ type: 'restart' }),
      cancel: () => request({ type: 'cancel' }),
      updateSettings: (settings: Partial<ChalkSettings>) => request({ type: 'settings', settings }),
      pickWord: (index: number) => request({ type: 'pick_word', index }),
      guess: (text: string) => request({ type: 'guess', text }),
      reportText: () => request({ type: 'report_text' }),
      strokeMove,
      strokeEnd,
      undo,
      clear,
      useChalk,
    }),
    [isHost, hostId, state, myWord, myOptions, strokes, live, chalkLeft, closeCallAt, blockedMessage, hostToLocal, request, strokeMove, strokeEnd, undo, clear, useChalk]
  );
}

function playSound(name: string) {
  if (name === 'correct') chalkSounds.correct();
  else if (name === 'turn_end') chalkSounds.turnEnd();
  else if (name === 'start') chalkSounds.start();
}
