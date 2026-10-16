/**
 * pathfind — A* route finder for the two-click road/rail planner.
 *
 * Pure TypeScript (no React/Three). Finds a 4-neighbour path over the grid
 * from `start` to `goal` for a track type (Road or Rail), obeying the same
 * placement rules the builder uses:
 *   - a cell is passable if it already holds this track type (re-used, free),
 *     or a new track of this type may be built there (`canBuildRoadAt` /
 *     `canBuildRailAt`: Empty/Hill, flat or a single straight ramp);
 *   - consecutive cells may differ by at most one height level (HILL_STEP);
 *   - a ramp cell (slopeX / slopeZ) may only be entered and left along its
 *     slope axis, so tracks climb hills head-on, never sideways.
 *
 * The search state is (cell, heading) so a TURN PENALTY can be charged; that
 * keeps routes straight with few, deliberate bends instead of staircases.
 *
 * If the goal is unreachable (or itself unbuildable), the result is the best
 * partial route — to the reachable cell closest to the goal — with
 * `blocked: true`, so the UI can show it red.
 */

import {
  canBuildRailAt,
  canBuildRoadAt,
  CellType,
  getSlopeKind,
  HILL_STEP,
  type SlopeKind,
  type TerrainMap,
} from './terrain';
import { hasRailAt, roadCrossingAxis } from './railNet';

export interface GridCell {
  x: number;
  z: number;
}

export type TrackType = CellType.Road | CellType.Rail;

export interface PathResult {
  /** Cells from start to the goal (or to the closest reachable cell). */
  path: GridCell[];
  /** True if the goal itself could not be reached. */
  blocked: boolean;
}

/** Cost of stepping onto a fresh (to-be-built) cell. */
const STEP_COST = 1;
/** Cost of stepping onto an existing track of the same type (prefer joining). */
const REUSE_COST = 0.8;
/** Extra cost for a 90° turn. */
const TURN_COST = 0.9;
/** Extra cost for a height change between cells (prefer flat routes). */
const CLIMB_COST = 0.35;
/** Hard cap on expanded states (performance guard, ~70% of 4 × 121²). */
const MAX_EXPANSIONS = 40_000;

// Headings: 0 = +x, 1 = -x, 2 = +z, 3 = -z.
const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];
const isXDir = (d: number) => d < 2;

