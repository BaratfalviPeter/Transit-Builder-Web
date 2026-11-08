/**
 * The oil depot (olajdepó) — a player-built terminal on land: the oil rig's
 * pipeline (see pipes.ts) fills its tanks, and tanker trucks load it at the
 * U-shaped truck loading area, and trains under the rail gantry (wagon by
 * wagon: the train pulls forward one car at a time, see transport.ts).
 *
 * A depot is a Station with kind 'oil', at `anchor` = the lot's min corner,
 * turned by `rot` (0…3, quarter turns), sized by its truck bays / rail tracks
 * (`bays`, `tracks`; for now always 2 / 1). Its LOCAL frame, in cells:
 * u along the lot (0…W, the model's +X), v across it (0…H = 6, the model's
 * +Z); the back edge (v = 0) has the ONE two-way access road (cell STUB_LX).
 * The numbers below are the model's design units (OilDepotModel draws them,
 * ×2 = cells). Pure TypeScript.
 */

import { CellType, cornerHeightAt, type TerrainMap } from './terrain';
import type { Station } from './stations';
import type { DepotRot } from './depot';

// ---------------------------------------------------------------- layout (design units)

/** Left edge of the truck area, a bay's width, an island's width. */
export const LANE_X0 = 0.58;
export const BAY_W = 0.24;
export const ISLAND_W = 0.11;
export const MEDIAN_W = 0.04;
/** The median's front end (z). */
export const MEDIAN_Z1 = 0.7;
export const OUT_W = 0.2;
/** Concrete rim between the asphalt and the lot edge on the right (incl. the curb). */
export const EDGE_RIM = 0.06;
/** The access road at the back edge: one game cell (0.5) wide, centered on a cell. */
export const STUB = { c: 1.25, h: 0.25 };
/** IN lane at the back, before it splits (it ends at the access road's center line). */
export const IN = { x0: 0.78, x1: STUB.c };
/** Back strip where the OUT lane runs over to the access road (z range). */
export const CONN = { z0: -1.3, z1: -1.0 };
export const ISLAND_Z = { z0: -0.36, z1: 0.36 };
export const CAN_Z = { z0: -0.46, z1: 0.46 };
export const SPLIT = { z0: -1.0, z1: -0.62 };
/**
 * The median wall runs from the access road's centre line (STUB.c, CONN.z1)
 * diagonally to (medianX, WALL_BEND_Z), then straight on along the canopy.
 * The bend: the straight piece before the canopy is twice what the split's end
 * would give (the user asked).
 */
export const WALL_BEND_Z = SPLIT.z1 - (CAN_Z.z0 - SPLIT.z1 + 0.03);
/** Front edge of the turning area. */
export const FRONT_Z = 1.44;
/** Rail track pitch and the first track's center (one track per 0.5 = one cell). */
export const TRACK_PITCH = 0.5;
export const FIRST_TRACK_X = -1.25;
export const MAX_TRUCK_BAYS = 5;
export const MAX_RAIL_TRACKS = 3;

export interface OilLayout {
  /** Bay center lines (x). */
  bays: number[];
  /** Islands: center x and the bays they serve. */
  islands: Array<{ x: number; bays: number[] }>;
  medianL: number;
  medianX: number;
  medianR: number;
  laneX1: number;
  /** OUT lane center (x). */
  outX: number;
  /** Lot edges (x); z is always ±1.5. */
  lotX0: number;
  lotX1: number;
  /** Rail track centers (x). */
  tracks: number[];
}

/** The depot's layout for `bays` truck bays (1–5) and `tracks` rail tracks (1–3). */
export function oilLayout(bays = 2, tracks = 1): OilLayout {
  const n = Math.max(1, Math.min(MAX_TRUCK_BAYS, Math.round(bays)));
  const t = Math.max(1, Math.min(MAX_RAIL_TRACKS, Math.round(tracks)));
  const centers: number[] = [];
  const islands: Array<{ x: number; bays: number[] }> = [];
  let x = LANE_X0;
  for (let i = 0; i < n; i += 2) {
    centers.push(x + BAY_W / 2);
    x += BAY_W;
    const isl = { x: x + ISLAND_W / 2, bays: [i] };
    islands.push(isl);
    x += ISLAND_W;
    if (i + 1 < n) {
      centers.push(x + BAY_W / 2);
      isl.bays.push(i + 1);
      x += BAY_W;
    }
  }
  const medianL = Math.max(x, IN.x1 + 0.02) + 0.005;
  const medianX = medianL + MEDIAN_W / 2;
  const medianR = medianL + MEDIAN_W;
  // The lot edge (whole 0.5 steps = cells) leaves room for at least OUT_W; the OUT lane
  // then takes all of it up to a narrow rim by the edge curb.
  const lotX1 = Math.max(1.5, Math.ceil((medianR + OUT_W + 0.08) * 2 - 1e-6) / 2);
  const laneX1 = lotX1 - EDGE_RIM;
  const trackXs = Array.from({ length: t }, (_, i) => FIRST_TRACK_X - TRACK_PITCH * i);
  const lotX0 = -1.5 - TRACK_PITCH * (t - 1);
  return { bays: centers, islands, medianL, medianX, medianR, laneX1, outX: (medianR + laneX1) / 2, lotX0, lotX1, tracks: trackXs };
}

