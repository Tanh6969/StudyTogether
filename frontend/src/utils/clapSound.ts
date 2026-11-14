/** Short synthesized applause (no audio asset to ship): a handful of band-passed noise bursts
 * with slightly randomised timing and pitch, about 0.6s long. Safe to call repeatedly --
 * the AudioContext is created once, lazily, from a user gesture or an incoming event. */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

let noiseBuffer: AudioBuffer | null = null;

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

export function playClap(volume = 0.5): void {
  const ctx = getContext();
  if (!ctx) return;
  const noise = getNoise(ctx);
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ctx.destination);

  const start = ctx.currentTime + 0.01;
  const bursts = 7;
  for (let i = 0; i < bursts; i += 1) {
    const at = start + i * 0.075 + Math.random() * 0.03;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600 + Math.random() * 900;
    filter.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.9 - i * 0.07, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    source.connect(filter).connect(env).connect(master);
    source.start(at);
    source.stop(at + 0.08);
  }
}