/** Binary min-heap of state ids keyed by an external f-score array. */
class Heap {
  private items: number[] = [];
  constructor(private readonly f: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(id: number): void {
    const a = this.items;
    a.push(id);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Search buffers, reused between calls (the planner runs on every hover). */
let buf: { g: Float64Array; f: Float64Array; from: Int32Array; closed: Uint8Array } | null = null;
function buffers(states: number) {
  if (!buf || buf.g.length !== states) {
    buf = {
      g: new Float64Array(states),
      f: new Float64Array(states),
      from: new Int32Array(states),
      closed: new Uint8Array(states),
    };
  }
  buf.g.fill(Infinity);
  buf.f.fill(Infinity);
  buf.from.fill(-1);
  buf.closed.fill(0);
  return buf;
}

/** Is `(x,z)` usable by a track of `type` (existing same-type, or buildable)? */
export function isTrackPassable(map: TerrainMap, x: number, z: number, type: TrackType): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  if (map.cells[x][z] === type) return true;
  if (type === CellType.Road) {
    // A road may cross a single, roughly axis-aligned track (level crossing).
    if (map.cells[x][z] === CellType.Rail) return roadCrossingAxis(map, x, z) !== null;
    return canBuildRoadAt(map, x, z);
  }
  return canBuildRailAt(map, x, z);
}

/**
 * For a road: the axis it must travel straight through a (planned or existing)
 * level crossing at (x, z), or null if the cell has no rail.
 */
function roadThroughAxis(map: TerrainMap, x: number, z: number): 'x' | 'z' | null {
  if (!hasRailAt(map, x, z)) return null;
  return roadCrossingAxis(map, x, z) ?? 'x';
}

/** May a track pass through a cell of this slope kind along heading `d`? */
function axisOk(kind: SlopeKind, d: number): boolean {
  if (kind === 'slopeX') return isXDir(d);
  if (kind === 'slopeZ') return !isXDir(d);
  return true; // flat (or an already-built odd cell)
}

/**
 * A* from `start` to `goal`. Both are grid cells. Returns an empty path if the
 * start itself is not passable.
 */
export function findTrackPath(
  map: TerrainMap,
  start: GridCell,
  goal: GridCell,
  type: TrackType,
): PathResult {
  const n = map.size;
  if (!isTrackPassable(map, start.x, start.z, type)) return { path: [], blocked: true };
  if (start.x === goal.x && start.z === goal.z) return { path: [{ ...start }], blocked: false };

  const cellCount = n * n;
  // Per-cell passability / slope cache (lazy: 0 = unknown, 1 = no, 2 = yes).
  const pass = new Uint8Array(cellCount);
  const kinds: (SlopeKind | undefined)[] = new Array(cellCount);
  const passable = (x: number, z: number): boolean => {
    const c = x * n + z;
    if (pass[c] === 0) pass[c] = isTrackPassable(map, x, z, type) ? 2 : 1;
    return pass[c] === 2;
  };
  const kindOf = (x: number, z: number): SlopeKind => {
    const c = x * n + z;
    let k = kinds[c];
    if (k === undefined) {
      k = getSlopeKind(map, x, z);
      // An already-built track on an odd cell is usable in any direction.
      if (k === 'invalid' && map.cells[x][z] === type) k = 'flat';
      kinds[c] = k;
    }
    return k;
  };

  // State id = cell * 4 + heading. The start cell has no heading: we seed all
  // four headings that the start cell's slope allows, at cost 0.
  const { g, f, from, closed } = buffers(cellCount * 4);
  const heap = new Heap(f);

  const minStep = Math.min(STEP_COST, REUSE_COST);
  const h = (x: number, z: number) => (Math.abs(x - goal.x) + Math.abs(z - goal.z)) * minStep;

  const startCell = start.x * n + start.z;
  const startKind = kindOf(start.x, start.z);
  for (let d = 0; d < 4; d++) {
    if (!axisOk(startKind, d)) continue;
    const s = startCell * 4 + d;
    g[s] = 0;
    f[s] = h(start.x, start.z);
    heap.push(s);
  }

  // Best fallback: the closed state closest to the goal (then cheapest).
  let best = startCell * 4;
  let bestDist = Math.abs(start.x - goal.x) + Math.abs(start.z - goal.z);
  let bestG = 0;
  let found = -1;
  let expansions = 0;

  while (heap.size > 0) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const cell = s >> 2;
    const d = s & 3;
    const x = (cell / n) | 0;
    const z = cell - x * n;

    if (x === goal.x && z === goal.z) {
      found = s;
      break;
    }
    const dist = Math.abs(x - goal.x) + Math.abs(z - goal.z);
    if (dist < bestDist || (dist === bestDist && g[s] < bestG)) {
      best = s;
      bestDist = dist;
      bestG = g[s];
    }
    if (++expansions > MAX_EXPANSIONS) break;

    const hHere = map.heights[x][z];
    // Start states carry a dummy heading: no turn cost / U-turn rule there.
    const isStart = cell === startCell && g[s] === 0;
    for (let nd = 0; nd < 4; nd++) {
      // No U-turns (they'd only ever revisit the cell we came from).
      if (!isStart && (d ^ 1) === nd) continue;
      const nx = x + DX[nd];
      const nz = z + DZ[nd];
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (!passable(nx, nz)) continue;
      // Level crossings: the road runs straight across the rail.
      if (type === CellType.Road) {
        const axis = isXDir(nd) ? 'x' : 'z';
        const here = roadThroughAxis(map, x, z);
        const there = roadThroughAxis(map, nx, nz);
        if ((here && here !== axis) || (there && there !== axis)) continue;
      }
      // Must leave this cell and enter the next along their ramp axes.
      if (!axisOk(kindOf(x, z), nd) || !axisOk(kindOf(nx, nz), nd)) continue;
      const dh = Math.abs(map.heights[nx][nz] - hHere);
      if (dh > HILL_STEP + 1e-6) continue; // max one level per step

      let cost = map.cells[nx][nz] === type ? REUSE_COST : STEP_COST;
      if (!isStart && nd !== d) cost += TURN_COST;
      if (dh > 1e-6) cost += CLIMB_COST;

      const ns = (nx * n + nz) * 4 + nd;
      const ng = g[s] + cost;
      if (ng < g[ns]) {
        g[ns] = ng;
        f[ns] = ng + h(nx, nz);
        from[ns] = s;
        heap.push(ns);
      }
    }
  }

  const end = found >= 0 ? found : best;
  const path: GridCell[] = [];
  for (let s = end; s >= 0; s = from[s]) {
    const cell = s >> 2;
    const x = (cell / n) | 0;
    path.push({ x, z: cell - x * n });
  }
  path.reverse();
  return { path, blocked: found < 0 };
}

/** Cells of `path` that would need building (not already `type`). */
export function cellsToBuild(map: TerrainMap, path: GridCell[], type: TrackType): GridCell[] {
  return path.filter(({ x, z }) => map.cells[x][z] !== type);
}