// ---------------------------------------------------------------- the lot in the world

export const OIL_DEPOT_PRICE = 9000;
/** Upgrades (see oilGrown): one more truck loading bay / rail loading track. */
export const OIL_BAY_PRICE = 2500;
export const OIL_TRACK_PRICE = 4000;
/** What a new depot starts with. */
export const OIL_START_BAYS = 2;
export const OIL_START_TRACKS = 1;
/** Units the tanks hold. */
export const OIL_DEPOT_CAPACITY = 400;
export const OIL_H = 6;

export const isOilDepot = (s: Station): boolean => s.kind === 'oil';

/** Lot size in cells: W along u (the model's x), H across. */
export function oilSize(st: Pick<Station, 'bays' | 'tracks'>): { w: number; h: number; layout: OilLayout } {
  const layout = oilLayout(st.bays ?? 2, st.tracks ?? 1);
  return { w: Math.round((layout.lotX1 - layout.lotX0) * 2), h: OIL_H, layout };
}

/** Local (u, v) in cells (continuous) → world grid coords (cell centres are integers). */
export function oilToWorld(st: Station, u: number, v: number): [number, number] {
  const { w, h } = oilSize(st);
  const x0 = st.anchor[0] - 0.5;
  const z0 = st.anchor[1] - 0.5;
  switch (st.rot ?? 0) {
    case 1:
      return [x0 + h - v, z0 + u];
    case 2:
      return [x0 + w - u, z0 + h - v];
    case 3:
      return [x0 + v, z0 + w - u];
    default:
      return [x0 + u, z0 + v];
  }
}

/** World grid coords → local (u, v) in cells (the inverse of oilToWorld). */
export function oilFromWorld(st: Station, x: number, z: number): [number, number] {
  const { w, h } = oilSize(st);
  const x0 = st.anchor[0] - 0.5;
  const z0 = st.anchor[1] - 0.5;
  switch (st.rot ?? 0) {
    case 1:
      return [z - z0, x0 + h - x];
    case 2:
      return [x0 + w - x, z0 + h - z];
    case 3:
      return [z0 + w - z, x - x0];
    default:
      return [x - x0, z - z0];
  }
}

/** World grid coords → design coords (the model's x, z). */
export function oilWorldToDesign(st: Station, x: number, z: number): [number, number] {
  const { layout } = oilSize(st);
  const [u, v] = oilFromWorld(st, x, z);
  return [u / 2 + layout.lotX0, v / 2 - 1.5];
}

/**
 * The barriers' catchment (design units): a truck with a point in the IN
 * (left) half or the OUT (right) half of the access road, from a little
 * outside the lot to just past the barrier line, has that barrier up.
 */
export const GATE_ZONE = { z0: -2.15, z1: -1.1 };

/** Design coords (the model's x, z) → world grid coords. */
export function oilDesignToWorld(st: Station, x: number, z: number): [number, number] {
  const { layout } = oilSize(st);
  return oilToWorld(st, (x - layout.lotX0) * 2, (z + 1.5) * 2);
}

/** All the lot's cells (world), with their local column / row. */
export function oilCells(st: Station): Array<{ x: number; z: number; lx: number; lz: number }> {
  const { w, h } = oilSize(st);
  const out: Array<{ x: number; z: number; lx: number; lz: number }> = [];
  for (let lz = 0; lz < h; lz++)
    for (let lx = 0; lx < w; lx++) {
      const [x, z] = oilToWorld(st, lx + 0.5, lz + 0.5);
      out.push({ x: Math.round(x), z: Math.round(z), lx, lz });
    }
  return out;
}

/** Track ends sit this far in from the lot's front / back edge (design units: a half cell). */
const TRACK_END_Z = 1.25;

/**
 * The rail tracks through the lot, along it (design z), as platform segments
 * [ax, az, bx, bz] (world grid coords, cell centres at both ends): rail-network
 * edges, and the stops' platforms a train pulls up at (see rail.ts).
 */
