/**
 * OilRigModel — a detailed, animated low-poly offshore oil platform on a
 * 3×3-cell lot, after the reference art. It stands in the MIDDLE of a lake.
 *
 * Built in CELL UNITS like the other industry models, but its origin (Y = 0)
 * is the WATER SURFACE, not the ground: the caller places it at water level.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - four rusty column legs with orange bands, cross braces with
 *     yellow/black hazard walkways and ladders down to the water;
 *   - the main deck with yellow railings, pipe runs and hanging lifeboats;
 *   - back-left: a two-storey process module (lit windows, roof units,
 *     exhaust stacks, facade piping) with a lattice flare boom and its flame;
 *   - back-right: the drill floor with the tall lattice derrick (platforms,
 *     crown block, guy wires) over orange drilling machinery;
 *   - right: a cantilevered octagonal helipad with a parked helicopter;
 *   - front-left: storage tanks; front-right: crates, containers, pallets;
 *   - two pedestal cranes, one with a crate on its hook;
 *   - supply boats on the water.
 *
 * Performance: all lattice members (derrick, crane booms, flare boom, helipad
 * supports) are ONE InstancedMesh; shared module materials; only the flare
 * glow is emissive, no extra lights. Animations: flare flicker + smoke, stack
 * steam, crane slew, helicopter rotor idling, boats bobbing.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Elbow, Pipe, Steam } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface OilRigModelProps {
  /** World position of the lot centre AT WATER LEVEL. */
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

// --- Materials ---------------------------------------------------------------

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

/** Diagonal yellow/black hazard stripes (walkway edges). */
function hazardTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e2b52c';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#1f1f22';
  for (let x = -16; x < 64; x += 16) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 8, 16);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 8, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(6, 1);
  return t;
}

const M = {
  steel: std('#80838a'),
  steelDark: std('#55585e'),
  steelLight: std('#9a9da2'),
  rust: std('#8e5f3e'),
  band: std('#b5612f'),
  deck: std('#cfc7b9', { roughness: 0.95 }),
  deckEdge: std('#6a6660'),
  module: std('#74777d'),
  moduleDark: std('#686b71'),
  seam: std('#55585c'),
  roofUnit: std('#888b90'),
  window: std('#ffd98a', { emissive: '#ffb84a', emissiveIntensity: 0.9 }),
  door: std('#7a4a2c'),
  yellow: std('#e0b42e'),
  hazard: std('#e0b42e', { map: hazardTexture() }),
  grating: std('#85868a', { roughness: 1 }),
  pipe: std('#6e655d'),
  pipeBlue: std('#3c6db0'),
  valve: std('#c0392b'),
  machine: std('#e08a1e', { emissive: '#7a3d00', emissiveIntensity: 0.35 }),
  tank: std('#878a90'),
  tankTop: std('#76797e'),
  helipad: std('#6a6d71'),
  helipadRim: std('#4f5256'),
  helipadMark: std('#e39a2a'),
  white: std('#e8e6e0'),
  heli: std('#4d5c6e'),
  heliStripe: std('#e2b52c'),
  glass: std('#2d3a46', { roughness: 0.3 }),
  lifeboat: std('#de6a2c'),
  lifeboatTop: std('#efe8dc'),
  crate: std('#a8784a'),
  crateDark: std('#86603c'),
  container1: std('#6d7378'),
  container2: std('#8a5b3c'),
  container3: std('#5f6b5e'),
  hull: std('#7a3e2c'),
  hullTop: std('#575b60'),
  cable: std('#24262a'),
  flame: std('#ffb33a', { emissive: '#ff8a1c', emissiveIntensity: 2.2, transparent: true, opacity: 0.95 }),
  flameCore: std('#fff2b0', { emissive: '#ffd36a', emissiveIntensity: 2.5 }),
  redLight: std('#ff4a3a', { emissive: '#ff2a1a', emissiveIntensity: 1.5 }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

// --- Layout ------------------------------------------------------------------

/** Column legs: centres at (±COL, ±COL). */
const COL = 0.82;
const COL_R = 0.19;
/** Deck: half size, underside and top heights. */
const DECK_HALF = 1.06;
const DECK_BOTTOM = 0.78;
const DECK = 0.92;
/** Cross braces / lower walkways. */
const BRACE_Y = 0.3;
/** Process module (back-left). */
const MOD = { x0: -1.02, x1: -0.14, z0: -1.02, z1: -0.24, h1: 0.42, h2: 0.4 };
/** Drill floor (back-right) and derrick. */
const DRILL = { x0: 0.16, x1: 1.0, z0: -1.0, z1: -0.18, h: 0.4 };
const DERRICK = { x: 0.58, z: -0.59, y0: DECK + DRILL.h, y1: 3.0, base: 0.27, top: 0.075 };
/** Helipad (cantilevered on the right). */
const HELI = { x: 1.2, y: 1.3, z: 0.42, r: 0.36 };

// --- Lattice members (one InstancedMesh) ---------------------------------------

type Seg = [V3, V3, number];

/** Square-section box truss from a to b (side w, n panels). */
function truss(out: Seg[], a: V3, b: V3, w: number, n: number, t = 0.012): void {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const u = B.clone().sub(A).normalize();
  const up = Math.abs(u.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3().crossVectors(u, up).normalize().multiplyScalar(w / 2);
  const nn = new THREE.Vector3().crossVectors(v, u).normalize().multiplyScalar(w / 2);
  const corner = (P: THREE.Vector3, i: number) =>
    P.clone()
      .add(v.clone().multiplyScalar(i & 1 ? 1 : -1))
      .add(nn.clone().multiplyScalar(i & 2 ? 1 : -1));
  const order = [0, 1, 3, 2];
  const P = (k: number) => A.clone().lerp(B, k / n);
  for (let i = 0; i < 4; i++) out.push([corner(A, i).toArray() as V3, corner(B, i).toArray() as V3, t]);
  for (let k = 0; k <= n; k++) {
    for (let i = 0; i < 4; i++) {
      const c0 = corner(P(k), order[i]);
      const c1 = corner(P(k), order[(i + 1) % 4]);
      out.push([c0.toArray() as V3, c1.toArray() as V3, t * 0.8]);
      if (k < n) {
        const d1 = corner(P(k + 1), order[(i + 1) % 4]);
        out.push([c0.toArray() as V3, d1.toArray() as V3, t * 0.7]);
      }
    }
  }
}

/** Tapered 4-leg lattice tower (the derrick), centred on (x, z). */
function tower(out: Seg[], x: number, z: number, y0: number, y1: number, h0: number, h1: number, n: number): void {
  const at = (k: number, sx: number, sz: number): V3 => {
    const f = k / n;
    const h = h0 + (h1 - h0) * f;
    return [x + sx * h, y0 + (y1 - y0) * f, z + sz * h];
  };
  const C: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sz] of C) out.push([at(0, sx, sz), at(n, sx, sz), 0.022]);
  for (let k = 0; k <= n; k++) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = C[i];
      const [bx, bz] = C[(i + 1) % 4];
      out.push([at(k, ax, az), at(k, bx, bz), 0.012]);
      if (k < n) {
        out.push([at(k, ax, az), at(k + 1, bx, bz), 0.009]);
        out.push([at(k, bx, bz), at(k + 1, ax, az), 0.009]);
      }
    }
  }
}

