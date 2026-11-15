import { useCallback, useEffect, useRef } from 'react';
import { chalkSounds } from './sounds';

/**
 * The chalkboard drawing surface (design §2.6 "Nét phấn"). Canvas 2D at a fixed 800x600 logical
 * size, scaled to the element and to devicePixelRatio. Strokes are stored with normalized
 * coordinates (0..1) so every screen size draws the same picture.
 *
 * Look: each stroke is drawn twice -- a solid core, then a thinner, jittered, translucent pass
 * that breaks the edge up like powdery chalk. While drawing, a few dust particles fall from the
 * chalk tip (local only, never sent over the network). The eraser paints the darker board tone
 * and leaves a faint smudge that fades out over a few seconds.
 */

export const BOARD_W = 800;
export const BOARD_H = 600;
const BOARD_BG = '#1f3b2d';
const ERASE_COLOR = '#1c3628';

export type ChalkTool = 'chalk' | 'erase';

export interface Stroke {
  id: string;
  by: string;
  tool: ChalkTool;
  color: string;
  width: number;
  /** Flattened normalized points: x0, y0, x1, y1, ... */
  pts: number[];
  /** Local timestamp the stroke finished (for eraser smudge fade); not sent. */
  doneAt?: number;
}

export interface ChalkCanvasProps {
  strokes: Stroke[];
  /** In-progress strokes from other people, keyed by stroke id. */
  live: Record<string, Stroke>;
  canDraw: boolean;
  tool: ChalkTool;
  color: string;
  width: number;
  /** 0..1 remaining chalk; drawing stops at 0 (eraser still works). */
  chalkLeft: number;
  chalkLimited: boolean;
  selfId: string;
  onMove: (stroke: Stroke) => void;
  onEnd: (stroke: Stroke) => void;
  onChalkUsed: (cost: number) => void;
}

/** Ink budget: length (logical px) x width. ~75% gets used by normal drawing in 60 s. */
export const CHALK_BUDGET = 52000;

