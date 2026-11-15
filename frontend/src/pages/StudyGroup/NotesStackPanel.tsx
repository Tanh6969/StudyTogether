import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { getDisplayName } from '../../utils/userDisplay';
import { NOTE_CONTENT_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from '../../lib/note.types';
import type { GroupNotesController } from '../../hooks/useGroupNotes';

export interface NotesStackPanelProps extends GroupNotesController {
  isGroupManager: boolean;
}

const iconButton: React.CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid #E2E8F0',
  borderRadius: 6,
  background: 'white',
  color: '#475569',
  cursor: 'pointer',
};

export function NotesStackPanel({
  notes, loading, listError, focusedIndex, focusedNote, goToPrev, goToNext,
  isAdding, newTitle, newContent, setNewTitle, setNewContent, createError,
  isCreating, startAdd, cancelAdd, submitCreate, isEditing, editingTitle,
  editingContent, setEditingTitle, setEditingContent, editError, isSavingFocused,
  startEdit, cancelEdit, submitEdit, deleteError, isDeletingFocused, submitDelete,
  isGroupManager,
}: NotesStackPanelProps) {
  const editing = isAdding || isEditing;
  const error = listError ?? createError ?? editError ?? deleteError;
  const content = focusedNote
    ? [focusedNote.title, focusedNote.content].filter(Boolean).join(' · ')
    : loading ? 'Đang tải ghi chú…' : 'Chưa có ghi chú';

  return (
    <div style={{height: 42, minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden'}}>
      <span style={{flexShrink: 0, color: '#0369A1', fontSize: 11, fontWeight: 700, letterSpacing: '.03em'}}>GHI CHÚ</span>
      <span aria-hidden="true" style={{height: 20, width: 1, flexShrink: 0, background: '#E2E8F0'}} />

      {editing ? (
        <>
          <input
            aria-label="Tiêu đề ghi chú"
            value={isAdding ? newTitle : editingTitle}
            onChange={event => isAdding ? setNewTitle(event.target.value) : setEditingTitle(event.target.value)}
            maxLength={NOTE_TITLE_MAX_LENGTH}
            placeholder="Tiêu đề"
            style={{width: 130, minWidth: 70, height: 30, padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12, outlineColor: '#0284C7'}}
          />
          <input
            aria-label="Nội dung ghi chú"
            value={isAdding ? newContent : editingContent}
            onChange={event => isAdding ? setNewContent(event.target.value) : setEditingContent(event.target.value)}
            maxLength={NOTE_CONTENT_MAX_LENGTH}
            placeholder="Nội dung ghi chú"
            style={{flex: 1, minWidth: 80, height: 30, padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12, outlineColor: '#0284C7'}}
          />
          <button type="button" onClick={isAdding ? submitCreate : submitEdit} disabled={isAdding ? isCreating || !newContent.trim() : isSavingFocused || !editingContent.trim()} title="Lưu ghi chú" style={{...iconButton, color: '#0284C7'}}><Check size={15}/></button>
          <button type="button" onClick={isAdding ? cancelAdd : cancelEdit} title="Hủy" style={iconButton}><X size={15}/></button>
        </>
      ) : (
        <>
          <span
            title={focusedNote ? `${getDisplayName(focusedNote.author)} · ${focusedNote.content}` : error?.message ?? content}
            style={{flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: focusedNote ? '#334155' : error ? '#B91C1C' : '#94A3B8', fontSize: 12.5}}
          >{content}</span>
          {notes.length > 1 && <>
            <button type="button" onClick={goToPrev} disabled={focusedIndex === 0} title="Ghi chú trước" style={{...iconButton, opacity: focusedIndex === 0 ? .45 : 1}}><ChevronLeft size={15}/></button>
            <span style={{flexShrink:0,color:'#64748B',fontSize:10,fontVariantNumeric:'tabular-nums'}}>{focusedIndex + 1}/{notes.length}</span>
            <button type="button" onClick={goToNext} disabled={focusedIndex >= notes.length - 1} title="Ghi chú tiếp" style={{...iconButton, opacity: focusedIndex >= notes.length - 1 ? .45 : 1}}><ChevronRight size={15}/></button>
          </>}
          {isGroupManager && <>
            {focusedNote && <>
              <button type="button" onClick={startEdit} title="Sửa ghi chú" style={iconButton}><Pencil size={14}/></button>
              <button type="button" onClick={submitDelete} disabled={isDeletingFocused} title="Xóa ghi chú" style={{...iconButton,color:'#DC2626',opacity:isDeletingFocused ? .5 : 1}}><Trash2 size={14}/></button>
            </>}
            <button type="button" onClick={startAdd} title="Thêm ghi chú" style={{...iconButton,color:'#0284C7'}}><Plus size={15}/></button>
          </>}
        </>
      )}
    </div>
  );
}
