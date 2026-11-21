import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarDays, Check, ListChecks, LoaderCircle, Maximize2, Minus, Plus, RotateCcw, Sparkles, StickyNote, X } from 'lucide-react';
import { WorkspaceTabs } from '../../components/groups/WorkspaceTabs';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/apiClient';
import {
  AI_MAX_HORIZON_DAYS,
  applyGroupTaskTree,
  createGroupTask,
  deleteGroupTask,
  generateGroupTaskTree,
  getGroupTaskAiQuota,
  listGroupTasks,
  updateGroupTask,
  type AIQuota,
  type GroupTask,
  type GroupTaskUpdate,
  type AIGroupTaskNode,
  type AIGroupTaskSuggestion,
} from '../../lib/groupTask.api';
import { arrangeTasks, CARD_WIDTH, connectorPath, laneKey, type NodePosition } from './taskFlowLayout';

/** YYYY-MM-DD in the browser's local time, `days` from today. */
function localIsoDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const CONNECTOR_COLOR = '#94A3B8';

function taskStatus(task: GroupTask) {
  const overdue = !task.done && !!task.due_date && task.due_date < localIsoDate();
  if (task.done) return { label: 'Hoàn thành', background: '#DCFCE7', color: '#15803D', overdue };
  if (overdue) return { label: 'Quá hạn', background: '#FEE2E2', color: '#B91C1C', overdue };
  if (task.due_date) return { label: 'Có hạn', background: '#FEF3C7', color: '#B45309', overdue };
  return { label: 'Chưa hoàn thành', background: '#DBEAFE', color: '#1D4ED8', overdue };
}

/** Small text+icon button in a card's footer; inline-flex + nowrap so icon and label never split lines. */
const cardAction: React.CSSProperties = {
  height: 26, padding: '0 6px', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
  border: 0, borderRadius: 6, background: 'transparent', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};

