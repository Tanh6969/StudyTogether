import { SyncedWhiteboard } from './SyncedWhiteboard';

interface WhiteboardPanelProps {
  roomId: string;
  initialState: unknown;
  isReadonly: boolean;
  editorIds: Set<string>;
  selfName: string;
}

export function WhiteboardPanel({ roomId, initialState, isReadonly, editorIds, selfName }: WhiteboardPanelProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SyncedWhiteboard roomId={roomId} initialState={initialState} isReadonly={isReadonly} editorIds={editorIds} selfName={selfName} />
    </div>
  );
}
