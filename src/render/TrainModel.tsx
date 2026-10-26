/**
 * TrainModel — a diesel locomotive and the freight wagons (low-poly):
 *
 *   - Locomotive: a road-switcher (long hood, cab, short nose), yellow
 *     walkway stripe and handrails; body colour per train, the line's colour
 *     as a band under the cab windows;
 *   - wagons by cargo: hopper (ore), tank (oil), boxcar (goods), stake flat
 *     car (logs / planks). Loaded or empty: the load is its own mesh.
 *
 * Units: cells, sized to the trucks. Origin: the car's centre at RAIL-TOP
 * height, +X forward. Every car is CAR_LEN long (the loco LOCO_LEN), its
 * bogies BOGIE_OFF from the centre — a renderer places each car by putting
 * its two bogies on the track.
 */

import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import {
  box,
  buildParts,
  cyl,
  FIXED_MAT,
  paintMat,
  type Part,
} from "./lowPoly";
import type { Item } from "../sim";

export const LOCO_LEN = 1.35;
export const CAR_LEN = 1.15;
/** Bogie centres from a car's centre (loco / wagon). */
export const LOCO_BOGIE = 0.44;
export const CAR_BOGIE = 0.38;
/** Gap between two cars' buffers. */
export const CAR_GAP = 0.06;
/** Track half-gauge (the wheels sit on the rails; see Rails.tsx). */
export const HALF_GAUGE = 0.075;

export type WagonKind = "hopper" | "tank" | "box" | "flat";

/** Which wagon carries what. */
export const WAGON_FOR: Record<Item, WagonKind> = {
  ore: "hopper",
  crushed: "hopper",
  oil: "tank",
  goods: "box",
  log: "flat",
  plank: "flat",
};

/** Locomotive body colours (a train's pick depends on its id). */
export const LOCO_COLORS = [
  "#2f4b57",
  "#6b2a24",
  "#2c3e2f",
  "#3a3f4a",
  "#5a4a2a",
  "#1f3354",
];

const DARK = "#25272b";
const STEEL = "#4a4f55";
const WHEEL = "#2e3033";
const YELLOW = "#e2b42a";
const GLASS = "#1d2730";
const LAMP = "#fff1b0";
const RED = "#c8261e";
const RUST = "#6a4b37";
const RUST_D = "#4e3829";
const TANKC = "#5f6a72";
const BOXC = "#5d5248";
const WOOD = "#b98a52";
const PLANK = "#e0b06a";
const LOGEND = "#d9b98a";

// ---------------------------------------------------------------- running gear

/** Two-axle bogie centred at x (wheels on the rails). */
function bogie(x: number): Part[] {
  const r = 0.034;
  const out: Part[] = [box(DARK, [x, 0.05, 0], [0.22, 0.03, 0.2])];
  for (const dx of [-0.06, 0.06])
    for (const z of [-HALF_GAUGE, HALF_GAUGE])
      out.push(cyl(WHEEL, "z", [x + dx, r, z], r, 0.018, 10));
  // Side frames.
  for (const z of [-0.1, 0.1])
    out.push(box(STEEL, [x, 0.045, z], [0.2, 0.035, 0.012]));
  return out;
}

/** Coupler + two buffers at a car end (sign = +1 front / −1 back). */
function carEnd(halfLen: number, sign: number, y = 0.09): Part[] {
  const x = sign * halfLen;
  return [
    box(DARK, [x + sign * 0.02, y, 0], [0.04, 0.025, 0.035]),
    cyl(STEEL, "x", [x + sign * 0.015, y, 0.08], 0.014, 0.03, 8),
    cyl(STEEL, "x", [x + sign * 0.015, y, -0.08], 0.014, 0.03, 8),
  ];
}

/** Underframe for a wagon: frame beam, bogies, ends. */
function underframe(len: number): Part[] {
  return [
    box(DARK, [0, 0.085, 0], [len - 0.04, 0.03, 0.24]),
    ...bogie(-CAR_BOGIE),
    ...bogie(CAR_BOGIE),
    ...carEnd(len / 2, 1),
    ...carEnd(len / 2, -1),
  ];
}

// ---------------------------------------------------------------- locomotive

