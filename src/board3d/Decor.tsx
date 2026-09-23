import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HexId } from '../../shared/layout';
import type { BoardState, Terrain } from '../../shared/types';
import { seedFrom } from '../board/terrain';
import { TILES_DONE, reducedMotion, tileLift } from './anim';
import { G, Y, hexWorld } from './coords';

/*
 * Low-poly scenery. Every kind of prop is one InstancedMesh for the whole board,
 * so four forests of trees cost three draw calls, not thirty. Geometry is built
 * with its base at y=0 so a placement only needs a position, a yaw and a scale.
 */

type Part =
  | 'trunk'
  | 'pineLow'
  | 'pineHigh'
  | 'wheat'
  | 'tuft'
  | 'sheep'
  | 'sheepHead'
  | 'mound'
  | 'brick'
  | 'peak'
  | 'snow'
  | 'boulder'
  | 'dune'
  | 'cactus';

const PARTS: Record<Part, THREE.BufferGeometry> = {
  trunk: new THREE.CylinderGeometry(0.03, 0.045, 0.14, 6).translate(0, 0.07, 0),
  pineLow: new THREE.ConeGeometry(0.18, 0.3, 7).translate(0, 0.25, 0),
  pineHigh: new THREE.ConeGeometry(0.13, 0.24, 7).translate(0, 0.4, 0),
  wheat: new THREE.ConeGeometry(0.028, 0.2, 4).translate(0, 0.1, 0),
  tuft: new THREE.ConeGeometry(0.035, 0.09, 4).translate(0, 0.045, 0),
  sheep: new THREE.IcosahedronGeometry(0.075, 0).scale(1.35, 0.9, 1).translate(0, 0.09, 0),
  sheepHead: new THREE.BoxGeometry(0.06, 0.055, 0.055).translate(0.11, 0.11, 0),
  mound: new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1),
  brick: new THREE.BoxGeometry(0.11, 0.045, 0.055).translate(0, 0.0225, 0),
  peak: new THREE.ConeGeometry(0.3, 0.6, 5).translate(0, 0.3, 0),
  // Slightly wider than the peak where they meet, so the cap sits proud instead of z-fighting.
  snow: new THREE.ConeGeometry(0.13, 0.26, 5).translate(0, 0.48, 0),
  boulder: new THREE.DodecahedronGeometry(0.07, 0).translate(0, 0.04, 0),
  dune: new THREE.SphereGeometry(0.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.28, 0.7),
  cactus: new THREE.CylinderGeometry(0.03, 0.035, 0.2, 6).translate(0, 0.1, 0),
};

const PART_LIST = Object.keys(PARTS) as Part[];

type Placement = { part: Part; x: number; z: number; y?: number; yaw: number; scale: number | [number, number, number]; color: string };

type Rand = () => number;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);

/** Inside a pointy-top hex of circumradius `size`, centred on the origin. */
const inHex = (x: number, z: number, size: number) =>
  Math.abs(x) <= size * 0.866 && Math.abs(x) * 0.5 + Math.abs(z) * 0.866 <= size * 0.866;

/** Keep scenery off the number chit in the middle. */
const CLEAR = 0.4;

/**
 * The camera looks at the board from the south (+z), so anything tall standing
 * in the strip just south of the chit would stand between you and the number.
 */
const hidesChit = (x: number, z: number) => z > 0 && z < 0.8 && Math.abs(x) < 0.5;

function scatter(r: Rand, count: number, minGap: number, size = 0.8, tall = false): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count * 80 && out.length < count; i++) {
    const x = between(r, -size, size);
    const z = between(r, -size, size);
    if (!inHex(x, z, size) || Math.hypot(x, z) < CLEAR || (tall && hidesChit(x, z))) continue;
    if (out.every(([a, b]) => Math.hypot(a - x, b - z) >= minGap)) out.push([x, z]);
  }
  return out;
}

/** Nudge a hex colour's lightness a little so instances don't look stamped. */
function vary(r: Rand, hex: string, amount = 0.08): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h + between(r, -0.015, 0.015), hsl.s, Math.min(1, Math.max(0, hsl.l + between(r, -amount, amount))));
  return `#${c.getHexString()}`;
}

