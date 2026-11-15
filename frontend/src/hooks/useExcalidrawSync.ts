import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMaybeRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, BinaryFileData, BinaryFiles, AppState, Collaborator, SocketId } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement, ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { getStudyRoom, updateWhiteboardState } from '../lib/studyRoom.api';
import { createWhiteboardAssetUploadUrl, getWhiteboardAssetDownloadUrl, uploadWhiteboardAssetFile } from '../lib/whiteboardAsset.api';

/* ------------------------------------------------------------------------------------------------
 * Live whiteboard sync for Excalidraw over the LiveKit data channel (replaces the tldraw store
 * sync, whose SDK needs a paid/hobby license key outside localhost).
 *
 * - Elements: every Excalidraw element carries `version`/`versionNonce`; we broadcast only the
 *   elements whose version moved since we last sent them (throttled), and merge incoming ones
 *   with Excalidraw's own `reconcileElements` (highest version wins, deterministic tie-break),
 *   so concurrent edits by several editors converge without a server.
 * - Images: Excalidraw keeps image bytes in `files` (data URLs) -- far too big for the data
 *   channel or the JSONB column. Each new local file is uploaded to the existing room-scoped
 *   Storage endpoints; only `{fileId -> storage path}` is broadcast and persisted, and receivers
 *   fetch a signed URL and hand the bytes to Excalidraw.
 * - Persistence: a debounced PUT of `{ format: 'excalidraw', elements, files }` into
 *   study_rooms.whiteboard_state, the state late joiners and reconnects load first.
 * - Authority: only editors (room host/moderator or group manager) change the board. Their
 *   packets are accepted by sender identity (`editorIds`, LiveKit identities can't be forged);
 *   everyone's pointer is shown as a live cursor.
 * ----------------------------------------------------------------------------------------------*/

const TOPIC = 'whiteboard';
const BROADCAST_THROTTLE_MS = 60;
const POINTER_THROTTLE_MS = 50;
const SAVE_DEBOUNCE_MS = 3000;

export interface FileRef {
  path: string;
  mimeType: string;
}

export interface ExcalidrawBoardState {
  format: 'excalidraw';
  version: 1;
  elements: readonly ExcalidrawElement[];
  files: Record<string, FileRef>;
}

type Packet =
  | { type: 'wb_elements'; elements: ExcalidrawElement[]; full?: boolean }
  | { type: 'wb_file'; id: string; ref: FileRef }
  | { type: 'wb_pointer'; x: number; y: number; button: 'up' | 'down'; tool: 'pointer' | 'laser'; name: string };

export function parseBoardState(raw: unknown): ExcalidrawBoardState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ExcalidrawBoardState>;
  if (s.format !== 'excalidraw' || !Array.isArray(s.elements)) return null; // e.g. an old tldraw snapshot
  return { format: 'excalidraw', version: 1, elements: s.elements, files: s.files ?? {} };
}

const COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d'];
function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const c = COLORS[Math.abs(h) % COLORS.length];
  return { background: c, stroke: c };
}

