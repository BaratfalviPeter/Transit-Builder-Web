/**
 * TruckModel — an articulated semi truck (low-poly): a cab-over tractor and
 * a tarp trailer, each its own group so they can bend at the fifth wheel.
 *
 * Units: cells. Both groups have their origin at the HITCH (fifth wheel),
 * +X forward: the tractor reaches TRUCK_HITCH ahead of it, the trailer's
 * axles sit TRAILER_AXLE behind it (see transport.ts).
 *
 * Draw calls: the fixed-colour parts are merged into one vertex-coloured
 * mesh per group, the paint / tarp / line stripe into one mesh each — five
 * meshes per truck.
 */

import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';
import { box, buildParts, FIXED_MAT, paintMat, type Part } from './lowPoly';

/** Cab paints and tarp colours (a truck's pick depends on its id). */
export const CAB_COLORS = ['#c4532a', '#2f6fb3', '#d9d5c9', '#b3312e', '#3d8a4f', '#e0ad2c', '#5b4f8c', '#2b2d31'];
export const TARP_COLORS = ['#5b6f80', '#7b8a6a', '#8a5a4a', '#cfcabd', '#3f4f6b', '#9a8463'];

export function truckColors(id: number): { cab: string; tarp: string } {
  const h = (id * 2654435761) >>> 0;
  return { cab: CAB_COLORS[h % CAB_COLORS.length], tarp: TARP_COLORS[(h >>> 8) % TARP_COLORS.length] };
}

const DARK = '#2a2c30';
const TIRE = '#1c1d20';
const CHROME = '#b9bec4';
const GLASS = '#26313b';
const TANK = '#8d9399';
const WHITE = '#e9e7e1';
const LAMP = '#ffe9a8';
const AMBER = '#f0a030';
const RED = '#c8261e';
const YELLOW = '#e8c21e';
const RIB = '#3a3f44';

/** Wheel: a cylinder along Z (radius, width). */
const wheel = (x: number, z: number, r = 0.036): Part[] => [
  { mat: TIRE, shape: 'cylZ', pos: [x, r, z], size: [r, 0.03, r] },
  { mat: CHROME, shape: 'cylZ', pos: [x, r, z + Math.sign(z) * 0.002], size: [r * 0.45, 0.031, r * 0.45] },
];

const TRACTOR: Part[] = [
  box(DARK, [0.1, 0.052, 0], [0.34, 0.026, 0.12]), // chassis
  box('paint', [0.205, 0.145, 0], [0.12, 0.15, 0.19]), // cab
  box(WHITE, [0.2, 0.226, 0], [0.11, 0.012, 0.17]), // roof fairing
  box(GLASS, [0.2655, 0.178, 0], [0.004, 0.05, 0.17]), // windscreen
  box(GLASS, [0.238, 0.178, 0.0955], [0.045, 0.045, 0.002]),
  box(GLASS, [0.238, 0.178, -0.0955], [0.045, 0.045, 0.002]),
  box(DARK, [0.2655, 0.112, 0], [0.004, 0.05, 0.085]), // grille
  box(LAMP, [0.2665, 0.096, 0.072], [0.004, 0.018, 0.026]),
  box(LAMP, [0.2665, 0.096, -0.072], [0.004, 0.018, 0.026]),
  box(DARK, [0.27, 0.068, 0], [0.014, 0.026, 0.2]), // bumper
  box(AMBER, [0.262, 0.214, -0.022], [0.006, 0.008, 0.008]),
  box(AMBER, [0.262, 0.214, 0], [0.006, 0.008, 0.008]),
  box(AMBER, [0.262, 0.214, 0.022], [0.006, 0.008, 0.008]),
  box(DARK, [0.27, 0.19, 0.1], [0.004, 0.03, 0.012]), // mirrors
  box(DARK, [0.27, 0.19, -0.1], [0.004, 0.03, 0.012]),
  box(DARK, [0.18, 0.062, 0.1], [0.04, 0.008, 0.016]), // steps
  box(DARK, [0.18, 0.062, -0.1], [0.04, 0.008, 0.016]),
  { mat: CHROME, shape: 'cylY', pos: [0.134, 0.19, 0.085], size: [0.008, 0.15, 0.008] }, // exhaust stacks
  { mat: CHROME, shape: 'cylY', pos: [0.134, 0.19, -0.085], size: [0.008, 0.15, 0.008] },
  { mat: TANK, shape: 'cylX', pos: [0.095, 0.064, 0.078], size: [0.018, 0.06, 0.018] }, // fuel tanks
  { mat: TANK, shape: 'cylX', pos: [0.095, 0.064, -0.078], size: [0.018, 0.06, 0.018] },
  box(DARK, [0.0, 0.07, 0], [0.06, 0.01, 0.08]), // fifth wheel
  ...wheel(0.2, 0.085),
  ...wheel(0.2, -0.085),
  ...wheel(0.025, 0.085),
  ...wheel(0.025, -0.085),
  ...wheel(-0.03, 0.085),
  ...wheel(-0.03, -0.085),
];

