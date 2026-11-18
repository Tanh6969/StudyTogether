import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotesStackPanel, type NotesStackPanelProps } from './NotesStackPanel';
import type { Note } from '../../lib/note.types';

const author = { id: 'user-1', username: 'alice', display_name: 'Alice', avatar_url: null, role: 'user' as const };

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    group_id: 'group-1',
    author_id: 'user-1',
    title: null,
    content: 'Hello note',
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    author,
    ...overrides,
  };
}

function baseController(overrides: Partial<NotesStackPanelProps> = {}): NotesStackPanelProps {
  return {
    notes: [],
    loading: false,
    listError: null,
    refetch: vi.fn(),

    focusedIndex: 0,
    focusedNote: undefined,
    goToPrev: vi.fn(),
    goToNext: vi.fn(),

    isAdding: false,
    newTitle: '',
    newContent: '',
    setNewTitle: vi.fn(),
    setNewContent: vi.fn(),
    createError: null,
    isCreating: false,
    startAdd: vi.fn(),
    cancelAdd: vi.fn(),
    submitCreate: vi.fn(),

    isEditing: false,
    editingTitle: '',
    editingContent: '',
    setEditingTitle: vi.fn(),
    setEditingContent: vi.fn(),
    editError: null,
    isSavingFocused: false,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    submitEdit: vi.fn(),

    deleteError: null,
    isDeletingFocused: false,
    submitDelete: vi.fn(),

    isGroupManager: false,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<NotesStackPanelProps> = {}) {
  const props = baseController(overrides);
  const view = render(<NotesStackPanel {...props} />);
  return { props, ...view };
}

// The current component is a compact one-row strip, not the old collapsible panel.
// Its accessibility labels, role permissions and controller callbacks are the contract.
describe('NotesStackPanel compact strip', () => {
  it('shows loading feedback and the static heading', () => {
    renderPanel({ loading: true });
    expect(screen.getByText('GHI CHÚ')).toBeInTheDocument();
    expect(screen.getByText('Đang tải ghi chú…')).toBeInTheDocument();
  });

  it('offers add on an empty group to a manager only', () => {
    renderPanel({ isGroupManager: true });
    expect(screen.getByText('Chưa có ghi chú')).toBeInTheDocument();
    expect(screen.getByTitle('Thêm ghi chú')).toBeInTheDocument();
  });

  it('keeps an empty member view read-only', () => {
    renderPanel({ isGroupManager: false });
    expect(screen.getByText('Chưa có ghi chú')).toBeInTheDocument();
    expect(screen.queryByTitle('Thêm ghi chú')).not.toBeInTheDocument();
  });

  it('displays focused note content and author tooltip', () => {
    const note = makeNote({ title: 'Important' });
    renderPanel({ notes: [note], focusedNote: note });
    expect(screen.getByText('Important · Hello note')).toBeInTheDocument();
    expect(screen.getByTitle('Alice · Hello note')).toBeInTheDocument();
  });

  it('omits navigation for a single note', () => {
    const note = makeNote();
    renderPanel({ notes: [note], focusedNote: note });
    expect(screen.queryByTitle('Ghi chú trước')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Ghi chú tiếp')).not.toBeInTheDocument();
  });

  it('provides edit, delete and add only to group managers', () => {
    const note = makeNote();
    renderPanel({ notes: [note], focusedNote: note, isGroupManager: true });
    expect(screen.getByTitle('Thêm ghi chú')).toBeInTheDocument();
    expect(screen.getByTitle('Sửa ghi chú')).toBeInTheDocument();
    expect(screen.getByTitle('Xóa ghi chú')).toBeInTheDocument();
  });

  it('keeps a member note read-only', () => {
    const note = makeNote();
    renderPanel({ notes: [note], focusedNote: note, isGroupManager: false });
    expect(screen.queryByTitle('Thêm ghi chú')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Sửa ghi chú')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Xóa ghi chú')).not.toBeInTheDocument();
  });

  it('shows current position for multiple notes', () => {
    const notes = [makeNote({ id: 'a' }), makeNote({ id: 'b' }), makeNote({ id: 'c' })];
    renderPanel({ notes, focusedIndex: 1, focusedNote: notes[1] });
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('disables navigation beyond first and last note', () => {
    const notes = [makeNote({ id: 'a' }), makeNote({ id: 'b' })];
    const { rerender } = renderPanel({ notes, focusedIndex: 0, focusedNote: notes[0] });
    expect(screen.getByTitle('Ghi chú trước')).toBeDisabled();
    expect(screen.getByTitle('Ghi chú tiếp')).not.toBeDisabled();
    rerender(<NotesStackPanel {...baseController({ notes, focusedIndex: 1, focusedNote: notes[1] })} />);
    expect(screen.getByTitle('Ghi chú trước')).not.toBeDisabled();
    expect(screen.getByTitle('Ghi chú tiếp')).toBeDisabled();
  });

  it('dispatches navigation callbacks', () => {
    const notes = [makeNote({ id: 'a' }), makeNote({ id: 'b' }), makeNote({ id: 'c' })];
    const { props } = renderPanel({ notes, focusedIndex: 1, focusedNote: notes[1] });
    fireEvent.click(screen.getByTitle('Ghi chú trước'));
    fireEvent.click(screen.getByTitle('Ghi chú tiếp'));
    expect(props.goToPrev).toHaveBeenCalledTimes(1);
    expect(props.goToNext).toHaveBeenCalledTimes(1);
  });

  it('invokes inline creation on add action', () => {
    const { props } = renderPanel({ isGroupManager: true });
    fireEvent.click(screen.getByTitle('Thêm ghi chú'));
    expect(props.startAdd).toHaveBeenCalledTimes(1);
  });

  it('sends a valid inline new note with labeled fields', () => {
    const { props } = renderPanel({ isAdding: true, newTitle: 'Title', newContent: 'Note', isGroupManager: true });
    expect(screen.getByRole('textbox', { name: 'Tiêu đề ghi chú' })).toHaveValue('Title');
    expect(screen.getByRole('textbox', { name: 'Nội dung ghi chú' })).toHaveValue('Note');
    fireEvent.click(screen.getByTitle('Lưu ghi chú'));
    expect(props.submitCreate).toHaveBeenCalledTimes(1);
  });

  it('disables empty new note and duplicate pending save', () => {
    const { rerender } = renderPanel({ isAdding: true, newContent: '' });
    expect(screen.getByTitle('Lưu ghi chú')).toBeDisabled();
    rerender(<NotesStackPanel {...baseController({ isAdding: true, newContent: 'note', isCreating: true })} />);
    expect(screen.getByTitle('Lưu ghi chú')).toBeDisabled();
  });

  it('cancels inline new note', () => {
    const { props } = renderPanel({ isAdding: true });
    fireEvent.click(screen.getByTitle('Hủy'));
    expect(props.cancelAdd).toHaveBeenCalledTimes(1);
  });

  it('saves a valid edited note using the editor callback', () => {
    const note = makeNote();
    const { props } = renderPanel({ notes: [note], focusedNote: note, isEditing: true, editingTitle: 'Edited', editingContent: 'New content' });
    expect(screen.getByRole('textbox', { name: 'Tiêu đề ghi chú' })).toHaveValue('Edited');
    expect(screen.getByRole('textbox', { name: 'Nội dung ghi chú' })).toHaveValue('New content');
    fireEvent.click(screen.getByTitle('Lưu ghi chú'));
    expect(props.submitEdit).toHaveBeenCalledTimes(1);
  });

  it('disables edit save during a pending request', () => {
    renderPanel({ isEditing: true, editingContent: 'updated', isSavingFocused: true });
    expect(screen.getByTitle('Lưu ghi chú')).toBeDisabled();
  });

  it('cancels editing without writing', () => {
    const { props } = renderPanel({ isEditing: true });
    fireEvent.click(screen.getByTitle('Hủy'));
    expect(props.cancelEdit).toHaveBeenCalledTimes(1);
  });

  it('disables deletion while request is pending', () => {
    const note = makeNote();
    renderPanel({ notes: [note], focusedNote: note, isGroupManager: true, isDeletingFocused: true });
    expect(screen.getByTitle('Xóa ghi chú')).toBeDisabled();
  });

  it('sends a delete only on the manager action', () => {
    const note = makeNote();
    const { props } = renderPanel({ notes: [note], focusedNote: note, isGroupManager: true });
    fireEvent.click(screen.getByTitle('Xóa ghi chú'));
    expect(props.submitDelete).toHaveBeenCalledTimes(1);
  });

  it('displays an error in the non-editing strip tooltip', () => {
    renderPanel({ listError: { status: 503, message: 'Notes temporarily unavailable' } });
    expect(screen.getByTitle('Notes temporarily unavailable')).toBeInTheDocument();
  });
});
