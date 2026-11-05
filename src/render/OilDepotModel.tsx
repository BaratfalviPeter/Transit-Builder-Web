/**
 * OilDepotModel — a low-poly coastal oil terminal / oil depot on a 3×3-cell
 * lot, after the reference art (`ref/oil-depot.jpg`).
 *
 * Built in CELL UNITS: the base slab is exactly [3, 0.1, 3] centered on the
 * origin, resting on Y=0; the caller scales the group by `cellSize`.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - left edge: a rail loading track along Z (ballast, sleepers, rails), a
 *     narrow platform on the lot side and a raised steel lattice loading gantry
 *     with three hanging filling arms (the tank wagons are drawn by the game);
 *   - center / back: tank farm inside a low concrete bund wall: four dark slate
 *     steel tanks with rust bands, yellow ladders, roof railings and catwalk
 *     bridges; the incoming pipeline enters at the back edge between them;
 *   - back right: pump house (gabled hall + taller back block with a roof fan
 *     and a brick chimney with smoke), pipes with red valves to the rail gantry
 *     and over to the truck canopy;
 *   - right edge: one-way drive-through truck loading lane: entry barrier at
 *     the back (−Z), two parallel bays under a flat steel canopy (yellow
 *     beacons, pipes on the roof), a hazard-striped island with yellow loading
 *     arms, exit barrier at the front (+Z), white arrows pointing +Z;
 *   - front center: small two-storey office with lit windows, two
 *     transformers, crates, pallets, barrels, jersey barriers, a wire fence.
 *
 * Performance: sleepers, lattice rods, ladder rungs, hazard stripes, arrows and
 * fence posts are InstancedMeshes (one per material); shared module materials;
 * no lights (glow is MeshBasicMaterial). Animations (useFrame): rail filling
 * arms sway, truck arms swing, canopy beacons blink, barriers open and close,
 * roof fan spins, chimney smoke. `phase` desyncs multiple depots.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Pipe, Steam } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface OilDepotModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

// --- Shared materials --------------------------------------------------------

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

const M = {
  slab: std('#d8d2c6', { roughness: 0.95 }),
  joint: std('#bfb7a8', { roughness: 1 }),
  curb: std('#ece6da'),
  asphalt: std('#66635f', { roughness: 1 }),
  marking: std('#e8e2c8'),
  ballast: std('#6b6256', { roughness: 1, flatShading: true }),
  sleeper: std('#5a3f27'),
  rail: std('#a3a9b0', { roughness: 0.5, metalness: 0.3 }),
  tank: std('#626b7c', { roughness: 0.85, metalness: 0.1 }),
  tankRoof: std('#535b6b', { roughness: 0.85, metalness: 0.1 }),
  rust: std('#8f4a2f', { roughness: 0.95 }),
  rustDark: std('#6a3420', { roughness: 0.95 }),
  wall: std('#4a5262'),
  wallDark: std('#2f3540'),
  wallBack: std('#3f4655'),
  roof: std('#5a5c61', { roughness: 0.6, metalness: 0.3 }),
  roofRib: std('#6b5244'),
  canopy: std('#5a5c61', { roughness: 0.85 }),
  frame: std('#2f333a', { roughness: 0.6, metalness: 0.4 }),
  girder: std('#7d828b', { roughness: 0.65, metalness: 0.3 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  pipe: std('#8f959c', { roughness: 0.5, metalness: 0.35 }),
  dark: std('#2a2c31', { roughness: 0.7 }),
  rubber: std('#1f2125', { roughness: 0.9 }),
  yellow: std('#e8b82e', { roughness: 0.5 }),
  red: std('#c23a2b', { roughness: 0.5 }),
  blue: std('#4f7fae', { roughness: 0.6 }),
  door: std('#8a3f26'),
  brick: std('#8f4a36'),
  office: std('#bdb6aa'),
  glass: std('#3d4a55', { roughness: 0.35 }),
  crate: std('#a8794a'),
  crateDark: std('#7d5634'),
  pallet: std('#b48a5a'),
  barrel: std('#3f5a78', { roughness: 0.6 }),
  fence: std('#7d828b', { roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.45 }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/** Lit windows / beacons: unlit, so they read as glowing. */
const GLOW = {
  window: new THREE.MeshBasicMaterial({ color: '#ffd36b', toneMapped: false }),
  beacon: new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false }),
};

/** Top of the base slab. */
const Y0 = 0.1;

// --- Instancing helper ----------------------------------------------------------

/** One instance of the unit box: position, size, optional rotation. */
interface Inst {
  p: V3;
  s: V3;
  q?: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A square rod (w × w) from a to b, as an instance of the unit box. */
function rod(a: V3, b: V3, w = 0.016): Inst {
  const va = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(va);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  const mid = va.add(d.multiplyScalar(0.5));
  return { p: [mid.x, mid.y, mid.z], s: [w, len, w], q };
}

/** A box instance rotated by Euler angles. */
function rbox(p: V3, s: V3, r: V3): Inst {
  return { p, s, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)) };
}

/** Many unit boxes with one material in one draw call. */
function Batch({ items, m, cast = true }: { items: Inst[]; m: THREE.Material; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const mat = new THREE.Matrix4();
    const one = new THREE.Quaternion();
    items.forEach((it, i) => {
      mat.compose(new THREE.Vector3(...it.p), it.q ?? one, new THREE.Vector3(...it.s));
      im.setMatrixAt(i, mat);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[BOX, m, items.length]} castShadow={cast} receiveShadow />;
}

/** A Y-up cylinder. */
function Cyl({
  p,
  r,
  h,
  m,
  seg = 10,
  rTop,
  open = false,
}: {
  p: V3;
  r: number;
  h: number;
  m: THREE.Material;
  seg?: number;
  rTop?: number;
  /** No caps (bands around a bigger cylinder). */
  open?: boolean;
}) {
  return (
    <mesh material={m} position={p} castShadow receiveShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, seg, 1, open]} />
    </mesh>
  );
}

/** A red hand-wheel valve on a pipe running along `axis`. */
function Valve({ p, axis = 'x' }: { p: V3; axis?: 'x' | 'z' }) {
  return (
    <group position={p}>
      <Box p={[0, 0, 0]} s={[0.05, 0.05, 0.05]} m={M.steel} />
      <Box p={[0, 0.05, 0]} s={[0.012, 0.06, 0.012]} m={M.steel} />
      <mesh material={M.red} position={[0, 0.085, 0]} rotation={axis === 'x' ? [0, 0, 0] : [0, Math.PI / 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.008, 6]} />
      </mesh>
    </group>
  );
}

