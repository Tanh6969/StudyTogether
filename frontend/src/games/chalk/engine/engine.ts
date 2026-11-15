/**
 * Phấn Trắng game engine (docs/design/hoat-dong-trong-call.md §2).
 *
 * A pure reducer: `reduce(state, event) -> { state, effects }`. It runs ONLY in the host's
 * browser; everyone else renders the public projection the host broadcasts. Keeping it pure
 * (no timers, no network) is what makes the scoring / hint / turn rules unit-testable.
 */

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turn_end' | 'ended';
export type Difficulty = 1 | 2 | 3;

export interface WordEntry {
  word: string;
  difficulty: Difficulty;
}

export interface ChalkSettings {
  rounds: number;
  drawSeconds: number;
  chalkLimited: boolean;
  packs: string[];
  /** The AI "Ôn bài" words, when that pack is selected. */
  customWords: WordEntry[];
}

export interface Player {
  userId: string;
  joinedAt: number;
  score: number;
  /** Players who join mid-round only draw from this round index on. */
  drawsFromRound: number;
  left: boolean;
}

export interface CorrectGuess {
  userId: string;
  at: number;
  /** ms since the drawing phase started -- what the turn summary shows. */
  elapsedMs: number;
  points: number;
}

export interface FeedItem {
  id: number;
  userId: string | null;
  text: string;
  kind: 'guess' | 'correct' | 'close' | 'system';
  at: number;
}

export interface GameState {
  settings: ChalkSettings;
  players: Player[];
  phase: Phase;
  roundIndex: number;
  turnIndex: number;
  turnOrder: string[];
  drawerId: string | null;
  phaseEndsAt: number;
  phaseStartedAt: number;
  /** Secret -- stripped from the public projection. */
  currentWord: string | null;
  /** Secret -- only the drawer gets these. */
  wordOptions: WordEntry[] | null;
  difficulty: Difficulty;
  mask: string;
  revealed: number[];
  hintsGiven: number;
  correctGuessers: CorrectGuess[];
  usedWords: string[];
  chalkLeft: number;
  turnGains: Record<string, number>;
  lastAnswer: string | null;
  turnCancelled: boolean;
  textReports: string[];
  podium: string[];
  feed: FeedItem[];
  feedSeq: number;
  version: number;
}

export type PublicState = Omit<GameState, 'currentWord' | 'wordOptions'>;

export type EngineEvent =
  | { type: 'join'; userId: string; at: number }
  | { type: 'leave'; userId: string; at: number }
  | { type: 'settings'; userId: string; settings: Partial<ChalkSettings>; hostId: string }
  | { type: 'start'; userId: string; at: number; hostId: string; random: () => number }
  | { type: 'restart'; userId: string; at: number; hostId: string; random: () => number }
  | { type: 'cancel'; userId: string; hostId: string; at: number }
  | { type: 'pick_word'; userId: string; index: number; at: number }
  | { type: 'guess'; userId: string; text: string; at: number }
  | { type: 'chalk'; userId: string; left: number }
  | { type: 'report_text'; userId: string; at: number }
  | { type: 'tick'; at: number; random: () => number };

export type Effect =
  | { type: 'word_options'; userId: string; options: WordEntry[] }
  | { type: 'word'; userId: string; word: string }
  | { type: 'close_call'; userId: string }
  | { type: 'guess_blocked'; userId: string; reason: string }
  | { type: 'sound'; name: 'correct' | 'turn_end' | 'win' | 'start' };

export interface ReduceResult {
  state: GameState;
  effects: Effect[];
}

export const CHOOSE_SECONDS = 10;
export const TURN_END_SECONDS = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
const FEED_LIMIT = 60;

export const DEFAULT_SETTINGS: ChalkSettings = {
  rounds: 3,
  drawSeconds: 60,
  chalkLimited: true,
  packs: ['sinhvien'],
  customWords: [],
};

export function createInitialState(settings: Partial<ChalkSettings> = {}): GameState {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: [],
    phase: 'lobby',
    roundIndex: 0,
    turnIndex: 0,
    turnOrder: [],
    drawerId: null,
    phaseEndsAt: 0,
    phaseStartedAt: 0,
    currentWord: null,
    wordOptions: null,
    difficulty: 1,
    mask: '',
    revealed: [],
    hintsGiven: 0,
    correctGuessers: [],
    usedWords: [],
    chalkLeft: 1,
    turnGains: {},
    lastAnswer: null,
    turnCancelled: false,
    textReports: [],
    podium: [],
    feed: [],
    feedSeq: 0,
    version: 0,
  };
}

