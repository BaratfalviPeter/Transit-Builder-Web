/**
 * Low-poly models of the interior machines and resource tiles (micro view).
 *
 * Units: 1 = one interior tile. Each machine model is centred on its
 * footprint (a size×size square) with its base on Y = 0, and faces +X
 * locally = its output direction; the caller rotates it (see rotY()).
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineKind, Resource, Rot } from '../sim';

type V3 = [number, number, number];

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

export const MAT = {
  frame: std('#4b5058'),
  frameLight: std('#7d828a'),
  belt: std('#2a2c30', { roughness: 1 }),
  chevron: std('#e6c34a', { emissive: '#6b5410', emissiveIntensity: 0.4 }),
  yellow: std('#e3b32b'),
  yellowDark: std('#b88a1c'),
  orange: std('#e0782f'),
  glass: std('#2e3d4a', { roughness: 0.3 }),
  track: std('#33363b'),
  steel: std('#8c9097'),
  green: std('#5d8a3a'),
  greenDark: std('#3f6428'),
  blade: std('#c9ced4', { metalness: 0.4, roughness: 0.4 }),
  wood: std('#9a6b3f'),
  log: std('#7a5233'),
  tank: std('#9aa0a6'),
  red: std('#c0392b'),
  blue: std('#3d6fb0'),
  panel: std('#55606e'),
  light: std('#9ef0a0', { emissive: '#3fd060', emissiveIntensity: 0.9 }),
  glow: std('#ffb34a', { emissive: '#ff7a1a', emissiveIntensity: 1.6 }),
  arrow: std('#ffffff', { transparent: true, opacity: 0.55 }),
  rock: std('#5a5550', { flatShading: true }),
  ore: std('#3f8fc4', { emissive: '#103a5a', emissiveIntensity: 0.35, flatShading: true }),
  trunk: std('#6b4a2e'),
  pine: std('#3f6b35', { flatShading: true }),
  oil: std('#14161a', { roughness: 0.15, metalness: 0.3 }),
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const ICO = new THREE.IcosahedronGeometry(1, 0);

function B({ p, s, m, cast = true }: { p: V3; s: V3; m: THREE.Material; cast?: boolean }) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} castShadow={cast} receiveShadow />;
}

/** Y rotation that turns a model's local +X output to `rot`. */
export const rotY = (rot: Rot) => (-rot * Math.PI) / 2;