function Lattice({ segs, m }: { segs: Seg[]; m: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const Y = new THREE.Vector3(0, 1, 0);
    segs.forEach(([a, b, t], i) => {
      const A = new THREE.Vector3(...a);
      const B = new THREE.Vector3(...b);
      const d = B.clone().sub(A);
      o.position.copy(A).add(B).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(Y, d.clone().normalize());
      o.scale.set(t, d.length(), t);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [segs]);
  return <instancedMesh ref={ref} args={[BOX, m, segs.length]} castShadow receiveShadow />;
}

/** Thin straight member between two points (cables, rails, ladder sides). */
function Rod({ a, b, t = 0.01, m }: { a: V3; b: V3; t?: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    return {
      pos: A.clone().add(B).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
      len: d.length(),
    };
  }, [a, b]);
  return <mesh geometry={BOX} material={m} position={pos} quaternion={quat} scale={[t, len, t]} />;
}

/** Yellow railing along a straight edge at height y (posts + two rails). */
function Railing({ from, to, y, h = 0.07 }: { from: [number, number]; to: [number, number]; y: number; h?: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const posts = Math.max(2, Math.round(len / 0.16) + 1);
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  return (
    <group position={[cx, y, cz]} rotation={[0, -ang, 0]}>
      <Box p={[0, h, 0]} s={[len, 0.008, 0.008]} m={M.yellow} />
      <Box p={[0, h * 0.55, 0]} s={[len, 0.006, 0.006]} m={M.yellow} />
      {Array.from({ length: posts }).map((_, i) => (
        <Box key={i} p={[-len / 2 + (len * i) / (posts - 1), h / 2, 0]} s={[0.008, h, 0.008]} m={M.yellow} />
      ))}
    </group>
  );
}

/** Vertical ladder (two rails + rungs) on a face, from y0 to y1. */
function Ladder({ p, y0, y1, rotY = 0, w = 0.05 }: { p: [number, number]; y0: number; y1: number; rotY?: number; w?: number }) {
  const h = y1 - y0;
  const rungs = Math.max(3, Math.round(h / 0.04));
  return (
    <group position={[p[0], y0, p[1]]} rotation={[0, rotY, 0]}>
      <Box p={[-w / 2, h / 2, 0]} s={[0.007, h, 0.007]} m={M.steelLight} />
      <Box p={[w / 2, h / 2, 0]} s={[0.007, h, 0.007]} m={M.steelLight} />
      {Array.from({ length: rungs }).map((_, i) => (
        <Box key={i} p={[0, ((i + 0.5) * h) / rungs, 0]} s={[w, 0.005, 0.005]} m={M.steelLight} />
      ))}
    </group>
  );
}

/** Straight stair flight from a (bottom) to b (top), width w. */
function Stairs({ a, b, w = 0.1 }: { a: V3; b: V3; w?: number }) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const run = Math.hypot(dx, dz);
  const rise = b[1] - a[1];
  const len = Math.hypot(run, rise);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(rise, run);
  const steps = Math.max(4, Math.round(rise / 0.035));
  return (
    <group position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} rotation={[0, yaw, 0]}>
      <group rotation={[-pitch, 0, 0]}>
        <Box p={[-w / 2, 0, 0]} s={[0.012, 0.03, len]} m={M.yellow} />
        <Box p={[w / 2, 0, 0]} s={[0.012, 0.03, len]} m={M.yellow} />
        <Box p={[-w / 2, 0.07, 0]} s={[0.006, 0.006, len]} m={M.yellow} />
        <Box p={[w / 2, 0.07, 0]} s={[0.006, 0.006, len]} m={M.yellow} />
      </group>
      {Array.from({ length: steps }).map((_, i) => {
        const f = (i + 0.5) / steps - 0.5;
        return <Box key={i} p={[0, f * rise, f * run]} s={[w, 0.008, 0.035]} m={M.grating} />;
      })}
    </group>
  );
}

/** A row of lit windows along X (face at z) or along Z (face at x). */
function Windows({ n, from, to, y, w = 0.07, h = 0.08, face }: { n: number; from: number; to: number; y: number; w?: number; h?: number; face: { x?: number; z?: number } }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => {
        const t = from + ((to - from) * (i + 0.5)) / n;
        return face.z !== undefined ? (
          <Box key={i} p={[t, y, face.z]} s={[w, h, 0.012]} m={M.window} />
        ) : (
          <Box key={i} p={[face.x!, y, t]} s={[0.012, h, w]} m={M.window} />
        );
      })}
    </>
  );
}

// --- Model ---------------------------------------------------------------------

