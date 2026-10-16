/**
 * FactoryModel — a detailed, animated low-poly steel works / factory on a
 * 3×3-cell lot, after the reference art.
 *
 * Built in CELL UNITS: the base slab is exactly [3, 0.1, 3] centered on the
 * origin, resting on Y=0; the caller scales the group by `cellSize`.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - back-left: a big slate steel hall with three parallel gabled bays
 *     (corrugated, rust-tinted roofs), rows of small glowing windows;
 *   - front of the hall: two glowing furnace mouths (flickering orange light +
 *     sparks), each feeding a conveyor that carries crates out into the yard;
 *   - back-right: two tall dark, rust-banded chimneys with smoke;
 *   - right of the hall: rust / blue pipes with red valve wheels into two rusty
 *     tanks; pallets, crates, barrels, a shuttling forklift;
 *   - front-right: a small slewing jib crane, a parked truck;
 *   - yellow safety railings along the yard edges.
 *
 * Performance: shared module materials, one warm pointLight per factory (no
 * shadow), crates/sparks reuse the unit box. Animations (useFrame): conveyor
 * crates, furnace flicker, sparks, smoke, forklift, jib crane.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Pipe, Steam } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface FactoryModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

// --- Shared materials --------------------------------------------------------

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  slab: std('#d8d2c6', { roughness: 0.95 }),
  joint: std('#bfb7a8', { roughness: 1 }),
  curb: std('#ece6da', { roughness: 0.95 }),
  hall: std('#3f4655'),
  hallDark: std('#2f3540'),
  roof: std('#5a5c61', { roughness: 0.8, metalness: 0.15 }),
  roofRib: std('#6b5244', { roughness: 0.8 }),
  window: new THREE.MeshBasicMaterial({ color: '#ffd36b', toneMapped: false }),
  furnaceFrame: std('#6a6e75', { roughness: 0.7, metalness: 0.3 }),
  furnaceDark: new THREE.MeshBasicMaterial({ color: '#1a0e08' }),
  glow: new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false }),
  spark: new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false }),
  chimney: std('#34373d', { roughness: 0.8 }),
  rust: std('#8f4a2f', { roughness: 0.6, metalness: 0.25 }),
  rustDark: std('#6a3420', { roughness: 0.7, metalness: 0.3 }),
  pipeBlue: std('#5a7f9e', { roughness: 0.5, metalness: 0.25 }),
  valveRed: std('#c23a2b', { roughness: 0.5 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  dark: std('#2a2c31', { roughness: 0.7 }),
  belt: std('#26282c'),
  yellow: std('#e8b82e', { roughness: 0.5 }),
  crate: std('#a8794a'),
  crateDark: std('#7d5634'),
  pallet: std('#b48a5a'),
  barrelRust: std('#9a4a2e', { roughness: 0.6 }),
  barrelGrey: std('#59606a', { roughness: 0.6 }),
  truck: std('#7a5a44', { roughness: 0.6 }),
  glass: std('#3d4a55', { roughness: 0.3 }),
  tire: std('#1f2125', { roughness: 0.9 }),
  cable: std('#1d1f23'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/** Triangular gable prism: width w (x), height h (y), depth d (z), base y=0. */
function prismGeom(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

// --- Layout -------------------------------------------------------------------------

/** Hall footprint and roof. Three bays side by side along X, ridges along Z. */
const HALL = { x0: -1.3, x1: 0.5, z0: -1.3, z1: 0.15, h: 0.78, rise: 0.3, bays: 3 };
const BAY_W = (HALL.x1 - HALL.x0) / HALL.bays;
const HALL_CX = (HALL.x0 + HALL.x1) / 2;
const HALL_CZ = (HALL.z0 + HALL.z1) / 2;
const HALL_D = HALL.z1 - HALL.z0;
/** Furnace mouths on the front wall (bay centres 1 and 2). */
const FURNACES = [HALL.x0 + BAY_W * 0.5, HALL.x0 + BAY_W * 1.5];
const FURN_W = 0.32;
const FURN_H = 0.36;
/** Conveyors from each furnace out to the front of the yard. */
const BELT_Z0 = HALL.z1 + 0.02;
const BELT_Z1 = 1.05;
const BELT_Y = 0.24;
const CRATES_PER_BELT = 4;
const SPARKS = 12;

// --- Model ------------------------------------------------------------------------

export function FactoryModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: FactoryModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Ground />
      <Hall />
      <Furnaces phase={phase} />
      <Conveyors phase={phase} />
      <Chimneys phase={phase} />
      <PipesAndTanks />
      <Yard phase={phase} />
      <JibCrane phase={phase} />
      <Railings />
    </group>
  );
}