/** Flange collar on a pipe along `axis`. */
function Collar({ p, r, axis }: { p: V3; r: number; axis: 'x' | 'y' | 'z' }) {
  const rot: V3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return (
    <mesh material={M.frame} position={p} rotation={rot} castShadow>
      <cylinderGeometry args={[r, r, 0.02, 8]} />
    </mesh>
  );
}

// --- Model ------------------------------------------------------------------------

export function OilDepotModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: OilDepotModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Ground />
      <RailSiding />
      <LoadingGantry phase={phase} />
      <TankFarm />
      <PumpHouse phase={phase} />
      <Piping />
      <TruckLane phase={phase} />
      <Office />
      <Yard />
      <SharedBatches />
    </group>
  );
}

// --- Ground ----------------------------------------------------------------------

function Ground() {
  const joints = [-1, -0.5, 0, 0.5, 1];
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.slab} />
      {joints.map((j) => (
        <Box key={`jx${j}`} p={[j, 0.101, 0]} s={[0.012, 0.004, 3]} m={M.joint} />
      ))}
      {joints.map((j) => (
        <Box key={`jz${j}`} p={[0, 0.101, j]} s={[3, 0.004, 0.012]} m={M.joint} />
      ))}
      {/* Edge curb: left / right full length, back / front only between the rail and the truck lane */}
      <Box p={[-1.48, 0.13, 0]} s={[0.04, 0.06, 3]} m={M.curb} />
      <Box p={[1.48, 0.13, 0]} s={[0.04, 0.06, 3]} m={M.curb} />
      <Box p={[-0.3, 0.13, -1.48]} s={[1.76, 0.06, 0.04]} m={M.curb} />
      <Box p={[-0.3, 0.13, 1.48]} s={[1.76, 0.06, 0.04]} m={M.curb} />
    </group>
  );
}

// --- Rail siding + loading gantry ------------------------------------------------------

const RX = -1.3; // track center line
const SLEEPERS: Inst[] = Array.from({ length: 30 }, (_, i) => ({
  p: [RX, 0.1475, -1.45 + i * 0.1],
  s: [0.15, 0.015, 0.035],
}));

function RailSiding() {
  return (
    <group>
      <Box p={[RX, 0.12, 0]} s={[0.22, 0.04, 3]} m={M.ballast} />
      <Batch items={SLEEPERS} m={M.sleeper} cast={false} />
      {[-0.0375, 0.0375].map((dx) => (
        <Box key={dx} p={[RX + dx, 0.164, 0]} s={[0.012, 0.018, 3]} m={M.rail} cast />
      ))}
      {/* Platform on the lot side with a yellow safety line */}
      <Box p={[-1.06, 0.15, 0]} s={[0.2, 0.1, 2.4]} m={M.slab} cast />
      <Box p={[-1.148, 0.201, 0]} s={[0.016, 0.003, 2.4]} m={M.yellow} />
      {/* Bollards + a small hut at the platform end */}
      <Box p={[-1.04, 0.28, 1.0]} s={[0.12, 0.16, 0.14]} m={M.wallDark} cast />
      <Box p={[-1.04, 0.37, 1.0]} s={[0.15, 0.02, 0.17]} m={M.roof} cast />
      <Box p={[-1.04, 0.28, 0.928]} s={[0.05, 0.1, 0.006]} m={M.door} />
    </group>
  );
}

const G = { xo: -1.47, xi: -1.02, z0: -0.85, z1: 0.55, top: 0.95, chord: 0.83 };

/** Lattice rods of the gantry: four lattice legs, two portal beams, two side trusses. */
const GANTRY_RODS: Inst[] = (() => {
  const r: Inst[] = [];
  const base = (x: number) => (x === G.xi ? 0.2 : Y0);
  for (const x of [G.xo, G.xi]) {
    for (const z of [G.z0, G.z1]) {
      const y0 = base(x);
      // Two posts 0.1 apart in Z with zigzag bracing
      r.push(rod([x, y0, z - 0.05], [x, G.top, z - 0.05], 0.022));
      r.push(rod([x, y0, z + 0.05], [x, G.top, z + 0.05], 0.022));
      const n = 3;
      for (let i = 0; i < n; i++) {
        const ya = y0 + ((G.top - y0) * i) / n;
        const yb = y0 + ((G.top - y0) * (i + 1)) / n;
        r.push(rod([x, ya, i % 2 ? z + 0.05 : z - 0.05], [x, yb, i % 2 ? z - 0.05 : z + 0.05], 0.01));
      }
    }
    // Side truss along Z: top + bottom chord, diagonals
    r.push(rod([x, G.top, G.z0], [x, G.top, G.z1], 0.024));
    r.push(rod([x, G.chord, G.z0], [x, G.chord, G.z1], 0.02));
    const panels = 5;
    for (let i = 0; i < panels; i++) {
      const za = G.z0 + ((G.z1 - G.z0) * i) / panels;
      const zb = G.z0 + ((G.z1 - G.z0) * (i + 1)) / panels;
      r.push(rod([x, i % 2 ? G.top : G.chord, za], [x, i % 2 ? G.chord : G.top, zb], 0.01));
    }
  }
  // Portal cross beams + diagonals
  for (const z of [G.z0, G.z1]) {
    r.push(rod([G.xo, G.top, z], [G.xi, G.top, z], 0.024));
    r.push(rod([G.xo, G.chord, z], [G.xi, G.chord, z], 0.02));
    r.push(rod([G.xo, G.chord, z], [(G.xo + G.xi) / 2, G.top, z], 0.01));
    r.push(rod([(G.xo + G.xi) / 2, G.top, z], [G.xi, G.chord, z], 0.01));
  }
  // Top deck cross members (walkway joists)
  for (let i = 1; i < 5; i++) {
    const z = G.z0 + ((G.z1 - G.z0) * i) / 5;
    r.push(rod([G.xo, G.top + 0.012, z], [G.xi, G.top + 0.012, z], 0.012));
  }
  return r;
})();

const ARM_Z = [-0.55, -0.15, 0.25];

