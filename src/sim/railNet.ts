/**
 * railNet — the rail network as smooth CENTRE-LINES (not per-cell pieces).
 *
 * A track is a polyline in grid coordinates (cell centre = integer x/z): long
 * straights are just their two end points, curves are circular arcs sampled
 * densely. Edges meet at shared end points: 2 ends = a plain joint, 3+ = a
 * switch (the branch leaves tangentially, like a real turnout). Crossing
 * tracks simply overlap.
 *
 * The grid still matters for the game rules: every cell within TRACK_HALF of
 * a centre-line is the track's FOOTPRINT. Footprint cells become CellType.Rail
 * (or stay Road = level crossing), so roads, the city, bulldozing and the
 * build rules keep working per cell.
 *
 * Pure TypeScript; immutable (copy-on-write) like the rest of TerrainMap.
 */

import {
  CellType,
  cellCornerHeights,
  cellRiseWithinOneStep,
  getSlopeKind,
  type TerrainMap,
} from './terrain';

export interface RailEdge {
  readonly id: number;
  /** Centre-line points [x0, z0, x1, z1, …] in grid coords. */
  readonly pts: readonly number[];
}

export interface RailNet {
  readonly edges: readonly RailEdge[];
  readonly nextId: number;
}

export const EMPTY_NET: RailNet = { edges: [], nextId: 1 };

/**
 * Smallest curve radius (cells): 1 + √2, the radius at which a 45° arc
 * leaving a cell centre along an axis runs out onto a diagonal through cell
 * centres. Curves come in whole multiples of it (see railRoute.ts).
 */
export const RAIL_R_MIN = 1 + Math.SQRT2;
/** Half-width of a track's cell footprint (cells). */
export const TRACK_HALF = 0.32;
/** Cursor distance (cells) within which a click snaps onto an existing track. */
export const SNAP_DIST = 0.9;
/** Switches stay at least this far (along the track) from an edge's ends. */
export const SWITCH_CLEAR = 1.5;

// ---------------------------------------------------------------- geometry

