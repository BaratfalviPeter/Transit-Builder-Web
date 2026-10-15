/**
 * MineModel — a detailed, animated low-poly open-pit mine on a 3×3-cell lot.
 *
 * Built in CELL UNITS like PowerPlantModel: the base is exactly [3, 0.1, 3]
 * centered on the origin, resting on Y=0; the caller scales by `cellSize`.
 *
 * Contents:
 *   - gravel slab with a curb,
 *   - an open pit (stepped lathe terraces) with ladders, an ore floor and a
 *     small excavator digging,
 *   - an inclined conveyor on wooden trestles from the pit to a rusty crusher
 *     with big gears,
 *   - an output belt up to a loading bunker over a rail track with ore carts,
 *   - a shaft headframe with a spinning sheave, a hoist cage and a winch house,
 *   - a site office shed and a flood-light pole (one pointLight, no shadows).
 *
 * Animations (useFrame): ore chunks on both belts, crusher gears spinning and
 * the hopper shaking, dust puffs, excavator arm digging, ore train shuttling,
 * hoist cage going up/down with the sheave + winch drum turning in sync.
 * `phase` desyncs multiple mines.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Steam } from './PowerPlantModel';

type V3 = [number, number, number];

export interface MineModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

const M = {
  gravel: std('#a3977f', { roughness: 1 }),
  curb: std('#857a66'),
  dirt: std('#9c7650', { roughness: 1, flatShading: true, side: THREE.DoubleSide }),
  oreFloor: std('#5d4a3a', { roughness: 1 }),
  ore: std('#8c5a3c', { roughness: 1, flatShading: true }),
  rock: std('#6f6a64', { roughness: 1, flatShading: true }),
  wood: std('#7a5530'),
  woodDark: std('#5a3d22'),
  rust: std('#8f4a2f', { roughness: 0.7, metalness: 0.3 }),
  rustDark: std('#6a3420', { roughness: 0.7, metalness: 0.3 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  dark: std('#2c2f35', { roughness: 0.7 }),
  belt: std('#3b3e44'),
  yellow: std('#e8b82e', { roughness: 0.5 }),
  shed: std('#6d7f8c'),
  roof: std('#4a4f57'),
  door: std('#8a3f26'),
  window: std('#ffd36b', { emissive: '#ffb84a', emissiveIntensity: 0.9, roughness: 0.4 }),
  lamp: new THREE.MeshBasicMaterial({ color: '#fff1b8', toneMapped: false }),
  cable: std('#1d1f23'),
};

/** Pit center (x, z) and outer radius, in lot units. */
const PIT: V3 = [-0.52, 0.1, 0.5];
const PIT_R = 0.88;

/** Lathe profile (radius, height above the slab) — a stepped crater. */
const PIT_PROFILE = [
  [0.88, 0],
  [0.8, 0.3],
  [0.72, 0.3],
  [0.72, 0.2],
  [0.58, 0.2],
  [0.58, 0.1],
  [0.44, 0.1],
  [0.44, 0.01],
  [0.0, 0.01],
].map(([r, y]) => new THREE.Vector2(r, y));
const PIT_GEOM = new THREE.LatheGeometry(PIT_PROFILE, 14);

/** A thin rod between two arbitrary points (shared unit box, oriented). */
function Rod({ from, to, w = 0.012, m }: { from: V3; to: V3; w?: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const d = b.clone().sub(a);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      d.normalize(),
    );
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
  }, [from, to]);
  return (
    <mesh
      geometry={BOX}
      material={m}
      position={pos}
      quaternion={quat}
      scale={[w, len, w]}
    />
  );
}

export function MineModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: MineModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Base />
      <Pit phase={phase} />
      <MainConveyor phase={phase} />
      <Crusher phase={phase} />
      <OutputLine phase={phase} />
      <OreTrain phase={phase} />
      <Headframe phase={phase} />
      <Office />
      <FloodLight />
      {/* Dust from the crusher hopper + a faint haze over the pit */}
      <Steam origin={[0.72, 0.85, 0.35]} count={4} rise={0.6} spread={0.18} size={0.07} color="#b7a58c" phase={phase} />
      <Steam origin={[PIT[0] - 0.1, 0.15, PIT[2] + 0.05]} count={3} rise={0.4} spread={0.15} size={0.06} color="#a8957a" phase={phase + 1.3} />
    </group>
  );
}

// --- Base ---------------------------------------------------------------------