export function OilRigModel({ position = [0, 0, 0], scale = 1, rotationY = 0, phase = 0 }: OilRigModelProps) {
  const lattice = useMemo(() => {
    const s: Seg[] = [];
    tower(s, DERRICK.x, DERRICK.z, DERRICK.y0, DERRICK.y1, DERRICK.base, DERRICK.top, 8);
    // Flare boom: a cantilever truss out of the module's left side.
    truss(s, [MOD.x0 - 0.02, DECK + 0.18, -0.62], [-1.62, 1.86, -0.3], 0.1, 7);
    // Helipad supports: struts from the deck edge / column up under the pad.
    s.push([[DECK_HALF, DECK - 0.04, HELI.z - 0.25], [HELI.x, HELI.y - 0.03, HELI.z - 0.12], 0.022]);
    s.push([[DECK_HALF, DECK - 0.04, HELI.z + 0.25], [HELI.x, HELI.y - 0.03, HELI.z + 0.12], 0.022]);
    s.push([[COL + 0.12, DECK_BOTTOM - 0.05, COL - 0.05], [HELI.x + 0.18, HELI.y - 0.03, HELI.z + 0.1], 0.022]);
    s.push([[DECK_HALF, HELI.y - 0.03, HELI.z - 0.3], [DECK_HALF, HELI.y - 0.03, HELI.z + 0.3], 0.02]);
    // Lattice crane booms (static parts are added by the cranes themselves).
    return s;
  }, []);

  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Legs />
      <Deck />
      <ProcessModule phase={phase} />
      <DrillFloor />
      <Lattice segs={lattice} m={M.steelDark} />
      <DerrickDetails />
      <FlareTip phase={phase} />
      <Helipad phase={phase} />
      <Tanks />
      <Cargo />
      <Crane p={[-0.05, -0.92]} yaw={-0.6} boom={0.95} lift={0.75} phase={phase} hook />
      <Crane p={[0.05, 0.9]} yaw={2.6} boom={0.7} lift={0.6} phase={phase + 3} />
      <Lifeboats />
      <Boat p={[-1.27, 0.5]} yaw={Math.PI / 2} phase={phase} />
      <Boat p={[1.18, -1.28]} yaw={0} phase={phase + 1.3} />
      <Boat p={[0.3, 1.32]} yaw={0.15} phase={phase + 2.1} small />
    </group>
  );
}

// --- 1. Legs, braces, lower walkways ----------------------------------------------

function Legs() {
  const cols: Array<[number, number]> = [
    [-COL, -COL],
    [COL, -COL],
    [COL, COL],
    [-COL, COL],
  ];
  const span = COL * 2 - COL_R * 2;
  return (
    <group>
      {cols.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh material={M.steel} position={[0, (DECK_BOTTOM - 0.5) / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[COL_R, COL_R * 1.04, DECK_BOTTOM + 0.5, 16]} />
          </mesh>
          {/* Orange bands: at the waterline and mid-height */}
          <mesh material={M.band} position={[0, 0.04, 0]}>
            <cylinderGeometry args={[COL_R + 0.012, COL_R + 0.012, 0.07, 16]} />
          </mesh>
          <mesh material={M.band} position={[0, 0.5, 0]}>
            <cylinderGeometry args={[COL_R + 0.01, COL_R + 0.01, 0.05, 16]} />
          </mesh>
          {/* Rust streaks */}
          <mesh material={M.rust} position={[0, 0.27, 0]}>
            <cylinderGeometry args={[COL_R + 0.004, COL_R + 0.004, 0.12, 16, 1, true, i * 1.3, 1.4]} />
          </mesh>
          <Ladder p={[x > 0 ? COL_R + 0.012 : -COL_R - 0.012, 0]} y0={0.02} y1={DECK_BOTTOM} rotY={Math.PI / 2} />
        </group>
      ))}
      {/* Cross braces between neighbouring columns, with hazard walkways */}
      {[-COL, COL].map((z) => (
        <group key={`x${z}`}>
          <Box p={[0, BRACE_Y, z]} s={[span, 0.07, 0.07]} m={M.steelDark} cast />
          <Box p={[0, BRACE_Y + 0.045, z]} s={[span, 0.012, 0.14]} m={M.grating} />
          <Box p={[0, BRACE_Y + 0.055, z - 0.07]} s={[span, 0.02, 0.008]} m={M.hazard} />
          <Box p={[0, BRACE_Y + 0.055, z + 0.07]} s={[span, 0.02, 0.008]} m={M.hazard} />
          <Railing from={[-span / 2, z + 0.07]} to={[span / 2, z + 0.07]} y={BRACE_Y + 0.05} />
        </group>
      ))}
      {[-COL, COL].map((x) => (
        <group key={`z${x}`}>
          <Box p={[x, BRACE_Y, 0]} s={[0.07, 0.07, span]} m={M.steelDark} cast />
          <Box p={[x, BRACE_Y + 0.045, 0]} s={[0.14, 0.012, span]} m={M.grating} />
          <Box p={[x - 0.07, BRACE_Y + 0.055, 0]} s={[0.008, 0.02, span]} m={M.hazard} />
          <Box p={[x + 0.07, BRACE_Y + 0.055, 0]} s={[0.008, 0.02, span]} m={M.hazard} />
        </group>
      ))}
      {/* Diagonal braces from the walkways up to the deck frame */}
      {[-COL, COL].map((z) => (
        <group key={`d${z}`}>
          <Rod a={[-COL + COL_R, BRACE_Y, z]} b={[-0.1, DECK_BOTTOM, z]} t={0.04} m={M.steelDark} />
          <Rod a={[COL - COL_R, BRACE_Y, z]} b={[0.1, DECK_BOTTOM, z]} t={0.04} m={M.steelDark} />
        </group>
      ))}
      {/* Ladders from the walkways down to the water */}
      <Ladder p={[-0.3, COL + 0.08]} y0={0} y1={BRACE_Y} />
      <Ladder p={[0.35, -COL - 0.08]} y0={0} y1={BRACE_Y} />
      <Ladder p={[COL + 0.08, 0.2]} y0={0} y1={BRACE_Y} rotY={Math.PI / 2} />
    </group>
  );
}

