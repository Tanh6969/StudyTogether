/** Phấn Trắng sounds, all synthesized with Web Audio (nothing to download), like cheerSounds.ts. */

let ctx: AudioContext | null = null;
const MUTE_KEY = 'studytogether.chalk.muted';

export function isChalkMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChalkMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // ignore
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || isChalkMuted()) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, at: number, dur: number, peak = 0.12, type: OscillatorType = 'triangle') {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + at);
  env.gain.setValueAtTime(0.0001, c.currentTime + at);
  env.gain.exponentialRampToValueAtTime(peak, c.currentTime + at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  osc.connect(env).connect(c.destination);
  osc.start(c.currentTime + at);
  osc.stop(c.currentTime + at + dur + 0.02);
}

function noise(at: number, dur: number, low: number, high: number, peak: number) {
  const c = audio();
  if (!c) return;
  const length = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = (low + high) / 2;
  band.Q.value = ((low + high) / 2) / Math.max(1, high - low);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, c.currentTime + at);
  env.gain.exponentialRampToValueAtTime(peak, c.currentTime + at + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  src.connect(band).connect(env).connect(c.destination);
  src.start(c.currentTime + at);
}

export const chalkSounds = {
  correct() {
    tone(523.25, 0, 0.12);
    tone(659.25, 0.1, 0.16);
  },
  closeCall() {
    tone(440, 0, 0.08, 0.06, 'sine');
  },
  tick() {
    noise(0, 0.04, 1800, 2600, 0.08);
  },
  turnEnd() {
    noise(0, 0.3, 200, 500, 0.12);
  },
  start() {
    tone(392, 0, 0.1);
    tone(523.25, 0.1, 0.1);
    tone(659.25, 0.2, 0.18);
  },
  scratch(intensity: number) {
    noise(0, 0.05, 2000, 4000, Math.min(0.05, 0.01 + intensity * 0.04));
  },
};