function Base() {
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.gravel} />
      <Box p={[0, 0.13, -1.47]} s={[3, 0.06, 0.06]} m={M.curb} />
      <Box p={[0, 0.13, 1.47]} s={[3, 0.06, 0.06]} m={M.curb} />
      <Box p={[-1.47, 0.13, 0]} s={[0.06, 0.06, 2.88]} m={M.curb} />
      <Box p={[1.47, 0.13, 0]} s={[0.06, 0.06, 2.88]} m={M.curb} />
      {/* Rock heaps on the free corner */}
      <mesh material={M.rock} position={[1.15, 0.2, 1.15]} castShadow>
        <coneGeometry args={[0.22, 0.2, 6]} />
      </mesh>
      <mesh material={M.ore} position={[0.85, 0.17, 1.25]} castShadow>
        <coneGeometry args={[0.15, 0.14, 6]} />
      </mesh>
    </group>
  );
}

// --- Open pit -------------------------------------------------------------------

function Ladder({ angle, r, y0, h }: { angle: number; r: number; y0: number; h: number }) {
  const rungs = Math.max(2, Math.round(h / 0.035));
  return (
    <group
      position={[PIT[0] + Math.cos(angle) * r, PIT[1] + y0, PIT[2] + Math.sin(angle) * r]}
      rotation={[0, -angle + Math.PI / 2, 0]}
    >
      <Box p={[-0.025, h / 2, 0]} s={[0.008, h + 0.03, 0.008]} m={M.woodDark} />
      <Box p={[0.025, h / 2, 0]} s={[0.008, h + 0.03, 0.008]} m={M.woodDark} />
      {Array.from({ length: rungs }).map((_, i) => (
        <Box key={i} p={[0, ((i + 0.5) * h) / rungs, 0]} s={[0.05, 0.006, 0.006]} m={M.wood} />
      ))}
    </group>
  );
}

