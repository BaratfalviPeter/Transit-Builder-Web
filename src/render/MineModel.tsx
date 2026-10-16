/**
 * MineModel — a deep, stepped open-pit mine on a 3×3-cell lot, after the
 * reference art, in the same style as the other industries (slate-blue steel
 * buildings, rust/grey pipes, yellow rails, concrete deck).
 *
 * Built in CELL UNITS, scaled by `cellSize`. Y=0 is the surrounding ground
 * level. The terrain under the lot is cut out (TerrainSurface renders mine lots
 * as a hole), so this model goes BELOW ground: a solid rock block whose top is
 * a concrete deck at Y=0 and whose middle is a quarry pit stepping down to
 * Y=-DEPTH. The rock block is inset a hair from the lot edge so it never
 * z-fights with the neighbouring terrain walls lining the hole.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - centre/front: the pit — 4 rock terraces in alternating strata colours,
 *     ladders, timber-framed tunnel portals (warm glow), boulders, a cart track
 *     on the pit floor with an ore cart running into the tunnel;
 *   - left: raised rock platform with a yellow luffing lattice crane on a dark
 *     steel tower; its clamshell grab dives into the pit, scoops ore, swings
 *     and dumps it into a hopper on the platform; crates and barrels;
 *   - back: two slate gabled buildings with glowing windows;
 *   - back-right: two tall dark-blue silos with ladders and a top gantry;
 *   - right: a processing house on steel stilts with a chute, grey tanks, a
 *     crusher building with big rust/grey pipes plunging into the pit;
 *   - front: an inclined steel conveyor from the pit floor up to an ore pile,
 *     a cart track with shuttling ore carts, crates, barrels, yellow rails.
 *
 * Performance: shared module materials; 2 pointLights (pit tunnel + work area,
 * no shadows). Animations: crane cycle, conveyor stones, pit + yard carts,
 * dust puffs. `phase` desyncs multiple mines.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Elbow, Pipe, Steam } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface MineModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

// --- Materials -------------------------------------------------------------------

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

const M = {
  deck: std('#d8d2c6', { roughness: 0.95 }),
  curb: std('#ece6da', { roughness: 0.95 }),
  rockA: std('#6e655b', { roughness: 1, flatShading: true }),
  rockB: std('#5c5650', { roughness: 1, flatShading: true }),
  rockC: std('#7d7266', { roughness: 1, flatShading: true }),
  pitFloor: std('#4a4540', { roughness: 1 }),
  boulder: std('#77706a', { roughness: 1, flatShading: true }),
  ore: std('#6b5a4c', { roughness: 1, flatShading: true }),
  hall: std('#3f4655'),
  hallDark: std('#2f3540'),
  roof: std('#5a5c61', { roughness: 0.8, metalness: 0.15 }),
  window: new THREE.MeshBasicMaterial({ color: '#ffd36b', toneMapped: false }),
  tunnel: new THREE.MeshBasicMaterial({ color: '#140d07' }),
  glow: new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false }),
  door: std('#8a3f26'),
  silo: std('#3d4a5e', { roughness: 0.7, metalness: 0.2, flatShading: true }),
  rust: std('#8f4a2f', { roughness: 0.6, metalness: 0.25 }),
  rustDark: std('#6a3420', { roughness: 0.7, metalness: 0.3 }),
  pipeGrey: std('#8f959c', { roughness: 0.5, metalness: 0.35 }),
  valveRed: std('#c23a2b', { roughness: 0.5 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  frame: std('#2f333a', { roughness: 0.6, metalness: 0.4 }),
  tank: std('#9a9ea4', { roughness: 0.55, metalness: 0.35 }),
  belt: std('#26282c'),
  yellow: std('#e8b82e', { roughness: 0.5 }),
  wood: std('#6e4a2a'),
  crate: std('#a8794a'),
  crateDark: std('#7d5634'),
  barrelBlue: std('#3f5a78', { roughness: 0.6 }),
  barrelRust: std('#9a4a2e', { roughness: 0.6 }),
  cable: std('#1d1f23'),
  glass: std('#3d4a55', { roughness: 0.3 }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

const STONE = new THREE.IcosahedronGeometry(1, 0);

// --- Layout --------------------------------------------------------------------------

/** Rock block inset from the lot edge (avoids z-fighting with terrain walls). */
const EDGE = 1.49;
/** Bottom of the rock block (the terrain hole floor is a bit lower). */
const BOTTOM = -1.42;
/** Pit opening in the deck, depth and terraces. */
const PIT = { x0: -0.72, x1: 0.62, z0: -0.72, z1: 0.95 };
const DEPTH = 1.0;
const STEPS = 3;
const STEP_IN = 0.15;
const STEP_H = DEPTH / (STEPS + 1);
const FLOOR = -DEPTH;
/** Raised rock platform on the left (crane). */
const PLAT = { x0: -EDGE, x1: -0.78, z0: -1.42, z1: 0.95, top: 0.32 };

/** Surface height (lot units) at a point — for trestle feet and props. */
function groundY(x: number, z: number): number {
  if (x >= PLAT.x0 && x <= PLAT.x1 && z >= PLAT.z0 && z <= PLAT.z1) return PLAT.top;
  const dx = Math.min(x - PIT.x0, PIT.x1 - x);
  const dz = Math.min(z - PIT.z0, PIT.z1 - z);
  if (dx <= 0 || dz <= 0) return 0;
  const k = Math.floor(Math.min(dx, dz) / STEP_IN);
  return k >= STEPS ? FLOOR : -(k + 1) * STEP_H;
}

const STRATA = [M.rockA, M.rockB, M.rockC, M.rockB];

// --- Helpers ---------------------------------------------------------------------------

function Rod({ from, to, w = 0.015, m }: { from: V3; to: V3; w?: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const d = b.clone().sub(a);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.join(','), to.join(',')]);
  return <mesh geometry={BOX} material={m} position={pos} quaternion={quat} scale={[w, len, w]} castShadow />;
}