// --- 2. Deck ------------------------------------------------------------------------

function Deck() {
  const e = DECK_HALF;
  return (
    <group>
      {/* Girder frame + deck plate */}
      <Box p={[0, (DECK_BOTTOM + DECK - 0.05) / 2, 0]} s={[e * 2 - 0.04, DECK - 0.05 - DECK_BOTTOM, e * 2 - 0.04]} m={M.deckEdge} cast />
      <Box p={[0, DECK - 0.025, 0]} s={[e * 2, 0.05, e * 2]} m={M.deck} cast />
      {/* Plate seams */}
      {[-0.5, 0, 0.5].map((t) => (
        <group key={t}>
          <Box p={[t, DECK + 0.001, 0]} s={[0.006, 0.002, e * 2 - 0.1]} m={M.grating} />
          <Box p={[0, DECK + 0.001, t]} s={[e * 2 - 0.1, 0.002, 0.006]} m={M.grating} />
        </group>
      ))}
      {/* Big pipe runs along the deck sides */}
      <Pipe from={[-e + 0.05, DECK - 0.12, e + 0.03]} to={[e - 0.05, DECK - 0.12, e + 0.03]} r={0.03} m={M.pipe} />
      <Pipe from={[-e - 0.03, DECK - 0.1, -e + 0.05]} to={[-e - 0.03, DECK - 0.1, e - 0.05]} r={0.028} m={M.pipe} />
      <Pipe from={[-e + 0.05, DECK - 0.12, -e - 0.03]} to={[e - 0.05, DECK - 0.12, -e - 0.03]} r={0.03} m={M.pipe} />
      <Pipe from={[e + 0.03, DECK - 0.1, -e + 0.05]} to={[e + 0.03, DECK - 0.1, e - 0.05]} r={0.026} m={M.pipe} />
      {/* Railings around the deck (gaps at the helipad and the flare boom) */}
      <Railing from={[-e + 0.02, e - 0.02]} to={[e - 0.02, e - 0.02]} y={DECK} />
      <Railing from={[-e + 0.02, -e + 0.02]} to={[e - 0.02, -e + 0.02]} y={DECK} />
      <Railing from={[-e + 0.02, -0.2]} to={[-e + 0.02, e - 0.02]} y={DECK} />
      <Railing from={[e - 0.02, -e + 0.02]} to={[e - 0.02, 0.1]} y={DECK} />
      <Railing from={[e - 0.02, 0.75]} to={[e - 0.02, e - 0.02]} y={DECK} />
      {/* Deck-level pipe runs between the tanks, module and drill floor */}
      <Pipe from={[-0.15, DECK + 0.04, -0.2]} to={[0.12, DECK + 0.04, -0.2]} r={0.022} m={M.pipe} />
      <Pipe from={[-0.15, DECK + 0.04, 0.12]} to={[-0.15, DECK + 0.04, -0.2]} r={0.022} m={M.pipe} />
      <Pipe from={[-0.1, DECK + 0.03, 0.05]} to={[0.6, DECK + 0.03, 0.05]} r={0.018} m={M.pipe} />
      <Elbow p={[-0.06, DECK + 0.12, -0.2]} rot={[Math.PI / 2, 0, Math.PI]} R={0.08} r={0.022} m={M.pipe} />
    </group>
  );
}

// --- 3. Process module + flare -------------------------------------------------------

