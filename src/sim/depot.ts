/**
 * The freight depot (raktár) — a player-built 6×6 transfer point: trucks
 * (and later trains) drop cargo there and other lines pick it up.
 *
 * A depot is a Station with kind 'depot' (so lines, the network view and
 * the stock code treat it like any stop), at `anchor` = the lot's min corner,
 * turned by `rot` (0…3, quarter turns). Its LOCAL frame (cells, cell
 * centres): lx 0…5 along the lot, lz 0…5 across it:
 *
 *   lz 0, 1   two through-tracks (rail-network edges, Rail cells)
 *   lz 2, 3   the hall (Station cells)
 *   lz 4      loading bays (Station cells): trucks back in to the docks
 *   lz 5      the drive (Road cells), one-way: a truck comes in at lx 0,
 *             drives +lx in the outer lane past a free bay, backs in, and
 *             leaves at lx 5 (the dir −1 paths are kept for a two-way drive)
 *
 * Matches DepotModel (design units ×2, model rotationY = −rot·π/2).
 * Pure TypeScript.
 */

import { CellType, cornerHeightAt, type TerrainMap } from './terrain';
import type { Station } from './stations';

export const DEPOT_SIZE = 6;
export type DepotRot = 0 | 1 | 2 | 3;

/** Price of a depot. */
export const DEPOT_PRICE = 6000;
/** Units a depot stores (all kinds together). */
export const DEPOT_CAPACITY = 400;
/** Loading bays and their centres along the lot (local lx). */
export const DEPOT_BAYS = 5;
export const BAY_LX: readonly number[] = Array.from({ length: DEPOT_BAYS }, (_, i) => 0.26 + i * 0.94);
/** Local lz of the dock face (a backed-in trailer's rear stops here). */
export const DOCK_LZ = 3.45;
/** Local lz of the drive's lanes: heading +lx (outer) / −lx (inner), right-hand traffic. */
export const DRIVE_LZ = 5.2;
export const DRIVE_LZ_BACK = 4.8;

/** Which way a truck works through the depot: +1 = in at lx 0, −1 = in at lx 5. */
export type DepotDir = 1 | -1;

export const isDepot = (s: Station): boolean => s.kind === 'depot';

/** World grid coords → local (lx, lz) (the inverse of depotToWorld). */
export function worldToDepot(st: Station, x: number, z: number): [number, number] {
  const [x0, z0] = st.anchor;
  const m = DEPOT_SIZE - 1;
  switch (st.rot ?? 0) {
    case 1:
      return [z - z0, x0 + m - x];
    case 2:
      return [x0 + m - x, z0 + m - z];
    case 3:
      return [z0 + m - z, x - x0];
    default:
      return [x - x0, z - z0];
  }
}

/** Local (lx, lz) → world grid coords (continuous, cell centres). */
export function depotToWorld(st: Station, lx: number, lz: number): [number, number] {
  const [x0, z0] = st.anchor;
  const m = DEPOT_SIZE - 1;
  switch (st.rot ?? 0) {
    case 1:
      return [x0 + m - lz, z0 + lx];
    case 2:
      return [x0 + m - lx, z0 + m - lz];
    case 3:
      return [x0 + lz, z0 + m - lx];
    default:
      return [x0 + lx, z0 + lz];
  }
}

/** All the lot's cells, with their local row (lz). */
export function depotCells(st: Station): Array<{ x: number; z: number; lz: number }> {
  const out: Array<{ x: number; z: number; lz: number }> = [];
  for (let lz = 0; lz < DEPOT_SIZE; lz++)
    for (let lx = 0; lx < DEPOT_SIZE; lx++) {
      const [x, z] = depotToWorld(st, lx, lz);
      out.push({ x, z, lz });
    }
  return out;
}

/** The drive's cells, entrance first. */
export function driveCells(st: Station): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let lx = 0; lx < DEPOT_SIZE; lx++) out.push(depotToWorld(st, lx, DEPOT_SIZE - 1));
  return out;
}
export const depotEntrance = (st: Station): [number, number] => depotToWorld(st, 0, DEPOT_SIZE - 1);
export const depotExit = (st: Station): [number, number] => depotToWorld(st, DEPOT_SIZE - 1, DEPOT_SIZE - 1);
/** Centre of the lot (grid coords). */
export const depotCenter = (st: Station): [number, number] => depotToWorld(st, (DEPOT_SIZE - 1) / 2, (DEPOT_SIZE - 1) / 2);

/** The two tracks' centre-lines [x0, z0, x1, z1] (rail-network edges). */
export function depotTracks(st: Station): number[][] {
  return [0, 1].map((lz) => [...depotToWorld(st, 0, lz), ...depotToWorld(st, DEPOT_SIZE - 1, lz)]);
}

/** Is (x, z) on the depot's lot? */
export function inDepot(st: Station, x: number, z: number): boolean {
  return depotCells(st).some((c) => c.x === x && c.z === z);
}

