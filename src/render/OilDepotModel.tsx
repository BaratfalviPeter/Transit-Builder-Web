/**
 * OilDepotModel — a low-poly coastal oil terminal / oil depot, after the
 * reference art (`ref/oil-depot.jpg`). PARAMETRIC: `truckBays` (1–5) and
 * `railTracks` (1–3) widen the lot to +X / −X (`oilDepotBounds`); the default
 * (2 bays, 1 track) is the 3×3-cell lot.
 *
 * Built in CELL UNITS: the base slab is 3 deep (z ±1.5), resting on Y=0 and
 * centered on the origin; the caller scales the group by `cellSize`.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - left: 1–3 rail loading tracks along Z (walkways between them), a narrow
 *     platform on the lot side and a raised steel lattice gantry over all of
 *     them with three filling arms per track (the wagons are drawn by the game);
 *   - center / back: tank farm inside a low concrete bund wall: four dark slate
 *     steel tanks with rust bands, yellow ladders, roof railings and catwalk
 *     bridges; the incoming pipeline enters at the back edge between them;
 *   - back right: pump house (gabled hall + taller back block with a roof fan
 *     and a brick chimney with smoke), pipes with red valves to the rail gantry
 *     and over to the truck canopy;
 *   - right: U-shaped truck loading: IN and OUT lanes side by side at the back
 *     (barriers, gatehouse, median), the IN lane splits into the bays under a
 *     flat steel canopy (islands with arms, red / green bay lights taking
 *     turns), a rounded U-turn at the front into the OUT lane;
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
  /** Truck loading bays, 1–5 (default 2): the truck side widens (+X). */
  truckBays?: number;
  /** Rail loading tracks under the gantry, 1–3 (default 1): the rail side widens (−X). */
  railTracks?: number;
}

export const MAX_TRUCK_BAYS = 5;
export const MAX_RAIL_TRACKS = 3;

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
  lens: std('#a8641e', { roughness: 0.4 }),
  lampRed: std('#5a1a14', { roughness: 0.4 }),
  lampGreen: std('#1a4a22', { roughness: 0.4 }),
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
  red: new THREE.MeshBasicMaterial({ color: '#ff3a2a', toneMapped: false }),
  green: new THREE.MeshBasicMaterial({ color: '#4dff6a', toneMapped: false }),
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

/**
 * A pipe along a polyline of axis-aligned points: straight runs, and a ball at
 * every bend, so the pipe reads as bent rather than two cut ends crossing.
 */
function PipeRun({ pts, r, m }: { pts: V3[]; r: number; m: THREE.Material }) {
  return (
    <group>
      {pts.slice(1).map((b, i) => (
        <Pipe key={i} from={pts[i]} to={b} r={r} m={m} />
      ))}
      {pts.slice(1, -1).map((p, i) => (
        <Joint key={`j${i}`} p={p} r={r} m={m} />
      ))}
    </group>
  );
}

/** Ball fitting at a pipe bend / tee. */
function Joint({ p, r, m }: { p: V3; r: number; m: THREE.Material }) {
  return (
    <mesh material={m} position={p} castShadow>
      <sphereGeometry args={[r * 1.12, 12, 8]} />
    </mesh>
  );
}

// --- Model ------------------------------------------------------------------------

export function OilDepotModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
  truckBays = 2,
  railTracks = 1,
}: OilDepotModelProps) {
  const bays = Math.max(1, Math.min(MAX_TRUCK_BAYS, Math.round(truckBays)));
  const tracks = Math.max(1, Math.min(MAX_RAIL_TRACKS, Math.round(railTracks)));
  const truck = useMemo(() => truckLayout(bays), [bays]);
  const rail = useMemo(() => railLayout(tracks), [tracks]);
  const x0 = rail.lotX0;
  const x1 = truck.lotX1;
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      {/* The lot is centered on the origin whatever its width. */}
      <group position={[-(x0 + x1) / 2, 0, 0]}>
        <Ground x0={x0} x1={x1} />
        <RailSiding rail={rail} />
        <LoadingGantry rail={rail} phase={phase} />
        <TankFarm />
        <PumpHouse phase={phase} />
        <Piping truck={truck} />
        <TruckLane truck={truck} phase={phase} />
        <Office />
        <Yard />
        <SharedBatches />
      </group>
    </group>
  );
}

/**
 * Lot size of a depot in design units (×2 in the game): x from x0 to x1
 * (it grows to −X with rail tracks, to +X with truck bays), z always ±1.5.
 */
export function oilDepotBounds(truckBays = 2, railTracks = 1): { x0: number; x1: number } {
  return { x0: railLayout(railTracks).lotX0, x1: truckLayout(truckBays).lotX1 };
}

// --- Ground ----------------------------------------------------------------------

function Ground({ x0, x1 }: { x0: number; x1: number }) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const joints: number[] = [];
  for (let j = Math.ceil((x0 + 0.01) * 2) / 2; j < x1 - 0.01; j += 0.5) joints.push(j);
  // Back edge curb: open only where the two-way access road leaves the lot.
  const back: Array<[number, number]> = [
    [-1.19, STUB.c - STUB.h],
    [STUB.c + STUB.h, x1],
  ].filter(([a, b]) => b - a > 0.04) as Array<[number, number]>;
  return (
    <group>
      <Box p={[cx, 0.05, 0]} s={[w, 0.1, 3]} m={M.slab} />
      {joints.map((j) => (
        <Box key={`jx${j}`} p={[j, 0.101, 0]} s={[0.012, 0.004, 3]} m={M.joint} />
      ))}
      {[-1, -0.5, 0, 0.5, 1].map((j) => (
        <Box key={`jz${j}`} p={[cx, 0.101, j]} s={[w, 0.004, 0.012]} m={M.joint} />
      ))}
      {/* Edge curb: left / right full length; back in pieces (lanes open); front from the rail on */}
      <Box p={[x0 + 0.02, 0.13, 0]} s={[0.04, 0.06, 3]} m={M.curb} />
      <Box p={[x1 - 0.02, 0.13, 0]} s={[0.04, 0.06, 3]} m={M.curb} />
      {back.map(([a, b]) => (
        <Box key={a} p={[(a + b) / 2, 0.13, -1.48]} s={[b - a, 0.06, 0.04]} m={M.curb} />
      ))}
      <Box p={[(-1.19 + x1) / 2, 0.13, 1.48]} s={[x1 + 1.19, 0.06, 0.04]} m={M.curb} />
    </group>
  );
}

