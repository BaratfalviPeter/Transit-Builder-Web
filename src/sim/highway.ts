/**
 * Motorway (autópálya): two cell rows side by side, one per direction (2
 * lanes each), with a barrier between them.
 *
 *   - `map.highway`: cell index (x·size + z) → the direction traffic LEAVES
 *     the cell (0 +x, 1 +z, 2 −x, 3 −z). The cells are CellType.Road.
 *   - `map.ramps`: road cells beside a carriageway's OUTER (right-hand) side:
 *     the only side ways on and off (right in, right out). Other roads next
 *     to a motorway don't connect; they cross it under it (underpass).
 *   - A carriageway's ends join an ordinary road straight ahead / behind.
 *
 * `roadStep` is THE rule which road cell a vehicle may drive to from which;
 * `roadLinked` its undirected form (junctions, the drawing).
 */

import { CellType, canBuildRoadAt, type TerrainMap } from './terrain';
import { hasRailAt } from './railNet';
import { trackStepOk } from './pathfind';
import { interiorAt, structurePrice, structureProblem, type StructureKind } from './structures';

const hasCrossing = (map: TerrainMap, x: number, z: number) => hasRailAt(map, x, z);

export type HwDir = 0 | 1 | 2 | 3;
/** Unit step of a direction. */
export const HW_VEC: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
/** Build price per cell ($): a length of motorway is two cells. */
export const HIGHWAY_PRICE = 40;
/** A ramp (felhajtó) cell ($). */
export const RAMP_PRICE = 150;
/** Truck top speed on a motorway, × the normal one. */
export const HIGHWAY_SPEED = 1.5;

export function dirOf(dx: number, dz: number): HwDir | -1 {
  return dx === 1 && dz === 0 ? 0 : dx === 0 && dz === 1 ? 1 : dx === -1 && dz === 0 ? 2 : dx === 0 && dz === -1 ? 3 : -1;
}
/** Right of a heading (as the truck lanes: right of (dx, dz) is (−dz, dx)). */
export const rightOf = (d: HwDir): HwDir => ((d + 1) % 4) as HwDir;
export const leftOf = (d: HwDir): HwDir => ((d + 3) % 4) as HwDir;
const opposite = (d: HwDir): HwDir => ((d + 2) % 4) as HwDir;

/** The motorway direction of a cell, or -1. */
export function hwAt(map: TerrainMap, x: number, z: number): HwDir | -1 {
  if (!map.highway?.size || x < 0 || z < 0 || x >= map.size || z >= map.size) return -1;
  if (map.cells[x][z] !== CellType.Road) return -1;
  const d = map.highway.get(x * map.size + z);
  return d === undefined ? -1 : d;
}

export function isRamp(map: TerrainMap, x: number, z: number): boolean {
  return !!map.ramps?.size && map.cells[x]?.[z] === CellType.Road && map.ramps.has(x * map.size + z) && hwAt(map, x, z) < 0;
}

const isRoad = (map: TerrainMap, x: number, z: number) => x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Road;

/**
 * May a vehicle drive from road cell (x, z) to the neighbouring road cell
 * (nx, nz)? Ordinary roads: always. Motorway: only with the traffic; on /
 * off only from / to a ramp on the outer side, or straight on at its ends.
 */
export function roadStep(map: TerrainMap, x: number, z: number, nx: number, nz: number): boolean {
  if (!map.highway?.size) return true;
  const a = hwAt(map, x, z), b = hwAt(map, nx, nz);
  if (a < 0 && b < 0) return true;
  const d = dirOf(nx - x, nz - z);
  if (d < 0) return false;
  if (a >= 0 && b >= 0) return d === a && b !== opposite(d as HwDir);
  if (a >= 0) {
    // Off the motorway: right onto a ramp, or straight on at its end.
    if (isRamp(map, nx, nz)) return d === rightOf(a as HwDir);
    return d === a;
  }
  // On: from a ramp on the outer side (a right turn), or straight in at its start.
  if (isRamp(map, x, z)) return d === leftOf(b as HwDir);
  return d === b;
}

/** May a vehicle cross the bridge / tunnel from abutment (x, z) to (tx, tz)? (A motorway: its way only.) */
export function roadJumpOk(map: TerrainMap, x: number, z: number, tx: number, tz: number): boolean {
  const a = hwAt(map, x, z);
  if (a < 0) return hwAt(map, tx, tz) < 0;
  const [vx, vz] = HW_VEC[a];
  return Math.sign(tx - x) === vx && Math.sign(tz - z) === vz;
}

