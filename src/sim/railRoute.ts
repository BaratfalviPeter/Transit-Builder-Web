/**
 * railRoute — plans a grid-bound rail line from A to B.
 *
 * Every track is built from a small set of LATTICE PIECES that start and end
 * on cell centres, heading in one of the 8 octilinear directions:
 *
 *   - STRAIGHT: one cell along an axis (length 1) or diagonally (√2).
 *   - 45° CURVE: an arc of radius k·(1+√2) — the radius at which an arc
 *     leaving a cell centre along an axis runs out exactly onto a diagonal
 *     through cell centres (and vice versa). k = 1, 2, 3 → R ≈ 2.4 / 4.8 / 7.2
 *     cells. A 90° turn is two 45° pieces, so S-bends come for free.
 *   - TIGHT 90° CURVE: a quarter circle from cell centre to cell centre —
 *     radius 1 or 2 from an axis heading, √2 or 2√2 from a diagonal one
 *     (trains slow right down in them).
 *
 *   1. SNAP: A / B near an existing track snap onto it — onto a dead end (the
 *      line continues it) or onto a cell centre of a straight stretch (the new
 *      line branches off / merges in through a curve = a switch).
 *   2. LATTICE A*: a search over (cell, heading) states whose moves are the
 *      pieces above; each piece's cell footprint is precomputed, so checking
 *      it against the build rules is cheap. Turns cost extra (fewest bends,
 *      wider curves preferred).
 *   3. VALIDATE the final centre-line's footprint against the build rules.
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
  roadAxisAt,
  snapToNet,
  SWITCH_CLEAR,
  TRACK_HALF,
  tracksAt,
  type NetSnap,
  type RailNet,
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
/** Length near a join where running along the old track is expected. */
const JOIN_ZONE = 7;
/** Curve sizes offered (radius = k · RAIL_R_MIN). */
const CURVE_K = [1, 2, 3];
/** Extra cost of a 45° curve piece, by k (tighter = dearer). */
const TURN_COST: Record<number, number> = { 1: 4, 2: 3.3, 3: 3 };
/** Tight 90° curves (radius in lattice steps: 1 or 2) and their extra cost. */
const TIGHT_K = [1, 2];
const TIGHT_COST: Record<number, number> = { 1: 7, 2: 5.5 };
/** Extra cost per footprint cell already holding track (crossing). */
const CROSS_COST = 0.5;
/** Extra cost per footprint cell running along a track inside a join zone. */
const ALONG_COST = 1.5;
/** Heuristic weight (> 1 trades a little optimality for speed). */
const H_WEIGHT = 1.1;
/** Search budget (expanded states) before settling for the closest reach. */
const MAX_EXPAND = 40000;

/** Unit step of heading d (0 = +x, counter-clockwise in 45° steps). */
const DIR: ReadonlyArray<P> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Heading index of a unit direction, or -1 if it isn't octilinear. */
function headingOf(tx: number, tz: number): number {
  const a = Math.atan2(tz, tx) / (45 * DEG);
  const d = Math.round(a);
  if (Math.abs(a - d) > 0.01) return -1;
  return ((d % 8) + 8) % 8;
}

// ------------------------------------------------------- lattice pieces

interface Move {
  /** End offset (cells) and heading. */
  dx: number;
  dz: number;
  dEnd: number;
  turn: boolean;
  cost: number;
  len: number;
  /** Centre-line, relative to the start node (first point = 0, 0). */
  pts: number[];
  /** Footprint cells [dx, dz, …] and the track direction in each. */
  cells: Int32Array;
  dirs: Float32Array;
  /** Centre cells in travel order (slope check). */
  spine: Int32Array;
}

/** Arc E → NE (left turn) of radius k·(1+√2) plus the short diagonal run-out. */
function axisCurve(k: number): P[] {
  const R = k * RAIL_R_MIN;
  const out: P[] = [];
  const steps = Math.max(4, Math.ceil((R * Math.PI) / 4 / 0.15));
  for (let i = 0; i <= steps; i++) {
    const f = ((Math.PI / 4) * i) / steps;
    out.push([R * Math.sin(f), R * (1 - Math.cos(f))]);
  }
  const ex = Math.ceil(out[out.length - 1][0] - 1e-6);
  const end: P = [ex, ex - k];
  if (Math.hypot(end[0] - out[out.length - 1][0], end[1] - out[out.length - 1][1]) > 1e-6) out.push(end);
  return out;
}