export function oilTracks(st: Station): number[][] {
  return oilSize(st).layout.tracks.map((x) => [...oilDesignToWorld(st, x, -TRACK_END_Z), ...oilDesignToWorld(st, x, TRACK_END_Z)]);
}

/** Is local column `lx` under a rail track? */
export function oilTrackColumn(st: Station, lx: number): boolean {
  const { layout } = oilSize(st);
  return layout.tracks.some((x) => Math.floor((x - layout.lotX0) * 2) === lx);
}

/** Local column of the access road cell (back row). */
export function stubColumn(st: Station): number {
  const { layout } = oilSize(st);
  return Math.floor((STUB.c - layout.lotX0) * 2);
}

/** The access road cell (world): the one road cell trucks come in and leave by. */
export function oilStub(st: Station): [number, number] {
  const [x, z] = oilToWorld(st, stubColumn(st) + 0.5, 0.5);
  return [Math.round(x), Math.round(z)];
}

/** Centre of the lot (grid coords). */
export function oilCenter(st: Station): [number, number] {
  const { w, h } = oilSize(st);
  return oilToWorld(st, w / 2, h / 2);
}

/** The oil depot covering (x, z), or null. */
export function oilDepotAt(map: TerrainMap, x: number, z: number): Station | null {
  for (const s of map.stations ?? []) if (isOilDepot(s) && oilCells(s).some((c) => c.x === x && c.z === z)) return s;
  return null;
}

/**
 * The depot grown to `bays` truck bays / `tracks` rail tracks: a bigger model in
 * place of the old one (the lot widens — the truck side one way, the rail side
 * the other), its anchor moved so that what was there stays where it was.
 */
export function oilGrown(st: Station, bays: number, tracks: number): Station {
  const next: Station = { ...st, bays, tracks };
  const [ox, oz] = oilDesignToWorld(st, 0, 0);
  const [nx, nz] = oilDesignToWorld(next, 0, 0);
  return { ...next, anchor: [st.anchor[0] + Math.round(ox - nx), st.anchor[1] + Math.round(oz - nz)] };
}

/** Why the depot can't grow to `bays` / `tracks` — Hungarian — or null. */
export function oilUpgradeProblem(map: TerrainMap, st: Station, bays: number, tracks: number): string | null {
  if (bays > MAX_TRUCK_BAYS) return `Legfeljebb ${MAX_TRUCK_BAYS} töltőállás lehet`;
  if (tracks > MAX_RAIL_TRACKS) return `Legfeljebb ${MAX_RAIL_TRACKS} vágány lehet`;
  const next = oilGrown(st, bays, tracks);
  const n = map.size;
  const had = new Set(oilCells(st).map((c) => c.x * n + c.z));
  // The new cells: free, flat land at the lot's level.
  const level = cornerHeightAt(map, st.anchor[0], st.anchor[1]);
  for (const { x, z } of oilCells(next)) {
    if (had.has(x * n + z)) continue;
    if (x < 0 || z < 0 || x >= n - 1 || z >= n - 1) return 'Kilógna a térképről';
    const t = map.cells[x][z];
    if (t !== CellType.Empty && t !== CellType.Forest) return 'Nincs mellette elég szabad hely (sík, üres szárazföld kell)';
    for (const [cx, cz] of [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x + 1, z + 1],
    ])
      if (cornerHeightAt(map, cx, cz) !== level) return 'Mellette nem sík a terep';
  }
  return null;
}

/** Why an oil depot can't go at (x0, z0) turned `rot` — Hungarian — or null. */
export function oilDepotProblem(map: TerrainMap, x0: number, z0: number, rot: DepotRot): string | null {
  const probe: Station = { id: 0, anchor: [x0, z0], side: 'S', kind: 'oil', rot };
  const stub = oilStub(probe);
  const level = cornerHeightAt(map, x0, z0);
  for (const { x, z } of oilCells(probe)) {
    if (x < 0 || z < 0 || x >= map.size - 1 || z >= map.size - 1) return 'Kilógna a térképről';
    const t = map.cells[x][z];
    const isStub = x === stub[0] && z === stub[1];
    const ok = t === CellType.Empty || t === CellType.Forest || (isStub && t === CellType.Road);
    if (!ok) return 'Nincs elég szabad hely (sík, üres szárazföld kell)';
    for (const [cx, cz] of [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x + 1, z + 1],
    ])
      if (cornerHeightAt(map, cx, cz) !== level) return 'A terep nem sík';
  }
  return null;
}

// ---------------------------------------------------------------- truck paths

