/**
 * PowerPlantModel — a detailed, animated low-poly thermal power plant that
 * occupies a 3×3-cell lot.
 *
 * Built in CELL UNITS: the base is exactly [3, 0.1, 3] centered on the origin
 * and resting on Y=0. The caller scales the whole group by `cellSize`, so the
 * model always covers its 3×3 footprint precisely.
 *
 * Contents (after the reference art):
 *   - concrete slab with a curb and an asphalt yard,
 *   - two flared cooling towers with dark rings and a dark throat,
 *   - a slate main hall (lit windows, doors) + a lower annex,
 *   - a brick boiler house with three black stacks,
 *   - a tall red/white striped chimney with a blinking aviation light,
 *   - piping (straight runs + 90° torus elbows) with yellow/red valves,
 *   - a coal yard feeding the boiler house via a conveyor,
 *   - transformers, crates, barrels and yellow railings,
 *   - a glowing energy cell on the roof with a pointLight.
 *
 * Animations (useFrame): rising steam from both towers and the chimney (plus a
 * little dark smoke from the boiler stack), coal chunks travelling up the
 * conveyor, the energy cell + its light pulsing with orbiting sparks, and the
 * aviation light blinking. `phase` offsets the timing per instance so several
 * plants on the map don't animate in lockstep.
 *
 * Performance: static parts share module-level materials and one unit box
 * geometry; only the large parts cast shadows; the point light does not cast
 * shadows (point shadows render the scene 6× per light).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface PowerPlantModelProps {
  /** World position of the lot center (the model rests on this Y). */
  position?: V3;
  /** World units per cell — the model is built in cell units. */
  scale?: number;
  /** Rotation around Y (radians), e.g. a multiple of π/2. */
  rotationY?: number;
  /** Animation time offset (seconds), to desync multiple plants. */
  phase?: number;
}

// --- Shared resources -------------------------------------------------------

export const BOX = new THREE.BoxGeometry(1, 1, 1);

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  concrete: std('#cfc6b4', { roughness: 0.95 }),
  curb: std('#a99f8c'),
  asphalt: std('#66635f', { roughness: 1 }),
  tower: std('#dcd9d2', { roughness: 0.9, side: THREE.DoubleSide }),
  towerRing: std('#55585e'),
  towerInner: std('#2f3136'),
  hall: std('#4a5262'),
  hallDark: std('#363c48'),
  annex: std('#535a68'),
  window: std('#ffd36b', {
    emissive: '#ffb84a',
    emissiveIntensity: 0.9,
    roughness: 0.4,
  }),
  door: std('#8a3f26'),
  brick: std('#9a4632'),
  brickDark: std('#74311f'),
  roofBrick: std('#5a2b20'),
  black: std('#1f2227', { roughness: 0.7 }),
  red: std('#d6402e', { roughness: 0.7 }),
  white: std('#f1efe9', { roughness: 0.7 }),
  pad: std('#c4bcab'),
  rust: std('#8f4a2f', { roughness: 0.6, metalness: 0.2 }),
  pipeGrey: std('#9aa0a7', { roughness: 0.5, metalness: 0.35 }),
  pipeBlue: std('#4f7fae', { roughness: 0.5, metalness: 0.2 }),
  yellow: std('#e8c13a', { roughness: 0.5 }),
  valveRed: std('#cf3b2c', { roughness: 0.5 }),
  coal: std('#2b2c30', { roughness: 1, flatShading: true }),
  belt: std('#3b3e44'),
  frame: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  crateBlue: std('#3f5f86'),
  crateDark: std('#3a3d44'),
  transformer: std('#8d939b', { roughness: 0.6, metalness: 0.3 }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/**
 * Cooling tower centers (x, z). Footing radius is 0.47, so both stay inside the
 * slab curb (±1.44): A sits right behind the annex, B clear of the back edge.
 */
const TOWER_A: [number, number] = [-0.97, -0.38];
const TOWER_B: [number, number] = [-0.2, -0.97];

/** Base point-light intensity of the energy cell (pulses around this). */
const CELL_LIGHT = 8;

/** A box from the shared unit geometry, positioned/scaled in lot units. */
export function Box({
  p,
  s,
  m,
  cast = false,
}: {
  p: V3;
  s: V3;
  m: THREE.Material;
  cast?: boolean;
}) {
  return (
    <mesh
      geometry={BOX}
      material={m}
      position={p}
      scale={s}
      castShadow={cast}
      receiveShadow
    />
  );
}

// --- Model ------------------------------------------------------------------

export function PowerPlantModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: PowerPlantModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Base />

      <CoolingTower x={TOWER_A[0]} z={TOWER_A[1]} />
      <CoolingTower x={TOWER_B[0]} z={TOWER_B[1]} />

      <MainHall phase={phase} />
      <Annex />
      <BoilerHouse />
      <TallChimney phase={phase} />

      <Piping />
      <CoalYard phase={phase} />
      <Props />

      {/* Steam / smoke plumes (lot units; tower rims at y 1.45). */}
      <Steam origin={[TOWER_A[0], 1.45, TOWER_A[1]]} count={6} rise={1.4} spread={0.32} size={0.17} phase={phase} />
      <Steam origin={[TOWER_B[0], 1.45, TOWER_B[1]]} count={6} rise={1.4} spread={0.32} size={0.17} phase={phase + 1.7} />
      <Steam origin={[1.1, 2.3, -1.05]} count={5} rise={1.0} spread={0.2} size={0.1} phase={phase + 0.6} />
      <Steam origin={[1.075, 1.52, 0.675]} count={3} rise={0.6} spread={0.1} size={0.07} color="#5d6066" phase={phase + 2.3} />
    </group>
  );
}