function LoadingGantry({ phase }: { phase: number }) {
  const arms = useRef<Array<THREE.Group | null>>([]);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    arms.current.forEach((g, i) => {
      if (g) g.rotation.x = Math.sin(t * 0.6 + i * 1.7) * 0.12;
    });
  });
  return (
    <group>
      <Batch items={GANTRY_RODS} m={M.girder} />
      {/* Footings */}
      {[G.xo, G.xi].map((x) =>
        [G.z0, G.z1].map((z) => (
          <Box key={`${x}${z}`} p={[x, (x === G.xi ? 0.2 : Y0) + 0.015, z]} s={[0.06, 0.03, 0.16]} m={M.joint} />
        )),
      )}
      {/* Walkway grating + yellow handrail on top */}
      <Box p={[-1.1, G.top + 0.022, (G.z0 + G.z1) / 2]} s={[0.08, 0.008, G.z1 - G.z0]} m={M.dark} />
      <Box p={[-1.16, G.top + 0.09, (G.z0 + G.z1) / 2]} s={[0.008, 0.008, G.z1 - G.z0]} m={M.yellow} />
      {/* Center beam the arms hang from */}
      <Box p={[RX, G.chord - 0.01, (G.z0 + G.z1) / 2]} s={[0.03, 0.03, G.z1 - G.z0]} m={M.girder} cast />
      {/* Product pipe along the gantry top + drops to each arm */}
      <Pipe from={[-1.1, G.top + 0.04, G.z0]} to={[-1.1, G.top + 0.04, G.z1]} r={0.02} m={M.pipe} />
      {ARM_Z.map((z) => (
        <Box key={z} p={[(-1.1 + RX) / 2, G.top + 0.04, z]} s={[-1.1 - RX, 0.024, 0.024]} m={M.pipe} />
      ))}
      {ARM_Z.map((z, i) => (
        <group
          key={z}
          name="fillArm"
          position={[RX, G.chord, z]}
          ref={(el) => {
            arms.current[i] = el;
          }}
        >
          <Box p={[0, -0.025, 0]} s={[0.026, 0.35, 0.026]} m={M.frame} cast />
          <Box p={[0, -0.2, 0]} s={[0.04, 0.04, 0.04]} m={M.yellow} cast />
          <Box p={[0, -0.27, 0]} s={[0.03, 0.14, 0.03]} m={M.rubber} cast />
          <Box p={[0, -0.36, 0]} s={[0.035, 0.025, 0.035]} m={M.yellow} cast />
        </group>
      ))}
    </group>
  );
}

// --- Tank farm ------------------------------------------------------------------------------

const BUND = { x0: -0.95, x1: 0.2, z0: -1.45, z1: -0.2, h: 0.18, t: 0.035 };
const TANK_R = 0.235;
/** Tanks: center, body height, ladder side angle (0 = facing +Z, π/2 = +X). */
const TANKS: Array<{ x: number; z: number; h: number; ladder: number }> = [
  { x: -0.64, z: -1.12, h: 0.76, ladder: -Math.PI / 2 },
  { x: -0.1, z: -1.12, h: 0.76, ladder: Math.PI / 2 },
  { x: -0.64, z: -0.5, h: 0.7, ladder: 0 },
  { x: -0.1, z: -0.5, h: 0.7, ladder: Math.PI / 4 },
];
const TANK_BASE = Y0 + 0.03;
/** Rust patches per tank: angle, width, top-band height and drip length (× tank height). */
const RUST_PATCHES: Array<{ a: number; w: number; top: number; drip: number; off: number }> = [
  { a: 0.3, w: 0.13, top: 0.16, drip: 0.34, off: 0.02 },
  { a: 1.25, w: 0.1, top: 0.24, drip: 0.22, off: -0.015 },
  { a: 2.4, w: 0.12, top: 0.12, drip: 0.4, off: 0.025 },
  { a: 4.6, w: 0.11, top: 0.2, drip: 0.28, off: 0 },
];
const tankTop = (h: number) => TANK_BASE + h;

/** Ladder rungs of all tanks (one instanced mesh). */
const RUNGS: Inst[] = TANKS.flatMap((t) => {
  const out: Inst[] = [];
  const nx = Math.sin(t.ladder);
  const nz = Math.cos(t.ladder);
  const d = TANK_R + 0.02;
  for (let y = TANK_BASE + 0.08; y < tankTop(t.h) - 0.02; y += 0.06) {
    out.push(rbox([t.x + nx * d, y, t.z + nz * d], [0.05, 0.006, 0.006], [0, t.ladder, 0]));
  }
  return out;
});

function TankFarm() {
  const { x0, x1, z0, z1, h, t } = BUND;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return (
    <group>
      {/* Bund floor + low walls */}
      <Box p={[cx, 0.103, cz]} s={[x1 - x0, 0.006, z1 - z0]} m={M.joint} />
      <Box p={[cx, Y0 + h / 2, z0 + t / 2]} s={[x1 - x0, h, t]} m={M.curb} cast />
      <Box p={[cx, Y0 + h / 2, z1 - t / 2]} s={[x1 - x0, h, t]} m={M.curb} cast />
      <Box p={[x0 + t / 2, Y0 + h / 2, cz]} s={[t, h, z1 - z0]} m={M.curb} cast />
      <Box p={[x1 - t / 2, Y0 + h / 2, cz]} s={[t, h, z1 - z0]} m={M.curb} cast />
      {TANKS.map((tk, i) => (
        <Tank key={i} {...tk} seed={i} />
      ))}
      <Batch items={RUNGS} m={M.yellow} cast={false} />
      {/* Catwalk bridges between the tank roofs */}
      <Catwalk a={[-0.64 + TANK_R - 0.03, tankTop(0.76) + 0.02, -1.12]} b={[-0.1 - TANK_R + 0.03, tankTop(0.76) + 0.02, -1.12]} />
      <Catwalk a={[-0.64 + TANK_R - 0.03, tankTop(0.7) + 0.02, -0.5]} b={[-0.1 - TANK_R + 0.03, tankTop(0.7) + 0.02, -0.5]} />
      <Catwalk a={[-0.37, tankTop(0.76) + 0.02, -1.12]} b={[-0.37, tankTop(0.7) + 0.02, -0.5]} />
    </group>
  );
}