const LOCO: Part[] = (() => {
  const L = LOCO_LEN;
  const h = L / 2;
  const p: Part[] = [
    // Frame + walkway, yellow edge stripe
    box(DARK, [0, 0.105, 0], [L - 0.02, 0.035, 0.27]),
    box(YELLOW, [0, 0.105, 0.1355], [L - 0.04, 0.02, 0.002]),
    box(YELLOW, [0, 0.105, -0.1355], [L - 0.04, 0.02, 0.002]),
    // Long hood (rear), cab, short nose (front)
    box("paint", [-0.2, 0.22, 0], [0.86, 0.2, 0.18]),
    box("paint", [0.33, 0.27, 0], [0.2, 0.3, 0.25]),
    box(DARK, [0.33, 0.425, 0], [0.22, 0.012, 0.26]), // cab roof
    box("paint", [0.535, 0.19, 0], [0.21, 0.14, 0.18]),
    // Nose stripes
    box(YELLOW, [0.6405, 0.2, 0], [0.002, 0.018, 0.17]),
    box(YELLOW, [0.6405, 0.165, 0], [0.002, 0.018, 0.17]),
    // Line colour band under the cab windows
    box("stripe", [0.33, 0.29, 0.1255], [0.18, 0.02, 0.002]),
    box("stripe", [0.33, 0.29, -0.1255], [0.18, 0.02, 0.002]),
    // Cab windows
    box(GLASS, [0.4305, 0.355, 0.06], [0.002, 0.06, 0.08]),
    box(GLASS, [0.4305, 0.355, -0.06], [0.002, 0.06, 0.08]),
    box(GLASS, [0.33, 0.355, 0.1255], [0.12, 0.06, 0.002]),
    box(GLASS, [0.33, 0.355, -0.1255], [0.12, 0.06, 0.002]),
    box(GLASS, [0.2295, 0.355, 0.08], [0.002, 0.05, 0.05]),
    box(GLASS, [0.2295, 0.355, -0.08], [0.002, 0.05, 0.05]),
    // Headlights (front of the nose, top of the cab, rear of the hood)
    box(LAMP, [0.6415, 0.24, 0.035], [0.003, 0.018, 0.018]),
    box(LAMP, [0.6415, 0.24, -0.035], [0.003, 0.018, 0.018]),
    box(LAMP, [0.4315, 0.405, 0], [0.003, 0.016, 0.03]),
    box(RED, [-0.6315, 0.3, 0.05], [0.003, 0.016, 0.016]),
    box(RED, [-0.6315, 0.3, -0.05], [0.003, 0.016, 0.016]),
    // Hood: radiator grilles, roof fans, exhaust stacks, side doors
    box(DARK, [-0.5, 0.25, 0.0905], [0.16, 0.08, 0.002]),
    box(DARK, [-0.5, 0.25, -0.0905], [0.16, 0.08, 0.002]),
    cyl(DARK, "y", [-0.5, 0.325, 0], 0.045, 0.012, 12),
    cyl(DARK, "y", [-0.36, 0.325, 0], 0.045, 0.012, 12),
    cyl(DARK, "y", [-0.05, 0.35, 0.02], 0.014, 0.05, 8),
    cyl(DARK, "y", [-0.01, 0.35, -0.02], 0.014, 0.05, 8),
    // Fuel tank between the bogies
    box(DARK, [0, 0.06, 0], [0.42, 0.05, 0.2]),
    ...bogie(-LOCO_BOGIE),
    ...bogie(LOCO_BOGIE),
    ...carEnd(h, 1, 0.1),
    ...carEnd(h, -1, 0.1),
    // Pilots (snowplough plates)
    box(DARK, [h - 0.02, 0.055, 0], [0.03, 0.05, 0.22]),
    box(DARK, [-h + 0.02, 0.055, 0], [0.03, 0.05, 0.22]),
  ];
  // Handrails along the walkway (yellow), with posts.
  for (const z of [-0.125, 0.125]) {
    p.push(box(YELLOW, [-0.2, 0.2, z], [0.9, 0.008, 0.008]));
    for (let x = -0.62; x <= 0.23; x += 0.17)
      p.push(box(YELLOW, [x, 0.16, z], [0.008, 0.08, 0.008]));
    p.push(box(YELLOW, [0.6, 0.16, z], [0.008, 0.08, 0.008]));
  }
  // End railings (front and back platforms).
  for (const x of [h - 0.03, -h + 0.03])
    p.push(box(YELLOW, [x, 0.2, 0], [0.008, 0.008, 0.25]));
  return p;
})();