function ProcessModule({ phase }: { phase: number }) {
  const { x0, x1, z0, z1, h1, h2 } = MOD;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  const y1 = DECK + h1;
  const y2 = y1 + 0.02 + h2;
  return (
    <group>
      {/* Lower storey, ledge walkway, upper storey */}
      <Box p={[cx, DECK + h1 / 2, cz]} s={[w, h1, d]} m={M.module} cast />
      <Box p={[cx + 0.02, y1 + 0.01, cz + 0.02]} s={[w + 0.12, 0.02, d + 0.12]} m={M.grating} cast />
      <Box p={[cx, y1 + 0.02 + h2 / 2, cz]} s={[w - 0.02, h2, d - 0.02]} m={M.moduleDark} cast />
      <Railing from={[x0 - 0.04, z1 + 0.08]} to={[x1 + 0.07, z1 + 0.08]} y={y1 + 0.02} />
      <Railing from={[x1 + 0.08, z0 - 0.04]} to={[x1 + 0.08, z1 + 0.07]} y={y1 + 0.02} />
      {/* Panel seams */}
      {[0.2, 0.4, 0.6].map((f) => (
        <group key={f}>
          <Box p={[x0 + w * f, DECK + h1 / 2, z1 + 0.003]} s={[0.008, h1 - 0.02, 0.004]} m={M.seam} />
          <Box p={[x0 + w * f, y1 + 0.02 + h2 / 2, z1 - 0.007]} s={[0.008, h2 - 0.02, 0.004]} m={M.seam} />
        </group>
      ))}
      {/* Windows + door */}
      <Windows n={5} from={x0 + 0.3} to={x1 - 0.04} y={y1 + 0.22} face={{ z: z1 - 0.004 }} />
      <Windows n={3} from={x0 + 0.5} to={x1 - 0.25} y={DECK + 0.28} face={{ z: z1 + 0.006 }} />
      <Windows n={3} from={z0 + 0.06} to={z1 - 0.06} y={y1 + 0.22} face={{ x: x1 - 0.004 }} />
      <Windows n={2} from={z0 + 0.1} to={z1 - 0.2} y={DECK + 0.22} face={{ x: x1 + 0.006 }} />
      <Box p={[x1 - 0.16, DECK + 0.11, z1 + 0.006]} s={[0.1, 0.2, 0.012]} m={M.door} />
      <Box p={[x0 + 0.18, y1 + 0.13, z1 - 0.004]} s={[0.12, 0.18, 0.012]} m={M.door} />
      {/* Louvre vents */}
      <Box p={[x0 + 0.42, DECK + 0.24, z1 + 0.005]} s={[0.16, 0.08, 0.01]} m={M.seam} />
      {/* Roof: parapet, HVAC boxes, fans, exhaust stacks */}
      <Box p={[cx, y2 + 0.015, z0 + 0.02]} s={[w - 0.02, 0.03, 0.02]} m={M.module} />
      <Box p={[cx, y2 + 0.015, z1 - 0.03]} s={[w - 0.02, 0.03, 0.02]} m={M.module} />
      <Box p={[cx - 0.18, y2 + 0.05, cz - 0.1]} s={[0.26, 0.1, 0.2]} m={M.roofUnit} cast />
      <Box p={[cx + 0.14, y2 + 0.04, cz + 0.12]} s={[0.2, 0.08, 0.16]} m={M.roofUnit} cast />
      {[
        [cx - 0.22, cz + 0.17],
        [cx + 0.2, cz - 0.15],
      ].map(([x, z], i) => (
        <group key={i}>
          <mesh material={M.roofUnit} position={[x, y2 + 0.035, z]} castShadow>
            <cylinderGeometry args={[0.075, 0.08, 0.07, 14]} />
          </mesh>
          <mesh material={M.seam} position={[x, y2 + 0.071, z]}>
            <cylinderGeometry args={[0.055, 0.055, 0.004, 14]} />
          </mesh>
        </group>
      ))}
      {[x1 - 0.12, x1 - 0.22].map((x, i) => (
        <mesh key={i} material={M.steelDark} position={[x, y2 + 0.16, z0 + 0.12]} castShadow>
          <cylinderGeometry args={[0.028, 0.028, 0.32, 10]} />
        </mesh>
      ))}
      <Steam origin={[x1 - 0.17, y2 + 0.34, z0 + 0.12]} count={4} rise={0.5} spread={0.08} size={0.05} color="#9a9ca0" phase={phase + 0.8} />
      {/* Facade piping: blue risers with red valve wheels on the front */}
      {[x0 + 0.08, x0 + 0.16].map((x, i) => (
        <group key={i}>
          <Pipe from={[x, DECK, z1 + 0.035]} to={[x, y1 - 0.02, z1 + 0.035]} r={0.018} m={M.pipeBlue} />
          <mesh material={M.valve} position={[x, DECK + 0.14 + i * 0.06, z1 + 0.06]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.025, 0.006, 6, 12]} />
          </mesh>
        </group>
      ))}
      <Elbow p={[x0 + 0.08, y1 - 0.02 - 0.06, z1 + 0.035]} rot={[0, 0, Math.PI / 2]} R={0.06} r={0.018} m={M.pipeBlue} />
      {/* Big rusty bends on the left face */}
      <Pipe from={[x0 - 0.04, DECK, z0 + 0.15]} to={[x0 - 0.04, y1 + 0.18, z0 + 0.15]} r={0.03} m={M.pipe} />
      <Pipe from={[x0 - 0.04, DECK, z0 + 0.3]} to={[x0 - 0.04, y1 - 0.1, z0 + 0.3]} r={0.03} m={M.pipe} />
      <Elbow p={[x0 - 0.04, y1 + 0.18, z0 + 0.15 + 0.08]} rot={[0, Math.PI / 2, 0]} R={0.08} r={0.03} m={M.pipe} />
      {/* Stair from the deck up to the ledge */}
      <Stairs a={[x1 + 0.12, DECK, z1 + 0.42]} b={[x1 + 0.12, y1 + 0.02, z1 + 0.1]} />
    </group>
  );
}

/** Flare tip at the end of the boom: two nozzles, a flickering flame, smoke. */
function FlareTip({ phase }: { phase: number }) {
  const flame = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.getElapsedTime() * 9 + phase * 3;
    const g = flame.current;
    if (!g) return;
    const k = 1 + Math.sin(t) * 0.12 + Math.sin(t * 2.3) * 0.08;
    g.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
  });
  const T: V3 = [-1.62, 1.86, -0.3];
  return (
    <group position={T}>
      <Box p={[0, 0.0, 0]} s={[0.2, 0.025, 0.14]} m={M.steelDark} />
      <Railing from={[-0.1, 0.07]} to={[0.1, 0.07]} y={0.01} h={0.04} />
      {[-0.04, 0.04].map((x) => (
        <mesh key={x} material={M.steelDark} position={[x, 0.08, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.03, 0.15, 10]} />
        </mesh>
      ))}
      <group ref={flame} position={[0, 0.16, 0]}>
        <mesh material={M.flame} position={[0, 0.09, 0]}>
          <coneGeometry args={[0.075, 0.22, 7]} />
        </mesh>
        <mesh material={M.flameCore} position={[0, 0.05, 0]}>
          <icosahedronGeometry args={[0.045, 0]} />
        </mesh>
      </group>
      <Steam origin={[0, 0.32, 0]} count={6} rise={0.7} spread={0.12} size={0.06} color="#8b8d91" phase={phase} />
    </group>
  );
}

// --- 4. Drill floor + derrick --------------------------------------------------------