function Railing({ from, to, y }: { from: [number, number]; to: [number, number]; y: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const posts = Math.max(2, Math.round(len / 0.22) + 1);
  return (
    <group>
      <Rod from={[from[0], y + 0.12, from[1]]} to={[to[0], y + 0.12, to[1]]} w={0.013} m={M.yellow} />
      <Rod from={[from[0], y + 0.065, from[1]]} to={[to[0], y + 0.065, to[1]]} w={0.009} m={M.yellow} />
      {Array.from({ length: posts }).map((_, i) => {
        const f = i / (posts - 1);
        return (
          <Box
            key={i}
            p={[from[0] + (to[0] - from[0]) * f, y + 0.06, from[1] + (to[1] - from[1]) * f]}
            s={[0.013, 0.12, 0.013]}
            m={M.yellow}
          />
        );
      })}
    </group>
  );
}

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

/** Slate gabled building, ridge along X (gables face ±X). */
function Shed({
  p,
  w,
  d,
  h,
  rise,
  windows = 3,
  door = true,
}: {
  p: V3;
  w: number;
  d: number;
  h: number;
  rise: number;
  windows?: number;
  door?: boolean;
}) {
  const gable = useMemo(() => prismGeom(d, rise, 0.02), [d, rise]);
  const slope = Math.atan2(rise, d / 2);
  const panel = Math.hypot(d / 2, rise) + 0.04;
  const fz = d / 2 + 0.006;
  return (
    <group position={p}>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} m={M.hall} cast />
      <Box p={[0, 0.02, 0]} s={[w + 0.02, 0.04, d + 0.02]} m={M.hallDark} />
      {[-w / 2 + 0.01, w / 2 - 0.01].map((gx) => (
        <mesh key={gx} geometry={gable} material={M.hall} position={[gx, h, 0]} rotation={[0, Math.PI / 2, 0]} castShadow />
      ))}
      {[-1, 1].map((side) => (
        <group key={side} position={[0, h + rise / 2 + 0.01, (side * d) / 4]} rotation={[side * slope, 0, 0]}>
          <Box p={[0, 0, 0]} s={[w + 0.08, 0.022, panel]} m={M.roof} cast />
          {Array.from({ length: Math.round(w / 0.07) }).map((_, i, a) => (
            <Box key={i} p={[-w / 2 + ((i + 0.5) * w) / a.length, 0.013, 0]} s={[0.014, 0.006, panel]} m={M.hallDark} />
          ))}
        </group>
      ))}
      {/* Pilasters + glowing windows on the front (+Z) */}
      {Array.from({ length: windows }).map((_, i) => {
        const px = -w / 2 + ((i + 0.5) * w) / windows;
        return (
          <group key={i}>
            <Box p={[px, h * 0.68, fz + 0.002]} s={[0.055, 0.055, 0.004]} m={M.window} />
            {i > 0 && <Box p={[-w / 2 + (i * w) / windows, h / 2, fz]} s={[0.025, h, 0.012]} m={M.hallDark} />}
          </group>
        );
      })}
      {door && <Box p={[w * 0.28, 0.11, fz + 0.003]} s={[0.1, 0.2, 0.006]} m={M.door} />}
    </group>
  );
}

// --- Model -------------------------------------------------------------------------------

export function MineModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: MineModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <RockBlockAndPit />
      <PitDetails phase={phase} />
      <Platform />
      <Crane phase={phase} />
      {/* Back buildings */}
      <Shed p={[-0.3, 0, -1.15]} w={0.62} d={0.46} h={0.42} rise={0.16} windows={4} />
      <Shed p={[0.32, 0, -1.2]} w={0.46} d={0.42} h={0.58} rise={0.18} windows={3} />
      <Silos />
      <Processing phase={phase} />
      <Crusher />
      <Conveyor
        a={[-0.05, FLOOR + 0.05, 0.42]}
        b={[HOPPER.x + 0.1, PLAT.top + 0.34, HOPPER.z - 0.02]}
        legs={[0.22, 0.45, 0.68, 0.88]}
        stones={10}
        speed={0.12}
        phase={phase}
      />
      <FrontYard phase={phase} />
      <Railings />
      {/* Warm work-area light by the crusher (no shadow) */}
      <pointLight position={[0.65, 0.5, 0.15]} color="#ffaa00" intensity={1.6} distance={3} decay={1.5} />
    </group>
  );
}

// --- Rock block, deck and stepped pit ------------------------------------------------------

function RockBlockAndPit() {
  const parts = useMemo(() => {
    const out: Array<{ p: V3; s: V3; m: THREE.Material; cast?: boolean }> = [];
    const h = -BOTTOM;
    const y = BOTTOM + h / 2;
    // Solid rock around the opening (4 boxes), top flush with Y=0.
    out.push({ p: [0, y, (-EDGE + PIT.z0) / 2], s: [EDGE * 2, h, PIT.z0 + EDGE], m: M.rockB });
    out.push({ p: [0, y, (PIT.z1 + EDGE) / 2], s: [EDGE * 2, h, EDGE - PIT.z1], m: M.rockB });
    out.push({ p: [(-EDGE + PIT.x0) / 2, y, (PIT.z0 + PIT.z1) / 2], s: [PIT.x0 + EDGE, h, PIT.z1 - PIT.z0], m: M.rockB });
    out.push({ p: [(PIT.x1 + EDGE) / 2, y, (PIT.z0 + PIT.z1) / 2], s: [EDGE - PIT.x1, h, PIT.z1 - PIT.z0], m: M.rockB });
    // Terrace rings stepping down (strata colours alternate).
    const cx = (PIT.x0 + PIT.x1) / 2;
    const cz = (PIT.z0 + PIT.z1) / 2;
    const hx = (PIT.x1 - PIT.x0) / 2;
    const hz = (PIT.z1 - PIT.z0) / 2;
    for (let k = 0; k < STEPS; k++) {
      const top = -(k + 1) * STEP_H;
      const rh = top - BOTTOM;
      const ry = BOTTOM + rh / 2;
      const ox = hx - k * STEP_IN;
      const oz = hz - k * STEP_IN;
      const ix = ox - STEP_IN;
      const iz = oz - STEP_IN;
      const m = STRATA[k % STRATA.length];
      out.push({ p: [cx, ry, cz - (oz + iz) / 2], s: [ox * 2, rh, STEP_IN], m, cast: true });
      out.push({ p: [cx, ry, cz + (oz + iz) / 2], s: [ox * 2, rh, STEP_IN], m, cast: true });
      out.push({ p: [cx - (ox + ix) / 2, ry, cz], s: [STEP_IN, rh, iz * 2], m, cast: true });
      out.push({ p: [cx + (ox + ix) / 2, ry, cz], s: [STEP_IN, rh, iz * 2], m, cast: true });
    }
    // Pit floor
    const fx = hx - STEPS * STEP_IN;
    const fz = hz - STEPS * STEP_IN;
    out.push({ p: [cx, (BOTTOM + FLOOR) / 2, cz], s: [fx * 2, FLOOR - BOTTOM, fz * 2], m: M.pitFloor });
    return out;
  }, []);

  return (
    <group>
      {parts.map((b, i) => (
        <Box key={i} p={b.p} s={b.s} m={b.m} cast={b.cast} />
      ))}
      {/* Concrete deck skin on top of the rock (leaves the opening free) */}
      <Box p={[0, 0.012, (-EDGE + PIT.z0) / 2]} s={[EDGE * 2, 0.024, PIT.z0 + EDGE]} m={M.deck} />
      <Box p={[0, 0.012, (PIT.z1 + EDGE) / 2]} s={[EDGE * 2, 0.024, EDGE - PIT.z1]} m={M.deck} />
      <Box p={[(PIT.x1 + EDGE) / 2, 0.012, (PIT.z0 + PIT.z1) / 2]} s={[EDGE - PIT.x1, 0.024, PIT.z1 - PIT.z0]} m={M.deck} />
      <Box p={[(-0.78 + PIT.x0) / 2, 0.012, (PIT.z0 + PIT.z1) / 2]} s={[PIT.x0 + 0.78, 0.024, PIT.z1 - PIT.z0]} m={M.deck} />
      {/* Light curb around the lot */}
      <Box p={[0, 0.05, EDGE - 0.03]} s={[EDGE * 2, 0.06, 0.06]} m={M.curb} cast />
      <Box p={[EDGE - 0.03, 0.05, 0]} s={[0.06, 0.06, EDGE * 2]} m={M.curb} cast />
      <Box p={[0, 0.05, -EDGE + 0.03]} s={[EDGE * 2, 0.06, 0.06]} m={M.curb} cast />
      <Box p={[-EDGE + 0.03, 0.05, (PLAT.z1 + EDGE) / 2]} s={[0.06, 0.06, EDGE - PLAT.z1]} m={M.curb} cast />
    </group>
  );
}