function Tank({ x, z, h, ladder, seed }: { x: number; z: number; h: number; ladder: number; seed: number }) {
  const top = tankTop(h);
  const nx = Math.sin(ladder);
  const nz = Math.cos(ladder);
  const tx = Math.cos(ladder);
  const tz = -Math.sin(ladder);
  const d = TANK_R + 0.02;
  // Rust patches: a wide piece under the roof edge with a narrower run dripping down.
  const patches = RUST_PATCHES.map((rp) => ({ ...rp, a: rp.a + seed * 1.3 }));
  return (
    <group>
      <Cyl p={[x, Y0 + 0.015, z]} r={TANK_R + 0.025} h={0.03} m={M.slab} seg={12} />
      <Cyl p={[x, TANK_BASE + h / 2, z]} r={TANK_R} h={h} m={M.tank} seg={14} open />
      <mesh material={M.tankRoof} position={[x, top + 0.03, z]} castShadow>
        <coneGeometry args={[TANK_R + 0.008, 0.06, 14, 1, true]} />
      </mesh>
      {/* Rust: dark bottom course + irregular patches running down from the roof edge */}
      <Cyl p={[x, TANK_BASE + 0.03, z]} r={TANK_R + 0.004} h={0.05} m={M.rustDark} seg={14} open />
      {patches.map((rp, i) => {
        const cx = x + Math.sin(rp.a) * (TANK_R + 0.002);
        const cz = z + Math.cos(rp.a) * (TANK_R + 0.002);
        const hTop = h * rp.top;
        const hDrip = h * rp.drip;
        return (
          <group key={i} position={[cx, top, cz]} rotation={[0, rp.a, 0]}>
            <Box p={[0, -hTop / 2, 0]} s={[rp.w, hTop, 0.012]} m={M.rust} />
            <Box p={[rp.off, -hTop - hDrip / 2 + 0.01, -0.001]} s={[rp.w * 0.45, hDrip, 0.01]} m={i % 2 ? M.rustDark : M.rust} />
          </group>
        );
      })}
      {/* Roof railing ring + vent */}
      <mesh material={M.yellow} position={[x, top + 0.07, z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TANK_R - 0.02, 0.005, 3, 12]} />
      </mesh>
      <Cyl p={[x, top + 0.08, z]} r={0.025} h={0.05} m={M.steel} seg={6} />
      {/* Ladder side rails (rungs are instanced) */}
      {[-0.025, 0.025].map((o) => (
        <group key={o} position={[x + nx * d + tx * o, TANK_BASE + h / 2 + 0.04, z + nz * d + tz * o]} rotation={[0, ladder, 0]}>
          <Box p={[0, 0, 0]} s={[0.007, h + 0.08, 0.007]} m={M.yellow} />
        </group>
      ))}
    </group>
  );
}

/** A catwalk from a to b: grating deck, two yellow handrails, end posts. */
function Catwalk({ a, b }: { a: V3; b: V3 }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const horiz = Math.hypot(dx, dz);
  const len = Math.hypot(horiz, dy);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, horiz);
  return (
    <group position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} rotation={new THREE.Euler(pitch, yaw, 0, 'YXZ')}>
      <Box p={[0, 0, 0]} s={[0.06, 0.01, len]} m={M.dark} cast />
      {[-0.03, 0.03].map((o) => (
        <group key={o}>
          <Box p={[o, 0.055, 0]} s={[0.006, 0.006, len]} m={M.yellow} />
          <Box p={[o, 0.028, -len / 2 + 0.01]} s={[0.006, 0.055, 0.006]} m={M.yellow} />
          <Box p={[o, 0.028, len / 2 - 0.01]} s={[0.006, 0.055, 0.006]} m={M.yellow} />
          <Box p={[o, 0.028, 0]} s={[0.006, 0.055, 0.006]} m={M.yellow} />
        </group>
      ))}
    </group>
  );
}

// --- Pump house ---------------------------------------------------------------------------------

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

const PH = { x: 0.39, w: 0.34, hallZ0: -1.21, hallZ1: -0.86, h: 0.34, rise: 0.12, backZ0: -1.38, backH: 0.5 };

function PumpHouse({ phase }: { phase: number }) {
  const fan = useRef<THREE.Group>(null);
  const hallD = PH.hallZ1 - PH.hallZ0;
  // Ridge along X: the gable prism spans the hall depth (Z) and is turned by 90°.
  const gable = useMemo(() => prismGeom(hallD, PH.rise, PH.w), [hallD]);
  const slope = Math.atan2(PH.rise, hallD / 2);
  const panelW = Math.hypot(hallD / 2, PH.rise) + 0.04;
  const hallZ = (PH.hallZ0 + PH.hallZ1) / 2;
  const backD = PH.hallZ0 - PH.backZ0;
  const backZ = (PH.hallZ0 + PH.backZ0) / 2;
  const roofY = Y0 + PH.backH;
  useFrame((state) => {
    if (fan.current) fan.current.rotation.y = (state.clock.getElapsedTime() + phase) * 4;
  });
  return (
    <group>
      {/* Gabled hall */}
      <Box p={[PH.x, Y0 + PH.h / 2, hallZ]} s={[PH.w, PH.h, hallD]} m={M.wall} cast />
      <Box p={[PH.x, Y0 + 0.025, hallZ]} s={[PH.w + 0.015, 0.05, hallD + 0.015]} m={M.wallDark} />
      {/* Symmetric gable roof, ridge along X, small overhang, roof ribs */}
      <group position={[PH.x, Y0 + PH.h, hallZ]} rotation={[0, Math.PI / 2, 0]}>
        <mesh geometry={gable} material={M.wall} castShadow />
        {[-1, 1].map((side) => (
          <group key={side} position={[(side * hallD) / 4, PH.rise / 2 + 0.012, 0]} rotation={[0, 0, -side * slope]}>
            <Box p={[0, 0, 0]} s={[panelW, 0.022, PH.w + 0.05]} m={M.roof} cast />
            {[-0.1, 0, 0.1].map((rz) => (
              <Box key={rz} p={[0, 0.013, rz]} s={[panelW, 0.006, 0.014]} m={M.roofRib} />
            ))}
          </group>
        ))}
        <Box p={[0, PH.rise + 0.022, 0]} s={[0.03, 0.025, PH.w + 0.05]} m={M.wallDark} />
      </group>
      {/* Front: door + windows; side windows */}
      <Box p={[PH.x - 0.06, Y0 + 0.11, PH.hallZ1 + 0.004]} s={[0.1, 0.2, 0.008]} m={M.door} />
      <Box p={[PH.x + 0.09, Y0 + 0.2, PH.hallZ1 + 0.004]} s={[0.08, 0.07, 0.008]} m={M.glass} />
      {[-1.14, -0.96].map((z) => (
        <Box key={z} p={[PH.x - PH.w / 2 - 0.004, Y0 + 0.22, z]} s={[0.008, 0.07, 0.1]} m={M.glass} />
      ))}
      {/* Taller back block with flat roof, roof fan and chimney */}
      <Box p={[PH.x, Y0 + PH.backH / 2, backZ]} s={[PH.w, PH.backH, backD]} m={M.wallBack} cast />
      <Box p={[PH.x, roofY + 0.012, backZ]} s={[PH.w + 0.02, 0.024, backD + 0.02]} m={M.roof} cast />
      {/* Back face: louvred vent (frame + slats), door, barrels */}
      <Box p={[PH.x + 0.07, Y0 + 0.3, PH.backZ0 - 0.004]} s={[0.13, 0.11, 0.008]} m={M.wallDark} />
      {[-0.03, 0, 0.03].map((dy) => (
        <Box key={dy} p={[PH.x + 0.07, Y0 + 0.3 + dy, PH.backZ0 - 0.01]} s={[0.12, 0.012, 0.012]} m={M.steel} />
      ))}
      <Box p={[PH.x - 0.08, Y0 + 0.11, PH.backZ0 - 0.004]} s={[0.09, 0.2, 0.008]} m={M.door} />
      <Barrel x={PH.x + 0.03} z={PH.backZ0 - 0.045} />
      <Barrel x={PH.x + 0.1} z={PH.backZ0 - 0.045} m={M.rust} />
      <Box p={[PH.x - PH.w / 2 - 0.004, Y0 + 0.12, backZ]} s={[0.008, 0.2, 0.09]} m={M.door} />
      <Box p={[PH.x - 0.06, roofY + 0.08, backZ]} s={[0.16, 0.12, 0.16]} m={M.steel} cast />
      <Cyl p={[PH.x - 0.06, roofY + 0.145, backZ]} r={0.065} h={0.012} m={M.dark} seg={12} />
      <group ref={fan} name="fan" position={[PH.x - 0.06, roofY + 0.155, backZ]}>
        <Box p={[0, 0, 0]} s={[0.11, 0.006, 0.02]} m={M.pipe} />
        <Box p={[0, 0, 0]} s={[0.02, 0.006, 0.11]} m={M.pipe} />
      </group>
      <Cyl p={[PH.x + 0.1, roofY + 0.27, PH.backZ0 + 0.06]} r={0.035} h={0.52} m={M.brick} seg={10} />
      <Cyl p={[PH.x + 0.1, roofY + 0.54, PH.backZ0 + 0.06]} r={0.044} h={0.03} m={M.dark} seg={10} />
      <Steam origin={[PH.x + 0.1, roofY + 0.57, PH.backZ0 + 0.06]} count={5} rise={0.9} spread={0.14} size={0.065} color="#cfcfcf" phase={phase} />
    </group>
  );
}

