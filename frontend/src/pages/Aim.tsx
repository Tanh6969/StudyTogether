import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveCollectionRefresh } from '../hooks/useLiveCollectionRefresh';
import type { FormEvent, KeyboardEvent } from 'react';
import { Plus, Sparkles, Trash2, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { TaskManagementSection } from './TaskManagementSection';
import { Modal } from '../components/ui/Modal';
import {
  addRoadmapPhase,
  createRoadmap,
  deleteRoadmap,
  deleteRoadmapPhase,
  listRoadmaps,
  suggestRoadmap,
  suggestRoadmapQuestions,
  updateRoadmap,
  updateRoadmapPhase,
  type Roadmap,
  type RoadmapAnswer,
  type RoadmapPhase,
  type RoadmapQuestion,
} from '../lib/roadmap.api';
import { ApiError } from '../lib/apiClient';

type Status = 'Chưa bắt đầu' | 'Đang thực hiện' | 'Hoàn thành';
const STATUSES: Status[] = ['Chưa bắt đầu', 'Đang thực hiện', 'Hoàn thành'];

function friendlyError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng xuất và đăng nhập lại.';
    if (cause.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    return cause.message || 'Đã xảy ra lỗi từ máy chủ.';
  }
  if (cause instanceof TypeError && cause.message.toLowerCase().includes('fetch')) {
    return 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.';
  }
  return cause instanceof Error ? cause.message : 'Đã xảy ra lỗi không xác định.';
}

const progressOf = (r: Roadmap) =>
  r.phases.length ? Math.round(r.phases.reduce((t, p) => t + p.progress, 0) / r.phases.length) : 0;

const statusOf = (r: Roadmap): Status =>
  progressOf(r) === 100 ? 'Hoàn thành' : progressOf(r) > 0 ? 'Đang thực hiện' : 'Chưa bắt đầu';