// --- Rail siding + loading gantry ------------------------------------------------------

/** Gantry fixed parts: inner legs on the platform edge, z span, heights. */
const G = { xi: -1.02, z0: -0.85, z1: 0.55, top: 0.95, chord: 0.83 };
/** Outer ends of the gantry: each leg is a pair of posts at z ± 0.05. */
const GZA = G.z0 - 0.05;
const GZB = G.z1 + 0.05;
const TRACK_PITCH = 0.5;
const ARM_Z = [-0.55, -0.15, 0.25];

interface RailLayout {
  /** Track center lines, from the platform outward (−X). */
  tracks: number[];
  /** Walkway centers between neighbouring tracks. */
  walks: number[];
  /** Gantry leg lines (x), inner first. */
  legs: number[];
  lotX0: number;
  rods: Inst[];
  sleepers: Inst[];
}

function railLayout(n: number): RailLayout {
  const tracks = Array.from({ length: n }, (_, i) => -1.3 - TRACK_PITCH * i);
  const walks = tracks.slice(0, -1).map((x) => x - TRACK_PITCH / 2);
  const xo = tracks[n - 1] - 0.17;
  const legs = [G.xi, ...walks, xo];
  const lotX0 = -1.5 - TRACK_PITCH * (n - 1);
  // Legs stand on the platform / walkways (raised), the outermost (last) on the slab.
  const r: Inst[] = [];
  legs.forEach((x, k) => {
    const y0 = k === legs.length - 1 ? Y0 : 0.2;
    for (const z of [G.z0, G.z1]) {
      // Two posts 0.1 apart in Z with zigzag bracing
      r.push(rod([x, y0, z - 0.05], [x, G.top, z - 0.05], 0.022));
      r.push(rod([x, y0, z + 0.05], [x, G.top, z + 0.05], 0.022));
      for (let i = 0; i < 3; i++) {
        const ya = y0 + ((G.top - y0) * i) / 3;
        const yb = y0 + ((G.top - y0) * (i + 1)) / 3;
        r.push(rod([x, ya, i % 2 ? z + 0.05 : z - 0.05], [x, yb, i % 2 ? z - 0.05 : z + 0.05], 0.01));
      }
    }
    // Side truss along Z: top + bottom chord, diagonals
    r.push(rod([x, G.top, GZA - 0.012], [x, G.top, GZB + 0.012], 0.024));
    r.push(rod([x, G.chord, GZA - 0.01], [x, G.chord, GZB + 0.01], 0.02));
    for (let i = 0; i < 5; i++) {
      const za = G.z0 + ((G.z1 - G.z0) * i) / 5;
      const zb = G.z0 + ((G.z1 - G.z0) * (i + 1)) / 5;
      r.push(rod([x, i % 2 ? G.top : G.chord, za], [x, i % 2 ? G.chord : G.top, zb], 0.01));
    }
  });
  // Portal cross beams over every bay between two leg lines + diagonals
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k + 1];
    const b = legs[k];
    for (const zc of [G.z0, G.z1]) {
      for (const z of [zc - 0.05, zc + 0.05]) {
        r.push(rod([a - 0.012, G.top, z], [b + 0.012, G.top, z], 0.024));
        r.push(rod([a - 0.01, G.chord, z], [b + 0.01, G.chord, z], 0.02));
        r.push(rod([a, G.chord, z], [(a + b) / 2, G.top, z], 0.01));
        r.push(rod([(a + b) / 2, G.top, z], [b, G.chord, z], 0.01));
      }
    }
  }
  // Top deck cross members (walkway joists) over the full width
  for (let i = 1; i < 5; i++) {
    const z = G.z0 + ((G.z1 - G.z0) * i) / 5;
    r.push(rod([xo, G.top + 0.012, z], [G.xi, G.top + 0.012, z], 0.012));
  }
  const sleepers = tracks.flatMap((x) =>
    Array.from({ length: 30 }, (_, i) => ({ p: [x, 0.1475, -1.45 + i * 0.1] as V3, s: [0.15, 0.015, 0.035] as V3 })),
  );
  return { tracks, walks, legs, lotX0, rods: r, sleepers };
}