// --- Piping ---------------------------------------------------------------------------------

const MAN_Z = -0.12; // manifold in front of the bund
const MAN_Y = 0.18;

function Piping() {
  return (
    <group>
      {/* Incoming pipeline from the back edge, between the two tank columns */}
      <Pipe from={[-0.37, 0.34, -1.5]} to={[-0.37, 0.34, -0.8]} r={0.035} m={M.rust} />
      <Collar p={[-0.37, 0.34, -1.47]} r={0.048} axis="z" />
      <Collar p={[-0.37, 0.34, -1.25]} r={0.048} axis="z" />
      <Collar p={[-0.37, 0.34, -0.82]} r={0.048} axis="z" />
      <Box p={[-0.37, 0.205, -1.35]} s={[0.05, 0.21, 0.03]} m={M.frame} />
      <Box p={[-0.37, 0.205, -0.85]} s={[0.05, 0.21, 0.03]} m={M.frame} />
      {/* Front tank outlets through the bund wall to the manifold */}
      {[-0.64, -0.1].map((x) => (
        <group key={x}>
          <Pipe from={[x, MAN_Y, -0.27]} to={[x, MAN_Y, MAN_Z]} r={0.022} m={M.pipe} />
          <Valve p={[x, MAN_Y, -0.16]} axis="z" />
        </group>
      ))}
      {/* Manifold along X: to the rail gantry (left) and the pump house (right) */}
      <Pipe from={[-0.98, MAN_Y, MAN_Z]} to={[0.47, MAN_Y, MAN_Z]} r={0.025} m={M.pipe} />
      <Valve p={[-0.85, MAN_Y, MAN_Z]} />
      <Valve p={[0.3, MAN_Y, MAN_Z]} />
      {[-0.8, -0.35, 0.1].map((x) => (
        <Box key={x} p={[x, 0.13, MAN_Z]} s={[0.03, 0.06, 0.05]} m={M.frame} />
      ))}
      {/* Riser to the gantry top */}
      <Pipe from={[-0.98, MAN_Y, MAN_Z]} to={[-0.98, G.top + 0.04, MAN_Z]} r={0.022} m={M.pipe} />
      <Pipe from={[-1.1, G.top + 0.04, MAN_Z]} to={[-0.98, G.top + 0.04, MAN_Z]} r={0.022} m={M.pipe} />
      {/* Manifold → pump house */}
      <Pipe from={[0.47, MAN_Y, MAN_Z]} to={[0.47, MAN_Y, -0.88]} r={0.025} m={M.pipe} />
      <Valve p={[0.47, MAN_Y, -0.5]} axis="z" />
      {/* Pump house → canopy roof: riser + overhead run */}
      <Pipe from={[0.52, Y0, -0.82]} to={[0.52, 0.64, -0.82]} r={0.022} m={M.rust} />
      <Pipe from={[0.52, 0.64, -0.82]} to={[0.52, 0.64, -0.38]} r={0.022} m={M.rust} />
      <Collar p={[0.52, 0.64, -0.82]} r={0.03} axis="y" />
      <Collar p={[0.52, 0.64, -0.38]} r={0.03} axis="y" />
      <Box p={[0.52, 0.37, -0.55]} s={[0.02, 0.54, 0.02]} m={M.frame} />
    </group>
  );
}

// --- Truck loading lane ------------------------------------------------------------------------

const LANE = { x0: 0.58, x1: 1.46 };
const LANE_A = 0.8;
const LANE_B = 1.25;
const ISLAND = { x: 1.03, z0: -0.36, z1: 0.36 };
const CAN = { x0: 0.6, x1: 1.44, z0: -0.46, z1: 0.46, y: 0.55 };
const BEACONS: V3[] = [
  [0.7, CAN.y + 0.06, -0.4],
  [1.34, CAN.y + 0.06, -0.4],
  [0.7, CAN.y + 0.06, 0.4],
  [1.34, CAN.y + 0.06, 0.4],
];

/** White arrows on the asphalt, pointing +Z (shaft + two head bars). */
const ARROWS: Inst[] = [LANE_A, LANE_B].flatMap((x) =>
  [-1.0, 0.9].flatMap((z) => [
    { p: [x, 0.1135, z] as V3, s: [0.022, 0.002, 0.16] as V3 },
    // Head: two bars running back from the tip (z + 0.08) to either side.
    rbox([x - 0.022, 0.1135, z + 0.058], [0.02, 0.002, 0.07], [0, Math.PI / 4, 0]),
    rbox([x + 0.022, 0.1135, z + 0.058], [0.02, 0.002, 0.07], [0, -Math.PI / 4, 0]),
  ]),
);

