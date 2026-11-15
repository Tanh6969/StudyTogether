import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  drawerPoints,
  guesserPoints,
  levenshtein,
  maskWord,
  normalize,
  reduce,
  toPublic,
} from './engine';
import type { EngineEvent, GameState, WordEntry } from './engine';

const PACKS: Record<string, WordEntry[]> = {
  sinhvien: [
    { word: 'trà sữa', difficulty: 1 },
    { word: 'deadline', difficulty: 2 },
    { word: 'ký túc xá', difficulty: 3 },
    { word: 'mì tôm', difficulty: 1 },
    { word: 'laptop', difficulty: 2 },
    { word: 'đồ án', difficulty: 3 },
  ],
};
const r0 = () => 0;

function run(state: GameState, ...events: EngineEvent[]) {
  let s = state;
  const effects = [];
  for (const e of events) {
    const res = reduce(s, e, PACKS);
    s = res.state;
    effects.push(...res.effects);
  }
  return { state: s, effects };
}

function startedGame(players = ['a', 'b', 'c']) {
  const joins = players.map((userId, i) => ({ type: 'join' as const, userId, at: i }));
  return run(createInitialState(), ...joins, { type: 'start', userId: 'a', hostId: 'a', at: 1000, random: r0 });
}

describe('text helpers', () => {
  it('normalizes Vietnamese diacritics and case', () => {
    expect(normalize('  Trà   Sữa! ')).toBe('tra sua');
    expect(normalize('Đồ Án')).toBe('do an');
  });
  it('computes levenshtein distance', () => {
    expect(levenshtein('tra sua', 'tra sau')).toBe(2);
    expect(levenshtein('laptop', 'laptp')).toBe(1);
  });
  it('masks letters and keeps spaces', () => {
    expect(maskWord('mì tôm', [])).toBe('__ ___');
    expect(maskWord('mì tôm', [0])).toBe('m_ ___');
  });
});

describe('scoring', () => {
  it('rewards speed, difficulty and first guess', () => {
    expect(guesserPoints(60_000, 60_000, 1, false)).toBe(100);
    expect(guesserPoints(0, 60_000, 1, false)).toBe(40);
    expect(guesserPoints(30_000, 60_000, 3, true)).toBe(Math.round(70 * 1.5) + 15);
  });
  it('caps drawer points and adds the frugal bonus', () => {
    expect(drawerPoints(0, true, 1)).toBe(0);
    expect(drawerPoints(2, true, 0.5)).toBe(40);
    expect(drawerPoints(2, true, 0.3)).toBe(30);
    expect(drawerPoints(9, false, 1)).toBe(90);
  });
});

