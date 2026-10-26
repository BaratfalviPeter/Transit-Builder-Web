/**
 * DepotModel — the freight depot (raktár / átrakó): a 6×6 lot that takes in
 * any cargo, sorts and stores it, and hands it on, by rail and by road.
 *
 * Built in the industry models' design units (the game scales it by
 * INDUSTRY_MODEL_SCALE × cellSize: 3 × 3 units = 6 × 6 cells; one cell row
 * is 0.5 units). Along X: the lot's length. Rows along Z:
 *
 *   z ∈ [−1.5, −1.0]  track 1  ┐ drawn by Rails.tsx (rail cells), under a
 *   z ∈ [−1.0, −0.5]  track 2  ┘ gantry crane
 *   z ∈ [−0.5,  0.5]  the hall: rail platform with canopy and sliding doors
 *                     on the track side, BAY_COUNT dock doors on the road
 *                     side, the office and the wind-wheel tower at the east
 *   z ∈ [ 0.5,  1.0]  loading bays: trucks back in to a dock door (painted
 *                     bay lines, wheel stops); a lamp over each door shows
 *                     free (green) / taken (red)
 *   z ∈ [ 1.0,  1.5]  the one-lane drive (road cells, Roads.tsx): in at the
 *                     west end past the gatehouse and a signal that is red
 *                     while every bay is taken, out at the east end
 *
 * Y = 0 is the ground. Static parts are merged into a few meshes (lowPoly);
 * the wind wheel, the crane trolley and a forklift move.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { box, buildParts, cyl, FIXED_MAT, type Part } from './lowPoly';
import { CAR_GAP, CAR_LEN, Locomotive, LOCO_COLORS, LOCO_LEN, Wagon } from './TrainModel';
import { Tractor, Trailer, truckColors, type TruckColors } from './TruckModel';

type V3 = [number, number, number];

export interface DepotModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
  /** How full the store is (0…1): pallets pile up on the platforms. */
  fill?: number;
  /** Which loading bays hold a truck (west → east); missing = free. */
  bays?: readonly boolean[];
  /**
   * Leave out the parts that change with the game state (lamps, pallets) —
   * for drawing the rest under StaticBatch, with <DepotDynamic> beside it.
   */
  staticOnly?: boolean;
}

/** Loading bays (dock doors) on the road side. */
export const BAY_COUNT = 5;
/** Bay centres along X (units) and the bays' depth range along Z. */
export const BAY_X: readonly number[] = Array.from({ length: BAY_COUNT }, (_, i) => -1.12 + i * 0.47);
export const BAY_Z: readonly [number, number] = [0.44, 1.0];
/** The entrance signal (and its stop line) along X, past the gatehouse. */
const SIGNAL_X = -1.2;

const CONCRETE = '#c9c2b5';
const CONCRETE_D = '#9e978b';
const WALL = '#d7d9dc';
const WALL_RIB = '#bfc3c8';
const BASE = '#6e737a';
const ORANGE = '#e8782a';
const ROOF = '#b9bdc2';
const ROOF_D = '#8f949b';
const GLASS = '#7fa6c4';
const DOOR = '#59606a';
const DOOR_D = '#3b4047';
const STEEL = '#4f5660';
const STEEL_D = '#363b42';
const YELLOW = '#e2b42a';
const BLACK = '#26282c';
const RUBBER = '#1d1e21';
const OFFICE = '#e9e4da';
const WINDOW = '#3d5568';
const CRATE = '#b07f4c';
const CRATE_D = '#8a613a';
const BARREL = '#4f6e8c';
const BARREL_R = '#a8402e';
const GRAVEL = '#7d7468';
const LAMP = '#ffe3a0';
const ASPHALT = '#45484d';
const PAINT = '#e9e5d6';
const DARK_BOX = '#202226';
const BARRIER = '#d23c2c';

/** Hall footprint (units). */
const HALL = { x0: -1.38, x1: 0.98, z0: -0.3, z1: 0.42, h: 0.42, rise: 0.17 };
const PLAT_H = 0.06;