function DrillFloor() {
  const { x0, x1, z0, z1, h } = DRILL;
  const top = DECK + h;
  return (
    <group>
      {/* Two cabins either side of the open centre */}
      <Box p={[x0 + 0.15, DECK + h / 2, (z0 + z1) / 2]} s={[0.3, h, z1 - z0]} m={M.module} cast />
      <Box p={[x1 - 0.13, DECK + h / 2, (z0 + z1) / 2]} s={[0.26, h, z1 - z0]} m={M.module} cast />
      <Windows n={2} from={x0 + 0.03} to={x0 + 0.27} y={DECK + h - 0.12} face={{ z: z1 + 0.006 }} />
      <Windows n={2} from={x1 - 0.24} to={x1 - 0.02} y={DECK + h - 0.12} face={{ z: z1 + 0.006 }} />
      <Windows n={3} from={z0 + 0.08} to={z1 - 0.08} y={DECK + h - 0.12} face={{ x: x1 + 0.006 }} />
      {/* Open centre: legs + glowing orange drawworks */}
      {[
        [x0 + 0.32, z0 + 0.05],
        [x1 - 0.28, z0 + 0.05],
        [x0 + 0.32, z1 - 0.05],
        [x1 - 0.28, z1 - 0.05],
      ].map(([x, z], i) => (
        <Box key={i} p={[x, DECK + h / 2, z]} s={[0.04, h, 0.04]} m={M.steelDark} cast />
      ))}
      <Box p={[DERRICK.x, DECK + 0.1, DERRICK.z + 0.05]} s={[0.22, 0.2, 0.3]} m={M.machine} cast />
      <mesh material={M.machine} position={[DERRICK.x, DECK + 0.24, DERRICK.z - 0.06]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.2, 14]} />
      </mesh>
      <Box p={[DERRICK.x, DECK + 0.07, DERRICK.z + 0.25]} s={[0.12, 0.14, 0.08]} m={M.machine} />
      {/* Drill floor plate on top, with railings */}
      <Box p={[(x0 + x1) / 2, top + 0.015, (z0 + z1) / 2]} s={[x1 - x0 + 0.04, 0.03, z1 - z0 + 0.04]} m={M.grating} cast />
      <Railing from={[x0 - 0.01, z1 + 0.01]} to={[x1 + 0.01, z1 + 0.01]} y={top + 0.03} />
      <Railing from={[x1 + 0.01, z0 - 0.01]} to={[x1 + 0.01, z1 + 0.01]} y={top + 0.03} />
      <Railing from={[x0 - 0.01, z0 - 0.01]} to={[x1 + 0.01, z0 - 0.01]} y={top + 0.03} />
      {/* Stairs up from the deck (front) */}
      <Stairs a={[x0 + 0.08, DECK, z1 + 0.42]} b={[x0 + 0.08, top + 0.03, z1 + 0.03]} />
      <Stairs a={[x1 - 0.06, DECK, z1 + 0.36]} b={[x1 - 0.06, top + 0.03, z1 + 0.03]} />
      {/* Small doghouse on the floor */}
      <Box p={[x1 - 0.14, top + 0.1, z0 + 0.14]} s={[0.18, 0.16, 0.16]} m={M.moduleDark} cast />
      <Windows n={2} from={x1 - 0.22} to={x1 - 0.06} y={top + 0.12} face={{ z: z0 + 0.225 }} w={0.05} h={0.05} />
    </group>
  );
}

function DerrickDetails() {
  const { x, z, y0, y1, base, top } = DERRICK;
  const at = (f: number) => base + (top - base) * f;
  const ym = y0 + (y1 - y0) * 0.55;
  const hm = at(0.55);
  return (
    <group>
      {/* Monkey board platform half-way up, and the crown platform */}
      <Box p={[x, ym, z]} s={[hm * 2 + 0.16, 0.015, hm * 2 + 0.16]} m={M.grating} />
      <Railing from={[x - hm - 0.08, z + hm + 0.08]} to={[x + hm + 0.08, z + hm + 0.08]} y={ym} h={0.05} />
      <Railing from={[x + hm + 0.08, z - hm - 0.08]} to={[x + hm + 0.08, z + hm + 0.08]} y={ym} h={0.05} />
      <Railing from={[x - hm - 0.08, z - hm - 0.08]} to={[x + hm + 0.08, z - hm - 0.08]} y={ym} h={0.05} />
      <Railing from={[x - hm - 0.08, z - hm - 0.08]} to={[x - hm - 0.08, z + hm + 0.08]} y={ym} h={0.05} />
      <Box p={[x, y1, z]} s={[top * 2 + 0.12, 0.02, top * 2 + 0.12]} m={M.grating} />
      <Railing from={[x - top - 0.06, z + top + 0.06]} to={[x + top + 0.06, z + top + 0.06]} y={y1} h={0.045} />
      <Railing from={[x + top + 0.06, z - top - 0.06]} to={[x + top + 0.06, z + top + 0.06]} y={y1} h={0.045} />
      {/* Crown block + aviation light */}
      <Box p={[x, y1 + 0.07, z]} s={[0.1, 0.1, 0.12]} m={M.steelDark} cast />
      <Box p={[x, y1 + 0.16, z]} s={[0.04, 0.08, 0.04]} m={M.steelDark} />
      <mesh material={M.redLight} position={[x, y1 + 0.21, z]}>
        <sphereGeometry args={[0.018, 8, 6]} />
      </mesh>
      {/* Ladder up the front leg */}
      <Rod a={[x + base - 0.02, y0, z + base + 0.03]} b={[x + top - 0.01, y1, z + top + 0.03]} t={0.008} m={M.yellow} />
      <Rod a={[x + base - 0.08, y0, z + base + 0.03]} b={[x + top - 0.06, y1, z + top + 0.03]} t={0.008} m={M.yellow} />
      {/* Travelling block on its lines + guy wires to the deck corners */}
      <Rod a={[x, y1, z]} b={[x, y0 + 0.5, z]} t={0.006} m={M.cable} />
      <Box p={[x, y0 + 0.48, z]} s={[0.06, 0.08, 0.05]} m={M.machine} />
      <Rod a={[x - top, y1 - 0.05, z - top]} b={[DRILL.x0, DECK + DRILL.h, DRILL.z0]} t={0.005} m={M.cable} />
      <Rod a={[x + top, y1 - 0.05, z - top]} b={[DRILL.x1, DECK + DRILL.h, DRILL.z0]} t={0.005} m={M.cable} />
      <Rod a={[x + top, y1 - 0.05, z + top]} b={[DECK_HALF - 0.05, DECK, 0.3]} t={0.005} m={M.cable} />
      <Rod a={[x - top, y1 - 0.05, z + top]} b={[-0.1, DECK, 0.2]} t={0.005} m={M.cable} />
    </group>
  );
}

// --- 5. Helipad -------------------------------------------------------------------------

