import type { Terrain } from '../../shared/types';

/**
 * Painted terrain for each tile.
 *
 * Two things do the heavy lifting. First, every tile seeds a small PRNG from its
 * own coordinates, so no two forests have their trees in the same place while the
 * board still renders identically for every player and on every reload. Second,
 * light always comes from the upper left: every object here has a lit face, a
 * shaded face and a shadow cast down and to the right. Consistent lighting is
 * what stops flat vector art reading as clipart.
 *
 * Features are drawn large on purpose. A hex is 120 units across and renders at
 * roughly 100 screen pixels, so anything under about 20 units disappears into
 * texture instead of reading as an object.
 */

/** Stable per-tile randomness: the same hex always paints the same picture. */
export function seedFrom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const n1 = (x: number) => x.toFixed(1);

/**
 * Scatter points inside the hex with a minimum separation, so features look
 * placed rather than sprinkled.
 */
function scatter(r: Rand, count: number, radius: number, minGap: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < count * 60 && points.length < count; attempt++) {
    const angle = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * radius;
    const p = { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.94 };
    if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minGap)) points.push(p);
  }
  return points;
}

const CAST = 'rgba(30,20,10,0.3)';

// ---------------------------------------------------------------- forest ---

function Conifer({ scale, hue }: { scale: number; hue: number }) {
  // hue 0 = near, saturated; 1 = distant, hazier and bluer.
  const lit = ['#4bb56b', '#63b98a'][hue];
  const mid = ['#25834a', '#3f8c66'][hue];
  const dark = ['#14563070', '#1d5a4270'][hue];
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="6" cy="23" rx="17" ry="5" fill={CAST} />
      <rect x="-3.4" y="12" width="6.8" height="13" rx="2.4" fill="#63401f" />
      <rect x="-3.4" y="12" width="3" height="13" rx="1.5" fill="#855a30" />
      {[
        { y: 16, w: 20, h: 20 },
        { y: 6, w: 16.5, h: 19 },
        { y: -4, w: 12.5, h: 18 },
      ].map((t, i) => (
        <g key={i}>
          <path d={`M0,${t.y - t.h} L${t.w},${t.y} q${-t.w},7 ${-t.w * 2},0 Z`} fill={mid} />
          <path d={`M0,${t.y - t.h} L${-t.w * 0.62},${t.y} q${t.w * 0.3},4 ${t.w * 0.62},2 Z`} fill={lit} />
          <path d={`M0,${t.y - t.h} L${t.w},${t.y} q${-t.w * 0.5},5 ${-t.w},3 Z`} fill={dark} />
        </g>
      ))}
    </g>
  );
}

function Forest({ r }: { r: Rand }) {
  const near = scatter(r, 6, 40, 24);
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#2a7b4b" />
      {/* Undergrowth: mottled patches so the floor is not one flat green. */}
      {Array.from({ length: 14 }, (_, i) => {
        const x = between(r, -52, 52);
        const y = between(r, -52, 52);
        const rad = between(r, 9, 20);
        return (
          <ellipse
            key={i}
            cx={n1(x)}
            cy={n1(y)}
            rx={n1(rad)}
            ry={n1(rad * 0.62)}
            fill={i % 2 ? '#20663d' : '#35915a'}
            opacity="0.5"
          />
        );
      })}
      {/* A back row of hazier trees gives the tile depth. */}
      {[-40, -14, 14, 40].map((x, i) => (
        <g key={i} transform={`translate(${x},${n1(between(r, -46, -34))})`}>
          <Conifer scale={between(r, 0.6, 0.78)} hue={1} />
        </g>
      ))}
      {near
        .sort((a, b) => a.y - b.y)
        .map((p, i) => (
          <g key={i} transform={`translate(${n1(p.x)},${n1(p.y + 4)})`}>
            <Conifer scale={between(r, 1.05, 1.45)} hue={0} />
          </g>
        ))}
    </g>
  );
}

// ---------------------------------------------------------------- fields ---