/** Ground arrow showing where a machine outputs. */
function OutArrow({ size }: { size: number }) {
  return (
    <group position={[size / 2 + 0.06, 0.02, 0]}>
      <mesh material={MAT.arrow} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.13, 0.2, 3]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- machines

function Conveyor({ phase }: { phase: number }) {
  const chev = useRef<THREE.Group>(null);
  useFrame((s) => {
    const g = chev.current;
    if (!g) return;
    const t = ((s.clock.getElapsedTime() * 0.6 + phase) % 1) / 3;
    g.position.x = t;
  });
  return (
    <group>
      <B p={[0, 0.07, 0]} s={[1, 0.1, 0.72]} m={MAT.frame} />
      <B p={[0, 0.125, 0]} s={[1, 0.012, 0.56]} m={MAT.belt} cast={false} />
      <B p={[0, 0.15, 0.33]} s={[1, 0.05, 0.05]} m={MAT.yellow} />
      <B p={[0, 0.15, -0.33]} s={[1, 0.05, 0.05]} m={MAT.yellow} />
      {[-0.35, 0.35].map((x) => (
        <B key={x} p={[x, 0.03, 0]} s={[0.06, 0.06, 0.66]} m={MAT.frameLight} />
      ))}
      {/* Moving chevrons (clipped to the belt by staying within ±0.5) */}
      <group ref={chev}>
        {[-1 / 3, 0, 1 / 3].map((x) => (
          <group key={x} position={[x - 0.1, 0.134, 0]}>
            <B p={[0, 0, 0.1]} s={[0.05, 0.006, 0.22]} m={MAT.chevron} cast={false} />
            <B p={[0, 0, -0.1]} s={[0.05, 0.006, 0.22]} m={MAT.chevron} cast={false} />
          </group>
        ))}
      </group>
    </group>
  );
}

function Excavator({ phase }: { phase: number }) {
  const arm = useRef<THREE.Group>(null);
  const turret = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.getElapsedTime() + phase;
    if (turret.current) turret.current.rotation.y = Math.sin(t * 0.5) * 0.6;
    if (arm.current) arm.current.rotation.z = -0.35 + Math.sin(t * 1.1) * 0.25;
  });
  return (
    <group>
      {/* Tracks */}
      <B p={[0, 0.12, 0.42]} s={[1.3, 0.24, 0.3]} m={MAT.track} />
      <B p={[0, 0.12, -0.42]} s={[1.3, 0.24, 0.3]} m={MAT.track} />
      <group ref={turret} position={[0, 0.26, 0]}>
        <B p={[-0.1, 0.18, 0]} s={[0.9, 0.36, 0.8]} m={MAT.yellow} />
        <B p={[0.2, 0.48, -0.18]} s={[0.36, 0.3, 0.36]} m={MAT.yellow} />
        <B p={[0.28, 0.5, -0.18]} s={[0.22, 0.2, 0.37]} m={MAT.glass} />
        <B p={[-0.5, 0.26, 0]} s={[0.2, 0.3, 0.74]} m={MAT.yellowDark} />
        {/* Boom + stick + bucket */}
        <group ref={arm} position={[0.3, 0.35, 0.16]}>
          <B p={[0.42, 0.2, 0]} s={[0.9, 0.12, 0.12]} m={MAT.yellow} />
          <group position={[0.85, 0.32, 0]} rotation={[0, 0, -1.4]}>
            <B p={[0.3, 0, 0]} s={[0.62, 0.1, 0.1]} m={MAT.yellowDark} />
            <B p={[0.64, -0.04, 0]} s={[0.2, 0.2, 0.3]} m={MAT.frame} />
          </group>
        </group>
      </group>
    </group>
  );
}

function Crusher({ phase }: { phase: number }) {
  const jaw = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (jaw.current) jaw.current.position.y = 0.95 + Math.abs(Math.sin((s.clock.getElapsedTime() + phase) * 4)) * 0.05;
  });
  return (
    <group>
      <B p={[0, 0.35, 0]} s={[1.6, 0.7, 1.4]} m={MAT.panel} />
      <B p={[0, 0.72, 0]} s={[1.3, 0.06, 1.2]} m={MAT.orange} />
      {/* Hopper (a square frustum) */}
      <mesh material={MAT.steel} position={[-0.15, 1.05, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.62, 0.32, 0.6, 4, 1, true]} />
      </mesh>
      <mesh ref={jaw} material={MAT.rock} position={[-0.15, 0.95, 0]} scale={0.18} geometry={ICO} />
      {/* Output chute towards +X */}
      <B p={[0.85, 0.35, 0]} s={[0.4, 0.08, 0.4]} m={MAT.steel} />
      <B p={[-0.3, 0.45, 0.705]} s={[0.4, 0.16, 0.012]} m={MAT.light} cast={false} />
    </group>
  );
}

function Harvester({ phase }: { phase: number }) {
  const crane = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (crane.current) crane.current.rotation.y = Math.sin((s.clock.getElapsedTime() + phase) * 0.6) * 0.9;
  });
  return (
    <group>
      {/* 6-wheel forestry machine */}
      {[-0.45, 0, 0.45].map((x) =>
        [-0.4, 0.4].map((z) => (
          <mesh key={`${x}${z}`} material={MAT.track} position={[x, 0.16, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.16, 0.14, 12]} />
          </mesh>
        )),
      )}
      <B p={[0, 0.36, 0]} s={[1.3, 0.24, 0.66]} m={MAT.green} />
      <B p={[0.42, 0.62, 0]} s={[0.4, 0.34, 0.5]} m={MAT.greenDark} />
      <B p={[0.5, 0.64, 0]} s={[0.26, 0.24, 0.51]} m={MAT.glass} />
      <group ref={crane} position={[-0.1, 0.5, 0]}>
        <B p={[0, 0.2, 0]} s={[0.12, 0.4, 0.12]} m={MAT.yellow} />
        <B p={[-0.4, 0.4, 0]} s={[0.8, 0.09, 0.09]} m={MAT.yellow} />
        <B p={[-0.8, 0.28, 0]} s={[0.16, 0.2, 0.16]} m={MAT.frame} />
        <B p={[-0.8, 0.15, 0]} s={[0.5, 0.08, 0.08]} m={MAT.log} />
      </group>
    </group>
  );
}