// --- Ground ---------------------------------------------------------------------------

function Ground() {
  const joints = [-1, -0.5, 0, 0.5, 1];
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.slab} />
      {joints.map((j) => (
        <Box key={`jx${j}`} p={[j, 0.101, 0]} s={[0.01, 0.004, 3]} m={M.joint} />
      ))}
      {joints.map((j) => (
        <Box key={`jz${j}`} p={[0, 0.101, j]} s={[3, 0.004, 0.01]} m={M.joint} />
      ))}
      {/* Raised light curb around the lot */}
      <Box p={[0, 0.13, 1.47]} s={[3, 0.06, 0.06]} m={M.curb} cast />
      <Box p={[0, 0.13, -1.47]} s={[3, 0.06, 0.06]} m={M.curb} cast />
      <Box p={[1.47, 0.13, 0]} s={[0.06, 0.06, 2.88]} m={M.curb} cast />
      <Box p={[-1.47, 0.13, 0]} s={[0.06, 0.06, 2.88]} m={M.curb} cast />
      {/* Darker loading apron + driveway gap in the front curb */}
      <Box p={[0.95, 0.103, 1.1]} s={[0.6, 0.008, 0.7]} m={M.joint} />
    </group>
  );
}

// --- Hall -----------------------------------------------------------------------------