// ---------------------------------------------------------------- static parts

const STATIC: Part[] = (() => {
  const p: Part[] = [];
  const { x0, x1, z0, z1, h, rise } = HALL;
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const W = z1 - z0;

  // Ground: gravel under the tracks (the rails come from Rails.tsx), concrete
  // under the hall area, a hazard-striped edge round it.
  p.push(box(GRAVEL, [0, 0.004, -1.0], [3, 0.008, 1.0]));
  p.push(box(CONCRETE, [0, 0.01, 0], [3, 0.02, 1.0]));
  for (let i = 0; i < 30; i++) {
    const x = -1.45 + i * 0.1;
    p.push(box(i % 2 ? BLACK : YELLOW, [x, 0.021, -0.49], [0.1, 0.003, 0.02]));
  }

  // Rail-side loading platform with a canopy.
  p.push(box(CONCRETE, [cx, PLAT_H / 2, -0.4], [L + 0.1, PLAT_H, 0.2]));
  p.push(box(CONCRETE_D, [cx, PLAT_H / 2, -0.5 + 0.003], [L + 0.1, PLAT_H, 0.006]));
  p.push(box(YELLOW, [cx, PLAT_H + 0.001, -0.48], [L + 0.06, 0.002, 0.012]));
  p.push(box(ROOF_D, [cx, h - 0.04, -0.42], [L, 0.015, 0.26], [0.12, 0, 0]));
  for (let x = x0 + 0.05; x <= x1; x += 0.39) p.push(box(STEEL, [x, (h - 0.04) / 2, -0.53], [0.02, h - 0.04, 0.02]));
  // Steps up to the platform.
  for (let k = 0; k < 3; k++) p.push(box(CONCRETE_D, [x0 - 0.08 + k * 0.03, 0.01 + k * 0.02, -0.4], [0.03, 0.02 + k * 0.04, 0.16]));

  // Hall walls (light grey), dark base, ribs, orange band.
  p.push(box(WALL, [cx, h / 2 + 0.01, cz], [L, h, W]));
  p.push(box(BASE, [cx, 0.05, cz], [L + 0.004, 0.08, W + 0.004]));
  p.push(box(ORANGE, [cx, h - 0.06, cz], [L + 0.006, 0.035, W + 0.006]));
  for (let x = x0 + 0.06; x < x1; x += 0.08) {
    p.push(box(WALL_RIB, [x, h / 2, z0 - 0.002], [0.012, h - 0.12, 0.004]));
    p.push(box(WALL_RIB, [x, h / 2, z1 + 0.002], [0.012, h - 0.12, 0.004]));
  }
  // Gable roof: a triangular prism along X (ridge in the middle), overhangs.
  const RW = W + 0.08;
  p.push({
    mat: ROOF,
    shape: 'cylX',
    pos: [cx, h + 0.01 + rise / 3, cz],
    size: [RW / (2 * 0.866), L + 0.08, (rise * 2) / 3],
    seg: 3,
    rot: [-Math.PI / 2, 0, 0],
  });
  // Skylights on both roof faces, vents on the ridge.
  const slope = Math.atan2(rise, RW / 2);
  for (const side of [-1, 1]) {
    for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.42) {
      p.push(box(GLASS, [x, h + 0.01 + rise / 2 + 0.006, cz + side * RW / 4], [0.22, 0.008, 0.11], [side * slope, 0, 0]));
    }
  }
  for (const x of [x0 + 0.5, cx, x1 - 0.5]) p.push(cyl(ROOF_D, 'y', [x, h + rise + 0.04, cz], 0.025, 0.07, 8));
  p.push(cyl(STEEL, 'y', [x0 + 0.25, h + rise + 0.06, cz], 0.03, 0.12, 8)); // chimney

  // Rail-side sliding doors (3).
  for (const x of [x0 + 0.45, cx, x1 - 0.45]) {
    p.push(box(DOOR, [x, 0.17, z0 - 0.004], [0.32, 0.26, 0.006]));
    p.push(box(DOOR_D, [x, 0.31, z0 - 0.006], [0.36, 0.025, 0.01]));
  }
  // Loading bays: an apron in front of the hall, a dock door per bay with
  // bumpers and a dock leveller, painted bay lines, yellow wheel stops.
  const [bz0, bz1] = BAY_Z;
  p.push(box(ASPHALT, [0, 0.008, (bz0 + bz1) / 2 + 0.03], [3, 0.016, bz1 - bz0 + 0.06]));
  for (let i = 0; i <= BAY_COUNT; i++) {
    const x = BAY_X[0] - 0.235 + i * 0.47;
    p.push(box(PAINT, [x, 0.017, (bz0 + bz1) / 2 + 0.02], [0.012, 0.002, bz1 - bz0 - 0.04]));
  }
  p.push(box(PAINT, [0, 0.017, bz1 - 0.02], [BAY_COUNT * 0.47, 0.002, 0.012])); // bay mouth line
  for (const x of BAY_X) {
    p.push(box(DOOR_D, [x, 0.16, z1 + 0.004], [0.26, 0.24, 0.006]));
    for (let k = 0; k < 4; k++) p.push(box(DOOR, [x, 0.07 + k * 0.06, z1 + 0.007], [0.25, 0.004, 0.004]));
    p.push(box(DOOR_D, [x, 0.295, z1 + 0.03], [0.3, 0.012, 0.06])); // door canopy
    p.push(box(RUBBER, [x - 0.15, 0.08, z1 + 0.018], [0.03, 0.06, 0.03]));
    p.push(box(RUBBER, [x + 0.15, 0.08, z1 + 0.018], [0.03, 0.06, 0.03]));
    p.push(box(CONCRETE_D, [x, 0.03, z1 + 0.03], [0.28, 0.06, 0.06])); // dock + leveller
    p.push(box(STEEL, [x, 0.061, z1 + 0.03], [0.22, 0.004, 0.05]));
    p.push(box(YELLOW, [x - 0.06, 0.012, z1 + 0.13], [0.06, 0.016, 0.02])); // wheel stops
    p.push(box(YELLOW, [x + 0.06, 0.012, z1 + 0.13], [0.06, 0.016, 0.02]));
    p.push(box(DARK_BOX, [x, 0.335, z1 + 0.01], [0.07, 0.03, 0.02])); // bay lamp housing
  }

  // Gatehouse at the drive's entrance (west end), with a raised barrier arm.
  p.push(box(OFFICE, [-1.4, 0.09, 0.82], [0.14, 0.18, 0.18]));
  p.push(box(WINDOW, [-1.329, 0.12, 0.82], [0.004, 0.06, 0.12]));
  p.push(box(WINDOW, [-1.4, 0.12, 0.911], [0.1, 0.06, 0.004]));
  p.push(box(BASE, [-1.4, 0.185, 0.82], [0.17, 0.012, 0.21]));
  p.push(box(STEEL_D, [-1.36, 0.06, 0.95], [0.03, 0.12, 0.03]));
  p.push(box(BARRIER, [-1.36, 0.28, 0.98], [0.012, 0.36, 0.012], [0.12, 0, 0])); // arm up
  // Entrance signal: pole + head (the lamps light up — see EntranceSignal).
  p.push(box(STEEL_D, [SIGNAL_X, 0.18, 1.47], [0.015, 0.36, 0.015]));
  p.push(box(DARK_BOX, [SIGNAL_X, 0.36, 1.47], [0.04, 0.1, 0.04]));
  p.push(box(PAINT, [SIGNAL_X - 0.03, 0.003, 1.25], [0.02, 0.002, 0.46])); // stop line
  // Arrow markings on the drive: in at the west, out at the east.
  for (const x of [-0.95, 1.15]) {
    p.push(box(PAINT, [x, 0.003, 1.25], [0.12, 0.002, 0.012]));
    p.push(box(PAINT, [x + 0.05, 0.003, 1.235], [0.04, 0.002, 0.012], [0, 0.7, 0]));
    p.push(box(PAINT, [x + 0.05, 0.003, 1.265], [0.04, 0.002, 0.012], [0, -0.7, 0]));
  }

  // Office: 3 floors at the east end, flat roof, windows, entrance, sign.
  const ox0 = x1, ox1 = 1.45, oz0 = -0.05, oz1 = 0.42;
  const ocx = (ox0 + ox1) / 2, ocz = (oz0 + oz1) / 2;
  p.push(box(OFFICE, [ocx, 0.25, ocz], [ox1 - ox0, 0.5, oz1 - oz0]));
  p.push(box(BASE, [ocx, 0.505, ocz], [ox1 - ox0 + 0.02, 0.012, oz1 - oz0 + 0.02]));
  p.push(box(STEEL, [ocx - 0.06, 0.54, ocz], [0.12, 0.06, 0.1])); // rooftop unit
  for (const y of [0.1, 0.25, 0.4])
    for (let k = 0; k < 3; k++) {
      p.push(box(WINDOW, [ox0 + 0.08 + k * 0.15, y, oz1 + 0.002], [0.08, 0.07, 0.004]));
      p.push(box(WINDOW, [ox1 + 0.002, y, oz0 + 0.08 + k * 0.15], [0.004, 0.07, 0.08]));
    }
  p.push(box(DOOR_D, [ox1 - 0.1, 0.06, oz1 + 0.003], [0.08, 0.12, 0.004]));
  p.push(box(ORANGE, [ocx, 0.46, oz1 + 0.004], [0.3, 0.05, 0.004])); // sign

  // Wind-wheel tower (the wheel turns — see WindWheel) at the platform's east end.
  const tx = 1.3, tz = -0.32, th = 0.95;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    p.push(box(STEEL_D, [tx + dx * 0.045, th / 2, tz + dz * 0.045], [0.014, th, 0.014], [dz * 0.06, 0, -dx * 0.06]));
  }
  for (let y = 0.12; y < th; y += 0.16) {
    const w = 0.15 - (y / th) * 0.06;
    p.push(box(STEEL_D, [tx, y, tz - w / 2], [w, 0.008, 0.008]));
    p.push(box(STEEL_D, [tx, y, tz + w / 2], [w, 0.008, 0.008]));
    p.push(box(STEEL_D, [tx - w / 2, y, tz], [0.008, 0.008, w]));
    p.push(box(STEEL_D, [tx + w / 2, y, tz], [0.008, 0.008, w]));
  }
  p.push(box(STEEL_D, [tx, th, tz], [0.07, 0.03, 0.07]));

  // Gantry crane over both tracks (the trolley moves — see CraneTrolley).
  const gx = -0.95, gh = 0.62;
  for (const x of [gx - 0.16, gx + 0.16]) {
    p.push(box(STEEL, [x, gh / 2, -1.47], [0.035, gh, 0.035]));
    p.push(box(STEEL, [x, gh / 2, -0.53], [0.035, gh, 0.035]));
  }
  for (const z of [-1.47, -0.53]) p.push(box(STEEL, [gx, gh - 0.02, z], [0.36, 0.035, 0.035]));
  for (const x of [gx - 0.16, gx + 0.16]) p.push(box(STEEL, [x, gh, -1.0], [0.04, 0.05, 1.0]));
  for (let z = -1.4; z < -0.55; z += 0.12) {
    p.push(box(STEEL_D, [gx - 0.16, gh - 0.035, z], [0.006, 0.05, 0.006], [0.6, 0, 0]));
    p.push(box(STEEL_D, [gx + 0.16, gh - 0.035, z], [0.006, 0.05, 0.006], [-0.6, 0, 0]));
  }
  p.push(box(YELLOW, [gx, gh + 0.03, -0.53], [0.36, 0.015, 0.035]));

  // Yard lamp posts.
  for (const [x, z] of [[-1.42, -0.4], [0.2, -0.5]] as Array<[number, number]>) {
    p.push(box(STEEL_D, [x, 0.25, z], [0.015, 0.5, 0.015]));
    p.push(box(LAMP, [x, 0.5, z + 0.03], [0.03, 0.015, 0.06]));
  }

  // Always-there props on the platform: crates, barrels.
  for (const [x, z] of [[-1.25, -0.38], [-1.18, -0.42], [0.62, -0.4]] as Array<[number, number]>) {
    p.push(box(CRATE, [x, PLAT_H + 0.035, z], [0.06, 0.07, 0.06]));
  }
  for (const [x, z, c] of [[0.75, -0.42, BARREL], [0.8, -0.38, BARREL_R], [0.8, -0.44, BARREL]] as Array<[number, number, string]>) {
    p.push(cyl(c, 'y', [x, PLAT_H + 0.035, z], 0.022, 0.07, 8));
  }
  return p;
})();

