import { PlayerEmitter, loadScriptOnce } from './PlayerAdapter';
import type { LoadableTrack, PlayerAdapter, PlayerErrorInfo, PlayerEvent, PlayerHandlerMap } from './PlayerAdapter';

/* Minimal typings for the parts of the YouTube IFrame Player API we use. */
interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  getPlayerState(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiReady) return apiReady;
  apiReady = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API missing'));
    };
    loadScriptOnce('https://www.youtube.com/iframe_api').catch(reject);
  });
  return apiReady;
}

export class YouTubeAdapter implements PlayerAdapter {
  readonly provider = 'youtube' as const;
  readonly capabilities = { volume: true, rate: true };
  private emitter = new PlayerEmitter();
  private player: YTPlayer | null = null;
  private ready: Promise<void> | null = null;
  private pendingVolume = 1;
  private lastState = -1;

  async mount(container: HTMLElement): Promise<void> {
    if (this.ready) return this.ready;
    const YT = await loadYouTubeApi();
    const target = document.createElement('div');
    container.appendChild(target);
    this.ready = new Promise<void>((resolve) => {
      this.player = new YT.Player(target, {
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            this.player?.setVolume(Math.round(this.pendingVolume * 100));
            this.emitter.emit('ready');
            resolve();
          },
          onStateChange: (e) => {
            const state = e.data;
            if (state === this.lastState) return;
            this.lastState = state;
            if (state === YT.PlayerState.PLAYING) {
              this.emitter.emit('duration');
              this.emitter.emit('play');
            } else if (state === YT.PlayerState.PAUSED) this.emitter.emit('pause');
            else if (state === YT.PlayerState.ENDED) this.emitter.emit('ended');
            else if (state === YT.PlayerState.CUED) this.emitter.emit('duration');
          },
          onError: (e) => {
            const info: PlayerErrorInfo =
              e.data === 101 || e.data === 150
                ? { code: 'embed_blocked', message: 'Video này không cho phát ngoài YouTube.' }
                : e.data === 100
                  ? { code: 'not_found', message: 'Video không tồn tại hoặc đã bị ẩn.' }
                  : { code: 'unknown', message: 'YouTube không phát được video này.' };
            this.emitter.emit('error', info);
          },
        },
      });
    });
    return this.ready;
  }

  async load(track: LoadableTrack, autoplay: boolean): Promise<void> {
    await this.ready;
    if (!this.player) return;
    this.lastState = -1;
    const opts = { videoId: track.provider_id, startSeconds: Math.max(0, Math.floor(track.start_ms / 1000)) };
    if (autoplay) this.player.loadVideoById(opts);
    else this.player.cueVideoById(opts);
  }

  play(): void {
    this.player?.playVideo();
  }
  pause(): void {
    this.player?.pauseVideo();
  }
  seek(ms: number): void {
    this.player?.seekTo(Math.max(0, ms / 1000), true);
  }
  async getPosition(): Promise<number> {
    const seconds = this.player?.getCurrentTime?.();
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  getDuration(): number | null {
    const seconds = this.player?.getDuration?.();
    return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : null;
  }
  setVolume(volume: number): void {
    this.pendingVolume = volume;
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }
  setRate(rate: number): void {
    this.player?.setPlaybackRate(rate);
  }
  on<E extends PlayerEvent>(event: E, handler: PlayerHandlerMap[E]): () => void {
    return this.emitter.on(event, handler as unknown as (arg?: unknown) => void);
  }
  destroy(): void {
    try {
      this.player?.destroy();
    } catch {
      // the iframe may already be gone
    }
    this.player = null;
    this.ready = null;
    this.emitter.clear();
  }
}
