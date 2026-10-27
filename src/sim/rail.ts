/**
 * Rail routing — how trains find their way over the rail network (railNet).
 *
 * The network is a graph: edges are track centre-lines, and edges whose ends
 * meet at a point form a node (2 ends = a joint, 3+ = a switch). A train
 * runs along an edge in one of two senses and passes a node only onto an
 * edge that leaves it straight ahead (tangent within ~25°) — it never turns
 * back. So a line's end station needs a LOOP (a balloon loop, or the whole
 * line a circle): without one there is simply no route back.
 *
 * A stop is a straight platform segment: a rail station's track, or one of a
 * depot's two tracks. A train stops with its front at the far end of the
 * segment (in its travel sense), so its whole body is on the platform.
 *
 * A path is a list of edge pieces (RailSeg) plus their polyline (a Lane, so
 * the lane helpers work on it); `pathAt` maps a path distance back to the
 * edge and the distance along it (the renderer needs it for the track's
 * height there).
 *
 * Pure TypeScript.
 */

import { EMPTY_NET, LineWalker, railIndex, TRACK_HALF, type RailNet } from './railNet';
import { CellType, type TerrainMap } from './terrain';
import { stationGeom, stopKind, type Station } from './stations';
import { depotTracks, isDepot } from './depot';
import type { Lane } from './lane';

/** Car lengths and the gap between couplers (cells; the models match). */
export const LOCO_LEN = 1.45;
export const CAR_LEN = 1.15;
export const CAR_GAP = 0.05;

/** A piece of a path: edge `edge` from distance `a` to `b` along it (a > b: backwards). */
export interface RailSeg {
  edge: number;
  a: number;
  b: number;
  /** Path distance where the piece starts. */
  s0: number;
}

/** A train's path: the pieces and their polyline. */
export interface RailPath extends Lane {
  segs: RailSeg[];
}

/** A train's place on the network: on `edge`, `along` it, heading forwards (fwd) or backwards. */
export interface RailPos {
  edge: number;
  along: number;
  fwd: boolean;
}

/** Where a train stops at a stop (front), and the platform's other end. */
export interface RailTarget extends RailPos {
  /** Platform index within the stop (a depot has two). */
  platform: number;
}

// ---------------------------------------------------------------- graph

interface End {
  edge: number;
  atStart: boolean;
  /** Tangent pointing INTO the edge. */
  tx: number;
  tz: number;
}

interface Graph {
  walkers: Map<number, LineWalker>;
  nodes: Map<string, End[]>;
}

const graphs = new WeakMap<RailNet, Graph>();
const nodeKey = (x: number, z: number) => `${Math.round(x * 20)},${Math.round(z * 20)}`;

function graph(net: RailNet): Graph {
  let g = graphs.get(net);
  if (g) return g;
  g = { walkers: new Map(), nodes: new Map() };
  const o = [0, 0, 0, 0];
  for (const e of net.edges) {
    const w = new LineWalker(e.pts);
    g.walkers.set(e.id, w);
    for (const atStart of [true, false]) {
      w.at(atStart ? 0 : w.total, o);
      const k = nodeKey(o[0], o[1]);
      let arr = g.nodes.get(k);
      if (!arr) g.nodes.set(k, (arr = []));
      arr.push({ edge: e.id, atStart, tx: atStart ? o[2] : -o[2], tz: atStart ? o[3] : -o[3] });
    }
  }
  graphs.set(net, g);
  return g;
}

/** A node is passed only onto an edge within this cosine of straight ahead. */
const STRAIGHT = 0.9;

/** Directed edges a train can run onto at the end of (edge, fwd). */
function nextStates(g: Graph, edge: number, fwd: boolean): Array<[number, boolean]> {
  const w = g.walkers.get(edge)!;
  const o = w.at(fwd ? w.total : 0);
  const tx = fwd ? o[2] : -o[2], tz = fwd ? o[3] : -o[3];
  const out: Array<[number, boolean]> = [];
  for (const c of g.nodes.get(nodeKey(o[0], o[1])) ?? []) {
    if (c.edge === edge && c.atStart === !fwd) continue; // the end we came by
    if (c.tx * tx + c.tz * tz > STRAIGHT) out.push([c.edge, c.atStart]);
  }
  return out;
}

