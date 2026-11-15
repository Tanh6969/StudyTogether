import type { CSSProperties } from 'react';
import { frameById } from '../../lib/rewards';
import { FrameArt } from './frameArt';

interface FramedAvatarProps {
  size: number;
  initials: string;
  color: string;
  avatarUrl?: string | null;
  /** A frame id from lib/rewards.ts FRAMES, or null for no frame. */
  frame?: string | null;
  /** Alt text for the image; empty when the name is written right next to it. */
  alt?: string;
  style?: CSSProperties;
}

/** The one avatar everywhere a frame can be worn (video tile, session panel, member lists).
 * A frame is a CSS ring (`.avatar-frame--<id>` in index.css) plus, for the decorated ones,
 * an SVG layer that overflows the circle (frameArt.tsx). No image assets. */
export function FramedAvatar({ size, initials, color, avatarUrl, frame, alt = '', style }: FramedAvatarProps) {
  const def = frameById(frame);
  const pad = def ? Math.max(2, Math.round(size * 0.08)) : 0;
  const fontSize = Math.round(size * 0.38);
  return (
    <span className={`avatar-frame${def ? ` avatar-frame--${def.id}` : ''}`} style={{ width: size, height: size, ...style }}>
      <span className="avatar-frame-ring" style={{ padding: pad }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={alt} className="avatar-frame-inner" style={{ objectFit: 'cover' }} />
        ) : (
          <span aria-hidden className="avatar-frame-inner" style={{ background: color, fontSize }}>
            {initials}
          </span>
        )}
      </span>
      {def?.art && (
        <svg className="avatar-frame-art" viewBox="-30 -30 160 160" aria-hidden focusable="false">
          <FrameArt id={def.id} />
        </svg>
      )}
    </span>
  );
}
