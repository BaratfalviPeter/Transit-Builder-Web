/**
 * PowerPlantModel — a detailed, animated low-poly thermal power plant, built
 * from composite primitives to match the reference art:
 *
 *   - a concrete base slab tying the site together,
 *   - a main hall (lit windows + doors), a low annex, and a brick boiler house
 *     with three thin chimneys,
 *   - industrial piping (cylinders + quarter-torus bends) with small valves,
 *   - two tapered cooling towers with dark rings, and a tall red/white chimney,
 *   - a glowing energy cell on the roof with a pointLight,
 *   - animated steam particles rising from the towers + striped chimney, and a
 *     gentle pulse on the energy cell + light (useFrame).
 *
 * Everything is wrapped in one <group> centered at the local origin, resting on
 * Y=0. The whole thing is ~10 units across; pass `scale` to fit it into a grid
 * cell when used on the map.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface PowerPlantModelProps {
  /** World position of the group (rests on Y=0 locally). */
  position?: [number, number, number];
  /** Uniform scale (the model is ~10 units across at scale 1). */
  scale?: number;
  rotation?: [number, number, number];
}

// --- Palette ----------------------------------------------------------------
const COL = {
  base: '#3b3f45',
  hall: '#39414f',
  hallEdge: '#2d343f',
  annex: '#4a4f57',
  window: '#ffd34d',
  windowCool: '#eaf2ff',
  door: '#7a3b23',
  brick: '#8f4733',
  chimneyDark: '#1c1f24',
  pipeRust: '#8a4b32',
  pipeGrey: '#9aa0a6',
  pipeBlue: '#4d7fb3',
  valveYellow: '#f2c438',
  valveRed: '#d2402f',
  tower: '#d7d9dc',
  towerRing: '#4a4e55',
  stripeRed: '#d2402f',
  stripeWhite: '#eef0f2',
  cell: '#ffb028',
  cage: '#8a8f98',
  steam: '#dfe3e8',
};

export function PowerPlantModel({
  position = [0, 0, 0],
  scale = 1,
  rotation = [0, 0, 0],
}: PowerPlantModelProps) {
  return (
    <group position={position} scale={scale} rotation={rotation}>
      <Base />
      <MainHall />
      <Annex />
      <BoilerHouse />
      <Piping />
      <CoolingTower position={[-3.4, 0, -1.2]} />
      <CoolingTower position={[-1.5, 0, -2.1]} />
      <TallChimney position={[3.6, 0, -3.0]} />
      <EnergyCell position={[1.4, 2.9, 0.2]} />

      {/* Steam from the two cooling towers and the striped chimney. */}
      <Steam position={[-3.4, 4.6, -1.2]} spread={0.5} rise={2.6} />
      <Steam position={[-1.5, 4.6, -2.1]} spread={0.5} rise={2.6} />
      <Steam position={[3.6, 7.2, -3.0]} spread={0.35} rise={2.2} />
    </group>
  );
}

// --- 1. Base + main buildings ----------------------------------------------

function Base() {
  return (
    <mesh position={[0, 0.05, 0]} receiveShadow castShadow>
      <boxGeometry args={[10, 0.1, 10]} />
      <meshStandardMaterial color={COL.base} roughness={0.95} />
    </mesh>
  );
}