// --- Pit details: ladders, tunnels, boulders, pit cart ----------------------------------------

function Ladder({ p, h, rotY }: { p: V3; h: number; rotY: number }) {
  const rungs = Math.max(3, Math.round(h / 0.04));
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <Box p={[-0.025, h / 2, 0]} s={[0.008, h + 0.02, 0.008]} m={M.wood} />
      <Box p={[0.025, h / 2, 0]} s={[0.008, h + 0.02, 0.008]} m={M.wood} />
      {Array.from({ length: rungs }).map((_, i) => (
        <Box key={i} p={[0, ((i + 0.5) * h) / rungs, 0]} s={[0.05, 0.006, 0.006]} m={M.wood} />
      ))}
    </group>
  );
}

function Portal({ p, rotY }: { p: V3; rotY: number }) {
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <Box p={[0, 0.08, 0.002]} s={[0.12, 0.16, 0.004]} m={M.tunnel} />
      <Box p={[0, 0.045, 0.004]} s={[0.07, 0.05, 0.003]} m={M.glow} />
      <Box p={[-0.07, 0.085, 0.01]} s={[0.022, 0.18, 0.022]} m={M.wood} cast />
      <Box p={[0.07, 0.085, 0.01]} s={[0.022, 0.18, 0.022]} m={M.wood} cast />
      <Box p={[0, 0.18, 0.01]} s={[0.18, 0.025, 0.03]} m={M.wood} cast />
    </group>
  );
}

/** Irregular rubble along the terrace lips + rock slabs jutting from the faces. */
function PitRubble() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { stones, slabs } = useMemo(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const stones: Array<{ p: V3; s: V3; r: V3 }> = [];
    const slabs: Array<{ p: V3; s: V3; ry: number; m: THREE.Material }> = [];
    const cx = (PIT.x0 + PIT.x1) / 2;
    const cz = (PIT.z0 + PIT.z1) / 2;
    const hx = (PIT.x1 - PIT.x0) / 2;
    const hz = (PIT.z1 - PIT.z0) / 2;
    for (let k = 0; k <= STEPS; k++) {
      const top = k < STEPS ? -(k + 1) * STEP_H : FLOOR;
      // Lip of terrace k (inset k*IN .. (k+1)*IN): walk its 4 sides.
      const ox = hx - k * STEP_IN - (k < STEPS ? STEP_IN * 0.5 : 0.15);
      const oz = hz - k * STEP_IN - (k < STEPS ? STEP_IN * 0.5 : 0.15);
      const per = k < STEPS ? 0.13 : 0.2;
      const sides: Array<[number, number, number, number]> = [
        [cx - ox, cz - oz, cx + ox, cz - oz],
        [cx + ox, cz - oz, cx + ox, cz + oz],
        [cx + ox, cz + oz, cx - ox, cz + oz],
        [cx - ox, cz + oz, cx - ox, cz - oz],
      ];
      for (const [ax, az, bx, bz] of sides) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / per));
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.35) continue;
          const f = (i + rnd()) / n;
          const r = 0.018 + rnd() * 0.035;
          stones.push({
            p: [ax + (bx - ax) * f + (rnd() - 0.5) * 0.06, top + r * 0.5, az + (bz - az) * f + (rnd() - 0.5) * 0.06],
            s: [r * (0.8 + rnd() * 0.6), r * (0.6 + rnd() * 0.5), r * (0.8 + rnd() * 0.6)],
            r: [rnd() * 3, rnd() * 3, rnd() * 3],
          });
        }
      }
      // Jutting rock slabs on the wall face just above this terrace.
      if (k < STEPS) {
        const fy = top + STEP_H * (0.3 + rnd() * 0.4);
        const fx = hx - (k + 1) * STEP_IN;
        const fz = hz - (k + 1) * STEP_IN;
        for (let i = 0; i < 5; i++) {
          const t = rnd() * 1.6 - 0.8;
          const m = STRATA[(k + i) % STRATA.length];
          const sz: V3 = [0.12 + rnd() * 0.1, 0.05 + rnd() * 0.05, 0.03];
          const which = i % 4;
          if (which === 0) slabs.push({ p: [cx + t * fx, fy, cz - fz - 0.012], s: sz, ry: (rnd() - 0.5) * 0.3, m });
          if (which === 1) slabs.push({ p: [cx - fx - 0.012, fy, cz + t * fz], s: sz, ry: Math.PI / 2 + (rnd() - 0.5) * 0.3, m });
          if (which === 2) slabs.push({ p: [cx + fx + 0.012, fy, cz + t * fz], s: sz, ry: Math.PI / 2 + (rnd() - 0.5) * 0.3, m });
          if (which === 3) slabs.push({ p: [cx + t * fx, fy, cz + fz + 0.012], s: sz, ry: (rnd() - 0.5) * 0.3, m });
        }
      }
    }
    return { stones, slabs };
  }, []);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const d = new THREE.Object3D();
    stones.forEach((st, i) => {
      d.position.set(...st.p);
      d.rotation.set(...st.r);
      d.scale.set(...st.s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [stones]);

  return (
    <group>
      <instancedMesh ref={ref} args={[STONE, M.boulder, stones.length]} castShadow receiveShadow />
      {slabs.map((sl, i) => (
        <group key={i} position={sl.p} rotation={[0, sl.ry, 0]}>
          <Box p={[0, 0, 0]} s={sl.s} m={sl.m} cast />
        </group>
      ))}
    </group>
  );
}

/** Timber shoring frame (two posts + cap) against a terrace face. */
function Shoring({ p, rotY, h }: { p: V3; rotY: number; h: number }) {
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <Box p={[-0.08, h / 2, 0.012]} s={[0.022, h, 0.022]} m={M.wood} cast />
      <Box p={[0.08, h / 2, 0.012]} s={[0.022, h, 0.022]} m={M.wood} cast />
      <Box p={[0, h - 0.012, 0.016]} s={[0.22, 0.024, 0.03]} m={M.wood} cast />
      <Box p={[0, h * 0.45, 0.016]} s={[0.18, 0.016, 0.02]} m={M.wood} />
    </group>
  );
}