function Helipad({ phase }: { phase: number }) {
  const rotor = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (rotor.current) rotor.current.rotation.y = s.clock.getElapsedTime() * 0.6 + phase;
  });
  const { x, y, z, r } = HELI;
  return (
    <group position={[x, y, z]}>
      {/* Octagonal pad with a dark rim and a safety-net ring */}
      <mesh material={M.helipadRim} position={[0, -0.02, 0]} rotation={[0, Math.PI / 8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r + 0.04, r + 0.04, 0.03, 8]} />
      </mesh>
      <mesh material={M.helipad} position={[0, 0.0, 0]} rotation={[0, Math.PI / 8, 0]} receiveShadow>
        <cylinderGeometry args={[r, r, 0.012, 8]} />
      </mesh>
      <mesh material={M.helipadMark} position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.55, r * 0.66, 32]} />
      </mesh>
      {/* "H" */}
      <Box p={[-0.07, 0.008, 0]} s={[0.025, 0.002, 0.16]} m={M.white} />
      <Box p={[0.07, 0.008, 0]} s={[0.025, 0.002, 0.16]} m={M.white} />
      <Box p={[0, 0.008, 0]} s={[0.12, 0.002, 0.025]} m={M.white} />
      {/* Rim posts */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <Box key={i} p={[Math.cos(a) * (r + 0.03), 0.02, Math.sin(a) * (r + 0.03)]} s={[0.012, 0.05, 0.012]} m={M.steelLight} />;
      })}
      {/* Parked helicopter */}
      <group position={[0.02, 0.012, 0.0]} rotation={[0, -0.6, 0]}>
        <Box p={[0, 0.05, 0]} s={[0.17, 0.08, 0.08]} m={M.heli} cast />
        <Box p={[0.06, 0.06, 0]} s={[0.06, 0.06, 0.082]} m={M.glass} />
        <Box p={[0, 0.05, 0]} s={[0.172, 0.012, 0.082]} m={M.heliStripe} />
        <Box p={[-0.15, 0.065, 0]} s={[0.16, 0.025, 0.02]} m={M.heli} />
        <Box p={[-0.225, 0.09, 0]} s={[0.03, 0.05, 0.008]} m={M.heli} />
        <Box p={[0, 0.005, 0.035]} s={[0.17, 0.008, 0.008]} m={M.steelDark} />
        <Box p={[0, 0.005, -0.035]} s={[0.17, 0.008, 0.008]} m={M.steelDark} />
        <group ref={rotor} position={[0, 0.1, 0]}>
          <Box p={[0, 0, 0]} s={[0.36, 0.005, 0.016]} m={M.steelDark} />
          <Box p={[0, 0, 0]} s={[0.016, 0.005, 0.36]} m={M.steelDark} />
        </group>
      </group>
    </group>
  );
}

// --- 6. Tanks, cargo, lifeboats ------------------------------------------------------------

