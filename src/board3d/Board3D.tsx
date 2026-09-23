import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BoardProps } from '../board/Board';
import { frameRadius, setActiveMap } from './coords';
import { Decor } from './Decor';
import { Ocean } from './Ocean';
import { Harbour } from './Harbours';
import { INTRO_DONE } from './anim';
import { Building, RoadPiece, RobberPiece } from './Pieces';
import { Spots } from './Spots';
import { Dice } from './Dice';
import { setHexProjector } from '../fx/projector';
import * as THREE from 'three';
import { Y, hexWorld } from './coords';
import { Frame, Island } from './Tiles';
import { CloudShadows, Gulls } from './Ambient';
import { reducedMotion } from './anim';

const FOV = 32;
/** Default tilt: angle down from straight overhead. */
const POLAR = 0.62;
/** Radius of the whole board including the frame, plus the docks standing out in the water. */
const boardRadius = () => frameRadius() + 0.3;

/**
 * Put the camera where the whole board fits the canvas, whatever its shape.
 * Narrow canvases are bound by the horizontal field of view instead of the
 * vertical one, so phones back the camera off rather than cropping the island.
 */
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const half = Math.tan(((FOV / 2) * Math.PI) / 180);
    // The tilt foreshortens the board's depth, so it can sit closer than a flat fit.
    const distance = (boardRadius() * 0.98) / (half * Math.min(1, aspect));
    camera.position.set(0, distance * Math.cos(POLAR), distance * Math.sin(POLAR));
    camera.lookAt(0, 0, 0.25);
    const c = controls.current;
    if (c) {
      c.target.set(0, 0, 0.25);
      c.minDistance = distance * 0.45;
      c.maxDistance = distance * 1.3;
      c.update();
      c.saveState();
    }
  }, [camera, size.width, size.height, controls]);
  return null;
}

/** Lets the DOM overlay ask where a hex is on screen (for cards flying off it). */
function HexProjector() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const v = new THREE.Vector3();
    setHexProjector((hex) => {
      const [x, z] = hexWorld(hex);
      v.set(x, Y.tileTop, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
    return () => setHexProjector(null);
  }, [camera, gl]);
  return null;
}

/**
 * Once somebody wins, the camera lets go of its limits and circles the island,
 * dipping lower for a showcase view while the confetti falls.
 */
function WinSwoop({ controls, active }: { controls: React.RefObject<OrbitControlsImpl>; active: boolean }) {
  const { camera } = useThree();
  useFrame((_, dt) => {
    const c = controls.current;
    if (!active || !c || reducedMotion) return;
    c.enabled = false;
    c.minAzimuthAngle = -Infinity;
    c.maxAzimuthAngle = Infinity;
    const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(c.target));
    const home = c.minDistance / 0.45;
    const k = Math.min(1, dt * 0.8);
    orbit.theta += dt * 0.3;
    orbit.phi += (0.92 - orbit.phi) * k;
    orbit.radius += (home * 0.92 - orbit.radius) * k;
    camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(orbit));
    camera.lookAt(c.target);
  });
  return null;
}

export default function Board3D({ view, pending, onVertex, onEdge, onHex, roll }: BoardProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { board, moves } = view;
  // Before any child renders: they all read the island's shape from coords.
  setActiveMap(board.map);
  // Fog and shadows were tuned on the base island; stretch them for bigger ones.
  const scale = boardRadius() / 5.5;
  const colorOf = (id: string) => view.players.find((p) => p.id === id)?.color ?? '#888';

  const vertexSpots = pending === 'settlement' ? moves.settlementSpots : pending === 'city' ? moves.citySpots : [];
  const edgeSpots = pending === 'road' ? moves.roadSpots : [];
  const hexSpots = pending === 'robber' ? moves.robberSpots : [];

  const resetView = useCallback(() => controls.current?.reset(), []);

  // Pieces already on the board when it first appears land with the opening;
  // anything placed afterwards drops in the moment it arrives.
  const [atLoad] = useState(() => new Set([...Object.keys(board.roads), ...Object.keys(board.buildings)]));
  const delayFor = (key: string) => (atLoad.has(key) ? INTRO_DONE : 0);

  return (
    <div className="board3d">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: FOV, near: 0.5, far: 120, position: [0, 12, 8] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        aria-label="Catan board"
      >
        <color attach="background" args={['#0a2231']} />
        <fog attach="fog" args={['#0a2231', 16 * scale, 40 * scale]} />

        <hemisphereLight args={['#fff1d6', '#1d4256', 1.1]} />
        {/* The sun, upper left, as on the painted 2D board. */}
        <directionalLight
          position={[-6, 11, -5]}
          intensity={2.6}
          color="#ffe8c4"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-7 * scale}
          shadow-camera-right={7 * scale}
          shadow-camera-top={7 * scale}
          shadow-camera-bottom={-7 * scale}
          shadow-camera-near={1}
          shadow-camera-far={30}
        />

        <Ocean />
        <Frame />
        <Island board={board} glow={roll?.id ?? 0} producing={roll?.producing ?? []} />
        <Decor board={board} />
        {board.ports.map((p) => (
          <Harbour key={p.edge} port={p} />
        ))}

        {Object.entries(board.roads).map(([edge, road]) => (
          <RoadPiece key={edge} edge={edge} color={colorOf(road.owner)} delay={delayFor(edge)} />
        ))}
        {Object.entries(board.buildings).map(([vertex, b]) => (
          <Building key={vertex} vertex={vertex} color={colorOf(b.owner)} type={b.type} delay={delayFor(vertex)} />
        ))}
        <RobberPiece hex={board.robber} delay={INTRO_DONE} />
        <Dice dice={view.dice} rollId={roll?.id ?? 0} />
        <HexProjector />
        <CloudShadows />
        <Gulls />

        <Spots
          vertices={vertexSpots}
          edges={edgeSpots}
          hexes={hexSpots}
          onVertex={onVertex}
          onEdge={onEdge}
          onHex={onHex}
        />

        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.15}
          maxPolarAngle={1.05}
          minAzimuthAngle={-Math.PI / 4}
          maxAzimuthAngle={Math.PI / 4}
          rotateSpeed={0.6}
        />
        <CameraRig controls={controls} />
        <WinSwoop controls={controls} active={!!view.winner} />
      </Canvas>

      <button className="board3d-reset" onClick={resetView} title="Reset view">
        Reset view
      </button>
    </div>
  );
}
