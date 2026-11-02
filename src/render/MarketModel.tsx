/**
 * MarketModel — the city market (piac) on a 3×3-cell lot: where the town
 * takes in goods and timber (see sim/city.ts).
 *
 * Built in CELL UNITS: the base slab is exactly [3, 0.1, 3] centered on the
 * origin, resting on Y=0; the caller scales the group by `cellSize`.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - back: a cream market hall with a red tiled gable roof, arched doors and
 *     a small clock turret;
 *   - front: a row of stalls under striped awnings, crates of produce;
 *   - right: a loading dock with pallets and stacked crates;
 *   - lamp posts and planted trees along the edges.
 *
 * Static (no animation), shared module materials, no lights.
 */

import * as THREE from 'three';
import { Box } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface MarketModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  slab: std('#d9d1c2', { roughness: 0.95 }),
  paving: std('#c4b8a4', { roughness: 1 }),
  wall: std('#efe3c8'),
  wallTrim: std('#c9b48e'),
  roof: std('#b4473a', { roughness: 0.75 }),
  roofDark: std('#8e352b', { roughness: 0.8 }),
  door: std('#5b3a26'),
  window: std('#41525f', { roughness: 0.3 }),
  clock: std('#f6f1e4'),
  hand: std('#2a2a2a'),
  post: std('#6b5a48'),
  awnRed: std('#d8483b'),
  awnGreen: std('#3f9a5a'),
  awnBlue: std('#3c79b8'),
  awnWhite: std('#f4efe4'),
  table: std('#a8794a'),
  crate: std('#b08657'),
  crateDark: std('#7d5634'),
  apple: std('#d23c2f'),
  lemon: std('#e9c43b'),
  veg: std('#4f9a3c'),
  pallet: std('#b48a5a'),
  dock: std('#9a9488', { roughness: 0.95 }),
  lamp: std('#3a3d42', { metalness: 0.4, roughness: 0.5 }),
  lampGlow: new THREE.MeshBasicMaterial({ color: '#ffe3a1', toneMapped: false }),
  trunk: std('#6b4a2e'),
  leaf: std('#5c9a45'),
  planter: std('#8d8576'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/** Gable prism along Z: width w (x), height h (y), depth d (z), base y=0. */
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

/** Hall: centred on x, back part of the lot; ridge along X. */
const HALL = { x0: -1.25, x1: 0.75, z0: -1.3, z1: -0.25, h: 0.62, rise: 0.38 };
const HALL_W = HALL.x1 - HALL.x0;
const HALL_D = HALL.z1 - HALL.z0;
const HALL_CX = (HALL.x0 + HALL.x1) / 2;
const HALL_CZ = (HALL.z0 + HALL.z1) / 2;
// The roof prism is built across Z (gable faces ±X ends), slightly overhanging.
const ROOF_GEOM = prismGeom(HALL_D + 0.16, HALL.rise, HALL_W + 0.14);
const TURRET_ROOF = new THREE.ConeGeometry(0.16, 0.26, 4);
const CLOCK_FACE = new THREE.CircleGeometry(0.07, 16);
const LEAVES = new THREE.IcosahedronGeometry(0.17, 0);
const FRUIT = new THREE.SphereGeometry(0.028, 5, 4);

export function MarketModel({ position = [0, 0, 0], scale = 1, rotationY = 0 }: MarketModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Ground />
      <Hall />
      <Stalls />
      <Dock />
      <Lamps />
      <Trees />
    </group>
  );
}

function Ground() {
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.slab} />
      {/* paved square in front of the hall */}
      <Box p={[-0.2, 0.102, 0.65]} s={[2.3, 0.004, 1.5]} m={M.paving} />
    </group>
  );
}

