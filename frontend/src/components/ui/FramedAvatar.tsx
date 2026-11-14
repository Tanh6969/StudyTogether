import type { CSSProperties } from 'react';

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
 * Frames are pure CSS (see index.css `.avatar-frame--*`), so unlocking one ships no asset. */
export function FramedAvatar({ size, initials, color, avatarUrl, frame, alt = '', style }: FramedAvatarProps) {
  const pad = frame ? Math.max(2, Math.round(size * 0.08)) : 0;
  const fontSize = Math.round(size * 0.38);
  return (
    <span
      className={`avatar-frame${frame ? ` avatar-frame--${frame}` : ''}`}
      style={{ width: size, height: size, padding: pad, ...style }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={alt} className="avatar-frame-inner" style={{ objectFit: 'cover' }} />
      ) : (
        <span aria-hidden className="avatar-frame-inner" style={{ background: color, fontSize }}>
          {initials}
        </span>
      )}
    </span>
  );
}
