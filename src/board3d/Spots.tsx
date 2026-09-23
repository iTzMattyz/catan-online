import { useEffect, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { EdgeId, HexId, VertexId } from '../../shared/layout';
import { TILES_DONE } from './anim';
import { G, Y, hexWorld, toWorld, yawFromSvg } from './coords';

/*
 * Legal-move markers. Only spots the server listed are ever drawn, so a click
 * can never be illegal. Each spot has a generous invisible hit volume and a
 * small glowing marker, and one shared material pulses them all.
 */

const glow = new THREE.MeshStandardMaterial({
  color: '#ffd66e',
  emissive: '#ffb020',
  emissiveIntensity: 0.8,
  roughness: 0.4,
  transparent: true,
});
const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

const VERTEX_MARK = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 24);
const VERTEX_HIT = new THREE.CylinderGeometry(0.24, 0.24, 0.4, 12);
const EDGE_MARK = new THREE.CapsuleGeometry(0.045, 0.4, 4, 12).rotateZ(Math.PI / 2);
const EDGE_HIT = new THREE.BoxGeometry(0.55, 0.3, 0.26);
const HEX_RING = new THREE.RingGeometry(0.8, 0.9, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);
const HEX_HIT = new THREE.CylinderGeometry(0.95, 0.95, 0.3, 6);

/** Pulse every marker, and keep them hidden until the opening has laid the tiles. */
function usePulse(group: React.RefObject<THREE.Group>) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) group.current.visible = t >= TILES_DONE;
    glow.emissiveIntensity = 0.9 + 0.5 * Math.sin(t * 4);
    glow.opacity = 0.85 + 0.15 * Math.sin(t * 4);
  });
}

/** A click that ends a camera drag isn't a click. */
const isTap = (e: ThreeEvent<MouseEvent>) => e.delta < 6;

function useHover() {
  const [hover, setHover] = useState(false);
  // A spot can vanish under the pointer (the move was made, or the turn moved on).
  useEffect(() => () => void (document.body.style.cursor = ''), []);
  return {
    hover,
    bind: {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      },
      onPointerOut: () => {
        setHover(false);
        document.body.style.cursor = '';
      },
    },
  };
}

function Spot({
  position,
  yaw = 0,
  hit,
  mark,
  lift,
  label,
  onPick,
}: {
  position: [number, number, number];
  yaw?: number;
  hit: THREE.BufferGeometry;
  mark: THREE.BufferGeometry;
  lift: number;
  label: string;
  onPick: () => void;
}) {
  const { hover, bind } = useHover();
  return (
    <group position={position} rotation-y={yaw}>
      <mesh
        geometry={hit}
        material={hitMaterial}
        name={label}
        {...bind}
        onClick={(e) => {
          if (!isTap(e)) return;
          e.stopPropagation();
          document.body.style.cursor = '';
          onPick();
        }}
      />
      <mesh geometry={mark} material={glow} position-y={hover ? lift : 0} scale={hover ? 1.35 : 1} />
    </group>
  );
}

export function Spots({
  vertices,
  edges,
  hexes,
  onVertex,
  onEdge,
  onHex,
}: {
  vertices: VertexId[];
  edges: EdgeId[];
  hexes: HexId[];
  onVertex: (id: VertexId) => void;
  onEdge: (id: EdgeId) => void;
  onHex: (id: HexId) => void;
}) {
  const group = useRef<THREE.Group>(null);
  usePulse(group);
  return (
    <group ref={group}>
      {hexes.map((h) => {
        const [x, z] = hexWorld(h);
        return (
          <Spot
            key={h}
            label={`hex ${h}`}
            position={[x, Y.tileTop + 0.01, z]}
            hit={HEX_HIT}
            mark={HEX_RING}
            lift={0.04}
            onPick={() => onHex(h)}
          />
        );
      })}
      {edges.map((e) => {
        const info = G.edges[e];
        const [x, z] = toWorld(info.pos);
        return (
          <Spot
            key={e}
            label={`edge ${e}`}
            position={[x, Y.tileTop + 0.05, z]}
            yaw={yawFromSvg(info.angle)}
            hit={EDGE_HIT}
            mark={EDGE_MARK}
            lift={0.08}
            onPick={() => onEdge(e)}
          />
        );
      })}
      {vertices.map((v) => {
        const [x, z] = toWorld(G.vertices[v].pos);
        return (
          <Spot
            key={v}
            label={`vertex ${v}`}
            position={[x, Y.tileTop + 0.03, z]}
            hit={VERTEX_HIT}
            mark={VERTEX_MARK}
            lift={0.1}
            onPick={() => onVertex(v)}
          />
        );
      })}
    </group>
  );
}