function Tanks() {
  const tanks: Array<[number, number, number, number]> = [
    [-0.78, 0.2, 0.15, 0.44],
    [-0.44, 0.24, 0.15, 0.4],
    [-0.8, 0.58, 0.15, 0.4],
    [-0.46, 0.62, 0.16, 0.46],
    [-0.14, 0.42, 0.13, 0.34],
  ];
  return (
    <group>
      {tanks.map(([x, z, r, h], i) => (
        <group key={i} position={[x, DECK, z]}>
          <mesh material={M.tank} position={[0, h / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[r, r, h, 18]} />
          </mesh>
          <mesh material={M.tankTop} position={[0, h, 0]} castShadow>
            <cylinderGeometry args={[r * 0.6, r, 0.04, 18]} />
          </mesh>
          <mesh material={M.rust} position={[0, h * 0.35, 0]}>
            <cylinderGeometry args={[r + 0.003, r + 0.003, h * 0.25, 18, 1, true, i * 1.7, 1.2]} />
          </mesh>
          <Ladder p={[0, r + 0.01]} y0={0} y1={h} w={0.04} />
        </group>
      ))}
      <Pipe from={[-0.78, DECK + 0.06, 0.38]} to={[-0.44, DECK + 0.06, 0.38]} r={0.018} m={M.pipe} />
      <Pipe from={[-0.62, DECK + 0.06, 0.2]} to={[-0.62, DECK + 0.06, 0.62]} r={0.018} m={M.pipe} />
    </group>
  );
}

function Cargo() {
  const crates: Array<[number, number, number, number, THREE.Material]> = [
    [0.35, 0.3, 0.1, 0.08, M.crate],
    [0.47, 0.3, 0.08, 0.08, M.crateDark],
    [0.41, 0.3, 0.07, 0.15, M.crate],
    [0.62, 0.22, 0.1, 0.07, M.crate],
    [0.86, 0.75, 0.09, 0.09, M.crateDark],
    [0.75, 0.82, 0.08, 0.06, M.crate],
    [-0.08, 0.82, 0.08, 0.08, M.crate],
    [0.02, 0.85, 0.07, 0.06, M.crateDark],
    [-0.95, 0.92, 0.07, 0.06, M.crate],
    [0.9, -0.08, 0.08, 0.07, M.crate],
  ];
  const containers: Array<[number, number, number, THREE.Material]> = [
    [0.66, 0.5, 0, M.container1],
    [0.88, 0.47, Math.PI / 2, M.container2],
    [0.36, 0.62, 0, M.container3],
  ];
  return (
    <group>
      {crates.map(([x, z, s, h, m], i) => (
        <Box key={i} p={[x, DECK + h / 2, z]} s={[s, h, s]} m={m} cast />
      ))}
      {containers.map(([x, z, rot, m], i) => (
        <group key={i} position={[x, DECK, z]} rotation={[0, rot, 0]}>
          <Box p={[0, 0.06, 0]} s={[0.22, 0.12, 0.11]} m={m} cast />
          {[-0.08, -0.03, 0.02, 0.07].map((t) => (
            <Box key={t} p={[t, 0.06, 0.056]} s={[0.006, 0.11, 0.004]} m={M.seam} />
          ))}
        </group>
      ))}
      {/* Pallets with stacked pipes */}
      {[
        [0.15, 0.62],
        [0.2, 0.28],
      ].map(([x, z], i) => (
        <group key={i} position={[x, DECK, z]}>
          <Box p={[0, 0.01, 0]} s={[0.16, 0.02, 0.12]} m={M.crateDark} />
          {[-0.035, 0, 0.035].map((t) => (
            <mesh key={t} material={M.pipe} position={[0, 0.04, t]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.016, 0.016, 0.16, 8]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Gas bottles */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} material={M.pipeBlue} position={[0.96, DECK + 0.05, 0.2 + i * 0.04]}>
          <cylinderGeometry args={[0.015, 0.015, 0.1, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function Lifeboats() {
  const spots: Array<[number, number, number]> = [
    [-0.45, DECK_HALF + 0.09, 0],
    [0.5, DECK_HALF + 0.09, 0],
    [-DECK_HALF - 0.09, -0.85, Math.PI / 2],
  ];
  return (
    <group>
      {spots.map(([x, z, rot], i) => (
        <group key={i} position={[x, DECK - 0.16, z]} rotation={[0, rot, 0]}>
          <mesh material={M.lifeboat} scale={[0.2, 0.06, 0.08]} castShadow>
            <sphereGeometry args={[0.5, 10, 6]} />
          </mesh>
          <Box p={[0, 0.03, 0]} s={[0.14, 0.03, 0.06]} m={M.lifeboatTop} />
          {/* Davits */}
          {[-0.08, 0.08].map((t) => (
            <group key={t}>
              <Box p={[t, 0.13, -0.05]} s={[0.012, 0.22, 0.012]} m={M.steelLight} />
              <Rod a={[t, 0.24, -0.05]} b={[t, 0.03, 0]} t={0.004} m={M.cable} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

// --- 7. Cranes -----------------------------------------------------------------------------

function Crane({
  p,
  yaw,
  boom,
  lift,
  phase,
  hook = false,
}: {
  p: [number, number];
  yaw: number;
  boom: number;
  lift: number;
  phase: number;
  hook?: boolean;
}) {
  const slew = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (slew.current) slew.current.rotation.y = yaw + Math.sin(s.clock.getElapsedTime() * 0.12 + phase) * 0.5;
  });
  const PED = 0.36;
  const tip: V3 = [boom * Math.cos(lift), 0.08 + boom * Math.sin(lift), 0];
  const segs = useMemo(() => {
    const out: Seg[] = [];
    truss(out, [0.05, 0.08, 0], tip, 0.06, 6, 0.008);
    return out;
  }, [tip[0], tip[1]]);
  return (
    <group position={[p[0], DECK, p[1]]}>
      <mesh material={M.steel} position={[0, PED / 2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.065, PED, 12]} />
      </mesh>
      <group ref={slew} position={[0, PED, 0]} rotation={[0, yaw, 0]}>
        <Box p={[-0.02, 0.05, 0]} s={[0.14, 0.1, 0.1]} m={M.module} cast />
        <Box p={[0.04, 0.06, 0.051]} s={[0.04, 0.04, 0.004]} m={M.window} />
        <Box p={[-0.08, 0.13, 0]} s={[0.04, 0.12, 0.04]} m={M.steelDark} />
        <Lattice segs={segs} m={M.steelDark} />
        <Rod a={[-0.08, 0.19, 0]} b={tip} t={0.004} m={M.cable} />
        {hook && (
          <>
            <Rod a={tip} b={[tip[0], tip[1] - 0.4, 0]} t={0.004} m={M.cable} />
            <Box p={[tip[0], tip[1] - 0.44, 0]} s={[0.09, 0.07, 0.09]} m={M.crate} cast />
          </>
        )}
      </group>
    </group>
  );
}

// --- 8. Supply boats ------------------------------------------------------------------------

function Boat({ p, yaw, phase, small = false }: { p: [number, number]; yaw: number; phase: number; small?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.getElapsedTime() + phase;
    const g = ref.current;
    if (!g) return;
    g.position.y = Math.sin(t * 1.3) * 0.006;
    g.rotation.z = Math.sin(t * 1.1) * 0.03;
    g.rotation.x = Math.sin(t * 0.9) * 0.02;
  });
  const k = small ? 1 : 1.35;
  return (
    <group position={[p[0], 0, p[1]]} rotation={[0, yaw, 0]} scale={k}>
      <group ref={ref}>
        {/* Hull: red below the waterline band, dark grey above; pointed bow */}
        <Box p={[-0.05, 0.01, 0]} s={[0.36, 0.06, 0.17]} m={M.hull} cast />
        <Box p={[-0.05, 0.055, 0]} s={[0.36, 0.03, 0.17]} m={M.hullTop} />
        {/* Bow: a box turned 45° so its corner makes the point */}
        <group position={[0.13, 0, 0]} rotation={[0, Math.PI / 4, 0]}>
          <Box p={[0, 0.01, 0]} s={[0.12, 0.06, 0.12]} m={M.hull} cast />
          <Box p={[0, 0.055, 0]} s={[0.12, 0.03, 0.12]} m={M.hullTop} />
        </group>
        <Box p={[-0.03, 0.075, 0]} s={[0.4, 0.01, 0.15]} m={M.deck} />
        {/* Bridge, windows, mast */}
        <Box p={[0.08, 0.12, 0]} s={[0.11, 0.08, 0.11]} m={M.white} cast />
        <Box p={[0.1, 0.18, 0]} s={[0.08, 0.05, 0.1]} m={M.white} />
        <Box p={[0.141, 0.18, 0]} s={[0.004, 0.025, 0.08]} m={M.glass} />
        <Box p={[0.08, 0.24, 0]} s={[0.008, 0.08, 0.008]} m={M.steelDark} />
        <Box p={[0.08, 0.27, 0]} s={[0.008, 0.008, 0.05]} m={M.steelDark} />
        {/* Cargo on the aft deck */}
        <Box p={[-0.12, 0.1, 0.03]} s={[0.07, 0.04, 0.05]} m={M.container2} />
        <Box p={[-0.17, 0.1, -0.03]} s={[0.06, 0.04, 0.05]} m={M.crate} />
      </group>
    </group>
  );
}