function placementsFor(terrain: Terrain, r: Rand): Placement[] {
  const out: Placement[] = [];
  const put = (part: Part, x: number, z: number, scale: Placement['scale'], color: string, yaw = r() * Math.PI * 2, y?: number) =>
    out.push({ part, x, z, scale, color, yaw, y });

  switch (terrain) {
    case 'forest':
      for (const [x, z] of scatter(r, 9, 0.26, 0.8, true)) {
        const s = between(r, 0.8, 1.25);
        put('trunk', x, z, s, '#6b4526');
        put('pineLow', x, z, s, vary(r, '#2f7443'));
        put('pineHigh', x, z, s, vary(r, '#3d8b52'));
      }
      break;
    case 'fields':
      for (let row = -0.72; row <= 0.72; row += 0.13) {
        for (let x = -0.8; x <= 0.8; x += 0.075) {
          const jx = x + between(r, -0.02, 0.02);
          const jz = row + between(r, -0.02, 0.02);
          if (!inHex(jx, jz, 0.84) || Math.hypot(jx, jz) < CLEAR) continue;
          put('wheat', jx, jz, [1, between(r, 0.75, 1.2), 1], vary(r, '#e0b545', 0.1));
        }
      }
      break;
    case 'pasture':
      for (const [x, z] of scatter(r, 16, 0.12)) put('tuft', x, z, between(r, 0.8, 1.4), vary(r, '#6fa33a'));
      for (const [x, z] of scatter(r, 4, 0.25, 0.7)) {
        const yaw = r() * Math.PI * 2;
        const s = between(r, 0.9, 1.15);
        put('sheep', x, z, s, vary(r, '#f4f1e8', 0.04), yaw);
        put('sheepHead', x, z, s, '#2d2a28', yaw);
      }
      break;
    case 'hills':
      for (const [x, z] of scatter(r, 4, 0.35)) put('mound', x, z, between(r, 0.8, 1.3), vary(r, '#b25d33'));
      for (const [x, z] of scatter(r, 2, 0.3, 0.7)) {
        const yaw = r() * Math.PI;
        for (let layer = 0; layer < 3; layer++) {
          for (const off of [-0.03, 0.03]) {
            const ox = Math.cos(yaw + Math.PI / 2) * off;
            const oz = -Math.sin(yaw + Math.PI / 2) * off;
            put('brick', x + ox, z + oz, 1, vary(r, '#9e3f22', 0.05), yaw + (layer % 2) * 0.1, layer * 0.046);
          }
        }
      }
      break;
    case 'mountains':
    case 'gold': {
      const rock = terrain === 'gold' ? '#c9a13b' : '#7d8790';
      for (const [x, z] of scatter(r, 4, 0.36, 0.8, true)) {
        const s = between(r, 0.75, 1.15);
        put('peak', x, z, s, vary(r, rock));
        put('snow', x, z, s, terrain === 'gold' ? '#fff0b0' : '#f2f5f7', undefined);
      }
      for (const [x, z] of scatter(r, 5, 0.12)) put('boulder', x, z, between(r, 0.6, 1.2), vary(r, '#6c757c'));
      break;
    }
    case 'desert':
      for (const [x, z] of scatter(r, 3, 0.45)) put('dune', x, z, between(r, 0.9, 1.3), vary(r, '#dcc28b', 0.04));
      for (const [x, z] of scatter(r, 3, 0.2, 0.75)) put('cactus', x, z, between(r, 0.8, 1.2), '#4f8a45');
      for (const [x, z] of scatter(r, 3, 0.15)) put('boulder', x, z, between(r, 0.5, 0.8), '#a89274');
      break;
    case 'sea':
      break;
  }
  return out;
}

/** Peak and its snow cap must share a yaw, or the cap's facets won't line up. */
function alignCaps(list: Placement[]) {
  for (let i = 1; i < list.length; i++) {
    if (list[i].part === 'snow' && list[i - 1].part === 'peak') list[i].yaw = list[i - 1].yaw;
    if (list[i].part === 'pineHigh' && list[i - 1].part === 'pineLow') list[i].yaw = list[i - 1].yaw;
  }
  return list;
}