// --- 1. Base ----------------------------------------------------------------

function Base() {
  return (
    <group>
      {/* The 3×3 slab: exactly [3, 0.1, 3], bottom on Y=0. */}
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.concrete} />
      {/* Curb around the edge */}
      <Box p={[0, 0.14, -1.47]} s={[3, 0.08, 0.06]} m={M.curb} />
      <Box p={[0, 0.14, 1.47]} s={[3, 0.08, 0.06]} m={M.curb} />
      <Box p={[-1.47, 0.14, 0]} s={[0.06, 0.08, 2.88]} m={M.curb} />
      <Box p={[1.47, 0.14, 0]} s={[0.06, 0.08, 2.88]} m={M.curb} />
      {/* Asphalt yard in front of the halls */}
      <Box p={[0.15, 0.106, 0.95]} s={[1.05, 0.012, 0.9]} m={M.asphalt} />
    </group>
  );
}

// --- 2. Cooling towers --------------------------------------------------------

function CoolingTower({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.1, z]}>
      {/* Dark footing ring */}
      <mesh material={M.towerRing} position={[0, 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.45, 0.47, 0.12, 24]} />
      </mesh>
      {/* Lower tapered shell (open) */}
      <mesh material={M.tower} position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.29, 0.42, 1.0, 24, 1, true]} />
      </mesh>
      {/* Upper flare */}
      <mesh material={M.tower} position={[0, 1.175, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.29, 0.35, 24, 1, true]} />
      </mesh>
      {/* Dark rim ring */}
      <mesh material={M.towerRing} position={[0, 1.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.035, 8, 28]} />
      </mesh>
      {/* Dark throat so you never see through the open top */}
      <mesh material={M.towerInner} position={[0, 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 24]} />
      </mesh>
    </group>
  );
}

// --- 3. Main hall + energy cell ----------------------------------------------