const T0 = -0.62; // trailer rear
const T1 = 0.04; // trailer nose
const TL = T1 - T0;
const TC = (T0 + T1) / 2;
const TRAILER: Part[] = [
  box('tarp', [TC, 0.17, 0], [TL, 0.16, 0.21]), // tarp body
  box(DARK, [TC, 0.07, 0], [TL - 0.04, 0.025, 0.12]), // chassis
  box(CHROME, [TC, 0.094, 0.1055], [TL, 0.014, 0.004]), // side rails
  box(CHROME, [TC, 0.094, -0.1055], [TL, 0.014, 0.004]),
  box('stripe', [TC, 0.112, 0.1062], [TL - 0.06, 0.012, 0.002]), // line colour stripe
  box('stripe', [TC, 0.112, -0.1062], [TL - 0.06, 0.012, 0.002]),
  box(DARK, [T0 + 0.004, 0.17, 0], [0.008, 0.15, 0.2]), // rear doors
  box(YELLOW, [T0 - 0.004, 0.062, 0], [0.008, 0.022, 0.2]), // rear bumper
  box(RED, [T0 - 0.002, 0.1, 0.085], [0.006, 0.016, 0.022]), // tail lights
  box(RED, [T0 - 0.002, 0.1, -0.085], [0.006, 0.016, 0.022]),
  box(DARK, [-0.05, 0.05, 0.06], [0.01, 0.05, 0.01]), // landing gear
  box(DARK, [-0.05, 0.05, -0.06], [0.01, 0.05, 0.01]),
  box(DARK, [-0.3, 0.07, 0.085], [0.09, 0.032, 0.02]), // toolbox
  ...wheel(-0.455, 0.085),
  ...wheel(-0.455, -0.085),
  ...wheel(-0.545, 0.085),
  ...wheel(-0.545, -0.085),
];
// Tarp ribs (straps) along both sides.
for (let x = T0 + 0.06; x < T1 - 0.02; x += 0.075) {
  TRAILER.push(box(RIB, [x, 0.17, 0.1052], [0.006, 0.15, 0.002]));
  TRAILER.push(box(RIB, [x, 0.17, -0.1052], [0.006, 0.15, 0.002]));
}

const GEO = { tractor: buildParts(TRACTOR), trailer: buildParts(TRAILER) };

export interface TruckColors {
  cab: string;
  tarp: string;
  /** The line's colour (stripe on the trailer). */
  stripe: string;
}

function Slots({ geo, colors }: { geo: Record<string, THREE.BufferGeometry>; colors: TruckColors }) {
  const mats = useMemo(
    () => ({ paint: paintMat(colors.cab, 0.5), tarp: paintMat(colors.tarp, 0.9), stripe: paintMat(colors.stripe, 0.6), fixed: FIXED_MAT }),
    [colors.cab, colors.tarp, colors.stripe],
  );
  return (
    <>
      {Object.entries(geo).map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k as keyof typeof mats]} castShadow={k !== 'stripe'} />
      ))}
    </>
  );
}

/** The tractor (origin at the fifth wheel, +X forward). */
export const Tractor = forwardRef<THREE.Group, { colors: TruckColors }>(function Tractor({ colors }, ref) {
  return (
    <group ref={ref} rotation-order="YZX">
      <Slots geo={GEO.tractor} colors={colors} />
    </group>
  );
});

/** The trailer (origin at its kingpin = the fifth wheel, +X forward). */
export const Trailer = forwardRef<THREE.Group, { colors: TruckColors }>(function Trailer({ colors }, ref) {
  return (
    <group ref={ref} rotation-order="YZX">
      <Slots geo={GEO.trailer} colors={colors} />
    </group>
  );
});

/**
 * Model viewer: two trucks, one straight and one bending through a turn
 * (scaled up ×3 to the viewer's industry size).
 */
export function TruckPreview() {
  const a: TruckColors = { cab: '#c4532a', tarp: '#5b6f80', stripe: '#e74c3c' };
  const b: TruckColors = { cab: '#2f6fb3', tarp: '#cfcabd', stripe: '#2ecc71' };
  return (
    <group scale={3}>
      <group position={[0.15, 0, -0.17]}>
        <Tractor colors={a} />
        <Trailer colors={a} />
      </group>
      <group position={[0.1, 0, 0.2]}>
        <group rotation-y={0.45}>
          <Tractor colors={b} />
        </group>
        <Trailer colors={b} />
      </group>
    </group>
  );
}