function Pit({ phase }: { phase: number }) {
  const boom = useRef<THREE.Group>(null);
  const stick = useRef<THREE.Group>(null);
  const cab = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    const dig = Math.sin(t * 1.3);
    if (boom.current) boom.current.rotation.z = 0.5 + dig * 0.25;
    if (stick.current) stick.current.rotation.z = -1.2 - dig * 0.35;
    if (cab.current) cab.current.rotation.y = Math.sin(t * 0.35) * 0.6;
  });

  return (
    <group>
      <mesh geometry={PIT_GEOM} material={M.dirt} position={PIT} castShadow receiveShadow />
      {/* Dark ore floor */}
      <mesh material={M.oreFloor} position={[PIT[0], PIT[1] + 0.012, PIT[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.44, 14]} />
      </mesh>
      {/* Yellow safety rail along part of the rim */}
      {Array.from({ length: 7 }).map((_, i) => {
        const a = -2.6 + i * 0.32;
        return (
          <Box
            key={i}
            p={[PIT[0] + Math.cos(a) * 0.79, PIT[1] + 0.36, PIT[2] + Math.sin(a) * 0.79]}
            s={[0.012, 0.1, 0.012]}
            m={M.yellow}
          />
        );
      })}
      <Ladder angle={2.3} r={0.57} y0={0.1} h={0.1} />
      <Ladder angle={-0.9} r={0.71} y0={0.2} h={0.1} />
      <Ladder angle={1.2} r={0.43} y0={0.01} h={0.09} />

      {/* Ore pile at the belt intake */}
      <mesh material={M.ore} position={[PIT[0] + 0.1, PIT[1] + 0.06, PIT[2] - 0.14]} castShadow>
        <coneGeometry args={[0.1, 0.1, 6]} />
      </mesh>

      {/* Little excavator digging */}
      <group position={[PIT[0] - 0.18, PIT[1] + 0.012, PIT[2] + 0.1]}>
        <Box p={[0, 0.02, 0]} s={[0.14, 0.035, 0.11]} m={M.dark} />
        <group ref={cab}>
          <Box p={[0, 0.06, 0]} s={[0.11, 0.045, 0.09]} m={M.yellow} cast />
          <Box p={[-0.02, 0.1, 0.02]} s={[0.05, 0.045, 0.045]} m={M.yellow} />
          <Box p={[-0.02, 0.1, 0.043]} s={[0.04, 0.03, 0.002]} m={M.window} />
          <group ref={boom} position={[0.04, 0.08, -0.015]}>
            <Box p={[0.06, 0, 0]} s={[0.12, 0.016, 0.016]} m={M.yellow} />
            <group ref={stick} position={[0.12, 0, 0]}>
              <Box p={[0.04, 0, 0]} s={[0.08, 0.013, 0.013]} m={M.yellow} />
              <Box p={[0.085, -0.01, 0]} s={[0.025, 0.03, 0.035]} m={M.dark} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

// --- Conveyors --------------------------------------------------------------------

/** Inclined belt from `a` to `b` (along X or Z) with ore chunks moving a->b. */
function Belt({
  a,
  b,
  chunks,
  speed,
  phase,
  legs,
  legBase = 0.1,
  m = M.wood,
}: {
  a: V3;
  b: V3;
  chunks: number;
  speed: number;
  phase: number;
  /** Fractions 0..1 along the belt where a trestle stands. */
  legs: number[];
  legBase?: number;
  m?: THREE.Material;
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const geo = useMemo(() => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const horiz = Math.hypot(d.x, d.z);
    const yaw = Math.atan2(-d.z, d.x);
    const pitch = Math.atan2(d.y, horiz);
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return { len, yaw, pitch, mid };
  }, [a, b]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let i = 0; i < chunks; i++) {
      const c = refs.current[i];
      if (!c) continue;
      const k = (t * speed + i / chunks) % 1;
      c.position.x = -geo.len / 2 + k * geo.len;
    }
  });

  return (
    <group>
      <group position={geo.mid} rotation={[0, geo.yaw, 0]}>
        <group rotation={[0, 0, geo.pitch]}>
          <Box p={[0, 0, 0]} s={[geo.len, 0.02, 0.1]} m={M.belt} cast />
          <Box p={[0, 0.015, 0.055]} s={[geo.len, 0.03, 0.012]} m={M.steel} />
          <Box p={[0, 0.015, -0.055]} s={[geo.len, 0.03, 0.012]} m={M.steel} />
          {Array.from({ length: chunks }).map((_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              geometry={BOX}
              material={M.ore}
              position={[0, 0.03, i % 2 ? 0.015 : -0.015]}
              scale={[0.04, 0.035, 0.04]}
            />
          ))}
        </group>
      </group>
      {/* Wooden trestles (A-frames) */}
      {legs.map((f) => {
        const x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f - 0.02;
        const z = a[2] + (b[2] - a[2]) * f;
        const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
        const off = 0.07;
        const p1: V3 = alongX ? [x, legBase, z - off] : [x - off, legBase, z];
        const p2: V3 = alongX ? [x, legBase, z + off] : [x + off, legBase, z];
        const top: V3 = [x, y, z];
        return (
          <group key={f}>
            <Rod from={p1} to={top} w={0.018} m={m} />
            <Rod from={p2} to={top} w={0.018} m={m} />
            <Rod
              from={[(p1[0] + x) / 2, (legBase + y) / 2, (p1[2] + z) / 2]}
              to={[(p2[0] + x) / 2, (legBase + y) / 2, (p2[2] + z) / 2]}
              w={0.01}
              m={m}
            />
          </group>
        );
      })}
    </group>
  );
}

const MAIN_A: V3 = [-0.45, 0.16, 0.38];
const MAIN_B: V3 = [0.62, 0.86, 0.38];

function MainConveyor({ phase }: { phase: number }) {
  return <Belt a={MAIN_A} b={MAIN_B} chunks={7} speed={0.16} phase={phase} legs={[0.45, 0.75]} />;
}

// --- Crusher ------------------------------------------------------------------------

function Gear({ r, teeth, m }: { r: number; teeth: number; m: THREE.Material }) {
  return (
    <group>
      <mesh material={m} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, 0.03, 16]} />
      </mesh>
      <mesh material={M.dark} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.3, r * 0.3, 0.045, 10]} />
      </mesh>
      {Array.from({ length: teeth }).map((_, i) => {
        const a = (i / teeth) * Math.PI * 2;
        return (
          <Box
            key={i}
            p={[0, Math.cos(a) * r, Math.sin(a) * r]}
            s={[0.03, r * 0.35, r * 0.35]}
            m={m}
          />
        );
      })}
    </group>
  );
}