/** The network position at point (x, z) heading (dx, dz), or null if no track runs so there. */
export function locate(net: RailNet, x: number, z: number, dx: number, dz: number): RailPos | null {
  const g = graph(net);
  const hl = Math.hypot(dx, dz) || 1;
  dx /= hl;
  dz /= hl;
  let best: RailPos | null = null, bd = 0.08;
  for (const e of net.edges) {
    const p = e.pts;
    let acc = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i], ez = p[i + 3] - p[i + 1];
      const L = Math.hypot(ex, ez) || 1;
      const t = Math.min(1, Math.max(0, ((x - p[i]) * ex + (z - p[i + 1]) * ez) / (L * L)));
      const d = Math.hypot(p[i] + ex * t - x, p[i + 1] + ez * t - z);
      const cos = (ex * dx + ez * dz) / L;
      if (d < bd && Math.abs(cos) > STRAIGHT) {
        bd = d;
        best = { edge: e.id, along: Math.min(acc + L * t, g.walkers.get(e.id)!.total), fwd: cos > 0 };
      }
      acc += L;
    }
  }
  return best;
}

/** The platform segments [ax, az, bx, bz] of a rail stop (none for a truck stop). */
export function platforms(st: Station): number[][] {
  if (isDepot(st)) return depotTracks(st);
  if (stopKind(st) !== 'rail') return [];
  return [stationGeom(st.anchor, st.side).trackPts];
}

/** Where a train stops at `st`: per platform and travel sense, its front's place. */
export function stopTargets(net: RailNet, st: Station): RailTarget[] {
  const out: RailTarget[] = [];
  platforms(st).forEach(([ax, az, bx, bz], platform) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (const sg of [1, -1]) {
      // Front just short of the platform's far end.
      const fx = sg > 0 ? bx - dx * 0.02 : ax + dx * 0.02;
      const fz = sg > 0 ? bz - dz * 0.02 : az + dz * 0.02;
      const p = locate(net, fx, fz, dx * sg, dz * sg);
      if (p) out.push({ ...p, platform });
    }
  });
  return out;
}

// ---------------------------------------------------------------- routing

/**
 * Shortest forward route from `from` to any of `targets`: the pieces, the
 * target reached, or null (no way there without turning back).
 */
export function railRoute(
  net: RailNet,
  from: RailPos,
  targets: RailTarget[],
  avoid?: (edge: number) => boolean,
): { segs: Array<[number, number, number]>; target: RailTarget } | null {
  if (!targets.length || !net.edges.length) return null;
  const g = graph(net);
  const total = (e: number) => g.walkers.get(e)?.total ?? 0;
  // Distance along a directed edge (from where a train enters it).
  const off = (e: number, fwd: boolean, along: number) => (fwd ? along : total(e) - along);
  if (!g.walkers.has(from.edge)) return null;

  // Dijkstra over directed edges; 'S' is the start piece (from `from` on).
  type Node = { key: string; edge: number; fwd: boolean; d: number; prev: Node | null; start: boolean };
  const startOff = off(from.edge, from.fwd, from.along);
  const open: Node[] = [{ key: 'S', edge: from.edge, fwd: from.fwd, d: -startOff, prev: null, start: true }];
  const done = new Set<string>();
  let best: { n: Node; t: RailTarget; d: number } | null = null;
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[k].d) k = i;
    const n = open.splice(k, 1)[0];
    if (done.has(n.key)) continue;
    done.add(n.key);
    if (best && n.d >= best.d) break;
    for (const t of targets) {
      if (t.edge !== n.edge || t.fwd !== n.fwd) continue;
      const o = off(t.edge, t.fwd, t.along);
      if (n.start && o < startOff - 1e-6) continue; // behind the start
      const d = n.d + o;
      if (!best || d < best.d) best = { n, t, d };
    }
    const end = n.d + total(n.edge);
    for (const [e, fwd] of nextStates(g, n.edge, n.fwd)) {
      if (avoid?.(e)) continue;
      const key = `${e}${fwd ? '+' : '-'}`;
      if (!done.has(key)) open.push({ key, edge: e, fwd, d: end, prev: n, start: false });
    }
  }
  if (!best) return null;
  const chain: Node[] = [];
  for (let n: Node | null = best.n; n; n = n.prev) chain.unshift(n);
  const segs: Array<[number, number, number]> = chain.map((n, i) => {
    const a = n.start ? from.along : n.fwd ? 0 : total(n.edge);
    const b = i === chain.length - 1 ? best!.t.along : n.fwd ? total(n.edge) : 0;
    return [n.edge, a, b];
  });
  return { segs, target: best.t };
}

// ---------------------------------------------------------------- paths