function MainHall({ phase }: { phase: number }) {
  const W = 0.95;
  const H = 0.85;
  const D = 0.95;
  const frontZ = D / 2 + 0.011;
  const sideX = W / 2 + 0.011;
  return (
    <group position={[0.15, 0.1, 0.0]}>
      <Box p={[0, H / 2, 0]} s={[W, H, D]} m={M.hall} cast />
      <Box p={[0, H + 0.025, 0]} s={[W + 0.05, 0.05, D + 0.05]} m={M.hallDark} cast />
      {/* Bays on the front face */}
      {[-0.24, 0.24].map((px) => (
        <Box key={px} p={[px, H / 2, D / 2 + 0.01]} s={[0.04, H, 0.02]} m={M.hallDark} />
      ))}
      {/* Front windows: an upper row of 4 + two lower side windows */}
      {[-0.36, -0.12, 0.12, 0.36].map((px) => (
        <Box key={`u${px}`} p={[px, 0.66, frontZ]} s={[0.12, 0.1, 0.02]} m={M.window} />
      ))}
      {[-0.38, 0.38].map((px) => (
        <Box key={`m${px}`} p={[px, 0.42, frontZ]} s={[0.12, 0.1, 0.02]} m={M.window} />
      ))}
      {/* Two brown doors */}
      {[-0.13, 0.13].map((px) => (
        <Box key={`d${px}`} p={[px, 0.17, frontZ]} s={[0.17, 0.32, 0.02]} m={M.door} />
      ))}
      {/* Side windows (2 rows × 3) */}
      {[-0.3, 0, 0.3].flatMap((pz) =>
        [0.42, 0.66].map((py) => (
          <Box key={`s${pz}${py}`} p={[sideX, py, pz]} s={[0.02, 0.1, 0.12]} m={M.window} />
        )),
      )}
      {/* Glowing energy cell on the roof */}
      <group position={[0, H + 0.05, 0]}>
        <EnergyCell phase={phase} />
      </group>
    </group>
  );
}