// ---------------------------------------------------------------- wagons

const HOPPER: Part[] = (() => {
  const L = CAR_LEN;
  const p: Part[] = [
    ...underframe(L),
    // Open box with sloped ends (the hopper chutes)
    box("paint", [0, 0.27, 0], [L - 0.1, 0.16, 0.26]),
    box("paint", [L / 2 - 0.15, 0.15, 0], [0.18, 0.1, 0.22], [0, 0, 0.6]),
    box("paint", [-(L / 2 - 0.15), 0.15, 0], [0.18, 0.1, 0.22], [0, 0, -0.6]),
    box(RUST_D, [0, 0.13, 0], [0.5, 0.08, 0.2]), // discharge gates
    // Top rim
    box(RUST_D, [0, 0.355, 0.128], [L - 0.08, 0.012, 0.012]),
    box(RUST_D, [0, 0.355, -0.128], [L - 0.08, 0.012, 0.012]),
  ];
  // Side posts and X braces
  for (const z of [-0.131, 0.131]) {
    for (let k = -2; k <= 2; k++)
      p.push(box(RUST_D, [k * 0.25, 0.27, z], [0.016, 0.16, 0.004]));
    for (const cx of [-0.375, -0.125, 0.125, 0.375]) {
      p.push(box(RUST_D, [cx, 0.27, z], [0.28, 0.008, 0.003], [0, 0, 0.55]));
      p.push(box(RUST_D, [cx, 0.27, z], [0.28, 0.008, 0.003], [0, 0, -0.55]));
    }
  }
  return p;
})();

/** Ore heap: lumpy rocks filling the hopper. */
const ORE_LOAD: Part[] = (() => {
  const p: Part[] = [box("load", [0, 0.33, 0], [CAR_LEN - 0.14, 0.04, 0.24])];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 22; i++) {
    const x = (rnd() - 0.5) * (CAR_LEN - 0.22);
    const z = (rnd() - 0.5) * 0.18;
    const r = 0.035 + rnd() * 0.03;
    p.push({
      mat: "load",
      shape: "rock",
      pos: [x, 0.35 + rnd() * 0.02, z],
      size: [r * 1.2, r, r],
      rot: [rnd() * 3, rnd() * 3, rnd() * 3],
    });
  }
  return p;
})();

const TANK: Part[] = (() => {
  const L = CAR_LEN;
  const p: Part[] = [
    ...underframe(L),
    cyl("paint", "x", [0, 0.235, 0], 0.115, L - 0.14, 14),
    cyl("paint", "x", [L / 2 - 0.07, 0.235, 0], 0.1, 0.03, 14), // rounded ends
    cyl("paint", "x", [-(L / 2 - 0.07), 0.235, 0], 0.1, 0.03, 14),
    cyl(DARK, "y", [0, 0.36, 0], 0.035, 0.03, 10), // dome
    box(STEEL, [0, 0.355, 0], [0.22, 0.008, 0.14]), // walkway grating
    // Saddles holding the barrel on the frame
    box(DARK, [-0.36, 0.13, 0], [0.04, 0.06, 0.2]),
    box(DARK, [0.36, 0.13, 0], [0.04, 0.06, 0.2]),
    // Ladder
    box(STEEL, [0.02, 0.24, 0.12], [0.004, 0.24, 0.004]),
    box(STEEL, [0.07, 0.24, 0.12], [0.004, 0.24, 0.004]),
    // Hazard plates
    box(RED, [L / 2 - 0.2, 0.24, 0.1165], [0.04, 0.03, 0.002]),
    box(RED, [-(L / 2 - 0.2), 0.24, -0.1165], [0.04, 0.03, 0.002]),
  ];
  // Bands round the barrel
  for (const x of [-0.3, 0, 0.3])
    p.push(cyl(DARK, "x", [x, 0.235, 0], 0.118, 0.012, 14));
  // Railing round the walkway
  for (const z of [-0.07, 0.07])
    p.push(box(STEEL, [0, 0.39, z], [0.22, 0.006, 0.006]));
  for (const x of [-0.11, 0.11])
    for (const z of [-0.07, 0.07])
      p.push(box(STEEL, [x, 0.375, z], [0.006, 0.035, 0.006]));
  return p;
})();