/** Build a path (pieces + polyline) from [edge, a, b] pieces. */
export function makePath(net: RailNet, pieces: Array<[number, number, number]>): RailPath {
  const g = graph(net);
  const xs: number[] = [], zs: number[] = [];
  const segs: RailSeg[] = [];
  let s0 = 0;
  for (const [edge, a, b] of pieces) {
    const w = g.walkers.get(edge);
    if (!w || Math.abs(b - a) < 1e-6) continue;
    segs.push({ edge, a, b, s0 });
    s0 += Math.abs(b - a);
    const sub = w.sub(Math.min(a, b), Math.max(a, b));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < sub.length; i += 2) pts.push([sub[i], sub[i + 1]]);
    if (b < a) pts.reverse();
    for (const [x, z] of pts) {
      const n = xs.length;
      if (n && Math.abs(xs[n - 1] - x) < 1e-6 && Math.abs(zs[n - 1] - z) < 1e-6) continue;
      xs.push(x);
      zs.push(z);
    }
  }
  if (xs.length === 1) {
    xs.push(xs[0]);
    zs.push(zs[0]);
  }
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, cum, length: cum[cum.length - 1] ?? 0, segs };
}

/** The pieces of `p` between path distances `from` and `to`. */
export function clipPath(p: RailPath, from: number, to: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const sg of p.segs) {
    const len = Math.abs(sg.b - sg.a);
    const lo = Math.max(from, sg.s0), hi = Math.min(to, sg.s0 + len);
    if (hi - lo < 1e-6) continue;
    const dir = sg.b >= sg.a ? 1 : -1;
    out.push([sg.edge, sg.a + dir * (lo - sg.s0), sg.a + dir * (hi - sg.s0)]);
  }
  return out;
}

/** Edge and distance along it at path distance `s` (clamped to the path). */
export function pathAt(p: RailPath, s: number): RailPos {
  const segs = p.segs;
  let k = 0;
  while (k + 1 < segs.length && segs[k + 1].s0 <= s) k++;
  const sg = segs[k];
  const len = Math.abs(sg.b - sg.a);
  const d = Math.min(Math.max(s - sg.s0, 0), len);
  const fwd = sg.b >= sg.a;
  return { edge: sg.edge, along: sg.a + (fwd ? d : -d), fwd };
}

/** Is `net` still holding every edge of `p` (unchanged geometry)? */
export function pathValid(net: RailNet, p: RailPath): boolean {
  const g = graph(net);
  return p.segs.every((sg) => {
    const w = g.walkers.get(sg.edge);
    return !!w && Math.max(sg.a, sg.b) <= w.total + 1e-6;
  });
}

/**
 * Cells of a path shared by 2+ tracks (switches, crossings), with the path
 * distances where the path enters / leaves each — trains reserve them like edges.
 * Also its level crossings (rail over road), with where it enters / leaves.
 */
export function pathCells(map: TerrainMap, p: RailPath, from: number, to: number): { shared: Map<number, [number, number]>; roads: Map<number, [number, number]> } {
  const n = map.size;
  const idx = railIndex(map);
  const shared = new Map<number, [number, number]>();
  const roads = new Map<number, [number, number]>();
  const STEP = 0.1;
  for (let s = Math.max(0, from); s <= Math.min(p.length, to) + 1e-6; s += STEP) {
    const i = Math.min(p.xs.length - 2, Math.max(0, upper(p.cum, s) - 1));
    const L = p.cum[i + 1] - p.cum[i] || 1;
    const f = (s - p.cum[i]) / L;
    const x = p.xs[i] + (p.xs[i + 1] - p.xs[i]) * f, z = p.zs[i] + (p.zs[i + 1] - p.zs[i]) * f;
    const tx = (p.xs[i + 1] - p.xs[i]) / L, tz = (p.zs[i + 1] - p.zs[i]) / L;
    for (const o of [-TRACK_HALF, 0, TRACK_HALF]) {
      const cx = Math.round(x - tz * o), cz = Math.round(z + tx * o);
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
      const k = cx * n + cz;
      const tr = idx.get(k);
      if (tr && new Set(tr.map((q) => q.edge)).size > 1) {
        const r = shared.get(k);
        shared.set(k, r ? [r[0], s] : [s, s]);
      }
      if (o === 0 && map.cells[cx][cz] === CellType.Road) {
        const r = roads.get(k);
        roads.set(k, r ? [r[0], s] : [s, s]);
      }
    }
  }
  return { shared, roads };
}

/** First index i with cum[i] > s. */
function upper(cum: number[], s: number): number {
  let lo = 0, hi = cum.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= s) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export const netOf = (map: TerrainMap): RailNet => map.railNet ?? EMPTY_NET;

/** Length of edge `id` (0 if gone). */
export const edgeLength = (net: RailNet, id: number): number => graph(net).walkers.get(id)?.total ?? 0;
