/**
 * Transport — lines and the vehicles running them (trucks for now).
 *
 * A LINE is a coloured loop over stops (truck stops on industry sides). Its
 * trucks drive stop → stop over the road network; at each stop they first
 * UNLOAD what that industry takes (ACCEPTS — it goes in through the gate and
 * pays: units × value × distance factor), then LOAD what a later stop of the
 * line takes from the stop's outgoing stock.
 *
 * Trucks drive on the RIGHT lane of a smooth lane path (rounded corners:
 * right turns tight, left turns wide) and are articulated: the tractor and
 * the trailer each follow the lane (see `pose`). Traffic rules:
 *   - keep a gap to whatever is ahead in the lane (also at stop queues);
 *   - junctions (road cells with 3+ road neighbours): enter only if the
 *     junction is free AND there is room for the whole truck past it (no
 *     blocking the box); the junction is reserved until the trailer is out;
 *   - pulling out of a stop gives way to the traffic;
 *   - two trucks waiting for each other elsewhere: the one with the other
 *     on its RIGHT gives way;
 *   - a real deadlock (trucks waiting for each other in a circle — not just a
 *     long queue) is broken: one truck of the circle drives on for a moment.
 *
 * Lines are immutable snapshot data (for the UI); the trucks are mutable
 * runtime state, read by the 3D view every frame. Pure TypeScript.
 */

import {
  CellType,
  getSlopeKind,
  HILL_STEP,
  type SlopeKind,
  type TerrainMap,
} from './terrain';
import { hasRailAt, roadCrossingAxis } from './railNet';
import { stationGeom, stopKind, type Station } from './stations';
import { ACCEPTS, ITEMS, type Item } from './interior';
import type { ProductionSim } from './production';

export interface Line {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly kind: 'truck';
  /** Stop (station) ids, visited in order and then back to the first. */
  readonly stops: readonly number[];
  /** Trucks assigned. */
  readonly vehicles: number;
}

export interface TransportSnapshot {
  lines: readonly Line[];
  /** The network (lines) view is open. */
  view: boolean;
  /** Stops picked so far for a new line, or null when not drafting. */
  draft: readonly number[] | null;
  /** Lines whose trucks find no road between two stops. */
  noRoute: readonly number[];
  /** Bumped when trucks are added / removed (re-render the truck list). */
  fleet: number;
}

/** Price of one truck; half is refunded when one is sold. */
export const TRUCK_PRICE = 1500;
/** Truck load (units). */
export const TRUCK_CAPACITY = 20;
/** Truck speed (cells per game second). */
const TRUCK_SPEED = 3;
/** Lane offset to the right of the road centre (cells). */
const LANE = 0.2;
/** Front of the tractor → its fifth wheel (hitch), and hitch → trailer axles (cells). */
export const TRUCK_HITCH = 0.22;
export const TRAILER_AXLE = 0.5;
/** Clear road wanted ahead of the tractor's front (cells). */
const LOOK_AHEAD = 0.55;
/** Two body points closer than this collide (lanes are 2·LANE apart). */
const BODY_GAP = 0.27;
/** Seconds waiting before a truck checks for a deadlock circle. */
const DEADLOCK_CHECK = 3;
/** Seconds a deadlocked truck may drive ignoring the others. */
const DEADLOCK_PASS = 2;
/** Seconds stopped at a stop (un)loading. */
const STOP_TIME = 2;
/** Delivery pay grows with the distance carried (cells). */
const DISTANCE_SCALE = 25;

export const LINE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fb5'];

type Cell = [number, number];

export interface Truck {
  readonly id: number;
  readonly lineId: number;
  /** Index (in the line's stops) of the stop it's at / heading to. */
  target: number;
  path: Cell[] | null;
  /** Distance travelled along `lane` (cells). */
  s: number;
  /** Smooth right-lane path built from `path` (s runs along it). */
  lane: Lane | null;
  state: 'stop' | 'drive' | 'noroute';
  timer: number;
  /** Seconds it has been held up by traffic. */
  blocked: number;
  /** Junction cells (x·n + z) it has reserved, until `s` passes `holdUntil`. */
  holds: number[];
  holdUntil: number;
  /** The truck it is waiting for (null = not waiting). */
  waitFor: number | null;
  /** Seconds left of a deadlock pass (ignores the traffic). */
  pass: number;
  cargo: Partial<Record<Item, number>>;
  /** Stop the cargo was loaded at (for the distance pay). */
  from: number | null;
}

