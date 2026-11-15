import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMaybeRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';

/**
 * The in-call activities' message bus on top of LiveKit's data channel
 * (docs/design/hoat-dong-trong-call.md §1.6).
 *
 * - Two topics: `activity` (reliable, ordered: state changes) and `activity-lossy`
 *   (unreliable: in-progress strokes, playback ticks, heartbeats).
 * - Every packet carries the sender's monotonically increasing `seq` per (kind, type) and the
 *   sender's wall clock `ts`. Receivers drop a packet whose seq is not newer than the last one
 *   seen from that sender for that (kind, type) -- this is what stops a stale lossy packet or a
 *   reordered reliable one from overwriting newer state.
 * - `ts` doubles as clock sync: for each sender we keep a smoothed estimate of
 *   `theirNow - ourNow`, so a host-chosen deadline (`endsAt`) or music anchor time can be
 *   converted into local time with ~100 ms accuracy without a separate protocol.
 */

export type ActivityPacketKind = 'sys' | 'game' | 'music';

export interface ActivityPacket<T = unknown> {
  v: 1;
  kind: ActivityPacketKind;
  type: string;
  from: string;
  seq: number;
  ts: number;
  payload: T;
}

export interface SendOptions {
  reliable?: boolean;
  /** LiveKit identities (= user ids) to deliver to; everyone when omitted. */
  to?: string[];
}

type Handler = (packet: ActivityPacket) => void;

const TOPIC_RELIABLE = 'activity';
const TOPIC_LOSSY = 'activity-lossy';
const CLOCK_SAMPLES = 5;

export interface ActivityBus {
  /** Our own LiveKit identity (user id), or null while not connected to the call. */
  selfId: string | null;
  connected: boolean;
  send: <T>(kind: ActivityPacketKind, type: string, payload: T, options?: SendOptions) => void;
  subscribe: (kind: ActivityPacketKind, handler: Handler) => () => void;
  /** `peerNow - localNow` for a peer we've heard from, or 0 if unknown. */
  clockOffset: (peerId: string) => number;
  /** A peer's wall-clock instant expressed in our local Date.now() frame. */
  toLocalTime: (peerId: string, peerTs: number) => number;
  /** Identities currently connected to the call (including ourselves). */
  connectedIds: Set<string>;
  /** Last time (local ms) we received anything from the peer. */
  lastHeardFrom: (peerId: string) => number | null;
}

export function useActivityBus(): ActivityBus {
  const room = useMaybeRoomContext();
  const handlersRef = useRef<Map<ActivityPacketKind, Set<Handler>>>(new Map());
  const seqRef = useRef<Map<string, number>>(new Map());
  const lastSeqRef = useRef<Map<string, number>>(new Map());
  const offsetsRef = useRef<Map<string, number[]>>(new Map());
  const lastHeardRef = useRef<Map<string, number>>(new Map());
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);

  // Track who is in the call. Used for host election (useRoomActivities) and skip-vote quorum.
  useEffect(() => {
    if (!room) {
      setConnected(false);
      setConnectedIds(new Set());
      return;
    }
    const refresh = () => {
      const ids = new Set<string>();
      if (room.localParticipant?.identity) ids.add(room.localParticipant.identity);
      room.remoteParticipants.forEach((p) => ids.add(p.identity));
      setConnectedIds(ids);
      setConnected(room.state === 'connected');
    };
    refresh();
    const events = [
      RoomEvent.Connected,
      RoomEvent.Reconnected,
      RoomEvent.Disconnected,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    events.forEach((e) => room.on(e, refresh));
    return () => {
      events.forEach((e) => room.off(e, refresh));
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const onData = (raw: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC_RELIABLE && topic !== TOPIC_LOSSY) return;
      let packet: ActivityPacket;
      try {
        packet = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return;
      }
      if (!packet || packet.v !== 1 || typeof packet.type !== 'string') return;
      // Never trust the claimed sender over the transport's.
      if (participant?.identity) packet.from = participant.identity;
      const key = `${packet.from}|${packet.kind}|${packet.type}`;
      const last = lastSeqRef.current.get(key);
      if (last !== undefined && packet.seq <= last) return;
      lastSeqRef.current.set(key, packet.seq);

      const now = Date.now();
      lastHeardRef.current.set(packet.from, now);
      if (typeof packet.ts === 'number') {
        const samples = offsetsRef.current.get(packet.from) ?? [];
        samples.push(packet.ts - now);
        if (samples.length > CLOCK_SAMPLES) samples.shift();
        offsetsRef.current.set(packet.from, samples);
      }
      handlersRef.current.get(packet.kind)?.forEach((h) => {
        try {
          h(packet);
        } catch (err) {
          console.error('[activity-bus] handler failed', err);
        }
      });
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  const send = useCallback(
    <T,>(kind: ActivityPacketKind, type: string, payload: T, options: SendOptions = {}) => {
      if (!room || room.state !== 'connected') return;
      const key = `${kind}|${type}`;
      const seq = (seqRef.current.get(key) ?? 0) + 1;
      seqRef.current.set(key, seq);
      const packet: ActivityPacket<T> = {
        v: 1,
        kind,
        type,
        from: room.localParticipant.identity,
        seq,
        ts: Date.now(),
        payload,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(packet));
      const reliable = options.reliable !== false;
      void room.localParticipant
        .publishData(bytes, {
          reliable,
          topic: reliable ? TOPIC_RELIABLE : TOPIC_LOSSY,
          destinationIdentities: options.to,
        })
        .catch((err: unknown) => {
          if (reliable) console.warn('[activity-bus] publish failed', type, err);
        });
    },
    [room]
  );

  const subscribe = useCallback((kind: ActivityPacketKind, handler: Handler) => {
    let set = handlersRef.current.get(kind);
    if (!set) {
      set = new Set();
      handlersRef.current.set(kind, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }, []);

  const clockOffset = useCallback((peerId: string) => {
    const samples = offsetsRef.current.get(peerId);
    if (!samples || samples.length === 0) return 0;
    // Median is robust to one delayed packet.
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, []);

  const toLocalTime = useCallback((peerId: string, peerTs: number) => peerTs - clockOffset(peerId), [clockOffset]);
  const lastHeardFrom = useCallback((peerId: string) => lastHeardRef.current.get(peerId) ?? null, []);

  const selfId = room?.localParticipant?.identity ?? null;

  return useMemo(
    () => ({ selfId, connected, send, subscribe, clockOffset, toLocalTime, connectedIds, lastHeardFrom }),
    [selfId, connected, send, subscribe, clockOffset, toLocalTime, connectedIds, lastHeardFrom]
  );
}

/** Subscribe to packets of one kind/type with a stable handler. */
export function useBusEvent<T>(
  bus: ActivityBus,
  kind: ActivityPacketKind,
  type: string | null,
  handler: (payload: T, packet: ActivityPacket<T>) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (type === null) return;
    return bus.subscribe(kind, (packet) => {
      if (packet.type === type) handlerRef.current(packet.payload as T, packet as ActivityPacket<T>);
    });
  }, [bus, kind, type]);
}

/** Hosts (game host / DJ) announce themselves every 2 s so everyone can both detect a silent
 * host and keep their clock offset to it fresh. */
export function useHostHeartbeat(bus: ActivityBus, activityId: string | null, isHost: boolean): void {
  useEffect(() => {
    if (!activityId || !isHost || !bus.connected) return;
    const tick = () => bus.send('sys', 'tick', { activityId }, { reliable: false });
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => window.clearInterval(timer);
  }, [bus, activityId, isHost]);
}