/** One-line input + submit inside a card. Enter saves, Esc cancels. */
function InlineDraft({ value, onChange, onSubmit, onCancel, placeholder, submitLabel }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void; onCancel: () => void; placeholder: string; submitLabel: string;
}) {
  const empty = !value.trim();
  return <form onSubmit={event => { event.preventDefault(); if (!empty) onSubmit(); }} style={{ display: 'flex', gap: 4 }}>
    <input autoFocus value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onCancel(); }} placeholder={placeholder} maxLength={500}
      style={{ flex: 1, minWidth: 0, height: 28, padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white', fontSize: 11, boxSizing: 'border-box' }} />
    <button type="submit" disabled={empty} style={{ height: 28, padding: '0 10px', flexShrink: 0, whiteSpace: 'nowrap', border: 0, borderRadius: 6, background: empty ? '#94A3B8' : '#2563EB', color: 'white', fontSize: 11, fontWeight: 600, cursor: empty ? 'default' : 'pointer' }}>{submitLabel}</button>
    <button type="button" aria-label="Hủy" title="Hủy (Esc)" onClick={onCancel} style={{ width: 24, height: 28, padding: 0, flexShrink: 0, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}><X size={13} /></button>
  </form>;
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

function AiNodePreview({ nodes, depth = 0 }: { nodes: AIGroupTaskNode[]; depth?: number }) {
  return <div style={{ display: 'grid', gap: 6, paddingLeft: depth ? 18 : 0, borderLeft: depth ? '1px solid #E2E8F0' : undefined }}>
    {nodes.map((node, index) => (
      <div key={`${depth}-${index}`} style={{ display: 'grid', gap: 3 }}>
        <div style={{ color: '#0F172A', fontSize: 13, fontWeight: depth === 0 ? 700 : 600 }}>
          {node.title}
          {node.due_date && <span style={{ marginLeft: 8, color: '#B45309', fontSize: 11, fontWeight: 500 }}>{node.due_date}</span>}
        </div>
        {node.notes.length > 0 && <div style={{ color: '#64748B', fontSize: 11 }}>{node.notes.join(' · ')}</div>}
        {node.children.length > 0 && <AiNodePreview nodes={node.children} depth={depth + 1} />}
      </div>
    ))}
  </div>;
}

export function TaskFlowBoard({ groupId, notesHeader }: { groupId: string; notesHeader?: ReactNode }) {
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiDueDate, setAiDueDate] = useState('');
  const [aiHours, setAiHours] = useState('');
  const [aiLevel, setAiLevel] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AIGroupTaskSuggestion | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [aiBackgroundDone, setAiBackgroundDone] = useState(false);
  const [aiQuota, setAiQuota] = useState<AIQuota | null>(null);
  const aiMinDate = localIsoDate(1);
  const aiMaxDate = localIsoDate(AI_MAX_HORIZON_DAYS);
  const aiQuotaSpent = aiQuota?.remaining === 0;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 30, y: 28 });
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [childDraftId, setChildDraftId] = useState<string>();
  const [childTitle, setChildTitle] = useState('');
  const [noteDraftId, setNoteDraftId] = useState<string>();
  const [noteDraft, setNoteDraft] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewAdjusted = useRef(false);
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const sizeObserver = useRef<ResizeObserver | null>(null);
  // While a card is dragged, lay it out at the drag point so its subtree and links follow live.
  const layoutTasks = useMemo(
    () => drag ? tasks.map(task => task.id === drag.id ? { ...task, position: { x: drag.x, y: drag.y } } : task) : tasks,
    [tasks, drag],
  );
  const positions = useMemo(() => arrangeTasks(layoutTasks, cardHeights), [layoutTasks, cardHeights]);
  const links = useMemo(() => {
    const byId = new Map(positions.map(position => [position.task.id, position]));
    const result: { key: string; from: NodePosition; to: NodePosition }[] = [];
    // Phase -> next phase, only within the same roadmap lane.
    const lastRootInLane = new Map<string, NodePosition>();
    for (const position of positions) {
      if (position.parentId) continue;
      const previous = lastRootInLane.get(laneKey(position.task));
      if (previous) result.push({ key: `phase-${position.task.id}`, from: previous, to: position });
      lastRootInLane.set(laneKey(position.task), position);
    }
    for (const position of positions) {
      const parent = position.parentId ? byId.get(position.parentId) : undefined;
      if (parent) result.push({ key: position.task.id, from: parent, to: position });
    }
    return result;
  }, [positions]);

  /** Cards grow with their notes; feed real heights back into the layout so stacked cards never overlap.
   *  offsetHeight ignores the canvas zoom transform, so these are layout-space pixels. */
  const measureCard = useCallback((element: HTMLElement | null) => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    sizeObserver.current ??= new ResizeObserver(entries => setCardHeights(current => {
      let next = current;
      for (const entry of entries) {
        const card = entry.target as HTMLElement;
        const id = card.dataset.taskId;
        if (!id || current[id] === card.offsetHeight) continue;
        if (next === current) next = { ...current };
        next[id] = card.offsetHeight;
      }
      return next;
    }));
    const observer = sizeObserver.current;
    observer.observe(element);
    return () => observer.unobserve(element);
  }, []);
  useEffect(() => () => sizeObserver.current?.disconnect(), []);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading || positions.length === 0) return;
    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    const maxX = Math.max(...positions.map(position => position.x + CARD_WIDTH));
    const maxY = Math.max(...positions.map(position => position.y + position.height));
    const fit = () => {
      if (viewAdjusted.current) return;
      const scale = Math.min(1, (canvas.clientWidth - 56) / (maxX - minX), (canvas.clientHeight - 56) / (maxY - minY));
      const nextZoom = Math.max(.2, scale);
      setZoom(nextZoom);
      setOffset({ x: (canvas.clientWidth - (maxX - minX) * nextZoom) / 2 - minX * nextZoom, y: (canvas.clientHeight - (maxY - minY) * nextZoom) / 2 - minY * nextZoom });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [loading, positions]);

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

  const addChildTask = async (parentTaskId: string) => {
    const trimmed = childTitle.trim();
    if (!trimmed) return;
    setChildTitle(''); setChildDraftId(undefined);
    try {
      const created = await createGroupTask(groupId, { title: trimmed, parent_id: parentTaskId });
      setTasks(current => [...current, created]);
      setError(null);
    } catch (err) {
      console.error('Failed to create child task', err);
      setError('Không thêm được nhiệm vụ con.');
      setChildTitle(trimmed); setChildDraftId(parentTaskId);
    }
  };

  const addTask = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const draft = { title: trimmed, due_date: dueDate || null, parent_id: null };
    setTitle(''); setDueDate('');
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
  const removeNote = (taskId: string, index: number) => {
    const task = tasks.find(item => item.id === taskId);
    if (task) patchTask(taskId, { notes: task.notes.filter((_, noteIndex) => noteIndex !== index) });
  };

  const generateAiTree = async () => {
    const goal = aiGoal.trim();
    const level = aiLevel.trim();
    const hours = Number(aiHours);
    if (goal.length < 10 || level.length < 5 || !Number.isInteger(hours) || hours < 1 || hours > 168) {
      setAiError('Hãy mô tả rõ mục tiêu, trình độ hiện tại và số giờ học hợp lệ.');
      return;
    }
    if (aiDueDate && (aiDueDate < aiMinDate || aiDueDate > aiMaxDate)) {
      setAiError(`Hạn mục tiêu phải sau hôm nay và không quá ${AI_MAX_HORIZON_DAYS / 365} năm.`);
      return;
    }
    setAiGenerating(true);
    setAiBackgroundDone(false);
    setAiError(null);
    setAiSuggestion(null);
    try {
      const suggestion = await generateGroupTaskTree(groupId, {
        goal,
        due_date: aiDueDate || null,
        hours_per_week: hours,
        current_level: level,
      });
      setAiSuggestion(suggestion);
      setAiQuota(current => ({ limit: current?.limit ?? 5, remaining: suggestion.remaining_today }));
      setAiBackgroundDone(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) setAiQuota(current => ({ limit: current?.limit ?? 5, remaining: 0 }));
      if (cause instanceof ApiError) setAiError(cause.message);
      else setAiError('Không thể tạo lộ trình bằng AI. Vui lòng thử lại.');
    } finally {
      setAiGenerating(false);
    }
  };

  const applyAiTree = async () => {
    if (!aiSuggestion?.nodes.length) return;
    setAiApplying(true);
    setAiError(null);
    try {
      await applyGroupTaskTree(groupId, { nodes: aiSuggestion.nodes, replace_existing: replaceExisting });
      setAiOpen(false);
      setAiSuggestion(null);
      await reload();
    } catch (cause) {
      if (cause instanceof ApiError) setAiError(cause.message);
      else setAiError('Không thể thêm lộ trình vào bảng nhiệm vụ.');
    } finally {
      setAiApplying(false);
    }
  };

  return <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC', position: 'relative', overflow: 'hidden' }}>
    <WorkspaceTabs
      title={notesHeader ?? <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0F172A', fontSize: 15, fontWeight: 700 }}><ListChecks size={18} color="#64748B" />Bảng nhiệm vụ</span>}
      tabs={[]}
      activeId={null}
      onSelect={() => {}}
      ariaLabel="Ghi chú bảng nhiệm vụ"
      actions={<span style={{ paddingRight: 8, color: '#64748B', fontSize: 13 }}>{completed.length} / {tasks.length} hoàn thành</span>}
    />
    {error && <div role="alert" style={{ padding: '8px 24px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', color: '#B91C1C', fontSize: 12 }}>{error}</div>}
    <div style={{ padding: '12px 20px', background: 'white', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <form onSubmit={event => { event.preventDefault(); void addTask(); }} style={{ display: 'flex', gap: 7, flex: '1 1 420px' }}>
        <input aria-label="Tên nhiệm vụ" value={title} onChange={event => setTitle(event.target.value)} placeholder="Thêm giai đoạn / nhiệm vụ gốc..." style={{ height: 36, flex: 1, minWidth: 120, padding: '0 10px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
        <input aria-label="Hạn hoàn thành" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={{ height: 36, width: 132, padding: '0 7px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }} />
        <button aria-label="Thêm nhiệm vụ" type="submit" disabled={!title.trim()} style={{ ...button, height: 36, background: title.trim() ? '#2563EB' : '#94A3B8', borderColor: '#2563EB', color: 'white' }}><Plus size={16} /></button>
      </form>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
        <button aria-label="Tạo lộ trình bằng AI" title="Tạo lộ trình bằng AI" onClick={() => {
          setAiOpen(true);
          setAiError(null);
          getGroupTaskAiQuota(groupId).then(setAiQuota).catch(err => console.error('Failed to load AI quota', err));
        }} style={{ ...button, width: 36, height: 36, padding: 0, background: '#7C3AED', borderColor: '#7C3AED', color: 'white' }}>
          <Sparkles size={18}/>
        </button>
        <button aria-label="Thu nhỏ" onClick={() => setZoom(value => Math.max(.35, Number((value - .1).toFixed(2))))} style={button}><Minus size={14}/></button><span style={{ minWidth: 42, textAlign: 'center', color: '#64748B', fontSize: 12 }}>{Math.round(zoom * 100)}%</span><button aria-label="Phóng to" onClick={() => setZoom(value => Math.min(2, Number((value + .1).toFixed(2))))} style={button}><Plus size={14}/></button><button aria-label="Trở về zoom mặc định" title="Trở về zoom mặc định" onClick={() => { setZoom(1); setOffset({ x: 30, y: 28 }); }} style={{ ...button, width: 'auto', padding: '0 8px', display: 'flex', gap: 5 }}><Maximize2 size={14}/><span style={{fontSize:11}}>Mặc định</span></button>      </div>
    </div>
    <div ref={canvasRef} onWheel={event => { event.preventDefault(); viewAdjusted.current = true; setZoom(value => Math.max(.2, Math.min(2, value + (event.deltaY < 0 ? .08 : -.08)))); }} onPointerDown={event => { if (event.target === event.currentTarget) { viewAdjusted.current = true; event.currentTarget.setPointerCapture(event.pointerId); setPan({ x: event.clientX - offset.x, y: event.clientY - offset.y }); } }} onPointerMove={event => { if (pan) setOffset({ x: event.clientX - pan.x, y: event.clientY - pan.y }); }} onPointerUp={() => setPan(null)} style={{ flex: 1, minHeight: 0, marginRight: 0, overflow: 'hidden', position: 'relative', backgroundColor: '#F8FAFC', backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)', backgroundSize: `${24 * zoom}px ${24 * zoom}px`, cursor: pan ? 'grabbing' : 'grab', touchAction: 'none' }}>
      {!loading && tasks.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#64748B' }}>Thêm nhiệm vụ đầu tiên để bắt đầu sơ đồ nhóm.</div>}
      {loading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#64748B' }}>Đang tải bảng nhiệm vụ...</div>}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}><defs>
        {/* userSpaceOnUse: the arrowhead keeps one size regardless of stroke width. */}
        <marker id="task-flow-arrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill={CONNECTOR_COLOR} /></marker>
      </defs><g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
        {links.map(({ key, from, to }) => <path key={key} d={connectorPath(from, to)} fill="none" stroke={CONNECTOR_COLOR} strokeWidth="1.6" markerEnd="url(#task-flow-arrow)" />)}
      </g></svg>
      <div style={{ position: 'absolute', left: offset.x, top: offset.y, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        {positions.map(({ task, x, y, parentId: nodeParentId }) => <article key={task.id} ref={measureCard} data-task-id={task.id} onPointerDown={event => { if ((event.target as HTMLElement).closest('button,input,form')) return; event.stopPropagation(); viewAdjusted.current = true; event.currentTarget.setPointerCapture(event.pointerId); setDrag({id:task.id,x,y,startX:event.clientX,startY:event.clientY,originX:x,originY:y}); }} onPointerMove={event => { if(drag?.id===task.id) setDrag({...drag,x:drag.originX+(event.clientX-drag.startX)/zoom,y:drag.originY+(event.clientY-drag.startY)/zoom}); }} onPointerUp={() => { if(drag?.id===task.id){ if(drag.x!==drag.originX||drag.y!==drag.originY) moveTask(task.id,{x:drag.x,y:drag.y}); setDrag(null);} }} style={{ position: 'absolute', left: x, top: y, width: CARD_WIDTH, boxSizing: 'border-box', background: task.done ? '#F0FDF4' : 'white', border: task.done ? '1px solid #86EFAC' : '1px solid #93C5FD', borderTop: nodeParentId ? undefined : `3px solid ${task.done ? '#16A34A' : '#7C3AED'}`, boxShadow: '0 3px 10px rgba(15,23,42,.12)', cursor: drag?.id===task.id?'grabbing':'grab', touchAction:'none' }}>
          <header onDoubleClick={() => { const edited = window.prompt('Chỉnh sửa nhiệm vụ', task.title)?.trim(); if (edited && edited !== task.title) renameTask(task.id, edited); }} style={{ height: 36, padding: '0 10px', borderBottom: '1px solid #64748B', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'grab' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span><button aria-label="Xóa nhiệm vụ" onClick={() => removeTask(task.id)} style={{ border: 0, background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}><X size={14}/></button></header>
          <div style={{ padding: '10px 12px', display: 'grid', gap: 8, color: '#334155', fontSize: 12 }}>
            {(() => {
              const status = taskStatus(task);
              return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ padding: '2px 8px', borderRadius: 999, background: status.background, color: status.color, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{status.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: status.overdue ? '#B91C1C' : '#64748B', fontSize: 11, whiteSpace: 'nowrap' }}>
                  <CalendarDays size={12} />{task.due_date ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString('vi-VN') : 'Chưa đặt hạn'}
                </span>
              </div>;
            })()}
            {task.notes.length > 0 && <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {task.notes.map((note, index) => <li key={`${task.id}-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 6px', borderRadius: 6, background: task.done ? '#DCFCE7' : '#F1F5F9', color: '#475569', fontSize: 11, lineHeight: 1.4 }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{note}</span>
                <button aria-label="Xóa ghi chú" title="Xóa ghi chú" onClick={() => removeNote(task.id, index)} style={{ flexShrink: 0, width: 16, height: 16, padding: 0, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}><X size={12} /></button>
              </li>)}
            </ul>}
            {noteDraftId === task.id && <InlineDraft value={noteDraft} onChange={setNoteDraft} onSubmit={() => addNote(task.id)} onCancel={() => { setNoteDraftId(undefined); setNoteDraft(''); }} placeholder="Ghi chú, tài liệu, link..." submitLabel="Lưu" />}
            {childDraftId === task.id && <InlineDraft value={childTitle} onChange={setChildTitle} onSubmit={() => void addChildTask(task.id)} onCancel={() => { setChildDraftId(undefined); setChildTitle(''); }} placeholder="Tên nhiệm vụ con" submitLabel="Thêm" />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: `1px solid ${task.done ? '#BBF7D0' : '#E2E8F0'}` }}>
              <button onClick={() => toggleDone(task.id, !task.done)} style={{ ...cardAction, color: task.done ? '#475569' : '#15803D' }}>
                {task.done ? <RotateCcw size={13} /> : <Check size={13} />}{task.done ? 'Khôi phục' : 'Hoàn thành'}
              </button>
              <button title="Thêm ghi chú" onClick={() => { setNoteDraftId(task.id); setNoteDraft(''); }} style={{ ...cardAction, marginLeft: 'auto', color: '#2563EB' }}>
                <StickyNote size={13} />Ghi chú
              </button>
              <button aria-label={`Thêm nhiệm vụ con cho ${task.title}`} title="Thêm nhiệm vụ con" onClick={() => { setChildDraftId(task.id); setChildTitle(''); }} style={{ width: 26, height: 26, padding: 0, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px solid #93C5FD', background: '#EFF6FF', color: '#1D4ED8', cursor: 'pointer' }}>
                <Plus size={14} />
              </button>
            </div>
          </div>
        </article>)}
      </div>
    </div>
    {aiGenerating && !aiOpen && (
      <div role="status" style={{ position: 'fixed', right: 20, top: 20, zIndex: 1200, maxWidth: 360, display: 'flex', alignItems: 'center', gap: 10, background: '#FFFFFF', border: '1px solid #DDD6FE', borderRadius: 12, boxShadow: '0 12px 30px rgba(15,23,42,.18)', padding: '12px 14px', color: '#334155', fontSize: 13 }}>
        <LoaderCircle size={18} color="#7C3AED" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        <div><strong style={{ color: '#0F172A' }}>Đang tạo lộ trình...</strong><br/><span style={{ color: '#64748B' }}>Bạn có thể tiếp tục làm việc ở bảng này.</span></div>
      </div>
    )}
    {aiBackgroundDone && !aiOpen && aiSuggestion && (
      <button onClick={() => { setAiBackgroundDone(false); setAiOpen(true); }} style={{ position: 'fixed', right: 20, top: 20, zIndex: 1200, maxWidth: 360, border: '1px solid #A7F3D0', borderRadius: 12, background: '#ECFDF5', color: '#065F46', boxShadow: '0 12px 30px rgba(15,23,42,.18)', padding: '12px 14px', cursor: 'pointer', fontWeight: 700, textAlign: 'left' }}>
        Lộ trình đã sẵn sàng - bấm để xem và áp dụng
      </button>
    )}
    <Modal isOpen={aiOpen} onClose={() => !aiApplying && setAiOpen(false)} title="Tạo lộ trình nhiệm vụ">
      {!aiSuggestion ? (
        aiGenerating ? (
          <div style={{ minHeight: 220, display: 'grid', placeItems: 'center', textAlign: 'center', color: '#334155' }}>
            <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
              <LoaderCircle size={42} color="#7C3AED" style={{ animation: 'spin 1s linear infinite' }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Đang xây dựng lộ trình</div>
                <div style={{ marginTop: 6, color: '#64748B', fontSize: 13 }}>Bạn có thể đóng cửa sổ và tiếp tục làm việc.</div>
              </div>
            </div>
          </div>
        ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
            Mục tiêu
            <textarea value={aiGoal} onChange={event => setAiGoal(event.target.value)} maxLength={500} placeholder="VD: Tôi muốn đỗ JLPT N2 vào cuối năm nay" style={{ minHeight: 82, resize: 'vertical', border: '1px solid #CBD5E1', borderRadius: 8, padding: 10, fontSize: 13, boxSizing: 'border-box' }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
              Hạn mục tiêu
              <input type="date" min={aiMinDate} max={aiMaxDate} value={aiDueDate} onChange={event => setAiDueDate(event.target.value)} style={{ height: 38, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 10px' }} />
            </label>
            <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
              Giờ học / tuần
              <input type="number" min={1} max={168} value={aiHours} onChange={event => setAiHours(event.target.value)} placeholder="VD: 10" style={{ height: 38, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 10px' }} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
            Trình độ hiện tại
            <textarea value={aiLevel} onChange={event => setAiLevel(event.target.value)} maxLength={500} placeholder="VD: Đang ở N4, đã học khoảng 500 chữ Hán và biết các cấu trúc cơ bản. Có thể nghe hiểu chậm các hội thoại đời thường, nhưng vẫn yếu khi đọc dài." style={{ minHeight: 112, resize: 'vertical', border: '1px solid #CBD5E1', borderRadius: 8, padding: 10, fontSize: 13, lineHeight: '1.5', boxSizing: 'border-box' }} />
          </label>
          {aiError && <div role="alert" style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: 10, fontSize: 12 }}>{aiError}</div>}
          {aiQuota && (
            <div style={{ color: aiQuotaSpent ? '#B91C1C' : '#64748B', fontSize: 12 }}>
              {aiQuotaSpent
                ? `Bạn đã dùng hết ${aiQuota.limit} lượt tạo lộ trình hôm nay. Hãy thử lại vào ngày mai.`
                : `Còn ${aiQuota.remaining}/${aiQuota.limit} lượt tạo lộ trình hôm nay.`}
            </div>
          )}
          {(() => {
            const blocked = aiGenerating || aiQuotaSpent || aiGoal.trim().length < 10 || aiLevel.trim().length < 5 || aiHours.trim() === '';
            return <button onClick={() => void generateAiTree()} disabled={blocked} style={{ height: 42, border: 0, borderRadius: 8, background: blocked ? '#94A3B8' : '#7C3AED', color: 'white', fontWeight: 700, cursor: blocked ? 'default' : 'pointer' }}>
              {aiGenerating ? 'Đang tạo lộ trình...' : 'Tạo lộ trình'}
            </button>;
          })()}
        </div>
        )
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{aiSuggestion.title}</div>
            <div style={{ marginTop: 4, color: '#64748B', fontSize: 12 }}>Xem lại các nhánh trước khi áp dụng.</div>
          </div>
          <div style={{ maxHeight: '42vh', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, background: '#F8FAFC' }}>
            <AiNodePreview nodes={aiSuggestion.nodes}/>
          </div>
          {aiError && <div role="alert" style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: 10, fontSize: 12 }}>{aiError}</div>}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#334155', fontSize: 13 }}>
            <input type="checkbox" checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)} />
            Thay thế toàn bộ nhiệm vụ hiện tại
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setAiSuggestion(null); setAiError(null); }} disabled={aiApplying} style={{ height: 38, border: '1px solid #CBD5E1', borderRadius: 8, background: 'white', color: '#334155', padding: '0 12px', cursor: 'pointer' }}>Chỉnh yêu cầu</button>
            <button onClick={() => void applyAiTree()} disabled={aiApplying} style={{ height: 38, border: 0, borderRadius: 8, background: aiApplying ? '#94A3B8' : '#2563EB', color: 'white', padding: '0 14px', fontWeight: 700, cursor: aiApplying ? 'default' : 'pointer' }}>{aiApplying ? 'Đang áp dụng...' : 'Áp dụng lộ trình'}</button>
          </div>
        </div>
      )}
    </Modal>
    <div style={{ height: 30, flexShrink: 0, padding: '0 14px', display: 'flex', alignItems: 'center', fontSize: 11, color: '#64748B' }}>Kéo nền để di chuyển · Kéo thẻ để tự sắp xếp · Cuộn chuột để zoom · Bấm + trên thẻ để thêm node con</div>
  </main>;
}
