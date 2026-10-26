/**
 * Stations — the connection points between an industry and the transport
 * network (the "gates" between the macro map and an industry's interior).
 *
 * A stop attaches to one SIDE of a large industry's 6×6 lot, just outside
 * it: a platform row along the side and, behind it, a straight row as long as
 * the side — for a RAIL station a through-track (an ordinary rail-network
 * edge, so the rail planner can join it at either end), for a TRUCK stop a
 * road (ordinary Road cells, so it joins the road network). At most one stop
 * per side; each is a gate of the industry's interior.
 *
 * Pure TypeScript.
 */

import {
  CellType,
  cornerHeightAt,
  industryAnchorOf,
  industryFootprint,
  LARGE_INDUSTRY,
  type TerrainMap,
} from './terrain';
import { depotAt, type DepotRot } from './depot';

/** Which side of the lot: N = −Z, S = +Z, W = −X, E = +X. */
export type Side = 'N' | 'S' | 'W' | 'E';

/** Rail station, truck stop, or a freight depot (see depot.ts). */
export type StopKind = 'rail' | 'truck' | 'depot';

export interface Station {
  readonly id: number;
  /** Anchor cell of the industry it serves. */
  readonly anchor: readonly [number, number];
  readonly side: Side;
  /** Missing = 'rail' (stations built before truck stops existed). */
  readonly kind?: StopKind;
  /** A depot's quarter turns (its anchor is the lot's min corner; `side` unused). */
  readonly rot?: DepotRot;
}

export const stopKind = (s: Station): StopKind => s.kind ?? 'rail';

/** Where a station on (anchor, side) lies. */
export interface StationGeom {
  /** Platform cells (next to the lot), along the side. */
  platform: Array<[number, number]>;
  /** Outer row (rail track or road), along the side. */
  track: Array<[number, number]>;
  /** Track centre-line [x0, z0, x1, z1] (a rail-network edge). */
  trackPts: number[];
  /** Outward unit normal of the side (from the lot towards the track). */
  out: [number, number];
}

/** Rows a station takes outside the lot: platform + track. */
export const STATION_DEPTH = 2;

/** Cell bounds of the lot around `anchor`. */
function lotBounds(anchor: readonly [number, number]) {
  const t = industryFootprint(CellType.Mine);
  return { x0: anchor[0] + t.lo, x1: anchor[0] + t.hi, z0: anchor[1] + t.lo, z1: anchor[1] + t.hi };
}

export function stationGeom(anchor: readonly [number, number], side: Side): StationGeom {
  const { x0, x1, z0, z1 } = lotBounds(anchor);
  const platform: Array<[number, number]> = [];
  const track: Array<[number, number]> = [];
  const alongX = side === 'N' || side === 'S';
  const [a0, a1] = alongX ? [x0, x1] : [z0, z1];
  // Rows outside the side: platform first, then the track.
  const rowP = side === 'N' ? z0 - 1 : side === 'S' ? z1 + 1 : side === 'W' ? x0 - 1 : x1 + 1;
  const rowT = side === 'N' ? z0 - 2 : side === 'S' ? z1 + 2 : side === 'W' ? x0 - 2 : x1 + 2;
  for (let a = a0; a <= a1; a++) {
    platform.push(alongX ? [a, rowP] : [rowP, a]);
    track.push(alongX ? [a, rowT] : [rowT, a]);
  }
  const trackPts = alongX ? [a0, rowT, a1, rowT] : [rowT, a0, rowT, a1];
  const out: [number, number] = side === 'N' ? [0, -1] : side === 'S' ? [0, 1] : side === 'W' ? [-1, 0] : [1, 0];
  return { platform, track, trackPts, out };
}

/** The station (if any) on that side of that industry. */
export function stationOn(map: TerrainMap, anchor: readonly [number, number], side: Side): Station | null {
  return map.stations?.find((s) => s.kind !== 'depot' && s.anchor[0] === anchor[0] && s.anchor[1] === anchor[1] && s.side === side) ?? null;
}

/** The station (or depot) whose cells cover (x, z), or null. */
export function stationAt(map: TerrainMap, x: number, z: number): Station | null {
  const d = depotAt(map, x, z);
  if (d) return d;
  for (const s of map.stations ?? []) {
    if (s.kind === 'depot') continue;
    const g = stationGeom(s.anchor, s.side);
    if (g.platform.some(([a, b]) => a === x && b === z) || g.track.some(([a, b]) => a === x && b === z)) return s;
  }
  return null;
}

/**
 * The industry side the cursor at (x, z) points at: a cell in the
 * two-row band just outside a side, or a cell of the lot itself (its nearest
 * side). Null when no large industry is that close.
 */
export function sideAt(map: TerrainMap, x: number, z: number): { anchor: [number, number]; side: Side } | null {
  const inLot = industryAnchorOf(map, x, z);
  if (inLot) {
    const { x0, x1, z0, z1 } = lotBounds(inLot);
    const d: Array<[number, Side]> = [
      [z - z0, 'N'],
      [z1 - z, 'S'],
      [x - x0, 'W'],
      [x1 - x, 'E'],
    ];
    d.sort((a, b) => a[0] - b[0]);
    return { anchor: inLot, side: d[0][1] };
  }
  const R = STATION_DEPTH;
  const { lo, hi } = industryFootprint(CellType.Mine);
  for (let ax = x - hi - R; ax <= x - lo + R; ax++)
    for (let az = z - hi - R; az <= z - lo + R; az++) {
      if (ax < 0 || az < 0 || ax >= map.size || az >= map.size) continue;
      if (!LARGE_INDUSTRY.has(map.cells[ax][az])) continue;
      const { x0, x1, z0, z1 } = lotBounds([ax, az]);
      if (x >= x0 && x <= x1 && z >= z0 - R && z < z0) return { anchor: [ax, az], side: 'N' };
      if (x >= x0 && x <= x1 && z > z1 && z <= z1 + R) return { anchor: [ax, az], side: 'S' };
      if (z >= z0 && z <= z1 && x >= x0 - R && x < x0) return { anchor: [ax, az], side: 'W' };
      if (z >= z0 && z <= z1 && x > x1 && x <= x1 + R) return { anchor: [ax, az], side: 'E' };
    }
  return null;
}

/** Why a station can't go on (anchor, side) — Hungarian, for the UI — or null. */
export function stationProblem(map: TerrainMap, anchor: readonly [number, number], side: Side): string | null {
  const type = map.cells[anchor[0]][anchor[1]];
  if (!LARGE_INDUSTRY.has(type)) return 'Itt nincs ipar';
  if (type === CellType.OilRig) return 'A fúrótoronyhoz nem építhető megálló';
  if (stationOn(map, anchor, side)) return 'Ezen az oldalon már van megálló';
  const level = cornerHeightAt(map, anchor[0], anchor[1]);
  const g = stationGeom(anchor, side);
  for (const [x, z] of [...g.platform, ...g.track]) {
    if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 'Kilógna a térképről';
    if (map.cells[x][z] !== CellType.Empty) return 'Nincs elég szabad hely az oldal mentén';
    for (const [cx, cz] of [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x + 1, z + 1],
    ])
      if (cornerHeightAt(map, cx, cz) !== level) return 'A terep nem sík (vagy nem a telek szintjén van)';
  }
  return null;
}