/** A quadratic corner from a through the control point c to b, sampled (b included). */
function corner(a: [number, number], c: [number, number], b: [number, number], n = 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, s = 1 - t;
    out.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** Length of a polyline. */
function polyLength(pts: Array<[number, number]>): number {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return s;
}

/** Right-lane offset of a road (cells → design units) and the trucks' stop line in a bay. */
const LANE_OFF = 0.1;
const STOP_Z = 0.4;
/** How far the way in to a right-hand bay keeps off the median wall's diagonal (design units). */
const WALL_CLEAR = 0.3;
/** How far left of the IN lane a truck for a right-hand bay passes the wall's start (design units). */
const TIP_CLEAR = 0.05;
/** Where the way out ends (design z): ~a truck's length straight past the last bend. */
const EXIT_END_Z = -1.72;

/**
 * Bay i's path through the depot (design units → world): in by the access road's
 * left half, along the IN lane, into the bay up to the stop line (`sStop`, the
 * truck's front), on round the U at the front, back up the OUT lane and out by the
 * access road's right half. `sGate` = where the yard begins (the lot edge).
 */
export function oilBayPath(st: Station, bay: number): { pts: Array<[number, number]>; sStop: number; sOut: number } {
  const L = oilSize(st).layout;
  const bx = L.bays[Math.max(0, Math.min(L.bays.length - 1, bay))];
  const inX = STUB.c - LANE_OFF;
  const outRoadX = STUB.c + LANE_OFF;
  const ox = L.outX;
  const top = FRONT_Z - 0.2;
  // From / to the access road cell's centre (where a truck's road route ends / starts).
  const d: Array<[number, number]> = [[inX, -1.25]];
  d.push([inX, -1.2]);
  if (bx <= inX + 0.02) {
    // Into the bay's line (to the left, away from the wall), as an S from the IN lane.
    const midZ = (SPLIT.z0 + SPLIT.z1) / 2;
    d.push(...corner([inX, -1.2], [inX, midZ], [(inX + bx) / 2, midZ]));
    d.push(...corner([(inX + bx) / 2, midZ], [bx, midZ], [bx, SPLIT.z1 + 0.05]));
  } else {
    // A bay to the right, over the median wall's diagonal: keep clear of it — up,
    // then along it (WALL_CLEAR off), then turn into the bay.
    const slope = (WALL_BEND_Z - CONN.z1) / Math.max(0.05, L.medianX - STUB.c);
    const along = (x: number) => CONN.z1 + (x - STUB.c) * slope + WALL_CLEAR;
    // Past the wall's start (on the access road's centre line) a little further
    // left first, so the trailer, cutting the bend, stays off it.
    const x0 = inX - TIP_CLEAR;
    d.push(...corner([inX, -1.2], [inX, -1.12], [x0, -1.04], 4));
    const k = Math.min(0.12, (bx - x0) / 2);
    const q1: [number, number] = [x0 + k, along(x0 + k)];
    const q2: [number, number] = [bx - k, along(bx - k)];
    d.push(...corner([x0, -1.04], [x0, along(x0)], q1));
    if (q2[0] > q1[0] + 1e-3) d.push(q2);
    const up = Math.max(SPLIT.z1 + 0.05, along(bx) + 0.14);
    d.push(...corner(q2, [bx, along(bx)], [bx, up]));
  }
  d.push([bx, STOP_Z]);
  const sStop = polyLength(d);
  // Round the U: up to the front, across, back down the OUT lane.
  const r = Math.min(0.3, (ox - bx) / 2);
  d.push([bx, top - r]);
  d.push(...corner([bx, top - r], [bx, top], [bx + r, top]));
  d.push([ox - r, top]);
  d.push(...corner([ox - r, top], [ox, top], [ox, top - r]));
  d.push([ox, CONN.z1]);
  // Over to the access road's right half and out.
  d.push(...corner([ox, CONN.z1], [ox, (CONN.z0 + CONN.z1) / 2], [(ox + outRoadX) / 2, (CONN.z0 + CONN.z1) / 2]));
  d.push(...corner([(ox + outRoadX) / 2, (CONN.z0 + CONN.z1) / 2], [outRoadX, (CONN.z0 + CONN.z1) / 2], [outRoadX, CONN.z0 - 0.02]));
  // On straight out past the lot edge, so the trailer is in line again when the
  // truck takes over its road route (else it would snap straight).
  d.push([outRoadX, EXIT_END_Z]);
  const sOut = polyLength(d.slice(0, d.length - 1));
  const pts = d.map(([x, z]) => oilDesignToWorld(st, x, z));
  // Design units → cells (×2).
  return { pts, sStop: sStop * 2, sOut: sOut * 2 };
}