export function toPublic(state: GameState): PublicState {
  const { currentWord: _w, wordOptions: _o, ...rest } = state;
  void _w;
  void _o;
  return rest;
}

// --- text helpers ------------------------------------------------------------------------------

/** Lowercase, strip Vietnamese diacritics (đ -> d), collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const LETTER = /[\p{L}\p{N}]/u;

/** "_ _ _  _ _" style mask with revealed positions filled in. */
export function maskWord(word: string, revealed: number[]): string {
  const set = new Set(revealed);
  return Array.from(word)
    .map((ch, i) => (LETTER.test(ch) ? (set.has(i) ? ch : '_') : ch))
    .join('');
}

export function letterPositions(word: string): number[] {
  return Array.from(word)
    .map((ch, i) => (LETTER.test(ch) ? i : -1))
    .filter((i) => i >= 0);
}

// --- scoring -------------------------------------------------------------------------------------

const DIFFICULTY_MULT: Record<Difficulty, number> = { 1: 1, 2: 1.25, 3: 1.5 };

export function guesserPoints(timeLeftMs: number, totalMs: number, difficulty: Difficulty, isFirst: boolean): number {
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / totalMs)) : 0;
  return Math.round((40 + 60 * ratio) * DIFFICULTY_MULT[difficulty]) + (isFirst ? 15 : 0);
}

export function drawerPoints(correctCount: number, chalkLimited: boolean, chalkLeft: number): number {
  const base = Math.min(90, 15 * correctCount);
  const bonus = chalkLimited && chalkLeft > 0.4 && correctCount >= 2 ? 10 : 0;
  return base + bonus;
}

// --- internals -------------------------------------------------------------------------------------

function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.left);
}

function bump(state: GameState): GameState {
  return { ...state, version: state.version + 1 };
}

function pushFeed(state: GameState, item: Omit<FeedItem, 'id'>): GameState {
  const id = state.feedSeq + 1;
  const feed = [...state.feed, { ...item, id }];
  return { ...state, feed: feed.length > FEED_LIMIT ? feed.slice(feed.length - FEED_LIMIT) : feed, feedSeq: id };
}

function pickOptions(pool: WordEntry[], used: string[], random: () => number): WordEntry[] {
  const usedSet = new Set(used.map((w) => normalize(w)));
  const available = pool.filter((w) => !usedSet.has(normalize(w.word)));
  const source = available.length >= 3 ? available : pool;
  const byDifficulty: Record<Difficulty, WordEntry[]> = { 1: [], 2: [], 3: [] };
  for (const w of source) byDifficulty[w.difficulty].push(w);
  const take = (list: WordEntry[]) => (list.length ? list.splice(Math.floor(random() * list.length), 1)[0] : null);
  const picked: WordEntry[] = [];
  for (const d of [1, 2, 3] as Difficulty[]) {
    const w = take(byDifficulty[d]);
    if (w) picked.push(w);
  }
  const rest = ([1, 2, 3] as Difficulty[]).flatMap((d) => byDifficulty[d]);
  while (picked.length < 3 && rest.length) {
    picked.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
  }
  return picked.sort((a, b) => a.difficulty - b.difficulty);
}

function buildTurnOrder(state: GameState, roundIndex: number, random: () => number): string[] {
  const eligible = activePlayers(state).filter((p) => p.drawsFromRound <= roundIndex);
  const ordered = [...eligible].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.userId);
  // Rotate the starting drawer per round so the same person doesn't always open.
  const shift = ordered.length ? Math.floor(random() * ordered.length) : 0;
  return [...ordered.slice(shift), ...ordered.slice(0, shift)];
}

function startChoosing(state: GameState, at: number, pool: WordEntry[], random: () => number): ReduceResult {
  const drawerId = state.turnOrder[state.turnIndex];
  const options = pickOptions(pool, state.usedWords, random);
  const next: GameState = {
    ...state,
    phase: 'choosing',
    drawerId,
    wordOptions: options,
    currentWord: null,
    mask: '',
    revealed: [],
    hintsGiven: 0,
    correctGuessers: [],
    chalkLeft: 1,
    turnGains: {},
    lastAnswer: null,
    turnCancelled: false,
    textReports: [],
    phaseStartedAt: at,
    phaseEndsAt: at + CHOOSE_SECONDS * 1000,
  };
  return { state: bump(next), effects: [{ type: 'word_options', userId: drawerId, options }] };
}

