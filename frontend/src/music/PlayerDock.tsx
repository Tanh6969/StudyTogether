import { useCallback, useLayoutEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface PlayerDockProps {
  /** Receives the persistent element the embedded players live in. */
  attachContainer: (el: HTMLElement | null) => void;
  /** The Nhạc panel's player box (full video). */
  panelSlot: HTMLElement | null;
  /** The mini player's round artwork (tiny, non-interactive). */
  miniSlot: HTMLElement | null;
  /** No music session: keep the element mounted but invisible. */
  hidden: boolean;
}

/**
 * The embedded players (YouTube / SoundCloud / Spotify iframes) must never be re-parented, or
 * playback restarts. So they live in ONE fixed-position element laid over a slot: the Nhạc
 * panel's player box when that tab is open, otherwise the mini player's round artwork. With
 * neither visible (sidebar collapsed) it is parked off-screen and keeps playing. It never
 * floats freely over the call or the game.
 */
export function PlayerDock({ attachContainer, panelSlot, miniSlot, hidden }: PlayerDockProps) {
  const setRef = useCallback((el: HTMLDivElement | null) => attachContainer(el), [attachContainer]);
  const target = hidden ? null : panelSlot ?? miniSlot;
  const mode: 'panel' | 'mini' | 'parked' = !target ? 'parked' : target === panelSlot ? 'panel' : 'mini';
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const update = () => {
      const r = target.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(target);
    window.addEventListener('resize', update);
    const interval = window.setInterval(update, 400); // sidebar toggles and tab switches
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.clearInterval(interval);
    };
  }, [target]);

  const visible = mode !== 'parked' && !!rect && rect.width > 0 && rect.height > 0;
  const style: CSSProperties =
    !visible || !rect
      ? { position: 'fixed', width: 2, height: 2, left: -20, top: -20, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }
      : {
          position: 'fixed',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          zIndex: 11,
          overflow: 'hidden',
          background: '#000',
          borderRadius: mode === 'mini' ? '50%' : 10,
          pointerEvents: mode === 'mini' ? 'none' : 'auto',
        };

  return <div ref={setRef} aria-hidden={mode !== 'panel'} style={style} />;
}