/** A recent payment (shown as a floating "+$" over the stop). */
export interface Payment {
  amount: number;
  x: number;
  z: number;
  /** Game seconds since the payment. */
  age: number;
}

type Listener = () => void;

// ---------------------------------------------------------------- roads

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

/** May a vehicle pass a cell of this slope kind along heading d? */
function axisOk(kind: SlopeKind, d: number): boolean {
  if (kind === 'slopeX') return d < 2;
  if (kind === 'slopeZ') return d >= 2;
  return true;
}

/** The road row of a truck stop (where trucks stop). */
export function stopCells(st: Station): Cell[] {
  return stationGeom(st.anchor, st.side).track;
}

/** Centre of a stop's road row (grid coords). */
export function stopCenter(st: Station): [number, number] {
  const c = stopCells(st);
  const a = c[0];
  const b = c[c.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Shortest road route (cell list) from any `from` cell to any `to` cell over
 * existing Road cells, obeying the road rules (one height level per step,
 * ramps along their axis, level crossings straight). Null if not connected.
 */
export function roadRoute(map: TerrainMap, from: Cell[], to: Cell[]): Cell[] | null {
  const n = map.size;
  const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < n && z < n && map.cells[x][z] === CellType.Road;
  const kind = (x: number, z: number): SlopeKind => {
    const k = getSlopeKind(map, x, z);
    return k === 'invalid' ? 'flat' : k;
  };
  const crossing = (x: number, z: number): 'x' | 'z' | null => (hasRailAt(map, x, z) ? (roadCrossingAxis(map, x, z) ?? 'x') : null);
  const goal = new Set(to.map(([x, z]) => x * n + z));
  const prev = new Int32Array(n * n).fill(-2);
  const q: number[] = [];
  for (const [x, z] of from) {
    if (!isRoad(x, z)) continue;
    const c = x * n + z;
    if (prev[c] !== -2) continue;
    prev[c] = -1;
    q.push(c);
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (goal.has(c)) {
      const path: Cell[] = [];
      for (let k = c; k >= 0; k = prev[k]) path.push([(k / n) | 0, k % n]);
      return path.reverse();
    }
    const x = (c / n) | 0, z = c % n;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (!isRoad(nx, nz)) continue;
      const k = nx * n + nz;
      if (prev[k] !== -2) continue;
      if (!axisOk(kind(x, z), d) || !axisOk(kind(nx, nz), d)) continue;
      if (Math.abs(map.heights[nx][nz] - map.heights[x][z]) > HILL_STEP + 1e-6) continue;
      const axis = d < 2 ? 'x' : 'z';
      const ca = crossing(x, z), cb = crossing(nx, nz);
      if ((ca && ca !== axis) || (cb && cb !== axis)) continue;
      prev[k] = c;
      q.push(k);
    }
  }
  return null;
}

// ---------------------------------------------------------------- lanes

/** A polyline with cumulative lengths: the right lane along a route. */
export interface Lane {
  xs: number[];
  zs: number[];
  /** Length up to each point. */
  cum: number[];
  length: number;
}

/**
 * The right lane along a cell route: offset by LANE to the right, corners
 * rounded with a quadratic curve (from the cell edge before to the cell edge
 * after; its control point is where the two offset lanes meet — so a right
 * turn is tight and a left turn wide). A U-turn swings round the cell.
 */
export function buildLane(path: Cell[]): Lane {
  const xs: number[] = [];
  const zs: number[] = [];
  const push = (x: number, z: number) => {
    const n = xs.length;
    if (n && Math.abs(xs[n - 1] - x) < 1e-6 && Math.abs(zs[n - 1] - z) < 1e-6) return;
    xs.push(x);
    zs.push(z);
  };
  const dir = (i: number): [number, number] => [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]];
  // Right of heading (dx, dz) is (−dz, dx).
  const right = ([dx, dz]: [number, number]): [number, number] => [-dz * LANE, dx * LANE];
  const quad = (ax: number, az: number, kx: number, kz: number, bx: number, bz: number) => {
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      push(u * u * ax + 2 * u * t * kx + t * t * bx, u * u * az + 2 * u * t * kz + t * t * bz);
    }
  };
  if (path.length === 1) push(path[0][0], path[0][1]);
  else {
    const r0 = right(dir(0));
    push(path[0][0] + r0[0], path[0][1] + r0[1]);
    for (let i = 1; i < path.length - 1; i++) {
      const [cx, cz] = path[i];
      const din = dir(i - 1), dout = dir(i);
      const rin = right(din), rout = right(dout);
      if (din[0] === dout[0] && din[1] === dout[1]) continue; // straight on
      if (din[0] === -dout[0] && din[1] === -dout[1]) {
        // U-turn (dead end): swing round the far side of the cell.
        quad(cx + rin[0], cz + rin[1], cx + din[0] * 0.45, cz + din[1] * 0.45, cx + rout[0], cz + rout[1]);
        continue;
      }
      quad(
        cx - din[0] * 0.5 + rin[0], cz - din[1] * 0.5 + rin[1],
        cx + rin[0] + rout[0], cz + rin[1] + rout[1],
        cx + dout[0] * 0.5 + rout[0], cz + dout[1] * 0.5 + rout[1],
      );
    }
    const last = path.length - 1;
    const rl = right(dir(last - 1));
    push(path[last][0] + rl[0], path[last][1] + rl[1]);
  }
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

