import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { Eraser, Flag, LogOut, Pencil, Sparkles, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { FramedAvatar } from '../../components/ui/FramedAvatar';
import { playCheer } from '../../utils/cheerSounds';
import { generateWordPack } from '../../lib/activity.api';
import { ApiError } from '../../lib/apiClient';
import { BOARD_H, BOARD_W, ChalkCanvas } from './ChalkCanvas';
import type { ChalkTool } from './ChalkCanvas';
import { MIN_PLAYERS } from './engine/engine';
import type { FeedItem, PublicState, WordEntry } from './engine/engine';
import type { ChalkGameApi } from './useChalkGame';
import { PACK_INFO } from './words';
import { chalkSounds, isChalkMuted, setChalkMuted } from './sounds';
import './theme.css';

export interface ChalkPerson {
  userId: string;
  name: string;
  initial: string;
  color: string;
  avatarUrl?: string | null;
  frame?: string | null;
  cheerStyle?: string;
}

interface ChalkGameProps {
  game: ChalkGameApi;
  roomId: string;
  currentUserId: string;
  people: Record<string, ChalkPerson>;
  isManager: boolean;
  isParticipant: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onEnd: () => void;
  onExit: () => void;
}

const CHALK_COLORS: Array<{ id: string; label: string; value: string }> = [
  { id: 'white', label: 'Phấn trắng', value: '#f4f1e8' },
  { id: 'yellow', label: 'Phấn vàng', value: '#f2de8a' },
  { id: 'pink', label: 'Phấn hồng', value: '#f0b6c6' },
  { id: 'blue', label: 'Phấn xanh', value: '#a9d3f0' },
];
const WIDTHS = [
  { label: 'Mỏng', value: 3 },
  { label: 'Vừa', value: 6 },
  { label: 'Dày', value: 10 },
];

let fontInjected = false;
function useChalkFont() {
  useEffect(() => {
    if (fontInjected) return;
    fontInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap&subset=vietnamese';
    document.head.appendChild(link);
  }, []);
}

function useNow(intervalMs = 200) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function tilt(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * 1;
}

export function ChalkGame({ game, roomId, currentUserId, people, isManager, isParticipant, onJoin, onLeave, onEnd, onExit }: ChalkGameProps) {
  useChalkFont();
  const { state, isHost } = game;
  const [muted, setMuted] = useState(isChalkMuted());
  const person = (id: string | null | undefined): ChalkPerson =>
    (id && people[id]) || { userId: id ?? '', name: 'Bạn học', initial: '?', color: '#64748B' };

  if (!state) {
    return (
      <div className="chalk-root" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="chalk-text" style={{ fontSize: 28 }}>Đang lấy phấn…</div>
      </div>
    );
  }

  const activePlayers = state.players.filter((p) => !p.left);
  const amPlaying = activePlayers.some((p) => p.userId === currentUserId);

  return (
    <div className="chalk-root" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        state={state}
        game={game}
        currentUserId={currentUserId}
        drawerName={person(state.drawerId).name}
        muted={muted}
        onToggleMute={() => {
          setChalkMuted(!muted);
          setMuted(!muted);
        }}
        canEnd={isHost || isManager}
        onEnd={onEnd}
        onLeave={onLeave}
        onExit={onExit}
        amPlaying={amPlaying}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) 1fr minmax(220px, 280px)', gap: 16, padding: '12px 16px 16px' }}>
        <Scoreboard state={state} person={person} currentUserId={currentUserId} />
        <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {state.phase === 'lobby' ? (
            <Lobby game={game} state={state} roomId={roomId} person={person} isParticipant={isParticipant} amPlaying={amPlaying} onJoin={onJoin} />
          ) : state.phase === 'ended' ? (
            <Podium game={game} state={state} person={person} onExit={onExit} />
          ) : (
            <BoardStage game={game} state={state} currentUserId={currentUserId} person={person} />
          )}
        </div>
        <GuessPanel game={game} state={state} currentUserId={currentUserId} person={person} amPlaying={amPlaying} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function TopBar(props: {
  state: PublicState;
  game: ChalkGameApi;
  currentUserId: string;
  drawerName: string;
  muted: boolean;
  onToggleMute: () => void;
  canEnd: boolean;
  onEnd: () => void;
  onLeave: () => void;
  onExit: () => void;
  amPlaying: boolean;
}) {
  const { state, game, currentUserId, drawerName, muted, onToggleMute, canEnd, onEnd, onLeave, onExit, amPlaying } = props;
  const isDrawer = state.drawerId === currentUserId;
  const inTurn = state.phase === 'choosing' || state.phase === 'drawing' || state.phase === 'turn_end';
  const iconBtn: CSSProperties = { background: 'transparent', border: '1.5px solid rgba(244,241,232,0.25)', color: '#f4f1e8', borderRadius: 8, height: 32, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: '1px solid rgba(244,241,232,0.08)', background: 'rgba(0,0,0,0.18)' }}>
      <div className="chalk-text" style={{ fontSize: 26, lineHeight: 1, whiteSpace: 'nowrap' }}>Phấn Trắng</div>
      {inTurn && (
        <div className="chalk-hand" style={{ fontSize: 17, color: 'rgba(244,241,232,0.75)', whiteSpace: 'nowrap' }}>
          Vòng {state.roundIndex + 1}/{state.settings.rounds} · {isDrawer ? 'Bạn đang vẽ' : `${drawerName} ${state.phase === 'choosing' ? 'đang chọn từ' : 'đang vẽ'}`}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        {state.phase === 'drawing' && <WordMask state={state} myWord={isDrawer ? game.myWord : null} />}
      </div>
      {(state.phase === 'drawing' || state.phase === 'choosing') && <TimerRing endsAt={game.hostToLocal(state.phaseEndsAt)} startedAt={game.hostToLocal(state.phaseStartedAt)} />}
      <button type="button" onClick={onToggleMute} aria-label={muted ? 'Bật âm thanh game' : 'Tắt âm thanh game'} title={muted ? 'Bật âm thanh game' : 'Tắt âm thanh game'} style={iconBtn}>
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <button type="button" onClick={onExit} title="Về màn hình gọi video, game vẫn chạy" style={iconBtn}>
        Về video
      </button>
      {amPlaying && !game.isHost && (
        <button type="button" onClick={onLeave} title="Rời game" style={iconBtn}>
          <LogOut size={14} /> Rời game
        </button>
      )}
      {canEnd && (
        <button type="button" onClick={onEnd} title="Đóng game cho cả phòng" style={{ ...iconBtn, borderColor: 'rgba(240,182,198,0.5)', color: '#f0b6c6' }}>
          <X size={14} /> Đóng game
        </button>
      )}
    </div>
  );
}

function WordMask({ state, myWord }: { state: PublicState; myWord: string | null }) {
  if (myWord) {
    return (
      <div className="chalk-hand" style={{ fontSize: 28, color: '#3b2f1e', background: '#f2de8a', padding: '2px 18px', borderRadius: 6, boxShadow: '0 3px 8px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
        {myWord}
      </div>
    );
  }
  const chars = Array.from(state.mask);
  return (
    <div className="chalk-text" aria-label={`Từ cần đoán có ${chars.filter((c) => c !== ' ').length} ký tự`} style={{ fontSize: 30, letterSpacing: 2, whiteSpace: 'nowrap' }}>
      {chars.map((c, i) =>
        c === ' ' ? (
          <span key={i} className="chalk-mask-slot space">&nbsp;</span>
        ) : (
          <span key={`${i}-${c}`} className="chalk-mask-slot">
            {c === '_' ? ' ' : c}
          </span>
        )
      )}
    </div>
  );
}

function TimerRing({ endsAt, startedAt }: { endsAt: number; startedAt: number }) {
  const now = useNow(200);
  const total = Math.max(1, endsAt - startedAt);
  const left = Math.max(0, endsAt - now);
  const seconds = Math.ceil(left / 1000);
  const ratio = Math.min(1, left / total);
  const urgent = seconds <= 10 && left > 0;
  const lastTickRef = useRef<number>(-1);
  useEffect(() => {
    if (urgent && seconds !== lastTickRef.current) {
      lastTickRef.current = seconds;
      chalkSounds.tick();
    }
  }, [urgent, seconds]);
  const r = 18;
  const c = 2 * Math.PI * r;
  const color = urgent ? '#f0b6c6' : '#f4f1e8';
  return (
    <div className={urgent ? 'chalk-shake' : undefined} role="timer" aria-label={`Còn ${seconds} giây`} style={{ position: 'relative', width: 46, height: 46, flexShrink: 0 }}>
      <svg width={46} height={46} viewBox="0 0 46 46">
        <circle cx={23} cy={23} r={r} fill="none" stroke="rgba(244,241,232,0.12)" strokeWidth={4} />
        <circle cx={23} cy={23} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} transform="rotate(-90 23 23)" style={{ transition: 'stroke-dashoffset 0.2s linear' }} />
      </svg>
      <div className="chalk-hand" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color }}>
        {seconds}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Scoreboard({ state, person, currentUserId }: { state: PublicState; person: (id: string) => ChalkPerson; currentUserId: string }) {
  const players = [...state.players.filter((p) => !p.left)].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  const correct = new Set(state.correctGuessers.map((g) => g.userId));
  return (
    <div className="chalk-scroll" aria-label="Bảng điểm" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      {players.map((p, idx) => {
        const who = person(p.userId);
        const gain = state.phase === 'turn_end' ? state.turnGains[p.userId] : undefined;
        return (
          <div key={p.userId} className={`chalk-note${correct.has(p.userId) ? ' chalk-correct-pop' : ''}`} style={{ padding: '10px 10px 8px', transform: `rotate(${tilt(p.userId)}deg)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FramedAvatar size={28} initials={who.initial} color={who.color} avatarUrl={who.avatarUrl} frame={who.frame} />
              <div className="chalk-hand" style={{ fontSize: 17, lineHeight: 1.1, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.userId === currentUserId ? 'Bạn' : who.name}
              </div>
              <span className="chalk-hand" style={{ fontSize: 13, opacity: 0.6 }}>#{idx + 1}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
              <span className="chalk-hand" style={{ fontSize: 24, fontWeight: 700 }}>{p.score}</span>
              <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {state.drawerId === p.userId && (state.phase === 'drawing' || state.phase === 'choosing') && (
                  <>
                    <Pencil size={12} /> vẽ
                  </>
                )}
                {correct.has(p.userId) && state.phase === 'drawing' && <span style={{ color: '#2f7d43', fontWeight: 700 }}>✔ đúng</span>}
                {gain ? <span style={{ color: '#2f7d43', fontWeight: 700 }}>+{gain}</span> : null}
              </span>
            </div>
          </div>
        );
      })}
      {state.players.length === 0 && <div className="chalk-hand" style={{ opacity: 0.6, fontSize: 16 }}>Chưa ai vào chơi</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** `fill` = take the whole stage (lobby / podium); otherwise keep the drawing board at 4:3. */
function BoardFrame({ children, overlay, fill = false }: { children: ReactNode; overlay?: ReactNode; fill?: boolean }) {
  const boardStyle: CSSProperties = fill
    ? { width: '100%', flex: 1, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box' }
    : { width: '100%', maxWidth: `calc((100vh - 290px) * ${BOARD_W / BOARD_H})`, aspectRatio: `${BOARD_W} / ${BOARD_H}`, overflow: 'hidden' };
  return (
    <div style={{ width: '100%', height: fill ? '100%' : undefined, maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="chalk-board" style={boardStyle}>
        {children}
        {overlay && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 30, 22, 0.55)' }}>{overlay}</div>}
      </div>
      <div className="chalk-tray" style={{ width: fill ? 'calc(100% - 16px)' : '100%', maxWidth: fill ? undefined : `calc((100vh - 290px) * ${BOARD_W / BOARD_H})`, flexShrink: 0 }} />
    </div>
  );
}

function BoardStage({ game, state, currentUserId, person }: { game: ChalkGameApi; state: PublicState; currentUserId: string; person: (id: string) => ChalkPerson }) {
  const isDrawer = state.drawerId === currentUserId;
  const [tool, setTool] = useState<ChalkTool>('chalk');
  const [color, setColor] = useState(CHALK_COLORS[0].value);
  const [width, setWidth] = useState(6);
  const [emptyFlash, setEmptyFlash] = useState(0);
  const limited = state.settings.chalkLimited;
  const chalkLeft = isDrawer ? game.chalkLeft : state.chalkLeft;
  const prevLeftRef = useRef(chalkLeft);
  useEffect(() => {
    if (prevLeftRef.current > 0 && chalkLeft <= 0) setEmptyFlash(Date.now());
    prevLeftRef.current = chalkLeft;
  }, [chalkLeft]);

  let overlay: ReactNode = null;
  if (state.phase === 'choosing') {
    overlay = isDrawer && game.myOptions ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div className="chalk-text" style={{ fontSize: 30 }}>Chọn một từ để vẽ</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
          {game.myOptions.map((opt, i) => (
            <WordCard key={opt.word} option={opt} onPick={() => game.pickWord(i)} />
          ))}
        </div>
      </div>
    ) : (
      <div className="chalk-text" style={{ fontSize: 30, textAlign: 'center' }}>
        {person(state.drawerId ?? '').name} đang chọn từ…
      </div>
    );
  } else if (state.phase === 'turn_end') {
    overlay = <TurnSummary state={state} person={person} currentUserId={currentUserId} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
      <BoardFrame overlay={overlay}>
        <ChalkCanvas
          strokes={game.strokes}
          live={game.live}
          canDraw={isDrawer && state.phase === 'drawing'}
          tool={tool}
          color={color}
          width={width}
          chalkLeft={limited ? chalkLeft : 1}
          chalkLimited={limited}
          selfId={currentUserId}
          onMove={game.strokeMove}
          onEnd={(s) => void game.strokeEnd(s)}
          onChalkUsed={game.useChalk}
        />
      </BoardFrame>
      {state.phase === 'drawing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center', minHeight: 36 }}>
          {limited && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label={`Còn ${Math.round(chalkLeft * 100)}% phấn`}>
              <span className="chalk-hand" style={{ fontSize: 16, opacity: 0.8 }}>{chalkLeft <= 0 ? 'Hết phấn!' : 'phấn'}</span>
              <div key={emptyFlash} className={emptyFlash ? 'chalk-meter-empty' : undefined} style={{ width: 120, height: 10, borderRadius: 5, background: 'rgba(244,241,232,0.12)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, chalkLeft) * 100}%`, height: '100%', background: chalkLeft > 0.25 ? '#f2de8a' : '#f0b6c6', transition: 'width 0.2s' }} />
              </div>
              <span className="chalk-hand" style={{ fontSize: 15, opacity: 0.7, width: 36 }}>{Math.round(Math.max(0, chalkLeft) * 100)}%</span>
            </div>
          )}
          {isDrawer && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {CHALK_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chalk-tool"
                    aria-pressed={tool === 'chalk' && color === c.value}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => {
                      setColor(c.value);
                      setTool('chalk');
                    }}
                  >
                    <span style={{ width: 16, height: 16, borderRadius: '50%', background: c.value, display: 'block' }} />
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {WIDTHS.map((w) => (
                  <button key={w.value} type="button" className="chalk-tool" aria-pressed={width === w.value} aria-label={`Nét ${w.label.toLowerCase()}`} title={w.label} onClick={() => setWidth(w.value)}>
                    <span style={{ width: w.value + 2, height: w.value + 2, borderRadius: '50%', background: '#f4f1e8', display: 'block' }} />
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="chalk-tool" aria-pressed={tool === 'erase'} aria-label="Tẩy" title="Tẩy" onClick={() => setTool(tool === 'erase' ? 'chalk' : 'erase')}>
                  <Eraser size={16} />
                </button>
                <button type="button" className="chalk-tool" aria-label="Hoàn tác" title="Hoàn tác" onClick={game.undo}>
                  <Undo2 size={16} />
                </button>
                <button type="button" className="chalk-tool" aria-label="Xóa hết" title="Xóa hết (không hoàn phấn)" onClick={game.clear}>
                  <Trash2 size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WordCard({ option, onPick }: { option: WordEntry; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="chalk-note" style={{ padding: '14px 18px 10px', minWidth: 150, cursor: 'pointer', border: 'none', borderBottom: '3px solid #e6c95a', font: 'inherit', transform: `rotate(${option.difficulty - 2}deg)` }}>
      <div className="chalk-hand" style={{ fontSize: 24, color: '#3b2f1e' }}>{option.word}</div>
      <div aria-label={`Độ khó ${option.difficulty}`} style={{ marginTop: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
        {[1, 2, 3].map((d) => (
          <span key={d} style={{ width: 16, height: 5, borderRadius: 2, background: d <= option.difficulty ? '#3b2f1e' : 'rgba(59,47,30,0.2)' }} />
        ))}
      </div>
    </button>
  );
}

function TurnSummary({ state, person, currentUserId }: { state: PublicState; person: (id: string) => ChalkPerson; currentUserId: string }) {
  const drawer = state.drawerId;
  return (
    <div className="chalk-paper" style={{ padding: '22px 28px', minWidth: 300, maxWidth: '80%', transform: 'rotate(-1.5deg)' }}>
      <div style={{ fontSize: 13, opacity: 0.6, textAlign: 'center' }}>{state.turnCancelled ? 'Lượt bị hủy' : 'Đáp án'}</div>
      <div className="chalk-hand" style={{ fontSize: 40, textAlign: 'center', lineHeight: 1.1, margin: '4px 0 12px' }}>{state.lastAnswer ?? 'không rõ'}</div>
      {state.correctGuessers.length === 0 ? (
        <div className="chalk-hand" style={{ fontSize: 18, textAlign: 'center', opacity: 0.7 }}>Chưa ai đoán ra lượt này</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {state.correctGuessers.map((g) => (
            <li key={g.userId} className="chalk-hand" style={{ fontSize: 18, display: 'flex', justifyContent: 'space-between', gap: 18 }}>
              <span>{g.userId === currentUserId ? 'Bạn' : person(g.userId).name}</span>
              <span style={{ opacity: 0.6 }}>giây thứ {Math.max(1, Math.round(g.elapsedMs / 1000))}</span>
              <span style={{ color: '#2f7d43', fontWeight: 700 }}>+{g.points}</span>
            </li>
          ))}
        </ul>
      )}
      {drawer && state.turnGains[drawer] ? (
        <div className="chalk-hand" style={{ fontSize: 18, marginTop: 10, textAlign: 'center' }}>
          {drawer === currentUserId ? 'Bạn' : person(drawer).name} vẽ được <b style={{ color: '#2f7d43' }}>+{state.turnGains[drawer]}</b>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Lobby({ game, state, roomId, person, isParticipant, amPlaying, onJoin }: { game: ChalkGameApi; state: PublicState; roomId: string; person: (id: string) => ChalkPerson; isParticipant: boolean; amPlaying: boolean; onJoin: () => void }) {
  const { isHost } = game;
  const s = state.settings;
  const players = state.players.filter((p) => !p.left);
  const [packPreview, setPackPreview] = useState<{ topic: string; words: WordEntry[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const togglePack = (id: string) => {
    if (!isHost) return;
    if (id === 'onbai' && !s.packs.includes('onbai') && s.customWords.length === 0) {
      void generate();
      return;
    }
    const packs = s.packs.includes(id) ? s.packs.filter((p) => p !== id) : [...s.packs, id];
    if (packs.length) game.updateSettings({ packs });
  };

  const generate = async () => {
    setGenerating(true);
    setPackError(null);
    try {
      const res = await generateWordPack(roomId);
      setPackPreview({ topic: res.topic, words: res.words });
    } catch (err) {
      setPackError(err instanceof ApiError ? err.message : 'Chưa sinh được bộ từ, thử lại.');
    } finally {
      setGenerating(false);
    }
  };

  const chip = (label: string, pressed: boolean, onClick: () => void, key?: string) => (
    <button key={key ?? label} type="button" className="chalk-chip" aria-pressed={pressed} disabled={!isHost} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <BoardFrame
      fill
      overlay={
        packPreview ? (
          <div className="chalk-paper" style={{ padding: 20, width: 'min(90%, 520px)', maxHeight: '90%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="chalk-hand" style={{ fontSize: 26 }}>Bộ từ Ôn bài ✨</div>
            <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: 'pre-line', maxHeight: 40, overflow: 'hidden' }}>Từ chủ đề: {packPreview.topic}</div>
            <div className="chalk-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, overflowY: 'auto', minHeight: 0 }}>
              {packPreview.words.map((w) => (
                <span key={w.word} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: '#ffe98a', fontSize: 13 }}>
                  {w.word} <span style={{ opacity: 0.5 }}>{'•'.repeat(w.difficulty)}</span>
                  <button type="button" aria-label={`Bỏ từ ${w.word}`} onClick={() => setPackPreview({ ...packPreview, words: packPreview.words.filter((x) => x.word !== w.word) })} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', color: '#3b2f1e' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setPackPreview(null)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #c9bfa6', background: 'transparent', cursor: 'pointer' }}>
                Hủy
              </button>
              <button
                type="button"
                disabled={packPreview.words.length < 6}
                onClick={() => {
                  game.updateSettings({ customWords: packPreview.words, packs: Array.from(new Set([...s.packs, 'onbai'])) });
                  setPackPreview(null);
                }}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#3b2f1e', color: '#fbf8f0', cursor: 'pointer' }}
              >
                Dùng {packPreview.words.length} từ này
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div style={{ position: 'absolute', inset: 0, padding: '4% 5%', display: 'flex', flexDirection: 'column', gap: '3%', overflow: 'auto' }} className="chalk-scroll">
        <div style={{ textAlign: 'center' }}>
          <div className="chalk-text" style={{ fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1 }}>PHẤN TRẮNG</div>
          <div className="chalk-hand" style={{ fontSize: 20, opacity: 0.7 }}>vẽ · đoán · cười</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24, flex: 1, minHeight: 0 }}>
          <div>
            <div className="chalk-hand" style={{ fontSize: 20, marginBottom: 10 }}>Người chơi ({players.length}/10)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {players.map((p) => {
                const who = person(p.userId);
                return (
                  <div key={p.userId} className="chalk-note chalk-hand" style={{ padding: '8px 12px 6px', fontSize: 17, transform: `rotate(${tilt(p.userId)}deg)` }}>
                    {who.name}
                    {p.userId === game.hostId ? ' (chủ)' : ''}
                  </div>
                );
              })}
            </div>
            {!amPlaying && isParticipant && (
              <button type="button" className="chalk-btn primary" style={{ marginTop: 16 }} onClick={onJoin}>
                Vào chơi
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="chalk-hand" style={{ fontSize: 20 }}>Cài đặt {isHost ? '' : '(chủ game chọn)'}</div>
            <Row label="Số vòng">{[1, 3, 5].map((n) => chip(String(n), s.rounds === n, () => game.updateSettings({ rounds: n }), `r${n}`))}</Row>
            <Row label="Thời gian vẽ">{[40, 60, 90].map((n) => chip(`${n}s`, s.drawSeconds === n, () => game.updateSettings({ drawSeconds: n }), `t${n}`))}</Row>
            <Row label="Phấn">
              {chip('Có hạn', s.chalkLimited, () => game.updateSettings({ chalkLimited: true }))}
              {chip('Vô hạn', !s.chalkLimited, () => game.updateSettings({ chalkLimited: false }))}
            </Row>
            <Row label="Bộ từ">
              {PACK_INFO.map((p) => (
                <span key={p.id} title={p.hint}>
                  {chip(p.label, s.packs.includes(p.id), () => togglePack(p.id), p.id)}
                </span>
              ))}
              <button type="button" className="chalk-chip" aria-pressed={s.packs.includes('onbai')} disabled={!isHost || generating} onClick={() => togglePack('onbai')} title="Sinh từ chủ đề học của nhóm bằng AI">
                <Sparkles size={12} style={{ verticalAlign: -1 }} /> {generating ? 'Đang sinh…' : s.customWords.length ? `Ôn bài (${s.customWords.length})` : 'Ôn bài'}
              </button>
              {isHost && s.customWords.length > 0 && (
                <button type="button" className="chalk-chip" onClick={() => void generate()} disabled={generating}>
                  Sinh lại
                </button>
              )}
            </Row>
            {packError && <div style={{ color: '#f0b6c6', fontSize: 13 }}>{packError}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {isHost ? (
            <button type="button" className="chalk-btn primary" disabled={players.length < MIN_PLAYERS} onClick={game.start} style={{ fontSize: 24 }}>
              {players.length < MIN_PLAYERS ? 'Cần ít nhất 2 người' : 'Bắt đầu'}
            </button>
          ) : (
            <div className="chalk-hand" style={{ fontSize: 20, opacity: 0.75 }}>Đang đợi chủ game bắt đầu…</div>
          )}
        </div>
      </div>
    </BoardFrame>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, opacity: 0.7, width: 92 }}>{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Podium({ game, state, person, onExit }: { game: ChalkGameApi; state: PublicState; person: (id: string) => ChalkPerson; onExit: () => void }) {
  const playedRef = useRef(false);
  const [first, second, third] = state.podium;
  useEffect(() => {
    if (playedRef.current || !first) return;
    playedRef.current = true;
    const t = window.setTimeout(() => {
      if (!isChalkMuted()) playCheer(person(first).cheerStyle);
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  const scoreOf = (id?: string) => state.players.find((p) => p.userId === id)?.score ?? 0;
  const step = (id: string | undefined, place: 1 | 2 | 3, height: number, delay: number) => {
    if (!id) return <div style={{ width: 130 }} />;
    const who = person(id);
    return (
      <div className="chalk-podium-step" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, animationDelay: `${delay}ms` }}>
        <FramedAvatar size={place === 1 ? 64 : 52} initials={who.initial} color={who.color} avatarUrl={who.avatarUrl} frame={who.frame} />
        <div className="chalk-hand" style={{ fontSize: 20, maxWidth: 130, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.name}</div>
        <div className="chalk-hand" style={{ fontSize: 16, opacity: 0.75 }}>{scoreOf(id)} điểm</div>
        <div style={{ width: 130, height, background: 'linear-gradient(#b07a42, #6b4320)', borderRadius: '6px 6px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 8, boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.2)' }}>
          <span className="chalk-hand" style={{ fontSize: 34, color: '#fbf8f0' }}>{place}</span>
        </div>
      </div>
    );
  };
  return (
    <BoardFrame fill>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 18, padding: '4% 4% 0' }}>
        <div className="chalk-text" style={{ fontSize: 40, position: 'absolute', top: '6%' }}>Hết giờ ra chơi!</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
          {step(second, 2, 90, 400)}
          {step(first, 1, 130, 800)}
          {step(third, 3, 60, 0)}
        </div>
        <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 10 }}>
          {game.isHost && (
            <button type="button" className="chalk-btn primary" onClick={game.restart}>
              Chơi lại
            </button>
          )}
          <button type="button" className="chalk-btn" onClick={onExit}>
            Về học thôi
          </button>
        </div>
      </div>
    </BoardFrame>
  );
}

// ---------------------------------------------------------------------------------------------

function GuessPanel({ game, state, currentUserId, person, amPlaying }: { game: ChalkGameApi; state: PublicState; currentUserId: string; person: (id: string) => ChalkPerson; amPlaying: boolean }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const now = useNow(500);
  const isDrawer = state.drawerId === currentUserId;
  const guessed = state.correctGuessers.some((g) => g.userId === currentUserId);
  const canGuess = amPlaying && state.phase === 'drawing' && !isDrawer && !guessed;
  const closeCall = now - game.closeCallAt < 2500;
  const reported = state.textReports.includes(currentUserId);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.feed.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || !canGuess) return;
    game.guess(value);
    setText('');
  };

  const placeholder = !amPlaying
    ? 'Vào chơi để đoán'
    : isDrawer
      ? 'Bạn đang vẽ, không đoán được'
      : guessed
        ? 'Bạn đoán đúng rồi!'
        : state.phase === 'drawing'
          ? 'Gõ câu đoán rồi Enter'
          : 'Đợi lượt vẽ…';

  return (
    <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.18)', borderRadius: 10, border: '1px solid rgba(244,241,232,0.08)', overflow: 'hidden' }}>
      <div className="chalk-hand" style={{ fontSize: 20, padding: '10px 12px 6px' }}>Đoán</div>
      <div ref={listRef} className="chalk-scroll" aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.feed.map((f) => (
          <FeedLine key={f.id} item={f} name={f.userId === currentUserId ? 'Bạn' : person(f.userId ?? '').name} />
        ))}
      </div>
      {closeCall && <div style={{ margin: '0 12px 6px', padding: '6px 10px', borderRadius: 8, background: 'rgba(242,222,138,0.15)', color: '#f2de8a', fontSize: 13 }}>Gần đúng rồi!</div>}
      {game.blockedMessage && <div style={{ margin: '0 12px 6px', padding: '6px 10px', borderRadius: 8, background: 'rgba(240,182,198,0.15)', color: '#f0b6c6', fontSize: 13 }}>{game.blockedMessage}</div>}
      {state.phase === 'drawing' && amPlaying && !isDrawer && (
        <button type="button" onClick={game.reportText} disabled={reported} title="Người vẽ đang viết chữ thay vì vẽ hình" style={{ margin: '0 12px 6px', background: 'transparent', border: '1px dashed rgba(244,241,232,0.3)', color: 'rgba(244,241,232,0.7)', borderRadius: 8, padding: '4px 8px', fontSize: 12, cursor: reported ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <Flag size={12} /> {reported ? 'Đã báo vẽ chữ' : 'Báo vẽ chữ'}
        </button>
      )}
      <form onSubmit={submit} style={{ padding: 10, borderTop: '1px solid rgba(244,241,232,0.08)' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canGuess}
          maxLength={60}
          aria-label="Câu đoán"
          placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', background: canGuess ? 'rgba(244,241,232,0.08)' : 'transparent', border: `1.5px solid ${guessed ? '#7bd88f' : 'rgba(244,241,232,0.25)'}`, borderRadius: 8, padding: '9px 10px', color: '#f4f1e8', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
        />
      </form>
    </div>
  );
}

function FeedLine({ item, name }: { item: FeedItem; name: string }) {
  if (item.kind === 'system') return <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'rgba(244,241,232,0.55)' }}>{item.text}</div>;
  if (item.kind === 'correct')
    return (
      <div className="chalk-correct-pop" style={{ fontSize: 13.5, color: '#7bd88f', fontWeight: 600 }}>
        ✔ {name} {item.text}
      </div>
    );
  return (
    <div style={{ fontSize: 13.5, color: '#f4f1e8', wordBreak: 'break-word' }}>
      <span style={{ opacity: 0.6 }}>{name}:</span> {item.text}
    </div>
  );
}
