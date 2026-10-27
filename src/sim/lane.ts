/**
 * Lanes — polylines with cumulative lengths that vehicles move along by
 * distance `s` (truck lanes on the roads, train paths on the rails).
 * Pure TypeScript.
 */

/** A polyline with cumulative lengths: the right lane along a route. */
export interface Lane {
  xs: number[];
  zs: number[];
  /** Length up to each point. */
  cum: number[];
  length: number;
}

/** A lane straight through world points (no lane offset: already placed). */
export function polyLane(pts: Array<[number, number]>): Lane {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, cum, length: cum[cum.length - 1] };
}

/** Point at distance `s` along a lane (extended straight beyond both ends). */
export function laneAt(l: Lane, s: number): [number, number] {
  const n = l.xs.length;
  if (n === 1) return [l.xs[0], l.zs[0]];
  let i: number;
  if (s <= 0) i = 0;
  else if (s >= l.length) i = n - 2;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (l.cum[m] <= s) lo = m;
      else hi = m;
    }
    i = lo;
  }
  const seg = l.cum[i + 1] - l.cum[i] || 1;
  const f = (s - l.cum[i]) / seg;
  return [l.xs[i] + (l.xs[i + 1] - l.xs[i]) * f, l.zs[i] + (l.zs[i + 1] - l.zs[i]) * f];
}

/** Lane distance (within the first `within` cells) closest to point p. */
export function nearestS(l: Lane, p: [number, number], within = Infinity): number {
  let best = 0, bd = Infinity;
  for (let s = 0; s <= Math.min(l.length, within); s += 0.05) {
    const [x, z] = laneAt(l, s);
    const d = Math.hypot(x - p[0], z - p[1]);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Sample step (cells) of a lane's bend speed limits. */
const LIMIT_STEP = 0.1;
const bendCache = new WeakMap<Lane, Map<string, Float32Array>>();

/**
 * The bend speed limit along a lane every LIMIT_STEP: in a bend of radius r
 * at most √(aLat·r), never above `top` (cached per lane).
 */
function bendLimit(l: Lane, aLat: number, top: number): Float32Array {
  let m = bendCache.get(l);
  if (!m) bendCache.set(l, (m = new Map()));
  const key = `${aLat}|${top}`;
  let a = m.get(key);
  if (a) return a;
  a = new Float32Array(Math.ceil(l.length / LIMIT_STEP) + 2);
  const h = 0.15;
  for (let i = 0; i < a.length; i++) {
    const s = i * LIMIT_STEP;
    const p0 = laneAt(l, s - h), p1 = laneAt(l, s), p2 = laneAt(l, s + h);
    let turn = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    turn = Math.abs(((turn + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const k = turn / (2 * h); // curvature (1 / radius)
    a[i] = k > 1e-3 ? Math.min(top, Math.sqrt(aLat / k)) : top;
  }
  m.set(key, a);
  return a;
}

/**
 * The fastest a vehicle at `s` on lane `l` may go (topped at `top`) and still
 * brake at `decel` for the bends ahead (lateral grip `aLat`) and stop by
 * `stopAt` (lane distance).
 */
export function brakeCapOn(l: Lane, s: number, top: number, decel: number, aLat: number, stopAt = Infinity): number {
  let cap = top;
  const lim = bendLimit(l, aLat, top);
  const range = (top * top) / (2 * decel);
  for (let d = 0; d <= range; d += LIMIT_STEP) {
    const i = Math.round((s + d) / LIMIT_STEP);
    if (i < 0) continue;
    if (i >= lim.length) break;
    cap = Math.min(cap, Math.sqrt(lim[i] * lim[i] + 2 * decel * d));
  }
  if (stopAt < Infinity) cap = Math.min(cap, Math.sqrt(2 * decel * Math.max(0, stopAt - s)));
  return cap;
}
