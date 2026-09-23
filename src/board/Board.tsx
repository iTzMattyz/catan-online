import { useMemo, useState } from 'react';
import {
  HEX_SIZE,
  type BoardGraph,
  type EdgeId,
  type HexId,
  type Point,
  type VertexId,
} from '../../shared/layout';
import type { PlayerView } from '../../shared/redact';
import { graphOf } from '../../shared/scenario';
import type { Terrain } from '../../shared/types';
import type { RollFx } from '../fx/events';
import {
  CityPiece,
  HexTile,
  NumberToken,
  PortBoat,
  PortMarker,
  RoadPiece,
  Robber,
  SettlementPiece,
  TERRAIN_FILL,
  TILE_DEPTH,
  hexPath,
} from './pieces';

const TERRAINS: Terrain[] = ['forest', 'fields', 'pasture', 'hills', 'mountains', 'desert', 'sea', 'gold'];

export type BoardProps = {
  view: PlayerView;
  /** Which kind of spot the player is being asked to click, if any. */
  pending: 'settlement' | 'city' | 'road' | 'robber' | null;
  onVertex: (id: VertexId) => void;
  onEdge: (id: EdgeId) => void;
  onHex: (id: HexId) => void;
  /** The latest roll, for boards that animate it. */
  roll?: RollFx | null;
};

/** The coastline in ring order; the wooden frame is stroked along it. */
function coastline(g: BoardGraph): { path: string } {
  const ring = g.boundaryRing;
  if (ring.length === 0) return { path: '' };
  const points: Point[] = [];
  let cursor = g.edges[ring[0]].vertices[0];
  for (const edgeId of ring) {
    const [a, b] = g.edges[edgeId].vertices;
    cursor = a === cursor ? b : a;
    points.push(g.vertices[cursor].pos);
  }
  return { path: `M${points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z` };
}

/** Unit normal of a coastal edge, pointing out to sea (so jetties run square to the coast). */
function edgeOutward(pos: Point, angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  const n = { x: -Math.sin(a), y: Math.cos(a) };
  return n.x * pos.x + n.y * pos.y < 0 ? { x: -n.x, y: -n.y } : n;
}

/** Opening order: the centre tile first, then outwards ring by ring. */
const hexOrder = (g: BoardGraph): Record<HexId, number> =>
  Object.fromEntries(
  [...g.hexes]
    .map((h) => {
      const c = g.hexPos[h];
      return { h, d: Math.round(Math.hypot(c.x, c.y)), a: Math.atan2(c.y, c.x) };
    })
    .sort((p, q) => p.d - q.d || p.a - q.a)
    .map((p, i) => [p.h, i]),
  );

/** Island extents plus room for the frame and the jetties sticking out to sea. */
function viewBox(g: BoardGraph): string {
  const ps = Object.values(g.vertices).map((v) => v.pos);
  const w = Math.max(...ps.map((p) => Math.abs(p.x))) + 70;
  const h = Math.max(...ps.map((p) => Math.abs(p.y))) + 90;
  return `${-w} ${-h} ${2 * w} ${2 * h}`;
}

/**
 * Open water behind the island. Long, low-contrast swells running across the
 * whole view read as a sea surface; concentric rings echoing the board's own
 * shape read as stray geometry instead.
 */