function Hall() {
  const gable = useMemo(() => prismGeom(BAY_W, HALL.rise, 0.02), []);
  const slope = Math.atan2(HALL.rise, BAY_W / 2);
  const panelW = Math.hypot(BAY_W / 2, HALL.rise) + 0.03;
  const ribs = 12;
  const frontZ = HALL.z1 + 0.006;
  const sideX = HALL.x1 + 0.006;
  return (
    <group position={[0, 0.1, 0]}>
      {/* Walls */}
      <Box p={[HALL_CX, HALL.h / 2, HALL_CZ]} s={[HALL.x1 - HALL.x0, HALL.h, HALL_D]} m={M.hall} cast />
      <Box p={[HALL_CX, 0.03, HALL_CZ]} s={[HALL.x1 - HALL.x0 + 0.02, 0.06, HALL_D + 0.02]} m={M.hallDark} />
      {/* Steel pilasters between bays (front + side) */}
      {Array.from({ length: HALL.bays + 1 }).map((_, i) => (
        <Box key={`pf${i}`} p={[HALL.x0 + i * BAY_W, HALL.h / 2, frontZ]} s={[0.04, HALL.h, 0.02]} m={M.hallDark} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <Box key={`ps${f}`} p={[sideX, HALL.h / 2, HALL.z0 + HALL_D * f]} s={[0.02, HALL.h, 0.04]} m={M.hallDark} />
      ))}
      {/* Each bay: gables front/back, two corrugated roof panels, ridge cap */}
      {Array.from({ length: HALL.bays }).map((_, b) => {
        const cx = HALL.x0 + BAY_W * (b + 0.5);
        return (
          <group key={b}>
            {[HALL.z1 - 0.01, HALL.z0 + 0.01].map((gz) => (
              <mesh key={gz} geometry={gable} material={M.hall} position={[cx, HALL.h, gz]} castShadow />
            ))}
            {[-1, 1].map((side) => (
              <group
                key={side}
                position={[cx + (side * BAY_W) / 4, HALL.h + HALL.rise / 2 + 0.01, HALL_CZ]}
                rotation={[0, 0, -side * slope]}
              >
                <Box p={[0, 0, 0]} s={[panelW, 0.022, HALL_D + 0.08]} m={M.roof} cast />
                {Array.from({ length: ribs }).map((_, i) => (
                  <Box
                    key={i}
                    p={[0, 0.014, -HALL_D / 2 + ((i + 0.5) * HALL_D) / ribs]}
                    s={[panelW, 0.007, 0.018]}
                    m={i % 3 === 1 ? M.roofRib : M.hallDark}
                  />
                ))}
              </group>
            ))}
            <Box p={[cx, HALL.h + HALL.rise + 0.01, HALL_CZ]} s={[0.03, 0.025, HALL_D + 0.08]} m={M.hallDark} />
            {/* Gable window */}
            <Box p={[cx, HALL.h + HALL.rise * 0.35, HALL.z1 + 0.008]} s={[0.06, 0.06, 0.004]} m={M.window} />
          </group>
        );
      })}
      {/* Front windows: upper row across all bays (skipping furnace tops) */}
      {Array.from({ length: HALL.bays * 3 }).map((_, i) => {
        const px = HALL.x0 + BAY_W * (Math.floor(i / 3) + 0.25 + (i % 3) * 0.25);
        return <Box key={`fw${i}`} p={[px, HALL.h * 0.8, frontZ + 0.002]} s={[0.05, 0.05, 0.004]} m={M.window} />;
      })}
      {/* Third bay (no furnace): lower windows + a roll-up door */}
      {[0.2, 0.8].map((f) => (
        <Box
          key={`lw${f}`}
          p={[HALL.x0 + BAY_W * (2 + f), HALL.h * 0.45, frontZ + 0.002]}
          s={[0.05, 0.05, 0.004]}
          m={M.window}
        />
      ))}
      <Box p={[HALL.x0 + BAY_W * 2.5, 0.18, frontZ + 0.003]} s={[0.24, 0.36, 0.006]} m={M.furnaceFrame} />
      {Array.from({ length: 6 }).map((_, i) => (
        <Box key={`rd${i}`} p={[HALL.x0 + BAY_W * 2.5, 0.03 + i * 0.06, frontZ + 0.007]} s={[0.24, 0.006, 0.004]} m={M.hallDark} />
      ))}
      {/* Side windows (2 rows) */}
      {[0.15, 0.35, 0.55, 0.75].flatMap((f) =>
        [0.35, 0.62].map((y) => (
          <Box key={`sw${f}${y}`} p={[sideX + 0.002, y, HALL.z0 + HALL_D * f]} s={[0.004, 0.05, 0.05]} m={M.window} />
        )),
      )}
      {/* Left side downpipe */}
      <Pipe from={[HALL.x0 - 0.03, 0.0, HALL.z1 - 0.2]} to={[HALL.x0 - 0.03, HALL.h - 0.05, HALL.z1 - 0.2]} r={0.022} m={M.rust} />
    </group>
  );
}

// --- Furnaces + sparks ----------------------------------------------------------------------

