/**
 * railRoute — plans a smooth rail line from A to B.
 *
 *   1. SNAP: A / B near an existing track snap onto it. A dead end is
 *      continued straight on; anywhere else along a track the new line
 *      branches off / merges in TANGENTIALLY (a switch) — it leaves A along the
 *      track (toward the cursor's side) and arrives at B along the track.
 *   2. GRID A*: an 8-neighbour search over rail-buildable cells, with extra
 *      cost near obstacles (keeps room for curves), finds a corridor.
 *   3. STRAIGHTEN: the zig-zag cell path is string-pulled into a few long
 *      straight legs at ANY angle (line-of-sight with a safety margin).
 *   4. CURVES: every bend becomes a circular arc, radius RAIL_R_PREF (10
 *      cells) when there's room, never below RAIL_R_MIN (5 cells). A bend that
 *      can't get that radius — or an arc that would hit an obstacle — makes the
 *      plan BLOCKED (red): the game never lays a curve a train couldn't take.
 *   5. VALIDATE the final centre-line's footprint against the build rules.
 *
 * Pure TypeScript.
 */

import {
  canRailCell,
  crossesRoadOk,
  EMPTY_NET,
  forEachSample,
  LineWalker,
  RAIL_R_MIN,
  RAIL_R_PREF,
  snapToNet,
  TRACK_HALF,
  tracksAt,
  type NetSnap,
} from './railNet';
import { CellType, HILL_STEP, type TerrainMap } from './terrain';

export interface RailPlan {
  /** Planned centre-line [x0, z0, …] in grid coords. */
  pts: number[];
  blocked: boolean;
  /** Why it's blocked (Hungarian, shown in the UI), or null. */
  reason: string | null;
  /** Length in cells (cost basis). */
  length: number;
  start: NetSnap | null;
  end: NetSnap | null;
}

type P = [number, number];

const DEG = Math.PI / 180;
/** Sharpest single bend allowed (the arc's turning angle). */
const MAX_BEND = 150 * DEG;
/** Length near a join where running along the old track is expected. */
const JOIN_ZONE = 7;

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);
const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];

// ------------------------------------------------------- per-map caches

interface Grid {
  pass: Uint8Array;
  /** Extra cost per cell for hugging obstacles. */
  near: Float32Array;
}
const gridCache = new WeakMap<TerrainMap, Grid>();

function gridOf(map: TerrainMap): Grid {
  const hit = gridCache.get(map);
  if (hit) return hit;
  const n = map.size;
  const pass = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) pass[x * n + z] = canRailCell(map, x, z) ? 1 : 0;
  // Chebyshev distance to the nearest blocked cell, up to 3.
  const dist = new Uint8Array(n * n).fill(3);
  const q: number[] = [];
  for (let c = 0; c < n * n; c++) if (!pass[c]) {
    dist[c] = 0;
    q.push(c);
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = (c / n) | 0, z = c - x * n;
    if (dist[c] >= 2) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k = nx * n + nz;
      if (dist[k] > dist[c] + 1) {
        dist[k] = dist[c] + 1;
        q.push(k);
      }
    }
  }
  const near = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) near[c] = dist[c] === 1 ? 1.5 : dist[c] === 2 ? 0.5 : 0;
  const g = { pass, near };
  gridCache.set(map, g);
  return g;
}

// ------------------------------------------------------- grid A*

