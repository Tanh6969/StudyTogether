import { PlayerEmitter, loadScriptOnce } from './PlayerAdapter';
import type { LoadableTrack, PlayerAdapter, PlayerEvent, PlayerHandlerMap } from './PlayerAdapter';

/* Minimal typings for the SoundCloud Widget API. */
interface SCWidget {
  bind(event: string, cb: (data?: unknown) => void): void;
  unbind(event: string): void;
  load(url: string, options: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(volume: number): void;
  getPosition(cb: (ms: number) => void): void;
  getDuration(cb: (ms: number) => void): void;
}
interface SCNamespace {
  Widget: ((iframe: HTMLIFrameElement) => SCWidget) & {
    Events: { READY: string; PLAY: string; PAUSE: string; FINISH: string; ERROR: string; PLAY_PROGRESS: string };
  };
}
declare global {
  interface Window {
    SC?: SCNamespace;
  }
}

const WIDGET_OPTIONS = {
  visual: false,
  show_artwork: true,
  show_comments: false,
  show_user: true,
  show_teaser: false,
  sharing: false,
  download: false,
  buying: false,
  hide_related: true,
};

function widgetSrc(trackUrl: string, autoplay: boolean): string {
  const params = new URLSearchParams({ url: trackUrl, auto_play: String(autoplay), color: '#38bdf8' });
  for (const [k, v] of Object.entries(WIDGET_OPTIONS)) params.set(k, String(v));
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

/**
 * The widget only initialises reliably when its iframe starts with a real track URL, so the
 * iframe is created lazily on the first load(); later tracks reuse it through widget.load().
 */
export class SoundCloudAdapter implements PlayerAdapter {
  readonly provider = 'soundcloud' as const;
  readonly capabilities = { volume: true, rate: false };
  private emitter = new PlayerEmitter();
  private container: HTMLElement | null = null;
  private widget: SCWidget | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private durationMs: number | null = null;
  private positionMs = 0;
  private pendingVolume = 1;

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    await loadScriptOnce('https://w.soundcloud.com/player/api.js');
  }

  private bindAll(widget: SCWidget, SC: SCNamespace) {
    const E = SC.Widget.Events;
    widget.bind(E.PLAY, () => {
      widget.getDuration((ms) => {
        this.durationMs = ms || null;
        this.emitter.emit('duration');
      });
      this.emitter.emit('play');
    });
    widget.bind(E.PAUSE, () => this.emitter.emit('pause'));
    widget.bind(E.FINISH, () => this.emitter.emit('ended'));
    widget.bind(E.PLAY_PROGRESS, (data) => {
      const d = data as { currentPosition?: number } | undefined;
      if (d && typeof d.currentPosition === 'number') this.positionMs = d.currentPosition;
    });
    widget.bind(E.ERROR, () => this.emitter.emit('error', { code: 'unknown', message: 'SoundCloud không phát được bài này.' }));
  }

  private afterLoad(widget: SCWidget, track: LoadableTrack, autoplay: boolean) {
    widget.setVolume(Math.round(this.pendingVolume * 100));
    if (track.start_ms > 0) widget.seekTo(track.start_ms);
    if (autoplay) widget.play();
    widget.getDuration((ms) => {
      this.durationMs = ms || null;
      this.emitter.emit('duration');
    });
  }

  async load(track: LoadableTrack, autoplay: boolean): Promise<void> {
    const SC = window.SC;
    if (!SC || !this.container) throw new Error('SoundCloud widget API missing');
    this.durationMs = null;
    this.positionMs = track.start_ms;

    if (!this.iframe || !this.widget) {
      const iframe = document.createElement('iframe');
      iframe.allow = 'autoplay; encrypted-media';
      iframe.title = 'SoundCloud';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.src = widgetSrc(track.provider_id, autoplay);
      this.container.appendChild(iframe);
      this.iframe = iframe;
      const widget = SC.Widget(iframe);
      this.widget = widget;
      this.bindAll(widget, SC);
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          this.emitter.emit('error', { code: 'unknown', message: 'SoundCloud tải quá lâu, thử lại sau.' });
          resolve();
        }, 15000);
        widget.bind(SC.Widget.Events.READY, () => {
          window.clearTimeout(timer);
          this.afterLoad(widget, track, autoplay);
          this.emitter.emit('ready');
          resolve();
        });
      });
      return;
    }

    const widget = this.widget;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 15000);
      widget.load(track.provider_id, {
        ...WIDGET_OPTIONS,
        auto_play: autoplay,
        callback: () => {
          window.clearTimeout(timer);
          this.afterLoad(widget, track, autoplay);
          resolve();
        },
      });
    });
  }

  play(): void {
    this.widget?.play();
  }
  pause(): void {
    this.widget?.pause();
  }
  seek(ms: number): void {
    this.positionMs = Math.max(0, ms);
    this.widget?.seekTo(Math.max(0, ms));
  }
  getPosition(): Promise<number> {
    return new Promise((resolve) => {
      const widget = this.widget;
      if (!widget) return resolve(this.positionMs);
      let done = false;
      const timer = window.setTimeout(() => {
        if (!done) {
          done = true;
          resolve(this.positionMs);
        }
      }, 300);
      widget.getPosition((ms) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        this.positionMs = ms;
        resolve(ms);
      });
    });
  }
  getDuration(): number | null {
    return this.durationMs;
  }
  setVolume(volume: number): void {
    this.pendingVolume = volume;
    this.widget?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }
  setRate(): void {
    // The widget has no playback-rate control; drift beyond 2 s is corrected by seeking.
  }
  on<E extends PlayerEvent>(event: E, handler: PlayerHandlerMap[E]): () => void {
    return this.emitter.on(event, handler as unknown as (arg?: unknown) => void);
  }
  destroy(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.widget = null;
    this.emitter.clear();
  }
}