/** The depot covering (x, z), or null. */
export function depotAt(map: TerrainMap, x: number, z: number): Station | null {
  for (const s of map.stations ?? []) if (isDepot(s) && inDepot(s, x, z)) return s;
  return null;
}

/** Why a depot can't go at (x0, z0) turned `rot` — Hungarian — or null. */
export function depotProblem(map: TerrainMap, x0: number, z0: number, rot: DepotRot): string | null {
  const probe: Station = { id: 0, anchor: [x0, z0], side: 'S', kind: 'depot', rot };
  const level = cornerHeightAt(map, x0, z0);
  for (const { x, z, lz } of depotCells(probe)) {
    if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 'Kilógna a térképről';
    const t = map.cells[x][z];
    const ok = t === CellType.Empty || t === CellType.Forest || (lz === DEPOT_SIZE - 1 && t === CellType.Road);
    if (!ok) return 'Nincs elég szabad hely (6×6 sík, üres terület kell)';
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

/** A path through local points, mapped to the world (for the truck lanes). */
function worldPoints(st: Station, pts: Array<[number, number]>): Array<[number, number]> {
  return pts.map(([lx, lz]) => depotToWorld(st, lx, lz));
}

/** How far past the turn a truck stops, so its whole length is on the drive. */
const CLEAR = 0.95;
/** Sideways reach of the turn out of a bay onto the drive. */
const TURN = 0.6;

/** The drive lane a truck working `dir` uses. */
const laneZ = (dir: DepotDir) => (dir > 0 ? DRIVE_LZ : DRIVE_LZ_BACK);
/** Point P (local lx) a truck drives to before backing into bay i. */
const turnPoint = (i: number, dir: DepotDir) => BAY_LX[i] + dir * (TURN + CLEAR);

/** Can a truck working `dir` use bay i (its turn point must be on the lot)? */
export function bayUsable(i: number, dir: DepotDir): boolean {
  const p = turnPoint(i, dir);
  return p >= -0.05 && p <= DEPOT_SIZE - 0.45;
}

/** The end a truck arrives at (dir +1: lx 0) and the one it leaves by. */
export const depotIn = (st: Station, dir: DepotDir) => (dir > 0 ? depotEntrance(st) : depotExit(st));
export const depotOut = (st: Station, dir: DepotDir) => (dir > 0 ? depotExit(st) : depotEntrance(st));

/**
 * Bay i's path, drawn in the truck's FORWARD direction when it leaves: from
 * the dock out of the bay, a turn onto the drive, along the drive to the
 * far end. A truck backs in by running it backwards (from sP down to sDock).
 * Returns the world polyline, sP (where a truck coming along the drive
 * stands before backing in) and sDock (backed in).
 */
export function bayPath(st: Station, i: number, dir: DepotDir): { pts: Array<[number, number]>; sP: number; sDock: number } {
  const bx = BAY_LX[i];
  const lz = laneZ(dir);
  const local: Array<[number, number]> = [
    [bx, 3.3],
    [bx, 4.3],
  ];
  // Quadratic turn (control on the drive lane) from heading +lz to ±lx.
  const ex = bx + dir * TURN;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8, u = 1 - t;
    local.push([u * u * bx + 2 * u * t * bx + t * t * ex, u * u * 4.3 + 2 * u * t * lz + t * t * lz]);
  }
  const pX = turnPoint(i, dir);
  local.push([dir > 0 ? Math.max(pX, DEPOT_SIZE - 1) : Math.min(pX, 0), lz]);
  let s = 0, sP = 0;
  for (let k = 1; k < local.length; k++) {
    const [ax, az] = local[k - 1], [bx2, bz] = local[k];
    if (k === local.length - 1) sP = s + Math.abs(pX - ax);
    s += Math.hypot(bx2 - ax, bz - az);
  }
  // Backed in: the trailer's rear (0.82 behind the front) at the dock face.
  const sDock = DOCK_LZ - 3.3 + 0.82;
  return { pts: worldPoints(st, local), sP, sDock };
}

/** The drive from where a truck comes in to bay i's turn point P (forward). */
export function bayApproach(st: Station, i: number, dir: DepotDir): Array<[number, number]> {
  return worldPoints(st, [
    [dir > 0 ? 0 : DEPOT_SIZE - 1, laneZ(dir)],
    [turnPoint(i, dir), laneZ(dir)],
  ]);
}

/**
 * Is world point (x, z) in the yard zone a truck backing into bay i (working
 * `dir`) sweeps — the bay mouth and the drive in front of it?
 */
export function inBayZone(st: Station, i: number, dir: DepotDir, x: number, z: number): boolean {
  const [lx, lz] = worldToDepot(st, x, z);
  const bx = BAY_LX[i];
  const a = dir > 0 ? bx - 0.3 : bx - TURN - 0.3;
  const b = dir > 0 ? bx + TURN + 0.3 : bx + 0.3;
  return lx >= a && lx <= b && lz >= 3.9 && lz <= 5.5;
}
