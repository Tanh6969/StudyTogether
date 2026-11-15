import { useCallback, useLayoutEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface PlayerDockProps {
  /** Receives the persistent element the embedded players live in. */
  attachContainer: (el: HTMLElement | null) => void;
  /** Element whose box the dock should cover (the panel's player slot); null = picture-in-picture. */
  target: HTMLElement | null;
  /** Hide entirely (no music activity). The element stays mounted so iframes survive. */
  hidden: boolean;
  /** Picture-in-picture position when there is no target. */
  pipBottom: number;
  pipRight: number;
}

/**
 * The embedded players (YouTube / SoundCloud / Spotify iframes) must never remount, or playback
 * restarts for that listener. So they live in ONE fixed-position element that is simply moved
 * and resized: over the Nhạc panel's player slot when it is visible, otherwise as a small
 * picture-in-picture box above the call controls. YouTube's terms want the player visible
 * while playing, which the pip box also satisfies.
 */
export function PlayerDock({ attachContainer, target, hidden, pipBottom, pipRight }: PlayerDockProps) {
  const setRef = useCallback((el: HTMLDivElement | null) => attachContainer(el), [attachContainer]);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const update = () => {
      const r = target.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(target);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const interval = window.setInterval(update, 500); // layout shifts the observers miss (sidebar toggles)
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearInterval(interval);
    };
  }, [target]);

  const style: CSSProperties = hidden
    ? { position: 'fixed', width: 1, height: 1, left: -10, top: -10, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }
    : rect
      ? { position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 15, borderRadius: 10, overflow: 'hidden', background: '#000' }
      : { position: 'fixed', bottom: pipBottom, right: pipRight, width: 176, height: 99, zIndex: 40, borderRadius: 10, overflow: 'hidden', background: '#000', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', border: '1px solid #334155' };

  return (
    <div
      ref={setRef}
      aria-hidden={hidden}
      style={style}
    />
  );
}