function RailSiding({ rail }: { rail: RailLayout }) {
  return (
    <group>
      {rail.tracks.map((x) => (
        <group key={x}>
          <Box p={[x, 0.12, 0]} s={[0.22, 0.04, 3]} m={M.ballast} />
          {[-0.0375, 0.0375].map((dx) => (
            <Box key={dx} p={[x + dx, 0.164, 0]} s={[0.012, 0.018, 3]} m={M.rail} cast />
          ))}
        </group>
      ))}
      <Batch items={rail.sleepers} m={M.sleeper} cast={false} />
      {/* Platform on the lot side with a yellow safety line */}
      <Box p={[-1.06, 0.15, 0]} s={[0.2, 0.1, 2.4]} m={M.slab} cast />
      <Box p={[-1.148, 0.201, 0]} s={[0.016, 0.003, 2.4]} m={M.yellow} />
      {/* Walkways between neighbouring tracks (gantry legs stand on them) */}
      {rail.walks.map((x) => (
        <group key={x}>
          <Box p={[x, 0.15, (GZA + GZB) / 2]} s={[0.22, 0.1, GZB - GZA + 0.3]} m={M.slab} cast />
          <Box p={[x - 0.1, 0.201, (GZA + GZB) / 2]} s={[0.012, 0.003, GZB - GZA + 0.3]} m={M.yellow} />
          <Box p={[x + 0.1, 0.201, (GZA + GZB) / 2]} s={[0.012, 0.003, GZB - GZA + 0.3]} m={M.yellow} />
        </group>
      ))}
      {/* Small hut at the platform end */}
      <Box p={[-1.04, 0.28, 1.0]} s={[0.12, 0.16, 0.14]} m={M.girder} cast />
      <Box p={[-1.04, 0.33, 1.0]} s={[0.124, 0.018, 0.144]} m={M.yellow} />
      <Box p={[-1.04, 0.37, 1.0]} s={[0.15, 0.02, 0.17]} m={M.roof} cast />
      <Box p={[-1.04, 0.28, 0.928]} s={[0.05, 0.1, 0.006]} m={M.door} />
    </group>
  );
}