function EnergyCell({ phase }: { phase: number }) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const sparks = useRef<THREE.Group>(null);

  // Per-instance (animated) materials.
  const coreMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffb43a', toneMapped: false }),
    [],
  );
  const haloMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffcf6b',
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      coreMat.dispose();
      haloMat.dispose();
    },
    [coreMat, haloMat],
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    const s = Math.sin(t * 4);
    core.current?.scale.setScalar(1 + s * 0.12);
    halo.current?.scale.setScalar(1 + s * 0.18);
    haloMat.opacity = 0.18 + (s * 0.5 + 0.5) * 0.15;
    if (light.current) light.current.intensity = CELL_LIGHT * (1 + s * 0.25);
    if (sparks.current) sparks.current.rotation.y = t * 1.5;
  });

  const legs: Array<[number, number]> = [
    [-0.19, -0.19],
    [0.19, -0.19],
    [0.19, 0.19],
    [-0.19, 0.19],
  ];

  return (
    <group>
      <Box p={[0, 0.015, 0]} s={[0.44, 0.03, 0.44]} m={M.frame} />
      <mesh ref={core} material={coreMat} position={[0, 0.22, 0]}>
        <boxGeometry args={[0.24, 0.24, 0.24]} />
      </mesh>
      <mesh ref={halo} material={haloMat} position={[0, 0.22, 0]}>
        <boxGeometry args={[0.34, 0.34, 0.34]} />
      </mesh>
      {/* 4-legged protective cage */}
      {legs.map(([lx, lz]) => (
        <mesh key={`${lx}${lz}`} material={M.frame} position={[lx, 0.22, lz]}>
          <cylinderGeometry args={[0.018, 0.018, 0.4, 6]} />
        </mesh>
      ))}
      <Box p={[0, 0.42, -0.19]} s={[0.4, 0.025, 0.025]} m={M.frame} />
      <Box p={[0, 0.42, 0.19]} s={[0.4, 0.025, 0.025]} m={M.frame} />
      <Box p={[-0.19, 0.42, 0]} s={[0.025, 0.025, 0.4]} m={M.frame} />
      <Box p={[0.19, 0.42, 0]} s={[0.025, 0.025, 0.4]} m={M.frame} />
      {/* Active light at the core. distance/decay are in world units. */}
      <pointLight
        ref={light}
        position={[0, 0.22, 0]}
        color="#ffaa00"
        intensity={CELL_LIGHT}
        distance={7}
        decay={2}
      />
      {/* Orbiting sparks */}
      <group ref={sparks} position={[0, 0.22, 0]}>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh
              key={i}
              material={coreMat}
              position={[Math.cos(a) * 0.27, (i % 2 ? 0.06 : -0.05), Math.sin(a) * 0.27]}
            >
              <boxGeometry args={[0.025, 0.025, 0.025]} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function Annex() {
  return (
    <group position={[-0.825, 0.1, 0.55]}>
      <Box p={[0, 0.25, 0]} s={[0.95, 0.5, 0.8]} m={M.annex} cast />
      <Box p={[0, 0.52, 0]} s={[1.0, 0.04, 0.85]} m={M.hallDark} cast />
      {[-0.25, -0.05, 0.15].map((px) => (
        <Box key={px} p={[px, 0.36, 0.411]} s={[0.12, 0.09, 0.02]} m={M.window} />
      ))}
      <Box p={[0.32, 0.15, 0.411]} s={[0.15, 0.28, 0.02]} m={M.door} />
    </group>
  );
}

// --- 4. Boiler house + chimneys ----------------------------------------------

function BoilerHouse() {
  const stacks: Array<[number, number]> = [
    [-0.15, 0.6],
    [0, 0.78],
    [0.15, 0.5],
  ];
  return (
    <group position={[1.075, 0.1, 0.825]}>
      <Box p={[0, 0.3, 0]} s={[0.65, 0.6, 0.95]} m={M.brick} cast />
      <Box p={[0, 0.62, 0]} s={[0.69, 0.04, 0.99]} m={M.roofBrick} cast />
      {/* Brick pilasters */}
      {[-0.22, 0, 0.22].map((px) => (
        <Box key={`f${px}`} p={[px, 0.3, 0.485]} s={[0.04, 0.6, 0.02]} m={M.brickDark} />
      ))}
      {[-0.3, 0, 0.3].map((pz) => (
        <Box key={`l${pz}`} p={[-0.335, 0.3, pz]} s={[0.02, 0.6, 0.04]} m={M.brickDark} />
      ))}
      {/* Door facing the coal yard */}
      <Box p={[-0.336, 0.15, 0.36]} s={[0.02, 0.3, 0.16]} m={M.door} />
      {/* Three black stacks */}
      {stacks.map(([sx, h]) => (
        <mesh key={sx} material={M.black} position={[sx, 0.64 + h / 2, -0.15]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, h, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function TallChimney({ phase }: { phase: number }) {
  const lamp = useRef<THREE.Mesh>(null);
  const lampMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ff3a2a',
        emissive: '#ff2a1a',
        emissiveIntensity: 2,
      }),
    [],
  );
  useEffect(() => () => lampMat.dispose(), [lampMat]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    // Short flash roughly once per second.
    lampMat.emissiveIntensity = (t % 1.2) < 0.25 ? 3 : 0.15;
  });

  const segs = 8;
  const h = 0.26;
  return (
    <group position={[1.02, 0.1, -1.05]}>
      <Box p={[0, 0.06, 0]} s={[0.42, 0.12, 0.42]} m={M.pad} cast />
      {Array.from({ length: segs }).map((_, i) => (
        <mesh
          key={i}
          material={i % 2 === 1 ? M.red : M.white}
          position={[0, 0.12 + h * i + h / 2, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.13 - 0.005 * (i + 1), 0.13 - 0.005 * i, h, 14]} />
        </mesh>
      ))}
      {/* Service gallery + top lip */}
      <mesh material={M.black} position={[0, 0.12 + h * 6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.135, 0.015, 6, 20]} />
      </mesh>
      <mesh material={M.black} position={[0, 0.12 + h * segs, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.09, 0.02, 6, 18]} />
      </mesh>
      {/* Blinking aviation light */}
      <mesh ref={lamp} material={lampMat} position={[0.1, 0.12 + h * segs - 0.05, 0]}>
        <sphereGeometry args={[0.03, 8, 6]} />
      </mesh>
    </group>
  );
}

// --- 5. Piping ---------------------------------------------------------------

/** Straight pipe between two points along one axis. */
export function Pipe({
  from,
  to,
  r = 0.05,
  m,
}: {
  from: V3;
  to: V3;
  r?: number;
  m: THREE.Material;
}) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const mid: V3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  // Cylinders are Y-aligned; rotate to the run's axis.
  const rot: V3 = Math.abs(dx) > 1e-6 ? [0, 0, Math.PI / 2] : Math.abs(dz) > 1e-6 ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return (
    <mesh material={m} position={mid} rotation={rot} castShadow>
      <cylinderGeometry args={[r, r, len, 12]} />
    </mesh>
  );
}

/**
 * 90° elbow (quarter torus). The torus' arc starts at (R,0,0) heading +Y and
 * ends at (0,R,0) heading −X; `rotation` orients it.
 */
export function Elbow({
  p,
  rot,
  R = 0.09,
  r = 0.05,
  m,
}: {
  p: V3;
  rot: V3;
  R?: number;
  r?: number;
  m: THREE.Material;
}) {
  return (
    <mesh material={m} position={p} rotation={rot} castShadow>
      <torusGeometry args={[R, r, 8, 10, Math.PI / 2]} />
    </mesh>
  );
}

function Valve({ x, y, z, m }: { x: number; y: number; z: number; m: THREE.Material }) {
  return (
    <group position={[x, y, z]}>
      <mesh material={M.frame} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.1, 6]} />
      </mesh>
      <mesh material={m} position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.05, 0.013, 6, 14]} />
      </mesh>
    </group>
  );
}