function TruckLane({ phase }: { phase: number }) {
  const armRefs = useRef<Array<THREE.Group | null>>([]);
  const beaconRefs = useRef<Array<THREE.Mesh | null>>([]);
  const entry = useRef<THREE.Group>(null);
  const exit = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    armRefs.current.forEach((g, i) => {
      if (g) g.rotation.y = (i % 2 ? 1 : -1) * (0.15 + Math.sin(t * 0.5 + i) * 0.12);
    });
    beaconRefs.current.forEach((m, i) => {
      if (m) m.visible = Math.sin(t * 5 + i * Math.PI * 0.5) > 0;
    });
    // Barriers: open for a part of an 8 s cycle, smoothly.
    const open = (k: number) => {
      const c = ((k % 8) + 8) % 8;
      const up = Math.min(1, Math.max(0, c < 4 ? c / 0.8 : (4.8 - c) / 0.8));
      return up * 1.35;
    };
    if (entry.current) entry.current.rotation.z = -open(t);
    if (exit.current) exit.current.rotation.z = open(t + 4);
  });
  return (
    <group>
      {/* Asphalt + edge lines */}
      <Box p={[(LANE.x0 + LANE.x1) / 2, 0.106, 0]} s={[LANE.x1 - LANE.x0, 0.012, 3]} m={M.asphalt} />
      <Box p={[LANE.x0 + 0.025, 0.1135, 0]} s={[0.012, 0.002, 3]} m={M.marking} />
      <Box p={[LANE.x1 - 0.025, 0.1135, 0]} s={[0.012, 0.002, 3]} m={M.marking} />
      <Batch items={ARROWS} m={M.marking} cast={false} />
      {/* Stop lines at the bays */}
      <Box p={[LANE_A, 0.1135, CAN.z1 + 0.02]} s={[0.34, 0.002, 0.02]} m={M.marking} />
      <Box p={[LANE_B, 0.1135, CAN.z1 + 0.02]} s={[0.34, 0.002, 0.02]} m={M.marking} />

      {/* Island: yellow curb (black stripes instanced), concrete top, dispensers */}
      <Box p={[ISLAND.x, 0.135, 0]} s={[0.11, 0.045, ISLAND.z1 - ISLAND.z0]} m={M.yellow} cast />
      <Box p={[ISLAND.x, 0.162, 0]} s={[0.09, 0.012, ISLAND.z1 - ISLAND.z0 - 0.02]} m={M.slab} />
      {[-0.03, 0.03].map((z) => (
        <group key={z}>
          <Box p={[ISLAND.x, 0.22, z * 9]} s={[0.06, 0.11, 0.07]} m={M.steel} cast />
          <Box p={[ISLAND.x - 0.031, 0.24, z * 9]} s={[0.003, 0.04, 0.05]} m={M.glass} />
          <Box p={[ISLAND.x + 0.031, 0.24, z * 9]} s={[0.003, 0.04, 0.05]} m={M.glass} />
        </group>
      ))}
      {/* Loading arm posts on the island, swinging yellow arms over each bay */}
      {[-0.17, 0.17].map((z, pi) => (
        <group key={z}>
          <Box p={[ISLAND.x, 0.31, z]} s={[0.03, 0.4, 0.03]} m={M.yellow} cast />
          {[-1, 1].map((side, si) => {
            const idx = pi * 2 + si;
            return (
              <group
                key={side}
                name="truckArm"
                position={[ISLAND.x, 0.47, z]}
                ref={(el) => {
                  armRefs.current[idx] = el;
                }}
              >
                <Box p={[side * 0.11, 0, 0]} s={[0.22, 0.02, 0.02]} m={M.yellow} cast />
                <Box p={[side * 0.2, -0.07, 0]} s={[0.014, 0.12, 0.014]} m={M.rubber} />
                <Box p={[side * 0.2, -0.14, 0]} s={[0.024, 0.024, 0.024]} m={M.yellow} />
              </group>
            );
          })}
        </group>
      ))}

      {/* Canopy: corner columns, flat roof with dark fascia */}
      {[CAN.x0 + 0.02, CAN.x1 - 0.02].map((x) =>
        [CAN.z0 + 0.03, CAN.z1 - 0.03].map((z) => (
          <group key={`${x}${z}`}>
            <Box p={[x, (0.11 + CAN.y) / 2, z]} s={[0.035, CAN.y - 0.11, 0.035]} m={M.frame} cast />
            <Box p={[x, 0.13, z]} s={[0.06, 0.04, 0.06]} m={M.yellow} />
          </group>
        )),
      )}
      <Box p={[ISLAND.x, (0.17 + CAN.y) / 2, ISLAND.z0 + 0.03]} s={[0.035, CAN.y - 0.17, 0.035]} m={M.frame} cast />
      <Box p={[ISLAND.x, (0.17 + CAN.y) / 2, ISLAND.z1 - 0.03]} s={[0.035, CAN.y - 0.17, 0.035]} m={M.frame} cast />
      <Box p={[(CAN.x0 + CAN.x1) / 2, CAN.y + 0.005, (CAN.z0 + CAN.z1) / 2]} s={[CAN.x1 - CAN.x0 + 0.04, 0.03, CAN.z1 - CAN.z0 + 0.04]} m={M.wallDark} cast />
      <Box p={[(CAN.x0 + CAN.x1) / 2, CAN.y + 0.028, (CAN.z0 + CAN.z1) / 2]} s={[CAN.x1 - CAN.x0, 0.02, CAN.z1 - CAN.z0]} m={M.canopy} cast />
      {/* Roof pipes + valves */}
      <Pipe from={[0.52, 0.64, -0.38]} to={[1.36, 0.64, -0.38]} r={0.022} m={M.rust} />
      <Pipe from={[LANE_A, 0.625, -0.38]} to={[LANE_A, 0.625, 0.38]} r={0.018} m={M.rust} />
      <Pipe from={[LANE_B, 0.625, -0.38]} to={[LANE_B, 0.625, 0.38]} r={0.018} m={M.rust} />
      <Collar p={[LANE_A, 0.64, -0.38]} r={0.03} axis="y" />
      <Collar p={[LANE_B, 0.64, -0.38]} r={0.03} axis="y" />
      <Valve p={[LANE_A, 0.625, 0.1]} axis="z" />
      <Valve p={[LANE_B, 0.625, -0.1]} axis="z" />
      {/* Drop pipes from the roof to the arm posts */}
      <Box p={[ISLAND.x, (CAN.y + 0.51) / 2, -0.17]} s={[0.02, CAN.y - 0.51, 0.02]} m={M.pipe} />
      <Box p={[ISLAND.x, (CAN.y + 0.51) / 2, 0.17]} s={[0.02, CAN.y - 0.51, 0.02]} m={M.pipe} />
      {/* Beacons: dark bases (static) + blinking amber lights */}
      {BEACONS.map((b, i) => (
        <Cyl key={i} p={[b[0], b[1] - 0.015, b[2]]} r={0.022} h={0.012} m={M.dark} seg={8} />
      ))}
      <group name="beacons">
        {BEACONS.map((b, i) => (
          <mesh
            key={i}
            material={GLOW.beacon}
            position={b}
            ref={(el) => {
              beaconRefs.current[i] = el;
            }}
          >
            <cylinderGeometry args={[0.014, 0.017, 0.03, 8]} />
          </mesh>
        ))}
      </group>

      {/* Entry (back, −Z): barrier pivot on the right, sign facing incoming trucks */}
      <Box p={[1.43, 0.17, -1.3]} s={[0.04, 0.12, 0.04]} m={M.steel} cast />
      <Box p={[1.43, 0.16, -1.3]} s={[0.05, 0.03, 0.05]} m={M.yellow} />
      <group ref={entry} name="entryBarrier" position={[1.43, 0.22, -1.3]}>
        <Barrier dir={-1} />
      </group>
      <Box p={[1.475, 0.25, -1.38]} s={[0.012, 0.3, 0.012]} m={M.steel} />
      <Box p={[1.475, 0.38, -1.388]} s={[0.12, 0.12, 0.01]} m={M.blue} cast />
      {/* White "straight ahead" arrow pictogram */}
      <Box p={[1.475, 0.365, -1.395]} s={[0.018, 0.06, 0.004]} m={M.curb} />
      <group position={[1.475, 0.41, -1.395]} rotation={[0, 0, Math.PI / 4]}>
        <Box p={[0, 0, 0]} s={[0.035, 0.035, 0.004]} m={M.curb} />
      </group>

      {/* Exit (front, +Z): barrier pivot on the left, "no entry" disc facing outward */}
      <Box p={[0.61, 0.17, 1.3]} s={[0.04, 0.12, 0.04]} m={M.steel} cast />
      <Box p={[0.61, 0.16, 1.3]} s={[0.05, 0.03, 0.05]} m={M.yellow} />
      <group ref={exit} name="exitBarrier" position={[0.61, 0.22, 1.3]}>
        <Barrier dir={1} />
      </group>
      <Box p={[0.56, 0.25, 1.4]} s={[0.012, 0.3, 0.012]} m={M.steel} />
      <mesh material={M.red} position={[0.56, 0.39, 1.41]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.01, 12]} />
      </mesh>
      <Box p={[0.56, 0.39, 1.417]} s={[0.075, 0.016, 0.004]} m={M.curb} />
    </group>
  );
}

