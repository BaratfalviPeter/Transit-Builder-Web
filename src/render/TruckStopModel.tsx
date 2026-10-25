/**
 * TruckStopModel — a small truck loading dock that docks onto one side of an
 * industry lot: a raised loading ramp with a hazard bumper, a warehouse with
 * three roll-up doors facing the road, a canopy over the ramp, a forklift,
 * pallets and a sign. Goods stack up on the ramp as its storage fills.
 *
 * Same frame as StationModel: design units (scaled ×2 in the game), 3 long
 * along X, local +Z away from the industry; the dock row is z ∈ [−0.5, 0]
 * and the road row (drawn by Roads.tsx) z ∈ [0, 0.5]. Y = 0 is the ground.
 */

import * as THREE from 'three';
import { Box } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface TruckStopModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
  /** How full its storage is (0…1). */
  fill?: number;
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  concrete: std('#c4bcae', { roughness: 0.95 }),
  concreteEdge: std('#968f84'),
  bumper: std('#1f1f22'),
  yellow: std('#e2b52c'),
  wall: std('#8f99a3'),
  wallDark: std('#76808a'),
  roof: std('#5b6168'),
  door: std('#c9ccd0'),
  doorRib: std('#a9adb2'),
  trim: std('#3f4247'),
  window: std('#ffd98a', { emissive: '#ffb84a', emissiveIntensity: 0.8 }),
  sign: std('#d9822b'),
  signText: std('#f6f1e6'),
  crate: std('#a8784a'),
  crateDark: std('#86603c'),
  pallet: std('#9a7a52'),
  forklift: std('#e0a21e'),
  tyre: std('#202226'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

/** Ramp top height (truck bed height). */
const DOCK = 0.09;

export function TruckStopModel({ position = [0, 0, 0], scale = 1, rotationY = 0, fill = 0 }: TruckStopModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Dock />
      <Warehouse />
      <Forklift />
      <Pallets />
      <Stock fill={fill} />
    </group>
  );
}

function Dock() {
  return (
    <group>
      <Box p={[0, DOCK / 2, -0.25]} s={[2.96, DOCK, 0.46]} m={M.concrete} cast />
      {/* Rubber bumpers + hazard edge facing the road */}
      <Box p={[0, DOCK - 0.006, -0.02]} s={[2.9, 0.012, 0.012]} m={M.yellow} />
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
        <Box key={x} p={[x, DOCK / 2, -0.012]} s={[0.08, DOCK * 0.8, 0.02]} m={M.bumper} />
      ))}
      {/* Step up onto the ramp at the near end */}
      <Box p={[-1.51, DOCK / 4, -0.25]} s={[0.06, DOCK / 2, 0.36]} m={M.concreteEdge} />
      {/* Bollards at the dock corners */}
      {[-1.44, 1.44].map((x) => (
        <group key={x}>
          <Box p={[x, DOCK + 0.05, -0.05]} s={[0.035, 0.1, 0.035]} m={M.yellow} cast />
          <Box p={[x, DOCK + 0.085, -0.05]} s={[0.036, 0.012, 0.036]} m={M.bumper} />
        </group>
      ))}
    </group>
  );
}