function Piping() {
  // Rust loop in front of the annex: a ground manifold whose ends turn up and
  // then into the annex wall (see the elbow orientation notes on <Elbow>).
  const R = 0.09;
  const yM = 0.17; // manifold height
  const zM = 1.2; // manifold depth
  const xL = -1.16;
  const xR = -0.49;
  const yTop = 0.41; // where the riser turns toward the wall
  const zWall = 0.95; // annex front wall
  return (
    <group>
      {/* Ground manifold */}
      <Pipe from={[xL, yM, zM]} to={[xR, yM, zM]} m={M.rust} />
      {/* Left end: horizontal -> up (rot Z π), riser at x = xL - R */}
      <Elbow p={[xL, yM + R, zM]} rot={[0, 0, Math.PI]} m={M.rust} />
      <Pipe from={[xL - R, yM + R, zM]} to={[xL - R, yTop, zM]} m={M.rust} />
      <Elbow p={[xL - R, yTop, zM - R]} rot={[0, -Math.PI / 2, 0]} m={M.rust} />
      <Pipe from={[xL - R, yTop + R, zM - R]} to={[xL - R, yTop + R, zWall]} m={M.rust} />
      {/* Right end: horizontal -> up (rot X π), riser at x = xR + R */}
      <Elbow p={[xR, yM + R, zM]} rot={[Math.PI, 0, 0]} m={M.rust} />
      <Pipe from={[xR + R, yM + R, zM]} to={[xR + R, yTop, zM]} m={M.rust} />
      <Elbow p={[xR + R, yTop, zM - R]} rot={[0, -Math.PI / 2, 0]} m={M.rust} />
      <Pipe from={[xR + R, yTop + R, zM - R]} to={[xR + R, yTop + R, zWall]} m={M.rust} />
      {/* Valves on the manifold */}
      <Valve x={-0.95} y={yM + 0.05} z={zM} m={M.yellow} />
      <Valve x={-0.7} y={yM + 0.05} z={zM} m={M.valveRed} />

      {/* Tower A -> main hall: grey + blue runs */}
      <Pipe from={[-0.8, 0.72, -0.2]} to={[-0.325, 0.72, -0.2]} r={0.055} m={M.pipeGrey} />
      <Pipe from={[-0.62, 0.42, -0.35]} to={[-0.325, 0.42, -0.35]} r={0.045} m={M.pipeBlue} />
      {/* Main hall -> boiler house: short rust bridge between the two walls */}
      <Pipe from={[0.6, 0.55, 0.42]} to={[0.77, 0.55, 0.42]} r={0.05} m={M.rust} />
      {/* Tower B -> chimney: long grey run on supports */}
      <Pipe from={[0.14, 0.3, -1.05]} to={[0.91, 0.3, -1.05]} r={0.045} m={M.pipeGrey} />
      <Box p={[0.3, 0.2, -1.05]} s={[0.05, 0.2, 0.05]} m={M.frame} />
      <Box p={[0.6, 0.2, -1.05]} s={[0.05, 0.2, 0.05]} m={M.frame} />
    </group>
  );
}

