import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HexId } from '../../shared/layout';
import type { BoardState, Terrain } from '../../shared/types';
import { INTRO_DONE, TILES_DONE, reducedMotion, tileLift, tokenScale } from './anim';
import { DICE_TIME } from './Dice';
import { COAST, G, Y, frameOutline, hexWorld, hexagon, shapeFrom } from './coords';
import { groundTexture, tokenTexture, woodTexture } from './textures';

const TILE_BEVEL = 0.03;

/** One bevelled slab, shared by every tile. Group 0 is the caps, group 1 the sides. */
const tileGeometry = (() => {
  const g = new THREE.ExtrudeGeometry(shapeFrom(hexagon(0.93)), {
    depth: Y.tileTop - TILE_BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: TILE_BEVEL,
    bevelSize: TILE_BEVEL,
    bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, TILE_BEVEL, 0);
  return g;
})();

const tileSide = new THREE.MeshStandardMaterial({ color: '#4a3420', roughness: 0.9 });

const ROBBED = new THREE.Color('#6a6a70');
const GLOW_COLOR = new THREE.Color('#ffb52e');
const GLOW_TIME = 1.8;

/**
 * A producing hex lights up once the dice have landed: three soft pulses.
 * `glow` is the roll's id (0 for none), so the same hex producing on two
 * consecutive rolls still pulses twice. Returns intensity 0..1 for time t.
 */
function useGlow(glow: number) {
  const start = useRef<number | 'next' | null>(null);
  useEffect(() => {
    start.current = glow > 0 && !reducedMotion ? 'next' : null;
  }, [glow]);
  return (t: number) => {
    if (start.current === null) return 0;
    if (start.current === 'next') start.current = t + DICE_TIME;
    const p = (t - start.current) / GLOW_TIME;
    if (p >= 1) {
      start.current = null;
      return 0;
    }
    if (p < 0) return 0;
    return Math.sin(p * Math.PI * 3) ** 2 * (1 - p * 0.5);
  };
}
const CLEAR = new THREE.Color('#ffffff');

/**
 * One tile. Its own top material (so the robber can grey out just this hex),
 * and it falls into place during the opening.
 */
export function HexTile({ id, terrain, robbed, glow }: { id: HexId; terrain: Terrain; robbed: boolean; glow: number }) {
  const [x, z] = hexWorld(id);
  const mesh = useRef<THREE.Mesh>(null);
  const top = useMemo(
    () => new THREE.MeshStandardMaterial({ map: groundTexture(terrain), roughness: 0.95, emissive: GLOW_COLOR, emissiveIntensity: 0 }),
    [terrain],
  );
  useEffect(() => () => top.dispose(), [top]);
  const pulse = useGlow(glow);
  const landed = useRef(false);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    // Keep placing until landed, even if a stalled frame (background tab) jumps past the opening.
    if (mesh.current && !landed.current) {
      mesh.current.position.y = tileLift(id, t);
      landed.current = t > TILES_DONE;
    }
    top.color.lerp(robbed ? ROBBED : CLEAR, Math.min(1, dt * 5));
    top.emissiveIntensity = pulse(t) * 0.8;
  });
  return (
    <mesh
      ref={mesh}
      geometry={tileGeometry}
      material={[top, tileSide]}
      position={[x, tileLift(id, 0), z]}
      castShadow
      receiveShadow
    />
  );
}

const TOKEN_R = 0.3;
const TOKEN_H = 0.05;
const tokenBody = new THREE.CylinderGeometry(TOKEN_R, TOKEN_R * 1.02, TOKEN_H, 40);
const tokenEdge = new THREE.MeshStandardMaterial({ color: '#b8a47e', roughness: 0.8 });
const tokenFace = new THREE.CircleGeometry(TOKEN_R * 0.98, 40).rotateX(-Math.PI / 2);

/** A raised cardboard disc; the face is a flat decal so the numeral stays upright to the camera. */
export function NumberToken({ hex, token, glow }: { hex: HexId; token: number; glow: number }) {
  const [x, z] = hexWorld(hex);
  const group = useRef<THREE.Group>(null);
  const pulse = useGlow(glow);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!group.current) return;
    if (t <= INTRO_DONE + 0.1) {
      group.current.position.y = Y.tileTop + tileLift(hex, t);
      group.current.scale.setScalar(tokenScale(hex, t));
      return;
    }
    // The rolled number lifts and swells with its tile's pulse.
    const k = pulse(t);
    group.current.position.y = Y.tileTop + k * 0.12;
    group.current.scale.setScalar(1 + k * 0.25);
  });
  return (
    <group ref={group} position={[x, Y.tileTop, z]} scale={tokenScale(hex, 0)}>
      <mesh geometry={tokenBody} material={tokenEdge} position-y={TOKEN_H / 2} castShadow />
      <mesh geometry={tokenFace} position-y={TOKEN_H + 0.001}>
        <meshStandardMaterial map={tokenTexture(token)} roughness={0.85} />
      </mesh>
    </group>
  );
}

/**
 * The frame is what a real box's frame is: a (possibly squashed) flat-top hexagon of wood with the
 * jagged coastline cut out of it. A darker plinth under everything gives the
 * board a visible edge where it meets the water.
 */
export function Frame() {
  const { frame, plinth } = useMemo(() => {
    const shape = shapeFrom(frameOutline());
    shape.holes.push(shapeFrom([...COAST].reverse()));
    const frame = new THREE.ExtrudeGeometry(shape, {
      depth: Y.frameTop - 0.04,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    }).rotateX(-Math.PI / 2);
    frame.translate(0, 0.02, 0);
    const plinth = new THREE.ExtrudeGeometry(shapeFrom(frameOutline(0.07)), {
      depth: 0.4,
      bevelEnabled: false,
    }).rotateX(-Math.PI / 2);
    plinth.translate(0, -0.4, 0);
    return { frame, plinth };
  }, []);

  return (
    <>
      <mesh geometry={frame} castShadow receiveShadow>
        <meshStandardMaterial map={woodTexture()} roughness={0.7} />
      </mesh>
      <mesh geometry={plinth} receiveShadow>
        <meshStandardMaterial color="#2e1b0d" roughness={0.9} />
      </mesh>
    </>
  );
}

/** Every tile and chit. Keyed on values, not identity: the server sends a fresh board each action. */
export function Island({ board, glow, producing }: { board: BoardState; glow: number; producing: HexId[] }) {
  const lit = (h: HexId) => (producing.includes(h) ? glow : 0);
  const key =
    G.hexes.map((h) => `${board.hexes[h].terrain}${board.hexes[h].token}${lit(h)}`).join('|') + board.robber;
  return useMemo(
    () => (
      <group>
        {G.hexes.map((h) => (
          <HexTile key={h} id={h} terrain={board.hexes[h].terrain} robbed={board.robber === h} glow={lit(h)} />
        ))}
        {G.hexes.map((h) =>
          board.hexes[h].token !== null ? <NumberToken key={h} hex={h} token={board.hexes[h].token!} glow={lit(h)} /> : null,
        )}
      </group>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
}
