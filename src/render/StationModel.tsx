/**
 * StationModel — a small freight rail station that docks onto one side of an
 * industry lot: a loading platform, an open loading hangar spanning platform
 * and track (trains pass underneath), a gantry hoist, a station office,
 * lamps, a signal and some cargo.
 *
 * Built in the industry models' design units (the game scales it by
 * INDUSTRY_MODEL_SCALE × cellSize, like a 6×6 lot): 3 units long along X.
 * Local +Z points AWAY from the industry: the platform row is z ∈ [−0.5, 0],
 * the track row (drawn by Rails.tsx, centre-line z = 0.25) is z ∈ [0, 0.5].
 * Y = 0 is the ground.
 */

import * as THREE from 'three';
import { Box } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface StationModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  /** Animation offset — unused (the station is static), kept for a common model API. */
  phase?: number;
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  concrete: std('#cbc3b4', { roughness: 0.95 }),
  concreteEdge: std('#9c958a'),
  safety: std('#e2b52c'),
  steel: std('#5d6670'),
  steelDark: std('#454c55'),
  roof: std('#7b4a35'),
  roofDark: std('#633a29'),
  wall: std('#d8c8a6'),
  wallTrim: std('#8f6b4a'),
  window: std('#ffd98a', { emissive: '#ffb84a', emissiveIntensity: 0.8 }),
  door: std('#5a3a26'),
  sign: std('#2f5d9a'),
  signText: std('#f2f2ee'),
  lamp: std('#fff1c4', { emissive: '#ffd27a', emissiveIntensity: 1.2 }),
  crate: std('#a8784a'),
  crateDark: std('#86603c'),
  barrel: std('#4f6e8c'),
  hoist: std('#e0b42e'),
  red: std('#e0392b', { emissive: '#a01a10', emissiveIntensity: 0.8 }),
  green: std('#3fbf5f', { emissive: '#1a7a30', emissiveIntensity: 0.6 }),
  bench: std('#6b4a30'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/** Platform top height (level with the rail heads). */
const PLAT = 0.06;
/** Loading hangar: x span, posts height. */
const HANG = { x0: -0.6, x1: 0.9, h: 0.42 };

export function StationModel({ position = [0, 0, 0], scale = 1, rotationY = 0 }: StationModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Platform />
      <Hangar />
      <Office />
      <Lamps />
      <Cargo />
      <Signal />
    </group>
  );
}

function Platform() {
  return (
    <group>
      <Box p={[0, PLAT / 2, -0.25]} s={[2.96, PLAT, 0.46]} m={M.concrete} cast />
      {/* Darker edge face toward the track + yellow safety line */}
      <Box p={[0, PLAT / 2, -0.018]} s={[2.96, PLAT, 0.006]} m={M.concreteEdge} />
      <Box p={[0, PLAT + 0.001, -0.045]} s={[2.9, 0.002, 0.014]} m={M.safety} />
      {/* Ramps at both ends */}
      <Box p={[-1.5, PLAT / 2 - 0.012, -0.25]} s={[0.06, PLAT - 0.02, 0.4]} m={M.concreteEdge} />
      <Box p={[1.5, PLAT / 2 - 0.012, -0.25]} s={[0.06, PLAT - 0.02, 0.4]} m={M.concreteEdge} />
      {/* Low fence on the industry side */}
      <Box p={[0, PLAT + 0.03, -0.47]} s={[2.9, 0.006, 0.006]} m={M.steel} />
      {Array.from({ length: 13 }).map((_, i) => (
        <Box key={i} p={[-1.44 + i * 0.24, PLAT + 0.018, -0.47]} s={[0.008, 0.036, 0.008]} m={M.steel} />
      ))}
    </group>
  );
}

/** Open loading hangar over platform AND track, with a gantry hoist. */
function Hangar() {
  const { x0, x1, h } = HANG;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const posts: number[] = [x0 + 0.03, cx, x1 - 0.03];
  const top = PLAT + h;
  const rise = 0.14;
  const half = 0.5; // half the hangar depth (z ∈ [−0.48, 0.48])
  const slope = Math.atan2(rise, half);
  const panel = Math.hypot(half, rise) + 0.04;
  return (
    <group>
      {posts.map((x) => (
        <group key={x}>
          <Box p={[x, PLAT + h / 2, -0.44]} s={[0.03, h, 0.03]} m={M.steel} cast />
          {/* Far-side posts stand on the ground beyond the track */}
          <Box p={[x, (PLAT + h) / 2, 0.47]} s={[0.03, PLAT + h, 0.03]} m={M.steel} cast />
          {/* Roof truss tie */}
          <Box p={[x, top, 0.015]} s={[0.02, 0.02, 0.94]} m={M.steelDark} />
        </group>
      ))}
      {/* Eave beams */}
      <Box p={[cx, top, -0.44]} s={[w, 0.03, 0.03]} m={M.steel} />
      <Box p={[cx, top, 0.47]} s={[w, 0.03, 0.03]} m={M.steel} />
      {/* Gabled roof, ridge along X, with corrugation ribs */}
      {[-1, 1].map((sgn) => (
        <group key={sgn} position={[cx, top + rise / 2 + 0.01, 0.015 + (sgn * half) / 2]} rotation={[sgn * slope, 0, 0]}>
          <Box p={[0, 0, 0]} s={[w + 0.1, 0.018, panel]} m={M.roof} cast />
          {Array.from({ length: 9 }).map((_, i) => (
            <Box key={i} p={[-w / 2 + ((i + 0.5) * w) / 9, 0.011, 0]} s={[0.012, 0.006, panel]} m={M.roofDark} />
          ))}
        </group>
      ))}
      {/* Gantry hoist on a rail under the ridge, holding a crate over the track */}
      <Box p={[cx, top - 0.03, 0.015]} s={[w - 0.06, 0.025, 0.025]} m={M.hoist} />
      <Box p={[cx + 0.2, top - 0.07, 0.015]} s={[0.07, 0.05, 0.06]} m={M.hoist} cast />
      <Box p={[cx + 0.2, top - 0.17, 0.015]} s={[0.004, 0.15, 0.004]} m={M.steelDark} />
      <Box p={[cx + 0.2, top - 0.27, 0.015]} s={[0.09, 0.07, 0.08]} m={M.crate} cast />
    </group>
  );
}