function gridAStar(map: TerrainMap, grid: Grid, s: P, t: P): { cells: P[]; reached: boolean } {
  const n = map.size;
  const si = s[0] * n + s[1], ti = t[0] * n + t[1];
  const g = new Float64Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heapI: number[] = [];
  const heapF: number[] = [];
  const push = (i: number, f: number) => {
    heapI.push(i);
    heapF.push(f);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heapI[0];
    const li = heapI.pop()!, lf = heapF.pop()!;
    if (heapI.length) {
      heapI[0] = li;
      heapF[0] = lf;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heapI.length && heapF[l] < heapF[m]) m = l;
        if (r < heapI.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
        k = m;
      }
    }
    return top;
  };
  const oct = (x: number, z: number) => {
    const a = Math.abs(x - t[0]), b = Math.abs(z - t[1]);
    return Math.max(a, b) - Math.min(a, b) + Math.SQRT2 * Math.min(a, b);
  };
  g[si] = 0;
  push(si, oct(s[0], s[1]));
  let best = si, bestH = oct(s[0], s[1]);
  const H = map.heights;
  while (heapI.length) {
    const c = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === ti) {
      best = c;
      bestH = 0;
      break;
    }
    const x = (c / n) | 0, z = c - x * n;
    const hh = oct(x, z);
    if (hh < bestH) {
      bestH = hh;
      best = c;
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k = nx * n + nz;
      if (!grid.pass[k] || closed[k]) continue;
      if (dx && dz && (!grid.pass[nx * n + z] || !grid.pass[x * n + nz])) continue;
      if (Math.abs(H[nx][nz] - H[x][z]) > HILL_STEP + 1e-6) continue;
      const step = (dx && dz ? Math.SQRT2 : 1) * (1 + grid.near[k]) + (map.cells[nx][nz] === CellType.Rail ? 0.8 : 0);
      const ng = g[c] + step;
      if (ng < g[k]) {
        g[k] = ng;
        from[k] = c;
        push(k, ng + oct(nx, nz));
      }
    }
  }
  const cells: P[] = [];
  for (let c = best; c >= 0; c = from[c]) {
    const x = (c / n) | 0;
    cells.push([x, c - x * n]);
  }
  cells.reverse();
  return { cells, reached: best === ti };
}

// ------------------------------------------------------- corridor checks

/** Is the band of half-width `half` around a → b buildable? */
function clearSeg(map: TerrainMap, grid: Grid, a: P, b: P, half: number): boolean {
  const n = map.size;
  const L = len(sub(b, a));
  if (L < 1e-6) return true;
  const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
  const k = Math.max(1, Math.ceil((half * 2) / 0.4));
  const steps = Math.max(1, Math.ceil(L / 0.25));
  let prevH: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + (b[0] - a[0]) * (i / steps);
    const z = a[1] + (b[1] - a[1]) * (i / steps);
    for (let j = 0; j <= k; j++) {
      const o = -half + (2 * half * j) / k;
      const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
      if (cx < 0 || cz < 0 || cx >= n || cz >= n || !grid.pass[cx * n + cz]) return false;
      if (map.cells[cx][cz] === CellType.Road && !crossesRoadOk(map, cx, cz, tx, tz)) return false;
    }
    const cx = Math.round(x), cz = Math.round(z);
    const h = map.heights[cx][cz];
    if (prevH !== null && Math.abs(h - prevH) > HILL_STEP + 1e-6) return false;
    prevH = h;
  }
  return true;
}

/** Final check of a centre-line; returns a Hungarian reason or null if OK. */
function validate(map: TerrainMap, grid: Grid, pts: number[], start: NetSnap | null, end: NetSnap | null): string | null {
  const n = map.size;
  const total = new LineWalker(pts).total;
  let reason: string | null = null;
  let prevH: number | null = null;
  forEachSample(pts, 0.15, (x, z, tx, tz, s) => {
    if (reason) return;
    for (const o of [-TRACK_HALF, 0, TRACK_HALF]) {
      const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
      if (cx < 0 || cz < 0 || cx >= n || cz >= n || !grid.pass[cx * n + cz]) {
        reason = 'Az ív akadályba ütközik';
        return;
      }
      if (map.cells[cx][cz] === CellType.Road && !crossesRoadOk(map, cx, cz, tx, tz)) {
        reason = 'Az utat csak keresztben lehet átszelni';
        return;
      }
    }
    const cx = Math.round(x), cz = Math.round(z);
    const h = map.heights[cx][cz];
    if (prevH !== null && Math.abs(h - prevH) > HILL_STEP + 1e-6) {
      reason = 'Túl meredek';
      return;
    }
    prevH = h;
    // Running along an existing track (outside the join zones) = overlap.
    const inJoin = (start && s < JOIN_ZONE) || (end && s > total - JOIN_ZONE);
    if (!inJoin) {
      for (const tr of tracksAt(map, cx, cz)) {
        if (Math.abs(tr.tx * tx + tr.tz * tz) > Math.cos(20 * DEG)) {
          reason = 'Egy meglévő sínre futna rá';
          return;
        }
      }
    }
  });
  return reason;
}

// ------------------------------------------------------- straighten + curves