function Saw({ phase }: { phase: number }) {
  const blade = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (blade.current) blade.current.rotation.z = -(s.clock.getElapsedTime() + phase) * 8;
  });
  return (
    <group>
      <B p={[0, 0.3, 0]} s={[1.6, 0.6, 0.8]} m={MAT.wood} />
      <B p={[0, 0.62, 0]} s={[1.6, 0.04, 0.84]} m={MAT.frameLight} />
      <mesh ref={blade} material={MAT.blade} position={[0, 0.82, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.03, 18]} />
      </mesh>
      <B p={[0, 0.98, -0.16]} s={[0.8, 0.12, 0.2]} m={MAT.red} />
      <B p={[-0.5, 0.71, 0]} s={[0.55, 0.14, 0.14]} m={MAT.log} />
      <B p={[0.55, 0.68, 0.12]} s={[0.5, 0.05, 0.16]} m={MAT.wood} />
      <B p={[0.55, 0.73, 0.12]} s={[0.5, 0.05, 0.16]} m={MAT.wood} />
    </group>
  );
}

function Pump({ phase }: { phase: number }) {
  const beam = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (beam.current) beam.current.rotation.z = Math.sin((s.clock.getElapsedTime() + phase) * 1.6) * 0.3;
  });
  return (
    <group>
      <B p={[0, 0.05, 0]} s={[0.9, 0.1, 0.5]} m={MAT.frame} />
      {/* A-frame */}
      <B p={[0, 0.38, 0.12]} s={[0.06, 0.62, 0.06]} m={MAT.frameLight} />
      <B p={[0, 0.38, -0.12]} s={[0.06, 0.62, 0.06]} m={MAT.frameLight} />
      <group ref={beam} position={[0, 0.7, 0]}>
        <B p={[0, 0, 0]} s={[0.9, 0.08, 0.1]} m={MAT.orange} />
        {/* Horse head over the well (+X) */}
        <B p={[0.47, -0.08, 0]} s={[0.1, 0.26, 0.14]} m={MAT.orange} />
        <B p={[-0.42, -0.1, 0]} s={[0.16, 0.18, 0.18]} m={MAT.frame} />
      </group>
      <B p={[0.47, 0.25, 0]} s={[0.02, 0.4, 0.02]} m={MAT.track} />
      <mesh material={MAT.steel} position={[0.47, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 0.12, 10]} />
      </mesh>
    </group>
  );
}

function Tank() {
  return (
    <group>
      <mesh material={MAT.tank} position={[0, 0.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.72, 1.1, 24]} />
      </mesh>
      <mesh material={MAT.steel} position={[0, 1.13, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.72, 0.08, 24]} />
      </mesh>
      <B p={[0, 0.32, 0.725]} s={[0.5, 0.06, 0.02]} m={MAT.red} cast={false} />
      <B p={[0.72, 0.55, 0.2]} s={[0.04, 1.1, 0.12]} m={MAT.frameLight} />
      <B p={[0.85, 0.1, 0]} s={[0.3, 0.12, 0.12]} m={MAT.frame} />
    </group>
  );
}

function Assembler({ phase }: { phase: number }) {
  const arm = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.getElapsedTime() + phase;
    if (arm.current) arm.current.rotation.y = Math.sin(t * 0.9) * 1.2;
  });
  return (
    <group>
      <B p={[0, 0.4, 0]} s={[1.6, 0.8, 1.4]} m={MAT.blue} />
      <B p={[0, 0.82, 0]} s={[1.5, 0.06, 1.3]} m={MAT.frame} />
      <B p={[0.81, 0.45, 0]} s={[0.02, 0.4, 0.8]} m={MAT.glass} cast={false} />
      <B p={[-0.3, 0.5, 0.705]} s={[0.4, 0.2, 0.012]} m={MAT.light} cast={false} />
      {/* Robot arm on the roof */}
      <group ref={arm} position={[0.2, 0.86, 0]}>
        <mesh material={MAT.orange} position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.16, 0.16, 12]} />
        </mesh>
        <B p={[0.2, 0.3, 0]} s={[0.1, 0.4, 0.1]} m={MAT.orange} />
        <B p={[0.42, 0.46, 0]} s={[0.45, 0.08, 0.08]} m={MAT.orange} />
        <B p={[0.64, 0.38, 0]} s={[0.06, 0.16, 0.12]} m={MAT.frame} />
      </group>
    </group>
  );
}