function Warehouse() {
  const x0 = -1.1;
  const x1 = 0.95;
  const cx = (x0 + x1) / 2;
  const w = x1 - x0;
  const h = 0.32;
  const z0 = -0.49;
  const z1 = -0.2;
  const d = z1 - z0;
  return (
    <group>
      <Box p={[cx, DOCK + h / 2, (z0 + z1) / 2]} s={[w, h, d]} m={M.wall} cast />
      {/* Ribbed cladding */}
      {Array.from({ length: 14 }).map((_, i) => (
        <Box key={i} p={[x0 + 0.07 + i * (w - 0.14) / 13, DOCK + h / 2, z1 + 0.002]} s={[0.008, h - 0.02, 0.004]} m={M.wallDark} />
      ))}
      {/* Roof + canopy reaching out over the ramp */}
      <Box p={[cx, DOCK + h + 0.012, (z0 + z1) / 2]} s={[w + 0.04, 0.024, d + 0.04]} m={M.roof} cast />
      <Box p={[cx, DOCK + h - 0.03, z1 + 0.11]} s={[w, 0.016, 0.22]} m={M.roof} cast />
      {[x0 + 0.04, cx, x1 - 0.04].map((x) => (
        <Box key={x} p={[x, DOCK + h - 0.08, z1 + 0.2]} s={[0.012, 0.1, 0.012]} m={M.trim} />
      ))}
      {/* Three roll-up doors facing the road */}
      {[-0.65, -0.08, 0.49].map((x) => (
        <group key={x} position={[x, DOCK, z1 + 0.004]}>
          <Box p={[0, 0.12, 0]} s={[0.36, 0.24, 0.008]} m={M.door} />
          {[0.04, 0.09, 0.14, 0.19].map((y) => (
            <Box key={y} p={[0, y, 0.005]} s={[0.36, 0.006, 0.004]} m={M.doorRib} />
          ))}
          <Box p={[0, 0.245, 0.004]} s={[0.4, 0.012, 0.01]} m={M.trim} />
        </group>
      ))}
      {/* Office at the far end */}
      <Box p={[1.2, DOCK + 0.13, -0.32]} s={[0.42, 0.26, 0.32]} m={M.wallDark} cast />
      <Box p={[1.2, DOCK + 0.272, -0.32]} s={[0.46, 0.02, 0.36]} m={M.roof} />
      <Box p={[1.13, DOCK + 0.15, -0.157]} s={[0.16, 0.08, 0.006]} m={M.window} />
      <Box p={[1.31, DOCK + 0.1, -0.157]} s={[0.07, 0.17, 0.006]} m={M.trim} />
      {/* Sign on the roof */}
      <Box p={[cx, DOCK + h + 0.1, z0 + 0.06]} s={[0.6, 0.14, 0.02]} m={M.sign} cast />
      <Box p={[cx, DOCK + h + 0.1, z0 + 0.071]} s={[0.46, 0.03, 0.002]} m={M.signText} />
    </group>
  );
}

function Forklift() {
  return (
    <group position={[1.15, DOCK, -0.08]} rotation={[0, Math.PI, 0]}>
      <Box p={[0, 0.05, 0]} s={[0.13, 0.07, 0.08]} m={M.forklift} cast />
      <Box p={[0.02, 0.11, 0]} s={[0.06, 0.06, 0.07]} m={M.forklift} />
      <Box p={[-0.075, 0.08, 0]} s={[0.012, 0.14, 0.07]} m={M.trim} />
      <Box p={[-0.11, 0.012, 0.02]} s={[0.07, 0.008, 0.012]} m={M.trim} />
      <Box p={[-0.11, 0.012, -0.02]} s={[0.07, 0.008, 0.012]} m={M.trim} />
      {[-0.04, 0.04].map((x) =>
        [-0.045, 0.045].map((z) => (
          <mesh key={`${x}${z}`} material={M.tyre} position={[x, 0.018, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.012, 8]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Pallets() {
  return (
    <group>
      {[
        [-1.3, -0.1],
        [-0.36, -0.1],
      ].map(([x, z], i) => (
        <group key={i} position={[x, DOCK, z]}>
          <Box p={[0, 0.01, 0]} s={[0.13, 0.02, 0.1]} m={M.pallet} />
          <Box p={[0, 0.05, 0]} s={[0.11, 0.06, 0.08]} m={i ? M.crate : M.crateDark} cast />
        </group>
      ))}
    </group>
  );
}

/** Goods stacked on the ramp in front of the doors as the storage fills. */
function Stock({ fill }: { fill: number }) {
  const n = Math.round(Math.min(1, Math.max(0, fill)) * 18);
  const out = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 6);
    const k = i % 6;
    const x = -0.95 + k * 0.29;
    out.push(<Box key={i} p={[x, DOCK + 0.045 + layer * 0.085, -0.1]} s={[0.11, 0.08, 0.1]} m={i % 2 ? M.crate : M.crateDark} cast />);
  }
  return <group>{out}</group>;
}