interface Particle {
  x: number;
  y: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

function hashJitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, now: number) {
  if (s.pts.length < 2) return;
  const pts = s.pts;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.tool === 'erase') {
    ctx.strokeStyle = ERASE_COLOR;
    ctx.lineWidth = s.width;
    ctx.globalAlpha = 1;
    tracePath(ctx, pts, 0);
    ctx.stroke();
    // Smudge: a lighter haze that fades over 3 s.
    const age = s.doneAt ? now - s.doneAt : 0;
    const smudge = Math.max(0, 0.08 * (1 - age / 3000));
    if (smudge > 0.002) {
      ctx.strokeStyle = '#f4f1e8';
      ctx.globalAlpha = smudge;
      ctx.lineWidth = s.width * 0.9;
      tracePath(ctx, pts, 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.strokeStyle = s.color;
  ctx.globalAlpha = 0.92;
  ctx.lineWidth = s.width;
  tracePath(ctx, pts, 0);
  ctx.stroke();

  // Powder pass: thinner, translucent, jittered per point.
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(1, s.width * 0.6);
  tracePath(ctx, pts, 0.4);
  ctx.stroke();

  // Grain: a few darker specks punched along the stroke so it isn't a flat line.
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = BOARD_BG;
  const step = Math.max(2, Math.floor(16 / s.width)) * 2;
  for (let i = 0; i < pts.length; i += step) {
    const jx = hashJitter(i + s.width) * s.width * 0.8;
    const jy = hashJitter(i * 3 + s.width) * s.width * 0.8;
    ctx.fillRect(pts[i] * BOARD_W + jx, pts[i + 1] * BOARD_H + jy, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: number[], jitter: number) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] * BOARD_W + (jitter ? hashJitter(i) * jitter * 2 : 0);
    const y = pts[i + 1] * BOARD_H + (jitter ? hashJitter(i + 1) * jitter * 2 : 0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (pts.length === 2) ctx.lineTo(pts[0] * BOARD_W + 0.1, pts[1] * BOARD_H + 0.1);
}

export function strokeLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const dx = (pts[i] - pts[i - 2]) * BOARD_W;
    const dy = (pts[i + 1] - pts[i - 1]) * BOARD_H;
    len += Math.hypot(dx, dy);
  }
  return len;
}

export function ChalkCanvas(props: ChalkCanvasProps) {
  const { canDraw, tool, color, width, chalkLeft, chalkLimited, selfId, onMove, onEnd, onChalkUsed } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastLiveLenRef = useRef<Record<string, number>>({});
  const lastSentRef = useRef(0);
  const lastScratchRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const now = performance.now();
          ctx.setTransform(w / BOARD_W, 0, 0, h / BOARD_H, 0, 0);
          ctx.clearRect(0, 0, BOARD_W, BOARD_H);
          const p = propsRef.current;
          for (const s of p.strokes) drawStroke(ctx, s, now);
          for (const s of Object.values(p.live)) {
            drawStroke(ctx, s, now);
            // Dust from other people's chalk tips too.
            const prevLen = lastLiveLenRef.current[s.id] ?? 0;
            if (s.pts.length > prevLen && s.tool === 'chalk' && !reducedMotion) {
              spawnDust(s.pts[s.pts.length - 2] * BOARD_W, s.pts[s.pts.length - 1] * BOARD_H, s.color, 2);
            }
            lastLiveLenRef.current[s.id] = s.pts.length;
          }
          if (drawingRef.current) drawStroke(ctx, drawingRef.current, now);
          // Particles
          const parts = particlesRef.current;
          for (let i = parts.length - 1; i >= 0; i--) {
            const q = parts[i];
            q.life -= 16;
            q.y += q.vy;
            q.vy += 0.03;
            if (q.life <= 0) {
              parts.splice(i, 1);
              continue;
            }
            ctx.globalAlpha = Math.max(0, q.life / 500) * 0.8;
            ctx.fillStyle = q.color;
            ctx.fillRect(q.x, q.y, q.size, q.size);
          }
          ctx.globalAlpha = 1;
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const spawnDust = (x: number, y: number, c: string, count: number) => {
    const parts = particlesRef.current;
    for (let i = 0; i < count; i++) {
      parts.push({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 4, vy: 0.3 + Math.random() * 0.4, life: 500, size: 1 + Math.random() * 1.5, color: c });
    }
    if (parts.length > 300) parts.splice(0, parts.length - 300);
  };

  const toPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
  }, []);

  const outOfChalk = chalkLimited && tool === 'chalk' && chalkLeft <= 0;

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || outOfChalk) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toPoint(e);
    drawingRef.current = {
      id: `${selfId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      by: selfId,
      tool,
      color: tool === 'erase' ? ERASE_COLOR : color,
      width: tool === 'erase' ? 24 : width,
      pts: [x, y],
    };
    onMove(drawingRef.current);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = drawingRef.current;
    if (!s) return;
    const [x, y] = toPoint(e);
    const lx = s.pts[s.pts.length - 2];
    const ly = s.pts[s.pts.length - 1];
    const dist = Math.hypot((x - lx) * BOARD_W, (y - ly) * BOARD_H);
    if (dist < 1.5) return;
    if (s.tool === 'chalk' && chalkLimited) {
      const cost = dist * s.width;
      if (propsRef.current.chalkLeft - cost / CHALK_BUDGET <= 0) {
        onChalkUsed(cost);
        handleUp();
        return;
      }
      onChalkUsed(cost);
    }
    s.pts.push(x, y);
    if (s.tool === 'chalk' && !reducedMotion) spawnDust(x * BOARD_W, y * BOARD_H, s.color, 2 + Math.floor(Math.random() * 3));
    const now = performance.now();
    if (now - lastScratchRef.current > 60 && s.tool === 'chalk') {
      lastScratchRef.current = now;
      chalkSounds.scratch(Math.min(1, dist / 20));
    }
    if (now - lastSentRef.current > 33) {
      lastSentRef.current = now;
      onMove(s);
    }
  };

  const handleUp = () => {
    const s = drawingRef.current;
    if (!s) return;
    drawingRef.current = null;
    s.doneAt = performance.now();
    onEnd(s);
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label={canDraw ? 'Bảng vẽ, bạn đang cầm phấn' : 'Bảng vẽ'}
      role="img"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={(e) => {
        if (e.buttons === 0) handleUp();
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: 'none',
        cursor: canDraw ? (outOfChalk ? 'not-allowed' : tool === 'erase' ? 'cell' : 'crosshair') : 'default',
      }}
    />
  );
}
