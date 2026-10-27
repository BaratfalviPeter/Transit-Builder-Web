/**
 * Level crossings (rail over road): a half-barrier on each side of the
 * track, for the traffic coming that way — on the right of the road, the
 * boom closing the right lane, like a Hungarian light-and-barrier crossing:
 *
 *   - a white post with red bands on a concrete footing, the drive box,
 *   - a St Andrew's cross (red-edged white) on top,
 *   - two red lamps side by side, flashing in turn while a train is near,
 *   - the boom: red and white stripes, a counterweight behind the pivot.
 *
 * Animated from TransportSim.crossingClosed: the lamps start flashing as
 * soon as the crossing closes for trucks, the booms come down a moment later
 * and go up once the train has passed.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, railIndex, roadCrossingAxis, useTransport, type TerrainMap } from '../sim';
import { box, buildParts, cyl, FIXED_MAT, type Part } from './lowPoly';
import { groundAtGrid } from './railGeometry';

/** Road coat top above the ground (cells), where the posts stand. */
const ROAD_TOP = 0.026;
/** Post: before the track (along the road) and off the road's centre (cells). */
const BEFORE = 0.42;
const ASIDE = 0.42;
/** Boom pivot height, length, and its raised angle (rad). */
const PIVOT_Y = 0.17;
const BOOM_LEN = 0.44;
const RAISED = 1.42;
/** The boom swings on the drive box, behind the post (clear of the signs). */
const BOOM_Z = 0.085;
/** Seconds after closing before the booms start down; seconds to move. */
const DELAY = 0.8;
const MOVE = 1.4;

const WHITE = '#f1f1ec';
const RED = '#cf2f27';
const DARK = '#25272b';

/** The fixed parts (local frame: +X towards the road centre, +Z the traffic's heading, signs face −Z). */
const POST_GEO = buildParts(
  ((): Part[] => {
    const p: Part[] = [
      box('#8d8f8a', [0, 0.02, 0], [0.09, 0.04, 0.09]), // concrete footing
      cyl(WHITE, 'y', [0, 0.23, 0], 0.016, 0.42, 10),
      cyl(RED, 'y', [0, 0.11, 0], 0.017, 0.035, 10),
      cyl(RED, 'y', [0, 0.36, 0], 0.017, 0.035, 10),
      // Drive box the boom swings from.
      box('#d9dad4', [0, 0.13, 0.045], [0.06, 0.1, 0.05]),
      box(DARK, [0, 0.185, 0.045], [0.064, 0.008, 0.055]),
      // Lamp bar with two black backplates and hoods.
      box(DARK, [0, 0.29, -0.018], [0.14, 0.014, 0.012]),
    ];
    for (const sx of [-0.048, 0.048]) {
      p.push(cyl('#121314', 'z', [sx, 0.29, -0.028], 0.03, 0.008, 16));
      p.push(box('#121314', [sx, 0.318, -0.04], [0.05, 0.006, 0.026]));
    }
    // St Andrew's cross: red edges, white inside.
    for (const r of [0.62, -0.62]) {
      p.push(box(RED, [0, 0.43, -0.02], [0.22, 0.034, 0.006], [0, 0, r]));
      p.push(box(WHITE, [0, 0.43, -0.024], [0.2, 0.018, 0.004], [0, 0, r]));
    }
    return p;
  })(),
).fixed;

/** The boom (pivot at the origin, along +X) with its counterweight. */
const BOOM_GEO = buildParts(
  ((): Part[] => {
    const p: Part[] = [box(DARK, [-0.055, 0, 0], [0.07, 0.04, 0.03]), box('#9a9c98', [0, 0, 0], [0.03, 0.03, 0.035])];
    const n = 7;
    const seg = (BOOM_LEN - 0.02) / n;
    for (let i = 0; i < n; i++) p.push(box(i % 2 ? WHITE : RED, [0.02 + seg * (i + 0.5), 0, 0], [seg, 0.022, 0.014]));
    // A light at the tip.
    p.push(box(RED, [BOOM_LEN + 0.005, 0.016, 0], [0.016, 0.014, 0.016]));
    return p;
  })(),
).fixed;

const LAMP_GEO = new THREE.SphereGeometry(0.019, 12, 8);
const LAMP_OFF = new THREE.Color('#3b1512');
const LAMP_ON = new THREE.Color('#ff3020');