/** Where an articulated truck is (grid coords; yaw about Y, 0 = +X). */
export interface TruckPose {
  /** Fifth wheel (hitch): the tractor's and the trailer's pivot. */
  x: number;
  z: number;
  /** Tractor heading. */
  yaw: number;
  /** Trailer heading. */
  trailerYaw: number;
  /** Front of the tractor / rear of the trailer (for traffic checks). */
  front: [number, number];
  rear: [number, number];
}

function poseOnLane(l: Lane, s: number): TruckPose {
  const f = laneAt(l, s);
  const h = laneAt(l, s - TRUCK_HITCH);
  const a = laneAt(l, s - TRUCK_HITCH - TRAILER_AXLE);
  const yaw = (p: [number, number], q: [number, number]) => Math.atan2(-(p[1] - q[1]), p[0] - q[0]);
  const ty = yaw(h, a);
  // Rear end: a bit past the trailer axles, along the trailer.
  const rear: [number, number] = [a[0] - Math.cos(ty) * 0.1, a[1] + Math.sin(ty) * 0.1];
  return { x: h[0], z: h[1], yaw: yaw(f, h), trailerYaw: ty, front: f, rear };
}

// ---------------------------------------------------------------- sim

export class TransportSim {
  private snap: TransportSnapshot = { lines: [], view: false, draft: null, noRoute: [], fleet: 0 };
  private trucks: Truck[] = [];
  private nextLine = 1;
  private nextTruck = 1;
  private routeCache = new Map<string, Cell[] | null>();
  /** Junction cell → the truck that reserved it. */
  private reserved = new Map<number, number>();
  /** 1 = junction cell (cached per map version). */
  private junctions: Uint8Array | null = null;
  private junctionVersion = -1;
  private routeVersion = -1;
  readonly payments: Payment[] = [];
  private readonly listeners = new Set<Listener>();