function startDrawing(state: GameState, choice: WordEntry, at: number): ReduceResult {
  const next: GameState = {
    ...state,
    phase: 'drawing',
    currentWord: choice.word,
    difficulty: choice.difficulty,
    wordOptions: null,
    mask: maskWord(choice.word, []),
    revealed: [],
    hintsGiven: 0,
    usedWords: [...state.usedWords, choice.word],
    phaseStartedAt: at,
    phaseEndsAt: at + state.settings.drawSeconds * 1000,
  };
  const withFeed = pushFeed(next, { userId: null, text: `${letterPositions(choice.word).length} chữ cái, độ khó ${choice.difficulty}`, kind: 'system', at });
  return { state: bump(withFeed), effects: state.drawerId ? [{ type: 'word', userId: state.drawerId, word: choice.word }] : [] };
}

function endTurn(state: GameState, at: number, cancelled: boolean): ReduceResult {
  const drawerId = state.drawerId;
  const correct = state.correctGuessers.length;
  const gains: Record<string, number> = { ...state.turnGains };
  let drawerPts = 0;
  if (drawerId && !cancelled) {
    drawerPts = drawerPoints(correct, state.settings.chalkLimited, state.chalkLeft);
    if (drawerPts > 0) gains[drawerId] = (gains[drawerId] ?? 0) + drawerPts;
  }
  const players = state.players.map((p) => (drawerPts > 0 && p.userId === drawerId ? { ...p, score: p.score + drawerPts } : p));
  const next: GameState = {
    ...state,
    players,
    phase: 'turn_end',
    lastAnswer: state.currentWord,
    turnGains: gains,
    turnCancelled: cancelled,
    mask: state.currentWord ? maskWord(state.currentWord, letterPositions(state.currentWord)) : state.mask,
    phaseStartedAt: at,
    phaseEndsAt: at + TURN_END_SECONDS * 1000,
  };
  const text = cancelled ? `Lượt bị hủy vì vẽ chữ. Đáp án: ${state.currentWord ?? '?'}` : `Hết lượt. Đáp án: ${state.currentWord ?? '?'}`;
  return { state: bump(pushFeed(next, { userId: null, text, kind: 'system', at })), effects: [{ type: 'sound', name: 'turn_end' }] };
}

function finishGame(state: GameState, at: number): ReduceResult {
  const ranked = [...activePlayers(state)].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  const next: GameState = {
    ...state,
    phase: 'ended',
    drawerId: null,
    currentWord: null,
    wordOptions: null,
    podium: ranked.slice(0, 3).map((p) => p.userId),
    phaseStartedAt: at,
    phaseEndsAt: at + 30_000,
  };
  return { state: bump(next), effects: [{ type: 'sound', name: 'win' }] };
}

function advance(state: GameState, at: number, pool: WordEntry[], random: () => number): ReduceResult {
  let turnIndex = state.turnIndex + 1;
  let roundIndex = state.roundIndex;
  let turnOrder = state.turnOrder.filter((id) => activePlayers(state).some((p) => p.userId === id));
  // Skip drawers who left mid-round.
  while (turnIndex < state.turnOrder.length && !turnOrder.includes(state.turnOrder[turnIndex])) turnIndex++;
  if (turnIndex >= state.turnOrder.length) {
    roundIndex += 1;
    if (roundIndex >= state.settings.rounds) return finishGame(state, at);
    turnOrder = buildTurnOrder(state, roundIndex, random);
    turnIndex = 0;
  } else {
    turnOrder = state.turnOrder;
  }
  if (activePlayers(state).length < MIN_PLAYERS) return toLobby(state, at, 'Không đủ người chơi, quay về sảnh.');
  if (turnOrder.length === 0) return finishGame(state, at);
  return startChoosing({ ...state, turnIndex, roundIndex, turnOrder }, at, pool, random);
}

function toLobby(state: GameState, at: number, reason: string): ReduceResult {
  const next: GameState = {
    ...createInitialState(state.settings),
    players: activePlayers(state).map((p) => ({ ...p, score: 0, drawsFromRound: 0 })),
    feed: state.feed,
    feedSeq: state.feedSeq,
    version: state.version,
  };
  return { state: bump(pushFeed(next, { userId: null, text: reason, kind: 'system', at })), effects: [] };
}

export function wordPool(settings: ChalkSettings, packs: Record<string, WordEntry[]>): WordEntry[] {
  const pool: WordEntry[] = [];
  for (const id of settings.packs) {
    if (id === 'onbai') pool.push(...settings.customWords);
    else pool.push(...(packs[id] ?? []));
  }
  return pool.length ? pool : packs['sinhvien'] ?? [];
}

// --- reducer -------------------------------------------------------------------------------------

