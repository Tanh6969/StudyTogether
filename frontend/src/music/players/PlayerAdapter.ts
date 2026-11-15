import type { MusicProvider } from '../../lib/activity.types';

/**
 * The one abstraction useMusicSync talks to (docs/design/hoat-dong-trong-call.md §3.9).
 * Each provider's embedded player (YouTube IFrame API, SoundCloud Widget API, Spotify Embed
 * iFrame API) is wrapped so playback control, position polling and events look the same.
 * Positions are milliseconds; volume is 0..1.
 */

export type PlayerEvent = 'ready' | 'play' | 'pause' | 'ended' | 'error' | 'duration';

export interface PlayerErrorInfo {
  /** 'embed_blocked' = the owner disallows playback outside the site; 'not_found'; 'unknown'. */
  code: 'embed_blocked' | 'not_found' | 'unknown';
  message: string;
}

export interface PlayerCapabilities {
  volume: boolean;
  /** playbackRate nudging for sub-2 s drift correction. */
  rate: boolean;
}

export interface LoadableTrack {
  provider: MusicProvider;
  provider_id: string;
  start_ms: number;
}

export interface PlayerAdapter {
  readonly provider: MusicProvider;
  readonly capabilities: PlayerCapabilities;
  /** Create the embedded player inside `container` (idempotent). */
  mount(container: HTMLElement): Promise<void>;
  /** Load a track; resolves once the player accepted it (not necessarily playing). */
  load(track: LoadableTrack, autoplay: boolean): Promise<void>;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  /** Current position in ms; may be slightly stale for widget players that report async. */
  getPosition(): Promise<number>;
  getDuration(): number | null;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  on<E extends PlayerEvent>(event: E, handler: PlayerHandlerMap[E]): () => void;
  destroy(): void;
}

export interface PlayerHandlerMap {
  ready: () => void;
  play: () => void;
  pause: () => void;
  ended: () => void;
  duration: () => void;
  error: (info: PlayerErrorInfo) => void;
}

/** Shared tiny emitter so the three adapters don't each reinvent it. */
export class PlayerEmitter {
  private handlers = new Map<PlayerEvent, Set<(arg?: unknown) => void>>();

  on(event: PlayerEvent, handler: (arg?: unknown) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit(event: PlayerEvent, arg?: unknown): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(arg);
      } catch (err) {
        console.error('[music] player handler failed', err);
      }
    });
  }

  clear(): void {
    this.handlers.clear();
  }
}

const scriptPromises = new Map<string, Promise<void>>();

/** Load a third-party script once per page. */
export function loadScriptOnce(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromises.delete(src);
      reject(new Error(`Không tải được ${src}`));
    };
    document.head.appendChild(el);
  });
  scriptPromises.set(src, promise);
  return promise;
}