export function boardDecor(board: BoardState): Map<Part, (Placement & { hex: HexId })[]> {
  const byPart = new Map<Part, (Placement & { hex: HexId })[]>();
  for (const h of G.hexes) {
    const [cx, cz] = hexWorld(h);
    for (const p of alignCaps(placementsFor(board.hexes[h].terrain, seedFrom(`decor-${h}`)))) {
      const list = byPart.get(p.part) ?? [];
      list.push({ ...p, x: p.x + cx, z: p.z + cz, hex: h });
      byPart.set(p.part, list);
    }
  }
  return byPart;
}

const material = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.85 });

/*
 * Wind. Plants use a copy of the material whose vertex shader leans each vertex
 * by its height above the ground, phase-shifted by where the plant stands, so a
 * gust visibly rolls across a field instead of every stalk nodding in unison.
 */
const wind = { value: 0 };
const swaying = material.clone();
swaying.onBeforeCompile = (shader) => {
  shader.uniforms.uWind = wind;
  shader.vertexShader = `uniform float uWind;
${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec2 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    #else
      vec2 root = vec2(0.0);
    #endif
    float lean = max(position.y, 0.0);
    float gust = sin(uWind * 1.7 - root.x * 0.9 + root.y * 0.4) * 0.5 + 0.5;
    transformed.x += (sin(uWind * 3.1 + root.x * 7.0 + root.y * 5.0) * 0.04 + gust * 0.08) * lean;
    transformed.z += sin(uWind * 2.3 + root.y * 6.0) * 0.03 * lean;`,
  );
};
const SWAYS = new Set<Part>(['wheat', 'pineLow', 'pineHigh', 'tuft', 'cactus']);

type Item = Placement & { hex: HexId };

/** Scenery on the robber's hex goes dark along with the tile. */
const SHADOWED = 0.45;

function PartInstances({ part, items, robber }: { part: Part; items: Item[]; robber: HexId }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  // Rest poses, computed once; during the opening each instance rides its tile down.
  const poses = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    return items.map((it) => {
      const s = typeof it.scale === 'number' ? [it.scale, it.scale, it.scale] : it.scale;
      q.setFromAxisAngle(up, it.yaw);
      return {
        pos: new THREE.Vector3(it.x, Y.tileTop + (it.y ?? 0), it.z),
        quat: q.clone(),
        scale: new THREE.Vector3(...s),
      };
    });
  }, [items]);

  const settled = useRef(false);
  const place = (t: number) => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    items.forEach((it, i) => {
      const pose = poses[i];
      v.copy(pose.pos);
      v.y += tileLift(it.hex, t);
      mesh.setMatrixAt(i, m.compose(v, pose.quat, pose.scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const mesh = ref.current!;
    const color = new THREE.Color();
    items.forEach((it, i) => {
      color.set(it.color);
      if (it.hex === robber) color.multiplyScalar(SHADOWED);
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, robber]);

  useLayoutEffect(() => {
    place(0);
    // Bounds must cover the settled board, or frustum culling drops the props.
    place(TILES_DONE + 1);
    ref.current!.computeBoundingSphere();
    place(0);
    settled.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poses]);

  useFrame(({ clock }) => {
    if (settled.current) return;
    const t = clock.elapsedTime;
    place(t);
    if (t > TILES_DONE) settled.current = true;
  });

  return (
    <instancedMesh ref={ref} args={[PARTS[part], SWAYS.has(part) ? swaying : material, items.length]} castShadow receiveShadow />
  );
}

export function Decor({ board }: { board: BoardState }) {
  const key = G.hexes.map((h) => board.hexes[h].terrain).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byPart = useMemo(() => boardDecor(board), [key]);
  useFrame((_, dt) => {
    if (!reducedMotion) wind.value += dt;
  });
  return (
    <group>
      {PART_LIST.filter((p) => byPart.has(p)).map((p) => (
        <PartInstances key={`${key}-${p}`} part={p} items={byPart.get(p)!} robber={board.robber} />
      ))}
    </group>
  );
}