function Crusher({ phase }: { phase: number }) {
  const g1 = useRef<THREE.Group>(null);
  const g2 = useRef<THREE.Group>(null);
  const fly = useRef<THREE.Group>(null);
  const hopper = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    if (g1.current) g1.current.rotation.x = t * 1.2;
    if (g2.current) g2.current.rotation.x = -t * 1.2 * (0.13 / 0.08);
    if (fly.current) fly.current.rotation.z = -t * 2.4;
    if (hopper.current) {
      hopper.current.position.x = Math.sin(t * 37) * 0.004;
      hopper.current.position.z = Math.cos(t * 29) * 0.004;
    }
  });

  // Body: x 0.525..1.075, z 0.1..0.6, top at y 0.6.
  return (
    <group position={[0.8, 0.1, 0.35]}>
      <Box p={[0, 0.03, 0]} s={[0.62, 0.06, 0.56]} m={M.dark} />
      <Box p={[0, 0.28, 0]} s={[0.55, 0.44, 0.5]} m={M.rust} cast />
      {/* Riveted bands */}
      {[0.14, 0.42].map((y) => (
        <Box key={y} p={[0, y, 0]} s={[0.57, 0.03, 0.52]} m={M.rustDark} />
      ))}
      {/* Hopper (inverted square funnel), shaking */}
      <group ref={hopper}>
        <mesh material={M.rustDark} position={[-0.08, 0.6, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.1, 0.2, 4]} />
        </mesh>
      </group>
      {/* Gears on the +X face */}
      <group ref={g1} position={[0.3, 0.3, -0.08]}>
        <Gear r={0.13} teeth={10} m={M.rustDark} />
      </group>
      <group ref={g2} position={[0.3, 0.15, 0.13]}>
        <Gear r={0.08} teeth={7} m={M.steel} />
      </group>
      {/* Flywheel on the front (+Z) */}
      <group position={[0.12, 0.25, 0.27]}>
        <group ref={fly}>
          <mesh material={M.dark}>
            <torusGeometry args={[0.1, 0.018, 6, 16]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation={[0, 0, (i * Math.PI) / 3]}>
              <Box p={[0, 0, 0]} s={[0.012, 0.2, 0.012]} m={M.dark} />
            </group>
          ))}
        </group>
      </group>
      {/* Discharge chute toward the output belt (back, −Z) */}
      <Box p={[0, 0.22, -0.28]} s={[0.12, 0.08, 0.08]} m={M.rustDark} />
    </group>
  );
}

// --- Output belt + bunker + rail ------------------------------------------------------

const OUT_A: V3 = [0.8, 0.32, 0.02];
const OUT_B: V3 = [0.8, 0.9, -1.0];
const RAIL_Z = -1.2;

function OutputLine({ phase }: { phase: number }) {
  return (
    <group>
      <Belt a={OUT_A} b={OUT_B} chunks={5} speed={0.12} phase={phase + 0.4} legs={[0.35, 0.75]} m={M.steel} />
      {/* Loading bunker on legs, straddling the rails */}
      <group position={[0.8, 0.1, RAIL_Z]}>
        {[
          [-0.14, -0.14],
          [0.14, -0.14],
          [0.14, 0.14],
          [-0.14, 0.14],
        ].map(([lx, lz]) => (
          <Box key={`${lx}${lz}`} p={[lx, 0.3, lz]} s={[0.025, 0.6, 0.025]} m={M.steel} />
        ))}
        <Box p={[0, 0.66, 0]} s={[0.32, 0.18, 0.32]} m={M.rust} cast />
        <mesh material={M.rustDark} position={[0, 0.51, 0]} rotation={[0, Math.PI / 4, 0]}>
          <cylinderGeometry args={[0.2, 0.06, 0.12, 4]} />
        </mesh>
      </group>
      {/* Track */}
      <Box p={[0, 0.115, RAIL_Z - 0.045]} s={[2.8, 0.015, 0.012]} m={M.steel} />
      <Box p={[0, 0.115, RAIL_Z + 0.045]} s={[2.8, 0.015, 0.012]} m={M.steel} />
      {Array.from({ length: 19 }).map((_, i) => (
        <Box key={i} p={[-1.35 + i * 0.15, 0.104, RAIL_Z]} s={[0.03, 0.01, 0.14]} m={M.woodDark} />
      ))}
      {/* Buffer stops */}
      <Box p={[-1.38, 0.15, RAIL_Z]} s={[0.04, 0.07, 0.14]} m={M.yellow} />
      <Box p={[1.38, 0.15, RAIL_Z]} s={[0.04, 0.07, 0.14]} m={M.yellow} />
    </group>
  );
}