// --- 6. Coal yard + conveyor -------------------------------------------------

const BELT_FROM: V3 = [0.2, 0.14, 0.95];
const BELT_TO: V3 = [0.75, 0.52, 0.95];
const BELT_LEN = Math.hypot(BELT_TO[0] - BELT_FROM[0], BELT_TO[1] - BELT_FROM[1]);
const BELT_ANGLE = Math.atan2(BELT_TO[1] - BELT_FROM[1], BELT_TO[0] - BELT_FROM[0]);
const BELT_MID: V3 = [
  (BELT_FROM[0] + BELT_TO[0]) / 2,
  (BELT_FROM[1] + BELT_TO[1]) / 2,
  BELT_FROM[2],
];
const COAL_CHUNKS = 5;

function CoalYard({ phase }: { phase: number }) {
  const chunks = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let i = 0; i < COAL_CHUNKS; i++) {
      const m = chunks.current[i];
      if (!m) continue;
      const k = (t * 0.22 + i / COAL_CHUNKS) % 1; // 0..1 along the belt
      m.position.x = -BELT_LEN / 2 + k * BELT_LEN;
    }
  });

  // Belt height at a given lot x (for the support legs).
  const beltY = (x: number) =>
    BELT_FROM[1] + ((x - BELT_FROM[0]) / (BELT_TO[0] - BELT_FROM[0])) * (BELT_TO[1] - BELT_FROM[1]);

  return (
    <group>
      {/* Coal piles */}
      <mesh material={M.coal} position={[0.0, 0.2, 1.2]} castShadow>
        <coneGeometry args={[0.2, 0.2, 7]} />
      </mesh>
      <mesh material={M.coal} position={[0.1, 0.165, 0.78]} castShadow>
        <coneGeometry args={[0.14, 0.13, 6]} />
      </mesh>
      <mesh material={M.coal} position={[-0.2, 0.155, 0.95]} castShadow>
        <coneGeometry args={[0.12, 0.11, 6]} />
      </mesh>

      {/* Inclined conveyor (local +X runs uphill toward the boiler house) */}
      <group position={BELT_MID} rotation={[0, 0, BELT_ANGLE]}>
        <Box p={[0, 0, 0]} s={[BELT_LEN, 0.03, 0.14]} m={M.belt} />
        <Box p={[0, 0.02, 0.075]} s={[BELT_LEN, 0.04, 0.015]} m={M.frame} />
        <Box p={[0, 0.02, -0.075]} s={[BELT_LEN, 0.04, 0.015]} m={M.frame} />
        {Array.from({ length: COAL_CHUNKS }).map((_, i) => (
          <mesh
            key={i}
            ref={(el) => {
              chunks.current[i] = el;
            }}
            geometry={BOX}
            material={M.coal}
            position={[0, 0.04, (i % 2 ? 0.02 : -0.02)]}
            scale={[0.05, 0.045, 0.05]}
          />
        ))}
      </group>
      {/* Support legs */}
      {[0.35, 0.6].map((lx) => {
        const top = beltY(lx) - 0.015;
        const h = top - 0.1;
        return <Box key={lx} p={[lx, 0.1 + h / 2, 0.95]} s={[0.025, h, 0.025]} m={M.frame} />;
      })}
    </group>
  );
}

// --- 7. Props -----------------------------------------------------------------