function PitDetails({ phase }: { phase: number }) {
  const cart = useRef<THREE.Group>(null);
  const cx = (PIT.x0 + PIT.x1) / 2;
  const fz0 = PIT.z0 + STEPS * STEP_IN; // back face of the pit floor
  const fz1 = PIT.z1 - STEPS * STEP_IN;
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * 0.25 + phase;
    if (cart.current) {
      // Runs between the front of the floor and into the tunnel (shrinks in).
      const k = (Math.sin(t) + 1) / 2;
      cart.current.position.z = fz0 + 0.04 + k * (fz1 - fz0 - 0.2);
      cart.current.visible = k > 0.02;
    }
  });

  const boulders: Array<[number, number, number]> = [
    [-0.6, 0.6, 0.05],
    [0.5, -0.5, 0.045],
    [0.45, 0.8, 0.04],
    [-0.45, -0.55, 0.05],
    [-0.15, 0.62, 0.035],
    [0.25, 0.55, 0.04],
  ];
  return (
    <group>
      {/* Tunnel portals: pit floor (back wall) + a terrace on the left */}
      <Portal p={[cx - 0.05, FLOOR, fz0]} rotY={0} />
      <Portal p={[PIT.x0 + 2 * STEP_IN, -3 * STEP_H, 0.2]} rotY={Math.PI / 2} />
      <Portal p={[PIT.x1 - 1 * STEP_IN, -2 * STEP_H, -0.25]} rotY={-Math.PI / 2} />
      <PitRubble />
      {/* Timber shoring on the terrace faces */}
      <Shoring p={[PIT.x0 + STEP_IN + 0.004, -2 * STEP_H, -0.45]} rotY={Math.PI / 2} h={STEP_H} />
      <Shoring p={[0.05, -1 * STEP_H, PIT.z0 + 0.004]} rotY={0} h={STEP_H} />
      <Shoring p={[-0.35, -2 * STEP_H, PIT.z0 + STEP_IN + 0.004]} rotY={0} h={STEP_H} />
      <Shoring p={[PIT.x1 - 2 * STEP_IN - 0.004, -3 * STEP_H, 0.3]} rotY={-Math.PI / 2} h={STEP_H} />
      <pointLight position={[cx - 0.05, FLOOR + 0.2, fz0 + 0.2]} color="#ffb347" intensity={1.4} distance={2.2} decay={1.5} />
      {/* Ladders up the terrace faces */}
      {Array.from({ length: STEPS }).map((_, k) => {
        const y = -(k + 2) * STEP_H;
        const zFace = PIT.z1 - (k + 1) * STEP_IN;
        return k % 2 === 0 ? (
          <Ladder key={k} p={[0.3, Math.max(FLOOR, y), zFace - 0.006]} h={STEP_H} rotY={0} />
        ) : (
          <Ladder key={k} p={[PIT.x0 + (k + 1) * STEP_IN + 0.006, Math.max(FLOOR, y), -0.1]} h={STEP_H} rotY={Math.PI / 2} />
        );
      })}
      {boulders.map(([x, z, r]) => (
        <mesh
          key={`${x}${z}`}
          geometry={STONE}
          material={M.boulder}
          position={[x, groundY(x, z) + r * 0.6, z]}
          scale={r}
          rotation={[x * 3, z * 5, 0]}
          castShadow
        />
      ))}
      {/* Ore heap at the conveyor foot */}
      <mesh material={M.ore} position={[0.08, FLOOR + 0.05, 0.4]} castShadow>
        <coneGeometry args={[0.12, 0.1, 6]} />
      </mesh>
      {/* Cart track on the pit floor into the back tunnel */}
      {[-0.035, 0.035].map((dx) => (
        <Box key={dx} p={[cx - 0.05 + dx, FLOOR + 0.006, (fz0 + fz1) / 2]} s={[0.01, 0.01, fz1 - fz0]} m={M.steel} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <Box key={i} p={[cx - 0.05, FLOOR + 0.002, fz0 + 0.05 + i * ((fz1 - fz0 - 0.1) / 5)]} s={[0.11, 0.005, 0.02]} m={M.wood} />
      ))}
      <group ref={cart} position={[cx - 0.05, FLOOR, fz0 + 0.1]}>
        <OreCart />
      </group>
    </group>
  );
}

function OreCart({ rot = 0 }: { rot?: number }) {
  return (
    <group rotation={[0, rot, 0]}>
      <Box p={[0, 0.055, 0]} s={[0.09, 0.07, 0.13]} m={M.steel} cast />
      <Box p={[0, 0.088, 0]} s={[0.095, 0.01, 0.135]} m={M.frame} />
      <mesh material={M.ore} position={[0, 0.1, 0]}>
        <coneGeometry args={[0.055, 0.04, 5]} />
      </mesh>
      {[-0.04, 0.04].map((wz) => (
        <mesh key={wz} material={M.frame} position={[0, 0.018, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.018, 0.018, 0.1, 8]} />
        </mesh>
      ))}
    </group>
  );
}

// --- Platform (left) ------------------------------------------------------------------------------