/** Are the two neighbouring road cells connected (either way)? */
export function roadLinked(map: TerrainMap, x: number, z: number, nx: number, nz: number): boolean {
  if (!isRoad(map, x, z) || !isRoad(map, nx, nz)) return false;
  return roadStep(map, x, z, nx, nz) || roadStep(map, nx, nz, x, z);
}

/** Why an ordinary road route can't be built (it runs onto a motorway), or null. */
export function roadOverHighway(map: TerrainMap, path: ReadonlyArray<{ x: number; z: number }>): string | null {
  if (!map.highway?.size) return null;
  // Under it (an underpass) is fine.
  for (const c of path) if (hwAt(map, c.x, c.z) >= 0 && !interiorAt(map, c.x, c.z)) return 'Autópályán át csak aluljáróval (vagy felhajtóval rá)';
  return null;
}

// ---------------------------------------------------------------- planning

export interface HighwayPlan {
  /** Cells with their direction (both carriageways; not the cells a span crosses). */
  cells: Array<{ x: number; z: number; d: HwDir }>;
  /** Bridges / tunnels it needs (one per carriageway): over water, a valley, through a hill. */
  spans: Array<{ kind: StructureKind; a: [number, number]; b: [number, number] }>;
  /** Cells to build (not motorway yet). */
  newCells: number;
  /**
   * End caps: ordinary road cells just past each end of both carriageways
   * (2 side by side at each end) — the road joins there, and a truck can
   * turn round. Only where buildable and empty.
   */
  caps: Array<{ x: number; z: number }>;
  problem: string | null;
}

/** The cell route `p` with its direction per cell (the last one goes on as the one before). */
function withDirs(p: ReadonlyArray<{ x: number; z: number }>): Array<{ x: number; z: number; d: HwDir }> | null {
  const out: Array<{ x: number; z: number; d: HwDir }> = [];
  for (let i = 0; i < p.length; i++) {
    const q = i + 1 < p.length ? p[i + 1] : null;
    const prev = out[i - 1];
    const d = q ? dirOf(q.x - p[i].x, q.z - p[i].z) : prev ? prev.d : -1;
    if (d < 0) return null;
    out.push({ x: p[i].x, z: p[i].z, d: d as HwDir });
  }
  return out;
}

/**
 * The other carriageway beside route `p` (one cell to its `side`): offset per
 * straight run, corners mitred, gaps filled, repeats dropped. Null if it
 * doesn't come out as a plain cell route (bends too close together).
 */
function besideRoute(p: ReadonlyArray<{ x: number; z: number; d: HwDir }>, side: 'left' | 'right'): Array<{ x: number; z: number }> | null {
  const off = (d: HwDir) => HW_VEC[side === 'left' ? leftOf(d) : rightOf(d)];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < p.length; i++) {
    const din = i > 0 ? p[i - 1].d : p[i].d;
    const dout = p[i].d;
    const a = off(din), b = off(dout);
    const o: [number, number] = din === dout ? [a[0], a[1]] : [a[0] + b[0], a[1] + b[1]];
    pts.push([p[i].x + o[0], p[i].z + o[1]]);
  }
  const out: Array<{ x: number; z: number }> = [];
  for (const [x, z] of pts) {
    const last = out[out.length - 1];
    if (last && last.x === x && last.z === z) continue;
    if (last) {
      const dx = x - last.x, dz = z - last.z;
      if (dx !== 0 && dz !== 0) return null;
      const n = Math.abs(dx + dz);
      for (let k = 1; k < n; k++) out.push({ x: last.x + Math.sign(dx) * k, z: last.z + Math.sign(dz) * k });
    }
    out.push({ x, z });
  }
  const seen = new Set<string>();
  for (const c of out) {
    const k = `${c.x},${c.z}`;
    if (seen.has(k)) return null;
    seen.add(k);
  }
  return out;
}

/**
 * A bridge (over water / a valley / a lower road or rail) or a tunnel (through
 * a hill, or an underpass under a road) from abutment `a` to `b` over `inner`,
 * or why not (Hungarian).
 */