function Sea() {
  const rows = Array.from({ length: 13 }, (_, i) => -300 + i * 50);
  const wave = (y: number, amp: number) =>
    `M-340,${y} q40,${-amp} 80,0 q40,${amp} 80,0 q40,${-amp} 80,0 q40,${amp} 80,0 q40,${-amp} 80,0 q40,${amp} 80,0 q40,${-amp} 80,0 q40,${amp} 80,0`;

  return (
    <g pointerEvents="none">
      {rows.map((y, i) => {
        const amp = 7 + ((i * 37) % 9);
        const phase = (i * 53) % 90;
        return (
          <g key={y}>
            <path
              className="swell"
              // One dash period per loop, so the drift never visibly jumps.
              style={{ animationDelay: `${-i * 1.3}s`, ['--loop' as string]: `${-(90 + phase + ((i * 29) % 60))}` }}
              d={wave(y, amp)}
              fill="none"
              stroke="#bfe6ff"
              strokeWidth={i % 3 === 0 ? 2.6 : 1.6}
              strokeLinecap="round"
              opacity={0.07 + (i % 3) * 0.02}
              strokeDasharray={`${50 + phase} ${40 + ((i * 29) % 60)}`}
            />
            <path
              className="swell"
              style={{ animationDelay: `${-i * 1.3 - 0.6}s`, ['--loop' as string]: `${-(92 + phase + ((i * 17) % 40))}` }}
              d={wave(y + 9, amp)}
              fill="none"
              stroke="#06202f"
              strokeWidth="2.4"
              strokeLinecap="round"
              opacity="0.24"
              strokeDasharray={`${34 + phase} ${58 + ((i * 17) % 40)}`}
            />
          </g>
        );
      })}
    </g>
  );
}