/** Greedy line-of-sight string pulling of chain[i0..i1]. */
function stringPull(map: TerrainMap, grid: Grid, chain: P[], i0: number, i1: number, half: number): P[] {
  const out: P[] = chain.slice(0, i0 + 1);
  let i = i0;
  while (i < i1) {
    let j = i + 1;
    while (j + 1 <= i1 && clearSeg(map, grid, chain[i], chain[j + 1], half)) j++;
    out.push(chain[j]);
    i = j;
  }
  return out.concat(chain.slice(i1 + 1));
}

/** Turning angle and tangent length of every corner (fair sharing of legs). */
function cornerPlan(pts: P[], rPref = RAIL_R_PREF): { theta: number[]; t: number[] } {
  const m = pts.length - 1;
  const theta = new Array<number>(m + 1).fill(0);
  const want = new Array<number>(m + 1).fill(0);
  const t = new Array<number>(m + 1).fill(0);
  if (m < 2) return { theta, t };
  const seg: number[] = [];
  for (let k = 0; k < m; k++) seg.push(len(sub(pts[k + 1], pts[k])));
  for (let i = 1; i < m; i++) {
    const u = norm(sub(pts[i], pts[i - 1]));
    const w = norm(sub(pts[i + 1], pts[i]));
    theta[i] = Math.acos(Math.min(1, Math.max(-1, dot(u, w))));
    want[i] = theta[i] < 0.5 * DEG ? 0 : rPref * Math.tan(Math.min(theta[i], MAX_BEND) / 2);
  }
  const scale: number[] = [];
  for (let k = 0; k < m; k++) {
    const need = (k > 0 ? want[k] : 0) + (k + 1 < m ? want[k + 1] : 0);
    scale.push(need > seg[k] ? seg[k] / need : 1);
  }
  for (let i = 1; i < m; i++) t[i] = want[i] * Math.min(scale[i - 1], scale[i]);
  return { theta, t };
}

/** Radius each corner would get (Infinity = straight through). */
function cornerRadii(pts: P[]): number[] {
  const { theta, t } = cornerPlan(pts);
  return theta.map((th, i) =>
    th > MAX_BEND ? 0 : t[i] === 0 ? Infinity : t[i] / Math.tan(Math.min(th, MAX_BEND) / 2),
  );
}

/**
 * Repair corners that can't get RAIL_R_MIN: drop the offending vertex (or a
 * neighbour, or both) whenever the straight replacement leg is still clear,
 * choosing the option with the widest resulting curve. Vertices in `fixed`
 * (lead-out points of a tangential join, the two ends) are kept.
 */