const GEO = buildParts(STATIC);

/** Stock pallets (shown as the store fills): positions on the platform. */
const STOCK_SPOTS: V3[] = [];
for (let k = 0; k < 12; k++) STOCK_SPOTS.push([-1.05 + k * 0.17, PLAT_H + 0.035, -0.4 + (k % 2 ? 0.04 : -0.04)]);
const STOCK_GEO = buildParts(
  STOCK_SPOTS.flatMap(([x, y, z], k) => [
    box(k % 3 ? CRATE : CRATE_D, [x, y, z], [0.07, 0.07, 0.07]),
    box(CRATE_D, [x, y - 0.03, z], [0.08, 0.012, 0.08]),
  ]),
);

// ---------------------------------------------------------------- moving parts

function WindWheel({ phase }: { phase: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.x += dt * 1.6;
  });
  const geo = WHEEL_GEO;
  return (
    <group position={[1.3, 0.95, -0.4]}>
      <group ref={ref} rotation-x={phase}>
        {Object.entries(geo).map(([k, g]) => (
          <mesh key={k} geometry={g} material={FIXED_MAT} castShadow />
        ))}
      </group>
      {/* Tail vane */}
      <mesh position={[0, 0.02, 0.14]} material={FIXED_MAT} geometry={VANE_GEO.fixed} />
    </group>
  );
}
const WHEEL_GEO = buildParts(
  (() => {
    const p: Part[] = [cyl(STEEL_D, 'x', [0, 0, 0], 0.025, 0.04, 8)];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      p.push(box(k % 2 ? '#d9dcdf' : '#c8504a', [0, Math.cos(a) * 0.09, Math.sin(a) * 0.09], [0.006, 0.15, 0.035], [a, 0, 0]));
    }
    p.push(cyl(STEEL, 'x', [0, 0, 0], 0.16, 0.008, 18));
    return p;
  })(),
);
const VANE_GEO = buildParts([box(STEEL_D, [0, 0, 0], [0.008, 0.008, 0.18]), box('#c8504a', [0, 0.02, 0.1], [0.004, 0.08, 0.08])]);

