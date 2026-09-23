import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FRAME_B, FRAME_Z, Y } from './coords';

/** The same swell as the vertex shader below, in world coordinates, for things that float. */
export function waveHeight(x: number, z: number, t: number): number {
  return (
    Math.sin(x * 0.9 + t * 0.8) * 0.035 + Math.sin(-z * 1.3 - t * 0.6) * 0.03 + Math.sin((x - z) * 2.1 + t * 1.4) * 0.012
  );
}

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vXZ;
  varying float vH;
  void main() {
    vec3 p = position;
    vXZ = p.xy;
    float h = sin(p.x * 0.9 + uTime * 0.8) * 0.035
            + sin(p.y * 1.3 - uTime * 0.6) * 0.03
            + sin((p.x + p.y) * 2.1 + uTime * 1.4) * 0.012;
    p.z += h;
    vH = h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

/*
 * Colour is painted, not lit: deep water far out, shallower teal against the
 * frame, drifting glints on the swell crests and a breaking foam line that hugs
 * the frame's hexagon.
 */
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uFrameZ;
  uniform float uFrameB;
  varying vec2 vXZ;
  varying float vH;
  float frameDist(vec2 p) { p = abs(p); return max(p.y - uFrameZ, p.x * 0.866 + p.y * 0.5 - uFrameB); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 p = vec2(vXZ.x, -vXZ.y);
    float d = frameDist(p);
    vec3 deep = vec3(0.03, 0.14, 0.22);
    vec3 shallow = vec3(0.09, 0.42, 0.52);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 4.5, d));
    col += vec3(0.25, 0.35, 0.4) * smoothstep(0.03, 0.07, vH) * 0.35;
    float n = noise(p * 3.0 + vec2(uTime * 0.3, -uTime * 0.2));
    float band = 0.18 + 0.08 * sin(uTime * 1.3 + n * 6.0);
    float foam = (1.0 - smoothstep(0.0, band, d)) * step(0.0, d) * smoothstep(0.35, 0.7, n + 0.25);
    foam += (1.0 - smoothstep(0.0, 0.05, abs(d - 0.32 - 0.05 * sin(uTime * 0.9 + n * 4.0)))) * 0.35 * n;
    col = mix(col, vec3(0.92, 0.97, 1.0), clamp(foam, 0.0, 0.9));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function Ocean() {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFrameZ: { value: FRAME_Z + 0.08 }, uFrameB: { value: FRAME_B + 0.08 } }), []);
  useFrame(({ clock }) => {
    // The canvas clock, not accumulated dt, so boats computing waveHeight() stay in step.
    if (material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={Y.sea}>
      <planeGeometry args={[80, 80, 160, 160]} />
      <shaderMaterial ref={material} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} />
    </mesh>
  );
}