function buildMove(raw: P[], dEnd: number, turn: boolean, extra: number): Move {
  const pts: number[] = [];
  for (const [x, z] of raw) pts.push(x, z);
  const last = raw[raw.length - 1];
  const len = new LineWalker(pts).total;
  const cells: number[] = [];
  const dirs: number[] = [];
  const spine: number[] = [];
  const seen = new Set<string>();
  forEachSample(pts, 0.1, (x, z, tx, tz) => {
    for (const o of [-TRACK_HALF, 0, TRACK_HALF]) {
      const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
      // One entry per cell AND direction (5° steps): a curve crosses a cell
      // at several angles, and every one of them must pass the rules.
      const key = `${cx},${cz},${Math.round(Math.atan2(tz, tx) / (5 * DEG))}`;
      if (o === 0 && (spine.length < 2 || spine[spine.length - 2] !== cx || spine[spine.length - 1] !== cz)) {
        spine.push(cx, cz);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cx, cz);
      dirs.push(tx, tz);
    }
  });
  return {
    dx: Math.round(last[0]),
    dz: Math.round(last[1]),
    dEnd,
    turn,
    cost: len + extra,
    len,
    pts,
    cells: Int32Array.from(cells),
    dirs: Float32Array.from(dirs),
    spine: Int32Array.from(spine),
  };
}

/**
 * Quarter circle turning left from heading 0 (+x) by 90°, radius r, centre
 * (0, r): from (0, 0) to (r, r). For a diagonal start it is rotated by 45°
 * and scaled by √2 (radius r√2: end (0, 2r) from heading 1).
 */
function quarter(r: number, diagonal: boolean): P[] {
  const out: P[] = [];
  const R = diagonal ? r * Math.SQRT2 : r;
  const steps = Math.max(6, Math.ceil((R * Math.PI) / 2 / 0.12));
  for (let i = 0; i <= steps; i++) {
    const f = ((Math.PI / 2) * i) / steps;
    let x = R * Math.sin(f), z = R * (1 - Math.cos(f));
    if (diagonal) [x, z] = [(x - z) * Math.SQRT1_2, (x + z) * Math.SQRT1_2];
    out.push([x, z]);
  }
  // Exact lattice end.
  out[out.length - 1] = diagonal ? [0, 2 * r] : [r, r];
  return out;
}

/** Rotate by q quarter turns counter-clockwise. */
const rot = (p: P, q: number): P => {
  let [x, z] = p;
  for (let i = 0; i < q; i++) [x, z] = [-z, x];
  return [x, z];
};

/** MOVES[d] = every piece that can follow heading d. Built once. */
const MOVES: Move[][] = (() => {
  // Local templates for start heading 0 (axis) and 1 (diagonal), as
  // [points, heading change].
  const axis: Array<[P[], number, number]> = [];
  const diag: Array<[P[], number, number]> = [];
  for (const k of CURVE_K) {
    const left = axisCurve(k); // 0 → 1
    axis.push([left, 1, k]);
    axis.push([left.map(([x, z]) => [x, -z] as P), -1, k]); // 0 → 7
    // Reversed and turned around, the axis curve is a diagonal → axis piece.
    const end = left[left.length - 1];
    const right = left.slice().reverse().map(([x, z]) => [end[0] - x, end[1] - z] as P); // 1 → 0
    diag.push([right, -1, k]);
    diag.push([right.map(([x, z]) => [z, x] as P), 1, k]); // 1 → 2
  }
  // Tight 90° pieces (cost key 10 + r): left and right.
  for (const r of TIGHT_K) {
    const a = quarter(r, false), d = quarter(r, true);
    axis.push([a, 2, 10 + r]);
    axis.push([a.map(([x, z]) => [x, -z] as P), -2, 10 + r]);
    // Mirror a diagonal-start piece about the heading-1 line (x ↔ z).
    diag.push([d, 2, 10 + r]);
    diag.push([d.map(([x, z]) => [z, x] as P), -2, 10 + r]);
  }
  const moves: Move[][] = [];
  for (let d = 0; d < 8; d++) {
    const q = d >> 1;
    const list: Move[] = [buildMove([[0, 0], DIR[d]], d, false, 0)];
    for (const [tpl, dh, k] of d & 1 ? diag : axis) {
      list.push(buildMove(tpl.map((p) => rot(p, q)), (d + dh + 8) % 8, true, k > 10 ? TIGHT_COST[k - 10] : TURN_COST[k]));
    }
    moves.push(list);
  }
  return moves;
})();