function Furnaces({ phase }: { phase: number }) {
  const light = useRef<THREE.PointLight>(null);
  const glows = useRef<Array<THREE.Mesh | null>>([]);
  const sparks = useRef<Array<THREE.Mesh | null>>([]);
  const seeds = useMemo(
    () =>
      Array.from({ length: SPARKS }).map((_, i) => ({
        f: i % FURNACES.length,
        off: i / SPARKS,
        vx: (((i * 37) % 11) - 5) * 0.05,
        vy: 0.25 + ((i * 53) % 7) * 0.05,
        vz: 0.25 + ((i * 29) % 5) * 0.06,
        speed: 0.9 + ((i * 17) % 5) * 0.15,
      })),
    [],
  );
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    const flick = 0.85 + 0.1 * Math.sin(t * 13) + 0.08 * Math.sin(t * 7.3 + 1.1);
    if (light.current) light.current.intensity = 2.2 * flick;
    glows.current.forEach((g, i) => {
      if (g) g.scale.y = FURN_H * 0.62 * (0.92 + 0.08 * Math.sin(t * 9 + i * 2));
    });
    for (let i = 0; i < SPARKS; i++) {
      const m = sparks.current[i];
      if (!m) continue;
      const s = seeds[i];
      const k = (t * s.speed + s.off) % 1;
      m.position.set(
        FURNACES[s.f] + s.vx * k,
        0.1 + FURN_H * 0.45 + s.vy * k - 0.55 * k * k,
        HALL.z1 + 0.03 + s.vz * k,
      );
      m.scale.setScalar(0.014 * (1 - k * 0.7));
    }
  });

  const z = HALL.z1;
  return (
    <group>
      {FURNACES.map((fx, i) => (
        <group key={fx} position={[fx, 0.1, z]}>
          {/* Heavy steel frame around the mouth */}
          <Box p={[0, FURN_H / 2 + 0.04, 0.025]} s={[FURN_W + 0.1, FURN_H + 0.1, 0.05]} m={M.furnaceFrame} cast />
          <Box p={[0, FURN_H + 0.12, 0.03]} s={[FURN_W + 0.16, 0.05, 0.07]} m={M.hallDark} cast />
          {/* Dark recess + glowing hearth */}
          <Box p={[0, FURN_H / 2 + 0.03, 0.052]} s={[FURN_W, FURN_H, 0.004]} m={M.furnaceDark} />
          <mesh
            ref={(el) => {
              glows.current[i] = el;
            }}
            geometry={BOX}
            material={M.glow}
            position={[0, FURN_H * 0.35 + 0.03, 0.055]}
            scale={[FURN_W * 0.8, FURN_H * 0.62, 0.004]}
          />
          <Box p={[0, 0.045, 0.06]} s={[FURN_W * 0.9, 0.03, 0.02]} m={M.glow} />
        </group>
      ))}
      {/* One flickering warm light between the two furnaces (no shadow) */}
      <pointLight
        ref={light}
        position={[(FURNACES[0] + FURNACES[1]) / 2, 0.35, z + 0.3]}
        color="#ff8a3a"
        intensity={2.2}
        distance={2.6}
        decay={1.5}
      />
      {seeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            sparks.current[i] = el;
          }}
          geometry={BOX}
          material={M.spark}
        />
      ))}
    </group>
  );
}

// --- Conveyors -------------------------------------------------------------------------------

function Conveyors({ phase }: { phase: number }) {
  const crates = useRef<Array<THREE.Mesh | null>>([]);
  const len = BELT_Z1 - BELT_Z0;
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let b = 0; b < FURNACES.length; b++) {
      for (let i = 0; i < CRATES_PER_BELT; i++) {
        const m = crates.current[b * CRATES_PER_BELT + i];
        if (!m) continue;
        const k = (t * 0.09 + i / CRATES_PER_BELT + b * 0.37) % 1;
        m.position.z = BELT_Z0 + 0.05 + k * (len - 0.1);
        // Pop in at the furnace mouth, out at the belt end.
        const s = Math.min(1, k * 10, (1 - k) * 10);
        m.scale.setScalar(0.085 * Math.max(0.001, s));
      }
    }
  });
  const rollers = 10;
  return (
    <group>
      {FURNACES.map((fx, b) => (
        <group key={fx}>
          <Box p={[fx, BELT_Y - 0.02, (BELT_Z0 + BELT_Z1) / 2]} s={[0.22, 0.03, len]} m={M.belt} cast />
          <Box p={[fx - 0.12, BELT_Y, (BELT_Z0 + BELT_Z1) / 2]} s={[0.02, 0.05, len]} m={M.steel} />
          <Box p={[fx + 0.12, BELT_Y, (BELT_Z0 + BELT_Z1) / 2]} s={[0.02, 0.05, len]} m={M.steel} />
          {Array.from({ length: rollers }).map((_, i) => (
            <Box key={i} p={[fx, BELT_Y - 0.002, BELT_Z0 + ((i + 0.5) * len) / rollers]} s={[0.22, 0.006, 0.02]} m={M.dark} />
          ))}
          {[0.12, 0.5, 0.88].map((f) =>
            [-0.1, 0.1].map((dx) => (
              <Box
                key={`${f}${dx}`}
                p={[fx + dx, (0.1 + BELT_Y - 0.035) / 2, BELT_Z0 + f * len]}
                s={[0.022, BELT_Y - 0.135, 0.022]}
                m={M.dark}
              />
            )),
          )}
          {Array.from({ length: CRATES_PER_BELT }).map((_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                crates.current[b * CRATES_PER_BELT + i] = el;
              }}
              geometry={BOX}
              material={i % 2 ? M.crateDark : M.crate}
              position={[fx, BELT_Y + 0.045, BELT_Z0]}
              castShadow
            />
          ))}
          {/* Stack of finished crates at the belt end */}
          <Box p={[fx + 0.02, 0.15, BELT_Z1 + 0.12]} s={[0.1, 0.1, 0.1]} m={M.crate} cast />
          <Box p={[fx - 0.06, 0.15, BELT_Z1 + 0.2]} s={[0.09, 0.09, 0.09]} m={M.crateDark} cast />
        </group>
      ))}
    </group>
  );
}