function LoadingGantry({ rail, phase }: { rail: RailLayout; phase: number }) {
  const arms = useRef<Array<THREE.Group | null>>([]);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    arms.current.forEach((g, i) => {
      if (g) g.rotation.x = Math.sin(t * 0.6 + i * 1.7) * 0.12;
    });
  });
  return (
    <group>
      <Batch items={rail.rods} m={M.girder} />
      {/* Footings */}
      {rail.legs.map((x, k) =>
        [G.z0, G.z1].map((z) => (
          <Box key={`${x}${z}`} p={[x, (k === rail.legs.length - 1 ? Y0 : 0.2) + 0.015, z]} s={[0.06, 0.03, 0.16]} m={M.joint} />
        )),
      )}
      {/* Walkway grating + yellow handrail on top */}
      <Box p={[-1.1, G.top + 0.022, (GZA + GZB) / 2]} s={[0.08, 0.008, GZB - GZA]} m={M.dark} />
      <Box p={[-1.16, G.top + 0.09, (GZA + GZB) / 2]} s={[0.008, 0.008, GZB - GZA]} m={M.yellow} />
      {[GZA, (GZA + GZB) / 2, GZB].map((z) => (
        <Box key={z} p={[-1.16, G.top + 0.055, z]} s={[0.008, 0.07, 0.008]} m={M.yellow} />
      ))}
      {/* Product pipe along the gantry top */}
      <Pipe from={[-1.1, G.top + 0.04, GZA]} to={[-1.1, G.top + 0.04, GZB]} r={0.02} m={M.pipe} />
      <Joint p={[-1.1, G.top + 0.04, MAN_Z]} r={0.022} m={M.pipe} />
      {rail.tracks.map((rx, ti) => (
        <group key={rx}>
          {/* Center beam over the track the arms hang from */}
          <Box p={[rx, G.chord - 0.01, (GZA + GZB) / 2]} s={[0.03, 0.03, GZB - GZA]} m={M.girder} cast />
          {ARM_Z.map((z) => (
            <Box key={z} p={[(-1.1 + rx) / 2, G.top + 0.04, z]} s={[-1.1 - rx, 0.024, 0.024]} m={M.pipe} />
          ))}
          {ARM_Z.map((z, i) => (
            <group
              key={z}
              name="fillArm"
              position={[rx, G.chord, z]}
              ref={(el) => {
                arms.current[ti * ARM_Z.length + i] = el;
              }}
            >
              <Box p={[0, -0.025, 0]} s={[0.026, 0.35, 0.026]} m={M.frame} cast />
              <Box p={[0, -0.2, 0]} s={[0.04, 0.04, 0.04]} m={M.yellow} cast />
              <Box p={[0, -0.27, 0]} s={[0.03, 0.14, 0.03]} m={M.rubber} cast />
              <Box p={[0, -0.36, 0]} s={[0.035, 0.025, 0.035]} m={M.yellow} cast />
            </group>
          ))}
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

/** Posts holding the yellow roof railing ring of every tank. */
const RAIL_POSTS: Inst[] = TANKS.flatMap((t) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { p: [t.x + Math.sin(a) * (TANK_R - 0.02), tankTop(t.h) + 0.04, t.z + Math.cos(a) * (TANK_R - 0.02)] as V3, s: [0.007, 0.07, 0.007] as V3 };
  }),
);

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
      <Batch items={RAIL_POSTS} m={M.yellow} cast={false} />
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
            <Box p={[rp.off, -hTop - (hDrip * 0.55) / 2 + 0.01, -0.001]} s={[rp.w * 0.5, hDrip * 0.55, 0.01]} m={M.rust} />
            <Box p={[rp.off * 1.4, -hTop - hDrip * 0.55 - (hDrip * 0.45) / 2 + 0.02, -0.002]} s={[rp.w * 0.22, hDrip * 0.45, 0.008]} m={i % 2 ? M.rustDark : M.rust} />
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

function Piping({ truck }: { truck: TruckLayout }) {
  return (
    <group>
      {/* Incoming pipeline from the back edge, between the two tank columns, then a
          header between the tank rows with a branch into each tank */}
      <Pipe from={[-0.37, 0.34, -1.5]} to={[-0.37, 0.34, -0.81]} r={0.035} m={M.rust} />
      <Collar p={[-0.37, 0.34, -1.47]} r={0.048} axis="z" />
      <Collar p={[-0.37, 0.34, -1.25]} r={0.048} axis="z" />
      <Box p={[-0.37, 0.205, -1.35]} s={[0.05, 0.21, 0.03]} m={M.frame} />
      <Pipe from={[-0.64, 0.34, -0.81]} to={[-0.1, 0.34, -0.81]} r={0.028} m={M.rust} />
      <Joint p={[-0.37, 0.34, -0.81]} r={0.035} m={M.rust} />
      {[-0.64, -0.1].map((x) => (
        <group key={x}>
          <Joint p={[x, 0.34, -0.81]} r={0.028} m={M.rust} />
          <Pipe from={[x, 0.34, -0.89]} to={[x, 0.34, -0.73]} r={0.022} m={M.rust} />
          <Collar p={[x, 0.34, -0.875]} r={0.034} axis="z" />
          <Collar p={[x, 0.34, -0.745]} r={0.034} axis="z" />
          <Box p={[x, 0.215, -0.81]} s={[0.04, 0.23, 0.03]} m={M.frame} />
        </group>
      ))}
      {/* Front tank outlets through the bund wall to the manifold */}
      {[-0.64, -0.1].map((x) => (
        <group key={x}>
          <Pipe from={[x, MAN_Y, -0.27]} to={[x, MAN_Y, MAN_Z]} r={0.022} m={M.pipe} />
          <Joint p={[x, MAN_Y, MAN_Z]} r={0.025} m={M.pipe} />
          <Valve p={[x, MAN_Y, -0.16]} axis="z" />
        </group>
      ))}
      {/* Manifold along X: to the rail gantry (left) and the pump house (right) */}
      {/* One run: gantry top → riser → manifold → pump house */}
      <PipeRun
        pts={[
          [-1.1, G.top + 0.04, MAN_Z],
          [-0.98, G.top + 0.04, MAN_Z],
          [-0.98, MAN_Y, MAN_Z],
          [0.47, MAN_Y, MAN_Z],
          [0.47, MAN_Y, -0.86],
        ]}
        r={0.024}
        m={M.pipe}
      />
      <Valve p={[-0.85, MAN_Y, MAN_Z]} />
      <Valve p={[0.3, MAN_Y, MAN_Z]} />
      {[-0.8, -0.35, 0.1].map((x) => (
        <Box key={x} p={[x, 0.13, MAN_Z]} s={[0.03, 0.06, 0.05]} m={M.frame} />
      ))}
      <Valve p={[0.47, MAN_Y, -0.5]} axis="z" />
      {/* Pump house → canopy roof: riser + overhead run to the far lane */}
      <PipeRun
        pts={[
          [0.52, Y0, -0.82],
          [0.52, PIPE_Y, -0.82],
          [0.52, PIPE_Y, HEAD_Z],
          [truck.bays[truck.bays.length - 1], PIPE_Y, HEAD_Z],
          [truck.bays[truck.bays.length - 1], PIPE_Y, 0.38],
          [truck.bays[truck.bays.length - 1], CAN_Y + 0.02, 0.38],
        ]}
        r={0.022}
        m={M.rust}
      />
      <Collar p={[0.52, 0.3, -0.82]} r={0.03} axis="y" />
      <Box p={[0.52, 0.37, -0.55]} s={[0.02, 0.54, 0.02]} m={M.frame} />
    </group>
  );
}

// --- Truck loading lane ------------------------------------------------------------------------

/**
 * U-shaped truck loading (right-hand traffic; driving toward +Z, "right" is −X):
 *   - back edge: the IN lane (left) and the OUT lane (right, along the lot edge),
 *     split by a raised median;
 *   - the IN lane widens into 1–5 loading bays under the canopy; the bays come
 *     in pairs with a shared island between them (an odd last bay gets its own);
 *   - at the front, the bays turn round a rounded U into the OUT lane, which
 *     runs back past the canopy to the exit.
 */
const LANE_X0 = 0.58;
const BAY_W = 0.24;
const ISLAND_W = 0.11;
const MEDIAN_W = 0.04;
const MEDIAN_Z1 = 0.7;
const OUT_W = 0.2;
/** IN lane at the back, before it splits. */
const IN = { x0: 0.78, x1: 1.13 };
/**
 * The ONE two-way access road at the back edge (one game cell = 0.5 wide):
 * centered on IN.x1; trucks drive in on its left half (+Z), out on its right.
 */
const STUB = { c: IN.x1, h: 0.25 };
/** Back strip where the OUT lane runs over to the access road (z range). */
const CONN = { z0: -1.3, z1: -1.0 };
const ISLAND_Z = { z0: -0.36, z1: 0.36 };
const CAN_Y = 0.55;
const CAN_Z = { z0: -0.46, z1: 0.46 };
/** Canopy roof pipes: header along X at HEAD_Z, then one branch per bay. */
const PIPE_Y = 0.64;
const HEAD_Z = -0.3;
const SPLIT = { z0: -1.0, z1: -0.62 };
/** Front edge of the turning area and its corner radius. */
const FRONT_Z = 1.44;
const TURN_R = 0.24;

interface TruckLayout {
  /** Bay center lines (x). */
  bays: number[];
  /** Islands: center x and the bays they serve. */
  islands: Array<{ x: number; bays: number[] }>;
  in: { x0: number; x1: number };
  medianL: number;
  medianX: number;
  laneX1: number;
  outX: number;
  /** Raised island between the IN side and the OUT lane (a hole in the asphalt). */
  medianGeo: THREE.BufferGeometry;
  lotX1: number;
  can: { x0: number; x1: number };
  beacons: V3[];
  geo: THREE.BufferGeometry;
  lines: Inst[];
  arrows: Inst[];
  stripes: Inst[];
}

/** Quarter arc from angle a0 to a1 around (cx, cz), radius r. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, n = 6): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number];
  });
}

/** A flat painted strip from a to b (on the asphalt). */
function paint(a: [number, number], b: [number, number], w = 0.012): Inst {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return rbox([(a[0] + b[0]) / 2, 0.1135, (a[1] + b[1]) / 2], [w, 0.002, Math.hypot(dx, dz)], [0, Math.atan2(dx, dz), 0]);
}

function truckLayout(n: number): TruckLayout {
  const bays: number[] = [];
  const islands: Array<{ x: number; bays: number[] }> = [];
  let x = LANE_X0;
  for (let i = 0; i < n; i += 2) {
    bays.push(x + BAY_W / 2);
    x += BAY_W;
    const isl = { x: x + ISLAND_W / 2, bays: [i] };
    islands.push(isl);
    x += ISLAND_W;
    if (i + 1 < n) {
      bays.push(x + BAY_W / 2);
      isl.bays.push(i + 1);
      x += BAY_W;
    }
  }
  const medianL = Math.max(x, IN.x1 + 0.02) + 0.005;
  const medianX = medianL + MEDIAN_W / 2;
  const medianR = medianL + MEDIAN_W;
  const laneX1 = medianR + OUT_W;
  const lotX1 = Math.max(1.5, Math.ceil((laneX1 + 0.08) * 2 - 1e-6) / 2);
  const can = { x0: LANE_X0 - 0.02, x1: medianL + 0.02 };

  // Asphalt outline ([x, z]), shrunk by `inset` (for the edge lines): the access road at
  // the back edge, the IN lane to its left, the strip over to the OUT lane on its right.
  const outline = (i: number): Array<[number, number]> => {
    const zf = FRONT_Z - i;
    const r = TURN_R - i;
    const w0 = LANE_X0 + i;
    const w1 = laneX1 - i;
    return [
      [STUB.c - STUB.h + i, -1.5],
      [STUB.c + STUB.h - i, -1.5],
      [STUB.c + STUB.h - i, CONN.z0 + i],
      [w1, CONN.z0 + i],
      ...arc(w1 - r, zf - r, r, 0, Math.PI / 2),
      ...arc(w0 + r, zf - r, r, Math.PI / 2, Math.PI),
      [w0, SPLIT.z1],
      [IN.x0 + i, SPLIT.z0],
      [IN.x0 + i, CONN.z0],
      [STUB.c - STUB.h + i, CONN.z0 - 0.1],
    ];
  };
  // The median: a thin curb wall from the access road's center line diagonally up to the
  // canopy's back corner (parallel to the IN lane's split), then straight on between the
  // bays and the OUT lane. Only a wall — the asphalt round it stays wide for turning.
  // `g` grows it (for its edge lines).
  const wallLine: Array<[number, number]> = [
    [STUB.c, CONN.z1],
    [medianX, SPLIT.z1],
    [medianX, MEDIAN_Z1],
  ];
  const island = (g: number) => thickLine(wallLine, MEDIAN_W / 2 + g);
  const toV = (pts: Array<[number, number]>) => pts.map(([px, pz]) => new THREE.Vector2(px, -pz));
  const shape = new THREE.Shape(toV(outline(0)));
  shape.holes.push(new THREE.Path(toV(island(0))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const medianGeo = new THREE.ExtrudeGeometry(new THREE.Shape(toV(island(0))), { depth: 0.03, bevelEnabled: false });
  medianGeo.rotateX(-Math.PI / 2);

  // Edge lines (open across the access road at the back edge), round the median,
  // a dashed center line on the access road, and the painted split nose.
  const lines: Inst[] = [];
  const ring = (pts: Array<[number, number]>, skipBack: boolean) => {
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      if (skipBack && a[1] < -1.49 && b[1] < -1.49) continue;
      lines.push(paint(a, b));
    }
  };
  ring(outline(0.025), true);
  ring(island(0.025), false);
  for (let z = -1.47; z < CONN.z1 - 0.06; z += 0.1) lines.push(paint([STUB.c, z], [STUB.c, z + 0.055]));
  const inC = (IN.x0 + IN.x1) / 2;
  const first = islands[0].x;
  lines.push(paint([inC, SPLIT.z0 + 0.12], [first - 0.05, ISLAND_Z.z0 - 0.02]));
  lines.push(paint([inC, SPLIT.z0 + 0.12], [first + 0.05, ISLAND_Z.z0 - 0.02]));
  // Stop lines at the bays.
  for (const bx of bays) lines.push(paint([bx - BAY_W / 2 + 0.02, CAN_Z.z1 + 0.02], [bx + BAY_W / 2 - 0.02, CAN_Z.z1 + 0.02], 0.02));

  // Arrows: [x, z, heading] (0 = +Z, π/2 = +X, π = −Z).
  const outX = (medianR + laneX1) / 2;
  const at: Array<[number, number, number]> = [
    [STUB.c - STUB.h / 2, -1.36, 0],
    ...bays.map((bx) => [bx, -0.56, 0] as [number, number, number]),
    [(LANE_X0 + laneX1) / 2, 1.2, Math.PI / 2],
    [outX, 0.2, Math.PI],
    [STUB.c + STUB.h / 2, -1.36, Math.PI],
  ];
  // A wide depot: the OUT lane turns left along the back strip to the access road.
  if (laneX1 - (STUB.c + STUB.h) > 0.45) at.push([(STUB.c + STUB.h + laneX1) / 2, (CONN.z0 + CONN.z1) / 2, -Math.PI / 2]);
  const arrows = at.flatMap(([ax, az, h]) => {
    const pt = (dx: number, dz: number): V3 => [ax + dx * Math.cos(h) + dz * Math.sin(h), 0.1135, az - dx * Math.sin(h) + dz * Math.cos(h)];
    return [
      rbox(pt(0, 0), [0.022, 0.002, 0.16], [0, h, 0]),
      rbox(pt(-0.022, 0.058), [0.02, 0.002, 0.07], [0, h + Math.PI / 4, 0]),
      rbox(pt(0.022, 0.058), [0.02, 0.002, 0.07], [0, h - Math.PI / 4, 0]),
    ];
  });

  // Hazard stripes on the island curbs.
  const stripes: Inst[] = [];
  for (const isl of islands) {
    for (const sx of [-1, 1]) {
      for (let z = ISLAND_Z.z0 + 0.04; z < ISLAND_Z.z1 - 0.01; z += 0.08) {
        stripes.push(rbox([isl.x + sx * 0.056, 0.135, z], [0.003, 0.016, 0.06], [Math.PI / 4, 0, 0]));
      }
    }
  }

  const beacons: V3[] = [
    [can.x0 + 0.07, CAN_Y + 0.06, -0.41],
    [can.x1 - 0.07, CAN_Y + 0.06, -0.41],
    [can.x0 + 0.07, CAN_Y + 0.06, 0.41],
    [can.x1 - 0.07, CAN_Y + 0.06, 0.41],
  ];
  return { bays, islands, in: IN, medianL, medianX, laneX1, outX, medianGeo, lotX1, can, beacons, geo, lines, arrows, stripes };
}

/** A polygon around a polyline, `half` to either side (mitred corners, square ends). */
function thickLine(pts: Array<[number, number]>, half: number): Array<[number, number]> {
  const n = pts.length;
  const dir = (i: number) => {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    return [(bx - ax) / l, (bz - az) / l] as [number, number];
  };
  const side = (sgn: number) =>
    pts.map(([x, z], i) => {
      if (i === 0 || i === n - 1) {
        const [dx, dz] = dir(i === 0 ? 0 : n - 2);
        return [x - dz * half * sgn, z + dx * half * sgn] as [number, number];
      }
      // Mitre: along the bisector of the two normals.
      const [ax, az] = dir(i - 1);
      const [bx, bz] = dir(i);
      const nx = -(az + bz);
      const nz = ax + bx;
      const nl = Math.hypot(nx, nz);
      const k = half / Math.max(0.2, (nx / nl) * -az + (nz / nl) * ax);
      return [x + (nx / nl) * k * sgn, z + (nz / nl) * k * sgn] as [number, number];
    });
  return [...side(1), ...side(-1).reverse()];
}

/** Side (−1 / +1) of an island a bay lies on. */
const sideOf = (islandX: number, bayX: number) => (bayX < islandX ? -1 : 1);

function TruckLane({ truck, phase }: { truck: TruckLayout; phase: number }) {
  const armRefs = useRef<Array<THREE.Group | null>>([]);
  const beaconRefs = useRef<Array<THREE.Mesh | null>>([]);
  const entry = useRef<THREE.Group>(null);
  const exit = useRef<THREE.Group>(null);
  /** Per bay: [red lamp, green lamp] glow meshes. */
  const lamps = useRef<Array<THREE.Mesh | null>>([]);
  const n = truck.bays.length;
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    armRefs.current.forEach((g, i) => {
      if (g) g.rotation.y = Number(g.userData.side ?? 1) * (0.15 + Math.sin(t * 0.5 + i) * 0.12);
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
    // Bay lights: the bays take turns to leave, green for one at a time (4 s each).
    const go = Math.floor(((t % (4 * n)) + 4 * n) % (4 * n) / 4);
    for (let bay = 0; bay < n; bay++) {
      const red = lamps.current[bay * 2];
      const green = lamps.current[bay * 2 + 1];
      if (red) red.visible = bay !== go;
      if (green) green.visible = bay === go;
    }
    if (entry.current) entry.current.rotation.z = open(t); // arm toward +X
    if (exit.current) exit.current.rotation.z = -open(t + 4); // arm toward −X
  });
  const { can, islands, bays } = truck;
  let armIdx = 0;
  return (
    <group>
      {/* Asphalt: IN lane → bays → U-turn → OUT lane; edge lines, nose, stop lines, arrows */}
      <mesh geometry={truck.geo} material={M.asphalt} position={[0, 0.1, 0]} receiveShadow />
      <Batch items={truck.lines} m={M.marking} cast={false} />
      <Batch items={truck.arrows} m={M.marking} cast={false} />
      <Batch items={truck.stripes} m={M.rubber} cast={false} />
      {/* Raised median between the IN side and the OUT lane, rounded nose at the front */}
      <mesh geometry={truck.medianGeo} material={M.curb} position={[0, 0.11, 0]} castShadow receiveShadow />
      <Cyl p={[truck.medianX, Y0 + 0.05, MEDIAN_Z1 - 0.02]} r={0.016} h={0.1} m={M.yellow} seg={8} />
      <Cyl p={[STUB.c + 0.02, Y0 + 0.05, CONN.z1]} r={0.016} h={0.1} m={M.yellow} seg={8} />

      {islands.map((isl) => (
        <group key={isl.x}>
          {/* Island: yellow curb (black stripes instanced), concrete top, dispensers */}
          <Box p={[isl.x, 0.135, 0]} s={[ISLAND_W, 0.045, ISLAND_Z.z1 - ISLAND_Z.z0]} m={M.yellow} cast />
          <Box p={[isl.x, 0.162, 0]} s={[ISLAND_W - 0.02, 0.012, ISLAND_Z.z1 - ISLAND_Z.z0 - 0.02]} m={M.slab} />
          {[-0.27, 0.27].map((z) => (
            <group key={z}>
              <Box p={[isl.x, 0.22, z]} s={[0.06, 0.11, 0.07]} m={M.steel} cast />
              <Box p={[isl.x - 0.031, 0.24, z]} s={[0.003, 0.04, 0.05]} m={M.glass} />
              <Box p={[isl.x + 0.031, 0.24, z]} s={[0.003, 0.04, 0.05]} m={M.glass} />
            </group>
          ))}
          {/* Loading arm posts, a swinging yellow arm over each bay the island serves */}
          {[-0.17, 0.17].map((z) => (
            <group key={z}>
              <Box p={[isl.x, 0.31, z]} s={[0.03, 0.4, 0.03]} m={M.yellow} cast />
              {isl.bays.map((b) => {
                const side = sideOf(isl.x, bays[b]);
                const idx = armIdx++;
                return (
                  <group
                    key={b}
                    name="truckArm"
                    position={[isl.x, 0.47, z]}
                    userData={{ side }}
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
          {/* Canopy columns on the island ends, drop pipes to the arm posts */}
          <Box p={[isl.x, (0.17 + CAN_Y) / 2, ISLAND_Z.z0 + 0.03]} s={[0.035, CAN_Y - 0.17, 0.035]} m={M.wall} cast />
          <Box p={[isl.x, (0.17 + CAN_Y) / 2, ISLAND_Z.z1 - 0.03]} s={[0.035, CAN_Y - 0.17, 0.035]} m={M.wall} cast />
          <Box p={[isl.x, (CAN_Y + 0.51) / 2, -0.17]} s={[0.02, CAN_Y - 0.51, 0.02]} m={M.pipe} />
          <Box p={[isl.x, (CAN_Y + 0.51) / 2, 0.17]} s={[0.02, CAN_Y - 0.51, 0.02]} m={M.pipe} />
          {/* Red / green light on the island nose: one head per bay, facing the waiting truck (−Z) */}
          <Box p={[isl.x, 0.26, ISLAND_Z.z1 + 0.05]} s={[0.018, 0.3, 0.018]} m={M.frame} cast />
          {isl.bays.map((b) => {
            const side = sideOf(isl.x, bays[b]);
            const hx = isl.x + side * 0.115;
            return (
              <group key={b}>
                <Box p={[(isl.x + hx) / 2, 0.4, ISLAND_Z.z1 + 0.05]} s={[0.115, 0.014, 0.014]} m={M.frame} />
                <group position={[hx, 0.37, ISLAND_Z.z1 + 0.05]}>
                  <Box p={[0, 0, 0]} s={[0.035, 0.075, 0.03]} m={M.dark} cast />
                  <Box p={[0, 0.042, -0.004]} s={[0.04, 0.006, 0.035]} m={M.dark} />
                  {([
                    [0.018, M.lampRed, GLOW.red],
                    [-0.018, M.lampGreen, GLOW.green],
                  ] as const).map(([dy, dim, glow], k) => (
                    <group key={k} position={[0, dy, -0.016]}>
                      <mesh material={dim} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[0.011, 0.011, 0.004, 10]} />
                      </mesh>
                      <mesh
                        material={glow}
                        position={[0, 0, -0.001]}
                        rotation={[Math.PI / 2, 0, 0]}
                        ref={(el) => {
                          lamps.current[b * 2 + k] = el;
                        }}
                      >
                        <cylinderGeometry args={[0.0115, 0.0115, 0.004, 10]} />
                      </mesh>
                    </group>
                  ))}
                </group>
              </group>
            );
          })}
        </group>
      ))}

      {/* Canopy: corner columns, flat roof with dark fascia */}
      {[can.x0 + 0.02, can.x1 - 0.02].map((x) =>
        [CAN_Z.z0 + 0.03, CAN_Z.z1 - 0.03].map((z) => (
          <group key={`${x}${z}`}>
            <Box p={[x, (0.11 + CAN_Y) / 2, z]} s={[0.035, CAN_Y - 0.11, 0.035]} m={M.wall} cast />
            <Box p={[x, 0.13, z]} s={[0.06, 0.04, 0.06]} m={M.yellow} />
          </group>
        )),
      )}
      <Box p={[(can.x0 + can.x1) / 2, CAN_Y + 0.005, 0]} s={[can.x1 - can.x0 + 0.04, 0.03, CAN_Z.z1 - CAN_Z.z0 + 0.04]} m={M.wallDark} cast />
      <Box p={[(can.x0 + can.x1) / 2, CAN_Y + 0.028, 0]} s={[can.x1 - can.x0, 0.02, CAN_Z.z1 - CAN_Z.z0]} m={M.canopy} cast />
      {/* Roof pipes: the header + last bay come from Piping; a branch off the header per other bay */}
      {bays.slice(0, -1).map((bx) => (
        <group key={bx}>
          <Joint p={[bx, PIPE_Y, HEAD_Z]} r={0.022} m={M.rust} />
          <PipeRun
            pts={[
              [bx, PIPE_Y, HEAD_Z],
              [bx, PIPE_Y, 0.38],
              [bx, CAN_Y + 0.02, 0.38],
            ]}
            r={0.02}
            m={M.rust}
          />
        </group>
      ))}
      {bays.map((bx, i) => (
        <group key={bx}>
          {[-0.05, 0.25].map((z) => (
            <Box key={z} p={[bx, CAN_Y + 0.055, z]} s={[0.05, 0.03, 0.02]} m={M.frame} />
          ))}
          <Valve p={[bx, PIPE_Y, i % 2 ? -0.1 : 0.1]} axis="z" />
        </group>
      ))}
      {/* Beacons: dark base + cap and an amber lens that is always there; the
          glowing light inside blinks */}
      {truck.beacons.map((b, i) => (
        <group key={i}>
          <Cyl p={[b[0], b[1] - 0.015, b[2]]} r={0.022} h={0.012} m={M.dark} seg={8} />
          <Cyl p={[b[0], b[1], b[2]]} r={0.017} rTop={0.014} h={0.03} m={M.lens} seg={8} />
          <Cyl p={[b[0], b[1] + 0.018, b[2]]} r={0.016} h={0.008} m={M.dark} seg={8} />
        </group>
      ))}
      <group name="beacons">
        {truck.beacons.map((b, i) => (
          <mesh
            key={i}
            material={GLOW.beacon}
            position={b}
            ref={(el) => {
              beaconRefs.current[i] = el;
            }}
          >
            <cylinderGeometry args={[0.0145, 0.0175, 0.031, 8]} />
          </mesh>
        ))}
      </group>

      {/* Back edge: one two-way access road; a barrier on each half (IN on the left,
          OUT on the right), the gatehouse by the IN side, a sign facing the road */}
      <Box p={[STUB.c - STUB.h - 0.03, 0.17, -1.4]} s={[0.04, 0.12, 0.04]} m={M.steel} cast />
      <Box p={[STUB.c - STUB.h - 0.03, 0.16, -1.4]} s={[0.05, 0.03, 0.05]} m={M.yellow} />
      <group ref={entry} name="entryBarrier" position={[STUB.c - STUB.h - 0.03, 0.22, -1.4]}>
        <Barrier dir={1} len={STUB.h + 0.01} />
      </group>
      <Box p={[STUB.c + STUB.h + 0.03, 0.17, -1.4]} s={[0.04, 0.12, 0.04]} m={M.steel} cast />
      <Box p={[STUB.c + STUB.h + 0.03, 0.16, -1.4]} s={[0.05, 0.03, 0.05]} m={M.yellow} />
      <group ref={exit} name="exitBarrier" position={[STUB.c + STUB.h + 0.03, 0.22, -1.4]}>
        <Barrier dir={-1} len={STUB.h + 0.01} />
      </group>
      <GateHouse />
      {/* Blue "oil depot / trucks this way" sign */}
      <Box p={[STUB.c - STUB.h - 0.08, 0.25, -1.46]} s={[0.012, 0.3, 0.012]} m={M.steel} />
      <Box p={[STUB.c - STUB.h - 0.08, 0.38, -1.468]} s={[0.12, 0.12, 0.01]} m={M.blue} cast />
      <Box p={[STUB.c - STUB.h - 0.08, 0.365, -1.475]} s={[0.018, 0.06, 0.004]} m={M.curb} />
      <group position={[STUB.c - STUB.h - 0.08, 0.41, -1.475]} rotation={[0, 0, Math.PI / 4]}>
        <Box p={[0, 0, 0]} s={[0.035, 0.035, 0.004]} m={M.curb} />
      </group>
      {/* Bollard where the IN lane splits */}
      <Cyl p={[IN.x0 - 0.05, Y0 + 0.05, SPLIT.z0 + 0.05]} r={0.018} h={0.1} m={M.yellow} seg={8} />
      <Cyl p={[IN.x0 - 0.05, Y0 + 0.07, SPLIT.z0 + 0.05]} r={0.019} h={0.02} m={M.rubber} seg={8} />
    </group>
  );
}

/** Red/white barrier arm from its pivot toward ±X. */
function Barrier({ dir, len = 0.8 }: { dir: 1 | -1; len?: number }) {
  const bands = Array.from({ length: Math.round(len / 0.2) }, (_, i) => 0.12 + i * 0.2).filter((k) => k < len - 0.04);
  return (
    <group>
      <Box p={[dir * (len / 2 + 0.01), 0, 0]} s={[len, 0.02, 0.02]} m={M.curb} cast />
      {bands.map((k) => (
        <Box key={k} p={[dir * k, 0, 0]} s={[0.09, 0.022, 0.022]} m={M.red} />
      ))}
      <Box p={[-dir * 0.035, 0, 0]} s={[0.04, 0.04, 0.03]} m={M.dark} />
    </group>
  );
}

/** Small gatehouse left of the IN lane: lit window toward the lane, flat roof. */
function GateHouse() {
  const x = 0.66;
  const z = -1.12;
  return (
    <group>
      <Box p={[x, Y0 + 0.09, z]} s={[0.13, 0.18, 0.16]} m={M.office} cast />
      <Box p={[x, Y0 + 0.19, z]} s={[0.16, 0.02, 0.19]} m={M.roof} cast />
      <mesh material={GLOW.window} position={[x + 0.066, Y0 + 0.12, z]}>
        <boxGeometry args={[0.004, 0.06, 0.1]} />
      </mesh>
      <Box p={[x, Y0 + 0.08, z + 0.081]} s={[0.05, 0.14, 0.004]} m={M.door} />
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

/** Hazard stripes (black) on the jersey barriers. */
const STRIPES: Inst[] = (() => {
  const out: Inst[] = [];
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

/** Model viewer variants: the smallest and the biggest depot. */
export function OilDepotMinPreview({ phase = 0 }: { phase?: number }) {
  return <OilDepotModel phase={phase} truckBays={1} railTracks={1} />;
}
export function OilDepotMaxPreview({ phase = 0 }: { phase?: number }) {
  return <OilDepotModel phase={phase} truckBays={MAX_TRUCK_BAYS} railTracks={MAX_RAIL_TRACKS} />;
}
export function OilDepotMixPreview({ phase = 0 }: { phase?: number }) {
  return <OilDepotModel phase={phase} truckBays={3} railTracks={2} />;
}