function dataUrlToFile(dataURL: string, name: string): File {
  const [head, body] = dataURL.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface Args {
  roomId: string;
  initialState: unknown;
  isReadonly: boolean;
  editorIds: Set<string>;
  selfName: string;
}

export function useExcalidrawSync({ roomId, initialState, isReadonly, editorIds, selfName }: Args) {
  const room = useMaybeRoomContext();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [api, setApiState] = useState<ExcalidrawImperativeAPI | null>(null);
  const initial = useMemo(() => parseBoardState(initialState), [initialState]);
  const fileRefsRef = useRef<Record<string, FileRef>>({ ...(initial?.files ?? {}) });
  const sentVersionsRef = useRef<Map<string, number>>(new Map());
  const pendingRef = useRef<Map<string, ExcalidrawElement>>(new Map());
  const broadcastTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastPointerRef = useRef(0);
  /** Latest scene (incl. deleted tombstones), kept so an unmount can still persist it. */
  const lastSceneRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const uploadingRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef<Set<string>>(new Set());
  const collaboratorsRef = useRef<Map<SocketId, Collaborator>>(new Map());
  const editorIdsRef = useRef(editorIds);
  editorIdsRef.current = editorIds;
  const readonlyRef = useRef(isReadonly);
  readonlyRef.current = isReadonly;

  const send = useCallback(
    (packet: Packet, reliable = true, to?: string[]) => {
      if (!room || room.state !== 'connected') return;
      const bytes = new TextEncoder().encode(JSON.stringify(packet));
      void room.localParticipant.publishData(bytes, { reliable, topic: TOPIC, destinationIdentities: to }).catch(() => undefined);
    },
    [room]
  );

  /** Persist the scene right now. Keeps deleted elements: reconcile needs their tombstones to
   * stop a stale copy coming back. Falls back to the last seen scene when the Excalidraw API is
   * already gone (unmount order). */
  const saveNow = useCallback(() => {
    const elements = apiRef.current?.getSceneElementsIncludingDeleted() ?? lastSceneRef.current;
    if (!elements) return;
    const state: ExcalidrawBoardState = { format: 'excalidraw', version: 1, elements, files: fileRefsRef.current };
    updateWhiteboardState(roomId, state as unknown as Record<string, unknown>).catch((err) => console.error('Failed to save whiteboard', err));
  }, [roomId]);

  const scheduleSave = useCallback(() => {
    if (readonlyRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  /** Fetch bytes for any image element whose file we don't hold yet. */
  const ensureFiles = useCallback(
    async (elements: readonly ExcalidrawElement[]) => {
      const a = apiRef.current;
      if (!a) return;
      const have = a.getFiles();
      const missing = new Set<string>();
      for (const el of elements) {
        if (el.type === 'image' && el.fileId && !el.isDeleted && !have[el.fileId]) missing.add(el.fileId);
      }
      for (const id of missing) {
        const ref = fileRefsRef.current[id];
        if (!ref || fetchingRef.current.has(id)) continue;
        fetchingRef.current.add(id);
        try {
          const { url } = await getWhiteboardAssetDownloadUrl(roomId, ref.path);
          const blob = await (await fetch(url)).blob();
          const dataURL = await blobToDataUrl(blob);
          const file: BinaryFileData = { id: id as BinaryFileData['id'], dataURL: dataURL as BinaryFileData['dataURL'], mimeType: ref.mimeType as BinaryFileData['mimeType'], created: Date.now() };
          apiRef.current?.addFiles([file]);
        } catch (err) {
          console.error('Failed to load whiteboard image', err);
        } finally {
          fetchingRef.current.delete(id);
        }
      }
    },
    [roomId]
  );

  const flush = useCallback(() => {
    broadcastTimerRef.current = null;
    if (pendingRef.current.size === 0) return;
    const elements = Array.from(pendingRef.current.values());
    pendingRef.current.clear();
    send({ type: 'wb_elements', elements });
  }, [send]);

  /** Excalidraw onChange: queue elements whose version moved, upload new images. */
  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], _appState: AppState, files: BinaryFiles) => {
      if (readonlyRef.current) return;
      lastSceneRef.current = elements;
      let changed = false;
      for (const el of elements) {
        if ((sentVersionsRef.current.get(el.id) ?? -1) < el.version) {
          sentVersionsRef.current.set(el.id, el.version);
          pendingRef.current.set(el.id, el);
          changed = true;
        }
      }
      if (changed) {
        if (broadcastTimerRef.current === null) broadcastTimerRef.current = window.setTimeout(flush, BROADCAST_THROTTLE_MS);
        scheduleSave();
      }
      for (const [id, file] of Object.entries(files)) {
        if (fileRefsRef.current[id] || uploadingRef.current.has(id) || !file.dataURL.startsWith('data:')) continue;
        uploadingRef.current.add(id);
        void (async () => {
          try {
            const blob = dataUrlToFile(file.dataURL, `board-${id}.${file.mimeType.split('/')[1] ?? 'png'}`);
            const { path, upload_url } = await createWhiteboardAssetUploadUrl(roomId, { file_name: blob.name, content_type: blob.type, file_size: blob.size });
            await uploadWhiteboardAssetFile(upload_url, blob, blob.type);
            const ref = { path, mimeType: file.mimeType };
            fileRefsRef.current = { ...fileRefsRef.current, [id]: ref };
            send({ type: 'wb_file', id, ref });
            scheduleSave();
          } catch (err) {
            console.error('Failed to upload whiteboard image', err);
          } finally {
            uploadingRef.current.delete(id);
          }
        })();
      }
    },
    [flush, scheduleSave, roomId, send]
  );

  const applyRemoteElements = useCallback(
    (remote: readonly ExcalidrawElement[]) => {
      const a = apiRef.current;
      if (!a || remote.length === 0) return;
      const local = a.getSceneElementsIncludingDeleted();
      const merged = reconcileElements(local, remote as Parameters<typeof reconcileElements>[1], a.getAppState());
      // Remember versions so our own onChange doesn't echo these back.
      for (const el of merged) {
        if ((sentVersionsRef.current.get(el.id) ?? -1) < el.version) sentVersionsRef.current.set(el.id, el.version);
      }
      a.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
      void ensureFiles(remote);
    },
    [ensureFiles]
  );

  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
      const now = performance.now();
      if (now - lastPointerRef.current < POINTER_THROTTLE_MS) return;
      lastPointerRef.current = now;
      send({ type: 'wb_pointer', x: payload.pointer.x, y: payload.pointer.y, tool: payload.pointer.tool, button: payload.button, name: selfName }, false);
    },
    [send, selfName]
  );

  // Receive.
  useEffect(() => {
    if (!room) return;
    const onData = (raw: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      let packet: Packet;
      try {
        packet = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return;
      }
      const from = participant.identity;
      if (packet.type === 'wb_pointer') {
        const map = new Map(collaboratorsRef.current);
        map.set(from as SocketId, {
          id: from,
          socketId: from as SocketId,
          username: packet.name || participant.name || 'Bạn học',
          pointer: { x: packet.x, y: packet.y, tool: packet.tool },
          button: packet.button,
          color: colorFor(from),
        });
        collaboratorsRef.current = map;
        apiRef.current?.updateScene({ collaborators: map, captureUpdate: CaptureUpdateAction.NEVER });
        return;
      }
      if (!editorIdsRef.current.has(from)) return; // board edits are editor-only
      if (packet.type === 'wb_elements') applyRemoteElements(packet.elements);
      else if (packet.type === 'wb_file') {
        fileRefsRef.current = { ...fileRefsRef.current, [packet.id]: packet.ref };
        const a = apiRef.current;
        if (a) void ensureFiles(a.getSceneElements());
      }
    };
    const onLeft = (participant: Participant) => {
      if (!collaboratorsRef.current.has(participant.identity as SocketId)) return;
      const map = new Map(collaboratorsRef.current);
      map.delete(participant.identity as SocketId);
      collaboratorsRef.current = map;
      apiRef.current?.updateScene({ collaborators: map, captureUpdate: CaptureUpdateAction.NEVER });
    };
    // A newcomer may have loaded a persisted state that is a few seconds old: one editor (the
    // lowest identity among connected editors, so only one) sends them the full scene.
    const onJoined = (participant: Participant) => {
      const a = apiRef.current;
      if (!a || readonlyRef.current) return;
      const self = room.localParticipant.identity;
      const editorsHere = [self, ...Array.from(room.remoteParticipants.values()).map((p) => p.identity)].filter((id) => editorIdsRef.current.has(id)).sort();
      if (editorsHere[0] !== self) return;
      window.setTimeout(() => {
        const all = apiRef.current?.getSceneElementsIncludingDeleted() ?? [];
        send({ type: 'wb_elements', elements: [...all], full: true }, true, [participant.identity]);
        for (const [id, ref] of Object.entries(fileRefsRef.current)) send({ type: 'wb_file', id, ref }, true, [participant.identity]);
      }, 1500);
    };
    const onReconnected = async () => {
      try {
        const latest = parseBoardState((await getStudyRoom(roomId)).whiteboard_state);
        if (latest) {
          fileRefsRef.current = { ...latest.files, ...fileRefsRef.current };
          applyRemoteElements(latest.elements);
        }
      } catch (err) {
        console.error('Failed to resync whiteboard after reconnect', err);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room, roomId, applyRemoteElements, ensureFiles, send]);

  // On unmount, don't drop strokes still waiting on the debounce: send pending edits to the
  // room and save the scene immediately (this used to lose the last few seconds of drawing).
  useEffect(
    () => () => {
      if (broadcastTimerRef.current !== null) {
        window.clearTimeout(broadcastTimerRef.current);
        broadcastTimerRef.current = null;
        flush();
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveNow();
      }
    },
    [flush, saveNow]
  );

  const setApi = useCallback(
    (a: ExcalidrawImperativeAPI | null) => {
      apiRef.current = a;
      setApiState(a);
      if (a && initial) {
        for (const el of initial.elements) sentVersionsRef.current.set(el.id, el.version);
        void ensureFiles(initial.elements);
      }
    },
    [initial, ensureFiles]
  );

  return {
    api,
    setApi,
    initialData: initial ? { elements: initial.elements, scrollToContent: true } : null,
    onChange,
    onPointerUpdate,
  };
}
