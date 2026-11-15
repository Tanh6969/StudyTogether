import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useExcalidrawSync } from '../../../hooks/useExcalidrawSync';

interface SyncedWhiteboardProps {
  roomId: string;
  initialState: unknown;
  isReadonly: boolean;
  /** LiveKit identities (= user ids) allowed to change the board; packets from others are ignored. */
  editorIds: Set<string>;
  selfName: string;
}

/**
 * The room's shared whiteboard: Excalidraw (MIT licensed, works on any domain) synced live over
 * the LiveKit data channel by useExcalidrawSync. Participants who aren't editors get Excalidraw's
 * view mode: they see every stroke live and can pan/zoom, but cannot draw.
 *
 * The UI stays in English: Excalidraw only offers languages that are at least 85% translated,
 * and Vietnamese is currently at 49%, so `langCode="vi-VN"` silently falls back to English.
 */
export function SyncedWhiteboard({ roomId, initialState, isReadonly, editorIds, selfName }: SyncedWhiteboardProps) {
  const { setApi, initialData, onChange, onPointerUpdate } = useExcalidrawSync({ roomId, initialState, isReadonly, editorIds, selfName });
  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initialData}
      onChange={onChange}
      onPointerUpdate={onPointerUpdate}
      isCollaborating
      viewModeEnabled={isReadonly}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: true, export: { saveFileToDisk: true } } }}
    />
  );
}
