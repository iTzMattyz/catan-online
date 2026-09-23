import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Port, PortType } from '../../shared/types';
import { reducedMotion } from './anim';
import { G, Y, edgeOutward, frameDist, toWorld } from './coords';
import { waveHeight } from './Ocean';
import { portTexture } from './textures';

/*
 * A harbour is a jetty: two short ramps from the coast corners that trade there,
 * joining a pier that runs out across the frame to a dock standing in the water.
 * A sign on the dock always turns to face you, and a boat is moored alongside.
 */

const DECK = Y.frameTop + 0.03;
const WATER_GAP = 0.45;

const wood = new THREE.MeshStandardMaterial({ color: '#9b7249', roughness: 0.85 });
const darkWood = new THREE.MeshStandardMaterial({ color: '#5b3d22', roughness: 0.9 });
const plank = new THREE.BoxGeometry(1, 0.035, 1);
const post = new THREE.CylinderGeometry(0.022, 0.026, 1, 6).translate(0, -0.5, 0);
const signBack = new THREE.CircleGeometry(0.25, 32);
const signRim = new THREE.RingGeometry(0.25, 0.28, 32);
const pole = new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6).translate(0, 0.17, 0);

/** Where along the edge's outward normal the dock stands: just past the frame, in open water. */
function dockDistance(mx: number, mz: number, nx: number, nz: number): number {
  let d = 0;
  while (frameDist(mx + nx * d, mz + nz * d) < WATER_GAP) d += 0.02;
  return d;
}

/** A plank laid from a to b (world xz) at deck height. */
function Beam({ a, b, width, y = DECK }: { a: [number, number]; b: [number, number]; width: number; y?: number }) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return (
    <mesh
      geometry={plank}
      material={wood}
      position={[(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2]}
      rotation-y={-Math.atan2(b[1] - a[1], b[0] - a[0])}
      scale={[len, 1, width]}
      castShadow
      receiveShadow
    />
  );
}

const SAIL: Record<PortType, string> = {
  any: '#f4efe2',
  brick: '#d9794a',
  lumber: '#4fae6e',
  wool: '#b5d86a',
  grain: '#f0c75a',
  ore: '#a9b7c6',
};

const hull = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.05);
  s.lineTo(0.24, 0.05);
  s.lineTo(0.15, -0.035);
  s.lineTo(-0.16, -0.035);
  s.closePath();
  // Sits high: most of the hull rides above the swell so the boat reads from the camera.
  return new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: false }).translate(0, 0.03, -0.065);
})();
const sail = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 0.3);
  s.lineTo(0.17, 0.02);
  s.closePath();
  return new THREE.ShapeGeometry(s).translate(-0.02, 0.1, 0);
})();
const mast = new THREE.CylinderGeometry(0.01, 0.012, 0.36, 5).translate(-0.02, 0.23, 0);
// Painted light: a dark hull disappears against deep water.
const hullPaint = new THREE.MeshStandardMaterial({ color: '#efe4cc', roughness: 0.6 });

/** A small boat riding the same swell the ocean shader draws, rolling a little with it. */
function Boat({ at, heading, color }: { at: [number, number]; heading: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  const sailPaint = useMemo(
    // A touch of self-light: a sail's colour has to read at a glance, even on its shaded side.
    () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.9, side: THREE.DoubleSide }),
    [color],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    const [x, z] = at;
    g.position.y = Y.sea + waveHeight(x, z, t);
    // Tilt by the local slope of the swell.
    g.rotation.z = (waveHeight(x + 0.2, z, t) - waveHeight(x - 0.2, z, t)) * 1.6;
    g.rotation.x = (waveHeight(x, z + 0.2, t) - waveHeight(x, z - 0.2, t)) * -1.6;
  });
  return (
    <group position={[at[0], Y.sea, at[1]]}>
      <group ref={ref}>
        <group rotation-y={heading} scale={2}>
          <mesh geometry={hull} material={hullPaint} castShadow />
          <mesh geometry={mast} material={darkWood} castShadow />
          <mesh geometry={sail} material={sailPaint} castShadow />
        </group>
      </group>
    </group>
  );
}

export function Harbour({ port }: { port: Port }) {
  const info = G.edges[port.edge];
  const [mx, mz] = toWorld(info.pos);
  const [nx, nz] = edgeOutward(info.pos, info.angle);
  // Along the coast, perpendicular to the pier.
  const [tx, tz] = [-nz, nx];

  const d = dockDistance(mx, mz, nx, nz);
  const dock: [number, number] = [mx + nx * d, mz + nz * d];
  const fork: [number, number] = [mx + nx * 0.28, mz + nz * 0.28];
  const [a, b] = port.vertices.map((v) => toWorld(G.vertices[v].pos));
  const yaw = -Math.atan2(nz, nx);

  // Posts at the dock's four corners and one under the pier where it leaves the frame, all down into the sea.
  const posts: [number, number][] = [
    [0.17, 0.17],
    [0.17, -0.17],
    [-0.17, 0.17],
    [-0.17, -0.17],
  ].map(([u, v]) => [dock[0] + nx * u + tx * v, dock[1] + nz * u + tz * v]);
  posts.push([mx + nx * (d - 0.32), mz + nz * (d - 0.32)]);
  const postDepth = DECK - Y.sea + 0.2;

  return (
    <group>
      <Beam a={a} b={fork} width={0.07} />
      <Beam a={b} b={fork} width={0.07} />
      <Beam a={fork} b={dock} width={0.13} />
      {/* The dock: a square deck turned square to the pier. */}
      <mesh
        geometry={plank}
        material={wood}
        position={[dock[0], DECK + 0.005, dock[1]]}
        rotation-y={yaw}
        scale={[0.42, 1.2, 0.42]}
        castShadow
        receiveShadow
      />
      {posts.map(([x, z], i) => (
        <mesh key={i} geometry={post} material={darkWood} position={[x, DECK, z]} scale-y={postDepth} castShadow />
      ))}

      <group position={[dock[0], DECK, dock[1]]}>
        <mesh geometry={pole} material={darkWood} castShadow />
        <Billboard position-y={0.56}>
          <mesh geometry={signRim} material={darkWood} />
          <mesh geometry={signBack}>
            <meshStandardMaterial map={portTexture(port.type)} roughness={0.6} />
          </mesh>
        </Billboard>
      </group>

      <Boat
        at={[dock[0] + tx * 0.62 + nx * 0.1, dock[1] + tz * 0.62 + nz * 0.1]}
        // Moored side-on along the coast, so the sail faces out and catches the eye.
        heading={yaw + Math.PI / 2}
        color={SAIL[port.type]}
      />
    </group>
  );
}