function Boiler({ phase }: { phase: number }) {
  const glow = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (glow.current) glow.current.scale.setScalar(0.9 + Math.sin((s.clock.getElapsedTime() + phase) * 5) * 0.08);
  });
  return (
    <group>
      <B p={[0, 0.12, 0]} s={[1.6, 0.24, 1.2]} m={MAT.frame} />
      <mesh material={MAT.red} position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.45, 0.45, 1.4, 20]} />
      </mesh>
      <mesh ref={glow} material={MAT.glow} position={[-0.71, 0.55, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 0.04, 16]} />
      </mesh>
      <mesh material={MAT.frame} position={[0.35, 1.35, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.14, 1.0, 12]} />
      </mesh>
      <B p={[0.75, 0.5, 0.3]} s={[0.1, 0.1, 0.1]} m={MAT.steel} />
    </group>
  );
}

/** A machine model, centred on its footprint and turned to its output side. */
export function MachineModel({ kind, rot, phase = 0, arrow = true }: { kind: MachineKind; rot: Rot; phase?: number; arrow?: boolean }) {
  const size = kind === 'conveyor' || kind === 'pump' ? 1 : 2;
  return (
    <group rotation={[0, rotY(rot), 0]}>
      {kind === 'conveyor' && <Conveyor phase={phase} />}
      {kind === 'excavator' && <Excavator phase={phase} />}
      {kind === 'crusher' && <Crusher phase={phase} />}
      {kind === 'harvester' && <Harvester phase={phase} />}
      {kind === 'saw' && <Saw phase={phase} />}
      {kind === 'pump' && <Pump phase={phase} />}
      {kind === 'tank' && <Tank />}
      {kind === 'assembler' && <Assembler phase={phase} />}
      {kind === 'boiler' && <Boiler phase={phase} />}
      {arrow && kind !== 'conveyor' && <OutArrow size={size} />}
    </group>
  );
}

// ---------------------------------------------------------------- resources

/** Decoration of one resource tile (centred on the tile). */
export function ResourceTile({ res, seed }: { res: Resource; seed: number }) {
  const r = (k: number) => {
    const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  if (res === 'ore')
    return (
      <group>
        <mesh material={MAT.rock} position={[(r(1) - 0.5) * 0.4, 0.1, (r(2) - 0.5) * 0.4]} scale={[0.26, 0.16, 0.22]} geometry={ICO} castShadow />
        <mesh material={MAT.ore} position={[(r(3) - 0.5) * 0.5, 0.08, (r(4) - 0.5) * 0.5]} scale={0.1} geometry={ICO} />
        <mesh material={MAT.ore} position={[(r(5) - 0.5) * 0.5, 0.06, (r(6) - 0.5) * 0.5]} scale={0.07} geometry={ICO} />
      </group>
    );
  if (res === 'tree')
    return (
      <group position={[(r(1) - 0.5) * 0.3, 0, (r(2) - 0.5) * 0.3]} scale={0.8 + r(3) * 0.4}>
        <mesh material={MAT.trunk} position={[0, 0.12, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.24, 6]} />
        </mesh>
        <mesh material={MAT.pine} position={[0, 0.45, 0]} castShadow>
          <coneGeometry args={[0.26, 0.5, 7]} />
        </mesh>
        <mesh material={MAT.pine} position={[0, 0.68, 0]} castShadow>
          <coneGeometry args={[0.18, 0.36, 7]} />
        </mesh>
      </group>
    );
  return (
    <mesh material={MAT.oil} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, r(1) * 3]}>
      <circleGeometry args={[0.36, 7]} />
    </mesh>
  );
}
