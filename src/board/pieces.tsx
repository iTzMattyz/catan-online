import { useLayoutEffect, useRef } from 'react';
import { HEX_SIZE, type HexId, type Point } from '../../shared/layout';
import type { PortType, Terrain } from '../../shared/types';
import { ResourceGlyph } from './icons';
import { TerrainArt } from './terrain';

/** Opening sequence timing, shared with the chits so they pop once the tiles are down. */
export const INTRO_STEP_MS = 55;
const TILES_DONE_MS = 18 * INTRO_STEP_MS + 550;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Base colours under the painted art, as a lit top and a shaded bottom. */
export const TERRAIN_FILL: Record<Terrain, [string, string]> = {
  forest: ['#3f9758', '#1d6135'],
  fields: ['#f0cf6b', '#c99120'],
  pasture: ['#9ec95a', '#6b9a2f'],
  hills: ['#cf7a4a', '#8e4322'],
  mountains: ['#94a2af', '#5a6874'],
  desert: ['#eddcb4', '#cbae7b'],
  sea: ['#1a5674', '#123a52'],
  gold: ['#f6d574', '#cf9b1c'],
};

/** Thickness of the cardboard tile, in board units. */
export const TILE_DEPTH = 7;

export function hexPath(center: Point, size = HEX_SIZE): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(center.x + size * Math.cos(angle)).toFixed(2)},${(center.y + size * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * One tile: a slab of printed board with real thickness. The extruded side is
 * drawn first and is mostly hidden by the tile below it, which is exactly how a
 * physical board looks from above.
 */
export function HexTile({ id, terrain, center, order = 0 }: { id: HexId; terrain: Terrain; center: Point; order?: number }) {
  const path = hexPath(center);
  return (
    // `order` staggers the opening drop, centre first and then ring by ring.
    <g className="hex-tile" style={{ animationDelay: `${order * INTRO_STEP_MS}ms` }}>
      <path d={hexPath({ x: center.x, y: center.y + TILE_DEPTH })} fill="#2b1c10" />
      <path d={hexPath({ x: center.x, y: center.y + TILE_DEPTH / 2 })} fill="#43301d" />

      <path d={path} fill={`url(#terrain-${terrain})`} />
      <g clipPath={`url(#clip-${id})`}>
        <g transform={`translate(${center.x},${center.y})`}>
          <TerrainArt terrain={terrain} seed={id} />
        </g>
      </g>

      <path d={path} fill="url(#hex-shade)" />
      <path d={path} fill="none" stroke="url(#hex-bevel)" strokeWidth="3.5" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#231506" strokeWidth="1.4" strokeLinejoin="round" opacity="0.65" />
    </g>
  );
}

/** Dots under the numeral: how many of the 36 dice rolls hit this token. */
function probabilityDots(token: number): number {
  return 6 - Math.abs(7 - token);
}

/** A printed cardboard chit: bevelled rim, paper grain, letterpressed numeral. */
export function NumberToken({ center, token, order = 0 }: { center: Point; token: number; order?: number }) {
  const hot = token === 6 || token === 8;
  const dots = probabilityDots(token);
  const size = token >= 10 ? 16 : 18;
  return (
    <g transform={`translate(${center.x},${center.y})`} pointerEvents="none">
      {/* Inner group: CSS animates its transform without clobbering the position above. */}
      <g className="token-pop" style={{ animationDelay: `${TILES_DONE_MS + order * 30}ms` }}>
        <ellipse cy="4.5" rx="18" ry="16.5" fill="rgba(20,12,4,0.45)" />
        <circle r="17.5" fill="#8d7c5d" />
        <circle r="17.5" fill="url(#token-rim)" />
        <circle r="15.5" fill="#f3ead6" />
        <circle r="15.5" fill="url(#token-face)" />
        <circle r="15.5" fill="url(#paper-grain)" opacity="0.45" />
        {/* A pale copy one pixel down reads as ink pressed into paper. */}
        <text
          y="-1.1"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Bitter, Georgia, serif"
          fontWeight="800"
          fontSize={size}
          fill="#ffffff"
          opacity="0.6"
        >
          {token}
        </text>
        <text
          y="-2"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Bitter, Georgia, serif"
          fontWeight="800"
          fontSize={size}
          fill={hot ? '#a8281f' : '#2c3239'}
        >
          {token}
        </text>
        <g fill={hot ? '#a8281f' : '#6b7783'}>
          {Array.from({ length: dots }, (_, i) => (
            <circle key={i} cx={(i - (dots - 1) / 2) * 3.6} cy="9.5" r="1.3" />
          ))}
        </g>
      </g>
    </g>
  );
}

/** A turned wooden pawn, lit from the upper left like everything else. */
/** Where the pawn stands on a hex: beside the chit, never on it. */
const robberAt = (c: Point): Point => ({ x: c.x - 26, y: c.y + 10 });

/** `centres` is every hex's centre, so the hop can start from wherever it was. */
export function Robber({ hex, centres }: { hex: HexId; centres: Record<HexId, Point> }) {
  const at = robberAt(centres[hex]);
  const hop = useRef<SVGGElement>(null);
  const was = useRef(hex);

  // The outer group is already at the new hex; the inner one starts at the old
  // spot and arcs over to it.
  useLayoutEffect(() => {
    const from = robberAt(centres[was.current]);
    was.current = hex;
    const dx = from.x - at.x;
    const dy = from.y - at.y;
    if ((dx === 0 && dy === 0) || prefersReducedMotion()) return;
    hop.current?.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx / 2}px, ${dy / 2 - 70}px) rotate(-12deg)`, offset: 0.5 },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 750, easing: 'cubic-bezier(.45,0,.3,1)' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const body =
    'M0,-25 c6,0 9.8,4.3 9.8,9.2 0,2.8 -1.3,5 -3.3,6.5 5,2.8 8.3,8.3 9.2,14.7 h-31.4 c0.9,-6.4 4.2,-11.9 9.2,-14.7 -2,-1.5 -3.3,-3.7 -3.3,-6.5 0,-4.9 3.8,-9.2 9.8,-9.2 z';
  return (
    <g className="robber-piece" transform={`translate(${at.x},${at.y})`} pointerEvents="none" aria-label="Robber">
      <g ref={hop}>
        <ellipse cx="7" cy="21" rx="16" ry="5" fill="rgba(20,12,4,0.5)" />
        <path d={body} fill="#2a2d33" />
        <path d={body} fill="url(#pawn-shade)" />
        <path d="M-15.5,5 h31 l2.2,5.5 h-35.4 z" fill="#353940" />
        <path d="M-15.5,5 h31 l2.2,5.5 h-35.4 z" fill="url(#pawn-shade)" />
        <path
          d="M-4.5,-22.5 c-2.6,1.2 -4,3.6 -4.1,6.3"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/**
 * Wraps a newly placed piece: it falls onto the board with a bounce and kicks up
 * a ring of dust. Pieces that were already there render as-is.
 */
function Drop({ fresh, children, dust = 16 }: { fresh?: boolean; children: React.ReactNode; dust?: number }) {
  if (!fresh) return <>{children}</>;
  return (
    <>
      <ellipse className="dust-ring" cy="10" rx={dust} ry={dust * 0.35} />
      <g className="piece-drop">{children}</g>
    </>
  );
}

/** A painted wooden road: rounded stick with a lit top and a shaded underside. */
export function RoadPiece({ pos, angle, color, fresh }: { pos: Point; angle: number; color: string; fresh?: boolean }) {
  return (
    <g transform={`translate(${pos.x},${pos.y}) rotate(${angle})`} pointerEvents="none">
      <Drop fresh={fresh} dust={20}>
        <rect x="-21" y="-2.5" width="44" height="9.5" rx="3.5" fill="rgba(20,12,4,0.45)" />
        <rect x="-22" y="-5" width="44" height="10" rx="3.5" fill={color} />
        <rect x="-22" y="-5" width="44" height="10" rx="3.5" fill="url(#wood-shade)" />
        <rect x="-18.5" y="-3.4" width="37" height="2.6" rx="1.3" fill="rgba(255,255,255,0.4)" />
        <rect x="-22" y="-5" width="44" height="10" rx="3.5" fill="none" stroke="rgba(25,14,6,0.7)" strokeWidth="1.5" />
      </Drop>
    </g>
  );
}

/**
 * A house seen from slightly above: roof, front wall and a shaded right face, so
 * the piece reads as an object standing on the board rather than a flat icon.
 */
export function SettlementPiece({ pos, color, fresh }: { pos: Point; color: string; fresh?: boolean }) {
  return (
    <g transform={`translate(${pos.x},${pos.y})`} pointerEvents="none">
      <Drop fresh={fresh}>
        <ellipse cx="4" cy="13" rx="17" ry="5" fill="rgba(20,12,4,0.45)" />
        <g fill={color}>
          <path d="M-13,-1 v13 h26 v-13 Z" />
          <path d="M-14.5,-1 L0,-14 L14.5,-1 Z" />
        </g>
        <path d="M-14.5,-1 L0,-14 L14.5,-1 Z" fill="rgba(255,255,255,0.34)" />
        <path d="M0,-14 L14.5,-1 L13,-1 L13,12 L4,12 L4,-4 Z" fill="rgba(20,12,4,0.3)" />
        <path
          d="M-13,-1 v13 h26 v-13 Z M-14.5,-1 L0,-14 L14.5,-1"
          fill="none"
          stroke="#1d1207"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </Drop>
    </g>
  );
}

/** A larger keep: hall plus tower, same light, same shadow direction. */
export function CityPiece({ pos, color, fresh }: { pos: Point; color: string; fresh?: boolean }) {
  return (
    <g transform={`translate(${pos.x},${pos.y})`} pointerEvents="none">
      <Drop fresh={fresh} dust={24}>
        <ellipse cx="5" cy="15" rx="24" ry="6" fill="rgba(20,12,4,0.45)" />
        <g fill={color}>
          <path d="M-20,0 v14 h15 v-14 Z" />
          <path d="M-21.5,0 L-12.5,-11 L-3.5,0 Z" />
          <path d="M-5,-6 v20 h24 v-20 Z" />
          <path d="M-6.5,-6 L7,-17 L20.5,-6 Z" />
        </g>
        <path d="M-21.5,0 L-12.5,-11 L-3.5,0 Z" fill="rgba(255,255,255,0.3)" />
        <path d="M-6.5,-6 L7,-17 L20.5,-6 Z" fill="rgba(255,255,255,0.36)" />
        <path d="M7,-17 L20.5,-6 L19,-6 L19,14 L11,14 L11,-10 Z" fill="rgba(20,12,4,0.3)" />
        <path d="M-12.5,-11 L-3.5,0 L-5,0 L-5,14 L-9,14 L-9,-6 Z" fill="rgba(20,12,4,0.28)" />
        <g fill="rgba(20,12,4,0.45)">
          <rect x="2" y="1" width="6" height="7" rx="1.4" />
          <rect x="-17" y="4" width="6" height="7" rx="1.4" />
        </g>
        <g fill="none" stroke="#1d1207" strokeWidth="2" strokeLinejoin="round">
          <path d="M-20,0 v14 h15 v-14 Z M-21.5,0 L-12.5,-11 L-3.5,0 Z" />
          <path d="M-5,-6 v20 h24 v-20 Z M-6.5,-6 L7,-17 L20.5,-6 Z" />
        </g>
      </Drop>
    </g>
  );
}

const PORT_COLOR: Record<Exclude<PortType, 'any'>, string> = {
  brick: '#f09a66',
  lumber: '#64cf8d',
  wool: '#c7e874',
  grain: '#ffdf78',
  ore: '#c3d0dd',
};

const SAIL: Record<PortType, string> = {
  any: '#f4efe2',
  brick: '#d9794a',
  lumber: '#4fae6e',
  wool: '#b5d86a',
  grain: '#f0c75a',
  ore: '#a9b7c6',
};

/** A plank from a to b, drawn as a thick rounded stroke with a lit edge. */
function Plank({ a, b, width }: { a: Point; b: Point; width: number }) {
  return (
    <g strokeLinecap="round">
      <line x1={a.x} y1={a.y + 3} x2={b.x} y2={b.y + 3} stroke="rgba(4,14,22,0.45)" strokeWidth={width} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#9b7249" strokeWidth={width} />
      <line x1={a.x} y1={a.y - width / 4} x2={b.x} y2={b.y - width / 4} stroke="#c49a68" strokeWidth={width / 4} opacity="0.7" />
    </g>
  );
}

/** A point `d` out to sea from a harbour's coast edge, shifted `side` along the coast. */
function portOffset(pos: Point, outward: Point) {
  const along = { x: -outward.y, y: outward.x };
  return {
    along,
    out: (d: number, side = 0): Point => ({
      x: pos.x + outward.x * d + along.x * side,
      y: pos.y + outward.y * d + along.y * side,
    }),
  };
}

/**
 * The boat moored beside a harbour, bobbing on the swell. Drawn on the animated
 * sea layer rather than with the pier, so its motion never repaints the board.
 */
export function PortBoat({ pos, outward, type }: { pos: Point; outward: Point; type: PortType }) {
  const { along, out } = portOffset(pos, outward);
  const boat = out(58, 34);
  // Keep the boat upright on screen; just lean it a touch with the coast.
  const lean = Math.max(-20, Math.min(20, (Math.atan2(along.y, along.x) * 180) / Math.PI));
  return (
    <g className="boat" style={{ animationDelay: `${(Math.abs(pos.x * 7 + pos.y * 3) % 1800) | 0}ms` }}>
      <g transform={`translate(${boat.x},${boat.y}) rotate(${lean})`}>
        <path d="M-17,-2 h34 l-6,8 h-22 z" fill="#efe4cc" stroke="#6d4526" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-17,-2 h34" stroke="#6d4526" strokeWidth="2" />
        <line x1="-1" y1="-2" x2="-1" y2="-27" stroke="#4a2f18" strokeWidth="1.6" />
        <path d="M1,-25 L1,-4 L14,-5 Z" fill={SAIL[type]} stroke="rgba(40,25,10,0.5)" strokeWidth="0.8" />
      </g>
    </g>
  );
}

/**
 * A harbour, as on the 3D board: planks from the two coast corners that trade
 * here join a pier running out over the frame to a dock in the water, with the
 * trade sign on the dock. Its boat is `PortBoat`.
 */
export function PortMarker({
  pos,
  outward,
  type,
  vertices,
}: {
  pos: Point;
  outward: Point;
  type: PortType;
  vertices: [Point, Point];
}) {
  const { out } = portOffset(pos, outward);
  const fork = out(18);
  const dock = out(54);
  const generic = type === 'any';
  const color = generic ? '#eedcb8' : PORT_COLOR[type];

  return (
    <g pointerEvents="none">
      <title>{generic ? 'Harbour: trade any 3 alike for 1' : `Harbour: trade 2 ${type} for 1`}</title>
      <Plank a={vertices[0]} b={fork} width={5} />
      <Plank a={vertices[1]} b={fork} width={5} />
      <Plank a={fork} b={dock} width={9} />

      {/* Posts show below the deck where it stands in the water. */}
      {[-11, 11].map((s) => {
        const p = out(54, s);
        return <rect key={s} x={p.x - 2} y={p.y + 4} width="4" height="9" rx="1" fill="#4a2f18" />;
      })}

      {/* The sign on its dock. */}
      <ellipse cx={dock.x + 2} cy={dock.y + 6} rx="21" ry="19" fill="rgba(4,14,22,0.55)" />
      <circle cx={dock.x} cy={dock.y} r="20" fill="#7a5530" />
      <circle cx={dock.x} cy={dock.y} r="20" fill="url(#wood-shade)" />
      <circle cx={dock.x} cy={dock.y} r="15.5" fill="#12293a" />
      {generic ? (
        <text
          x={dock.x}
          y={dock.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Bitter, Georgia, serif"
          fontWeight="700"
          fontSize="14"
          fill={color}
        >
          3:1
        </text>
      ) : (
        <g color={color}>
          <svg x={dock.x - 13} y={dock.y - 16} width="26" height="26" viewBox="0 0 24 24">
            <ResourceGlyph resource={type} />
          </svg>
          <text
            x={dock.x}
            y={dock.y + 16}
            textAnchor="middle"
            fontFamily="Bitter, Georgia, serif"
            fontWeight="700"
            fontSize="10"
            fill={color}
          >
            2:1
          </text>
        </g>
      )}
    </g>
  );
}
