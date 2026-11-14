import { playClap } from './clapSound';

/** The five cheer styles (see lib/rewards.ts), all synthesized -- nothing to download. Each
 * is under a second so a busy room never turns into noise. */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

function tone(ctx: AudioContext, master: GainNode, type: OscillatorType, freq: number, at: number, dur: number, peak: number, glideTo?: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function master(ctx: AudioContext, volume: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = volume;
  g.connect(ctx.destination);
  return g;
}

function playDrum() {
  const ctx = getContext();
  if (!ctx) return;
  const m = master(ctx, 0.7);
  const t = ctx.currentTime + 0.01;
  [0, 0.13, 0.26, 0.39].forEach((dt, i) => tone(ctx, m, 'sine', 160, t + dt, 0.14, i === 3 ? 1 : 0.7, 55));
  tone(ctx, m, 'sine', 120, t + 0.56, 0.32, 1, 40);
}

function playFanfare() {
  const ctx = getContext();
  if (!ctx) return;
  const m = master(ctx, 0.25);
  const t = ctx.currentTime + 0.01;
  const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
  notes.forEach((f, i) => tone(ctx, m, 'sawtooth', f, t + i * 0.11, 0.12, 0.8));
  tone(ctx, m, 'sawtooth', 1046.5, t + 0.33, 0.45, 1); // C6, held
  tone(ctx, m, 'square', 523.25, t + 0.33, 0.45, 0.35);
}

function playSparkle() {
  const ctx = getContext();
  if (!ctx) return;
  const m = master(ctx, 0.3);
  const t = ctx.currentTime + 0.01;
  [1318.5, 1568, 2093].forEach((f, i) => {
    tone(ctx, m, 'triangle', f, t + i * 0.16, 0.5, 0.9);
    tone(ctx, m, 'sine', f * 2, t + i * 0.16, 0.25, 0.3);
  });
}

function playCrowd() {
  const ctx = getContext();
  if (!ctx) return;
  // A low roar under two rounds of applause.
  const m = master(ctx, 0.6);
  const length = Math.floor(ctx.sampleRate * 0.9);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const env = ctx.createGain();
  const t = ctx.currentTime + 0.01;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  src.connect(lp).connect(env).connect(m);
  src.start(t);
  src.stop(t + 0.95);
  playClap(0.6);
  window.setTimeout(() => playClap(0.5), 320);
}

export function playCheer(style: string | null | undefined): void {
  switch (style) {
    case 'drum':
      return playDrum();
    case 'fanfare':
      return playFanfare();
    case 'sparkle':
      return playSparkle();
    case 'crowd':
      return playCrowd();
    default:
      return playClap();
  }
}