function OreTrain({ phase }: { phase: number }) {
  const train = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    if (train.current) train.current.position.x = Math.sin(t * 0.3) * 0.85;
  });
  return (
    <group ref={train} position={[0, 0.1, RAIL_Z]}>
      {[-0.2, 0, 0.2].map((cx, i) => (
        <group key={cx} position={[cx, 0, 0]}>
          <Box p={[0, 0.07, 0]} s={[0.16, 0.08, 0.13]} m={i === 1 ? M.rustDark : M.rust} cast />
          <mesh material={M.ore} position={[0, 0.12, 0]} castShadow>
            <coneGeometry args={[0.07, 0.05, 5]} />
          </mesh>
          {[-0.05, 0.05].map((wx) =>
            [-0.06, 0.06].map((wz) => (
              <mesh key={`${wx}${wz}`} material={M.dark} position={[wx, 0.03, wz]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.022, 0.022, 0.012, 8]} />
              </mesh>
            )),
          )}
          {i < 2 && <Box p={[0.1, 0.05, 0]} s={[0.04, 0.01, 0.01]} m={M.dark} />}
        </group>
      ))}
    </group>
  );
}

// --- Headframe + winch -------------------------------------------------------------------

const HF: V3 = [-1.1, 0.1, -0.7];
const HF_H = 0.9;
const SHEAVE_R = 0.09;
const DRUM: V3 = [-0.66, 0.3, -0.7];
const DRUM_R = 0.05;

function Headframe({ phase }: { phase: number }) {
  const cage = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  const sheave = useRef<THREE.Group>(null);
  const drum = useRef<THREE.Group>(null);
  const sheaveY = HF[1] + HF_H + 0.06;
  const cableX = HF[0];

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    const y = 0.45 + 0.27 * Math.sin(t * 0.45); // cage bottom (lot units)
    if (cage.current) cage.current.position.y = y;
    if (cable.current) {
      const top = sheaveY;
      const bottom = y + 0.12;
      cable.current.position.y = (top + bottom) / 2;
      cable.current.scale.y = Math.max(0.001, top - bottom);
    }
    if (sheave.current) sheave.current.rotation.z = y / SHEAVE_R;
    if (drum.current) drum.current.rotation.z = -y / DRUM_R;
  });

  const legs: Array<[number, number]> = [
    [-0.15, -0.13],
    [0.15, -0.13],
    [0.15, 0.13],
    [-0.15, 0.13],
  ];
  return (
    <group>
      {/* Shaft collar */}
      <Box p={[HF[0], HF[1] + 0.02, HF[2]]} s={[0.36, 0.04, 0.32]} m={M.dark} />
      {/* Tapered steel legs + cross braces */}
      {legs.map(([lx, lz]) => (
        <Rod
          key={`${lx}${lz}`}
          from={[HF[0] + lx, HF[1], HF[2] + lz]}
          to={[HF[0] + lx * 0.6, HF[1] + HF_H, HF[2] + lz * 0.6]}
          w={0.022}
          m={M.rustDark}
        />
      ))}
      {[0.3, 0.6].map((f) => {
        const k = 1 - 0.4 * f;
        const y = HF[1] + HF_H * f;
        return (
          <group key={f}>
            <Box p={[HF[0], y, HF[2] - 0.13 * k]} s={[0.3 * k, 0.012, 0.012]} m={M.steel} />
            <Box p={[HF[0], y, HF[2] + 0.13 * k]} s={[0.3 * k, 0.012, 0.012]} m={M.steel} />
          </group>
        );
      })}
      {/* Back strut toward the winch */}
      <Rod from={[HF[0] + 0.36, HF[1], HF[2]]} to={[HF[0] + 0.09, HF[1] + HF_H, HF[2]]} w={0.02} m={M.rustDark} />
      {/* Top platform */}
      <Box p={[HF[0], HF[1] + HF_H, HF[2]]} s={[0.2, 0.025, 0.16]} m={M.steel} />
      {/* Sheave wheel (spins with the hoist) */}
      <group ref={sheave} position={[HF[0] + SHEAVE_R, sheaveY, HF[2]]}>
        <mesh material={M.dark}>
          <torusGeometry args={[SHEAVE_R, 0.012, 6, 18]} />
        </mesh>
        <Box p={[0, 0, 0]} s={[SHEAVE_R * 2, 0.01, 0.01]} m={M.dark} />
        <Box p={[0, 0, 0]} s={[0.01, SHEAVE_R * 2, 0.01]} m={M.dark} />
      </group>
      {/* Hoist cable down to the cage (rescaled every frame) */}
      <mesh ref={cable} geometry={BOX} material={M.cable} position={[cableX, 0.6, HF[2]]} scale={[0.008, 0.5, 0.008]} />
      {/* Cable from the sheave top to the winch drum */}
      <Rod from={[HF[0] + SHEAVE_R, sheaveY + SHEAVE_R, HF[2]]} to={[DRUM[0], DRUM[1] + DRUM_R, DRUM[2]]} w={0.007} m={M.cable} />
      {/* Cage */}
      <group ref={cage} position={[cableX, 0.4, HF[2]]}>
        <Box p={[0, 0.06, 0]} s={[0.09, 0.12, 0.09]} m={M.yellow} cast />
        <Box p={[0, 0.06, 0.046]} s={[0.05, 0.07, 0.002]} m={M.dark} />
      </group>

      {/* Winch house + drum on a stand */}
      <group position={[-0.4, 0.1, -0.7]}>
        <Box p={[0, 0.13, 0]} s={[0.3, 0.26, 0.26]} m={M.shed} cast />
        <Box p={[0, 0.275, 0]} s={[0.34, 0.03, 0.3]} m={M.roof} cast />
        <Box p={[0.151, 0.15, 0.05]} s={[0.002, 0.06, 0.06]} m={M.window} />
        <Box p={[0, 0.1, 0.131]} s={[0.08, 0.16, 0.002]} m={M.door} />
      </group>
      <Box p={[DRUM[0], 0.2, DRUM[2] - 0.06]} s={[0.03, 0.2, 0.02]} m={M.steel} />
      <Box p={[DRUM[0], 0.2, DRUM[2] + 0.06]} s={[0.03, 0.2, 0.02]} m={M.steel} />
      <group ref={drum} position={DRUM}>
        <mesh material={M.rust} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[DRUM_R, DRUM_R, 0.1, 12]} />
        </mesh>
        <Box p={[0, 0, 0]} s={[DRUM_R * 2.4, 0.012, 0.104]} m={M.rustDark} />
      </group>
    </group>
  );
}

