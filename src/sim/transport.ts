/**
 * Transport — lines and the vehicles running them (trucks for now).
 *
 * A LINE is a coloured loop over stops (truck stops on industry sides). Its
 * trucks drive stop → stop over the road network; at each stop they first
 * UNLOAD what that industry takes (ACCEPTS — it goes in through the gate and
 * pays: units × value × distance factor), then LOAD what a later stop of the
 * line takes from the stop's outgoing stock.
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
/** Seconds spent at a stop (un)loading. */
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
  /** Distance travelled along `path` (cells). */
  s: number;
  state: 'stop' | 'drive' | 'noroute';
  timer: number;
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

// ---------------------------------------------------------------- sim

export class TransportSim {
  private snap: TransportSnapshot = { lines: [], view: false, draft: null, noRoute: [], fleet: 0 };
  private trucks: Truck[] = [];
  private nextLine = 1;
  private nextTruck = 1;
  private routeCache = new Map<string, Cell[] | null>();
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
        this.serveStop(t, line, here, byId, map, prod, earn);
        // Head for the next stop.
        const next = (t.target + 1) % line.stops.length;
        t.path = this.route(map, here, byId.get(line.stops[next]) ?? null);
        t.s = 0;
        t.target = next;
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
      } else if (t.state === 'noroute') {
        noRoute.add(line.id);
        t.timer -= dt;
        if (t.timer > 0) continue;
        const prevStop = byId.get(line.stops[(t.target - 1 + line.stops.length) % line.stops.length]) ?? null;
        t.path = this.route(map, prevStop, here);
        t.s = 0;
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
      } else if (t.path) {
        t.s += dt * TRUCK_SPEED;
        if (t.s >= t.path.length - 1) {
          t.s = t.path.length - 1;
          t.state = 'stop';
          t.timer = STOP_TIME;
        }
      }
    }
    const nr = [...noRoute].sort((a, b) => a - b);
    if (nr.join() !== this.snap.noRoute.join()) this.set({ noRoute: nr });
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
          s: 0,
          state: 'stop',
          timer: STOP_TIME + i * 3,
          cargo: {},
          from: null,
        });
        changed = true;
      }
      if (mine.length > line.vehicles) {
        const drop = new Set(mine.slice(line.vehicles).map((t) => t.id));
        this.trucks = this.trucks.filter((t) => !drop.has(t.id));
        changed = true;
      }
    }
    // Trucks of stops that vanished keep waiting; lines are not auto-removed.
    if (changed) this.set({ fleet: this.snap.fleet + 1 });
  }

  /** Where a truck is: grid position, heading (radians about Y), at stop. */
  pose(t: Truck, map: TerrainMap): { x: number; z: number; yaw: number } | null {
    const line = this.snap.lines.find((l) => l.id === t.lineId);
    if (!line) return null;
    if (!t.path || t.path.length === 0) {
      const st = map.stations?.find((s) => s.id === line.stops[t.target]);
      if (!st) return null;
      const [x, z] = stopCenter(st);
      return { x, z, yaw: 0 };
    }
    const i = Math.min(t.path.length - 2, Math.floor(t.s));
    if (i < 0) return { x: t.path[0][0], z: t.path[0][1], yaw: 0 };
    const f = t.s - i;
    const [ax, az] = t.path[i];
    const [bx, bz] = t.path[i + 1];
    const dx = bx - ax, dz = bz - az;
    // Keep right: offset to the right of the driving direction.
    const lane = 0.2;
    return { x: ax + dx * f - dz * lane, z: az + dz * f + dx * lane, yaw: Math.atan2(-dz, dx) };
  }

  private set(patch: Partial<TransportSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }
}