// --- Chimneys -----------------------------------------------------------------------------------

const STACKS: Array<{ x: number; z: number; h: number }> = [
  { x: 0.78, z: -1.12, h: 1.75 },
  { x: 1.1, z: -0.85, h: 1.5 },
];

function Chimneys({ phase }: { phase: number }) {
  return (
    <group>
      {/* Shared base block */}
      <Box p={[0.94, 0.2, -0.98]} s={[0.6, 0.2, 0.55]} m={M.hallDark} cast />
      {STACKS.map((s, i) => (
        <group key={i} position={[s.x, 0.3, s.z]}>
          <mesh material={M.chimney} position={[0, s.h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.1, s.h, 14]} />
          </mesh>
          {[0.25, 0.55, 0.85].map((f) => (
            <mesh key={f} material={M.rustDark} position={[0, s.h * f, 0]}>
              <cylinderGeometry args={[0.1 - 0.025 * f + 0.008, 0.1 - 0.025 * f + 0.008, 0.035, 14]} />
            </mesh>
          ))}
          <mesh material={M.dark} position={[0, s.h + 0.02, 0]}>
            <cylinderGeometry args={[0.088, 0.08, 0.05, 14]} />
          </mesh>
          <Steam
            origin={[0, s.h + 0.05, 0]}
            count={6}
            rise={1.1}
            spread={0.25}
            size={0.09}
            color="#a9abb0"
            phase={phase + i * 1.3}
          />
        </group>
      ))}
    </group>
  );
}

// --- Pipes + tanks ---------------------------------------------------------------------------------

const TANKS: Array<[number, number]> = [
  [0.82, -0.3],
  [1.12, -0.1],
];

function Valve({ p }: { p: V3 }) {
  return (
    <mesh material={M.valveRed} position={p} rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[0.035, 0.008, 6, 12]} />
    </mesh>
  );
}

