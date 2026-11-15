import { PlayerEmitter, loadScriptOnce } from './PlayerAdapter';
import type { LoadableTrack, PlayerAdapter, PlayerEvent, PlayerHandlerMap } from './PlayerAdapter';

/* Minimal typings for the Spotify Embed iFrame API. Playback for listeners who are not logged
 * in to Spotify Premium in this browser is a 30 s preview -- a platform limit, see the design
 * doc §3.2. No volume or rate control exists, so ducking and rate nudging are unavailable. */
interface SpotifyController {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(event: 'ready', cb: () => void): void;
  addListener(event: 'playback_update', cb: (e: { data: { position: number; duration: number; isPaused: boolean; isBuffering: boolean } }) => void): void;
}
interface SpotifyIFrameAPI {
  createController(
    el: HTMLElement,
    options: { uri?: string; width?: string | number; height?: string | number; theme?: string },
    cb: (controller: SpotifyController) => void
  ): void;
}
declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
  }
}

let apiReady: Promise<SpotifyIFrameAPI> | null = null;
function loadSpotifyApi(): Promise<SpotifyIFrameAPI> {
  if (apiReady) return apiReady;
  apiReady = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    const previous = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      previous?.(api);
      resolve(api);
    };
    loadScriptOnce('https://open.spotify.com/embed/iframe-api/v1').catch(reject);
  });
  return apiReady;
}

export class SpotifyAdapter implements PlayerAdapter {
  readonly provider = 'spotify' as const;
  readonly capabilities = { volume: false, rate: false };
  private emitter = new PlayerEmitter();
  private controller: SpotifyController | null = null;
  private ready: Promise<void> | null = null;
  private positionMs = 0;
  private durationMs: number | null = null;
  private paused = true;
  private pendingUri: string | null = null;

  async mount(container: HTMLElement): Promise<void> {
    if (this.ready) return this.ready;
    const api = await loadSpotifyApi();
    const target = document.createElement('div');
    container.appendChild(target);
    this.ready = new Promise<void>((resolve) => {
      api.createController(target, { width: '100%', height: '100%', uri: this.pendingUri ?? undefined }, (controller) => {
        this.controller = controller;
        controller.addListener('ready', () => {
          this.emitter.emit('ready');
          resolve();
        });
        controller.addListener('playback_update', (e) => {
          const { position, duration, isPaused } = e.data;
          this.positionMs = position;
          if (duration > 0 && duration !== this.durationMs) {
            this.durationMs = duration;
            this.emitter.emit('duration');
          }
          if (isPaused !== this.paused) {
            this.paused = isPaused;
            this.emitter.emit(isPaused ? 'pause' : 'play');
          }
          if (isPaused && duration > 0 && position >= duration - 500) this.emitter.emit('ended');
        });
      });
    });
    return this.ready;
  }

  async load(track: LoadableTrack, autoplay: boolean): Promise<void> {
    this.pendingUri = track.provider_id;
    await this.ready;
    if (!this.controller) return;
    this.durationMs = null;
    this.positionMs = 0;
    this.controller.loadUri(track.provider_id);
    if (track.start_ms > 0) this.controller.seek(track.start_ms / 1000);
    if (autoplay) this.controller.play();
  }

  play(): void {
    if (this.paused) this.controller?.resume();
  }
  pause(): void {
    if (!this.paused) this.controller?.pause();
  }
  seek(ms: number): void {
    this.positionMs = Math.max(0, ms);
    this.controller?.seek(Math.max(0, ms) / 1000);
  }
  async getPosition(): Promise<number> {
    return this.positionMs;
  }
  getDuration(): number | null {
    return this.durationMs;
  }
  setVolume(): void {
    // Not supported by the Spotify embed.
  }
  setRate(): void {
    // Not supported by the Spotify embed.
  }
  on<E extends PlayerEvent>(event: E, handler: PlayerHandlerMap[E]): () => void {
    return this.emitter.on(event, handler as unknown as (arg?: unknown) => void);
  }
  destroy(): void {
    try {
      this.controller?.destroy();
    } catch {
      // already gone
    }
    this.controller = null;
    this.ready = null;
    this.emitter.clear();
  }
}