function CraneTrolley({ phase }: { phase: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * 0.25 + phase;
    ref.current.position.z = -1.0 + Math.sin(t) * 0.32;
  });
  return (
    <group ref={ref} position={[-0.95, 0.62, -1.0]}>
      {Object.entries(TROLLEY_GEO).map(([k, g]) => (
        <mesh key={k} geometry={g} material={FIXED_MAT} castShadow />
      ))}
    </group>
  );
}
const TROLLEY_GEO = buildParts([
  box(YELLOW, [0, 0.04, 0], [0.34, 0.05, 0.09]),
  box(STEEL_D, [0, -0.1, 0], [0.006, 0.24, 0.006]),
  box(YELLOW, [0, -0.23, 0], [0.04, 0.03, 0.03]),
  box(CRATE, [0, -0.29, 0], [0.09, 0.07, 0.07]),
]);

function Forklift({ phase }: { phase: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * 0.3 + phase;
    const s = Math.sin(t);
    ref.current.position.x = -0.2 + s * 0.55;
    ref.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
  });
  return (
    <group ref={ref} position={[-0.2, PLAT_H, -0.38]}>
      {Object.entries(FORKLIFT_GEO).map(([k, g]) => (
        <mesh key={k} geometry={g} material={FIXED_MAT} castShadow />
      ))}
    </group>
  );
}
const FORKLIFT_GEO = buildParts([
  box(YELLOW, [0, 0.03, 0], [0.07, 0.035, 0.045]),
  box(STEEL_D, [-0.005, 0.07, 0], [0.035, 0.005, 0.04]), // roof
  box(STEEL_D, [-0.02, 0.05, 0.018], [0.004, 0.04, 0.004]),
  box(STEEL_D, [-0.02, 0.05, -0.018], [0.004, 0.04, 0.004]),
  box(STEEL_D, [0.04, 0.045, 0], [0.006, 0.07, 0.04]), // mast
  box(STEEL_D, [0.06, 0.012, 0.012], [0.04, 0.004, 0.006]), // forks
  box(STEEL_D, [0.06, 0.012, -0.012], [0.04, 0.004, 0.006]),
  box(CRATE, [0.065, 0.035, 0], [0.04, 0.04, 0.04]),
  cyl(RUBBER, 'z', [0.022, 0.012, 0.024], 0.012, 0.008, 8),
  cyl(RUBBER, 'z', [0.022, 0.012, -0.024], 0.012, 0.008, 8),
  cyl(RUBBER, 'z', [-0.022, 0.012, 0.024], 0.012, 0.008, 8),
  cyl(RUBBER, 'z', [-0.022, 0.012, -0.024], 0.012, 0.008, 8),
]);