function PipesAndTanks() {
  const wall = HALL.x1;
  return (
    <group>
      {TANKS.map(([x, z]) => (
        <group key={x} position={[x, 0.1, z]}>
          {[
            [-0.08, -0.08],
            [0.08, -0.08],
            [0.08, 0.08],
            [-0.08, 0.08],
          ].map(([lx, lz]) => (
            <Box key={`${lx}${lz}`} p={[lx, 0.06, lz]} s={[0.02, 0.12, 0.02]} m={M.dark} />
          ))}
          <mesh material={M.rust} position={[0, 0.34, 0]} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.42, 16]} />
          </mesh>
          <mesh material={M.rust} position={[0, 0.55, 0]} castShadow>
            <sphereGeometry args={[0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh material={M.rust} position={[0, 0.13, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.13, 0.06, 16]} />
          </mesh>
          {[0.22, 0.46].map((y) => (
            <mesh key={y} material={M.rustDark} position={[0, y, 0]}>
              <cylinderGeometry args={[0.135, 0.135, 0.02, 16]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Big rust main: out of the hall wall into tank A's side */}
      <Pipe from={[wall, 0.5, -0.3]} to={[0.7, 0.5, -0.3]} r={0.04} m={M.rust} />
      <mesh material={M.rustDark} position={[0.6, 0.5, -0.3]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 12]} />
      </mesh>
      {/* Blue run low along the wall into tank B */}
      <Pipe from={[wall, 0.3, -0.1]} to={[1.0, 0.3, -0.1]} r={0.032} m={M.pipeBlue} />
      {/* Rust riser + crossover from tank B to tank A top */}
      <Pipe from={[1.12, 0.74, -0.1]} to={[1.12, 0.88, -0.1]} r={0.03} m={M.rust} />
      <Pipe from={[1.12, 0.88, -0.1]} to={[1.12, 0.88, -0.3]} r={0.03} m={M.rust} />
      <Pipe from={[1.12, 0.88, -0.3]} to={[0.82, 0.88, -0.3]} r={0.03} m={M.rust} />
      <Pipe from={[0.82, 0.74, -0.3]} to={[0.82, 0.88, -0.3]} r={0.03} m={M.rust} />
      {/* Grey run front of the hall to the side door */}
      <Pipe from={[wall, 0.45, 0.05]} to={[0.75, 0.45, 0.05]} r={0.028} m={M.steel} />
      <Pipe from={[0.75, 0.1, 0.05]} to={[0.75, 0.45, 0.05]} r={0.028} m={M.steel} />
      {/* Pipe supports + valves */}
      <Valve p={[0.56, 0.56, -0.3]} />
      <Valve p={[0.62, 0.3, -0.1]} />
      <Valve p={[0.95, 0.3, -0.1]} />
    </group>
  );
}

// --- Yard: pallets, crates, barrels, forklift, truck -----------------------------------------------

function Forklift({ phase }: { phase: number }) {
  const g = useRef<THREE.Group>(null);
  const fork = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * 0.35 + phase;
    const k = (Math.sin(t) + 1) / 2; // 0..1 back and forth
    if (g.current) {
      g.current.position.x = 0.65 + k * 0.55;
      g.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI; // face travel dir
    }
    if (fork.current) fork.current.position.y = 0.02 + 0.06 * (0.5 + 0.5 * Math.sin(t * 2));
  });
  return (
    <group ref={g} position={[0.8, 0.1, 0.42]}>
      <Box p={[0, 0.05, 0]} s={[0.12, 0.06, 0.08]} m={M.yellow} cast />
      <Box p={[-0.03, 0.11, 0]} s={[0.05, 0.07, 0.07]} m={M.dark} />
      <Box p={[-0.065, 0.06, 0]} s={[0.025, 0.05, 0.075]} m={M.dark} />
      <Box p={[0.07, 0.1, 0]} s={[0.012, 0.16, 0.06]} m={M.dark} />
      <group ref={fork} position={[0.09, 0.02, 0]}>
        <Box p={[0.03, 0, -0.02]} s={[0.06, 0.006, 0.01]} m={M.steel} />
        <Box p={[0.03, 0, 0.02]} s={[0.06, 0.006, 0.01]} m={M.steel} />
        <Box p={[0.035, 0.035, 0]} s={[0.06, 0.06, 0.06]} m={M.crate} cast />
      </group>
      {[-0.04, 0.04].map((wx) =>
        [-0.045, 0.045].map((wz) => (
          <mesh key={`${wx}${wz}`} material={M.tire} position={[wx, 0.02, wz]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.015, 8]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Yard({ phase }: { phase: number }) {
  const barrels: Array<[number, number, THREE.Material]> = [
    [0.62, 0.22, M.barrelGrey],
    [0.7, 0.26, M.barrelRust],
    [-1.3, 1.2, M.barrelRust],
    [-1.21, 1.27, M.barrelRust],
    [-1.27, 1.11, M.barrelGrey],
  ];
  return (
    <group>
      {/* Pallets with crates by the pipe area */}
      {[
        [0.9, 0.62],
        [1.15, 0.6],
      ].map(([x, z]) => (
        <group key={x} position={[x, 0.1, z]}>
          <Box p={[0, 0.012, 0]} s={[0.18, 0.024, 0.14]} m={M.pallet} cast />
          <Box p={[-0.04, 0.07, 0]} s={[0.08, 0.08, 0.08]} m={M.crate} cast />
          <Box p={[0.05, 0.065, 0.02]} s={[0.07, 0.07, 0.07]} m={M.crateDark} cast />
        </group>
      ))}
      {/* Crates near the furnaces (as in the art) */}
      <Box p={[-1.3, 0.15, 0.32]} s={[0.09, 0.09, 0.09]} m={M.crate} cast />
      <Box p={[-1.3, 0.24, 0.32]} s={[0.07, 0.07, 0.07]} m={M.crateDark} cast />
      <Box p={[-0.15, 0.15, 0.3]} s={[0.08, 0.08, 0.08]} m={M.crateDark} cast />
      {barrels.map(([x, z, m]) => (
        <mesh key={`${x}${z}`} material={m} position={[x, 0.16, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.11, 10]} />
        </mesh>
      ))}
      {/* Little workbench + gas bottles front-left */}
      <Box p={[-0.05, 0.16, 1.25]} s={[0.22, 0.02, 0.1]} m={M.crateDark} cast />
      <Box p={[-0.15, 0.13, 1.25]} s={[0.02, 0.06, 0.08]} m={M.dark} />
      <Box p={[0.05, 0.13, 1.25]} s={[0.02, 0.06, 0.08]} m={M.dark} />
      <Forklift phase={phase} />
      {/* Parked truck on the loading apron */}
      <group position={[0.95, 0.11, 1.1]} rotation={[0, Math.PI / 2, 0]}>
        <Box p={[0.1, 0.08, 0]} s={[0.1, 0.09, 0.12]} m={M.truck} cast />
        <Box p={[0.152, 0.1, 0]} s={[0.004, 0.04, 0.1]} m={M.glass} />
        <Box p={[-0.06, 0.09, 0]} s={[0.2, 0.11, 0.13]} m={M.steel} cast />
        {[-0.1, 0.1].map((wx) =>
          [-0.065, 0.065].map((wz) => (
            <mesh key={`${wx}${wz}`} material={M.tire} position={[wx, 0.022, wz]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.024, 0.024, 0.02, 8]} />
            </mesh>
          )),
        )}
      </group>
    </group>
  );
}

// --- Jib crane -----------------------------------------------------------------------------------------

function JibCrane({ phase }: { phase: number }) {
  const slew = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * 0.3 + phase;
    if (slew.current) slew.current.rotation.y = -0.6 + Math.sin(t) * 0.9;
  });
  return (
    <group position={[1.25, 0.1, 0.25]}>
      <Box p={[0, 0.03, 0]} s={[0.12, 0.06, 0.12]} m={M.dark} cast />
      <Box p={[0, 0.3, 0]} s={[0.035, 0.5, 0.035]} m={M.rustDark} cast />
      <group ref={slew} position={[0, 0.52, 0]}>
        <Box p={[-0.17, 0, 0]} s={[0.36, 0.025, 0.03]} m={M.rustDark} cast />
        <Box p={[0.05, -0.02, 0]} s={[0.06, 0.05, 0.05]} m={M.dark} />
        <Box p={[-0.32, -0.12, 0]} s={[0.005, 0.24, 0.005]} m={M.cable} />
        <Box p={[-0.32, -0.25, 0]} s={[0.03, 0.025, 0.03]} m={M.yellow} />
      </group>
    </group>
  );
}

// --- Safety railings ---------------------------------------------------------------------------------------

function Rail({ from, to }: { from: [number, number]; to: [number, number] }) {
  const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  const posts = Math.max(2, Math.round(len / 0.22) + 1);
  return (
    <group>
      <Box p={[cx, 0.27, cz]} s={alongX ? [len, 0.014, 0.014] : [0.014, 0.014, len]} m={M.yellow} />
      <Box p={[cx, 0.2, cz]} s={alongX ? [len, 0.01, 0.01] : [0.01, 0.01, len]} m={M.yellow} />
      {Array.from({ length: posts }).map((_, i) => {
        const f = i / (posts - 1);
        return (
          <Box
            key={i}
            p={[from[0] + (to[0] - from[0]) * f, 0.2, from[1] + (to[1] - from[1]) * f]}
            s={[0.014, 0.14, 0.014]}
            m={M.yellow}
          />
        );
      })}
    </group>
  );
}

function Railings() {
  return (
    <group>
      <Rail from={[-1.4, 1.4]} to={[0.6, 1.4]} />
      <Rail from={[-1.4, 0.25]} to={[-1.4, 1.4]} />
      <Rail from={[1.4, 0.45]} to={[1.4, 1.0]} />
    </group>
  );
}