/** Arc-length walker over a polyline. */
export class LineWalker {
  readonly cum: Float64Array;
  readonly total: number;
  constructor(readonly pts: readonly number[]) {
    const n = pts.length / 2;
    this.cum = new Float64Array(Math.max(1, n));
    for (let i = 1; i < n; i++) {
      this.cum[i] =
        this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    this.total = this.cum[n - 1] ?? 0;
  }
  /** Segment index containing arc length s. */
  private seg(s: number): number {
    const c = this.cum;
    let lo = 0, hi = c.length - 2;
    if (hi < 0) return 0;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (c[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  }
  /** [x, z, tx, tz] at arc length s (clamped). */
  at(s: number, out: number[] = [0, 0, 0, 0]): number[] {
    const p = this.pts;
    if (p.length < 4) {
      out[0] = p[0] ?? 0; out[1] = p[1] ?? 0; out[2] = 1; out[3] = 0;
      return out;
    }
    s = Math.min(Math.max(s, 0), this.total);
    const i = this.seg(s);
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = this.cum[i + 1] - this.cum[i] || 1;
    const t = (s - this.cum[i]) / L;
    out[0] = ax + (bx - ax) * t;
    out[1] = az + (bz - az) * t;
    out[2] = (bx - ax) / L;
    out[3] = (bz - az) / L;
    return out;
  }
  /** Sub-polyline between arc lengths a < b (keeps the original vertices). */
  sub(a: number, b: number): number[] {
    const out: number[] = [];
    const pa = this.at(a);
    out.push(pa[0], pa[1]);
    const p = this.pts;
    for (let i = 1; i < this.cum.length - 1; i++) {
      if (this.cum[i] > a + 1e-9 && this.cum[i] < b - 1e-9) out.push(p[i * 2], p[i * 2 + 1]);
    }
    const pb = this.at(b);
    out.push(pb[0], pb[1]);
    return out;
  }
}

/** Visit samples every `step` along a polyline (incl. both ends). */
export function forEachSample(
  pts: readonly number[],
  step: number,
  f: (x: number, z: number, tx: number, tz: number, s: number) => void,
): void {
  const w = new LineWalker(pts);
  const n = Math.max(1, Math.ceil(w.total / step));
  const o = [0, 0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const s = (w.total * i) / n;
    w.at(s, o);
    f(o[0], o[1], o[2], o[3], s);
  }
}

// ---------------------------------------------------------------- index

export interface CellTrack {
  edge: number;
  /** Track direction through the cell (unit). */
  tx: number;
  tz: number;
}

const indexCache = new WeakMap<RailNet, { size: number; idx: Map<number, CellTrack[]> }>();

/** Cell index (x*size+z) → tracks whose footprint covers it. Cached per net. */
export function railIndex(map: TerrainMap): Map<number, CellTrack[]> {
  const net = map.railNet ?? EMPTY_NET;
  const hit = indexCache.get(net);
  if (hit && hit.size === map.size) return hit.idx;
  const idx = new Map<number, CellTrack[]>();
  const n = map.size;
  for (const e of net.edges) {
    const seen = new Set<number>();
    forEachSample(e.pts, 0.1, (x, z, tx, tz) => {
      for (const o of [-TRACK_HALF, 0, TRACK_HALF]) {
        const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
        const k = cx * n + cz;
        if (seen.has(k)) continue;
        seen.add(k);
        let arr = idx.get(k);
        if (!arr) idx.set(k, (arr = []));
        arr.push({ edge: e.id, tx, tz });
      }
    });
  }
  indexCache.set(net, { size: n, idx });
  return idx;
}

export function hasRailAt(map: TerrainMap, x: number, z: number): boolean {
  if (!map.railNet || x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  return railIndex(map).has(x * map.size + z);
}

export function tracksAt(map: TerrainMap, x: number, z: number): CellTrack[] {
  if (!map.railNet) return [];
  return railIndex(map).get(x * map.size + z) ?? [];
}

// ---------------------------------------------------------------- rules

const isRoad = (map: TerrainMap, x: number, z: number) =>
  x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Road;

function isFlat(map: TerrainMap, x: number, z: number): boolean {
  const [a, b, c, d] = cellCornerHeights(map, x, z);
  return a === b && b === c && c === d;
}

/**
 * Axis a road runs along through (x, z): 'x' / 'z', null if it has no road
 * neighbours, 'bend' if it turns or branches (no level crossing there).
 */
export function roadAxisAt(map: TerrainMap, x: number, z: number): 'x' | 'z' | 'bend' | null {
  const ax = isRoad(map, x - 1, z) || isRoad(map, x + 1, z);
  const az = isRoad(map, x, z - 1) || isRoad(map, x, z + 1);
  if (ax && az) return 'bend';
  return ax ? 'x' : az ? 'z' : null;
}

/** Can a NEW track's footprint cover this cell (ignoring direction)? */
export function canRailCell(map: TerrainMap, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  const t = map.cells[x][z];
  if (t === CellType.Rail) return true; // crossing / joining existing track
  if (t === CellType.Empty || t === CellType.Hill) {
    return getSlopeKind(map, x, z) !== 'invalid' && cellRiseWithinOneStep(map, x, z);
  }
  if (t === CellType.Road) {
    // Level crossing: flat, straight road, no track there yet.
    return isFlat(map, x, z) && roadAxisAt(map, x, z) !== 'bend' && !hasRailAt(map, x, z);
  }
  return false;
}

/** May a track with direction (tx, tz) cross the road at (x, z)? (≥ 45°) */
export function crossesRoadOk(map: TerrainMap, x: number, z: number, tx: number, tz: number): boolean {
  const a = roadAxisAt(map, x, z);
  if (a === 'bend') return false;
  if (a === null) return true;
  return Math.abs(a === 'x' ? tx : tz) <= Math.SQRT1_2 + 1e-6;
}

/**
 * Road side of a level crossing: for a cell holding exactly one track, the
 * axis a ROAD must take through it (perpendicular-ish to the track), or null.
 */
export function roadCrossingAxis(map: TerrainMap, x: number, z: number): 'x' | 'z' | null {
  const tr = tracksAt(map, x, z);
  if (tr.length !== 1 || !isFlat(map, x, z)) return null;
  const { tx, tz } = tr[0];
  // Track within 45° of an axis → the road crosses on the other axis.
  const axis: 'x' | 'z' = Math.abs(tx) >= Math.abs(tz) ? 'z' : 'x';
  if (Math.abs(axis === 'x' ? tx : tz) > Math.SQRT1_2 + 1e-6) return null;
  return axis;
}

// ---------------------------------------------------------------- snapping

export interface NetSnap {
  edge: number;
  /** Arc length along the edge. */
  along: number;
  x: number;
  z: number;
  /** Track direction at the point; for an END snap it points OUT of the edge. */
  tx: number;
  tz: number;
  /** 'end' = a dead end (route continues it), 'mid' = branch / merge (switch). */
  kind: 'end' | 'mid';
}

/** Number of edge end points at (x, z). */
function degreeAt(net: RailNet, x: number, z: number): number {
  let d = 0;
  for (const e of net.edges) {
    const p = e.pts, L = p.length;
    if (Math.hypot(p[0] - x, p[1] - z) < 0.05) d++;
    if (Math.hypot(p[L - 2] - x, p[L - 1] - z) < 0.05) d++;
  }
  return d;
}

/** Snap a point onto the network (nearest track within `maxDist`), or null. */
export function snapToNet(net: RailNet, x: number, z: number, maxDist = SNAP_DIST): NetSnap | null {
  let best: { e: RailEdge; along: number; d: number } | null = null;
  for (const e of net.edges) {
    const p = e.pts;
    let acc = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d <= maxDist && (!best || d < best.d)) best = { e, along: acc + Math.sqrt(L2) * t, d };
      acc += Math.sqrt(L2);
    }
  }
  if (!best) return null;
  const w = new LineWalker(best.e.pts);
  const nearStart = best.along < SWITCH_CLEAR;
  const nearEnd = best.along > w.total - SWITCH_CLEAR;
  if (nearStart || nearEnd) {
    // Close to an end: a free (dead) end continues; a joint gets its switch
    // moved a little along the track instead of right on top of it.
    const atStart = nearStart && (!nearEnd || best.along < w.total / 2);
    const s = atStart ? 0 : w.total;
    const o = w.at(s);
    if (degreeAt(net, o[0], o[1]) === 1) {
      const sg = atStart ? -1 : 1;
      return { edge: best.e.id, along: s, x: o[0], z: o[1], tx: o[2] * sg, tz: o[3] * sg, kind: 'end' };
    }
    if (w.total < SWITCH_CLEAR * 2 + 0.2) return null;
    best.along = atStart ? SWITCH_CLEAR : w.total - SWITCH_CLEAR;
  }
  const o = w.at(best.along);
  return { edge: best.e.id, along: best.along, x: o[0], z: o[1], tx: o[2], tz: o[3], kind: 'mid' };
}

// ---------------------------------------------------------------- edits

/** Split the edge passing through (x, z) there (no-op at its ends). */
export function splitAtPoint(net: RailNet, x: number, z: number): RailNet {
  const s = snapToNet(net, x, z, 0.05);
  if (!s) return net;
  const e = net.edges.find((q) => q.id === s.edge)!;
  const w = new LineWalker(e.pts);
  // Exact along of the point (snapToNet may have nudged it — recompute).
  let along = s.along;
  {
    let acc = 0, bestD = Infinity;
    const p = e.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / L2));
      const d = Math.hypot(p[i] + dx * t - x, p[i + 1] + dz * t - z);
      if (d < bestD) {
        bestD = d;
        along = acc + Math.sqrt(L2) * t;
      }
      acc += Math.sqrt(L2);
    }
  }
  if (along < 0.05 || along > w.total - 0.05) return net;
  const a: RailEdge = { id: e.id, pts: w.sub(0, along) };
  const b: RailEdge = { id: net.nextId, pts: w.sub(along, w.total) };
  return { edges: net.edges.map((q) => (q === e ? a : q)).concat(b), nextId: net.nextId + 1 };
}