function Platform() {
  const w = PLAT.x1 - PLAT.x0;
  const d = PLAT.z1 - PLAT.z0;
  const cx = (PLAT.x0 + PLAT.x1) / 2;
  const cz = (PLAT.z0 + PLAT.z1) / 2;
  return (
    <group>
      {/* Two rock strata + concrete top */}
      <Box p={[cx, 0.08, cz]} s={[w, 0.16, d]} m={M.rockC} cast />
      <Box p={[cx - 0.01, 0.23, cz - 0.01]} s={[w - 0.02, 0.14, d - 0.02]} m={M.rockA} cast />
      <Box p={[cx, PLAT.top + 0.01, cz]} s={[w, 0.02, d]} m={M.deck} />
      {/* Crates + barrels on the platform */}
      <Box p={[-1.35, PLAT.top + 0.06, -1.15]} s={[0.1, 0.1, 0.1]} m={M.crate} cast />
      <Box p={[-1.35, PLAT.top + 0.15, -1.15]} s={[0.08, 0.08, 0.08]} m={M.crateDark} cast />
      <Box p={[-1.24, PLAT.top + 0.05, -1.1]} s={[0.08, 0.08, 0.08]} m={M.crate} cast />
      {[
        [-1.38, -0.9, M.barrelBlue],
        [-1.3, -0.94, M.barrelBlue],
        [-1.36, -1.0, M.barrelRust],
        [-1.0, -1.25, M.barrelRust],
        [-0.92, -1.28, M.barrelBlue],
      ].map(([x, z, m]) => (
        <mesh key={`${x}${z}`} material={m as THREE.Material} position={[x as number, PLAT.top + 0.06, z as number]} castShadow>
          <cylinderGeometry args={[0.032, 0.032, 0.1, 10]} />
        </mesh>
      ))}
      {/* Tunnel portal in the platform's front cliff + rails out onto the deck */}
      <Portal p={[-1.28, 0, PLAT.z1]} rotY={0} />
      {[-0.035, 0.035].map((dx) => (
        <Box key={dx} p={[-1.28 + dx, 0.032, PLAT.z1 + 0.15]} s={[0.01, 0.012, 0.3]} m={M.steel} />
      ))}
      {[0.06, 0.15, 0.24].map((dz) => (
        <Box key={dz} p={[-1.28, 0.027, PLAT.z1 + dz]} s={[0.11, 0.006, 0.02]} m={M.wood} />
      ))}
      {/* Dump hopper the crane fills */}
      <group position={[HOPPER.x, PLAT.top, HOPPER.z]}>
        {[
          [-0.07, -0.07],
          [0.07, -0.07],
          [0.07, 0.07],
          [-0.07, 0.07],
        ].map(([lx, lz]) => (
          <Box key={`${lx}${lz}`} p={[lx, 0.08, lz]} s={[0.02, 0.16, 0.02]} m={M.frame} />
        ))}
        <mesh material={M.rust} position={[0, 0.22, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.06, 0.14, 4]} />
        </mesh>
        <mesh material={M.ore} position={[0, 0.28, 0]}>
          <coneGeometry args={[0.08, 0.04, 5]} />
        </mesh>
      </group>
    </group>
  );
}

// --- Crane (left platform) ----------------------------------------------------------------------------

/**
 * A big crawler-style lattice-boom crane on a dark trestle: the boom is held at
 * a FIXED angle (like the art), so the grab always hangs at the same radius —
 * the pick point over the pit floor and the hopper on the platform are both on
 * that circle. The crane slews between them; only the hoist and grab move.
 */
const CRANE = { x: -1.12, z: -0.55, h: 0.44 };
/** Boom: pivot offset (slew space), length, fixed lift angle. */
const BOOM = { px: 0.14, len: 1.45, lift: 0.62 };
const REACH = BOOM.px + BOOM.len * Math.cos(BOOM.lift);
const PICK_ANG = Math.atan2(-(-0.12 - CRANE.z), 0.05 - CRANE.x);
/** Hopper on the platform at the same radius from the tower. */
const HOPPER = { x: CRANE.x + 0.15, z: CRANE.z + Math.sqrt(REACH * REACH - 0.15 * 0.15) };
const DROP_ANG = Math.atan2(-(HOPPER.z - CRANE.z), HOPPER.x - CRANE.x);
const CRANE_CYCLE = 15;