function repairCorners(map: TerrainMap, grid: Grid, pts: P[], fixed: (i: number, n: number) => boolean): P[] {
  let cur = pts;
  for (let iter = 0; iter < 40; iter++) {
    const R = cornerRadii(cur);
    let worst = -1;
    for (let i = 1; i < cur.length - 1; i++) if (R[i] < RAIL_R_MIN - 1e-6 && (worst < 0 || R[i] < R[worst])) worst = i;
    if (worst < 0) return cur;
    let best: P[] | null = null;
    let bestScore = -Infinity;
    for (const drop of [[0], [-1], [1], [-1, 0], [0, 1], [-1, 0, 1], [0, 1, 2], [-2, -1, 0]]) {
      const idx = drop.map((d) => worst + d);
      if (idx.some((i) => i <= 0 || i >= cur.length - 1 || fixed(i, cur.length))) continue;
      const a = Math.min(...idx) - 1, b = Math.max(...idx) + 1;
      if (!clearSeg(map, grid, cur[a], cur[b], TRACK_HALF + 0.1)) continue;
      const cand = cur.filter((_, i) => !idx.includes(i));
      const r = cornerRadii(cand);
      const lo = Math.min(...r.slice(Math.max(1, a - 1), Math.min(cand.length - 1, a + 3)));
      const score = Math.min(lo, RAIL_R_PREF * 2) - drop.length * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    // No vertex can simply go: try MOVING the sharp corner or a neighbour a
    // few cells so both legs stay clear and the curve gets wider.
    const curLo = Math.min(...R.slice(Math.max(1, worst - 1), Math.min(cur.length - 1, worst + 2)));
    for (const k of [worst, worst - 1, worst + 1]) {
      if (k <= 0 || k >= cur.length - 1 || fixed(k, cur.length)) continue;
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (!dx && !dz) continue;
          const v: P = [cur[k][0] + dx, cur[k][1] + dz];
          if (!clearSeg(map, grid, cur[k - 1], v, TRACK_HALF + 0.1)) continue;
          if (!clearSeg(map, grid, v, cur[k + 1], TRACK_HALF + 0.1)) continue;
          const cand = cur.slice();
          cand[k] = v;
          const r = cornerRadii(cand);
          const lo = Math.min(...r.slice(Math.max(1, worst - 2), Math.min(cand.length - 1, worst + 3)));
          const score = Math.min(lo, RAIL_R_PREF * 2) - Math.hypot(dx, dz) * 0.01;
          if (lo > curLo + 1e-6 && score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
      }
    }
    if (!best) return cur;
    cur = best;
  }
  return cur;
}

/**
 * Round every interior corner of `pts` with a circular arc. The tangent
 * lengths are shared fairly between neighbouring corners; the radius is
 * RAIL_R_PREF when it fits, shrunk as needed, never below RAIL_R_MIN.
 */
function fillet(pts: P[], rPref = RAIL_R_PREF): { line: number[]; reason: string | null } {
  const m = pts.length - 1;
  const line: number[] = [];
  if (m < 1) {
    for (const p of pts) line.push(p[0], p[1]);
    return { line, reason: null };
  }
  const { theta, t: tan } = cornerPlan(pts, rPref);
  let reason: string | null = null;
  for (let i = 1; i < m; i++) if (theta[i] > MAX_BEND) reason = 'Túl éles kanyar';
  line.push(pts[0][0], pts[0][1]);
  for (let i = 1; i < m; i++) {
    if (tan[i] === 0) {
      line.push(pts[i][0], pts[i][1]);
      continue;
    }
    const t = tan[i];
    const half = Math.min(theta[i], MAX_BEND) / 2;
    const R = t / Math.tan(half);
    if (R < RAIL_R_MIN - 1e-6 && !reason) reason = 'Túl éles kanyar – nincs hely az ívnek';
    const u = norm(sub(pts[i], pts[i - 1]));
    const w = norm(sub(pts[i + 1], pts[i]));
    const cross = u[0] * w[1] - u[1] * w[0];
    const T1: P = [pts[i][0] - u[0] * t, pts[i][1] - u[1] * t];
    const nrm: P = cross > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
    const C: P = [T1[0] + nrm[0] * R, T1[1] + nrm[1] * R];
    const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const sweep = theta[i] * (cross > 0 ? 1 : -1);
    const steps = Math.max(2, Math.ceil((R * theta[i]) / 0.2));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (sweep * k) / steps;
      line.push(C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R);
    }
  }
  line.push(pts[m][0], pts[m][1]);
  // Drop duplicate consecutive points.
  const out: number[] = [line[0], line[1]];
  for (let i = 2; i < line.length; i += 2) {
    if (Math.hypot(line[i] - out[out.length - 2], line[i + 1] - out[out.length - 1]) > 1e-4) out.push(line[i], line[i + 1]);
  }
  return { line: out, reason };
}

/** Straight lead-out length so the first bend can still get RAIL_R_PREF. */
function leadLen(dir: P, from: P, toward: P, r: number): number {
  const d = norm(sub(toward, from));
  const th = Math.min(Math.acos(Math.min(1, Math.max(-1, dot(dir, d)))), 100 * DEG);
  return Math.min(14, Math.max(1.5, r * Math.tan(th / 2) + 0.5));
}

/** Radii tried, widest first: never below RAIL_R_MIN. */
const RADII = [RAIL_R_PREF, (RAIL_R_PREF + RAIL_R_MIN) / 2, RAIL_R_MIN];

// ------------------------------------------------------- main