/** Red/white barrier arm from its pivot toward ±X (length 0.8). */
function Barrier({ dir }: { dir: 1 | -1 }) {
  return (
    <group>
      <Box p={[dir * 0.41, 0, 0]} s={[0.8, 0.02, 0.02]} m={M.curb} cast />
      {[0.12, 0.32, 0.52, 0.72].map((k) => (
        <Box key={k} p={[dir * k, 0, 0]} s={[0.09, 0.022, 0.022]} m={M.red} />
      ))}
      <Box p={[-dir * 0.05, 0, 0]} s={[0.07, 0.04, 0.03]} m={M.dark} />
    </group>
  );
}

// --- Office --------------------------------------------------------------------------------

const OF = { x: -0.15, z: 0.95, w: 0.46, d: 0.36, h1: 0.2, h2: 0.19 };

function Office() {
  const { x, z, w, d, h1, h2 } = OF;
  const top = Y0 + h1 + h2;
  const fz = z + d / 2 + 0.004;
  const rx = x + w / 2 + 0.004;
  const lx = x - w / 2 - 0.004;
  return (
    <group>
      <Box p={[x, Y0 + h1 / 2, z]} s={[w, h1, d]} m={M.office} cast />
      <Box p={[x, Y0 + h1 + h2 / 2, z]} s={[w, h2, d]} m={M.office} cast />
      <Box p={[x, Y0 + h1, z]} s={[w + 0.012, 0.016, d + 0.012]} m={M.slab} />
      {/* Flat roof with parapet, AC unit and antenna */}
      <Box p={[x, top + 0.02, z]} s={[w + 0.02, 0.04, d + 0.02]} m={M.slab} cast />
      <Box p={[x, top + 0.041, z]} s={[w - 0.03, 0.004, d - 0.03]} m={M.joint} />
      <Box p={[x + 0.1, top + 0.08, z - 0.05]} s={[0.1, 0.07, 0.08]} m={M.steel} cast />
      <Cyl p={[x + 0.1, top + 0.116, z - 0.05]} r={0.025} h={0.004} m={M.dark} seg={10} />
      <Box p={[x - 0.15, top + 0.12, z - 0.1]} s={[0.008, 0.16, 0.008]} m={M.steel} />
      {/* Front: door with canopy, lit windows on both floors */}
      <Box p={[x + 0.12, Y0 + 0.08, fz]} s={[0.08, 0.16, 0.008]} m={M.glass} />
      <Box p={[x + 0.12, Y0 + 0.175, fz + 0.03]} s={[0.13, 0.012, 0.07]} m={M.wallDark} cast />
      {[-0.15, -0.03].map((wx) => (
        <Box key={wx} p={[x + wx, Y0 + 0.11, fz]} s={[0.08, 0.07, 0.008]} m={GLOW.window} />
      ))}
      {[-0.15, -0.03, 0.09, 0.19].map((wx, i) => (
        <Box key={wx} p={[x + wx, Y0 + h1 + 0.095, fz]} s={[0.07, 0.07, 0.008]} m={i === 2 ? M.glass : GLOW.window} />
      ))}
      {/* Side and back windows */}
      {[-0.08, 0.08].map((wz) => (
        <group key={wz}>
          <Box p={[rx, Y0 + 0.11, z + wz]} s={[0.008, 0.07, 0.08]} m={M.glass} />
          <Box p={[rx, Y0 + h1 + 0.095, z + wz]} s={[0.008, 0.07, 0.08]} m={GLOW.window} />
          <Box p={[lx, Y0 + h1 + 0.095, z + wz]} s={[0.008, 0.07, 0.08]} m={wz < 0 ? GLOW.window : M.glass} />
        </group>
      ))}
      {[-0.12, 0.12].map((wx) => (
        <Box key={wx} p={[x + wx, Y0 + h1 + 0.095, z - d / 2 - 0.004]} s={[0.08, 0.07, 0.008]} m={M.glass} />
      ))}
      <Box p={[lx, Y0 + 0.09, z]} s={[0.008, 0.16, 0.07]} m={M.door} />
    </group>
  );
}