/** A bound sheaf: a fan of stalks with fat grain heads, tied at the waist. */
function Sheaf({ scale }: { scale: number }) {
  const stalks = [-16, -8, 0, 8, 16];
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="4" cy="19" rx="16" ry="4.5" fill={CAST} />
      {stalks.map((lean, i) => (
        <g key={i} transform={`rotate(${lean})`}>
          <path d="M0,18 C0,6 0,0 0,-10" stroke="#c9961f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <g transform="translate(0,-16)">
            <ellipse rx="4.6" ry="8" fill="#f2cf63" />
            <ellipse cx="1.6" rx="2.8" ry="7.4" fill="#cf9c22" />
            <ellipse cx="-1.4" cy="-1" rx="1.8" ry="5.6" fill="#ffe9a0" />
            {[-4, 0, 4].map((y) => (
              <path key={y} d={`M-4.4,${y} h8.8`} stroke="#b98615" strokeWidth="0.9" opacity="0.65" />
            ))}
          </g>
        </g>
      ))}
      <path d="M-7,6 q7,4 14,0" stroke="#8a6410" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Fields({ r }: { r: Rand }) {
  const bands = [-48, -26, -4, 18, 40];
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#e3b93f" />
      {bands.map((y, i) => (
        <g key={y}>
          <path
            d={`M-60,${y} q30,-8 60,0 q30,8 60,0 v22 q-30,8 -60,0 q-30,-8 -60,0 Z`}
            fill={i % 2 ? '#d8ab2e' : '#eec669'}
          />
        </g>
      ))}
      {bands.map((y) => (
        <path
          key={`f${y}`}
          d={`M-60,${y + 20} q30,-8 60,0 q30,8 60,0`}
          fill="none"
          stroke="#a97c10"
          strokeWidth="3"
          opacity="0.45"
        />
      ))}
      {[
        { x: -28, y: -30 },
        { x: 24, y: -20 },
        { x: -2, y: 2 },
        { x: -34, y: 22 },
        { x: 30, y: 24 },
        { x: 2, y: 44 },
      ].map((p, i) => (
        <g key={i} transform={`translate(${p.x},${p.y}) rotate(${n1(between(r, -8, 8))})`}>
          <Sheaf scale={between(r, 1.3, 1.65)} />
        </g>
      ))}
    </g>
  );
}

// --------------------------------------------------------------- pasture ---

function Sheep({ scale }: { scale: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="2" cy="12" rx="18" ry="5" fill={CAST} />
      <rect x="-9" y="3" width="4" height="10" rx="2" fill="#403d3a" />
      <rect x="4" y="3" width="4" height="10" rx="2" fill="#403d3a" />
      <g fill="#f6f2e8">
        <circle cx="-9" cy="-1" r="9" />
        <circle cx="0" cy="-5" r="9.6" />
        <circle cx="9" cy="-1" r="8.4" />
        <circle cx="0" cy="2" r="9.3" />
        <circle cx="-4.5" cy="-7" r="6.5" />
        <circle cx="4.5" cy="-7" r="6.5" />
      </g>
      <g fill="#d3cbb9">
        <circle cx="6.5" cy="4" r="6" />
        <circle cx="-2" cy="5.5" r="5.6" />
        <circle cx="-10" cy="3" r="4.6" />
      </g>
      <ellipse cx="14" cy="-6" rx="6" ry="5" fill="#514c47" />
      <ellipse cx="17.4" cy="-4.6" rx="2.4" ry="1.8" fill="#2f2c29" />
      <circle cx="16" cy="-7.4" r="1.1" fill="#15130f" />
      <ellipse cx="11" cy="-10.4" rx="2.8" ry="2" fill="#3d3935" transform="rotate(-28 11 -10.4)" />
    </g>
  );
}

function Pasture({ r }: { r: Rand }) {
  const flock = scatter(r, 3, 30, 38);
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#8dbf45" />
      {/* Rolling ground: overlapping bands, each lighter on its upper edge. */}
      {[-34, -6, 22, 48].map((y, i) => (
        <g key={y}>
          <path d={`M-60,${y} q30,-20 60,-4 q30,16 60,-6 v70 h-120 Z`} fill={i % 2 ? '#7fae3a' : '#96c94e'} />
          <path
            d={`M-60,${y} q30,-20 60,-4 q30,16 60,-6`}
            fill="none"
            stroke="#b4dd72"
            strokeWidth="3"
            opacity="0.55"
          />
        </g>
      ))}
      {Array.from({ length: 34 }, (_, i) => {
        const x = between(r, -54, 54);
        const y = between(r, -54, 54);
        const s = between(r, 3, 6);
        return (
          <path
            key={i}
            d={`M${n1(x)},${n1(y)} l${n1(-s * 0.7)},${n1(-s)} M${n1(x)},${n1(y)} l0,${n1(-s * 1.4)} M${n1(x)},${n1(y)} l${n1(s * 0.7)},${n1(-s)}`}
            stroke="#5f8f28"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            opacity="0.75"
          />
        );
      })}
      {flock
        .sort((a, b) => a.y - b.y)
        .map((p, i) => (
          <g key={i} transform={`translate(${n1(p.x)},${n1(p.y)})`}>
            <Sheep scale={between(r, 0.95, 1.25)} />
          </g>
        ))}
    </g>
  );
}