function spanOver(
  map: TerrainMap,
  inner: ReadonlyArray<{ x: number; z: number }>,
  a: [number, number],
  b: [number, number],
): { kind: StructureKind; a: [number, number]; b: [number, number] } | string {
  const bridge = structureProblem(map, 'bridge', a, b);
  if (!bridge) return { kind: 'bridge', a, b };
  const tunnel = structureProblem(map, 'tunnel', a, b);
  if (!tunnel) return { kind: 'tunnel', a, b };
  const wet = inner.some((c) => map.cells[c.x][c.z] === CellType.Water);
  return `${wet ? 'Híd' : 'Alagút / híd'}: ${wet ? bridge : tunnel}`;
}

/** The price of a plan's bridges / tunnels. */
export function spansPrice(plan: HighwayPlan): number {
  return plan.spans.reduce((s, sp) => s + structurePrice(sp.kind, sp.a, sp.b), 0);
}

/** May motorway cell (x, z) with direction d go here (new, or the same / an end of an existing one)? */
function cellProblem(map: TerrainMap, x: number, z: number, d: HwDir, plan: ReadonlySet<number>): string | null {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 'A térkép szélén nem fér el';
  const cur = hwAt(map, x, z);
  if (cur >= 0) {
    if (cur === d) return null;
    // Turning an end of an existing carriageway: nothing may follow it yet.
    const [vx, vz] = HW_VEC[cur];
    if (hwAt(map, x + vx, z + vz) < 0) return null;
    return 'Ütközik egy meglévő autópályával';
  }
  if (map.cells[x][z] === CellType.Road) {
    // An ordinary road cell only if it just joins (an end cap): nothing else hangs on it.
    if (isRamp(map, x, z) || hasCrossing(map, x, z)) return 'Útba ütközik — keresztezni aluljáróval lehet';
    for (const [vx, vz] of HW_VEC) {
      const nx = x + vx, nz = z + vz;
      if (!roadLinked(map, x, z, nx, nz) || plan.has(nx * map.size + nz) || hwAt(map, nx, nz) >= 0) continue;
      return 'Útba ütközik — keresztezni aluljáróval lehet';
    }
    return null;
  }
  if (map.cells[x][z] === CellType.Rail) return 'Sínbe ütközik — keresztezni hídon / aluljáróval lehet';
  if (!canBuildRoadAt(map, x, z)) return 'Akadály — ide nem építhető';
  return null;
}

/**
 * Plan a motorway along the drawn cell route `path`: the route is one
 * carriageway, the other goes beside it (left: the route is the forward
 * one; else right, the route the return one — e.g. carrying on from the
 * other carriageway's end).
 */