export function reduce(state: GameState, event: EngineEvent, packs: Record<string, WordEntry[]>): ReduceResult {
  const pool = () => wordPool(state.settings, packs);
  const noop: ReduceResult = { state, effects: [] };

  switch (event.type) {
    case 'join': {
      const existing = state.players.find((p) => p.userId === event.userId);
      if (existing && !existing.left) return noop;
      if (!existing && activePlayers(state).length >= MAX_PLAYERS) return noop;
      const drawsFromRound = state.phase === 'lobby' ? 0 : state.roundIndex + 1;
      const players = existing
        ? state.players.map((p) => (p.userId === event.userId ? { ...p, left: false, drawsFromRound: Math.max(p.drawsFromRound, drawsFromRound) } : p))
        : [...state.players, { userId: event.userId, joinedAt: event.at, score: 0, drawsFromRound, left: false }];
      return { state: bump({ ...state, players }), effects: [] };
    }

    case 'leave': {
      if (!state.players.some((p) => p.userId === event.userId && !p.left)) return noop;
      const players = state.players.map((p) => (p.userId === event.userId ? { ...p, left: true } : p));
      let next: GameState = { ...state, players };
      if (state.phase === 'lobby' || state.phase === 'ended') return { state: bump(next), effects: [] };
      if (activePlayers(next).length < MIN_PLAYERS) return toLobby(next, event.at, 'Chỉ còn một người, đợi thêm bạn nhé.');
      if ((state.phase === 'drawing' || state.phase === 'choosing') && state.drawerId === event.userId) {
        next = pushFeed(next, { userId: null, text: 'Người vẽ đã rời phòng.', kind: 'system', at: event.at });
        return endTurn(next, event.at, false);
      }
      if (state.phase === 'drawing' && allGuessed(next)) return endTurn(next, event.at, false);
      return { state: bump(next), effects: [] };
    }

    case 'settings': {
      if (event.userId !== event.hostId || state.phase !== 'lobby') return noop;
      const s = event.settings;
      const settings: ChalkSettings = {
        rounds: clampInt(s.rounds ?? state.settings.rounds, 1, 5),
        drawSeconds: [40, 60, 90].includes(s.drawSeconds ?? -1) ? (s.drawSeconds as number) : state.settings.drawSeconds,
        chalkLimited: s.chalkLimited ?? state.settings.chalkLimited,
        packs: s.packs && s.packs.length ? s.packs : state.settings.packs,
        customWords: s.customWords ?? state.settings.customWords,
      };
      return { state: bump({ ...state, settings }), effects: [] };
    }

    case 'start':
    case 'restart': {
      if (event.userId !== event.hostId) return noop;
      if (event.type === 'start' && state.phase !== 'lobby') return noop;
      if (event.type === 'restart' && state.phase !== 'ended') return noop;
      if (activePlayers(state).length < MIN_PLAYERS) return noop;
      const fresh: GameState = {
        ...createInitialState(state.settings),
        players: activePlayers(state).map((p) => ({ ...p, score: 0, drawsFromRound: 0 })),
        feedSeq: state.feedSeq,
        version: state.version,
      };
      const turnOrder = buildTurnOrder(fresh, 0, event.random);
      const started = pushFeed({ ...fresh, turnOrder, roundIndex: 0, turnIndex: 0 }, { userId: null, text: 'Bắt đầu! Phấn đã sẵn sàng.', kind: 'system', at: event.at });
      const result = startChoosing(started, event.at, wordPool(fresh.settings, packs), event.random);
      return { ...result, effects: [...result.effects, { type: 'sound', name: 'start' }] };
    }

    case 'cancel': {
      if (event.userId !== event.hostId) return noop;
      return toLobby(state, event.at, 'Chủ phòng đã dừng ván này.');
    }

    case 'pick_word': {
      if (state.phase !== 'choosing' || event.userId !== state.drawerId || !state.wordOptions) return noop;
      const choice = state.wordOptions[event.index] ?? state.wordOptions[1] ?? state.wordOptions[0];
      if (!choice) return noop;
      return startDrawing(state, choice, event.at);
    }

    case 'guess': {
      if (state.phase !== 'drawing' || !state.currentWord) return noop;
      const player = state.players.find((p) => p.userId === event.userId && !p.left);
      if (!player) return noop;
      if (event.userId === state.drawerId) return { state, effects: [{ type: 'guess_blocked', userId: event.userId, reason: 'Người vẽ không được đoán.' }] };
      if (state.correctGuessers.some((g) => g.userId === event.userId)) {
        return { state, effects: [{ type: 'guess_blocked', userId: event.userId, reason: 'Bạn đoán đúng rồi, cổ vũ bạn khác nhé.' }] };
      }
      const text = event.text.trim().slice(0, 60);
      if (!text) return noop;
      const guess = normalize(text);
      const answer = normalize(state.currentWord);
      if (!guess) return noop;
      if (guess === answer) {
        const total = state.settings.drawSeconds * 1000;
        const timeLeft = Math.max(0, state.phaseEndsAt - event.at);
        const isFirst = state.correctGuessers.length === 0;
        const points = guesserPoints(timeLeft, total, state.difficulty, isFirst);
        const players = state.players.map((p) => (p.userId === event.userId ? { ...p, score: p.score + points } : p));
        let next: GameState = {
          ...state,
          players,
          correctGuessers: [...state.correctGuessers, { userId: event.userId, at: event.at, elapsedMs: Math.max(0, event.at - state.phaseStartedAt), points }],
          turnGains: { ...state.turnGains, [event.userId]: (state.turnGains[event.userId] ?? 0) + points },
        };
        next = pushFeed(next, { userId: event.userId, text: `đoán đúng! +${points}`, kind: 'correct', at: event.at });
        const effects: Effect[] = [{ type: 'sound', name: 'correct' }];
        if (allGuessed(next)) {
          const ended = endTurn(next, event.at, false);
          return { state: ended.state, effects: [...effects, ...ended.effects] };
        }
        return { state: bump(next), effects };
      }
      // Don't leak the answer through a guess that contains it.
      if (answer.length >= 3 && guess.includes(answer)) {
        return { state, effects: [{ type: 'guess_blocked', userId: event.userId, reason: 'Câu đoán chứa đáp án nên không được gửi.' }] };
      }
      const close = answer.length >= 3 && levenshtein(guess, answer) === 1;
      if (close) return { state, effects: [{ type: 'close_call', userId: event.userId }] };
      return { state: bump(pushFeed(state, { userId: event.userId, text, kind: 'guess', at: event.at })), effects: [] };
    }

    case 'chalk': {
      if (state.phase !== 'drawing' || event.userId !== state.drawerId) return noop;
      const left = Math.max(0, Math.min(1, event.left));
      if (Math.abs(left - state.chalkLeft) < 0.005) return noop;
      return { state: { ...state, chalkLeft: left }, effects: [] };
    }

    case 'report_text': {
      if (state.phase !== 'drawing' || event.userId === state.drawerId) return noop;
      if (state.textReports.includes(event.userId)) return noop;
      const reports = [...state.textReports, event.userId];
      const guessers = activePlayers(state).filter((p) => p.userId !== state.drawerId).length;
      const next = { ...state, textReports: reports };
      if (reports.length > guessers / 2) return endTurn(next, event.at, true);
      return { state: bump(next), effects: [] };
    }

    case 'tick': {
      const at = event.at;
      if (state.phase === 'choosing' && at >= state.phaseEndsAt) {
        const choice = state.wordOptions?.[1] ?? state.wordOptions?.[0];
        return choice ? startDrawing(state, choice, at) : advance(state, at, pool(), event.random);
      }
      if (state.phase === 'drawing') {
        if (at >= state.phaseEndsAt) return endTurn(state, at, false);
        const total = state.phaseEndsAt - state.phaseStartedAt;
        const elapsed = at - state.phaseStartedAt;
        const word = state.currentWord ?? '';
        const letters = letterPositions(word);
        const maxHints = letters.length <= 4 ? 1 : 2;
        const due = elapsed >= total * 0.75 ? 2 : elapsed >= total * 0.5 ? 1 : 0;
        if (Math.min(due, maxHints) > state.hintsGiven) {
          const hidden = letters.filter((i) => !state.revealed.includes(i));
          if (hidden.length <= 1) return noop; // never give the whole word away
          const pick = hidden[Math.floor(event.random() * hidden.length)];
          const revealed = [...state.revealed, pick];
          return { state: bump({ ...state, revealed, mask: maskWord(word, revealed), hintsGiven: state.hintsGiven + 1 }), effects: [] };
        }
        return noop;
      }
      if (state.phase === 'turn_end' && at >= state.phaseEndsAt) return advance(state, at, pool(), event.random);
      return noop;
    }

    default:
      return noop;
  }
}

function allGuessed(state: GameState): boolean {
  const guessers = activePlayers(state).filter((p) => p.userId !== state.drawerId);
  return guessers.length > 0 && guessers.every((p) => state.correctGuessers.some((g) => g.userId === p.userId));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