/** Add a new edge. */
export function addEdge(net: RailNet, pts: number[]): RailNet {
  return { edges: net.edges.concat({ id: net.nextId, pts }), nextId: net.nextId + 1 };
}

/**
 * Remove the track inside cell (x, z) (plus the margin its footprint needs),
 * splitting edges that pass through. Returns the same net if nothing changed.
 */
export function cutAtCell(net: RailNet, x: number, z: number): RailNet {
  const M = 0.5 + TRACK_HALF + 0.03;
  let changed = false;
  let nextId = net.nextId;
  const out: RailEdge[] = [];
  for (const e of net.edges) {
    const w = new LineWalker(e.pts);
    const STEP = 0.05;
    const n = Math.max(1, Math.ceil(w.total / STEP));
    const keep: Array<[number, number]> = [];
    let runStart = -1;
    let any = false;
    const o = [0, 0, 0, 0];
    for (let i = 0; i <= n; i++) {
      const s = (w.total * i) / n;
      w.at(s, o);
      const inside = Math.abs(o[0] - x) < M && Math.abs(o[1] - z) < M;
      if (inside) any = true;
      if (!inside && runStart < 0) runStart = s;
      if (inside && runStart >= 0) {
        keep.push([runStart, s]);
        runStart = -1;
      }
    }
    if (runStart >= 0) keep.push([runStart, w.total]);
    if (!any) {
      out.push(e);
      continue;
    }
    changed = true;
    let first = true;
    for (const [a, b] of keep) {
      if (b - a < 0.3) continue;
      out.push({ id: first ? e.id : nextId++, pts: w.sub(a, b) });
      first = false;
    }
  }
  return changed ? { edges: out, nextId } : net;
}