interface Barrier {
  /** Road cell index (TransportSim.crossingClosed). */
  cell: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Two barriers per crossed road cell, one for each way along the road. */
function barriersOf(map: TerrainMap): Barrier[] {
  const out: Barrier[] = [];
  const n = map.size;
  for (const k of railIndex(map).keys()) {
    const cx = Math.floor(k / n), cz = k - cx * n;
    if (map.cells[cx][cz] !== CellType.Road) continue;
    const axis = roadCrossingAxis(map, cx, cz) ?? 'x';
    for (const sg of [1, -1]) {
      // Traffic heading (dx, dz); its right is (−dz, dx).
      const dx = axis === 'x' ? sg : 0, dz = axis === 'z' ? sg : 0;
      const x = cx - dx * BEFORE - dz * ASIDE, z = cz - dz * BEFORE + dx * ASIDE;
      // Local +X (the boom) towards the road centre: −right = (dz, −dx).
      out.push({ cell: k, x, z, y: groundAtGrid(map, x, z) + ROAD_TOP, yaw: Math.atan2(dx, dz) });
    }
  }
  return out;
}

export function LevelCrossings({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const half = (map.size - 1) / 2;
  const barriers = useMemo(() => barriersOf(map), [map]);
  const booms = useRef<Array<THREE.Group | null>>([]);
  const lamps = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  // Per crossing cell: how long it has been closed, and how far down the booms are (0…1).
  const state = useRef(new Map<number, { closed: number; down: number }>());
  const clock = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    clock.current += dt;
    const seen = new Set<number>();
    for (const b of barriers) {
      if (seen.has(b.cell)) continue;
      seen.add(b.cell);
      let st = state.current.get(b.cell);
      if (!st) state.current.set(b.cell, (st = { closed: 0, down: 0 }));
      const closed = sim.crossingClosed(b.cell);
      st.closed = closed ? st.closed + dt : 0;
      const target = closed && st.closed > DELAY ? 1 : 0;
      st.down += Math.sign(target - st.down) * Math.min(Math.abs(target - st.down), dt / MOVE);
    }
    const flash = Math.floor(clock.current * 2.4) % 2;
    barriers.forEach((b, i) => {
      const st = state.current.get(b.cell)!;
      const g = booms.current[i];
      // Eased swing: slow at both ends.
      const e = st.down * st.down * (3 - 2 * st.down);
      if (g) g.rotation.z = RAISED * (1 - e);
      const on = st.closed > 0 || st.down > 0.01;
      for (const k of [0, 1]) lamps.current[i * 2 + k]?.color.copy(on && flash === k ? LAMP_ON : LAMP_OFF);
    });
  });

  if (!barriers.length) return null;
  return (
    <group scale={cellSize}>
      {barriers.map((b, i) => (
        <group key={i} position={[b.x - half, b.y, b.z - half]} rotation-y={b.yaw}>
          <mesh geometry={POST_GEO} material={FIXED_MAT} castShadow />
          {[-0.048, 0.048].map((sx, k) => (
            <mesh key={k} geometry={LAMP_GEO} position={[sx, 0.29, -0.034]}>
              <meshBasicMaterial ref={(m) => (lamps.current[i * 2 + k] = m)} color={LAMP_OFF} toneMapped={false} />
            </mesh>
          ))}
          <group ref={(g) => (booms.current[i] = g)} position={[0, PIVOT_Y, BOOM_Z]} rotation-z={RAISED}>
            <mesh geometry={BOOM_GEO} material={FIXED_MAT} castShadow />
          </group>
        </group>
      ))}
    </group>
  );
}

/**
 * Model viewer: a road crossing a track with its two half-barriers, closing
 * and opening in a loop (×3 size).
 */
export function CrossingPreview() {
  const booms = useRef<Array<THREE.Group | null>>([]);
  const lamps = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current = (t.current + Math.min(dt, 0.1)) % 8;
    const tt = t.current;
    // 0–1 s lamps only, 1–2.4 down, 2.4–5 down, 5–6.4 up, then open.
    const down = tt < 1 ? 0 : tt < 2.4 ? (tt - 1) / 1.4 : tt < 5 ? 1 : tt < 6.4 ? 1 - (tt - 5) / 1.4 : 0;
    const e = down * down * (3 - 2 * down);
    const flash = Math.floor(tt * 2.4) % 2;
    const on = tt < 6.4;
    for (let i = 0; i < 2; i++) {
      const g = booms.current[i];
      if (g) g.rotation.z = RAISED * (1 - e);
      for (const k of [0, 1]) lamps.current[i * 2 + k]?.color.copy(on && flash === k ? LAMP_ON : LAMP_OFF);
    }
  });
  const sides = [
    { x: -BEFORE, z: ASIDE, yaw: Math.atan2(1, 0) }, // traffic heading +X
    { x: BEFORE, z: -ASIDE, yaw: Math.atan2(-1, 0) }, // heading −X
  ];
  return (
    <group scale={3}>
      {/* Road along X, track along Z. */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[3, 0.02, 0.92]} />
        <meshStandardMaterial color="#55585e" roughness={0.9} />
      </mesh>
      {[-0.075, 0.075].map((x) => (
        <mesh key={x} position={[x, 0.03, 0]}>
          <boxGeometry args={[0.024, 0.02, 2.4]} />
          <meshStandardMaterial color="#a3a9b0" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {sides.map((s, i) => (
        <group key={i} position={[s.x, ROAD_TOP, s.z]} rotation-y={s.yaw}>
          <mesh geometry={POST_GEO} material={FIXED_MAT} castShadow />
          {[-0.048, 0.048].map((sx, k) => (
            <mesh key={k} geometry={LAMP_GEO} position={[sx, 0.29, -0.034]}>
              <meshBasicMaterial ref={(m) => (lamps.current[i * 2 + k] = m)} color={LAMP_OFF} toneMapped={false} />
            </mesh>
          ))}
          <group ref={(g) => (booms.current[i] = g)} position={[0, PIVOT_Y, BOOM_Z]} rotation-z={RAISED}>
            <mesh geometry={BOOM_GEO} material={FIXED_MAT} castShadow />
          </group>
        </group>
      ))}
    </group>
  );
}