// --- Office + flood light -------------------------------------------------------------------

function Office() {
  return (
    <group position={[0.2, 0.1, -0.5]}>
      <Box p={[0, 0.15, 0]} s={[0.45, 0.3, 0.34]} m={M.shed} cast />
      {/* Sloped corrugated roof */}
      <group position={[0, 0.33, 0]} rotation={[0.18, 0, 0]}>
        <Box p={[0, 0, 0]} s={[0.5, 0.025, 0.4]} m={M.roof} cast />
        {[-0.18, -0.09, 0, 0.09, 0.18].map((rx) => (
          <Box key={rx} p={[rx, 0.016, 0]} s={[0.012, 0.008, 0.4]} m={M.dark} />
        ))}
      </group>
      <Box p={[-0.1, 0.18, 0.171]} s={[0.1, 0.07, 0.002]} m={M.window} />
      <Box p={[0.08, 0.18, 0.171]} s={[0.1, 0.07, 0.002]} m={M.window} />
      <Box p={[0.2, 0.1, 0.171]} s={[0.07, 0.18, 0.002]} m={M.door} />
      {/* Crates + barrels by the door */}
      <Box p={[0.3, 0.04, 0.25]} s={[0.08, 0.08, 0.08]} m={M.wood} cast />
      <Box p={[0.3, 0.11, 0.25]} s={[0.06, 0.06, 0.06]} m={M.woodDark} />
      <mesh material={M.yellow} position={[-0.27, 0.05, 0.22]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.1, 8]} />
      </mesh>
    </group>
  );
}

function FloodLight() {
  const lightRef = useRef<THREE.PointLight>(null);
  return (
    <group position={[0.45, 0.1, -0.05]}>
      <Box p={[0, 0.02, 0]} s={[0.06, 0.04, 0.06]} m={M.dark} />
      <Box p={[0, 0.45, 0]} s={[0.025, 0.9, 0.025]} m={M.steel} />
      <Box p={[-0.05, 0.9, 0]} s={[0.12, 0.02, 0.02]} m={M.steel} />
      <Box p={[-0.1, 0.88, 0]} s={[0.07, 0.035, 0.06]} m={M.dark} />
      <Box p={[-0.1, 0.86, 0]} s={[0.06, 0.006, 0.05]} m={M.lamp} />
      <pointLight
        ref={lightRef}
        position={[-0.25, 0.8, 0.2]}
        color="#ffd9a0"
        intensity={6}
        distance={7}
        decay={2}
      />
    </group>
  );
}

// Keep the pit radius exported for potential future placement checks.
export const MINE_PIT_RADIUS = PIT_R;