function MainHall() {
  // Window grid on the front (+Z) face.
  const windows = useMemo(() => {
    const out: Array<[number, number, string]> = [];
    const cols = [-1.6, -0.6, 0.4, 1.4];
    const rows = [1.6, 0.9];
    cols.forEach((cx, i) =>
      rows.forEach((cy, j) => {
        const warm = (i + j) % 2 === 0;
        out.push([cx, cy, warm ? COL.window : COL.windowCool]);
      }),
    );
    return out;
  }, []);

  return (
    <group position={[0.6, 0, 0.5]}>
      {/* Hall body */}
      <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 2.5, 4]} />
        <meshStandardMaterial color={COL.hall} roughness={0.8} />
      </mesh>
      {/* Vertical seams suggesting bays */}
      {[-1.1, 0.1, 1.3].map((sx, i) => (
        <mesh key={i} position={[sx, 1.35, 2.01]} castShadow>
          <boxGeometry args={[0.08, 2.5, 0.05]} />
          <meshStandardMaterial color={COL.hallEdge} roughness={0.9} />
        </mesh>
      ))}
      {/* Lit windows on the front face */}
      {windows.map(([wx, wy, c], i) => (
        <mesh key={`w${i}`} position={[wx, wy, 2.03]}>
          <boxGeometry args={[0.4, 0.4, 0.04]} />
          <meshStandardMaterial
            color={c}
            emissive={c}
            emissiveIntensity={0.6}
            roughness={0.4}
          />
        </mesh>
      ))}
      {/* Doors at the base */}
      {[-1.1, 0.9].map((dx, i) => (
        <mesh key={`d${i}`} position={[dx, 0.5, 2.03]} castShadow>
          <boxGeometry args={[0.7, 1, 0.05]} />
          <meshStandardMaterial color={COL.door} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Annex() {
  return (
    <group position={[-1.6, 0, 2.4]}>
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.5, 1.8]} />
        <meshStandardMaterial color={COL.annex} roughness={0.85} />
      </mesh>
      {/* a couple of warm windows */}
      {[-0.5, 0.5].map((wx, i) => (
        <mesh key={i} position={[wx, 0.9, 0.91]}>
          <boxGeometry args={[0.35, 0.35, 0.04]} />
          <meshStandardMaterial
            color={COL.window}
            emissive={COL.window}
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

function BoilerHouse() {
  return (
    <group position={[3.3, 0, 1.6]}>
      {/* Brick/rust block */}
      <mesh position={[0, 1, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 2, 2.5]} />
        <meshStandardMaterial color={COL.brick} roughness={0.9} />
      </mesh>
      {/* Three thin vertical chimneys on top */}
      {[-0.6, 0, 0.6].map((cx, i) => (
        <mesh key={i} position={[cx, 2.6, -0.4]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 1.4, 12]} />
          <meshStandardMaterial color={COL.chimneyDark} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// --- 2. Piping --------------------------------------------------------------

function Pipe({
  position,
  rotation,
  length,
  radius = 0.18,
  color = COL.pipeGrey,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  length: number;
  radius?: number;
  color?: string;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, length, 14]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
    </mesh>
  );
}

/** A 90° elbow bend (quarter torus). */
function Elbow({
  position,
  rotation,
  radius = 0.4,
  tube = 0.18,
  color = COL.pipeGrey,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  radius?: number;
  tube?: number;
  color?: string;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <torusGeometry args={[radius, tube, 10, 16, Math.PI / 2]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
    </mesh>
  );
}

function Valve({
  position,
  color = COL.valveYellow,
}: {
  position: [number, number, number];
  color?: string;
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.22, 0.22, 0.12, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* little hand-wheel on top */}
      <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.14, 0.04, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Piping() {
  // Pipes run from the cooling towers (left) toward the main hall (right).
  return (
    <group>
      {/* Horizontal runs at ~1.2 high, between towers and hall */}
      <Pipe
        position={[-0.6, 1.2, 0.1]}
        rotation={[0, 0, Math.PI / 2]}
        length={3.4}
        radius={0.2}
        color={COL.pipeGrey}
      />
      <Pipe
        position={[-0.6, 1.6, 0.6]}
        rotation={[0, 0, Math.PI / 2]}
        length={3.0}
        radius={0.18}
        color={COL.pipeRust}
      />
      <Pipe
        position={[-0.6, 0.8, -0.4]}
        rotation={[0, 0, Math.PI / 2]}
        length={3.2}
        radius={0.16}
        color={COL.pipeBlue}
      />

      {/* Elbows turning down into the ground near the towers */}
      <Elbow
        position={[-2.3, 1.2, 0.1]}
        rotation={[0, 0, Math.PI]}
        radius={0.4}
        tube={0.2}
        color={COL.pipeGrey}
      />
      <Elbow
        position={[-2.3, 1.6, 0.6]}
        rotation={[0, 0, Math.PI]}
        radius={0.4}
        tube={0.18}
        color={COL.pipeRust}
      />
      {/* Vertical drops to the slab */}
      <Pipe
        position={[-2.7, 0.6, 0.1]}
        length={1.2}
        radius={0.2}
        color={COL.pipeGrey}
      />
      <Pipe
        position={[-2.7, 0.6, 0.6]}
        length={1.2}
        radius={0.18}
        color={COL.pipeRust}
      />

      {/* Ground-level manifold toward the hall */}
      <Pipe
        position={[0.2, 0.35, -1.2]}
        rotation={[Math.PI / 2, 0, 0]}
        length={2.2}
        radius={0.16}
        color={COL.pipeGrey}
      />

      {/* Valves on the ground pipes */}
      <Valve position={[-2.7, 0.42, 1.1]} color={COL.valveYellow} />
      <Valve position={[-2.2, 0.42, 1.1]} color={COL.valveRed} />
      <Valve position={[0.2, 0.42, -2.1]} color={COL.valveRed} />
    </group>
  );
}

// --- 3. Cooling towers + tall chimney --------------------------------------

function CoolingTower({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Tapered shell */}
      <mesh position={[0, 2.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.1, 1.5, 4.5, 24, 1, true]} />
        <meshStandardMaterial
          color={COL.tower}
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Bottom ring */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[1.55, 1.55, 0.3, 24]} />
        <meshStandardMaterial color={COL.towerRing} roughness={0.8} />
      </mesh>
      {/* Top ring */}
      <mesh position={[0, 4.45, 0]} castShadow>
        <cylinderGeometry args={[1.18, 1.18, 0.3, 24]} />
        <meshStandardMaterial color={COL.towerRing} roughness={0.8} />
      </mesh>
    </group>
  );
}

function TallChimney({ position }: { position: [number, number, number] }) {
  // Alternating red/white rings stacked to avoid texturing.
  const segs = 7;
  const segH = 0.9;
  return (
    <group position={position}>
      {Array.from({ length: segs }).map((_, i) => (
        <mesh key={i} position={[0, 0.4 + segH / 2 + i * segH, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.34, segH, 16]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? COL.stripeWhite : COL.stripeRed}
            roughness={0.7}
          />
        </mesh>
      ))}
      {/* Base flare */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.5, 0.5, 16]} />
        <meshStandardMaterial color={COL.stripeWhite} roughness={0.7} />
      </mesh>
    </group>
  );
}

// --- 4. Glowing energy cell + light (pulsing) ------------------------------

function EnergyCell({ position }: { position: [number, number, number] }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const pulse = 1 + Math.sin(t * 4) * 0.15;
    if (coreRef.current) coreRef.current.scale.setScalar(pulse);
    if (lightRef.current) lightRef.current.intensity = 2.5 * pulse;
  });

  return (
    <group position={position}>
      {/* Glowing core — basic material so it reads as self-lit. */}
      <mesh ref={coreRef}>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshBasicMaterial color={COL.cell} toneMapped={false} />
      </mesh>

      {/* The active light at the core. */}
      <pointLight
        ref={lightRef}
        color="#ffaa00"
        intensity={2.5}
        distance={6}
        decay={2}
        castShadow
      />

      {/* 4-legged protective cage around the core. */}
      {[
        [-0.45, -0.45],
        [0.45, -0.45],
        [0.45, 0.45],
        [-0.45, 0.45],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0, lz]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 8]} />
          <meshStandardMaterial color={COL.cage} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      {/* top frame ring */}
      <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.6, 0.04, 8, 4]} />
        <meshStandardMaterial color={COL.cage} roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  );
}

// --- 5. Steam / smoke particle system --------------------------------------

const STEAM_COUNT = 4;

function Steam({
  position,
  spread,
  rise,
}: {
  position: [number, number, number];
  /** Horizontal jitter radius. */
  spread: number;
  /** How far up a particle travels before resetting. */
  rise: number;
}) {
  const group = useRef<THREE.Group>(null);

  // Per-particle static params + animated progress (phase), deterministic.
  const particles = useMemo(
    () =>
      Array.from({ length: STEAM_COUNT }).map((_, i) => ({
        phase: i / STEAM_COUNT, // staggered start along the rise
        speed: 0.18 + (i % 3) * 0.04,
        baseSize: 0.18 + (i % 2) * 0.12,
        dx: (Math.sin(i * 2.1) * spread) / rise,
        dz: (Math.cos(i * 1.7) * spread) / rise,
      })),
    [spread, rise],
  );

  const refs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    for (let i = 0; i < particles.length; i++) {
      const mesh = refs.current[i];
      if (!mesh) continue;
      const p = particles[i];
      // progress 0..1 looping
      const prog = (p.phase + t * p.speed) % 1;
      const y = prog * rise;
      mesh.position.set(p.dx * y, y, p.dz * y);
      // grow a bit as it rises, fade out near the top
      const size = p.baseSize * (0.6 + prog * 0.9);
      mesh.scale.setScalar(size);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(1, (1 - prog) * 1.4) * 0.85;
    }
  });

  return (
    <group ref={group} position={position}>
      {particles.map((_p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
        >
          {/* alternate low-poly shapes for an irregular puff look */}
          {i % 2 === 0 ? (
            <icosahedronGeometry args={[1, 0]} />
          ) : (
            <boxGeometry args={[1, 1, 1]} />
          )}
          <meshStandardMaterial
            color={COL.steam}
            transparent
            opacity={0.8}
            roughness={1}
          />
        </mesh>
      ))}
    </group>
  );
}
