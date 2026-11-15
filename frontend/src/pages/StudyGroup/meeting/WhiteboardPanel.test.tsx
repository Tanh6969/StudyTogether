import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhiteboardPanel } from './WhiteboardPanel';

const syncedWhiteboardSpy = vi.fn();

beforeEach(() => {
  syncedWhiteboardSpy.mockClear();
});

// SyncedWhiteboard mounts the real Excalidraw editor (and its LiveKit sync) -- mocked so this
// asserts only on what WhiteboardPanel passes through.
vi.mock('./SyncedWhiteboard', () => ({
  SyncedWhiteboard: (props: unknown) => {
    syncedWhiteboardSpy(props);
    return <div data-testid="synced-whiteboard" />;
  },
}));

describe('WhiteboardPanel', () => {
  it('always mounts the shared whiteboard (Excalidraw needs no license gate)', () => {
    const editorIds = new Set(['u1']);
    render(<WhiteboardPanel roomId="room-1" initialState={null} isReadonly={false} editorIds={editorIds} selfName="Minh Anh" />);

    expect(screen.getByTestId('synced-whiteboard')).toBeInTheDocument();
    expect(syncedWhiteboardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-1', initialState: null, isReadonly: false, editorIds, selfName: 'Minh Anh' }),
    );
  });
});