// ----------------------------------------------------------------- hills ---

/** A stack of fired bricks, with visible courses and mortar. */
function BrickStack({ scale }: { scale: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="4" cy="13" rx="24" ry="6" fill={CAST} />
      {[0, 1, 2, 3].map((row) => (
        <g key={row} transform={`translate(${row % 2 ? 6 : 0},${11 - row * 8})`}>
          {[-17, 1].map((x) => (
            <g key={x}>
              <rect x={x} y="-8" width="18" height="8" rx="1.4" fill="#a94c29" />
              <rect x={x} y="-8" width="18" height="3" rx="1.4" fill="#d67a4d" />
              <rect x={x + 12} y="-8" width="6" height="8" rx="1.4" fill="#6b2a12" opacity="0.6" />
              <rect x={x} y="-8" width="18" height="8" rx="1.4" fill="none" stroke="#54200e" strokeWidth="1.1" />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

function Hills({ r }: { r: Rand }) {
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#d07e48" />
      {/* A dug clay pit: each terrace is a lit lip over a shaded cut face. */}
      {[
        { y: -50, w: 60, top: '#f0ab72', face: '#c96f3f' },
        { y: -28, w: 52, top: '#e79f68', face: '#bd6436' },
        { y: -6, w: 43, top: '#dd9460', face: '#b05b2f' },
        { y: 16, w: 33, top: '#d18855', face: '#a25228' },
        { y: 38, w: 22, top: '#c67e4d', face: '#954a23' },
      ].map((t) => (
        <g key={t.y}>
          <path d={`M${-t.w},${t.y} q${t.w},-13 ${t.w * 2},0 v22 q${-t.w},13 ${-t.w * 2},0 Z`} fill={t.face} />
          <path
            d={`M${-t.w},${t.y} q${t.w},-13 ${t.w * 2},0`}
            fill="none"
            stroke={t.top}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d={`M${-t.w},${t.y + 21} q${t.w},-13 ${t.w * 2},0`}
            fill="none"
            stroke="#61290f"
            strokeWidth="3"
            opacity="0.4"
          />
        </g>
      ))}
      {/* Wet clay at the bottom of the cut. */}
      <ellipse cy="52" rx="20" ry="8" fill="#7a3717" opacity="0.7" />
      <ellipse cx="-4" cy="50" rx="11" ry="4" fill="#a8542b" opacity="0.6" />
      <g transform={`translate(-28,-26) rotate(${n1(between(r, -6, 6))})`}>
        <BrickStack scale={between(r, 0.85, 1)} />
      </g>
      <g transform={`translate(26,20) rotate(${n1(between(r, -6, 6))})`}>
        <BrickStack scale={between(r, 1.05, 1.25)} />
      </g>
    </g>
  );
}

// ------------------------------------------------------------- mountains ---

function Peak({ x, base, w, h, snow }: { x: number; base: number; w: number; h: number; snow: number }) {
  const apex = base - h;
  const snowY = apex + h * snow;
  const snowW = w * snow;
  return (
    <g transform={`translate(${x},0)`}>
      <path d={`M0,${apex} L${w},${base} L${-w},${base} Z`} fill="#93a2b0" />
      <path d={`M0,${apex} L${w},${base} L0,${base} Z`} fill="#5d6a78" />
      <path d={`M0,${apex} L${-w * 0.42},${base} L0,${base} Z`} fill="#b3c0cb" opacity="0.85" />
      <path
        d={`M0,${apex} L${snowW},${snowY} q${-snowW * 0.4},${h * 0.1} ${-snowW * 0.75},${-h * 0.03} q${-snowW * 0.45},${h * 0.09} ${-snowW * 1.25},${h * 0.03} Z`}
        fill="#f4f8fb"
      />
      <path d={`M0,${apex} L${snowW},${snowY} L0,${snowY + h * 0.05} Z`} fill="#c9d7e2" />
      <path
        d={`M${-w * 0.5},${base} L${-w * 0.14},${apex + h * 0.5}`}
        stroke="#76848f"
        strokeWidth="2.2"
        fill="none"
        opacity="0.65"
      />
      <path
        d={`M${w * 0.55},${base} L${w * 0.18},${apex + h * 0.42}`}
        stroke="#48545f"
        strokeWidth="2.2"
        fill="none"
        opacity="0.55"
      />
    </g>
  );
}

function Mountains({ r }: { r: Rand }) {
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#7f8d9a" />
      <path d="M-60,26 q30,-14 60,-4 q30,10 60,-6 v50 h-120 Z" fill="#6a7885" />
      <Peak x={-30} base={44} w={31} h={72} snow={between(r, 0.3, 0.4)} />
      <Peak x={30} base={48} w={29} h={62} snow={between(r, 0.26, 0.36)} />
      <Peak x={-1} base={54} w={37} h={92} snow={between(r, 0.26, 0.34)} />
      {Array.from({ length: 10 }, (_, i) => {
        const x = between(r, -54, 54);
        const y = between(r, 44, 58);
        const s = between(r, 3, 6.5);
        return (
          <g key={i}>
            <ellipse cx={n1(x + 1)} cy={n1(y + s * 0.5)} rx={n1(s * 1.2)} ry={n1(s * 0.4)} fill={CAST} />
            <ellipse cx={n1(x)} cy={n1(y)} rx={n1(s)} ry={n1(s * 0.72)} fill="#8e9ba7" />
            <ellipse cx={n1(x - s * 0.25)} cy={n1(y - s * 0.22)} rx={n1(s * 0.55)} ry={n1(s * 0.4)} fill="#adb9c4" />
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------- desert ---

function Cactus({ scale }: { scale: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="5" cy="27" rx="18" ry="5" fill={CAST} />
      <g stroke="#2a6430" strokeWidth="1.4" fill="#3d8b45">
        <rect x="-7" y="-28" width="14" height="55" rx="7" />
        <path d="M-7,-2 h-10 a7,7 0 0 0 -7,7 v11 a7,7 0 0 0 14,0 v-6" />
        <path d="M7,-11 h9 a7,7 0 0 1 7,7 v15 a7,7 0 0 1 -14,0 v-6" />
      </g>
      <rect x="-7" y="-28" width="5" height="55" rx="2.5" fill="#66b063" opacity="0.8" />
      <rect x="2.5" y="-28" width="4" height="55" rx="2" fill="#1d4d24" opacity="0.55" />
      {[-18, -6, 6, 18].map((y) => (
        <path key={y} d={`M-5,${y} h10`} stroke="#275c2c" strokeWidth="1" opacity="0.5" />
      ))}
    </g>
  );
}

function Desert({ r }: { r: Rand }) {
  return (
    <g>
      <rect x="-60" y="-62" width="120" height="124" fill="#e2c894" />
      {[-46, -20, 8, 36].map((y, i) => (
        <g key={y}>
          <path
            d={`M-60,${y + 10} q30,-22 60,-3 q30,19 60,-4 v40 h-120 Z`}
            fill={i % 2 ? '#d7b880' : '#e9d3a4'}
          />
          <path
            d={`M-60,${y + 10} q30,-22 60,-3 q30,19 60,-4`}
            fill="none"
            stroke="#f7ecd0"
            strokeWidth="3"
            opacity="0.75"
          />
          <path
            d={`M-60,${y + 13} q30,-22 60,-3 q30,19 60,-4`}
            fill="none"
            stroke="#b99a63"
            strokeWidth="2"
            opacity="0.4"
          />
        </g>
      ))}
      <g transform="translate(-20,-10)">
        <Cactus scale={between(r, 0.95, 1.15)} />
      </g>
      <g transform="translate(26,26)">
        <Cactus scale={between(r, 0.5, 0.65)} />
      </g>
      {Array.from({ length: 9 }, (_, i) => {
        const x = between(r, -52, 52);
        const y = between(r, -48, 52);
        const s = between(r, 3, 7);
        return (
          <g key={i}>
            <ellipse cx={n1(x + s * 0.4)} cy={n1(y + s * 0.6)} rx={n1(s * 1.3)} ry={n1(s * 0.45)} fill={CAST} />
            <ellipse cx={n1(x)} cy={n1(y)} rx={n1(s)} ry={n1(s * 0.78)} fill="#b39a71" />
            <ellipse cx={n1(x - s * 0.25)} cy={n1(y - s * 0.24)} rx={n1(s * 0.58)} ry={n1(s * 0.42)} fill="#d2bd95" />
          </g>
        );
      })}
    </g>
  );
}

// ------------------------------------------------------------------------- //

export function TerrainArt({ terrain, seed }: { terrain: Terrain; seed: string }) {
  const r = seedFrom(`${terrain}:${seed}`);
  switch (terrain) {
    case 'forest':
      return <Forest r={r} />;
    case 'fields':
      return <Fields r={r} />;
    case 'pasture':
      return <Pasture r={r} />;
    case 'hills':
      return <Hills r={r} />;
    case 'mountains':
      return <Mountains r={r} />;
    case 'desert':
      return <Desert r={r} />;
    default:
      return null;
  }
}