/** Lamp materials: lit / dark, red / green (shared by every depot). */
const LIT_RED = new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff3b2f', emissiveIntensity: 2, toneMapped: false });
const LIT_GREEN = new THREE.MeshStandardMaterial({ color: '#36e06a', emissive: '#36e06a', emissiveIntensity: 2, toneMapped: false });
const UNLIT = new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.5 });
const LAMP_GEO = new THREE.BoxGeometry(0.022, 0.018, 0.006);
const SIG_GEO = new THREE.SphereGeometry(0.014, 10, 8);

/** Green / red lamp over each dock door. */
function BayLamps({ bays }: { bays: readonly boolean[] }) {
  return (
    <>
      {BAY_X.map((x, i) => (
        <group key={i} position={[x, 0.335, HALL.z1 + 0.021]}>
          <mesh geometry={LAMP_GEO} material={bays[i] ? UNLIT : LIT_GREEN} position={[-0.014, 0, 0]} />
          <mesh geometry={LAMP_GEO} material={bays[i] ? LIT_RED : UNLIT} position={[0.014, 0, 0]} />
        </group>
      ))}
    </>
  );
}

/** The entrance signal: red while every bay is taken, else green. */
function EntranceSignal({ open }: { open: boolean }) {
  return (
    <group position={[SIGNAL_X - 0.021, 0.36, 1.47]}>
      <mesh geometry={SIG_GEO} material={open ? UNLIT : LIT_RED} position={[0, 0.025, 0]} />
      <mesh geometry={SIG_GEO} material={open ? LIT_GREEN : UNLIT} position={[0, -0.025, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------- model

export function DepotModel({ position = [0, 0, 0], scale = 1, rotationY = 0, phase = 0, fill = 0.5, bays = [], staticOnly = false }: DepotModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      {Object.entries(GEO).map(([k, g]) => (
        <mesh key={k} geometry={g} material={FIXED_MAT} castShadow receiveShadow />
      ))}
      {!staticOnly && <DepotDynamic fill={fill} bays={bays} />}
      <WindWheel phase={phase} />
      <CraneTrolley phase={phase} />
      <Forklift phase={phase} />
    </group>
  );
}

/**
 * The depot's state-driven parts — bay lamps, the entrance signal, the stock
 * pallets — in the model's frame (place it like the model).
 */
export function DepotDynamic({ fill, bays, open }: { fill: number; bays: readonly boolean[]; open?: boolean }) {
  const taken = BAY_X.map((_, i) => !!bays[i]);
  const shown = Math.round(Math.max(0, Math.min(1, fill)) * STOCK_SPOTS.length);
  return (
    <>
      {shown > 0 && <mesh geometry={stockSlice(shown)} material={FIXED_MAT} castShadow />}
      <BayLamps bays={taken} />
      <EntranceSignal open={open ?? taken.some((b) => !b)} />
    </>
  );
}

/** The stock geometry limited to the first n pallets (2 boxes × 36 verts each). */
const slices = new Map<number, THREE.BufferGeometry>();
function stockSlice(n: number): THREE.BufferGeometry {
  let g = slices.get(n);
  if (!g) {
    g = STOCK_GEO.fixed.clone();
    g.setDrawRange(0, n * 2 * 36);
    slices.set(n, g);
  }
  return g;
}

// ---------------------------------------------------------------- viewer

/**
 * Model viewer: the depot with its two tracks and the drive drawn in
 * (in the game those are real rail / road cells).
 */
const PREVIEW_BAYS = [true, true, true, true, true];

export function DepotPreview({ phase }: { phase?: number }) {
  return (
    <group>
      {[-1.25, -0.75].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 0.012, 0]} receiveShadow>
            <boxGeometry args={[3, 0.024, 0.22]} />
            <meshStandardMaterial color="#6b6256" roughness={1} />
          </mesh>
          {Array.from({ length: 30 }).map((_, i) => (
            <mesh key={i} position={[-1.45 + i * 0.1, 0.03, 0]}>
              <boxGeometry args={[0.035, 0.012, 0.15]} />
              <meshStandardMaterial color="#5a3f27" />
            </mesh>
          ))}
          {[-0.0375, 0.0375].map((dz) => (
            <mesh key={dz} position={[0, 0.045, dz]}>
              <boxGeometry args={[3, 0.018, 0.012]} />
              <meshStandardMaterial color="#a3a9b0" metalness={0.3} roughness={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      {[1.25].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 0.006, 0]} receiveShadow>
            <boxGeometry args={[3, 0.012, 0.5]} />
            <meshStandardMaterial color="#3a3d42" roughness={1} />
          </mesh>
          {Array.from({ length: 23 }).map((_, i) => (
            <mesh key={i} position={[-1.43 + i * 0.13, 0.013, 0]}>
              <boxGeometry args={[0.07, 0.002, 0.016]} />
              <meshStandardMaterial color="#e8e2c8" />
            </mesh>
          ))}
        </group>
      ))}
      <DepotModel phase={phase} fill={0.6} bays={PREVIEW_BAYS} />
      {/* Trucks backed into every bay (so the entrance shows red), one waiting at the gate. */}
      {BAY_X.map((x, i) => {
        const c: TruckColors = { ...truckColors(i + 3), stripe: '#e74c3c' };
        return (
          <group key={i} position={[x, 0.013, 0.79]} rotation-y={-Math.PI / 2} scale={0.5}>
            <Tractor colors={c} />
            <Trailer colors={c} />
          </group>
        );
      })}
      <group position={[-1.38, 0.013, 1.29]} scale={0.5}>
        <Tractor colors={{ ...truckColors(9), stripe: '#3498db' }} />
        <Trailer colors={{ ...truckColors(9), stripe: '#3498db' }} />
      </group>
      {/* A train on track 1 for scale (vehicles are in cells: × ½ unit). */}
      <group position={[0.2, 0.054, -1.25]} scale={0.5}>
        <group position={[1.6, 0, 0]}>
          <Locomotive color={LOCO_COLORS[0]} stripe="#3498db" />
        </group>
        <group position={[1.6 - (LOCO_LEN + CAR_LEN) / 2 - CAR_GAP, 0, 0]}>
          <Wagon kind="box" />
        </group>
        <group position={[1.6 - (LOCO_LEN + CAR_LEN) / 2 - CAR_LEN - 2 * CAR_GAP, 0, 0]}>
          <Wagon kind="tank" />
        </group>
      </group>
    </group>
  );
}