const BOX_CAR: Part[] = (() => {
  const L = CAR_LEN;
  const p: Part[] = [
    ...underframe(L),
    box("paint", [0, 0.245, 0], [L - 0.06, 0.25, 0.26]),
    // Curved roof: a flattened cylinder along the car
    {
      mat: "paint",
      shape: "cylX",
      pos: [0, 0.37, 0],
      size: [0.035, L - 0.05, 0.135],
      seg: 12,
    },
    // Sliding doors
    box(RUST_D, [0, 0.235, 0.1315], [0.26, 0.22, 0.004]),
    box(RUST_D, [0, 0.235, -0.1315], [0.26, 0.22, 0.004]),
    box(DARK, [0, 0.355, 0.134], [0.3, 0.01, 0.006]), // door rails
    box(DARK, [0, 0.355, -0.134], [0.3, 0.01, 0.006]),
    // Roof walkways
    box(DARK, [-0.25, 0.4, 0], [0.16, 0.006, 0.02]),
    box(DARK, [0.25, 0.4, 0], [0.16, 0.006, 0.02]),
    // Tail lights + grab irons
    box(RED, [-(L / 2 - 0.025), 0.15, 0.1], [0.004, 0.02, 0.02]),
    box(RED, [-(L / 2 - 0.025), 0.15, -0.1], [0.004, 0.02, 0.02]),
  ];
  // Vertical ribs
  for (const z of [-0.1315, 0.1315])
    for (const x of [-0.5, -0.4, -0.3, -0.2, 0.2, 0.3, 0.4, 0.5])
      p.push(box(BOXC, [x, 0.245, z], [0.014, 0.25, 0.006]));
  return p;
})();

const FLAT: Part[] = (() => {
  const L = CAR_LEN;
  const p: Part[] = [
    ...underframe(L),
    box(STEEL, [0, 0.11, 0], [L - 0.04, 0.025, 0.27]),
  ];
  // Stakes along both sides
  for (const z of [-0.128, 0.128])
    for (let k = -3; k <= 3; k++)
      p.push(box(DARK, [k * 0.17, 0.2, z], [0.016, 0.16, 0.016]));
  return p;
})();

/** Logs on the rear half, plank stacks on the front half (as in the reference). */
const LOGS_LOAD: Part[] = (() => {
  const p: Part[] = [];
  const rows: Array<[number, number]> = [
    [0.15, 4],
    [0.205, 3],
    [0.26, 2],
  ];
  for (const [y, n] of rows)
    for (let k = 0; k < n; k++) {
      const z = (k - (n - 1) / 2) * 0.055;
      p.push(cyl("load", "x", [-0.25, y, z], 0.027, 0.5, 8));
      p.push(cyl(LOGEND, "x", [-0.25 + 0.252, y, z], 0.024, 0.004, 8));
      p.push(cyl(LOGEND, "x", [-0.25 - 0.252, y, z], 0.024, 0.004, 8));
    }
  return p;
})();
const PLANK_LOAD: Part[] = (() => {
  const p: Part[] = [];
  for (const x of [0.12, 0.38])
    for (const z of [-0.055, 0.055]) {
      p.push(box(PLANK, [x, 0.175, z], [0.22, 0.1, 0.1]));
      p.push(box(DARK, [x - 0.06, 0.176, z], [0.008, 0.102, 0.102])); // straps
      p.push(box(DARK, [x + 0.06, 0.176, z], [0.008, 0.102, 0.102]));
    }
  return p;
})();

const GEO = {
  loco: buildParts(LOCO),
  hopper: buildParts(HOPPER),
  tank: buildParts(TANK),
  box: buildParts(BOX_CAR),
  flat: buildParts(FLAT),
  ore: buildParts(ORE_LOAD),
  logs: buildParts([...LOGS_LOAD, ...PLANK_LOAD]),
};

const WAGON_PAINT: Record<WagonKind, string> = {
  hopper: RUST,
  tank: TANKC,
  box: BOXC,
  flat: STEEL,
};
const LOAD_COLOR = { ore: "#2b2724", logs: WOOD };

