import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, Maximize2, Plus } from 'lucide-react';
import {
  createGroupTask,
  deleteGroupTask,
  listGroupTasks,
  updateGroupTask,
  type GroupTask,
  type GroupTaskUpdate,
} from '../../lib/groupTask.api';

interface NodePosition { task: GroupTask; x: number; y: number; parentId?: string; }

function arrangeTasks(tasks: GroupTask[]): NodePosition[] {
  const active = tasks.filter(task => !task.done);
  const activeIds = new Set(active.map(task => task.id));
  const children = new Map<string | undefined, GroupTask[]>();
  for (const task of active) {
    const parentId = task.parent_id && activeIds.has(task.parent_id) ? task.parent_id : undefined;
    children.set(parentId, [...(children.get(parentId) ?? []), task]);
  }
  const heights = new Map<string, number>();
  const measure = (task: GroupTask): number => {
    const kids = children.get(task.id) ?? [];
    const height = Math.max(142, kids.reduce((total, child) => total + measure(child), 0) + Math.max(0, kids.length - 1) * 40);
    heights.set(task.id, height);
    return height;
  };
  const roots = children.get(undefined) ?? [];
  const total = roots.reduce((sum, root) => sum + measure(root), 0) + Math.max(0, roots.length - 1) * 54;
  const positions: NodePosition[] = [];
  const place = (task: GroupTask, x: number, y: number, parentId?: string) => {
    const height = heights.get(task.id) ?? 142;
    positions.push({ task, x: task.position?.x ?? x, y: task.position?.y ?? y + (height - 142) / 2, parentId });
    const kids = children.get(task.id) ?? [];
    const childHeight = kids.reduce((sum, child) => sum + (heights.get(child.id) ?? 142), 0) + Math.max(0, kids.length - 1) * 40;
    let childY = y + (height - childHeight) / 2;
    for (const child of kids) {
      place(child, x + 330, childY, task.id);
      childY += (heights.get(child.id) ?? 142) + 40;
    }
  };
  let y = Math.max(28, 470 - total / 2);
  for (const root of roots) {
    place(root, 36, y);
    y += (heights.get(root.id) ?? 142) + 54;
  }
  return positions;
}

/** Ids of `rootId` and every task below it -- the server deletes the same subtree (ON DELETE CASCADE). */
function subtreeIds(tasks: GroupTask[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parent_id && ids.has(task.parent_id) && !ids.has(task.id)) { ids.add(task.id); grew = true; }
    }
  }
  return ids;
}