/** Pieces per heading: one straight + a left and a right curve per size (45° and tight 90°). */
const MOVES_PER = 1 + 2 * CURVE_K.length + 2 * TIGHT_K.length;

// ------------------------------------------------------- per-map caches

const passCache = new WeakMap<TerrainMap, Uint8Array>();
/**
 * Per map, per (cell, heading, move): 0 = not yet checked, 1 = buildable,
 * 2 = buildable but touches track (needs the per-plan join check), 3 = not
 * buildable. The terrain part of a piece's check never changes between two
 * hovers on the same map, so it is done once.
 */
const pieceCache = new WeakMap<TerrainMap, Uint8Array>();

/** Terrain / road part of a piece's check from (x, z): 1 OK, 2 OK but touches track, 3 not buildable. */
function pieceTerrain(map: TerrainMap, m: Move, x: number, z: number): number {
  const n = map.size;
  const pass = passOf(map);
  const H = map.heights;
  let touches = false;
  const c = m.cells;
  for (let i = 0; i < c.length; i += 2) {
    const cx = x + c[i], cz = z + c[i + 1];
    if (cx < 0 || cz < 0 || cx >= n || cz >= n || !pass[cx * n + cz]) return 3;
    const t = map.cells[cx][cz];
    if (t === CellType.Road) {
      const a = roadAxisAt(map, cx, cz);
      if (a === 'bend' || (a && Math.abs(a === 'x' ? m.dirs[i] : m.dirs[i + 1]) > Math.SQRT1_2 + 1e-6)) return 3;
    } else if (t === CellType.Rail) touches = true;
  }
  const s = m.spine;
  for (let i = 2; i < s.length; i += 2) {
    if (Math.abs(H[x + s[i]][z + s[i + 1]] - H[x + s[i - 2]][z + s[i - 1]]) > HILL_STEP + 1e-6) return 3;
  }
  return touches ? 2 : 1;
}

function passOf(map: TerrainMap): Uint8Array {
  const hit = passCache.get(map);
  if (hit) return hit;
  const n = map.size;
  const pass = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) pass[x * n + z] = canRailCell(map, x, z) ? 1 : 0;
  passCache.set(map, pass);
  return pass;
}

const compCache = new WeakMap<TerrainMap, Int32Array>();

/**
 * Connected regions of rail-buildable cells (8-neighbour, at most one hill
 * step apart). Lets the planner see at once that B can't be reached from A,
 * instead of exhausting the whole lattice search.
 */
function compOf(map: TerrainMap): Int32Array {
  const hit = compCache.get(map);
  if (hit) return hit;
  const n = map.size;
  const pass = passOf(map);
  const H = map.heights;
  const comp = new Int32Array(n * n).fill(-1);
  const q: number[] = [];
  let id = 0;
  for (let c0 = 0; c0 < n * n; c0++) {
    if (!pass[c0] || comp[c0] >= 0) continue;
    comp[c0] = id;
    q.length = 0;
    q.push(c0);
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const x = (c / n) | 0, z = c - x * n;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nx = x + dx, nz = z + dz;
        if ((!dx && !dz) || nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const k = nx * n + nz;
        if (!pass[k] || comp[k] >= 0) continue;
        if (dx && dz && (!pass[nx * n + z] || !pass[x * n + nz])) continue;
        if (Math.abs(H[nx][nz] - H[x][z]) > HILL_STEP + 1e-6) continue;
        comp[k] = id;
        q.push(k);
      }
    }
    id++;
  }
  compCache.set(map, comp);
  return comp;
}