  getSnapshot(): TransportSnapshot {
    return this.snap;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Current trucks (mutable runtime objects; read-only for callers). */
  allTrucks(): readonly Truck[] {
    return this.trucks;
  }

  setView(on: boolean): void {
    if (this.snap.view === on) return;
    this.set({ view: on, draft: on ? this.snap.draft : null });
  }

  startDraft(): void {
    this.set({ draft: [] });
  }

  cancelDraft(): void {
    this.set({ draft: null });
  }

  /** Add a stop to the line being drafted (no immediate repeats). */
  addDraftStop(id: number): void {
    const d = this.snap.draft;
    if (!d || d[d.length - 1] === id) return;
    this.set({ draft: d.concat(id) });
  }

  /** Turn the draft into a line (with one truck). Returns it, or null. */
  finishDraft(): Line | null {
    const d = this.snap.draft;
    if (!d || d.length < 2) return null;
    const id = this.nextLine++;
    const line: Line = {
      id,
      name: `${id}. járat`,
      color: LINE_COLORS[(id - 1) % LINE_COLORS.length],
      kind: 'truck',
      stops: d.slice(),
      vehicles: 1,
    };
    this.set({ lines: this.snap.lines.concat(line), draft: null });
    return line;
  }

  removeLine(id: number): void {
    for (const t of this.trucks) if (t.lineId === id) this.release(t);
    this.trucks = this.trucks.filter((t) => t.lineId !== id);
    this.set({ lines: this.snap.lines.filter((l) => l.id !== id), fleet: this.snap.fleet + 1 });
  }

  setVehicles(id: number, n: number): void {
    this.set({ lines: this.snap.lines.map((l) => (l.id === id ? { ...l, vehicles: Math.max(0, n) } : l)) });
  }

  /** Road route of each leg of a line (for drawing). */
  linePaths(map: TerrainMap, line: Line): Array<Cell[] | null> {
    const st = (id: number) => map.stations?.find((s) => s.id === id) ?? null;
    return line.stops.map((a, i) => this.route(map, st(a), st(line.stops[(i + 1) % line.stops.length])));
  }

  /** Route between two stops (cached per map version). */
  route(map: TerrainMap, a: Station | null, b: Station | null): Cell[] | null {
    if (!a || !b) return null;
    if (this.routeVersion !== map.cellsVersion) {
      this.routeCache.clear();
      this.routeVersion = map.cellsVersion;
    }
    const key = `${a.id}>${b.id}`;
    if (!this.routeCache.has(key)) this.routeCache.set(key, roadRoute(map, stopCells(a), stopCells(b)));
    return this.routeCache.get(key) ?? null;
  }

  /**
   * Advance the trucks by `dt` game seconds. `earn` is paid for deliveries
   * (amount and where, for the floating "+$").
   */
  tick(dt: number, map: TerrainMap, prod: ProductionSim, earn: (amount: number) => void): void {
    for (let i = this.payments.length - 1; i >= 0; i--) {
      this.payments[i].age += dt;
      if (this.payments[i].age > 3) this.payments.splice(i, 1);
    }
    if (dt <= 0) return;
    this.syncFleet();
    const byId = new Map((map.stations ?? []).map((s) => [s.id, s]));
    const noRoute = new Set<number>();
    // Everyone's position at the start of the tick (for the traffic rules).
    const poses = new Map<number, TruckPose>();
    for (const t of this.trucks) {
      const p = this.pose(t);
      if (p) poses.set(t.id, p);
      t.pass = Math.max(0, t.pass - dt);
    }
    for (const t of this.trucks) {
      const line = this.snap.lines.find((l) => l.id === t.lineId);
      if (!line) continue;
      const here = byId.get(line.stops[t.target]);
      if (!here || stopKind(here) !== 'truck') {
        noRoute.add(line.id);
        continue;
      }
      if (t.state === 'stop') {
        t.timer -= dt;
        if (t.timer > 0) continue;
        const next = (t.target + 1) % line.stops.length;
        // Pulling out (or out of the depot) gives way to the traffic.
        const r = this.route(map, here, byId.get(line.stops[next]) ?? null);
        if (r && r.length && this.startBlocked(t, buildLane(r), poses)) {
          t.timer = 0.3;
          t.blocked += 0.3;
          continue;
        }
        t.blocked = 0;
        t.waitFor = null;
        this.serveStop(t, line, here, byId, map, prod, earn);
        // Head for the next stop.
        this.setPath(t, this.route(map, here, byId.get(line.stops[next]) ?? null));
        t.target = next;
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
        this.updatePose(t, poses);
      } else if (t.state === 'noroute') {
        noRoute.add(line.id);
        t.timer -= dt;
        if (t.timer > 0) continue;
        const prevStop = byId.get(line.stops[(t.target - 1 + line.stops.length) % line.stops.length]) ?? null;
        this.setPath(t, this.route(map, prevStop, here));
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
      } else if (t.lane) {
        if (this.junctionWait(t, map, poses) || this.heldUp(t, poses)) {
          t.blocked += dt;
          continue;
        }
        t.blocked = 0;
        t.waitFor = null;
        t.s += dt * TRUCK_SPEED;
        this.updatePose(t, poses);
        if (t.s >= t.lane.length) {
          t.s = t.lane.length;
          this.release(t); // parked at the stop: the junction is free again
          t.state = 'stop';
          t.timer = STOP_TIME;
        }
      }
    }
    this.breakDeadlocks();
    const nr = [...noRoute].sort((a, b) => a - b);
    if (nr.join() !== this.snap.noRoute.join()) this.set({ noRoute: nr });
  }

  /** Note that `t` waits for `o`; returns true (= wait). */
  private waitOn(t: Truck, o: Truck): boolean {
    t.waitFor = o.id;
    return true;
  }

  /**
   * Deadlock breaker: follow who-waits-for-whom from every truck that has
   * waited a while; a chain that comes back to itself is a circle (a queue
   * just ends at someone moving). The lowest id of the circle gets a pass.
   */
  private breakDeadlocks(): void {
    const byId = new Map(this.trucks.map((t) => [t.id, t]));
    for (const t of this.trucks) {
      if (t.waitFor === null || t.blocked < DEADLOCK_CHECK || t.pass > 0) continue;
      const circle: Truck[] = [t];
      let cur = byId.get(t.waitFor);
      while (cur && cur !== t && circle.length < 64 && cur.waitFor !== null && !circle.includes(cur)) {
        circle.push(cur);
        cur = byId.get(cur.waitFor);
      }
      if (cur !== t) continue;
      const first = circle.reduce((a, b) => (b.id < a.id ? b : a));
      first.pass = DEADLOCK_PASS;
    }
  }

  private release(t: Truck): void {
    for (const c of t.holds) if (this.reserved.get(c) === t.id) this.reserved.delete(c);
    t.holds = [];
  }

  private junctionMap(map: TerrainMap): Uint8Array {
    if (this.junctions && this.junctionVersion === map.cellsVersion) return this.junctions;
    const n = map.size;
    const road = (x: number, z: number) => x >= 0 && z >= 0 && x < n && z < n && map.cells[x][z] === CellType.Road;
    const j = new Uint8Array(n * n);
    for (let x = 0; x < n; x++)
      for (let z = 0; z < n; z++) {
        if (!road(x, z)) continue;
        let k = 0;
        for (let d = 0; d < 4; d++) if (road(x + DX[d], z + DZ[d])) k++;
        if (k >= 3) j[x * n + z] = 1;
      }
    this.junctions = j;
    this.junctionVersion = map.cellsVersion;
    return j;
  }

  /**
   * Junction rule: before entering a junction, wait until it is free and
   * the road past it has room for the whole truck; then reserve it until
   * the trailer is out. True = wait.
   */
  private junctionWait(t: Truck, map: TerrainMap, poses: Map<number, TruckPose>): boolean {
    const lane = t.lane;
    if (!lane) return false;
    if (t.holds.length) {
      if (t.s < t.holdUntil) return false; // crossing: carry on
      this.release(t);
    }
    if (t.pass > 0) return false;
    const n = map.size;
    const jm = this.junctionMap(map);
    const cellAt = (d: number) => {
      const [x, z] = laneAt(lane, d);
      const cx = Math.round(x), cz = Math.round(z);
      return cx >= 0 && cz >= 0 && cx < n && cz < n ? cx * n + cz : -1;
    };
    const isJ = (c: number) => c >= 0 && jm[c] === 1;
    // Already in a junction (e.g. started in one): just drive on.
    if (isJ(cellAt(t.s))) return false;
    // The next junction close ahead.
    let sIn = -1;
    for (let d = t.s + 0.1; d <= Math.min(lane.length, t.s + 0.6); d += 0.1)
      if (isJ(cellAt(d))) {
        sIn = d;
        break;
      }
    if (sIn < 0) return false;
    // Its run of junction cells along the lane.
    const run = new Set<number>();
    let sOut = sIn;
    for (let d = sIn; d <= lane.length; d += 0.1) {
      const c = cellAt(d);
      if (!isJ(c)) break;
      run.add(c);
      sOut = d;
    }
    for (const c of run) {
      const h = this.reserved.get(c);
      if (h !== undefined && h !== t.id) {
        const holder = this.trucks.find((q) => q.id === h);
        if (holder && holder.holds.includes(c)) return this.waitOn(t, holder);
        this.reserved.delete(c); // stale
      }
    }
    // Room past the junction for the whole truck (or up to the stop).
    const end = Math.min(lane.length, sOut + TRUCK_HITCH + TRAILER_AXLE + 0.4);
    for (const o of this.trucks) {
      const op = o !== t && poses.get(o.id);
      if (!op) continue;
      const body: Array<[number, number]> = [op.front, [op.x, op.z], op.rear, [(op.x + op.rear[0]) / 2, (op.z + op.rear[1]) / 2]];
      for (let d = sIn; d <= end + 1e-6; d += 0.1) {
        const [px, pz] = laneAt(lane, d);
        for (const [bx, bz] of body) if (Math.hypot(bx - px, bz - pz) < BODY_GAP) return this.waitOn(t, o);
      }
    }
    t.holds = [...run];
    for (const c of run) this.reserved.set(c, t.id);
    t.holdUntil = sOut + TRUCK_HITCH + TRAILER_AXLE + 0.2;
    return false;
  }

  /** Later trucks in the same tick see where this one went. */
  private updatePose(t: Truck, poses: Map<number, TruckPose>): void {
    const p = this.pose(t);
    if (p) poses.set(t.id, p);
    else poses.delete(t.id);
  }

  private setPath(t: Truck, path: Cell[] | null): void {
    this.release(t);
    t.path = path;
    t.lane = path && path.length ? buildLane(path) : null;
    t.s = 0;
    t.blocked = 0;
  }

  /**
   * Must truck `t` wait? True if another truck's body is on its lane just
   * ahead. When two trucks block each other (a crossing), the one that has
   * the other on its right gives way (jobbkéz-szabály); ties by id. After
   * GRIDLOCK seconds a truck drives through anyway.
   */
  private heldUp(t: Truck, poses: Map<number, TruckPose>): boolean {
    if (!t.lane || t.pass > 0) return false;
    const me = poses.get(t.id);
    if (!me) return false;
    for (const o of this.trucks) {
      if (o === t) continue;
      const op = poses.get(o.id);
      if (!op) continue;
      // On the very same spot (trucks starting at one stop): a parked one is
      // ignored; of two leaving together the lower id goes first.
      if (Math.hypot(op.x - me.x, op.z - me.z) < 0.1) {
        if (o.state === 'drive' && t.id > o.id) return this.waitOn(t, o);
        continue;
      }
      if (!this.inWay(t, op)) continue;
      // Mutual block (crossing): the right-hand rule decides.
      if (o.state === 'drive' && this.inWay(o, me)) {
        const [hx, hz] = [Math.cos(me.yaw), -Math.sin(me.yaw)];
        const onRight = (op.x - me.x) * -hz + (op.z - me.z) * hx > 0;
        const meOnItsRight = (me.x - op.x) * Math.sin(op.yaw) + (me.z - op.z) * Math.cos(op.yaw) > 0;
        if (onRight === meOnItsRight ? t.id > o.id : onRight) return this.waitOn(t, o);
        continue;
      }
      return this.waitOn(t, o);
    }
    return false;
  }

  /**
   * Would a truck starting on `lane` touch another one? A new truck (leaving
   * the depot) checks its whole length; one pulling out of a stop only the
   * road ahead (not the queue waiting behind it — that would lock both).
   */
  private startBlocked(t: Truck, lane: Lane, poses: Map<number, TruckPose>): boolean {
    if (t.pass > 0) return false;
    const fresh = !t.path;
    const me = poses.get(t.id);
    for (const o of this.trucks) {
      const op = o !== t && poses.get(o.id);
      if (!op) continue;
      // Someone waiting for US to leave: leaving is what frees them.
      if (me && o.state === 'drive' && this.inWay(o, me)) continue;
      const body: Array<[number, number]> = [op.front, [op.x, op.z], op.rear];
      for (let d = fresh ? -TRUCK_HITCH - TRAILER_AXLE - 0.2 : 0.12; d <= LOOK_AHEAD; d += 0.11) {
        const [px, pz] = laneAt(lane, d);
        for (const [bx, bz] of body) if (Math.hypot(bx - px, bz - pz) < BODY_GAP + 0.05) return this.waitOn(t, o);
      }
    }
    return false;
  }

  /** Is truck `o` (pose) on `t`'s lane within LOOK_AHEAD of its front? */
  private inWay(t: Truck, o: TruckPose): boolean {
    const lane = t.lane;
    if (!lane) return false;
    const body: Array<[number, number]> = [o.front, [o.x, o.z], o.rear, [(o.x + o.rear[0]) / 2, (o.z + o.rear[1]) / 2]];
    for (let d = 0.12; d <= LOOK_AHEAD + 1e-6; d += 0.11) {
      if (t.s + d > lane.length + 0.05) break;
      const [px, pz] = laneAt(lane, t.s + d);
      for (const [bx, bz] of body) if (Math.hypot(bx - px, bz - pz) < BODY_GAP) return true;
    }
    return false;
  }

  /** Unload what this stop takes (and get paid), then load for later stops. */
  private serveStop(
    t: Truck,
    line: Line,
    here: Station,
    byId: Map<number, Station>,
    map: TerrainMap,
    prod: ProductionSim,
    earn: (amount: number) => void,
  ): void {
    const type = map.cells[here.anchor[0]][here.anchor[1]];
    const takes = ACCEPTS[type] ?? [];
    const [hx, hz] = stopCenter(here);
    let pay = 0;
    for (const item of Object.keys(t.cargo) as Item[]) {
      const n = t.cargo[item] ?? 0;
      if (!n || !takes.includes(item)) continue;
      const k = prod.deliver(here.id, item, n);
      t.cargo[item] = n - k;
      const from = t.from !== null ? byId.get(t.from) : null;
      const dist = from ? Math.hypot(stopCenter(from)[0] - hx, stopCenter(from)[1] - hz) : 0;
      pay += Math.round(k * ITEMS[item].value * (1 + dist / DISTANCE_SCALE));
    }
    if (pay > 0) {
      earn(pay);
      this.payments.push({ amount: pay, x: hx, z: hz, age: 0 });
    }
    // Load what any OTHER stop of the line takes.
    const wanted = new Set<Item>();
    for (const id of line.stops) {
      if (id === here.id) continue;
      const s = byId.get(id);
      if (s) for (const it of ACCEPTS[map.cells[s.anchor[0]][s.anchor[1]]] ?? []) wanted.add(it);
    }
    let load = 0;
    for (const v of Object.values(t.cargo)) load += v ?? 0;
    for (const item of wanted) {
      if (load >= TRUCK_CAPACITY) break;
      const k = prod.take(here.id, item, TRUCK_CAPACITY - load);
      if (k > 0) {
        t.cargo[item] = (t.cargo[item] ?? 0) + k;
        load += k;
        t.from = here.id;
      }
    }
  }

  /** Match the trucks on each line to its `vehicles` count. */
  private syncFleet(): void {
    let changed = false;
    for (const line of this.snap.lines) {
      const mine = this.trucks.filter((t) => t.lineId === line.id);
      for (let i = mine.length; i < line.vehicles; i++) {
        // New trucks start at the first stop, a few seconds apart.
        this.trucks.push({
          id: this.nextTruck++,
          lineId: line.id,
          target: 0,
          path: null,
          lane: null,
          s: 0,
          state: 'stop',
          timer: STOP_TIME + i * 3,
          blocked: 0,
          holds: [],
          holdUntil: 0,
          waitFor: null,
          pass: 0,
          cargo: {},
          from: null,
        });
        changed = true;
      }
      if (mine.length > line.vehicles) {
        const drop = new Set(mine.slice(line.vehicles).map((t) => t.id));
        for (const t of mine.slice(line.vehicles)) this.release(t);
        this.trucks = this.trucks.filter((t) => !drop.has(t.id));
        changed = true;
      }
    }
    // Trucks of stops that vanished keep waiting; lines are not auto-removed.
    if (changed) this.set({ fleet: this.snap.fleet + 1 });
  }

  /**
   * Where a truck is (articulated pose), or null while it waits in the depot
   * (a new truck, before it first drives off; not drawn).
   */
  pose(t: Truck): TruckPose | null {
    return t.lane ? poseOnLane(t.lane, t.s) : null;
  }

  private set(patch: Partial<TransportSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }
}
