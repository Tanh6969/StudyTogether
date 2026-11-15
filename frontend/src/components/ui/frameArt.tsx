/** SVG decorations that sit outside the avatar ring (Discord-style). The avatar occupies the
 * circle centred at (50,50) with radius 50 in a -30..130 viewBox; everything drawn here lives
 * in the margin around it. Two colours per frame, both set in CSS: `currentColor` and
 * `--frame-art-accent` (see index.css `.avatar-frame--<id>`), so no literal colour here.
 * Motion classes (`fa-flicker`, `fa-spin`, `fa-drift`, `fa-twinkle`, `fa-pulse`) animate only
 * transform/opacity and switch off under prefers-reduced-motion. */

const accent = { fill: 'var(--frame-art-accent)' } as const;
const accentStroke = { stroke: 'var(--frame-art-accent)' } as const;

function Flame({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) {
  return (
    <g className="fa-flicker" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 0 C-7 -6 -8 -14 -3 -20 C-2 -14 1 -12 2 -8 C5 -13 4 -17 3 -21 C9 -15 11 -8 6 -2 Z" fill="currentColor" />
      <path transform={`translate(${x} ${y}) scale(${s * 0.55})`} d="M0 0 C-5 -5 -5 -10 -2 -14 C-1 -10 1 -9 2 -6 C4 -9 3 -12 3 -14 C6 -10 7 -5 4 -1 Z" style={accent} />
    </g>
  );
}

export function FrameArt({ id }: { id: string }) {
  switch (id) {
    case 'inferno':
      return (
        <>
          <Flame x={14} y={28} s={1} delay={0} />
          <Flame x={30} y={12} s={1.25} delay={0.3} />
          <Flame x={50} y={4} s={1.5} delay={0.15} />
          <Flame x={70} y={12} s={1.25} delay={0.45} />
          <Flame x={86} y={28} s={1} delay={0.1} />
        </>
      );
    case 'dragon':
      return (
        <>
          {/* horns */}
          <path d="M22 18 C10 10 4 -4 10 -16 C14 -2 22 4 32 8 Z" fill="currentColor" />
          <path d="M78 18 C90 10 96 -4 90 -16 C86 -2 78 4 68 8 Z" fill="currentColor" />
          <path d="M14 10 C10 2 9 -6 11 -12 C13 -4 17 1 22 5 Z" style={accent} />
          <path d="M86 10 C90 2 91 -6 89 -12 C87 -4 83 1 78 5 Z" style={accent} />
          {/* scales along the bottom */}
          {[20, 35, 50, 65, 80].map((cx, i) => (
            <path key={cx} d={`M${cx - 8} 96 Q${cx} ${106 + (i % 2) * 3} ${cx + 8} 96`} fill="none" strokeWidth={3} strokeLinecap="round" style={accentStroke} />
          ))}
        </>
      );
    case 'void':
      return (
        <g className="fa-spin" style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}>
          <ellipse cx={50} cy={50} rx={66} ry={22} fill="none" stroke="currentColor" strokeWidth={2.5} opacity={0.85} />
          <circle cx={116} cy={50} r={4} style={accent} />
          <circle cx={-16} cy={50} r={2.5} style={accent} opacity={0.7} />
        </g>
      );
    case 'storm':
      return (
        <>
          {[
            { x: 50, y: -16, r: 0, d: 0 },
            { x: 102, y: 10, r: 42, d: 0.4 },
            { x: -2, y: 10, r: -42, d: 0.8 },
          ].map((b) => (
            <polygon
              key={b.r}
              className="fa-flicker-fast"
              style={{ animationDelay: `${b.d}s`, ...accent }}
              points="0,0 6,0 2,10 9,10 -2,26 1,13 -5,13"
              transform={`translate(${b.x} ${b.y}) rotate(${b.r} 0 0)`}
              stroke="currentColor"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          ))}
        </>
      );
    case 'frost':
      return (
        <>
          {[-70, -45, -20, 0, 20, 45, 70].map((deg, i) => (
            <polygon
              key={deg}
              points={`-4,0 0,${-14 - (i % 2) * 8} 4,0`}
              fill="currentColor"
              stroke="var(--frame-art-accent)"
              strokeWidth={0.8}
              transform={`rotate(${deg} 50 50) translate(50 2)`}
            />
          ))}
        </>
      );
    case 'neon':
      return (
        <g className="fa-spin-rev" style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}>
          <circle cx={50} cy={50} r={60} fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray="18 10" strokeLinecap="round" />
          <circle cx={50} cy={50} r={66} fill="none" strokeWidth={1.2} strokeDasharray="3 9" style={accentStroke} />
        </g>
      );
    case 'crown':
      return (
        <g transform="translate(50 -14) scale(1.3)">
          <path d="M-26 14 L-18 -6 L-7 8 L0 -14 L7 8 L18 -6 L26 14 Z" fill="currentColor" />
          <rect x={-26} y={14} width={52} height={7} rx={2} fill="currentColor" />
          <circle cx={0} cy={2} r={3.2} style={accent} />
          <circle cx={-15} cy={9} r={2.4} style={accent} />
          <circle cx={15} cy={9} r={2.4} style={accent} />
        </g>
      );
    case 'toxic':
      return (
        <>
          {[28, 50, 72].map((x, i) => (
            <path key={x} d={`M${x - 5} 92 Q${x - 5} ${104 + i * 4} ${x} ${106 + i * 4} Q${x + 5} ${104 + i * 4} ${x + 5} 92 Z`} fill="currentColor" />
          ))}
          {[{ x: 12, y: 24, r: 3, d: 0 }, { x: 90, y: 16, r: 4, d: 0.7 }, { x: 100, y: 46, r: 2.5, d: 1.3 }].map((b) => (
            <circle key={b.d} className="fa-rise" style={{ animationDelay: `${b.d}s`, ...accent }} cx={b.x} cy={b.y} r={b.r} />
          ))}
        </>
      );
    case 'bloodmoon':
      return (
        <>
          <path d="M98 2 A20 20 0 1 0 110 34 A14 14 0 1 1 98 2 Z" fill="currentColor" />
          {[36, 50, 64].map((x, i) => (
            <path key={x} d={`M${x - 3} 94 Q${x - 3} ${102 + i * 3} ${x} ${104 + i * 3} Q${x + 3} ${102 + i * 3} ${x + 3} 94 Z`} style={accent} />
          ))}
        </>
      );
    case 'galaxy':
      return (
        <>
          {[
            { x: 6, y: 8, s: 1, d: 0 },
            { x: 96, y: 4, s: 1.4, d: 0.6 },
            { x: 112, y: 60, s: 0.9, d: 1.1 },
            { x: -10, y: 56, s: 1.2, d: 0.3 },
            { x: 14, y: 102, s: 0.8, d: 1.6 },
            { x: 92, y: 100, s: 1.1, d: 0.9 },
          ].map((s) => (
            <path
              key={s.d}
              className="fa-twinkle"
              style={{ animationDelay: `${s.d}s`, transformOrigin: `${s.x}px ${s.y}px`, transformBox: 'view-box', ...accent }}
              transform={`translate(${s.x} ${s.y}) scale(${s.s})`}
              d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z"
            />
          ))}
        </>
      );
    case 'shadow':
      return (
        <>
          {[{ x: 4, d: 0 }, { x: 50, d: 1.2 }, { x: 96, d: 0.6 }].map((w) => (
            <path
              key={w.x}
              className="fa-drift"
              style={{ animationDelay: `${w.d}s` }}
              d={`M${w.x} 106 C${w.x - 16} 88 ${w.x + 18} 72 ${w.x} 50 C${w.x - 10} 66 ${w.x + 8} 80 ${w.x - 3} 96 Z`}
              fill="currentColor"
              opacity={0.75}
            />
          ))}
        </>
      );
    default:
      return null;
  }
}