function Office() {
  const x0 = -1.42;
  const x1 = -0.72;
  const cx = (x0 + x1) / 2;
  const h = 0.26;
  return (
    <group>
      <Box p={[cx, PLAT + h / 2, -0.28]} s={[x1 - x0, h, 0.36]} m={M.wall} cast />
      <Box p={[cx, PLAT + h + 0.012, -0.28]} s={[x1 - x0 + 0.04, 0.024, 0.4]} m={M.wallTrim} cast />
      <Box p={[cx, PLAT + 0.012, -0.28]} s={[x1 - x0 + 0.01, 0.024, 0.37]} m={M.wallTrim} />
      {/* Windows + door on the track side */}
      {[-0.22, -0.05, 0.22].map((dx) => (
        <Box key={dx} p={[cx + dx, PLAT + 0.15, -0.098]} s={[0.1, 0.08, 0.006]} m={M.window} />
      ))}
      <Box p={[cx + 0.08, PLAT + 0.09, -0.098]} s={[0.08, 0.15, 0.006]} m={M.door} />
      <Box p={[x0 - 0.002, PLAT + 0.15, -0.28]} s={[0.006, 0.08, 0.12]} m={M.window} />
      {/* Station sign on the roof */}
      <Box p={[cx, PLAT + h + 0.09, -0.12]} s={[0.42, 0.1, 0.02]} m={M.sign} cast />
      <Box p={[cx, PLAT + h + 0.09, -0.109]} s={[0.32, 0.02, 0.002]} m={M.signText} />
      <Box p={[cx - 0.15, PLAT + h + 0.04, -0.13]} s={[0.012, 0.06, 0.012]} m={M.steel} />
      <Box p={[cx + 0.15, PLAT + h + 0.04, -0.13]} s={[0.012, 0.06, 0.012]} m={M.steel} />
      {/* Bench */}
      <Box p={[x1 + 0.12, PLAT + 0.03, -0.32]} s={[0.14, 0.012, 0.05]} m={M.bench} />
      <Box p={[x1 + 0.12, PLAT + 0.05, -0.345]} s={[0.14, 0.03, 0.008]} m={M.bench} />
    </group>
  );
}

function Lamps() {
  return (
    <group>
      {[-0.66, 1.05, 1.38].map((x) => (
        <group key={x} position={[x, PLAT, -0.1]}>
          <Box p={[0, 0.16, 0]} s={[0.012, 0.32, 0.012]} m={M.steelDark} />
          <Box p={[0, 0.32, 0.03]} s={[0.012, 0.012, 0.07]} m={M.steelDark} />
          <Box p={[0, 0.31, 0.06]} s={[0.04, 0.014, 0.03]} m={M.lamp} />
        </group>
      ))}
    </group>
  );
}

function Cargo() {
  const crates: Array<[number, number, number, number, THREE.Material]> = [
    [-0.4, -0.32, 0.09, 0.08, M.crate],
    [-0.29, -0.34, 0.08, 0.07, M.crateDark],
    [-0.35, -0.33, 0.07, 0.15, M.crate],
    [0.55, -0.3, 0.1, 0.09, M.crateDark],
    [0.68, -0.32, 0.08, 0.07, M.crate],
    [1.2, -0.3, 0.09, 0.08, M.crate],
  ];
  return (
    <group>
      {crates.map(([x, z, s, h, m], i) => (
        <Box key={i} p={[x, PLAT + h / 2, z]} s={[s, h, s]} m={m} cast />
      ))}
      {/* Pallet with barrels */}
      <group position={[0.15, PLAT, -0.3]}>
        <Box p={[0, 0.01, 0]} s={[0.2, 0.02, 0.15]} m={M.crateDark} />
        {[
          [-0.05, -0.035],
          [0.05, -0.035],
          [-0.05, 0.035],
          [0.05, 0.035],
        ].map(([x, z], i) => (
          <mesh key={i} material={M.barrel} position={[x, 0.065, z]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 0.09, 10]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Signal mast at the far end, beside the track. */
function Signal() {
  return (
    <group position={[1.42, 0, 0.47]}>
      <Box p={[0, 0.17, 0]} s={[0.014, 0.34, 0.014]} m={M.steelDark} />
      <Box p={[0, 0.33, -0.012]} s={[0.04, 0.09, 0.02]} m={M.steelDark} />
      <mesh material={M.red} position={[0, 0.35, -0.024]}>
        <sphereGeometry args={[0.011, 8, 6]} />
      </mesh>
      <mesh material={M.green} position={[0, 0.315, -0.024]}>
        <sphereGeometry args={[0.011, 8, 6]} />
      </mesh>
    </group>
  );
}
