import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion } from './anim';

/*
 * Life around the board that is not the game: cloud shadows drifting over the
 * island and a few gulls circling the water. None of it is interactive.
 */

/**
 * Clouds are never drawn, only their shadows are: the camera looks down through
 * where they would be, and a white blob in front of the board would hide it.
 */
const cloudMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const puff = new THREE.IcosahedronGeometry(1, 1);

const CLOUDS = [
  { speed: 0.16, z: -1.5, offset: 11, puffs: [[0, 0, 1.1], [0.9, 0.1, 0.8], [-0.9, -0.1, 0.75]] },
  { speed: 0.12, z: 2.5, offset: 3, puffs: [[0, 0, 0.9], [0.8, 0.2, 0.7], [-0.6, 0.1, 0.6], [0.2, -0.5, 0.5]] },
] as const;
const SPAN = 26;

export function CloudShadows() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    CLOUDS.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      // Wrap around well outside the board so clouds enter and leave off-stage.
      g.position.x = ((clock.elapsedTime * c.speed + c.offset) % SPAN) - SPAN / 2;
    });
  });
  if (reducedMotion) return null;
  return (
    <>
      {CLOUDS.map((c, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} position={[-SPAN / 2, 6, c.z]}>
          {c.puffs.map(([x, z, r], j) => (
            <mesh key={j} geometry={puff} material={cloudMaterial} position={[x, 0, z]} scale={[r, r * 0.35, r * 0.8]} castShadow />
          ))}
        </group>
      ))}
    </>
  );
}

const wing = (() => {
  const g = new THREE.BufferGeometry();
  // One wing: a thin swept triangle from the body out to the tip.
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.03, 0, 0, 0.05, 0.16, 0, -0.04], 3));
  g.computeVertexNormals();
  return g;
})();
const gullWhite = new THREE.MeshStandardMaterial({ color: '#f3f5f7', side: THREE.DoubleSide, roughness: 0.8 });

// Wide, low circles: out over open water, never between the camera and the board for long.
const GULLS = [
  { radius: 8.2, height: 1.4, speed: 0.2, phase: 0 },
  { radius: 8.7, height: 1.6, speed: 0.2, phase: 0.14 },
  { radius: 7.8, height: 1.3, speed: 0.2, phase: 0.27 },
  { radius: 9.5, height: 1.8, speed: -0.15, phase: 2.4 },
];

/** A few gulls wheeling over the sea around the island, flapping now and then. */
export function Gulls() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const flaps = useMemo(() => GULLS.map(() => ({ left: null as THREE.Mesh | null, right: null as THREE.Mesh | null })), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    GULLS.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const a = t * b.speed + b.phase;
      g.position.set(Math.cos(a) * b.radius, b.height + Math.sin(t * 0.7 + i) * 0.15, Math.sin(a) * b.radius * 0.8);
      // Face along the direction of travel.
      g.rotation.y = -a + (b.speed > 0 ? 0 : Math.PI);
      // Flap in bursts, glide in between.
      const burst = Math.max(0, Math.sin(t * 0.6 + i * 1.7));
      const flap = Math.sin(t * 14 + i) * 0.6 * burst + 0.15;
      if (flaps[i].left) flaps[i].left.rotation.z = flap;
      if (flaps[i].right) flaps[i].right.rotation.z = -flap;
    });
  });
  if (reducedMotion) return null;
  return (
    <>
      {GULLS.map((_, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} scale={0.85}>
          <mesh ref={(m) => (flaps[i].left = m)} geometry={wing} material={gullWhite} castShadow />
          <mesh ref={(m) => (flaps[i].right = m)} geometry={wing} material={gullWhite} scale-x={-1} castShadow />
        </group>
      ))}
    </>
  );
}