function Meshes({
  geo,
  mats,
}: {
  geo: Record<string, THREE.BufferGeometry>;
  mats: Record<string, THREE.Material>;
}) {
  return (
    <>
      {Object.entries(geo).map(([k, g]) => (
        <mesh
          key={k}
          geometry={g}
          material={mats[k] ?? FIXED_MAT}
          castShadow={k !== "stripe"}
        />
      ))}
    </>
  );
}

/** The locomotive (origin: centre at rail-top height, +X forward). */
export const Locomotive = forwardRef<
  THREE.Group,
  { color: string; stripe: string }
>(function Locomotive({ color, stripe }, ref) {
  const mats = useMemo(
    () => ({ paint: paintMat(color, 0.6), stripe: paintMat(stripe, 0.5) }),
    [color, stripe],
  );
  return (
    <group ref={ref} rotation-order="YZX">
      <Meshes geo={GEO.loco} mats={mats} />
    </group>
  );
});

/** A freight wagon; `loaded` shows its cargo. */
export const Wagon = forwardRef<
  THREE.Group,
  { kind: WagonKind; loaded?: boolean }
>(function Wagon({ kind, loaded = true }, ref) {
  const mats = useMemo(
    () => ({ paint: paintMat(WAGON_PAINT[kind], 0.85) }),
    [kind],
  );
  const load = kind === "hopper" ? GEO.ore : kind === "flat" ? GEO.logs : null;
  const loadMats = useMemo(
    () => ({
      load: paintMat(kind === "hopper" ? LOAD_COLOR.ore : LOAD_COLOR.logs, 0.9),
    }),
    [kind],
  );
  return (
    <group ref={ref} rotation-order="YZX">
      <Meshes geo={GEO[kind]} mats={mats} />
      {loaded && load && <Meshes geo={load} mats={loadMats} />}
    </group>
  );
});

/**
 * Model viewer: a loco + hopper on one track, a tank, boxcar and flat car on
 * the other (on short track pieces), scaled ×2 to the viewer's size.
 */
export function TrainPreview() {
  const step = CAR_LEN + CAR_GAP;
  return (
    <group scale={2}>
      {/* Lift the track bed onto the ground (rail top 0.105 above it). */}
      <group position={[0, 0.105, 0]}>
        <group position={[-0.55, 0, -0.32]}>
          <PreviewTrack len={3.0} />
          <group position={[0.65, 0, 0]}>
            <Locomotive color={LOCO_COLORS[0]} stripe="#e74c3c" />
          </group>
          <group position={[0.65 - (LOCO_LEN + CAR_LEN) / 2 - CAR_GAP, 0, 0]}>
            <Wagon kind="hopper" />
          </group>
        </group>
        <group position={[-0.55, 0, 0.32]}>
          <PreviewTrack len={3.8} />
          <group position={[step, 0, 0]}>
            <Wagon kind="tank" />
          </group>
          <Wagon kind="box" />
          <group position={[-step, 0, 0]}>
            <Wagon kind="flat" />
          </group>
        </group>
      </group>
    </group>
  );
}

const PT_MAT = {
  ballast: paintMat("#7d7468", 0.95),
  sleeper: paintMat("#5a3f27", 0.9),
  rail: paintMat("#a3a9b0", 0.4),
};
/** A short straight track for the preview (rail top at y = 0). */
function PreviewTrack({ len }: { len: number }) {
  const sleepers = useMemo(() => {
    const out: number[] = [];
    for (let x = -len / 2 + 0.06; x < len / 2; x += 0.13) out.push(x);
    return out;
  }, [len]);
  return (
    <group position={[0, -0.1, 0]}>
      <mesh
        material={PT_MAT.ballast}
        position={[0, 0.02, 0]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[len, 0.05, 0.42]} />
      </mesh>
      {sleepers.map((x) => (
        <mesh
          key={x}
          material={PT_MAT.sleeper}
          position={[x, 0.055, 0]}
          receiveShadow
        >
          <boxGeometry args={[0.06, 0.025, 0.3]} />
        </mesh>
      ))}
      {[-HALF_GAUGE, HALF_GAUGE].map((z) => (
        <mesh
          key={z}
          material={PT_MAT.rail}
          position={[0, 0.085, z]}
          receiveShadow
        >
          <boxGeometry args={[len, 0.03, 0.022]} />
        </mesh>
      ))}
    </group>
  );
}