export function highwayPlan(map: TerrainMap, path: ReadonlyArray<{ x: number; z: number }>): HighwayPlan {
  const fail = (problem: string): HighwayPlan => ({ cells: [], newCells: 0, caps: [], spans: [], problem });
  if (path.length < 2) return fail('Húzd tovább');
  const p = withDirs(path);
  if (!p) return fail('Csak egyenesen és derékszögben');
  for (let i = 1; i < p.length; i++) if (p[i].d === opposite(p[i - 1].d)) return fail('Itt nem fordulhat vissza');
  let first: string | null = null;
  for (const side of ['left', 'right'] as const) {
    const q = besideRoute(p, side);
    if (!q || q.length < 2) {
      first ??= 'Túl közeli kanyarok';
      continue;
    }
    // The route's own traffic goes forward on the left plan, back on the right one.
    const fwd = side === 'left' ? p : withDirs([...p].reverse())!;
    const back = side === 'left' ? withDirs([...q].reverse()) : withDirs(q);
    if (!back || !fwd) continue;
    const cells = [...fwd, ...back];
    const keys = new Set(cells.map((c) => c.x * map.size + c.z));
    if (keys.size !== cells.length) {
      first ??= 'Túl közeli kanyarok';
      continue;
    }
    // Cell by cell; a run of cells it can't go on is spanned (bridge / tunnel) on a straight stretch.
    let problem: string | null = null;
    const kept: Array<{ x: number; z: number; d: HwDir }> = [];
    const spans: HighwayPlan['spans'] = [];
    const bad = (c: { x: number; z: number; d: HwDir }) => cellProblem(map, c.x, c.z, c.d, keys);
    for (const row of [fwd, back]) {
      for (let i = 0; i < row.length && !problem; ) {
        const pr = bad(row[i]);
        if (!pr) {
          kept.push(row[i++]);
          continue;
        }
        if (hwAt(map, row[i].x, row[i].z) >= 0 || pr.startsWith('A térkép')) {
          problem = pr;
          break;
        }
        let j = i;
        while (j < row.length && bad(row[j])) j++;
        const a = row[i - 1], b = row[j];
        if (!a || !b || !row.slice(i - 1, j + 1).every((q) => q.d === a.d)) {
          problem = pr;
          break;
        }
        const span = spanOver(map, row.slice(i, j), [a.x, a.z], [b.x, b.z]);
        if (typeof span === 'string') {
          problem = span;
          break;
        }
        spans.push(span);
        i = j;
      }
      if (problem) break;
    }
    if (problem) {
      first ??= problem;
      continue;
    }
    // End caps: past each end of each carriageway.
    const caps: Array<{ x: number; z: number }> = [];
    for (const row of [fwd, back]) {
      const a = row[0], b = row[row.length - 1];
      for (const [x, z] of [
        [a.x - HW_VEC[a.d][0], a.z - HW_VEC[a.d][1]],
        [b.x + HW_VEC[b.d][0], b.z + HW_VEC[b.d][1]],
      ]) {
        if (keys.has(x * map.size + z) || hwAt(map, x, z) >= 0) continue;
        if (map.cells[x]?.[z] === CellType.Road) continue;
        if (!canBuildRoadAt(map, x, z)) {
          problem = 'A vége nem köthető be (útvég: 2 szabad cella kell a pálya végén)';
          break;
        }
        caps.push({ x, z });
      }
    }
    // The two caps at each end must join (a truck turns round there): no step between levels.
    const capAt = (c: { x: number; z: number; d: HwDir }, ahead: boolean) => ({ x: c.x + (ahead ? 1 : -1) * HW_VEC[c.d][0], z: c.z + (ahead ? 1 : -1) * HW_VEC[c.d][1] });
    for (const [p1, p2] of [
      [capAt(fwd[0], false), capAt(back[back.length - 1], true)],
      [capAt(fwd[fwd.length - 1], true), capAt(back[0], false)],
    ]) {
      if (problem) break;
      if (hwAt(map, p1.x, p1.z) >= 0 || hwAt(map, p2.x, p2.z) >= 0) continue; // joins an existing motorway
      if (!trackStepOk(map, p1, p2, CellType.Road) && !trackStepOk(map, p2, p1, CellType.Road)) problem = 'A vége lejtőn van: a két útvég nem köthető össze (tereprendezés)';
    }
    if (problem) {
      first ??= problem;
      continue;
    }
    const newCells = kept.filter((c) => hwAt(map, c.x, c.z) < 0).length;
    return { cells: kept, newCells, caps, spans, problem: null };
  }
  return fail(first ?? 'Ide nem építhető');
}

/** A ramp at (x, z): the carriageway cell it serves (on its outer side, on a straight stretch), else why not. */
export function rampProblem(map: TerrainMap, x: number, z: number): string | null {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 'Ide nem tehető';
  if (hwAt(map, x, z) >= 0) return 'Az autópálya mellé, a külső oldalára tedd';
  if (isRamp(map, x, z)) return 'Itt már van felhajtó';
  const cur = map.cells[x][z];
  if (cur !== CellType.Road && !canBuildRoadAt(map, x, z)) return 'Akadály — ide nem építhető';
  let found = 0;
  for (let d = 0 as HwDir; d < 4; d = (d + 1) as HwDir) {
    const [vx, vz] = HW_VEC[d];
    const h = hwAt(map, x + vx, z + vz);
    if (h < 0) continue;
    // We must be on its right: the cell is at H + right(h), i.e. d = left(h).
    if (d !== leftOf(h as HwDir)) return 'Csak a külső (jobb) oldalra — a két pálya közé nem';
    // A straight stretch: the cell before flows straight in.
    const [bx, bz] = HW_VEC[h];
    if (hwAt(map, x + vx - bx, z + vz - bz) !== h) return 'Csak egyenes szakasz mellé';
    found++;
  }
  if (!found) return 'Az autópálya mellé tedd (a külső oldalára)';
  if (found > 1) return 'Két pálya mellé nem tehető';
  return null;
}