function Railing({ from, to }: { from: [number, number]; to: [number, number] }) {
  // Runs along X at a fixed Z (from[1] === to[1]).
  const z = from[1];
  const len = to[0] - from[0];
  const posts = Math.max(2, Math.round(len / 0.3) + 1);
  return (
    <group>
      <Box p={[(from[0] + to[0]) / 2, 0.29, z]} s={[len, 0.02, 0.02]} m={M.yellow} />
      {Array.from({ length: posts }).map((_, i) => {
        const x = from[0] + (len * i) / (posts - 1);
        return <Box key={i} p={[x, 0.19, z]} s={[0.02, 0.18, 0.02]} m={M.yellow} />;
      })}
    </group>
  );
}

function Transformer({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.1, z]}>
      <Box p={[0, 0.1, 0]} s={[0.22, 0.2, 0.16]} m={M.transformer} cast />
      {[-0.06, 0, 0.06].map((fx) => (
        <Box key={fx} p={[fx, 0.1, 0.09]} s={[0.02, 0.16, 0.02]} m={M.crateDark} />
      ))}
      {/* Insulators */}
      {[-0.06, 0.06].map((ix) => (
        <mesh key={ix} material={M.white} position={[ix, 0.24, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.08, 6]} />
        </mesh>
      ))}
    </group>
  );
}

function Props() {
  return (
    <group>
      <Railing from={[-0.3, 1.38]} to={[0.6, 1.38]} />
      <Railing from={[0.8, 0.28]} to={[1.38, 0.28]} />
      <Transformer x={0.6} z={-1.35} />
      <Transformer x={0.78} z={-0.72} />
      {/* Crates in the back-left corner */}
      <Box p={[-1.28, 0.18, -1.3]} s={[0.16, 0.16, 0.16]} m={M.crateBlue} cast />
      <Box p={[-1.28, 0.32, -1.3]} s={[0.12, 0.12, 0.12]} m={M.crateBlue} />
      <Box p={[-1.1, 0.16, -1.36]} s={[0.12, 0.12, 0.12]} m={M.crateDark} />
      {/* Barrels */}
      {[
        [-1.38, 0.02],
        [-1.27, 0.06],
      ].map(([bx, bz]) => (
        <mesh key={bx} material={M.pipeBlue} position={[bx, 0.16, bz]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.12, 10]} />
        </mesh>
      ))}
    </group>
  );
}

// --- 8. Steam / smoke -----------------------------------------------------------

export function Steam({
  origin,
  count,
  rise,
  spread,
  size,
  phase,
  color = '#eef0f2',
}: {
  origin: V3;
  count: number;
  rise: number;
  spread: number;
  size: number;
  phase: number;
  color?: string;
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);

  // One material per puff so each can fade independently.
  const puffs = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        offset: i / count,
        speed: 0.16 + (i % 3) * 0.035,
        dirX: Math.sin(i * 2.4) * spread,
        dirZ: Math.cos(i * 1.9) * spread,
        spin: 0.4 + (i % 2) * 0.5,
        mat: new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: 0,
          roughness: 1,
          depthWrite: false,
          flatShading: true,
        }),
      })),
    [count, spread, color],
  );
  useEffect(() => () => puffs.forEach((p) => p.mat.dispose()), [puffs]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let i = 0; i < puffs.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const p = puffs[i];
      const k = (p.offset + t * p.speed) % 1; // 0..1 lifetime
      m.position.set(p.dirX * k, k * rise, p.dirZ * k);
      m.scale.setScalar(size * (0.6 + k * 1.1));
      m.rotation.set(t * p.spin, t * p.spin * 0.7, 0);
      // Fade in quickly, fade out toward the top.
      p.mat.opacity = Math.sin(k * Math.PI) * 0.85;
    }
  });

  return (
    <group position={origin}>
      {puffs.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          material={p.mat}
        >
          {i % 2 === 0 ? <icosahedronGeometry args={[1, 0]} /> : <boxGeometry args={[1, 1, 1]} />}
        </mesh>
      ))}
    </group>
  );
}