export function TaskFlowBoard({ groupId }: { groupId: string }) {
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 30, y: 28 });
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [parentId, setParentId] = useState<string>();
  const [childDraftId, setChildDraftId] = useState<string>();
  const [noteDraftId, setNoteDraftId] = useState<string>();
  const [noteDraft, setNoteDraft] = useState('');
  const positions = useMemo(() => arrangeTasks(tasks), [tasks]);
  const completed = tasks.filter(task => task.done);
  const button: React.CSSProperties = { height: 30, minWidth: 30, display: 'grid', placeItems: 'center', border: '1px solid #CBD5E1', borderRadius: 7, background: 'white', color: '#334155', cursor: 'pointer' };

  const reload = useCallback(async () => {
    if (!groupId) return;
    try {
      setTasks(await listGroupTasks(groupId));
      setError(null);
    } catch (err) {
      console.error('Failed to load group tasks', err);
      setError('Không tải được bảng nhiệm vụ nhóm.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setLoading(true);
    setTasks([]);
    void reload();
  }, [reload]);

  /** Optimistic local update; on failure re-sync from the server so the board never drifts. */
  const patchTask = (taskId: string, changes: GroupTaskUpdate) => {
    setTasks(current => current.map(task => task.id === taskId ? { ...task, ...changes } : task));
    updateGroupTask(groupId, taskId, changes)
      .then(saved => setTasks(current => current.map(task => task.id === saved.id ? saved : task)))
      .catch(err => {
        console.error('Failed to update group task', err);
        setError('Không lưu được thay đổi, đã tải lại bảng.');
        void reload();
      });
  };

  const addTask = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const draft = { title: trimmed, assignee: assignee.trim(), due_date: dueDate || null, parent_id: parentId ?? null };
    setTitle(''); setAssignee(''); setDueDate(''); setParentId(undefined);
    try {
      const created = await createGroupTask(groupId, draft);
      setTasks(current => [...current, created]);
      setError(null);
    } catch (err) {
      console.error('Failed to create group task', err);
      setError('Không thêm được nhiệm vụ.');
      setTitle(trimmed);
    }
  };
  const toggleDone = (taskId: string, done: boolean) => patchTask(taskId, { done });
  const renameTask = (taskId: string, nextTitle: string) => patchTask(taskId, { title: nextTitle });
  const moveTask = (taskId: string, position: { x: number; y: number }) => patchTask(taskId, { position });
  const removeTask = (taskId: string) => {
    const removed = subtreeIds(tasks, taskId);
    setTasks(current => current.filter(task => !removed.has(task.id)));
    deleteGroupTask(groupId, taskId).catch(err => {
      console.error('Failed to delete group task', err);
      setError('Không xóa được nhiệm vụ, đã tải lại bảng.');
      void reload();
    });
  };
  const addNote = (taskId: string) => {
    const note = noteDraft.trim();
    if (!note) return;
    const task = tasks.find(item => item.id === taskId);
    if (task) patchTask(taskId, { notes: [...task.notes, note] });
    setNoteDraft(''); setNoteDraftId(undefined);
  };

  return <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC', position: 'relative', overflow: 'hidden' }}>
    <header style={{ height: 56, flexShrink: 0, padding: '0 284px 0 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0F172A', fontSize: 15, fontWeight: 700 }}><ListChecks size={18} color="#64748B" />Bảng nhiệm vụ</span>
      <span style={{ color: '#64748B', fontSize: 13 }}>{completed.length} / {tasks.length} hoàn thành</span>
    </header>
    {error && <div role="alert" style={{ padding: '8px 284px 8px 24px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', color: '#B91C1C', fontSize: 12 }}>{error}</div>}
    <div style={{ padding: '12px 284px 12px 20px', background: 'white', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <form onSubmit={event => { event.preventDefault(); void addTask(); }} style={{ display: 'flex', gap: 7, flex: '1 1 420px' }}>
        <input aria-label="Tên nhiệm vụ" value={title} onChange={event => setTitle(event.target.value)} placeholder={parentId ? 'Tên node con...' : 'Thêm nhiệm vụ gốc...'} style={{ height: 36, flex: 1, minWidth: 120, padding: '0 10px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
        <input aria-label="Người phụ trách" value={assignee} onChange={event => setAssignee(event.target.value)} placeholder="Người phụ trách" style={{ height: 36, width: 140, padding: '0 9px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }} />
        <input aria-label="Hạn hoàn thành" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={{ height: 36, width: 132, padding: '0 7px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }} />
        <button aria-label="Thêm nhiệm vụ" type="submit" disabled={!title.trim()} style={{ ...button, height: 36, background: title.trim() ? '#2563EB' : '#94A3B8', borderColor: '#2563EB', color: 'white' }}><Plus size={16} /></button>
      </form>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
        <button aria-label="Thu nhỏ" onClick={() => setZoom(value => Math.max(.35, Number((value - .1).toFixed(2))))} style={button}>−</button><span style={{ minWidth: 42, textAlign: 'center', color: '#64748B', fontSize: 12 }}>{Math.round(zoom * 100)}%</span><button aria-label="Phóng to" onClick={() => setZoom(value => Math.min(2, Number((value + .1).toFixed(2))))} style={button}>+</button><button aria-label="Trở về zoom mặc định" title="Trở về zoom mặc định" onClick={() => { setZoom(1); setOffset({ x: 30, y: 28 }); }} style={{ ...button, width: 'auto', padding: '0 8px', display: 'flex', gap: 5 }}><Maximize2 size={14}/><span style={{fontSize:11}}>Mặc định</span></button>
      </div>
    </div>
    <div onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(value => Math.max(.35, Math.min(2, value + (event.deltaY < 0 ? .08 : -.08)))); } }} onPointerDown={event => { if (event.target === event.currentTarget) { event.currentTarget.setPointerCapture(event.pointerId); setPan({ x: event.clientX - offset.x, y: event.clientY - offset.y }); } }} onPointerMove={event => { if (pan) setOffset({ x: event.clientX - pan.x, y: event.clientY - pan.y }); }} onPointerUp={() => setPan(null)} style={{ flex: 1, minHeight: 0, marginRight: 260, overflow: 'hidden', position: 'relative', backgroundColor: '#F8FAFC', backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)', backgroundSize: `${24 * zoom}px ${24 * zoom}px`, cursor: pan ? 'grabbing' : 'grab', touchAction: 'none' }}>
      {!loading && tasks.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#64748B' }}>Thêm nhiệm vụ đầu tiên để bắt đầu sơ đồ nhóm.</div>}
      {loading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#64748B' }}>Đang tải bảng nhiệm vụ...</div>}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}><defs><marker id="task-flow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#64748B" /></marker></defs><g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>{positions.filter(position => position.parentId).map(position => { const parent = positions.find(item => item.task.id === position.parentId); return parent ? <path key={position.task.id} d={`M ${parent.x + 250} ${parent.y + 71} C ${parent.x + 292} ${parent.y + 71}, ${position.x - 42} ${position.y + 71}, ${position.x} ${position.y + 71}`} fill="none" stroke="#64748B" strokeWidth="1.6" markerEnd="url(#task-flow-arrow)" /> : null; })}</g></svg>
      <div style={{ position: 'absolute', left: offset.x, top: offset.y, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        {positions.map(({ task, x, y }) => <article key={task.id} onPointerDown={event => { if ((event.target as HTMLElement).closest('button,input,form')) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({id:task.id,x,y,startX:event.clientX,startY:event.clientY,originX:x,originY:y}); }} onPointerMove={event => { if(drag?.id===task.id) setDrag({...drag,x:drag.originX+(event.clientX-drag.startX)/zoom,y:drag.originY+(event.clientY-drag.startY)/zoom}); }} onPointerUp={() => { if(drag?.id===task.id){ if(drag.x!==drag.originX||drag.y!==drag.originY) moveTask(task.id,{x:drag.x,y:drag.y}); setDrag(null);} }} style={{ position: 'absolute', left: drag?.id===task.id?drag.x:x, top: drag?.id===task.id?drag.y:y, width: 250, minHeight: 142, boxSizing: 'border-box', background: 'white', border: '1px solid #334155', boxShadow: '0 3px 10px rgba(15,23,42,.12)', cursor: drag?.id===task.id?'grabbing':'grab', touchAction:'none' }}>
          <header onDoubleClick={() => { const edited = window.prompt('Chỉnh sửa nhiệm vụ', task.title)?.trim(); if (edited && edited !== task.title) renameTask(task.id, edited); }} style={{ height: 36, padding: '0 10px', borderBottom: '1px solid #64748B', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'grab' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span><button aria-label="Xóa nhiệm vụ" onClick={() => removeTask(task.id)} style={{ border: 0, background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}>×</button></header>
          <div style={{ padding: '8px 10px', display: 'grid', gap: 5, color: '#334155', fontSize: 12 }}><div>Phụ trách: {task.assignee || 'Chưa phân công'}</div><div>Hạn: {task.due_date ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString('vi-VN') : 'Chưa đặt'}</div><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><button onClick={() => toggleDone(task.id, true)} style={{ border: 0, padding: 0, background: 'transparent', color: '#15803D', fontSize: 11, cursor: 'pointer' }}>✓ Hoàn thành</button><button aria-label={`Thêm node con cho ${task.title}`} title="Thêm node con" onClick={() => { setParentId(task.id); setTitle(''); setChildDraftId(task.id); }} style={{ marginLeft: 'auto', width: 25, height: 25, borderRadius: '50%', border: '1px solid #93C5FD', background: '#EFF6FF', color: '#1D4ED8', fontSize: 17, cursor: 'pointer' }}>+</button></div>
            {task.notes.map((note, index) => <div key={`${task.id}-${index}`} style={{ borderTop: '1px solid #E2E8F0', paddingTop: 4, color: '#64748B', fontSize: 11 }}>• {note}</div>)}
            {childDraftId === task.id && <form onSubmit={event => { event.preventDefault(); void addTask(); setChildDraftId(undefined); }} style={{ display: 'flex', gap: 4 }}><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="Tên node con" style={{ width: 165, height: 27, border: '1px solid #CBD5E1', borderRadius: 4, padding: '0 6px', fontSize: 11 }} /><button type="submit" disabled={!title.trim()} style={{ border: 0, borderRadius: 4, background: '#2563EB', color: 'white', fontSize: 11 }}>Thêm</button></form>}
            {noteDraftId === task.id ? <form onSubmit={event => { event.preventDefault(); addNote(task.id); }} style={{ display: 'flex', gap: 4 }}><input autoFocus value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Thuộc tính / note" style={{ width: 165, height: 27, border: '1px solid #CBD5E1', borderRadius: 4, padding: '0 6px', fontSize: 11 }} /><button type="submit" style={{ border: 0, borderRadius: 4, background: '#2563EB', color: 'white', fontSize: 11 }}>Lưu</button></form> : <button onClick={() => setNoteDraftId(task.id)} style={{ justifySelf: 'start', border: 0, background: 'transparent', padding: 0, color: '#2563EB', fontSize: 11, cursor: 'pointer' }}>+ Thêm thuộc tính / note</button>}
          </div>
        </article>)}
      </div>
    </div>
    <div style={{ height: 30, flexShrink: 0, padding: '0 274px 0 14px', display: 'flex', alignItems: 'center', fontSize: 11, color: '#64748B' }}>Kéo nền để di chuyển · Kéo thẻ để tự sắp xếp · Ctrl/⌘ + cuộn để zoom · Bấm + trên thẻ để thêm node con</div>
    <aside style={{position:'absolute',zIndex:5,right:0,top:0,bottom:0,width:260,display:'flex',flexDirection:'column',background:'white',borderLeft:'1px solid #334155',boxShadow:'-5px 0 18px rgba(15,23,42,.08)'}}><header style={{minHeight:56,padding:'0 14px',display:'flex',alignItems:'center',borderBottom:'1px solid #E2E8F0',fontSize:13,fontWeight:700,color:'#0F172A'}}>Nhiệm vụ đã hoàn thành <span style={{marginLeft:'auto',color:'#64748B',fontWeight:500}}>{completed.length}</span></header><div style={{flex:1,minHeight:0,overflowY:'auto',padding:10,display:'grid',alignContent:'start',gap:8}}>{completed.map(task=><button key={task.id} onClick={()=>toggleDone(task.id,false)} style={{padding:10,border:'1px solid #D1D5DB',borderRadius:5,background:'#F8FAFC',color:'#475569',fontSize:12,textAlign:'left',textDecoration:'line-through',cursor:'pointer'}}>{task.title}<span style={{display:'block',fontSize:10,color:'#94A3B8',marginTop:4}}>Bấm để khôi phục</span></button>)}</div></aside>
  </main>;
}