describe('game flow', () => {
  it('needs two players and the host to start', () => {
    const solo = run(createInitialState(), { type: 'join', userId: 'a', at: 0 }, { type: 'start', userId: 'a', hostId: 'a', at: 1, random: r0 });
    expect(solo.state.phase).toBe('lobby');
    const notHost = run(
      createInitialState(),
      { type: 'join', userId: 'a', at: 0 },
      { type: 'join', userId: 'b', at: 1 },
      { type: 'start', userId: 'b', hostId: 'a', at: 2, random: r0 }
    );
    expect(notHost.state.phase).toBe('lobby');
  });

  it('starts by offering the drawer three words, secretly', () => {
    const { state, effects } = startedGame();
    expect(state.phase).toBe('choosing');
    const offer = effects.find((e) => e.type === 'word_options');
    expect(offer && offer.type === 'word_options' && offer.userId).toBe(state.drawerId);
    expect(offer && offer.type === 'word_options' && offer.options).toHaveLength(3);
    expect('currentWord' in toPublic(state)).toBe(false);
    expect('wordOptions' in toPublic(state)).toBe(false);
  });

  it('scores a correct guess and ends the turn when everyone got it', () => {
    let { state } = startedGame(['a', 'b']);
    const drawer = state.drawerId!;
    const guesser = drawer === 'a' ? 'b' : 'a';
    ({ state } = run(state, { type: 'pick_word', userId: drawer, index: 0, at: 2000 }));
    expect(state.phase).toBe('drawing');
    const word = state.currentWord!;
    ({ state } = run(state, { type: 'guess', userId: guesser, text: word.toUpperCase(), at: 2000 }));
    expect(state.phase).toBe('turn_end');
    const guesserScore = state.players.find((p) => p.userId === guesser)!.score;
    const drawerScore = state.players.find((p) => p.userId === drawer)!.score;
    expect(guesserScore).toBeGreaterThan(100);
    expect(drawerScore).toBe(15 + 0); // one correct guesser, no frugal bonus (needs 2)
  });

  it('flags a near miss privately and blocks guesses containing the answer', () => {
    let { state } = startedGame(['a', 'b', 'c']);
    const drawer = state.drawerId!;
    const guesser = ['a', 'b', 'c'].find((p) => p !== drawer)!;
    ({ state } = run(state, { type: 'pick_word', userId: drawer, index: 1, at: 2000 }));
    const word = state.currentWord!;
    const near = word.slice(0, -1);
    const res = reduce(state, { type: 'guess', userId: guesser, text: near, at: 2100 }, PACKS);
    expect(res.effects.some((e) => e.type === 'close_call')).toBe(true);
    expect(res.state.feed.some((f) => f.text === near)).toBe(false);
    const leak = reduce(state, { type: 'guess', userId: guesser, text: `là ${word} đó`, at: 2100 }, PACKS);
    expect(leak.effects.some((e) => e.type === 'guess_blocked')).toBe(true);
  });

  it('reveals at most two letters and never the whole word', () => {
    let { state } = startedGame(['a', 'b']);
    ({ state } = run(state, { type: 'pick_word', userId: state.drawerId!, index: 2, at: 0 }));
    const total = state.phaseEndsAt - state.phaseStartedAt;
    ({ state } = run(state, { type: 'tick', at: total * 0.5, random: r0 }, { type: 'tick', at: total * 0.8, random: r0 }, { type: 'tick', at: total * 0.9, random: r0 }));
    expect(state.revealed.length).toBe(2);
    expect(state.mask).toContain('_');
  });

  it('times out turns and finishes after the configured rounds', () => {
    let { state } = run(
      createInitialState({ rounds: 1 }),
      { type: 'join', userId: 'a', at: 0 },
      { type: 'join', userId: 'b', at: 1 },
      { type: 'start', userId: 'a', hostId: 'a', at: 0, random: r0 }
    );
    let at = 0;
    for (let i = 0; i < 10 && state.phase !== 'ended'; i++) {
      at = state.phaseEndsAt + 1;
      ({ state } = run(state, { type: 'tick', at, random: r0 }));
    }
    expect(state.phase).toBe('ended');
    expect(state.podium).toHaveLength(2);
  });

  it('returns to the lobby when only one player is left', () => {
    let { state } = startedGame(['a', 'b']);
    ({ state } = run(state, { type: 'leave', userId: 'b', at: 5000 }));
    expect(state.phase).toBe('lobby');
  });

  it('cancels a turn when most guessers report drawing text', () => {
    let { state } = startedGame(['a', 'b', 'c']);
    const drawer = state.drawerId!;
    ({ state } = run(state, { type: 'pick_word', userId: drawer, index: 0, at: 0 }));
    const others = ['a', 'b', 'c'].filter((p) => p !== drawer);
    ({ state } = run(state, { type: 'report_text', userId: others[0], at: 10 }));
    expect(state.phase).toBe('drawing');
    ({ state } = run(state, { type: 'report_text', userId: others[1], at: 20 }));
    expect(state.phase).toBe('turn_end');
    expect(state.turnCancelled).toBe(true);
  });

  it('lets a mid-game joiner guess but not draw until the next round', () => {
    let { state } = startedGame(['a', 'b']);
    ({ state } = run(state, { type: 'join', userId: 'z', at: 3000 }));
    const z = state.players.find((p) => p.userId === 'z')!;
    expect(z.drawsFromRound).toBe(1);
    expect(state.turnOrder).not.toContain('z');
  });
});