export function Board({ view, pending, onVertex, onEdge, onHex, roll }: BoardProps) {
  const { board, moves } = view;
  const g = graphOf(board);
  const coast = useMemo(() => coastline(g), [g]);
  const HEX_ORDER = useMemo(() => hexOrder(g), [g]);

  const colorOf = (id: string) => view.players.find((p) => p.id === id)?.color ?? '#888';

  const vertexSpots = pending === 'settlement' ? moves.settlementSpots : pending === 'city' ? moves.citySpots : [];
  const edgeSpots = pending === 'road' ? moves.roadSpots : [];
  const hexSpots = pending === 'robber' ? moves.robberSpots : [];

  // What was on the board when it appeared. Anything new, or any settlement
  // since grown into a city, gets the drop-in animation.
  const [atLoad] = useState(
    () =>
      new Map<string, string>([
        ...Object.keys(board.roads).map((e) => [e, 'road'] as [string, string]),
        ...Object.entries(board.buildings).map(([v, b]) => [v, b.type] as [string, string]),
      ]),
  );

  /*
   * The painted tiles are by far the heaviest part of the scene — roughly eight
   * hundred nodes — and they only change when a board is dealt. Rebuilding them
   * is keyed on the terrain and tokens themselves rather than on object identity,
   * because the server hands us a fresh state object on every single action.
   */
  const terrainKey = g.hexes.map((h) => `${board.hexes[h].terrain}${board.hexes[h].token}`).join('|');
  const island = useMemo(
    () => (
      <g filter="url(#island-drop)">
        {/* The frame is a real slab: a dark under-edge, then the lit wood face. */}
        <path
          d={coast.path}
          fill="none"
          stroke="#291607"
          strokeWidth="34"
          strokeLinejoin="round"
          transform={`translate(0,${TILE_DEPTH})`}
        />
        <path d={coast.path} fill="none" stroke="url(#frame-wood)" strokeWidth="32" strokeLinejoin="round" />
        <path d={coast.path} fill="none" stroke="#c08b52" strokeWidth="3" strokeLinejoin="round" opacity="0.4" />
        <path
          d={coast.path}
          fill="none"
          stroke="#2a1708"
          strokeWidth="2"
          strokeLinejoin="round"
          opacity="0.6"
          transform="translate(0,7)"
        />
        {g.hexes.map((h) => (
          <HexTile
            key={h}
            id={h}
            terrain={board.hexes[h].terrain}
            center={g.hexPos[h]}
            order={HEX_ORDER[h]}
          />
        ))}
      </g>
    ),
    // Deliberately not board.hexes: the server sends a fresh object every action,
    // so depending on its identity would rebuild the tiles every time. terrainKey
    // covers every field the tiles actually read.
    [terrainKey, coast.path],
  );

  // Chits sit above the robber's shade and the production glow, so they always read.
  const tokens = useMemo(
    () => (
      <g>
        {g.hexes.map((h) =>
          board.hexes[h].token !== null ? (
            <NumberToken
              key={`token-${h}`}
              center={g.hexPos[h]}
              token={board.hexes[h].token!}
              order={HEX_ORDER[h]}
            />
          ) : null,
        )}
      </g>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terrainKey],
  );

  const box = viewBox(g);
  const harbours = board.ports.map((port) => {
    const info = g.edges[port.edge];
    return { port, info, outward: edgeOutward(info.pos, info.angle) };
  });

  /*
   * Three stacked layers, each its own compositor layer (see .board2d). Only the
   * sea underneath and the spot markers on top animate forever; the board in the
   * middle, with its blurred drop shadow and paper-grain chits, is expensive to
   * paint, so it must not share a layer with anything that moves every frame.
   */
  return (
    <div className="board2d">
      <svg viewBox={box} aria-hidden="true">
        <Sea />
        {/* Surf against the frame: a wide pale stroke, mostly under the wood, breathing slowly. */}
        <path className="foam" d={coast.path} fill="none" stroke="#e8f6ff" strokeWidth="58" strokeLinejoin="round" />
        {harbours.map(({ port, info, outward }) => (
          <PortBoat key={port.edge} pos={info.pos} outward={outward} type={port.type} />
        ))}
      </svg>

      <svg viewBox={box} role="img" aria-label="Catan board">
        <defs>
          {TERRAINS.map((t) => (
            <linearGradient key={t} id={`terrain-${t}`} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor={TERRAIN_FILL[t][0]} />
              <stop offset="100%" stopColor={TERRAIN_FILL[t][1]} />
            </linearGradient>
          ))}

          {/* One light source, upper left. Every bevel and shade below uses it. */}
          <linearGradient id="hex-bevel" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#1b1206" stopOpacity="0.4" />
          </linearGradient>

          <radialGradient id="hex-shade" cx="34%" cy="28%" r="82%">
            <stop offset="0%" stopColor="#fff3d8" stopOpacity="0.18" />
            <stop offset="54%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#10202b" stopOpacity="0.3" />
          </radialGradient>

          <linearGradient id="wood-shade" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="48%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#140c04" stopOpacity="0.42" />
          </linearGradient>

          <radialGradient id="pawn-shade" cx="32%" cy="24%" r="85%">
            <stop offset="0%" stopColor="#c8d2dc" stopOpacity="0.45" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
          </radialGradient>

          <linearGradient id="token-rim" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#fff8e6" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#b9a684" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#4a3b22" stopOpacity="0.75" />
          </linearGradient>

          <radialGradient id="token-face" cx="34%" cy="26%" r="80%">
            <stop offset="0%" stopColor="#fffdf6" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#efe4cb" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b7a58" stopOpacity="0.4" />
          </radialGradient>

          <linearGradient id="frame-wood" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#a9743f" />
            <stop offset="45%" stopColor="#8a5a33" />
            <stop offset="100%" stopColor="#4f3118" />
          </linearGradient>

          {/* Paper fibre for the number chits. One cheap pass, reused by a pattern. */}
          <filter id="paper-fibre" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="4" result="n" />
            <feColorMatrix in="n" type="saturate" values="0" result="g" />
            <feComponentTransfer in="g" result="a">
              <feFuncA type="linear" slope="0.24" intercept="0" />
            </feComponentTransfer>
            <feComposite in="a" in2="SourceGraphic" operator="in" />
          </filter>

          <pattern id="paper-grain" width="34" height="34" patternUnits="userSpaceOnUse">
            <rect width="34" height="34" fill="#cbb994" filter="url(#paper-fibre)" />
          </pattern>

          <filter id="island-drop" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="6" dy="16" stdDeviation="16" floodColor="#02090f" floodOpacity="0.72" />
          </filter>

          <filter id="piece-drop" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="2" dy="4" stdDeviation="2.2" floodColor="#0d0801" floodOpacity="0.5" />
          </filter>

          {g.hexes.map((h) => (
            <clipPath key={h} id={`clip-${h}`}>
              <path d={hexPath(g.hexPos[h])} />
            </clipPath>
          ))}
        </defs>

        {island}

        {/* Jetties run from the coast corners out over the frame to docks in the water. */}
        {harbours.map(({ port, info, outward }) => (
          <PortMarker
            key={port.edge}
            pos={info.pos}
            outward={outward}
            type={port.type}
            vertices={[g.vertices[port.vertices[0]].pos, g.vertices[port.vertices[1]].pos]}
          />
        ))}

        {/* The robber's hex goes dark; keyed so a new hex fades in its shade. */}
        <path
          key={`robbed-${board.robber}`}
          className="robbed-shade"
          d={hexPath(g.hexPos[board.robber])}
          pointerEvents="none"
        />

        {/* Hexes that just paid out pulse gold, keyed on the roll so a repeat roll replays. */}
        {roll?.producing.map((h) => (
          <path key={`glow-${roll.id}-${h}`} className="hex-glow" d={hexPath(g.hexPos[h])} pointerEvents="none" />
        ))}

        {tokens}

        {roll?.producing.map((h) => {
          const c = g.hexPos[h];
          return <circle key={`ring-${roll.id}-${h}`} className="chit-ring" cx={c.x} cy={c.y} r="21" pointerEvents="none" />;
        })}

        {/* Roads sit under buildings so a settlement always reads on top. */}
        <g filter="url(#piece-drop)">
          {Object.entries(board.roads).map(([edgeId, road]) => (
            <RoadPiece
              key={edgeId}
              pos={g.edges[edgeId].pos}
              angle={g.edges[edgeId].angle}
              color={colorOf(road.owner)}
              fresh={!atLoad.has(edgeId)}
            />
          ))}
        </g>

        <Robber hex={board.robber} centres={g.hexPos} />

        <g filter="url(#piece-drop)">
          {Object.entries(board.buildings).map(([vertexId, b]) =>
            b.type === 'city' ? (
              <CityPiece
                key={vertexId}
                pos={g.vertices[vertexId].pos}
                color={colorOf(b.owner)}
                fresh={atLoad.get(vertexId) !== 'city'}
              />
            ) : (
              <SettlementPiece
                key={vertexId}
                pos={g.vertices[vertexId].pos}
                color={colorOf(b.owner)}
                fresh={!atLoad.has(vertexId)}
              />
            ),
          )}
        </g>
      </svg>

      {/* Only legal spots are ever rendered, so a click can never be illegal. */}
      <svg viewBox={box} className="board2d-spots">
        {hexSpots.map((h) => {
          const c = g.hexPos[h];
          return (
            // Outline only: the numbers are exactly what you are choosing between,
            // so nothing is allowed to cover them.
            <g key={h} className="spot" onClick={() => onHex(h)}>
              <path d={hexPath(c)} fill="rgba(255,214,110,0.09)" />
              <path
                className="spot-marker"
                d={hexPath(c, HEX_SIZE - 5)}
                fill="none"
                stroke="#ffd66e"
                strokeWidth="3"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {edgeSpots.map((e) => {
          const info = g.edges[e];
          return (
            <g
              key={e}
              className="spot"
              onClick={() => onEdge(e)}
              transform={`translate(${info.pos.x},${info.pos.y}) rotate(${info.angle})`}
            >
              <rect x="-30" y="-12" width="60" height="24" fill="transparent" />
              <rect
                className="spot-marker"
                x="-22"
                y="-4.5"
                width="44"
                height="9"
                rx="4.5"
                fill="#ffd66e"
                stroke="#4a3208"
                strokeWidth="1.6"
              />
            </g>
          );
        })}

        {vertexSpots.map((v) => {
          const p = g.vertices[v].pos;
          return (
            <g key={v} className="spot" onClick={() => onVertex(v)}>
              <circle cx={p.x} cy={p.y} r="20" fill="transparent" />
              <circle className="spot-marker" cx={p.x} cy={p.y} r="8" fill="#ffd66e" stroke="#4a3208" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
