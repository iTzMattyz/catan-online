import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EdgeId, HexId, VertexId } from '../../shared/layout';
import { BOUNCE_CONTACT, clamp01, easeInOutCubic, easeOutBack, reducedMotion, useDrop } from './anim';
import { G, Y, hexWorld, toWorld, yawFromSvg } from './coords';

/**
 * A house: box walls plus a separate overhanging roof prism. Split in two so the
 * roof can take a darker shade of the player colour, which is what makes the
 * piece read as a building rather than a block from above.
 */
function house(w: number, h: number, roof: number, depth: number, x = 0) {
  const walls = new THREE.BoxGeometry(w * 2, h, depth).translate(x, h / 2, 0);
  const eave = w + 0.025;
  const s = new THREE.Shape();
  s.moveTo(-eave, 0);
  s.lineTo(eave, 0);
  s.lineTo(0, roof);
  s.closePath();
  const top = new THREE.ExtrudeGeometry(s, { depth: depth + 0.04, bevelEnabled: false }).translate(
    x,
    h - 0.005,
    -(depth + 0.04) / 2,
  );
  return { walls, roof: top };
}

const SETTLEMENT = house(0.12, 0.14, 0.13, 0.2);
const CITY_HALL = house(0.1, 0.13, 0.1, 0.24, -0.13);
const CITY_TOWER = house(0.11, 0.27, 0.13, 0.24, 0.09);
const ROAD = new THREE.BoxGeometry(0.6, 0.09, 0.12).translate(0, 0.045, 0);

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function paint(color: string, shade = 1): THREE.MeshStandardMaterial {
  const key = `${color}/${shade}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(shade), roughness: 0.55 });
    materials.set(key, m);
  }
  return m;
}

const ROOF_SHADE = 0.62;

function House({ parts, color }: { parts: ReturnType<typeof house>; color: string }) {
  return (
    <>
      <mesh geometry={parts.walls} material={paint(color)} castShadow receiveShadow />
      <mesh geometry={parts.roof} material={paint(color, ROOF_SHADE)} castShadow receiveShadow />
    </>
  );
}

const DROP_TIME = 0.8;

// --------------------------------------------------------------- dust ---

const PUFF = new THREE.IcosahedronGeometry(1, 0);
const PUFFS = 9;

/** A ring of dust kicked up where a piece lands. Plays once, `delay` seconds after mounting. */
function Dust({ delay, radius = 0.2 }: { delay: number; radius?: number }) {
  const group = useRef<THREE.Group>(null);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#d9c8a6', roughness: 1, transparent: true, depthWrite: false }),
    [],
  );
  const start = useRef<number | null>(null);
  const done = useRef(false);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || done.current) return;
    if (start.current === null) start.current = clock.elapsedTime + delay;
    const t = clock.elapsedTime - start.current;
    const p = clamp01(t / 0.75);
    g.visible = t >= 0 && p < 1;
    if (p >= 1) done.current = true;
    const spread = 1 - Math.pow(1 - p, 3);
    g.children.forEach((c, i) => {
      const a = (i / PUFFS) * Math.PI * 2 + i * 0.4;
      const r = radius + spread * 0.28;
      c.position.set(Math.cos(a) * r, 0.03 + p * 0.12, Math.sin(a) * r);
      c.scale.setScalar(0.035 + p * 0.04);
    });
    material.opacity = 0.7 * (1 - p);
  });
  if (reducedMotion) return null;
  return (
    <group ref={group} visible={false}>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={i} geometry={PUFF} material={material} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------ buildings ---

/*
 * Buildings are turned to face the camera's default view: a slight yaw off
 * square, so both the gable and a side wall catch the light.
 */
const FACE_YAW = -0.35;
const UPGRADE_TIME = 0.8;

/**
 * One building spot. It stays mounted when a settlement becomes a city, so the
 * upgrade can animate: the house sinks away and the city grows out of it.
 */
export function Building({
  vertex,
  color,
  type,
  delay,
}: {
  vertex: VertexId;
  color: string;
  type: 'settlement' | 'city';
  delay: number;
}) {
  const [x, z] = toWorld(G.vertices[vertex].pos);
  const drop = useRef<THREE.Group>(null);
  const houseRef = useRef<THREE.Group>(null);
  const city = useRef<THREE.Group>(null);
  const upgradeAt = useRef<number | 'next' | null>(null);
  const [upgrades, setUpgrades] = useState(0);
  const previous = useRef(type);
  useDrop(drop, delay);

  useEffect(() => {
    if (previous.current === 'settlement' && type === 'city') {
      upgradeAt.current = 'next';
      setUpgrades((n) => n + 1);
    }
    previous.current = type;
  }, [type]);

  useFrame(({ clock }) => {
    if (upgradeAt.current === null) return;
    if (upgradeAt.current === 'next') upgradeAt.current = clock.elapsedTime;
    const p = reducedMotion ? 1 : clamp01((clock.elapsedTime - upgradeAt.current) / UPGRADE_TIME);
    if (houseRef.current) {
      const q = clamp01(p * 2.5);
      houseRef.current.scale.set(1 - q * 0.4, Math.max(0.0001, 1 - q), 1 - q * 0.4);
      houseRef.current.visible = q < 1;
    }
    if (city.current) city.current.scale.setScalar(Math.max(0.0001, easeOutBack(clamp01((p - 0.25) / 0.75))));
    if (p >= 1) upgradeAt.current = null;
  });

  const upgrading = upgrades > 0 && type === 'city';
  return (
    <group position={[x, Y.tileTop, z]} rotation-y={FACE_YAW}>
      <group ref={drop} visible={false}>
        {(type === 'settlement' || upgrading) && (
          <group ref={houseRef}>
            <House parts={SETTLEMENT} color={color} />
          </group>
        )}
        {type === 'city' && (
          <group ref={city} scale={upgrading ? 0.0001 : 1}>
            <House parts={CITY_HALL} color={color} />
            <House parts={CITY_TOWER} color={color} />
          </group>
        )}
      </group>
      <Dust delay={delay + DROP_TIME * BOUNCE_CONTACT} />
      {upgrades > 0 && <Dust key={upgrades} delay={0.2} radius={0.28} />}
    </group>
  );
}

export function RoadPiece({ edge, color, delay }: { edge: EdgeId; color: string; delay: number }) {
  const info = G.edges[edge];
  const [x, z] = toWorld(info.pos);
  const drop = useRef<THREE.Group>(null);
  useDrop(drop, delay, 1.3);
  return (
    <group position={[x, Y.tileTop, z]} rotation-y={yawFromSvg(info.angle)}>
      <group ref={drop} visible={false}>
        <mesh geometry={ROAD} material={paint(color)} castShadow receiveShadow />
      </group>
      <Dust delay={delay + DROP_TIME * BOUNCE_CONTACT} radius={0.12} />
    </group>
  );
}

// -------------------------------------------------------------- robber ---

/** A turned pawn, set beside the chit so the number it blocks stays readable. */
const ROBBER = new THREE.LatheGeometry(
  [
    [0.0, 0.0],
    [0.15, 0.0],
    [0.15, 0.04],
    [0.11, 0.06],
    [0.09, 0.16],
    [0.11, 0.22],
    [0.07, 0.26],
    [0.1, 0.33],
    [0.09, 0.4],
    [0.05, 0.44],
    [0.0, 0.45],
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  24,
);
const robberPaint = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.45, metalness: 0.1 });

/** Offset from the hex centre, matching the 2D board. */
const ROBBER_OFFSET: [number, number] = [-0.43, 0.17];
const robberSpot = (hex: HexId): [number, number] => {
  const [x, z] = hexWorld(hex);
  return [x + ROBBER_OFFSET[0], z + ROBBER_OFFSET[1]];
};

const HOP_TIME = 0.9;

/** The robber hops from hex to hex in an arc, spinning once, rather than teleporting. */
export function RobberPiece({ hex, delay }: { hex: HexId; delay: number }) {
  const outer = useRef<THREE.Group>(null);
  const drop = useRef<THREE.Group>(null);
  const hop = useRef<{ from: [number, number]; to: [number, number]; at: number | null } | null>(null);
  const shown = useRef(hex);
  useDrop(drop, delay, 2.2, 1);

  useLayoutEffect(() => {
    const g = outer.current!;
    if (shown.current === hex) {
      const [x, z] = robberSpot(hex);
      g.position.set(x, Y.tileTop, z);
      return;
    }
    hop.current = { from: [g.position.x, g.position.z], to: robberSpot(hex), at: null };
    shown.current = hex;
  }, [hex]);

  useFrame(({ clock }) => {
    const g = outer.current;
    const h = hop.current;
    if (!g || !h) return;
    if (h.at === null) h.at = clock.elapsedTime;
    const p = reducedMotion ? 1 : clamp01((clock.elapsedTime - h.at) / HOP_TIME);
    const e = easeInOutCubic(p);
    g.position.set(
      h.from[0] + (h.to[0] - h.from[0]) * e,
      Y.tileTop + Math.sin(Math.PI * p) * 1.1,
      h.from[1] + (h.to[1] - h.from[1]) * e,
    );
    g.rotation.y = e * Math.PI * 2;
    if (p >= 1) hop.current = null;
  });

  return (
    <group ref={outer}>
      <group ref={drop} visible={false}>
        <mesh geometry={ROBBER} material={robberPaint} castShadow />
      </group>
    </group>
  );
}