// ------------------------------------------------------- snapping

/**
 * Pull a network snap onto the lattice: a dead end must already sit on a cell
 * centre with an octilinear heading; a mid-track snap moves to the nearest
 * cell centre on a straight (octilinear) stretch of that edge.
 */
function latticeSnap(net: RailNet, s: NetSnap, cx: number, cz: number): NetSnap | null {
  const onNode = (x: number, z: number) => Math.abs(x - Math.round(x)) < 1e-3 && Math.abs(z - Math.round(z)) < 1e-3;
  if (s.kind === 'end') {
    if (!onNode(s.x, s.z) || headingOf(s.tx, s.tz) < 0) return null;
    return { ...s, x: Math.round(s.x), z: Math.round(s.z) };
  }
  const e = net.edges.find((q) => q.id === s.edge);
  if (!e) return null;
  const p = e.pts;
  const total = new LineWalker(p).total;
  let best: NetSnap | null = null;
  let bestD = Infinity;
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1];
    const L = Math.hypot(p[i + 2] - ax, p[i + 3] - az);
    const tx = (p[i + 2] - ax) / (L || 1), tz = (p[i + 3] - az) / (L || 1);
    const h = headingOf(tx, tz);
    if (h >= 0 && L > 1e-6) {
      // Step through the cell centres lying on this straight segment.
      const step = Math.hypot(DIR[h][0], DIR[h][1]);
      // First whole x (or z, for a z-axis run) at or after the segment start.
      const [p0, u] = DIR[h][0] ? [ax, DIR[h][0]] : [az, DIR[h][1]];
      const t0 = (u > 0 ? Math.ceil(p0 - 1e-6) - p0 : p0 - Math.floor(p0 + 1e-6)) * step;
      for (let t = t0; t <= L + 1e-6; t += step) {
        const x = ax + tx * t, z = az + tz * t;
        if (!onNode(x, z)) continue;
        const along = acc + t;
        if (along < SWITCH_CLEAR - 1e-6 || along > total - SWITCH_CLEAR + 1e-6) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (d < bestD) {
          bestD = d;
          best = { edge: e.id, along, x: Math.round(x), z: Math.round(z), tx: DIR[h][0] / step, tz: DIR[h][1] / step, kind: 'mid' };
        }
      }
    }
    acc += L;
  }
  return best && bestD <= 1.5 ? best : null;
}

// ------------------------------------------------------- lattice A*

interface Search {
  states: number[];
  reached: boolean;
}