function Crane({ phase }: { phase: number }) {
  const slew = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  const grab = useRef<THREE.Group>(null);
  const shells = useRef<Array<THREE.Group | null>>([]);
  const load = useRef<THREE.Group>(null);

  const deckY = PLAT.top + CRANE.h; // top of the trestle
  const pivotY = deckY + 0.16;
  const tipX = REACH;
  const tipY = pivotY + BOOM.len * Math.sin(BOOM.lift);
  const pickY = FLOOR + 0.02; // grab bottom on the pit floor
  const dropY = PLAT.top + 0.36; // grab bottom just above the hopper
  const high = tipY - 0.38;
  const ease = (k: number) => k * k * (3 - 2 * k);

  useFrame((state) => {
    const u = ((state.clock.getElapsedTime() + phase * 3.1) % CRANE_CYCLE) / CRANE_CYCLE;
    let ang = PICK_ANG;
    let bottom = high;
    let closed = false;
    let holding = false;
    if (u < 0.2) {
      bottom = high + (pickY - high) * ease(u / 0.2); // lower into the pit
    } else if (u < 0.3) {
      const k = (u - 0.2) / 0.1;
      closed = k > 0.3;
      holding = closed;
      bottom = pickY + (high - pickY) * ease(Math.max(0, k * 1.6 - 0.6)); // bite + lift
    } else if (u < 0.5) {
      ang = PICK_ANG + (DROP_ANG - PICK_ANG) * ease((u - 0.3) / 0.2); // swing
      closed = holding = true;
    } else if (u < 0.58) {
      ang = DROP_ANG;
      bottom = high + (dropY - high) * ease((u - 0.5) / 0.08);
      closed = holding = true;
    } else if (u < 0.68) {
      ang = DROP_ANG;
      bottom = dropY + (high - dropY) * ease(Math.max(0, ((u - 0.58) / 0.1) * 1.6 - 0.6)); // dump
    } else {
      ang = DROP_ANG + (PICK_ANG - DROP_ANG) * ease((u - 0.68) / 0.32); // swing back
    }
    if (slew.current) slew.current.rotation.y = ang;
    if (grab.current) grab.current.position.set(tipX, bottom, 0);
    if (cable.current) {
      const len = tipY - 0.03 - (bottom + 0.15);
      cable.current.position.set(tipX, tipY - 0.03 - len / 2, 0);
      cable.current.scale.y = Math.max(0.001, len);
    }
    const open = closed ? 0.04 : 0.65;
    shells.current.forEach((sh, i) => {
      if (sh) sh.rotation.x = (i ? 1 : -1) * open;
    });
    if (load.current) load.current.visible = holding;
  });

  // Trestle: 4 splayed legs, X-bracing on every face, top deck.
  const B = 0.2; // half-width at the foot
  const T = 0.13; // half-width at the top
  const legs: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (sx: number, sz: number, f: number): V3 => {
    const w = B + (T - B) * f;
    return [sx * w, PLAT.top + CRANE.h * f, sz * w];
  };
  const boomPts = 9;
  return (
    <group position={[CRANE.x, 0, CRANE.z]}>
      <Box p={[0, PLAT.top + 0.02, 0]} s={[B * 2 + 0.1, 0.04, B * 2 + 0.1]} m={M.frame} />
      {legs.map(([sx, sz]) => (
        <Rod key={`l${sx}${sz}`} from={at(sx, sz, 0)} to={at(sx, sz, 1)} w={0.04} m={M.frame} />
      ))}
      {[0, 0.5].map((f0) =>
        [
          [-1, -1, 1, -1],
          [1, -1, 1, 1],
          [1, 1, -1, 1],
          [-1, 1, -1, -1],
        ].map(([ax, az, bx, bz]) => (
          <group key={`${f0}${ax}${az}${bx}${bz}`}>
            <Rod from={at(ax, az, f0)} to={at(bx, bz, f0 + 0.5)} w={0.016} m={M.frame} />
            <Rod from={at(bx, bz, f0)} to={at(ax, az, f0 + 0.5)} w={0.016} m={M.frame} />
            <Rod from={at(ax, az, f0 + 0.5)} to={at(bx, bz, f0 + 0.5)} w={0.02} m={M.frame} />
          </group>
        )),
      )}
      <Box p={[0, deckY + 0.015, 0]} s={[T * 2 + 0.08, 0.03, T * 2 + 0.08]} m={M.frame} cast />

      {/* Slewing superstructure */}
      <group ref={slew}>
        <mesh material={M.frame} position={[0, deckY + 0.045, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.03, 14]} />
        </mesh>
        {/* Yellow machinery house + cab, black counterweight at the back */}
        <Box p={[-0.04, deckY + 0.17, 0]} s={[0.4, 0.22, 0.26]} m={M.yellow} cast />
        <Box p={[-0.04, deckY + 0.285, 0]} s={[0.42, 0.015, 0.28]} m={M.frame} />
        <Box p={[0.14, deckY + 0.2, 0.135]} s={[0.1, 0.09, 0.004]} m={M.glass} />
        <Box p={[0.162, deckY + 0.2, 0.06]} s={[0.004, 0.09, 0.12]} m={M.glass} />
        <Box p={[-0.18, deckY + 0.2, 0.131]} s={[0.12, 0.012, 0.004]} m={M.frame} />
        <Box p={[-0.32, deckY + 0.15, 0]} s={[0.16, 0.2, 0.24]} m={M.frame} cast />
        {/* A-frame gantry with pendant cables to the boom tip */}
        {[-0.1, 0.1].map((z) => (
          <Rod key={z} from={[-0.2, deckY + 0.29, z]} to={[-0.12, deckY + 0.62, 0]} w={0.025} m={M.frame} />
        ))}
        <Rod from={[0.02, deckY + 0.29, 0]} to={[-0.12, deckY + 0.62, 0]} w={0.02} m={M.frame} />
        <Rod from={[-0.12, deckY + 0.62, 0.02]} to={[tipX, tipY + 0.05, 0.02]} w={0.006} m={M.cable} />
        <Rod from={[-0.12, deckY + 0.62, -0.02]} to={[tipX, tipY + 0.05, -0.02]} w={0.006} m={M.cable} />
        <Rod from={[-0.12, deckY + 0.62, 0]} to={[-0.32, deckY + 0.25, 0]} w={0.006} m={M.cable} />
        {/* Yellow lattice boom at a fixed angle */}
        <group position={[BOOM.px, pivotY, 0]} rotation={[0, 0, BOOM.lift]}>
          {[
            [0, -0.05],
            [0, 0.05],
            [0.08, -0.05],
            [0.08, 0.05],
          ].map(([y, z]) => (
            <Box key={`${y}${z}`} p={[BOOM.len / 2, y, z]} s={[BOOM.len, 0.02, 0.02]} m={M.yellow} cast />
          ))}
          {Array.from({ length: boomPts }).map((_, i) => {
            const x0 = (i * BOOM.len) / boomPts;
            const x1 = ((i + 1) * BOOM.len) / boomPts;
            return (
              <group key={i}>
                <Rod from={[x0, 0, -0.05]} to={[x1, 0.08, -0.05]} w={0.009} m={M.yellow} />
                <Rod from={[x0, 0, 0.05]} to={[x1, 0.08, 0.05]} w={0.009} m={M.yellow} />
                <Rod from={[x0, 0, -0.05]} to={[x1, 0, 0.05]} w={0.008} m={M.yellow} />
                <Rod from={[x0, 0.08, 0.05]} to={[x1, 0.08, -0.05]} w={0.008} m={M.yellow} />
                <Box p={[x1, 0.04, 0]} s={[0.012, 0.09, 0.11]} m={M.yellow} />
              </group>
            );
          })}
          {/* Boom head sheaves */}
          <mesh material={M.frame} position={[BOOM.len, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.12, 12]} />
          </mesh>
        </group>
        {/* Hoist cable + clamshell grab */}
        <mesh ref={cable} geometry={BOX} material={M.cable} scale={[0.008, 0.5, 0.008]} />
        <group ref={grab}>
          <Box p={[0, 0.13, 0]} s={[0.05, 0.04, 0.04]} m={M.frame} />
          {[-1, 1].map((sd) => (
            <Rod key={sd} from={[0, 0.12, 0]} to={[sd * 0.045, 0.07, 0]} w={0.01} m={M.frame} />
          ))}
          {[0, 1].map((i) => (
            <group
              key={i}
              position={[0, 0.09, 0]}
              ref={(el) => {
                shells.current[i] = el;
              }}
            >
              <Box p={[0, -0.045, (i ? 1 : -1) * 0.032]} s={[0.12, 0.07, 0.06]} m={M.frame} />
              <Box p={[0, -0.085, (i ? 1 : -1) * 0.052]} s={[0.12, 0.012, 0.02]} m={M.steel} />
            </group>
          ))}
          <group ref={load}>
            {[
              [0, 0.1, 0, 0.04],
              [0.03, 0.115, 0.02, 0.028],
              [-0.03, 0.11, -0.02, 0.03],
            ].map(([x, y, z, r], i) => (
              <mesh key={i} geometry={STONE} material={M.boulder} position={[x, y, z]} scale={r} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

// --- Silos (back-right) ------------------------------------------------------------------------------

const SILOS: Array<[number, number]> = [
  [1.0, -1.15],
  [1.2, -0.62],
];
const SILO_R = 0.235;
const SILO_H = 1.2;
const SILO_BASE = 0.3;

function Silos() {
  const top = SILO_BASE + SILO_H + 0.1;
  return (
    <group>
      {SILOS.map(([x, z]) => (
        <group key={z} position={[x, 0, z]}>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            return (
              <Box
                key={i}
                p={[Math.cos(a) * SILO_R * 0.8, SILO_BASE / 2, Math.sin(a) * SILO_R * 0.8]}
                s={[0.025, SILO_BASE, 0.025]}
                m={M.frame}
              />
            );
          })}
          <mesh material={M.silo} position={[0, SILO_BASE - 0.02, 0]} rotation={[Math.PI, 0, 0]} castShadow>
            <coneGeometry args={[SILO_R, 0.16, 8]} />
          </mesh>
          <mesh material={M.silo} position={[0, SILO_BASE + SILO_H / 2 + 0.05, 0]} castShadow>
            <cylinderGeometry args={[SILO_R, SILO_R, SILO_H, 8]} />
          </mesh>
          {[0.3, 0.6, 0.9].map((f) => (
            <mesh key={f} material={M.rustDark} position={[0, SILO_BASE + 0.05 + SILO_H * f, 0]}>
              <cylinderGeometry args={[SILO_R + 0.006, SILO_R + 0.006, 0.02, 8]} />
            </mesh>
          ))}
          <mesh material={M.silo} position={[0, SILO_BASE + SILO_H + 0.1, 0]} castShadow>
            <coneGeometry args={[SILO_R, 0.12, 8]} />
          </mesh>
          {/* Ladder up the side */}
          <Ladder p={[SILO_R + 0.012, SILO_BASE, 0]} h={SILO_H + 0.05} rotY={Math.PI / 2} />
        </group>
      ))}
      {/* Top gantry: walkway + railings between the silo roofs */}
      <Rod from={[SILOS[0][0], top, SILOS[0][1]]} to={[SILOS[1][0], top, SILOS[1][1]]} w={0.06} m={M.frame} />
      {[-0.035, 0.035].map((o) => (
        <Rod
          key={o}
          from={[SILOS[0][0] + o, top + 0.09, SILOS[0][1]]}
          to={[SILOS[1][0] + o, top + 0.09, SILOS[1][1]]}
          w={0.008}
          m={M.frame}
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <Box
          key={f}
          p={[SILOS[0][0] + (SILOS[1][0] - SILOS[0][0]) * f, top + 0.045, SILOS[0][1] + (SILOS[1][1] - SILOS[0][1]) * f]}
          s={[0.008, 0.09, 0.008]}
          m={M.frame}
        />
      ))}
      {/* Covered conveyor gallery from the silo top down to the processing house */}
      <Rod from={[SILOS[1][0], top - 0.02, SILOS[1][1]]} to={[0.95, 0.92, -0.12]} w={0.07} m={M.hallDark} />
      <Rod from={[SILOS[1][0], top + 0.03, SILOS[1][1]]} to={[0.95, 0.97, -0.12]} w={0.05} m={M.roof} />
      {/* Gantry tower between the silos */}
      {[
        [0.86, -0.86],
        [0.86, -0.92],
      ].map(([x, z]) => (
        <Box key={z} p={[x, top / 2, z]} s={[0.025, top, 0.025]} m={M.frame} />
      ))}
      <Rod from={[0.86, 0, -0.86]} to={[0.86, top, -0.92]} w={0.012} m={M.frame} />
    </group>
  );
}

// --- Processing house on stilts + grey tanks --------------------------------------------------------

function Processing({ phase }: { phase: number }) {
  const P = { x: 0.95, z: -0.12, w: 0.42, d: 0.38, y0: 0.38, h: 0.38 };
  return (
    <group>
      {/* Stilts + bracing */}
      {[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sz]) => (
        <Box
          key={`${sx}${sz}`}
          p={[P.x + sx * (P.w / 2 - 0.03), P.y0 / 2, P.z + sz * (P.d / 2 - 0.03)]}
          s={[0.03, P.y0, 0.03]}
          m={M.frame}
        />
      ))}
      <Rod from={[P.x - P.w / 2 + 0.03, 0, P.z + P.d / 2 - 0.03]} to={[P.x + P.w / 2 - 0.03, P.y0, P.z + P.d / 2 - 0.03]} w={0.012} m={M.frame} />
      <Shed p={[P.x, P.y0, P.z]} w={P.w} d={P.d} h={P.h} rise={0.12} windows={3} door={false} />
      {/* Chute down to the cart track */}
      <mesh material={M.rust} position={[P.x - 0.08, P.y0 - 0.06, P.z + 0.12]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.03, 0.12, 4]} />
      </mesh>
      <Steam origin={[P.x - 0.08, 0.2, P.z + 0.12]} count={3} rise={0.35} spread={0.1} size={0.05} color="#9c9184" phase={phase} />
      {/* Big rust pipe from the house dropping to the deck */}
      <Pipe from={[P.x + 0.15, 0.04, P.z + 0.25]} to={[P.x + 0.15, P.y0 + 0.15, P.z + 0.25]} r={0.03} m={M.rust} />
      {/* Grey tanks */}
      {[
        [1.3, 0.3],
        [1.3, 0.05],
      ].map(([x, z]) => (
        <group key={z} position={[x, 0, z]}>
          <mesh material={M.tank} position={[0, 0.12, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 0.22, 14]} />
          </mesh>
          <mesh material={M.tank} position={[0, 0.34, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.2, 14]} />
          </mesh>
          {[0.23, 0.45].map((y) => (
            <mesh key={y} material={M.frame} position={[0, y, 0]}>
              <cylinderGeometry args={[0.112, 0.112, 0.015, 14]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// --- Crusher building with pipes into the pit ----------------------------------------------------------

function Crusher() {
  const R = 0.08;
  const xEdge = PIT.x1 - 0.02;
  return (
    <group>
      <Shed p={[0.98, 0, 0.72]} w={0.5} d={0.42} h={0.42} rise={0.14} windows={3} />
      {/* Rust main: out of the crusher wall, over the pit rim, plunging down */}
      <Pipe from={[0.73, 0.24, 0.62]} to={[xEdge, 0.24, 0.62]} r={0.06} m={M.rust} />
      <Elbow p={[xEdge, 0.24 - R, 0.62]} rot={[0, 0, Math.PI / 2]} R={R} r={0.06} m={M.rust} />
      <Pipe from={[xEdge - R, 0.24 - R, 0.62]} to={[xEdge - R, -STEP_H + 0.01, 0.62]} r={0.06} m={M.rust} />
      {/* Grey main alongside */}
      <Pipe from={[0.73, 0.14, 0.8]} to={[xEdge, 0.14, 0.8]} r={0.05} m={M.pipeGrey} />
      <Elbow p={[xEdge, 0.14 - R, 0.8]} rot={[0, 0, Math.PI / 2]} R={R} r={0.05} m={M.pipeGrey} />
      <Pipe from={[xEdge - R, 0.14 - R, 0.8]} to={[xEdge - R, -STEP_H + 0.01, 0.8]} r={0.05} m={M.pipeGrey} />
      {/* Valve wheel + flange */}
      <mesh material={M.valveRed} position={[0.68, 0.31, 0.62]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.04, 0.009, 6, 12]} />
      </mesh>
      <mesh material={M.frame} position={[0.7, 0.24, 0.62]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.03, 12]} />
      </mesh>
    </group>
  );
}

// --- Inclined conveyor (pit floor → front-left ore pile) ---------------------------------------------

function Conveyor({
  a,
  b,
  legs,
  stones,
  speed,
  phase,
}: {
  a: V3;
  b: V3;
  legs: number[];
  stones: number;
  speed: number;
  phase: number;
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const g = useMemo(() => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    return {
      len: Math.hypot(dx, dy, dz),
      yaw: Math.atan2(-dz, dx),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let i = 0; i < stones; i++) {
      const m = refs.current[i];
      if (!m) continue;
      m.position.x = -g.len / 2 + ((t * speed + i / stones) % 1) * g.len;
    }
  });
  return (
    <group>
      <group position={g.mid} rotation={[0, g.yaw, 0]}>
        <group rotation={[0, 0, g.pitch]}>
          <Box p={[0, 0, 0]} s={[g.len, 0.02, 0.11]} m={M.belt} cast />
          <Box p={[0, 0.008, 0.064]} s={[g.len, 0.05, 0.016]} m={M.frame} />
          <Box p={[0, 0.008, -0.064]} s={[g.len, 0.05, 0.016]} m={M.frame} />
          {Array.from({ length: Math.floor(g.len / 0.09) }).map((_, i, arr) => (
            <Box key={i} p={[-g.len / 2 + (i + 0.5) * (g.len / arr.length), 0.036, 0.064]} s={[0.018, 0.012, 0.02]} m={M.steel} />
          ))}
          {Array.from({ length: stones }).map((_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              geometry={STONE}
              material={i % 3 ? M.boulder : M.ore}
              position={[0, 0.03, ((i * 5) % 3 - 1) * 0.025]}
              rotation={[i, i * 2, 0]}
              scale={0.02 + (i % 3) * 0.006}
            />
          ))}
        </group>
      </group>
      {legs.map((f) => {
        const x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f - 0.03;
        const z = a[2] + (b[2] - a[2]) * f;
        const base = groundY(x, z);
        if (base >= y - 0.02) return null;
        const px = -(b[2] - a[2]);
        const pz = b[0] - a[0];
        const pl = Math.hypot(px, pz) || 1;
        const ox = (px / pl) * 0.07;
        const oz = (pz / pl) * 0.07;
        return (
          <group key={f}>
            <Rod from={[x - ox, base, z - oz]} to={[x - ox * 0.8, y, z - oz * 0.8]} w={0.02} m={M.frame} />
            <Rod from={[x + ox, base, z + oz]} to={[x + ox * 0.8, y, z + oz * 0.8]} w={0.02} m={M.frame} />
            <Rod from={[x - ox, (base + y) / 2, z - oz]} to={[x + ox, (base + y) / 2, z + oz]} w={0.01} m={M.frame} />
          </group>
        );
      })}
    </group>
  );
}

// --- Front yard: ore pile, cart track, crates, barrels ---------------------------------------------

function FrontYard({ phase }: { phase: number }) {
  const carts = useRef<THREE.Group>(null);
  const TZ = 1.22;
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * 0.3 + phase;
    if (carts.current) carts.current.position.x = 0.75 + Math.sin(t) * 0.45;
  });
  return (
    <group>
      {/* Crates + barrels on the front-left deck */}
      <Box p={[-0.95, 0.035, 1.24]} s={[0.2, 0.02, 0.16]} m={M.wood} cast />
      <Box p={[-1.0, 0.09, 1.24]} s={[0.09, 0.09, 0.09]} m={M.crate} cast />
      <Box p={[-0.9, 0.085, 1.26]} s={[0.08, 0.08, 0.08]} m={M.crateDark} cast />
      <Box p={[-0.95, 0.175, 1.24]} s={[0.08, 0.08, 0.08]} m={M.crate} cast />
      {/* Cart track along the front-right */}
      {[-0.04, 0.04].map((dz) => (
        <Box key={dz} p={[0.75, 0.032, TZ + dz]} s={[1.3, 0.012, 0.01]} m={M.steel} />
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <Box key={i} p={[0.15 + i * 0.13, 0.027, TZ]} s={[0.025, 0.006, 0.12]} m={M.wood} />
      ))}
      <group ref={carts} position={[0.75, 0.025, TZ]}>
        <group position={[-0.08, 0, 0]}>
          <OreCart rot={Math.PI / 2} />
        </group>
        <group position={[0.08, 0, 0]}>
          <OreCart rot={Math.PI / 2} />
        </group>
      </group>
      {/* Crates on pallets + barrels at the front */}
      <Box p={[-0.45, 0.035, 1.2]} s={[0.18, 0.02, 0.14]} m={M.wood} cast />
      <Box p={[-0.49, 0.09, 1.2]} s={[0.08, 0.08, 0.08]} m={M.crate} cast />
      <Box p={[-0.4, 0.085, 1.22]} s={[0.07, 0.07, 0.07]} m={M.crateDark} cast />
      <Box p={[-0.45, 0.165, 1.2]} s={[0.07, 0.07, 0.07]} m={M.crate} cast />
      {[
        [-0.18, 1.25, M.barrelRust],
        [-0.1, 1.22, M.barrelBlue],
        [-0.14, 1.32, M.barrelBlue],
      ].map(([x, z, m]) => (
        <mesh key={`${x}${z}`} material={m as THREE.Material} position={[x as number, 0.08, z as number]} castShadow>
          <cylinderGeometry args={[0.032, 0.032, 0.1, 10]} />
        </mesh>
      ))}
      {/* Small yellow box (generator) by the crusher */}
      <Box p={[0.66, 0.05, 1.0]} s={[0.07, 0.06, 0.05]} m={M.yellow} cast />
    </group>
  );
}

// --- Railings -----------------------------------------------------------------------------------------

function Railings() {
  const e = 0.04;
  return (
    <group>
      {/* Pit rim (front side has a gap where the conveyor leaves) */}
      <Railing from={[PIT.x0 - e + 0.1, PIT.z0 - e]} to={[PIT.x1 + e, PIT.z0 - e]} y={0} />
      <Railing from={[PIT.x1 + e, PIT.z0 - e]} to={[PIT.x1 + e, 0.5]} y={0} />
      <Railing from={[-0.3, PIT.z1 + e]} to={[PIT.x1 + e, PIT.z1 + e]} y={0} />
      <Railing from={[PIT.x0 - e, PIT.z0 + 0.15]} to={[PIT.x0 - e, 0.4]} y={0} />
      {/* Platform edge facing the pit */}
      <Railing from={[PLAT.x1, -1.35]} to={[PLAT.x1, -0.45]} y={PLAT.top} />
      {/* Lot front edge */}
      <Railing from={[-0.85, 1.42]} to={[0.05, 1.42]} y={0} />
    </group>
  );
}