export function planRail(map: TerrainMap, a: { x: number; z: number }, b: { x: number; z: number }): RailPlan {
  const net = map.railNet ?? EMPTY_NET;
  const grid = gridOf(map);
  const empty = (reason: string | null): RailPlan => ({ pts: [], blocked: reason !== null, reason, length: 0, start: null, end: null });

  const S = snapToNet(net, a.x, a.z);
  let E = snapToNet(net, b.x, b.z);
  const sp: P = S ? [S.x, S.z] : [Math.round(a.x), Math.round(a.z)];
  let ep: P = E ? [E.x, E.z] : [Math.round(b.x), Math.round(b.z)];
  if (E && S && Math.hypot(E.x - S.x, E.z - S.z) < 1) E = null;
  if (!E) ep = [Math.round(b.x), Math.round(b.z)];
  if (Math.hypot(ep[0] - sp[0], ep[1] - sp[1]) < 1) return empty(null);
  const n = map.size;
  if (!S && !grid.pass[sp[0] * n + sp[1]]) return empty('Ide nem építhető sín');

  // Direction constraints at the ends (tangential joins).
  let Ts: P | null = null;
  if (S) {
    Ts = [S.tx, S.tz];
    if (S.kind === 'mid' && dot(Ts, sub(ep, sp)) < 0) Ts = [-Ts[0], -Ts[1]];
  }
  let Te: P | null = null; // direction of travel ARRIVING at the end
  if (E) {
    Te = E.kind === 'end' ? [-E.tx, -E.tz] : [E.tx, E.tz];
    if (E.kind === 'mid' && dot(Te, sub(ep, sp)) < 0) Te = [-Te[0], -Te[1]];
  }
  let first: RailPlan | null = null;
  for (const rLead of RADII) {
    const plan = attempt(rLead);
    if (plan && !plan.blocked) return plan;
    if (plan) first ??= plan;
    if (!Ts && !Te) break; // no lead-outs: the radius loop below is enough
  }
  return first ?? { ...empty('Nincs hely a csatlakozáshoz'), start: S, end: E };

  function attempt(rLead: number): RailPlan | null {
  let W0: P | null = null, We: P | null = null;
  for (let it = 0; it < 2; it++) {
    if (Ts) {
      const L = leadLen(Ts, sp, We ?? ep, rLead);
      W0 = [sp[0] + Ts[0] * L, sp[1] + Ts[1] * L];
    }
    if (Te) {
      const back: P = [-Te[0], -Te[1]];
      const L = leadLen(back, ep, W0 ?? sp, rLead);
      We = [ep[0] - Te[0] * L, ep[1] - Te[1] * L];
    }
  }
  const inB = (p: P) => p[0] >= 0 && p[1] >= 0 && p[0] <= n - 1 && p[1] <= n - 1;
  if ((W0 && !inB(W0)) || (We && !inB(We))) return null;
  if (W0 && !clearSeg(map, grid, sp, W0, TRACK_HALF)) return null;
  if (We && !clearSeg(map, grid, We, ep, TRACK_HALF)) return null;

  const g0 = W0 ?? sp, g1 = We ?? ep;
  const gs: P = [Math.round(g0[0]), Math.round(g0[1])];
  const ge: P = [Math.round(g1[0]), Math.round(g1[1])];
  const path = gridAStar(map, grid, gs, ge);

  // Waypoint chain: fixed lead legs + the grid corridor.
  const chain: P[] = [];
  if (W0) chain.push(sp);
  const i0 = chain.length;
  chain.push(g0);
  for (let k = 1; k < path.cells.length - 1; k++) chain.push(path.cells[k]);
  const tail: P = path.reached ? g1 : path.cells[path.cells.length - 1];
  if (len(sub(tail, chain[chain.length - 1])) > 1e-6) chain.push(tail);
  const i1 = chain.length - 1;
  if (path.reached && We) chain.push(ep);

  let worst: RailPlan | null = null;
  for (const half of [0.9, 0.45]) {
    let pulled = stringPull(map, grid, chain, i0, i1, half);
    const lead0 = W0 ? 1 : 0;
    const lead1 = path.reached && We ? 1 : 0;
    pulled = repairCorners(map, grid, pulled, (i, n) => i <= lead0 || i >= n - 1 - lead1);
    for (const rp of RADII) {
      const { line, reason: bend } = fillet(pulled, rp);
      const reason = bend ?? validate(map, grid, line, S, path.reached ? E : null);
      const plan: RailPlan = {
        pts: line,
        blocked: !path.reached || reason !== null,
        reason: !path.reached ? 'Nem vezethető el idáig' : reason,
        length: new LineWalker(line).total,
        start: S,
        end: path.reached ? E : null,
      };
      if (!plan.blocked) return plan;
      worst ??= plan;
      if (!path.reached) break;
    }
  }
  return worst;
  }
}