function latticeAStar(
  map: TerrainMap,
  sp: P,
  ep: P,
  startDirs: number[],
  goalDirs: number[] | null,
  start: NetSnap | null,
  end: NetSnap | null,
): Search {
  const startMid = start?.kind === 'mid', endMid = end?.kind === 'mid';
  const n = map.size;
  const N = n * n * 8;
  const g = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  // Binary min-heap on typed arrays (grows on demand).
  let heapI = new Int32Array(4096);
  let heapF = new Float64Array(4096);
  let size = 0;
  const push = (i: number, f: number) => {
    if (size === heapI.length) {
      const ni = new Int32Array(size * 2);
      ni.set(heapI);
      heapI = ni;
      const nf = new Float64Array(size * 2);
      nf.set(heapF);
      heapF = nf;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= f) break;
      heapI[k] = heapI[p];
      heapF[k] = heapF[p];
      k = p;
    }
    heapI[k] = i;
    heapF[k] = f;
  };
  const pop = () => {
    const top = heapI[0];
    const li = heapI[--size], lf = heapF[size];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      if (l >= size) break;
      const m = r < size && heapF[r] < heapF[l] ? r : l;
      if (heapF[m] >= lf) break;
      heapI[k] = heapI[m];
      heapF[k] = heapF[m];
      k = m;
    }
    heapI[k] = li;
    heapF[k] = lf;
    return top;
  };
  const oct = (x: number, z: number) => {
    const a = Math.abs(x - ep[0]), b = Math.abs(z - ep[1]);
    return Math.max(a, b) - Math.min(a, b) + Math.SQRT2 * Math.min(a, b);
  };
  const isGoal = (x: number, z: number, d: number) =>
    x === ep[0] && z === ep[1] && (!goalDirs || goalDirs.includes(d));
  const nearJoin = (x: number, z: number) =>
    (start && Math.hypot(x - sp[0], z - sp[1]) < JOIN_ZONE) || (end && Math.hypot(x - ep[0], z - ep[1]) < JOIN_ZONE);
  const startNode = sp[0] * n + sp[1];

  let cache = pieceCache.get(map);
  if (!cache) pieceCache.set(map, (cache = new Uint8Array(n * n * 8 * MOVES_PER)));
  const staticCheck = (m: Move, x: number, z: number) => pieceTerrain(map, m, x, z);

  /** Extra cost of laying `m` from (x, z), or -1 if it can't be built. */
  const pieceCost = (m: Move, x: number, z: number, slot: number): number => {
    let st = cache[slot];
    if (!st) cache[slot] = st = staticCheck(m, x, z);
    if (st === 3) return -1;
    if (st === 1) return 0;
    let extra = 0;
    const c = m.cells;
    for (let i = 0; i < c.length; i += 2) {
      const cx = x + c[i], cz = z + c[i + 1];
      if (map.cells[cx][cz] !== CellType.Rail) continue;
      for (const tr of tracksAt(map, cx, cz)) {
        if (Math.abs(tr.tx * m.dirs[i] + tr.tz * m.dirs[i + 1]) > Math.cos(20 * DEG)) {
          if (!nearJoin(cx, cz)) return -1;
          extra += ALONG_COST;
        } else extra += CROSS_COST;
      }
    }
    return extra;
  };

  for (const d of startDirs) {
    const st = startNode * 8 + d;
    g[st] = 0;
    push(st, oct(sp[0], sp[1]));
  }
  let best = startNode * 8 + startDirs[0];
  let bestH = oct(sp[0], sp[1]);
  let reached = false;
  let budget = MAX_EXPAND;
  while (size > 0 && budget-- > 0) {
    const st = pop();
    if (closed[st]) continue;
    closed[st] = 1;
    const node = st >> 3, d = st & 7;
    const x = (node / n) | 0, z = node - x * n;
    if (isGoal(x, z, d) && (node !== startNode || from[st] >= 0)) {
      best = st;
      reached = true;
      break;
    }
    const hh = oct(x, z);
    if (hh < bestH) {
      bestH = hh;
      best = st;
    }
    for (let mi = 0; mi < MOVES[d].length; mi++) {
      const m = MOVES[d][mi];
      // A switch leaves / joins a track through a curve, never straight on.
      if (!m.turn && startMid && node === startNode && from[st] < 0) continue;
      const nx = x + m.dx, nz = z + m.dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (!m.turn && endMid && nx === ep[0] && nz === ep[1]) continue;
      const ns = (nx * n + nz) * 8 + m.dEnd;
      if (closed[ns]) continue;
      const extra = pieceCost(m, x, z, st * MOVES_PER + mi);
      if (extra < 0) continue;
      const ng = g[st] + m.cost + extra;
      if (ng < g[ns]) {
        g[ns] = ng;
        from[ns] = st;
        push(ns, ng + H_WEIGHT * oct(nx, nz));
      }
    }
  }
  const states: number[] = [];
  for (let c = best; c >= 0; c = from[c]) states.push(c);
  states.reverse();
  return { states, reached };
}