// ─── Phase list editor (dùng trong form edit) ───────────────────────────────
function PhaseListEditor({
  roadmapId,
  phases,
  onAdded,
  onDeleted,
}: {
  roadmapId: string;
  phases: RoadmapPhase[];
  onAdded: (phase: RoadmapPhase) => void;
  onDeleted: (phaseId: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true); setErr(null);
    try {
      const p = await addRoadmapPhase(roadmapId, name);
      onAdded(p);
      setNewName('');
    } catch (c) { setErr(friendlyError(c)); }
    finally { setAdding(false); }
  };

  const remove = async (phaseId: string) => {
    if (!window.confirm('Xóa chặng này?')) return;
    setDeletingId(phaseId);
    try {
      await deleteRoadmapPhase(roadmapId, phaseId);
      onDeleted(phaseId);
    } catch (c) { setErr(friendlyError(c)); }
    finally { setDeletingId(null); }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={fieldLabel}>Chặng học</label>
      {phases.length === 0 && (
        <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>Chưa có chặng nào.</p>
      )}
      {phases.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', borderRadius: 7, padding: '6px 10px' }}>
          <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
          <span style={{ fontSize: 12, color: '#64748B' }}>{p.progress}%</span>
          <button
            type="button"
            onClick={() => void remove(p.id)}
            disabled={deletingId === p.id}
            aria-label={`Xóa chặng ${p.name}`}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#CBD5E1', display: 'flex', padding: 2 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#CBD5E1')}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={onKey}
          maxLength={100}
          placeholder="Tên chặng mới..."
          style={{ ...input, flex: 1 }}
          disabled={adding}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={adding || !newName.trim()}
          style={secondaryButton}
        >
          <Plus size={14} /> Thêm
        </button>
      </div>
      {err && <p role="alert" style={{ margin: 0, color: '#B91C1C', fontSize: 13 }}>{err}</p>}
    </div>
  );
}

// ─── Phase input for new roadmap (textarea → tag list) ──────────────────────
function PhaseTagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...value, name]);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={fieldLabel}>
        Các chặng học
      </label>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.map((name, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#EFF6FF', color: '#1D4ED8', borderRadius: 6, padding: '3px 8px', fontSize: 12 }}>
              {i + 1}. {name}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#93C5FD', padding: 0, display: 'flex' }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          maxLength={100}
          placeholder="Nhập tên chặng, nhấn Enter..."
          style={{ ...input, flex: 1 }}
        />
        <button type="button" onClick={add} disabled={!draft.trim()} style={secondaryButton}>
          <Plus size={14} /> Thêm
        </button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export function AimPage() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Status>('Đang thực hiện');

  // Create form
  const [adding, setAdding] = useState(false);
  const [cTitle, setCTitle] = useState('');
  const [cGoal, setCGoal] = useState('');
  const [cDue, setCDue] = useState('');
  const [cPhases, setCPhases] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiQuestions, setAiQuestions] = useState<RoadmapQuestion[] | null>(null);
  const [aiAnswers, setAiAnswers] = useState<string[]>([]);

  // Edit form
  const [editing, setEditing] = useState<Roadmap | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eGoal, setEGoal] = useState('');
  const [eDue, setEDue] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Phase progress modal
  const [phaseEditing, setPhaseEditing] = useState<{ roadmapId: string; phase: RoadmapPhase } | null>(null);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [phaseProgressInput, setPhaseProgressInput] = useState('0');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 32 });
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);

  const roadmapSequence = useRef(0);
  const reloadRoadmaps = useCallback(async () => {
    const sequence = ++roadmapSequence.current;
    try {
      const data = await listRoadmaps();
      if (sequence !== roadmapSequence.current) return;
      setRoadmaps(data);
      setLoadError(null);
    } catch (cause) {
      if (sequence === roadmapSequence.current) setLoadError(friendlyError(cause));
    } finally {
      if (sequence === roadmapSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reloadRoadmaps();
    return () => { roadmapSequence.current += 1; };
  }, [reloadRoadmaps]);
  useLiveCollectionRefresh({
    enabled: true,
    watchPaths: ['/roadmaps'],
    onRefresh: reloadRoadmaps,
  });

  const resetCreate = () => {
    setCTitle(''); setCGoal(''); setCDue(''); setCPhases([]);
    setAiDescription(''); setAiError(null); setAiQuestions(null); setAiAnswers([]);
  };

  const askQuestions = async () => {
    const description = aiDescription.trim();
    if (!description) return;
    setAiLoading(true); setAiError(null);
    try {
      const { questions } = await suggestRoadmapQuestions(description);
      setAiQuestions(questions);
      setAiAnswers(questions.map(() => ''));
    } catch (c) { setAiError(friendlyError(c)); }
    finally { setAiLoading(false); }
  };

  const backToDescription = () => { setAiQuestions(null); setAiAnswers([]); setAiError(null); };

  const applySuggestion = async () => {
    const description = aiDescription.trim();
    if (!description || !aiQuestions) return;
    setAiLoading(true); setAiError(null);
    try {
      const answers: RoadmapAnswer[] = aiQuestions
        .map((q, i) => ({ question: q.question, answer: aiAnswers[i] }))
        .filter(a => a.answer);
      const suggestion = await suggestRoadmap(description, answers);
      setCTitle(suggestion.title);
      setCGoal(suggestion.goal);
      setCPhases(suggestion.phases.map(p => p.name));
      setAiQuestions(null);
      setAiAnswers([]);
    } catch (c) { setAiError(friendlyError(c)); }
    finally { setAiLoading(false); }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!cTitle.trim() || !cGoal.trim()) return;
    setSaving(true); setError(null);
    try {
      const created = await createRoadmap({
        title: cTitle.trim(),
        goal: cGoal.trim(),
        due_date: cDue || null,
        phases: cPhases.map(name => ({ name })),
      });
      ++roadmapSequence.current;
      setRoadmaps(items => items.some(r => r.id === created.id) ? items : [created, ...items]);
      resetCreate();
      setAdding(false);
    } catch (c) { setError(friendlyError(c)); }
    finally { setSaving(false); }
  };

  const openEdit = (r: Roadmap) => {
    setError(null);
    setEditing(r);
    setETitle(r.title);
    setEGoal(r.goal);
    setEDue(r.due_date ?? '');
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !eTitle.trim() || !eGoal.trim()) return;
    setSaving(true); setError(null);
    try {
      const updated = await updateRoadmap(editing.id, { title: eTitle.trim(), goal: eGoal.trim(), due_date: eDue || null });
      ++roadmapSequence.current;
      setRoadmaps(items => items.map(item => item.id === updated.id ? { ...updated, phases: editing.phases } : item));
      setEditing(null);
    } catch (c) { setError(friendlyError(c)); }
    finally { setSaving(false); }
  };

  const confirmDeleteRoadmap = async () => {
    if (!editing || !window.confirm(`Xóa lộ trình "${editing.title}"? Hành động này không thể hoàn tác.`)) return;
    setDeleting(true); setError(null);
    try {
      await deleteRoadmap(editing.id);
      ++roadmapSequence.current;
      setRoadmaps(items => items.filter(item => item.id !== editing.id));
      setEditing(null);
    } catch (c) { setError(friendlyError(c)); }
    finally { setDeleting(false); }
  };

  const openPhase = (roadmapId: string, phase: RoadmapPhase) => {
    setError(null);
    setPhaseEditing({ roadmapId, phase });
    setPhaseProgress(phase.progress);
    setPhaseProgressInput(String(phase.progress));
  };

  const savePhase = async (e: FormEvent) => {
    e.preventDefault();
    if (!phaseEditing) return;
    const progress = Math.max(0, Math.min(100, Number(phaseProgressInput)));
    setSaving(true);
    try {
      const updated = await updateRoadmapPhase(phaseEditing.roadmapId, phaseEditing.phase.id, { progress });
      ++roadmapSequence.current;
      setRoadmaps(items => items.map(item =>
        item.id !== phaseEditing.roadmapId ? item
          : { ...item, phases: item.phases.map(p => p.id === updated.id ? updated : p) }
      ));
      setPhaseEditing(null);
    } catch (c) { setError(friendlyError(c)); }
    finally { setSaving(false); }
  };

  return (
    <main style={{ height: 'calc(100vh - 64px)', overflowY: 'auto', padding: 32, boxSizing: 'border-box', background: '#F8FAFC', color: '#0F172A' }}>
      <div style={{ display: 'grid', gap: 24 }}>
        <TaskManagementSection roadmaps={roadmaps} />

        {/* Roadmap section */}
        <section style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Lộ trình &amp; Mục tiêu</h2>
              <p style={{ margin: '6px 0 0', color: '#64748B', fontSize: 13 }}>
                Bấm lộ trình để chỉnh sửa; bấm từng chặng để cập nhật tiến độ.
              </p>
            </div>
            <button
              onClick={() => { resetCreate(); setError(null); setAdding(true); }}
              style={{ ...control, background: '#1E3A8A', color: 'white', border: 0 }}
            >
              <Plus size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Tạo lộ trình mới
            </button>
          </div>

          {loadError && (
            <p role="alert" style={{ color: '#B91C1C', fontSize: 13 }}>
              ⚠ {loadError}
            </p>
          )}
          {error && <p role="alert" style={{ color: '#B91C1C', fontSize: 13 }}>{error}</p>}

          {loading ? (
            <div style={{ display: 'flex', gap: 16, paddingBottom: 16 }}>
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  style={{
                    minWidth: 320,
                    maxWidth: 350,
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div className="skeleton-pulse" style={{ width: '75%', height: 20, borderRadius: 6 }} />
                  <div className="skeleton-pulse" style={{ width: '100%', height: 14, borderRadius: 4 }} />
                  <div className="skeleton-pulse" style={{ width: '85%', height: 14, borderRadius: 4 }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <div className="skeleton-pulse" style={{ width: 80, height: 12, borderRadius: 4 }} />
                    <div className="skeleton-pulse" style={{ width: 40, height: 12, borderRadius: 4 }} />
                  </div>
                  <div className="skeleton-pulse" style={{ width: '100%', height: 8, borderRadius: 20 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {[...Array(3)].map((_, j) => (
                      <div key={j} className="skeleton-pulse" style={{ height: 36, borderRadius: 7 }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? null : (
            <div>
              <style>{`
                .custom-scrollbar::-webkit-scrollbar { height: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #F8FAFC; border-radius: 8px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 8px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
              `}</style>
              
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 16, overflowX: 'auto' }} className="custom-scrollbar">
                {STATUSES.map(status => {
                  const count = roadmaps.filter(r => statusOf(r) === status).length;
                  const isActive = activeTab === status;
                  return (
                    <button
                      key={status}
                      onClick={() => setActiveTab(status)}
                      style={{
                        padding: '8px 16px',
                        background: isActive ? '#1E3A8A' : 'transparent',
                        color: isActive ? 'white' : '#64748B',
                        border: 'none',
                        borderRadius: 20,
                        fontWeight: isActive ? 600 : 500,
                        cursor: 'pointer',
                        fontSize: 14,
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexShrink: 0
                      }}
                    >
                      {status}
                      <span style={{ 
                        background: isActive ? 'rgba(255,255,255,0.2)' : '#F1F5F9', 
                        color: isActive ? 'white' : '#475569',
                        padding: '2px 8px', borderRadius: 99, fontSize: 12 
                      }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={{display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10}}>
                <button aria-label="Thu nhỏ sơ đồ" onClick={() => setCanvasZoom(z => Math.max(.35, z - .15))} style={canvasButton}><ZoomOut size={16}/></button>
                <span style={{alignSelf: 'center', minWidth: 46, textAlign: 'center', color: '#64748B', fontSize: 12}}>{Math.round(canvasZoom * 100)}%</span>
                <button aria-label="Phóng to sơ đồ" onClick={() => setCanvasZoom(z => Math.min(2, z + .15))} style={canvasButton}><ZoomIn size={16}/></button>
                <button aria-label="Đặt lại sơ đồ" onClick={() => {setCanvasZoom(1); setCanvasOffset({x: 40, y: 32});}} style={canvasButton}><Maximize2 size={16}/></button>
              </div>
              {/* Infinite pan/zoom canvas. Nodes occupy an unbounded horizontal flow; the viewport only clips the current view. */}
              <div
                onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setCanvasZoom(z => Math.max(.35, Math.min(2, z + (e.deltaY < 0 ? .08 : -.08)))); } }}
                onPointerDown={e => { if (e.target === e.currentTarget) { e.currentTarget.setPointerCapture(e.pointerId); setPanning({x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y}); } }}
                onPointerMove={e => { if (panning) setCanvasOffset({x: e.clientX - panning.x, y: e.clientY - panning.y}); }}
                onPointerUp={() => setPanning(null)}
                style={{position: 'relative', height: 450, overflow: 'hidden', borderRadius: 12, border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)', backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px`, cursor: panning ? 'grabbing' : 'grab', touchAction: 'none'}}
              >
                <div style={{position: 'absolute', left: canvasOffset.x, top: canvasOffset.y, display: 'flex', alignItems: 'center', gap: 64, transform: `scale(${canvasZoom})`, transformOrigin: 'top left', width: 'max-content', minHeight: 360, padding: 16}}>
                {roadmaps.filter(r => statusOf(r) === activeTab).length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#64748B', background: 'white', borderRadius: 12, border: '1px dashed #CBD5E1' }}>
                    Chưa có mục tiêu nào trong trạng thái này.
                  </div>
                )}
                
                {roadmaps.filter(r => statusOf(r) === activeTab).map(item => {
                  const progress = progressOf(item);
                  return (
                    <article
                      key={item.id}
                      onClick={() => openEdit(item)}
                      title="Bấm để chỉnh sửa lộ trình"
                      style={{ 
                        background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20, cursor: 'pointer',
                        minWidth: 320, flexShrink: 0,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column'
                      }}
                    >
                      <b style={{ fontSize: 16, color: '#0F172A' }}>{item.title}</b>
                      <p style={{ fontSize: 14, color: '#475569', margin: '8px 0 12px', flex: 1 }}>{item.goal}</p>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                        <small style={{ color: '#64748B', fontWeight: 500 }}>
                          Hạn: {item.due_date ? new Intl.DateTimeFormat('vi-VN').format(new Date(`${item.due_date}T00:00:00`)) : 'Chưa đặt hạn'}
                        </small>
                        <small style={{ color: '#0F172A', fontWeight: 700 }}>{progress}%</small>
                      </div>
                      
                      <div style={{ height: 8, background: '#F1F5F9', borderRadius: 20, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: '#10B981', transition: 'width 0.4s ease-out' }} />
                      </div>
                      <small style={{ color: '#64748B' }}>{item.phases.filter(p => p.progress === 100).length}/{item.phases.length} chặng hoàn thành</small>
                      
                      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, marginTop: 22}}>
                        {item.phases.map((phase, index) => (
                          <div key={phase.id} style={{position: 'relative', width: 240}}>
                            {index > 0 && <div style={{position: 'absolute', height: 34, width: 2, background: '#94A3B8', left: '50%', top: -34}}/>}
                            <button onClick={e => {e.stopPropagation(); openPhase(item.id, phase);}} title="Chọn để cập nhật tiến độ" style={{width: '100%', minHeight: 92, whiteSpace: 'pre-wrap', textAlign: 'left', padding: 14, borderRadius: 12, background: phase.progress === 100 ? '#F0FDF4' : 'white', border: `1px solid ${phase.progress === 100 ? '#86EFAC' : '#CBD5E1'}`, boxShadow: '0 4px 12px rgba(15,23,42,.08)', color: '#334155', cursor: 'pointer', font: 'inherit'}}>
                              <span style={{display: 'block', fontWeight: 650, lineHeight: 1.45}}>{phase.name.split('\\n').map((line, i) => <span key={i}>{i > 0 && <br/>}{line}</span>)}</span>
                              <span style={{display: 'block', fontSize: 12, color: '#64748B', marginTop: 8}}>Tiến độ {phase.progress}%</span>
                            </button>
                            <button aria-label={`Thêm node con cho ${phase.name}`} title="Thêm node con" onClick={async e => {e.stopPropagation(); const name = window.prompt('Tên node con'); if (!name?.trim()) return; try {const child = await addRoadmapPhase(item.id, name.trim()); setRoadmaps(all => all.map(r => r.id === item.id ? {...r, phases: [...r.phases, child]} : r));} catch (c) {setError(friendlyError(c));}}} style={{position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', border: '1px solid #BFDBFE', color: '#1D4ED8', background: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 2px 6px #0002'}}><Plus size={15}/></button>
                          </div>
                        ))}
                        <button onClick={async e => {e.stopPropagation(); const name = window.prompt('Tên node mới'); if (!name?.trim()) return; try {const node = await addRoadmapPhase(item.id, name.trim()); setRoadmaps(all => all.map(r => r.id === item.id ? {...r, phases: [...r.phases, node]} : r));} catch (c) {setError(friendlyError(c));}}} style={{...secondaryButton, borderStyle: 'dashed', whiteSpace: 'nowrap'}}><Plus size={14}/> Thêm node</button>
                      </div>
                    </article>
                  );
                })}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal: Tạo lộ trình mới */}
      <Modal isOpen={adding} onClose={() => !saving && setAdding(false)} title="Tạo lộ trình mới">
        <form onSubmit={create} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 8, background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: 14 }}>
            <label style={{ ...fieldLabel, color: '#5B21B6' }}>
              <Sparkles size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Gợi ý bằng AI
            </label>
            {!aiQuestions ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={aiDescription}
                  onChange={e => setAiDescription(e.target.value)}
                  placeholder="Mô tả chi tiết mục tiêu của bạn. VD: Mình muốn học lập trình web với React và Node.js để đi thực tập trong 3 tháng tới..."
                  maxLength={1000}
                  style={{ ...input, resize: 'vertical', minHeight: 80, lineHeight: '1.5' }}
                  disabled={aiLoading}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!aiLoading && aiDescription.trim()) {
                        void askQuestions();
                      }
                    }
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>
                    {aiDescription.length}/1000 ký tự
                  </span>
                  <button
                    type="button"
                    onClick={() => void askQuestions()}
                    disabled={aiLoading || !aiDescription.trim()}
                    style={{ ...secondaryButton, background: '#7C3AED', color: 'white', border: 0, padding: '8px 16px' }}
                  >
                    {aiLoading ? 'Đang xử lý...' : 'Tiếp theo'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {aiQuestions.map((q, i) => (
                  <div key={i} style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{q.question}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {q.options.map((opt, j) => {
                        const active = aiAnswers[i] === opt.label;
                        return (
                          <button
                            key={j}
                            type="button"
                            onClick={() => setAiAnswers(a => a.map((v, k) => (k === i ? opt.label : v)))}
                            style={{
                              ...control,
                              padding: '6px 12px',
                              fontSize: 12,
                              background: active ? '#7C3AED' : 'white',
                              color: active ? 'white' : '#334155',
                              border: active ? '1px solid #7C3AED' : '1px solid #CBD5E1',
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <button type="button" onClick={backToDescription} disabled={aiLoading} style={secondaryButton}>Quay lại</button>
                  <button
                    type="button"
                    onClick={() => void applySuggestion()}
                    disabled={aiLoading}
                    style={{ ...secondaryButton, background: '#7C3AED', color: 'white', border: 0 }}
                  >
                    {aiLoading ? 'Đang tạo...' : 'Gợi ý lộ trình'}
                  </button>
                </div>
              </div>
            )}
            {aiError && <p role="alert" style={{ margin: 0, color: '#B91C1C', fontSize: 13 }}>{aiError}</p>}
          </div>
          <label style={fieldLabel}>
            Tên lộ trình
            <input autoFocus required value={cTitle} maxLength={200} onChange={e => setCTitle(e.target.value)} style={input} />
          </label>
          <label style={fieldLabel}>
            Mục tiêu cần đạt
            <input required value={cGoal} maxLength={500} onChange={e => setCGoal(e.target.value)} style={input} />
          </label>
          <label style={fieldLabel}>
            Hạn hoàn thành
            <input type="date" value={cDue} onChange={e => setCDue(e.target.value)} style={input} />
          </label>
          <PhaseTagInput value={cPhases} onChange={setCPhases} />
          {error && <p role="alert" style={{ margin: 0, color: '#B91C1C', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setAdding(false)} disabled={saving} style={secondaryButton}>Hủy</button>
            <button disabled={saving} style={primaryButton}>{saving ? 'Đang lưu...' : 'Tạo lộ trình'}</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Chỉnh sửa lộ trình */}
      <Modal isOpen={Boolean(editing)} onClose={() => !saving && !deleting && setEditing(null)} title="Chỉnh sửa lộ trình">
        {editing && (
          <form onSubmit={saveEdit} style={{ display: 'grid', gap: 16 }}>
            <label style={fieldLabel}>
              Tên lộ trình
              <input autoFocus required value={eTitle} maxLength={200} onChange={e => setETitle(e.target.value)} style={input} />
            </label>
            <label style={fieldLabel}>
              Mục tiêu cần đạt
              <input required value={eGoal} maxLength={500} onChange={e => setEGoal(e.target.value)} style={input} />
            </label>
            <label style={fieldLabel}>
              Hạn hoàn thành
              <input type="date" value={eDue} onChange={e => setEDue(e.target.value)} style={input} />
            </label>

            {/* Quản lý chặng trực tiếp trong form edit */}
            <PhaseListEditor
              roadmapId={editing.id}
              phases={editing.phases}
              onAdded={phase => setEditing(r => r ? { ...r, phases: [...r.phases, phase] } : r)}
              onDeleted={id => setEditing(r => r ? { ...r, phases: r.phases.filter(p => p.id !== id) } : r)}
            />

            {error && <p role="alert" style={{ margin: 0, color: '#B91C1C', fontSize: 13 }}>{error}</p>}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void confirmDeleteRoadmap()}
                disabled={saving || deleting}
                style={{ ...secondaryButton, color: '#EF4444', borderColor: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={14} /> {deleting ? 'Đang xóa...' : 'Xóa lộ trình'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setEditing(null)} disabled={saving || deleting} style={secondaryButton}>Hủy</button>
                <button disabled={saving || deleting} style={primaryButton}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Cập nhật tiến độ chặng */}
      <Modal isOpen={Boolean(phaseEditing)} onClose={() => !saving && setPhaseEditing(null)} title="Cập nhật tiến độ chặng">
        <form onSubmit={savePhase} style={{ display: 'grid', gap: 20 }}>
          <b style={{ fontSize: 16, color: '#0F172A', textAlign: 'center' }}>{phaseEditing?.phase.name}</b>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <button 
              type="button" 
              onClick={() => { setPhaseProgress(0); setPhaseProgressInput('0'); }}
              style={{ ...statusBtn, background: phaseProgress === 0 ? '#FEE2E2' : '#F8FAFC', color: phaseProgress === 0 ? '#B91C1C' : '#475569', border: phaseProgress === 0 ? '1px solid #FCA5A5' : '1px solid #E2E8F0' }}
            >
              <div style={{ fontSize: 18, marginBottom: 4, fontWeight: 700 }}>0%</div>
              <div style={{ fontSize: 12 }}>Chưa bắt đầu</div>
            </button>
            <button 
              type="button" 
              onClick={() => { setPhaseProgress(50); setPhaseProgressInput('50'); }}
              style={{ ...statusBtn, background: phaseProgress > 0 && phaseProgress < 100 ? '#FEF3C7' : '#F8FAFC', color: phaseProgress > 0 && phaseProgress < 100 ? '#B45309' : '#475569', border: phaseProgress > 0 && phaseProgress < 100 ? '1px solid #FDE68A' : '1px solid #E2E8F0' }}
            >
              <div style={{ fontSize: 18, marginBottom: 4, fontWeight: 700 }}>50%</div>
              <div style={{ fontSize: 12 }}>Đang tiến hành</div>
            </button>
            <button 
              type="button" 
              onClick={() => { setPhaseProgress(100); setPhaseProgressInput('100'); }}
              style={{ ...statusBtn, background: phaseProgress === 100 ? '#DCFCE7' : '#F8FAFC', color: phaseProgress === 100 ? '#15803D' : '#475569', border: phaseProgress === 100 ? '1px solid #86EFAC' : '1px solid #E2E8F0' }}
            >
              <div style={{ fontSize: 18, marginBottom: 4, fontWeight: 700 }}>100%</div>
              <div style={{ fontSize: 12 }}>Hoàn thành</div>
            </button>
          </div>

          <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Tùy chỉnh:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button 
                type="button" 
                onClick={() => { const v = Math.max(0, phaseProgress - 10); setPhaseProgress(v); setPhaseProgressInput(String(v)); }}
                style={{ ...control, padding: '4px 10px' }}
              >
                -10
              </button>
              <input
                type="text" inputMode="numeric"
                value={phaseProgressInput}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, ''); // Chỉ cho phép nhập số
                  setPhaseProgressInput(val);
                  const v = Math.max(0, Math.min(100, Number(val) || 0));
                  setPhaseProgress(v);
                }}
                style={{ ...input, width: 56, textAlign: 'center', fontWeight: 'bold', padding: '6px 4px' }}
              />
              <span style={{ fontWeight: 'bold', color: '#64748B', fontSize: 14 }}>%</span>
              <button 
                type="button" 
                onClick={() => { const v = Math.min(100, phaseProgress + 10); setPhaseProgress(v); setPhaseProgressInput(String(v)); }}
                style={{ ...control, padding: '4px 10px' }}
              >
                +10
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => setPhaseEditing(null)} disabled={saving} style={secondaryButton}>Hủy</button>
            <button disabled={saving} style={{...primaryButton, width: 130}}>{saving ? 'Đang lưu...' : 'Lưu tiến độ'}</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}

const input = { padding: 10, border: '1px solid #CBD5E1', borderRadius: 7, font: 'inherit', width: '100%', boxSizing: 'border-box' } as const;
const primaryButton = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 0, borderRadius: 8, padding: '9px 14px', background: '#1E3A8A', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const;
const secondaryButton = { ...primaryButton, background: 'white', color: '#334155', border: '1px solid #CBD5E1' } as const;
const control = { border: '1px solid #CBD5E1', background: 'white', borderRadius: 7, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#0F172A', display: 'inline-flex', alignItems: 'center' } as const;
const canvasButton = { width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'white', border: '1px solid #CBD5E1', borderRadius: 7, color: '#334155', cursor: 'pointer' } as const;
const fieldLabel = { display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 } as const;
const statusBtn = { padding: '12px 8px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } as const;
