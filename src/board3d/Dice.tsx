import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { clamp01, easeOutBounce, reducedMotion } from './anim';
import { Y, frameOutline } from './coords';
import { seedFrom } from '../board/terrain';

const SIZE = 0.34;
export const DICE_TIME = 1.1;

/** Pip grid positions (thirds of the face) for each value. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function faceTexture(value: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f1e3';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = value === 1 ? '#a8281f' : '#1f2328';
  for (const [r, c] of PIPS[value]) {
    ctx.beginPath();
    ctx.arc(28 + c * 36, 28 + r * 36, value === 1 ? 15 : 11, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Box face order is +x, -x, +y, -y, +z, -z; opposite faces sum to seven. */
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

/** Rotation that brings each value's face to the top. */
const FACE_UP: Record<number, THREE.Quaternion> = (() => {
  const q = (axis: [number, number, number], angle: number) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), angle);
  return {
    1: new THREE.Quaternion(),
    6: q([1, 0, 0], Math.PI),
    2: q([1, 0, 0], -Math.PI / 2),
    5: q([1, 0, 0], Math.PI / 2),
    3: q([0, 0, 1], Math.PI / 2),
    4: q([0, 0, 1], -Math.PI / 2),
  };
})();

let shared: { geometry: THREE.BufferGeometry; materials: THREE.Material[] } | null = null;
function dieParts() {
  shared ??= {
    geometry: new RoundedBoxGeometry(SIZE, SIZE, SIZE, 3, 0.035),
    materials: FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35 })),
  };
  return shared;
}

/** The dice rest on the wide corner of the frame to the right of the island, clear of every number. */
const rest = (): [number, number][] => {
  const corner = frameOutline()[0][0];
  return [
    [corner - 0.55, -0.23],
    [corner - 0.45, 0.24],
  ];
};
const REST_Y = Y.frameTop + SIZE / 2;

type Throw = { from: THREE.Vector3; to: THREE.Vector3; end: THREE.Quaternion; axis: THREE.Vector3; spin: number };

function Die({ index, value, rollId }: { index: number; value: number; rollId: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const start = useRef<number | 'next' | null>(null);
  const parts = dieParts();

  const plan = useMemo<Throw>(() => {
    const r = seedFrom(`dice-${rollId}-${index}`);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    const [x, z] = rest()[index];
    return {
      from: new THREE.Vector3(x + 2.6 + r(), 2.6 + r(), z + 1.8 + r() * 1.5),
      to: new THREE.Vector3(x, REST_Y, z),
      end: yaw.multiply(FACE_UP[value]),
      axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
      spin: Math.PI * (5 + r() * 3),
    };
  }, [rollId, index, value]);

  useLayoutEffect(() => {
    // rollId 0 means "just show the current dice, no throw" (e.g. after a reload).
    start.current = rollId > 0 && !reducedMotion ? 'next' : null;
    if (start.current === null && mesh.current) {
      mesh.current.position.copy(plan.to);
      mesh.current.quaternion.copy(plan.end);
    }
  }, [plan, rollId]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || start.current === null) return;
    if (start.current === 'next') start.current = clock.elapsedTime + index * 0.08;
    const p = clamp01((clock.elapsedTime - start.current) / DICE_TIME);
    const glide = 1 - Math.pow(1 - p, 3);
    m.position.lerpVectors(plan.from, plan.to, glide);
    m.position.y = plan.to.y + (plan.from.y - plan.to.y) * (1 - easeOutBounce(p));
    const tumble = new THREE.Quaternion().setFromAxisAngle(plan.axis, plan.spin * Math.pow(1 - p, 2));
    m.quaternion.copy(plan.end).multiply(tumble);
    if (p >= 1) start.current = null;
  });

  return <mesh ref={mesh} geometry={parts.geometry} material={parts.materials} castShadow position={plan.from} />;
}

/** Two dice, thrown onto the frame whenever `rollId` changes. Hidden while nobody has rolled. */
export function Dice({ dice, rollId }: { dice: [number, number] | null; rollId: number }) {
  if (!dice) return null;
  return (
    <group>
      <Die index={0} value={dice[0]} rollId={rollId} />
      <Die index={1} value={dice[1]} rollId={rollId} />
    </group>
  );
}