/** Turn a chain of (cell, heading) states back into a centre-line. */
function traceLine(n: number, states: number[]): number[] {
  const line: number[] = [];
  for (let i = 0; i < states.length; i++) {
    const node = states[i] >> 3;
    const x = (node / n) | 0, z = node - x * n;
    if (i === 0) {
      line.push(x, z);
      continue;
    }
    const prev = states[i - 1];
    const pn = prev >> 3;
    const px = (pn / n) | 0, pz = pn - px * n;
    const m = MOVES[prev & 7].find((q) => q.dx === x - px && q.dz === z - pz && q.dEnd === (states[i] & 7))!;
    for (let k = 2; k < m.pts.length; k += 2) line.push(px + m.pts[k], pz + m.pts[k + 1]);
  }
  // Merge collinear runs (a straight = just its two ends).
  const out: number[] = [line[0], line[1]];
  for (let i = 2; i < line.length; i += 2) {
    const L = out.length;
    if (L >= 4) {
      const ax = out[L - 4], az = out[L - 3], bx = out[L - 2], bz = out[L - 1];
      const ux = bx - ax, uz = bz - az, vx = line[i] - bx, vz = line[i + 1] - bz;
      if (Math.abs(ux * vz - uz * vx) < 1e-9 && ux * vx + uz * vz > 0) {
        out[L - 2] = line[i];
        out[L - 1] = line[i + 1];
        continue;
      }
    }
    out.push(line[i], line[i + 1]);
  }
  return out;
}

// ------------------------------------------------------- final check