// --- Yard props: transformers, crates, barrels, barriers, fence ----------------------------------

function Transformer({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, Y0, z]}>
      <Box p={[0, 0.015, 0]} s={[0.2, 0.03, 0.18]} m={M.slab} />
      <Box p={[0, 0.1, 0]} s={[0.13, 0.14, 0.1]} m={M.steel} cast />
      <Box p={[0, 0.095, 0.058]} s={[0.11, 0.11, 0.016]} m={M.frame} />
      <Box p={[0, 0.095, -0.058]} s={[0.11, 0.11, 0.016]} m={M.frame} />
      {[-0.04, 0, 0.04].map((ix) => (
        <Box key={ix} p={[ix, 0.2, 0]} s={[0.018, 0.06, 0.018]} m={M.curb} />
      ))}
    </group>
  );
}

function Crate({ p, s, m = M.crate }: { p: V3; s: number; m?: THREE.Material }) {
  return <Box p={[p[0], p[1] + s / 2, p[2]]} s={[s, s, s]} m={m} cast />;
}

function Barrel({ x, z, m = M.barrel }: { x: number; z: number; m?: THREE.Material }) {
  return <Cyl p={[x, Y0 + 0.05, z]} r={0.032} h={0.1} m={m} seg={8} />;
}

const JERSEY: Array<[number, number]> = [
  [0.5, 0.25],
  [0.5, -0.3],
];

/** Hazard stripes (black) on the island sides and jersey barriers. */
const STRIPES: Inst[] = (() => {
  const out: Inst[] = [];
  for (const sx of [-1, 1]) {
    for (let z = ISLAND.z0 + 0.04; z < ISLAND.z1 - 0.01; z += 0.08) {
      out.push(rbox([ISLAND.x + sx * 0.056, 0.135, z], [0.003, 0.016, 0.06], [Math.PI / 4, 0, 0]));
    }
  }
  for (const [x, z] of JERSEY) {
    for (const sx of [-1, 1]) {
      for (const dz of [-0.07, 0, 0.07]) {
        out.push(rbox([x + sx * 0.031, Y0 + 0.035, z + dz], [0.003, 0.02, 0.07], [Math.PI / 4, 0, 0]));
      }
    }
  }
  return out;
})();

/** Fence posts along the lane's left edge, front part. */
const FENCE_Z0 = 0.6;
const FENCE_Z1 = 1.42;
const FENCE_POSTS: Inst[] = Array.from({ length: 6 }, (_, i) => ({
  p: [0.555, Y0 + 0.09, FENCE_Z0 + ((FENCE_Z1 - FENCE_Z0) * i) / 5] as V3,
  s: [0.014, 0.18, 0.014] as V3,
}));

function Yard() {
  return (
    <group>
      <Transformer x={-0.7} z={0.4} />
      <Transformer x={-0.7} z={0.7} />
      {/* Crates + pallets in front of the bund */}
      <Box p={[0.05, Y0 + 0.01, 0.1]} s={[0.16, 0.02, 0.12]} m={M.pallet} />
      <Crate p={[0.01, Y0 + 0.02, 0.1]} s={0.08} />
      <Crate p={[0.09, Y0 + 0.02, 0.1]} s={0.07} m={M.crateDark} />
      <Crate p={[0.03, Y0 + 0.1, 0.1]} s={0.065} />
      <Box p={[0.25, Y0 + 0.01, 0.12]} s={[0.14, 0.02, 0.12]} m={M.pallet} />
      <Box p={[0.25, Y0 + 0.03, 0.12]} s={[0.14, 0.02, 0.12]} m={M.pallet} />
      <Box p={[0.25, Y0 + 0.05, 0.12]} s={[0.14, 0.02, 0.12]} m={M.pallet} />
      {/* Crates on the rail platform */}
      <Crate p={[-1.06, 0.2, -1.05]} s={0.09} />
      <Crate p={[-1.06, 0.2, -0.96]} s={0.07} m={M.crateDark} />
      {/* Barrels near the office and by the lane */}
      <Barrel x={-0.48} z={1.25} />
      <Barrel x={-0.41} z={1.27} />
      <Barrel x={-0.45} z={1.33} m={M.rust} />
      <Barrel x={0.38} z={1.3} />
      <Barrel x={0.45} z={1.33} m={M.rust} />
      <Barrel x={0.42} z={1.24} />
      {/* Crates behind the office */}
      <Crate p={[-0.62, Y0, 1.1]} s={0.1} />
      <Crate p={[-0.6, Y0 + 0.1, 1.1]} s={0.07} m={M.crateDark} />
      <Box p={[-0.75, Y0 + 0.01, 1.2]} s={[0.14, 0.02, 0.12]} m={M.pallet} />
      {/* Jersey barriers (yellow, black stripes instanced) */}
      {JERSEY.map(([x, z]) => (
        <Box key={`${x}${z}`} p={[x, Y0 + 0.035, z]} s={[0.06, 0.07, 0.22]} m={M.yellow} cast />
      ))}
      {/* Wire fence along the lane, front part */}
      <Batch items={FENCE_POSTS} m={M.steel} />
      <Box p={[0.555, Y0 + 0.175, (FENCE_Z0 + FENCE_Z1) / 2]} s={[0.008, 0.008, FENCE_Z1 - FENCE_Z0]} m={M.steel} />
      <Box p={[0.555, Y0 + 0.02, (FENCE_Z0 + FENCE_Z1) / 2]} s={[0.008, 0.008, FENCE_Z1 - FENCE_Z0]} m={M.steel} />
      <Box p={[0.555, Y0 + 0.095, (FENCE_Z0 + FENCE_Z1) / 2]} s={[0.003, 0.15, FENCE_Z1 - FENCE_Z0]} m={M.fence} />
    </group>
  );
}

/** Instanced items shared by several parts (one draw call each). */
function SharedBatches() {
  return <Batch items={STRIPES} m={M.rubber} cast={false} />;
}