function Hall() {
  const doors = [-0.75, -0.25, 0.25];
  return (
    <group>
      {/* walls + base trim */}
      <Box p={[HALL_CX, 0.1 + HALL.h / 2, HALL_CZ]} s={[HALL_W, HALL.h, HALL_D]} m={M.wall} cast />
      <Box p={[HALL_CX, 0.14, HALL_CZ]} s={[HALL_W + 0.03, 0.08, HALL_D + 0.03]} m={M.wallTrim} />
      <Box p={[HALL_CX, 0.1 + HALL.h, HALL_CZ]} s={[HALL_W + 0.05, 0.04, HALL_D + 0.05]} m={M.wallTrim} />
      {/* gable roof: ridge along X */}
      <mesh
        geometry={ROOF_GEOM}
        material={M.roof}
        position={[HALL_CX, 0.12 + HALL.h, HALL_CZ]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
        receiveShadow
      />
      <Box p={[HALL_CX, 0.12 + HALL.h + HALL.rise, HALL_CZ]} s={[HALL_W + 0.16, 0.04, 0.05]} m={M.roofDark} />
      {/* front doors with arched-look lintels and windows between */}
      {doors.map((x) => (
        <group key={x}>
          <Box p={[x, 0.1 + 0.2, HALL.z1 + 0.006]} s={[0.22, 0.4, 0.02]} m={M.door} />
          <Box p={[x, 0.1 + 0.43, HALL.z1 + 0.008]} s={[0.28, 0.05, 0.02]} m={M.wallTrim} />
        </group>
      ))}
      {[-1.0, -0.5, 0.0, 0.5].map((x) => (
        <Box key={`w${x}`} p={[x, 0.1 + 0.5, HALL.z1 + 0.006]} s={[0.12, 0.12, 0.02]} m={M.window} />
      ))}
      {/* clock turret on the ridge */}
      <group position={[HALL_CX, 0.12 + HALL.h + HALL.rise * 0.55, HALL_CZ]}>
        <Box p={[0, 0.2, 0]} s={[0.22, 0.4, 0.22]} m={M.wall} cast />
        <Box p={[0, 0.41, 0]} s={[0.25, 0.03, 0.25]} m={M.wallTrim} />
        <mesh geometry={TURRET_ROOF} material={M.roof} position={[0, 0.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow />
        <mesh geometry={CLOCK_FACE} material={M.clock} position={[0, 0.26, 0.112]} />
        <Box p={[0, 0.285, 0.115]} s={[0.012, 0.05, 0.004]} m={M.hand} />
        <Box p={[0.016, 0.26, 0.115]} s={[0.035, 0.012, 0.004]} m={M.hand} />
      </group>
    </group>
  );
}

/** One stall: table with produce under a striped awning (stripes along x). */
function Stall({ x, z, awn, fruit }: { x: number; z: number; awn: THREE.Material; fruit: THREE.Material }) {
  const W = 0.5, D = 0.32;
  const stripes = 5;
  return (
    <group position={[x, 0.1, z]}>
      {/* posts */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <Box key={`${sx}${sz}`} p={[(sx * W) / 2, 0.22, (sz * D) / 2]} s={[0.025, 0.44, 0.025]} m={M.post} />),
      )}
      {/* awning: alternating stripes, tilted to the front */}
      <group position={[0, 0.46, 0]} rotation={[0.28, 0, 0]}>
        {Array.from({ length: stripes }, (_, i) => (
          <Box
            key={i}
            p={[-W / 2 - 0.03 + ((i + 0.5) * (W + 0.06)) / stripes, 0, 0]}
            s={[(W + 0.06) / stripes, 0.02, D + 0.12]}
            m={i % 2 ? M.awnWhite : awn}
            cast
          />
        ))}
      </group>
      {/* table + crates with produce */}
      <Box p={[0, 0.16, 0.02]} s={[W - 0.04, 0.03, D - 0.06]} m={M.table} />
      {[-0.13, 0.0, 0.13].map((cx) => (
        <group key={cx}>
          <Box p={[cx, 0.2, 0.02]} s={[0.11, 0.06, 0.13]} m={M.crate} />
          {[-0.025, 0.025].map((fx) => (
            <mesh key={fx} geometry={FRUIT} material={fruit} position={[cx + fx, 0.245, 0.02]} />
          ))}
        </group>
      ))}
    </group>
  );
}

function Stalls() {
  return (
    <group>
      <Stall x={-0.95} z={0.35} awn={M.awnRed} fruit={M.apple} />
      <Stall x={-0.3} z={0.35} awn={M.awnGreen} fruit={M.veg} />
      <Stall x={0.35} z={0.35} awn={M.awnBlue} fruit={M.lemon} />
      <Stall x={-0.65} z={1.0} awn={M.awnBlue} fruit={M.apple} />
      <Stall x={0.0} z={1.0} awn={M.awnRed} fruit={M.lemon} />
      {/* loose crates on the square */}
      <Box p={[0.62, 0.15, 0.95]} s={[0.12, 0.1, 0.12]} m={M.crateDark} cast />
      <Box p={[0.66, 0.24, 0.97]} s={[0.1, 0.08, 0.1]} m={M.crate} />
      <Box p={[-1.3, 0.15, 0.7]} s={[0.12, 0.1, 0.12]} m={M.crate} cast />
    </group>
  );
}

/** Loading dock on the right: raised platform, pallets and stacked crates. */
function Dock() {
  return (
    <group>
      <Box p={[1.12, 0.16, -0.55]} s={[0.62, 0.12, 1.5]} m={M.dock} cast />
      {[-1.0, -0.55, -0.1].map((z, i) => (
        <group key={z}>
          <Box p={[1.12, 0.235, z]} s={[0.36, 0.03, 0.32]} m={M.pallet} />
          <Box p={[1.12, 0.3, z]} s={[0.3, 0.1, 0.26]} m={i === 1 ? M.crateDark : M.crate} cast />
          {i !== 1 && <Box p={[1.12, 0.39, z]} s={[0.24, 0.08, 0.2]} m={M.crateDark} />}
        </group>
      ))}
      {/* goods ramp */}
      <Box p={[1.12, 0.13, 0.33]} s={[0.4, 0.05, 0.3]} m={M.dock} />
    </group>
  );
}

function Lamps() {
  const spots: Array<[number, number]> = [
    [-1.35, 1.35],
    [0.85, 1.35],
    [-1.35, -0.05],
  ];
  return (
    <group>
      {spots.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0.1, z]}>
          <Box p={[0, 0.3, 0]} s={[0.03, 0.6, 0.03]} m={M.lamp} />
          <Box p={[0, 0.62, 0]} s={[0.08, 0.06, 0.08]} m={M.lampGlow} />
        </group>
      ))}
    </group>
  );
}

function Trees() {
  const spots: Array<[number, number]> = [
    [1.2, 1.2],
    [1.25, 0.65],
    [-1.3, -0.1 + 0.6],
  ];
  return (
    <group>
      {spots.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0.1, z]}>
          <Box p={[0, 0.04, 0]} s={[0.22, 0.08, 0.22]} m={M.planter} />
          <Box p={[0, 0.18, 0]} s={[0.04, 0.24, 0.04]} m={M.trunk} />
          <mesh geometry={LEAVES} material={M.leaf} position={[0, 0.38, 0]} castShadow />
        </group>
      ))}
    </group>
  );
}