/** Final check of a centre-line; returns a Hungarian reason or null if OK. */
function validate(map: TerrainMap, pts: number[], start: NetSnap | null, end: NetSnap | null): string | null {
  const n = map.size;
  const pass = passOf(map);
  const total = new LineWalker(pts).total;
  let reason: string | null = null;
  let prevH: number | null = null;
  forEachSample(pts, 0.15, (x, z, tx, tz, s) => {
    if (reason) return;
    for (const o of [-TRACK_HALF, 0, TRACK_HALF]) {
      const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
      if (cx < 0 || cz < 0 || cx >= n || cz >= n || !pass[cx * n + cz]) {
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

// ------------------------------------------------------- main

export function planRail(map: TerrainMap, a: { x: number; z: number }, b: { x: number; z: number }): RailPlan {
  const net = map.railNet ?? EMPTY_NET;
  const pass = passOf(map);
  const empty = (reason: string | null): RailPlan => ({ pts: [], blocked: reason !== null, reason, length: 0, start: null, end: null });
  const n = map.size;

  const S0 = snapToNet(net, a.x, a.z);
  const S = S0 && latticeSnap(net, S0, a.x, a.z);
  if (S0 && !S) return empty('Itt nem ágazhat le a sín');
  const E0 = snapToNet(net, b.x, b.z);
  let E = E0 && latticeSnap(net, E0, b.x, b.z);
  const sp: P = S ? [S.x, S.z] : [Math.round(a.x), Math.round(a.z)];
  if (E && Math.hypot(E.x - sp[0], E.z - sp[1]) < 1) E = null;
  const ep: P = E ? [E.x, E.z] : [Math.round(b.x), Math.round(b.z)];
  if (Math.hypot(ep[0] - sp[0], ep[1] - sp[1]) < 1) return empty(null);
  if (!S && !pass[sp[0] * n + sp[1]]) return empty('Ide nem építhető sín');
  if (E0 && !E) return { ...empty('Itt nem csatlakozhat a sín'), start: S };

  // Headings allowed at the ends (tangential joins).
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const hs = S && headingOf(S.tx, S.tz);
  const startDirs = S ? (S.kind === 'end' ? [hs!] : [hs!, (hs! + 4) % 8]) : all;
  let goalDirs: number[] | null = null;
  if (E) {
    const he = headingOf(E.tx, E.tz);
    // An END snap points out of its edge: arrive travelling into it.
    goalDirs = E.kind === 'end' ? [(he + 4) % 8] : [he, (he + 4) % 8];
  }

  // B out of reach: head for the reachable cell closest to it (drawn red).
  const comp = compOf(map);
  const region = comp[sp[0] * n + sp[1]];
  let target = ep;
  if (comp[ep[0] * n + ep[1]] !== region) {
    let bd = Infinity;
    for (let c = 0; c < n * n; c++) {
      if (comp[c] !== region) continue;
      const x = (c / n) | 0, z = c - x * n;
      const d = Math.hypot(x - ep[0], z - ep[1]);
      if (d < bd) {
        bd = d;
        target = [x, z];
      }
    }
  }
  const direct = target === ep;
  const res = latticeAStar(map, sp, target, startDirs, direct ? goalDirs : null, S, direct ? E : null);
  if (!direct) res.reached = false;
  const line = traceLine(n, res.states);
  if (line.length < 4) return { ...empty(res.reached ? null : 'Nem vezethető el idáig'), start: S };
  const reason = res.reached ? validate(map, line, S, E) : 'Nem vezethető el idáig';
  return {
    pts: line,
    blocked: reason !== null,
    reason,
    length: new LineWalker(line).total,
    start: S,
    end: res.reached ? E : null,
  };
}

// ------------------------------------------------------- hand drawing

/**
 * A rail being drawn by dragging: from its start (a free point, or a snap
 * onto the network — a dead end continues it, mid-track makes a switch), a
 * chain of lattice pieces that follows the cursor. Moving the cursor back
 * over the drawn track takes pieces off again.
 */
export interface RailDraw {
  start: NetSnap | null;
  /** Start node and the headings it may leave in. */
  sp: [number, number];
  startDirs: number[];
  /** (node · 8 + heading) states, the start state first; empty = nothing drawn yet. */
  chain: number[];
  /**
   * Near an existing track: the planned last bit joining it (states from the
   * chain's end on) and the join, or empty / null.
   */
  tail: number[];
  join: NetSnap | null;
}

/** Start drawing at grid point `a`; a Hungarian reason if no track can start there. */
export function railDrawBegin(map: TerrainMap, a: { x: number; z: number }): RailDraw | string {
  const net = map.railNet ?? EMPTY_NET;
  const n = map.size;
  const S0 = snapToNet(net, a.x, a.z);
  const S = S0 && latticeSnap(net, S0, a.x, a.z);
  if (S0 && !S) return 'Itt nem ágazhat le a sín';
  const sp: [number, number] = S ? [S.x, S.z] : [Math.round(a.x), Math.round(a.z)];
  if (sp[0] < 0 || sp[1] < 0 || sp[0] >= n || sp[1] >= n) return 'Ide nem építhető sín';
  if (!S && !passOf(map)[sp[0] * n + sp[1]]) return 'Ide nem építhető sín';
  const hs = S ? headingOf(S.tx, S.tz) : -1;
  const startDirs = S ? (S.kind === 'end' ? [hs] : [hs, (hs + 4) % 8]) : [0, 1, 2, 3, 4, 5, 6, 7];
  return { start: S, sp, startDirs, chain: [], tail: [], join: null };
}

/** Follow the cursor at grid point `c`: take pieces off / lay pieces on. */
export function railDrawTo(map: TerrainMap, draw: RailDraw, c: { x: number; z: number }): RailDraw {
  const n = map.size;
  const pos = (st: number): P => {
    const node = st >> 3;
    const x = (node / n) | 0;
    return [x, node - x * n];
  };
  let chain = draw.chain.slice();
  // Back over the drawn track: cut it at the latest node under the cursor.
  if (chain.length && Math.hypot(draw.sp[0] - c.x, draw.sp[1] - c.z) < 0.6) chain = [];
  for (let i = chain.length - 2; i >= 1; i--) {
    const [x, z] = pos(chain[i]);
    if (Math.hypot(x - c.x, z - c.z) < 0.6) {
      chain = chain.slice(0, i + 1);
      break;
    }
  }
  // Close to an existing track (away from where we started): join it
  // properly — the lattice planner lays the last bit, through a switch.
  const net = map.railNet ?? EMPTY_NET;
  const near = snapToNet(net, c.x, c.z);
  const E = near && latticeSnap(net, near, c.x, c.z);
  const from: P = chain.length ? pos(chain[chain.length - 1]) : draw.sp;
  if (E && Math.hypot(E.x - draw.sp[0], E.z - draw.sp[1]) > 2 && Math.hypot(E.x - from[0], E.z - from[1]) >= 1 && Math.hypot(E.x - from[0], E.z - from[1]) < 16) {
    const he = headingOf(E.tx, E.tz);
    const goalDirs = E.kind === 'end' ? [(he + 4) % 8] : [he, (he + 4) % 8];
    const dirs = chain.length ? [chain[chain.length - 1] & 7] : draw.startDirs;
    const res = latticeAStar(map, from, [E.x, E.z], dirs, goalDirs, chain.length ? null : draw.start, E);
    if (res.reached && res.states.length >= 2) return { ...draw, chain, tail: res.states, join: E };
  }
  const used = new Set(chain.map((st) => st >> 3));
  for (let guard = 0; guard < 80; guard++) {
    const [x, z] = chain.length ? pos(chain[chain.length - 1]) : draw.sp;
    const here = Math.hypot(x - c.x, z - c.z);
    if (here < 0.75) break;
    const dirs = chain.length ? [chain[chain.length - 1] & 7] : draw.startDirs;
    let best: { d: number; m: Move; score: number } | null = null;
    for (const d of dirs)
      for (const m of MOVES[d]) {
        // A switch leaves a track through a curve, never straight on.
        if (!chain.length && draw.start?.kind === 'mid' && !m.turn) continue;
        const ex = x + m.dx, ez = z + m.dz;
        if (ex < 0 || ez < 0 || ex >= n || ez >= n || used.has(ex * n + ez)) continue;
        const dist = Math.hypot(ex - c.x, ez - c.z);
        if (dist > here - 0.25) continue;
        if (pieceTerrain(map, m, x, z) === 3) continue;
        // Prefer straight track, then wide curves: tight ones only when they
        // help a lot; and a piece that ends facing the cursor.
        const [hx, hz] = DIR[m.dEnd];
        const facing = dist > 1e-6 ? ((c.x - ex) * hx + (c.z - ez) * hz) / (Math.hypot(hx, hz) * dist) : 1;
        const score = dist + (m.turn ? (m.cost - m.len > 5 ? 0.7 : 0.2) : 0) + (1 - facing) * 0.6;
        if (!best || score < best.score) best = { d, m, score };
      }
    if (!best) break;
    if (!chain.length) chain.push((draw.sp[0] * n + draw.sp[1]) * 8 + best.d);
    const nx = x + best.m.dx, nz = z + best.m.dz;
    chain.push((nx * n + nz) * 8 + best.m.dEnd);
    used.add(nx * n + nz);
  }
  return { ...draw, chain, tail: [], join: null };
}

/**
 * The drawn rail as a plan: its centre-line, whether it joins the network at
 * its end (a dead end continued, or a switch onto a track it meets heading
 * along it), and whether it can be built (with the reason if not).
 */
export function railDrawPlan(map: TerrainMap, draw: RailDraw): RailPlan {
  const n = map.size;
  if (draw.tail.length >= 2) {
    // Joining a track: the drawn chain, then the planned last bit.
    const states = draw.chain.length ? draw.chain.concat(draw.tail.slice(1)) : draw.tail;
    const line = traceLine(n, states);
    const reason = validate(map, line, draw.start, draw.join);
    return { pts: line, blocked: reason !== null, reason, length: new LineWalker(line).total, start: draw.start, end: draw.join };
  }
  if (draw.chain.length < 2) return { pts: [], blocked: false, reason: null, length: 0, start: draw.start, end: null };
  const line = traceLine(n, draw.chain);
  const last = draw.chain[draw.chain.length - 1];
  const node = last >> 3, d = last & 7;
  const x = (node / n) | 0, z = node - x * n;
  const net = map.railNet ?? EMPTY_NET;
  let end: NetSnap | null = null;
  const E0 = snapToNet(net, x, z, 0.3);
  const E = E0 && latticeSnap(net, E0, x, z);
  if (E && Math.hypot(E.x - x, E.z - z) < 1e-6) {
    const he = headingOf(E.tx, E.tz);
    const prev = draw.chain[draw.chain.length - 2];
    const turned = (prev & 7) !== d;
    if (E.kind === 'end' ? d === (he + 4) % 8 : (d === he || d === (he + 4) % 8) && turned) end = E;
  }
  const reason = validate(map, line, draw.start, end);
  return { pts: line, blocked: reason !== null, reason, length: new LineWalker(line).total, start: draw.start, end };
}
