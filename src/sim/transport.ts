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
 *   - traffic controls (traffic.ts): wait for green at lights; at a STOP
 *     sign halt at the line; at a STOP / yield sign give way to trucks
 *     coming from the arms without a sign; drive round a roundabout's island;
 *   - pulling out of a stop gives way to the traffic;
 *   - two trucks waiting for each other elsewhere: the one with the other
 *     on its RIGHT gives way;
 *   - a real deadlock (trucks waiting for each other in a circle — not just a
 *     long queue) is broken: one truck of the circle drives on for a moment.
 *
 * Trucks speed up and brake gradually (ACCEL / DECEL): they slow down for
 * bends (lateral grip A_LAT), for a truck ahead, for a junction they will
 * have to wait at and for the end of their route.
 *
 * Depots (depot.ts) are stops too: a truck waits at the entrance while no
 * bay is free that it can reach without crossing another manoeuvring truck
 * (two may work at once if their bays are far enough apart), drives past
 * the bay, backs in, unloads what no other
 * stop of its line takes and loads what one does (that's the sorting), then
 * leaves by the exit. Cargo remembers where it came from: the final
 * delivery pays for the whole distance from that origin.
 *
 * Rail lines run TRAINS (rail.ts routes them): forward only, so the line
 * needs loops to turn round. Before leaving a stop a train reserves its way
 * (the track edges and the cells it shares with other tracks) up to the next
 * signal facing it (signals.ts) — or to the next stop if there is none; it
 * goes only when nobody else holds any of it, asks for the next block as it
 * nears a signal (halting at it while that is taken, or taking a free
 * parallel track), and frees the track behind its last wagon. Level crossings close for trucks while a
 * train is near; a train brakes for a truck still on one.
 *
 * Lines are immutable snapshot data (for the UI); the vehicles are mutable
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
import { ACCEPTS, INDUSTRY_ICON, INDUSTRY_NAME, ITEMS, type Item } from './interior';
import {
  bayApproach,
  bayPath,
  bayUsable,
  DEPOT_BAYS,
  depotCenter,
  depotEntrance,
  depotExit,
  driveCells,
  inBayZone,
  isDepot,
  type DepotDir,
} from './depot';
import type { ProductionSim } from './production';
import { brakeCapOn, laneAt, nearestS, polyLane, type Lane } from './lane';

export { laneAt, nearestS, polyLane, type Lane };
import { activeControl, lightState } from './traffic';
import {
  CAR_GAP,
  CAR_LEN,
  clipPath,
  locate,
  LOCO_LEN,
  makePath,
  netOf,
  pathAt,
  pathSignals,
  pathCells,
  pathValid,
  railRoute,
  stopTargets,
  trackBehind,
  type RailPath,
} from './rail';
import { hasRailAt as railAt } from './railNet';
import { SIGNAL_STOP } from './signals';

export interface Line {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly kind: LineKind;
  /** Stop (station) ids, visited in order and then back to the first. */
  readonly stops: readonly number[];
  /** Trucks / trains assigned. */
  readonly vehicles: number;
  /** Rail lines: wagons per train. */
  readonly wagons?: number;
}

/** Truck lines run on the roads, rail lines (trains) on the tracks. */
export type LineKind = 'truck' | 'rail';

export interface TransportSnapshot {
  lines: readonly Line[];
  /** The network (lines) view is open. */
  view: boolean;
  /** Stops picked so far for a new line, or null when not drafting. */
  draft: readonly number[] | null;
  /** What kind of line the draft is. */
  draftKind: LineKind;
  /** Rail lines whose trains have been waiting long for the track (it's taken). */
  stalled: readonly number[];
  /** Lines whose trucks find no road between two stops. */
  noRoute: readonly number[];
  /** Bumped when trucks are added / removed (re-render the truck list). */
  fleet: number;
}

/** Price of one truck; half is refunded when one is sold. */
export const TRUCK_PRICE = 1500;
/** Truck load (units). */
export const TRUCK_CAPACITY = 20;
/** Truck top speed (cells per game second). */
const TRUCK_SPEED = 3;
/** Acceleration and (comfortable) braking (cells/s²). */
const ACCEL = 2.4;
const DECEL = 4.5;
/** Lateral grip: the speed in a bend of radius r is at most √(A_LAT·r). */
const A_LAT = 5.5;
/** Speed through a free junction (cells/s). */
const JUNCTION_SPEED = 1.7;
/** Slowest creep while closing up to something (cells/s). */
const CREEP = 0.3;
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
/** A truck waiting at a line stops this far (cells) before the junction. */
const STOP_LINE = 0.18;
/** Seconds a truck halts at a STOP sign. */
const STOP_HOLD = 1;
/** How far ahead (cells) a truck at a sign looks for traffic it must let by. */
const YIELD_LOOK = 1.8;
/** Radius (cells) trucks drive round a roundabout's island. */
export const ROUNDABOUT_R = 0.3;
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
  /** `s` and `lane` at the previous tick (the renderer draws in between). */
  prevS: number;
  prevLane: Lane | null;
  /** Smooth right-lane path built from `path` (s runs along it). */
  lane: Lane | null;
  /** Current speed (cells/s; backwards while backing into a bay). */
  v: number;
  /** 'depot': in a depot's yard (see `depot`). */
  state: 'stop' | 'drive' | 'noroute' | 'depot';
  /** The visit to a depot under way (state 'depot'). */
  depot: DepotVisit | null;
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
  /** Junction cell it already halted for at a STOP sign (-1 = none). */
  stopDone: number;
  cargo: Partial<Record<Item, number>>;
  /** Where each kind of cargo came from (grid coords; for the distance pay). */
  origin: Partial<Record<Item, [number, number]>>;
}

/** A truck's visit to a depot: wait → in (past the bay) → back (in) → load → out. */
export interface DepotVisit {
  phase: 'wait' | 'in' | 'back' | 'load' | 'out';
  /** Which end it came in at (+1: lx 0, −1: lx 5; see depot.ts). */
  dir: DepotDir;
  bay: number;
  /** The bay's path (forward = leaving), and where on it the truck turns / docks. */
  bayLane: Lane | null;
  sP: number;
  sDock: number;
}

/** How far (cells) before a depot's drive a truck waits while its bays are full. */
const GATE_HOLD = 1.0;
/** Speed (cells/s) in a depot's yard, and backing in. */
const YARD_SPEED = 2.2;
const REVERSE_SPEED = 1.3;
/**
 * Two trucks may manoeuvre in a yard at once when their bays are at least
 * this many apart and the one driving in goes to the bay nearer the
 * entrance (so neither crosses the other's path).
 */
const BAY_APART = 3;

/** A truck manoeuvring in a depot's yard: driving in to / pulling out of a bay. */
interface YardClaim {
  truck: number;
  kind: 'in' | 'out';
  bay: number;
}

/** Prices: a locomotive and each wagon; half is refunded when sold. */
export const LOCO_PRICE = 5000;
export const WAGON_PRICE = 1000;
/** Wagons per train (a rail line's choice) and what each carries (units). */
export const DEFAULT_WAGONS = 3;
export const MIN_WAGONS = 1;
export const MAX_WAGONS = 6;
export const WAGON_CAPACITY = 30;
/** Price of a train of `wagons` wagons. */
export const trainPrice = (wagons: number): number => LOCO_PRICE + wagons * WAGON_PRICE;
/** A train from the loco's front to the last wagon's end (cells). */
export const trainLength = (wagons: number): number => LOCO_LEN + wagons * (CAR_LEN + CAR_GAP);
/** Train top speed, acceleration, braking (cells, s) and grip in bends. */
const TRAIN_SPEED = 4;
const TRAIN_ACCEL = 0.8;
const TRAIN_DECEL = 1.6;
const TRAIN_A_LAT = 4;
/** Seconds a train stands at a stop (un)loading. */
const TRAIN_STOP_TIME = 4;
/** A level crossing closes for trucks when a train's front is this close (cells). */
const CROSSING_CLOSE = 8;
/** Seconds a train may wait for the track before its line shows a warning. */
const STALL_WARN = 20;

export interface Train {
  readonly id: number;
  readonly lineId: number;
  /** Index (in the line's stops) of the stop it's at / heading to. */
  target: number;
  /** Its path (null: not on the network yet / any more); the front is at `s`. */
  path: RailPath | null;
  s: number;
  /** `s` and `path` at the previous tick (the renderer draws in between). */
  prevS: number;
  prevPath: RailPath | null;
  v: number;
  /** How far the front may go on `path` for now (short of a taken platform). */
  limit: number;
  state: 'stop' | 'drive' | 'noroute';
  timer: number;
  /** Seconds waiting for the track. */
  blocked: number;
  cargo: Partial<Record<Item, number>>;
  origin: Partial<Record<Item, [number, number]>>;
  /** Its wagons (the line's choice, taken on at a stop) and its length (cells). */
  wagons: number;
  len: number;
  /** Reserved track ('e' + edge id, 'c' + shared cell) → path distance the front leaves it at. */
  holds: Map<string, number>;
  /** Level crossings on its path: road cell → [enter, leave] path distances of the front. */
  crossings: Map<number, [number, number]>;
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

/** The road row of a truck stop (where trucks stop); a depot's drive. */
export function stopCells(st: Station): Cell[] {
  return isDepot(st) ? driveCells(st) : stationGeom(st.anchor, st.side).track;
}

/** Road cells a truck heading TO a stop aims for (a depot: its entrance). */
function arriveCells(st: Station): Cell[] {
  return isDepot(st) ? [depotEntrance(st)] : stopCells(st);
}
/** Road cells a truck LEAVING a stop starts from (a depot: its exit). */
function leaveCells(st: Station): Cell[] {
  return isDepot(st) ? [depotExit(st)] : stopCells(st);
}
/**
 * Road route honouring the depots' one-way drives (entrance → exit). A depot
 * whose exit isn't connected onward gives no route (the line shows it).
 */
function oneWayRoute(map: TerrainMap, from: Cell[], to: Cell[]): Cell[] | null {
  return roadRoute(map, from, to, true);
}

/** Display name of a stop: the industry it serves, or the depot. */
export function stopLabel(map: TerrainMap, st: Station | null | undefined): string {
  if (!st) return '?';
  if (isDepot(st)) return '🏬 Raktár';
  const t = map.cells[st.anchor[0]][st.anchor[1]];
  return `${INDUSTRY_ICON[t] ?? ''} ${INDUSTRY_NAME[t] ?? ''}`.trim() || '?';
}

/** Centre of a stop's road row (grid coords); a depot's lot centre. */
export function stopCenter(st: Station): [number, number] {
  if (isDepot(st)) return depotCenter(st);
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
export function roadRoute(map: TerrainMap, from: Cell[], to: Cell[], oneWay = false): Cell[] | null {
  const n = map.size;
  const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < n && z < n && map.cells[x][z] === CellType.Road;
  const kind = (x: number, z: number): SlopeKind => {
    const k = getSlopeKind(map, x, z);
    return k === 'invalid' ? 'flat' : k;
  };
  const crossing = (x: number, z: number): 'x' | 'z' | null => (hasRailAt(map, x, z) ? (roadCrossingAxis(map, x, z) ?? 'x') : null);
  const goal = new Set(to.map(([x, z]) => x * n + z));
  // A depot's drive is one-way (entrance → exit): no steps back along it.
  const noStep = new Set<number>();
  if (oneWay)
    for (const st of map.stations ?? []) {
      if (!isDepot(st)) continue;
      const d = driveCells(st);
      for (let i = 1; i < d.length; i++) noStep.add((d[i][0] * n + d[i][1]) * n * n + d[i - 1][0] * n + d[i - 1][1]);
    }

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
      if (prev[k] !== -2 || noStep.has(c * n * n + k)) continue;
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

/**
 * The right lane along a cell route: offset by LANE to the right, corners
 * rounded with a quadratic curve (from the cell edge before to the cell edge
 * after; its control point is where the two offset lanes meet — so a right
 * turn is tight and a left turn wide). A U-turn swings round the cell.
 */
export function buildLane(path: Cell[], roundabout?: (x: number, z: number) => boolean): Lane {
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
      if (roundabout?.(cx, cz)) {
        // Round the island counter-clockwise (as seen from above: the angle
        // atan2(z, x) DEcreases), easing in from / out to the lane.
        const ex = cx - din[0] * 0.5 + rin[0], ez = cz - din[1] * 0.5 + rin[1];
        const xx = cx + dout[0] * 0.5 + rout[0], xz = cz + dout[1] * 0.5 + rout[1];
        const a0 = Math.atan2(ez - cz, ex - cx), a1 = Math.atan2(xz - cz, xx - cx);
        let sweep = a0 - a1;
        while (sweep <= 0.2) sweep += Math.PI * 2;
        const r0 = Math.hypot(ex - cx, ez - cz);
        const N = Math.max(8, Math.ceil(sweep / 0.2));
        for (let k = 0; k <= N; k++) {
          const f = k / N;
          const a = a0 - sweep * f;
          const ease = Math.min(1, f / 0.22, (1 - f) / 0.22);
          const r = r0 + (ROUNDABOUT_R - r0) * Math.sin((ease * Math.PI) / 2);
          push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
        }
        continue;
      }
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

/** The truck speed cap at `s` for the bends ahead and a stop at `stopAt` (see lane.ts). */
const brakeCap = (l: Lane, s: number, top: number, stopAt = Infinity) => brakeCapOn(l, s, top, DECEL, A_LAT, stopAt);

/**
 * Where on a new lane a parked truck (pose `p`) carries on from: the point
 * by its front when the lane runs that way past it, else the lane's start.
 */
function startS(l: Lane, p: TruckPose | undefined): number {
  if (!p) return 0;
  const s = nearestS(l, p.front, 3.5);
  const [x, z] = laneAt(l, s);
  const [x2, z2] = laneAt(l, s + 0.1);
  const along = ((x2 - x) * Math.cos(p.yaw) - (z2 - z) * Math.sin(p.yaw)) / 0.1;
  return Math.hypot(x - p.front[0], z - p.front[1]) < 0.3 && along > 0.7 ? s : 0;
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
  private snap: TransportSnapshot = { lines: [], view: false, draft: null, draftKind: 'truck', noRoute: [], stalled: [], fleet: 0 };
  private trucks: Truck[] = [];
  private trains: Train[] = [];
  private nextLine = 1;
  private nextTruck = 1;
  private nextTrain = 1;
  /** Reserved track (see Train.holds) → the train holding it. */
  private railHeld = new Map<string, number>();
  private routeCache = new Map<string, Cell[] | null>();
  /** Yard zones claimed this tick by trucks driving to / backing into a bay. */
  private zones: Array<{ st: Station; bay: number; dir: DepotDir; owner: number }> = [];
  /** Depot id → the trucks manoeuvring in its yard. */
  private yard = new Map<number, YardClaim[]>();
  /** Depot id → which truck holds each loading bay (null = free). */
  private bays = new Map<number, Array<number | null>>();
  /** Game seconds since the start (drives the traffic lights). */
  clock = 0;
  /** Real time (ms) of the last tick and the usual gap between ticks (drawing in between). */
  private tickAt = 0;
  private tickGap = 50;
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

  /** Current trains (mutable runtime objects; read-only for callers). */
  allTrains(): readonly Train[] {
    return this.trains;
  }

  setView(on: boolean): void {
    if (this.snap.view === on) return;
    this.set({ view: on, draft: on ? this.snap.draft : null });
  }

  startDraft(kind: LineKind = 'truck'): void {
    this.set({ draft: [], draftKind: kind });
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
      kind: this.snap.draftKind,
      stops: d.slice(),
      vehicles: 1,
      ...(this.snap.draftKind === 'rail' ? { wagons: DEFAULT_WAGONS } : {}),
    };
    this.set({ lines: this.snap.lines.concat(line), draft: null });
    return line;
  }

  removeLine(id: number): void {
    for (const t of this.trucks)
      if (t.lineId === id) {
        this.release(t);
        this.leaveDepot(t);
      }
    this.trucks = this.trucks.filter((t) => t.lineId !== id);
    for (const t of this.trains) if (t.lineId === id) this.releaseTrack(t);
    this.trains = this.trains.filter((t) => t.lineId !== id);
    this.set({ lines: this.snap.lines.filter((l) => l.id !== id), fleet: this.snap.fleet + 1 });
  }

  /** A rail line's train length (trains take it on at their next stop). */
  setWagons(id: number, n: number): void {
    const w = Math.max(MIN_WAGONS, Math.min(MAX_WAGONS, n));
    this.set({ lines: this.snap.lines.map((l) => (l.id === id ? { ...l, wagons: w } : l)) });
  }

  setVehicles(id: number, n: number): void {
    this.set({ lines: this.snap.lines.map((l) => (l.id === id ? { ...l, vehicles: Math.max(0, n) } : l)) });
  }

  /** Road route of each leg of a line (for drawing). */
  linePaths(map: TerrainMap, line: Line): Array<Cell[] | null> {
    const st = (id: number) => map.stations?.find((s) => s.id === id) ?? null;
    return line.stops.map((a, i) => this.route(map, st(a), st(line.stops[(i + 1) % line.stops.length])));
  }

  /**
   * A rail line's way round (from its first stop through all of them and
   * back), as one polyline — or null if a leg has no forward route.
   */
  railLinePath(map: TerrainMap, stops: readonly number[], closed = true): Array<[number, number]> | null {
    const net = netOf(map);
    const st = (id: number) => map.stations?.find((s) => s.id === id) ?? null;
    const first = st(stops[0]);
    if (!first || stops.length < 2) return null;
    const legs = closed ? stops.length : stops.length - 1;
    // Start from any way of standing at the first stop that gets round.
    for (const start of stopTargets(net, first)) {
      const pts: Array<[number, number]> = [];
      let from = start as { edge: number; along: number; fwd: boolean };
      let ok = true;
      for (let i = 0; i < legs && ok; i++) {
        const to = st(stops[(i + 1) % stops.length]);
        const r = to ? railRoute(net, from, stopTargets(net, to)) : null;
        if (!r) {
          ok = false;
          break;
        }
        const p = makePath(net, r.segs);
        for (let k = 0; k < p.xs.length; k++) pts.push([p.xs[k], p.zs[k]]);
        from = r.target;
      }
      if (ok) return pts;
    }
    return null;
  }

  /** Route between two stops (cached per map version). */
  route(map: TerrainMap, a: Station | null, b: Station | null): Cell[] | null {
    if (!a || !b) return null;
    if (this.routeVersion !== map.cellsVersion) {
      this.routeCache.clear();
      this.routeVersion = map.cellsVersion;
    }
    const key = `${a.id}>${b.id}`;
    if (!this.routeCache.has(key)) this.routeCache.set(key, oneWayRoute(map, leaveCells(a), arriveCells(b)));
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
    // Remember where everyone was: the renderer moves them smoothly from
    // there to the new place until the next tick.
    const now = globalThis.performance?.now() ?? Date.now();
    if (this.tickAt) this.tickGap += (Math.min(200, Math.max(10, now - this.tickAt)) - this.tickGap) * 0.2;
    this.tickAt = now;
    for (const t of this.trucks) {
      t.prevS = t.s;
      t.prevLane = t.lane;
    }
    for (const t of this.trains) {
      t.prevS = t.s;
      t.prevPath = t.path;
    }
    if (dt <= 0) return;
    this.clock += dt;
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
    this.zones = [];
    for (const t of this.trucks) {
      const v = t.depot;
      if (!v || (v.phase !== 'in' && v.phase !== 'back')) continue;
      const line = this.snap.lines.find((l) => l.id === t.lineId);
      const st = line ? byId.get(line.stops[t.target]) : undefined;
      if (st) this.zones.push({ st, bay: v.bay, dir: v.dir, owner: t.id });
    }
    for (const t of this.trucks) {
      const line = this.snap.lines.find((l) => l.id === t.lineId);
      if (!line) continue;
      const here = byId.get(line.stops[t.target]);
      if (!here || (stopKind(here) !== 'truck' && !isDepot(here))) {
        if (t.depot) this.leaveDepot(t);
        noRoute.add(line.id);
        continue;
      }
      if (t.state === 'depot') {
        this.tickDepot(t, dt, line, here, byId, map, prod, earn, poses);
        continue;
      }
      if (t.state === 'stop') {
        t.timer -= dt;
        if (t.timer > 0) continue;
        const next = (t.target + 1) % line.stops.length;
        // Pulling out (or out of the depot) gives way to the traffic.
        const r = this.route(map, here, byId.get(line.stops[next]) ?? null);
        const lane = r && r.length ? this.laneOf(r, map) : null;
        // It pulls out from where it stands (no jump back onto the queue).
        const s0 = lane ? startS(lane, poses.get(t.id)) : 0;
        if (lane && this.startBlocked(t, lane, s0, poses)) {
          t.timer = 0.3;
          t.blocked += 0.3;
          continue;
        }
        t.blocked = 0;
        t.waitFor = null;
        t.v = 0;
        this.serveStop(t, TRUCK_CAPACITY, line, here, byId, map, prod, earn);
        // Head for the next stop.
        this.setPath(t, r, map);
        if (t.lane) t.s = s0;
        t.target = next;
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
        this.updatePose(t, poses);
      } else if (t.state === 'noroute') {
        noRoute.add(line.id);
        t.timer -= dt;
        if (t.timer > 0) continue;
        const prevStop = byId.get(line.stops[(t.target - 1 + line.stops.length) % line.stops.length]) ?? null;
        this.setPath(t, this.route(map, prevStop, here), map);
        t.state = t.path ? 'drive' : 'noroute';
        t.timer = 2;
      } else if (t.lane) {
        // Coming to a depot with no bay it can reach now: wait at its stop
        // line, out on the road — not in the yard. At the line it claims a
        // bay and its way in.
        const gate = isDepot(here) && !t.depot ? t.lane.length - this.gateHold(t, map) : Infinity;
        if (t.s >= gate) {
          const bay = this.pickBay(here, t);
          if (bay < 0) {
            t.blocked += dt;
            t.v = 0;
            t.waitFor = this.yardList(here.id)[0]?.truck ?? null;
            continue;
          }
          this.bayList(here.id)[bay] = t.id;
          this.yardList(here.id).push({ truck: t.id, kind: 'in', bay });
          t.depot = { phase: 'wait', dir: 1, bay, bayLane: null, sP: 0, sDock: 0 };
        }
        const xing = this.crossingAhead(t, map, 0.9);
        if (xing >= 0) {
          // A level crossing closed for a train: halt before it.
          t.blocked += dt;
          const room = this.heldUp(t, poses) ? 0 : xing;
          t.waitFor = null;
          if (room > 0.03) {
            t.v = Math.min(t.v, Math.sqrt(2 * DECEL * 1.6 * room));
            t.s += Math.min(t.v * dt, room);
            this.updatePose(t, poses);
          } else t.v = 0;
          continue;
        }
        if (this.junctionWait(t, map, poses)) {
          // Not to enter yet: brake to a halt at the line (still clear of
          // the truck ahead), not on the spot.
          const w = t.waitFor;
          const room = this.heldUp(t, poses) ? 0 : this.toJunctionLine(t, map);
          t.waitFor = w;
          t.blocked += dt;
          if (room > 0.03) {
            t.v = Math.min(t.v, Math.sqrt(2 * DECEL * 1.6 * room));
            t.s += Math.min(t.v * dt, room);
            this.updatePose(t, poses);
          } else t.v = 0;
          continue;
        }
        if (this.heldUp(t, poses)) {
          t.blocked += dt;
          t.v = 0;
          continue;
        }
        t.blocked = 0;
        t.waitFor = null;
        const stopAt = Math.min(t.lane.length, gate < Infinity && this.pickBay(here, t) < 0 ? gate : Infinity);
        let cap = Math.min(brakeCap(t.lane, t.s, TRUCK_SPEED, stopAt), this.trafficCap(t, map, poses));
        if (stopAt - t.s > 0.02) cap = Math.max(cap, CREEP);
        t.v = Math.min(t.v + ACCEL * dt, cap);
        t.s = Math.min(t.s + t.v * dt, t.lane.length);
        this.updatePose(t, poses);
        if (t.s >= t.lane.length) {
          t.s = t.lane.length;
          this.release(t); // parked at the stop: the junction is free again
          t.v = 0;
          if (isDepot(here)) {
            // In at the entrance (the drive is one-way).
            t.state = 'depot';
            t.depot ??= { phase: 'wait', dir: 1, bay: -1, bayLane: null, sP: 0, sDock: 0 };
          } else {
            t.state = 'stop';
            t.timer = STOP_TIME;
          }
        }
      }
    }
    this.breakDeadlocks();
    const stalled = new Set<number>();
    this.tickTrains(dt, map, byId, prod, earn, noRoute, stalled, poses);
    const nr = [...noRoute].sort((a, b) => a - b);
    if (nr.join() !== this.snap.noRoute.join()) this.set({ noRoute: nr });
    const sl = [...stalled].sort((a, b) => a - b);
    if (sl.join() !== this.snap.stalled.join()) this.set({ stalled: sl });
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
    const ctl = this.controlWait(t, map, sIn, run, cellAt);
    if (ctl === 'wait') return true;
    if (ctl === 'approach') return false; // up to the line, no reservation yet
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

  /**
   * Lights and signs before junction `run` (entered at lane distance sIn):
   * 'wait' at the line, 'approach' = drive on up to the line (must not enter
   * yet), 'go' = may enter (if the junction rules let it).
   */
  private controlWait(
    t: Truck,
    map: TerrainMap,
    sIn: number,
    run: Set<number>,
    cellAt: (d: number) => number,
  ): 'go' | 'wait' | 'approach' {
    const n = map.size;
    const jIn = cellAt(sIn);
    const arm = cellAt(Math.max(0, sIn - 0.35));
    if (jIn < 0 || arm < 0 || arm === jIn) return 'go';
    const jx = Math.floor(jIn / n), jz = jIn % n;
    const ax = Math.floor(arm / n), az = arm % n;
    const atLine = sIn - t.s <= STOP_LINE;
    const hold = (): 'wait' => {
      t.waitFor = null;
      return 'wait';
    };
    // Traffic lights: red / amber → wait at the line.
    if (activeControl(map, jx, jz) === 'light' && lightState(this.clock, ax !== jx ? 'x' : 'z') !== 'green') {
      return atLine ? hold() : 'approach';
    }
    const sign = activeControl(map, ax, az);
    if (sign !== 'stop' && sign !== 'yield') return 'go';
    if (!atLine) return 'approach'; // drive up to the line first
    // STOP: a full halt at the line, once per junction.
    if (sign === 'stop' && t.stopDone !== jIn) {
      if (t.blocked < STOP_HOLD) return hold();
      t.stopDone = jIn;
    }
    // Give way to trucks about to enter from an arm WITHOUT a sign.
    for (const o of this.trucks) {
      if (o === t || o.state !== 'drive' || !o.lane) continue;
      const ol = o.lane;
      const oc = (d: number) => {
        const [x, z] = laneAt(ol, d);
        const cx = Math.round(x), cz = Math.round(z);
        return cx >= 0 && cz >= 0 && cx < n && cz < n ? cx * n + cz : -1;
      };
      if (run.has(oc(o.s))) continue; // already in it: the reservation handles it
      for (let d = o.s + 0.1; d <= Math.min(ol.length, o.s + YIELD_LOOK); d += 0.1) {
        if (!run.has(oc(d))) continue;
        const oa = oc(Math.max(0, d - 0.35));
        const k = oa >= 0 ? activeControl(map, Math.floor(oa / n), oa % n) : null;
        if (k !== 'stop' && k !== 'yield') {
          this.waitOn(t, o);
          return 'wait';
        }
        break;
      }
    }
    return 'go';
  }

  /**
   * Speed cap for what's ahead on the road: brake to stay LOOK_AHEAD behind
   * a truck ahead, and for a junction — to a stop at its line when it looks
   * like a wait there (taken, red light, a sign), else to JUNCTION_SPEED.
   */
  private trafficCap(t: Truck, map: TerrainMap, poses: Map<number, TruckPose>): number {
    const lane = t.lane;
    const me = poses.get(t.id);
    if (!lane || !me || t.pass > 0) return TRUCK_SPEED;
    const range = (TRUCK_SPEED * TRUCK_SPEED) / (2 * DECEL) + LOOK_AHEAD;
    let cap = TRUCK_SPEED;
    // The nearest truck body on the lane ahead.
    const near: Array<[number, number]> = [];
    for (const o of this.trucks) {
      const op = o !== t && poses.get(o.id);
      if (!op || Math.hypot(op.x - me.x, op.z - me.z) > range + 1.5) continue;
      if (Math.hypot(op.x - me.x, op.z - me.z) < 0.1) continue; // same spot (see heldUp)
      near.push(op.front, [op.x, op.z], op.rear, [(op.x + op.rear[0]) / 2, (op.z + op.rear[1]) / 2]);
    }
    if (near.length)
      for (let d = 0.12; d <= range; d += 0.1) {
        if (t.s + d > lane.length + 0.05) break;
        const [px, pz] = laneAt(lane, t.s + d);
        if (near.some(([bx, bz]) => Math.hypot(bx - px, bz - pz) < BODY_GAP)) {
          cap = Math.sqrt(2 * DECEL * Math.max(0, d - LOOK_AHEAD));
          break;
        }
      }
    // A level crossing closed ahead.
    const xing = this.crossingAhead(t, map, range);
    if (xing >= 0) cap = Math.min(cap, Math.sqrt(2 * DECEL * xing));
    // The next junction ahead (one this truck hasn't reserved yet).
    if (!t.holds.length) {
      const n = map.size;
      const jm = this.junctionMap(map);
      const cellAt = (d: number) => {
        const [x, z] = laneAt(lane, d);
        const cx = Math.round(x), cz = Math.round(z);
        return cx >= 0 && cz >= 0 && cx < n && cz < n ? cx * n + cz : -1;
      };
      const here = cellAt(t.s);
      if (here < 0 || jm[here] !== 1)
        for (let d = 0.1; d <= range && t.s + d <= lane.length; d += 0.1) {
          const c = cellAt(t.s + d);
          if (c < 0 || jm[c] !== 1) continue;
          const arm = cellAt(Math.max(0, t.s + d - 0.35));
          const jx = Math.floor(c / n), jz = c % n;
          const ax = Math.floor(arm / n), az = arm % n;
          const h = this.reserved.get(c);
          const sign = arm >= 0 ? activeControl(map, ax, az) : null;
          const wait =
            (h !== undefined && h !== t.id) ||
            sign === 'stop' ||
            sign === 'yield' ||
            (activeControl(map, jx, jz) === 'light' && lightState(this.clock, ax !== jx ? 'x' : 'z') !== 'green');
          const toLine = Math.max(0, d - STOP_LINE - 0.05);
          cap = Math.min(cap, Math.sqrt((wait ? 0 : JUNCTION_SPEED ** 2) + 2 * DECEL * toLine));
          break;
        }
    }
    return cap;
  }

  /** Lane distance from `t` to the stop line of the junction just ahead (0: none / at it). */
  private toJunctionLine(t: Truck, map: TerrainMap): number {
    const lane = t.lane;
    if (!lane) return 0;
    const n = map.size;
    const jm = this.junctionMap(map);
    for (let d = 0.05; d <= 0.8 && t.s + d <= lane.length; d += 0.05) {
      const [x, z] = laneAt(lane, t.s + d);
      const cx = Math.round(x), cz = Math.round(z);
      if (cx >= 0 && cz >= 0 && cx < n && cz < n && jm[cx * n + cz] === 1) return Math.max(0, d - STOP_LINE);
    }
    return 0;
  }

  /** Later trucks in the same tick see where this one went. */
  private updatePose(t: Truck, poses: Map<number, TruckPose>): void {
    const p = this.pose(t);
    if (p) poses.set(t.id, p);
    else poses.delete(t.id);
  }

  /** The lane along a route (round any roundabouts on it). */
  private laneOf(path: Cell[], map: TerrainMap): Lane {
    return buildLane(path, (x, z) => activeControl(map, x, z) === 'roundabout');
  }

  private setPath(t: Truck, path: Cell[] | null, map: TerrainMap): void {
    this.release(t);
    t.path = path;
    t.lane = path && path.length ? this.laneOf(path, map) : null;
    t.stopDone = -1;
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
    // Keep out of a depot yard zone where another truck is backing into a bay.
    if (this.zones.length) {
      const lane = t.lane;
      // (Through traffic only: the yard's own trucks share it by their claims, see yardFits.)
      const [fx, fz] = laneAt(lane, t.s);
      for (const zn of this.zones) {
        if (t.depot || zn.owner === t.id) continue;
        if (inBayZone(zn.st, zn.bay, zn.dir, fx, fz)) continue; // already in: drive on out
        for (let d = 0; d <= LOOK_AHEAD + 1e-6; d += 0.11) {
          const [px, pz] = laneAt(lane, t.s + d);
          if (inBayZone(zn.st, zn.bay, zn.dir, px, pz)) {
            const o = this.trucks.find((q) => q.id === zn.owner);
            return o ? this.waitOn(t, o) : true;
          }
        }
      }
    }
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
   * Would a truck starting on `lane` at `s0` touch another one? It checks
   * its whole length and, pulling out of a stop, a bit more behind (traffic
   * coming up) — but not trucks waiting for it (the queue behind it: that
   * would lock both).
   */
  private startBlocked(t: Truck, lane: Lane, s0: number, poses: Map<number, TruckPose>): boolean {
    if (t.pass > 0) return false;
    const fresh = !t.path;
    const me = poses.get(t.id);
    for (const o of this.trucks) {
      const op = o !== t && poses.get(o.id);
      if (!op) continue;
      // Someone waiting for US to leave: leaving is what frees them.
      if (me && o.state === 'drive' && this.inWay(o, me)) continue;
      const body: Array<[number, number]> = [op.front, [op.x, op.z], op.rear];
      for (let d = -TRUCK_HITCH - TRAILER_AXLE - (fresh ? 0.2 : 0.6); d <= LOOK_AHEAD; d += 0.11) {
        const [px, pz] = laneAt(lane, s0 + d);
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

  /**
   * How far before the end of its route (a depot's entrance) a truck waits
   * for the yard: GATE_HOLD — or before the junction(s) right in front of
   * the entrance, so a waiting truck never blocks a junction.
   */
  private gateHold(t: Truck, map: TerrainMap): number {
    const path = t.path;
    if (!path || path.length < 2) return GATE_HOLD;
    const jm = this.junctionMap(map);
    const n = map.size;
    let k = path.length - 2;
    while (k >= 0 && jm[path[k][0] * n + path[k][1]] === 1) k--;
    return Math.max(GATE_HOLD, path.length - 1 - k - 0.45);
  }

  /** The trucks manoeuvring in a depot's yard (gone trucks dropped). */
  private yardList(id: number): YardClaim[] {
    let y = this.yard.get(id);
    if (!y) this.yard.set(id, (y = []));
    for (let i = y.length - 1; i >= 0; i--) if (!this.trucks.some((q) => q.id === y![i].truck)) y.splice(i, 1);
    return y;
  }

  /**
   * May truck `t` (null: any) start manoeuvring `kind` at bay `bay` beside
   * the others in the yard? One driving in must stay clear of everyone (its
   * bay BAY_APART nearer the entrance than theirs); one pulling out must not
   * pass anyone backing in (they are BAY_APART nearer the entrance).
   */
  private yardFits(id: number, kind: 'in' | 'out', bay: number, t: Truck | null): boolean {
    for (const c of this.yardList(id)) {
      if (c.truck === t?.id) continue;
      if (kind === 'in' ? c.bay - bay < BAY_APART : c.kind === 'out' || bay - c.bay < BAY_APART) return false;
    }
    return true;
  }

  /**
   * The bay a truck arriving now would back into: the free one farthest from
   * the entrance that fits beside the yard's traffic (so the next truck can
   * take a near one at the same time), or -1.
   */
  private pickBay(st: Station, t: Truck | null): number {
    const bays = this.bayList(st.id);
    for (let i = bays.length - 1; i >= 0; i--)
      if (bays[i] === null && bayUsable(i, 1) && this.yardFits(st.id, 'in', i, t)) return i;
    return -1;
  }

  /** Drop a truck's yard claims (it docked / left). */
  private freeYard(t: Truck): void {
    for (const y of this.yard.values())
      for (let i = y.length - 1; i >= 0; i--) if (y[i].truck === t.id) y.splice(i, 1);
  }

  /** May a truck drive into the depot now (the entrance signal is green)? */
  depotOpen(id: number): boolean {
    const st: Station = { id, anchor: [0, 0], side: 'S', kind: 'depot' };
    return this.pickBay(st, null) >= 0;
  }

  /** Which bays of a depot hold (or are reserved by) a truck. */
  depotBays(id: number): boolean[] {
    const b = this.bays.get(id);
    return Array.from({ length: DEPOT_BAYS }, (_, i) => b?.[i] != null);
  }

  private bayList(id: number): Array<number | null> {
    let b = this.bays.get(id);
    if (!b) this.bays.set(id, (b = Array.from({ length: DEPOT_BAYS }, () => null)));
    return b;
  }

  /** Free a truck's bay and drop its depot visit. */
  private leaveDepot(t: Truck): void {
    for (const b of this.bays.values()) for (let i = 0; i < b.length; i++) if (b[i] === t.id) b[i] = null;
    this.freeYard(t);
    t.depot = null;
    if (t.state === 'depot') t.state = 'stop';
  }

  /**
   * A truck in a depot's yard: wait at the entrance until a bay is free,
   * drive past it, back in, (un)load, pull out and leave by the exit.
   */
  private tickDepot(
    t: Truck,
    dt: number,
    line: Line,
    here: Station,
    byId: Map<number, Station>,
    map: TerrainMap,
    prod: ProductionSim,
    earn: (amount: number) => void,
    poses: Map<number, TruckPose>,
  ): void {
    const v = t.depot;
    if (!v) {
      t.state = 'stop';
      return;
    }
    if (v.phase === 'wait') {
      // Normally the bay was claimed at the stop line already.
      if (v.bay < 0) {
        const bay = this.pickBay(here, t);
        if (bay < 0) {
          t.blocked += dt; // the entrance signal is red
          return;
        }
        this.bayList(here.id)[bay] = t.id;
        this.yardList(here.id).push({ truck: t.id, kind: 'in', bay });
        v.bay = bay;
      }
      const path = bayPath(here, v.bay, v.dir);
      v.bayLane = polyLane(path.pts);
      v.sP = path.sP;
      v.sDock = path.sDock;
      t.lane = polyLane(bayApproach(here, v.bay, v.dir));
      t.s = 0;
      t.blocked = 0;
      v.phase = 'in';
    } else if (v.phase === 'in' && t.lane) {
      if (this.heldUp(t, poses)) {
        t.blocked += dt;
        t.v = 0;
        return;
      }
      t.blocked = 0;
      const cap = Math.max(Math.min(brakeCap(t.lane, t.s, YARD_SPEED, t.lane.length), this.trafficCap(t, map, poses)), CREEP);
      t.v = Math.min(t.v + ACCEL * dt, cap);
      t.s += dt * t.v;
      if (t.s >= t.lane.length) {
        // Stopped past the bay: from here on it moves along the bay's path.
        t.lane = v.bayLane;
        t.s = v.sP;
        t.v = 0;
        v.phase = 'back';
      }
    } else if (v.phase === 'back') {
      t.blocked = 0;
      // Backing in: ease off, creep the last bit up to the dock.
      const cap = Math.max(Math.min(REVERSE_SPEED, Math.sqrt(2 * DECEL * 0.5 * Math.max(0, t.s - v.sDock))), CREEP * 0.6);
      t.v = Math.min(t.v + ACCEL * 0.6 * dt, cap);
      t.s -= dt * t.v;
      if (t.s <= v.sDock) {
        t.s = v.sDock;
        t.v = 0;
        this.serveStop(t, TRUCK_CAPACITY, line, here, byId, map, prod, earn);
        t.timer = STOP_TIME;
        v.phase = 'load';
        this.freeYard(t); // docked: the next truck may manoeuvre
      }
    } else if (v.phase === 'load') {
      t.timer -= dt;
      if (t.timer <= 0) {
        if (this.yardFits(here.id, 'out', v.bay, t)) {
          this.yardList(here.id).push({ truck: t.id, kind: 'out', bay: v.bay });
          v.phase = 'out';
          t.blocked = 0;
        } else {
          t.blocked += dt;
          t.waitFor = this.yardList(here.id)[0]?.truck ?? null;
        }
      }
    } else if (v.phase === 'out' && t.lane) {
      if (this.heldUp(t, poses)) {
        t.blocked += dt;
        t.v = 0;
        return;
      }
      t.blocked = 0;
      const cap = Math.max(Math.min(brakeCap(t.lane, t.s, YARD_SPEED), this.trafficCap(t, map, poses)), CREEP);
      t.v = Math.min(t.v + ACCEL * dt, cap);
      t.s += dt * t.v;
      if (t.s < t.lane.length) {
        this.updatePose(t, poses);
        return;
      }
      // Out on the road at the far end: free the bay, head for the next stop
      // — once the start of that route is clear.
      const front = laneAt(t.lane, t.lane.length);
      const next = (t.target + 1) % line.stops.length;
      const route = this.route(map, here, byId.get(line.stops[next]) ?? null);
      if (route && route.length) {
        const lane = this.laneOf(route, map);
        const s0 = nearestS(lane, front, 1.2);
        const ahead = { ...t, lane, s: s0, path: route } as Truck;
        if (this.heldUp(ahead, poses)) {
          t.s = t.lane.length;
          t.v = 0;
          t.blocked += dt;
          t.waitFor = ahead.waitFor;
          return;
        }
      }
      this.leaveDepot(t);
      this.setPath(t, route, map);
      t.target = next;
      t.state = t.path ? 'drive' : 'noroute';
      t.timer = 2;
      // Pick the new route up where the truck is (no jump back).
      if (t.lane) t.s = nearestS(t.lane, front, 1.2);
    }
    this.updatePose(t, poses);
  }

  /** Unload what this stop takes (and get paid), then load (up to `cap`) for later stops. */
  private serveStop(
    t: Pick<Truck, 'cargo' | 'origin'>,
    cap: number,
    line: Line,
    here: Station,
    byId: Map<number, Station>,
    map: TerrainMap,
    prod: ProductionSim,
    earn: (amount: number) => void,
  ): void {
    const [hx, hz] = stopCenter(here);
    // What the line's OTHER stops take: industries their ACCEPTS, a depot
    // anything (it's a transfer point).
    const laterTakes = new Set<Item>();
    let laterDepot = false;
    for (const id of line.stops) {
      if (id === here.id) continue;
      const s = byId.get(id);
      if (!s) continue;
      if (isDepot(s)) laterDepot = true;
      else for (const it of ACCEPTS[map.cells[s.anchor[0]][s.anchor[1]]] ?? []) laterTakes.add(it);
    }
    const depot = isDepot(here);

    // Unload. An industry takes (and pays for) what it accepts; a depot
    // stores what this line can't deliver itself.
    const takes = depot ? null : (ACCEPTS[map.cells[here.anchor[0]][here.anchor[1]]] ?? []);
    let pay = 0;
    for (const item of Object.keys(t.cargo) as Item[]) {
      const n = t.cargo[item] ?? 0;
      if (!n) continue;
      const origin = t.origin[item] ?? [hx, hz];
      if (depot) {
        if (laterTakes.has(item)) continue;
        const k = prod.store(here.id, item, n, origin);
        t.cargo[item] = n - k;
      } else {
        if (!takes!.includes(item)) continue;
        const k = prod.deliver(here.id, item, n);
        t.cargo[item] = n - k;
        // Paid for the whole way from where the cargo came from.
        const dist = Math.hypot(origin[0] - hx, origin[1] - hz);
        pay += Math.round(k * ITEMS[item].value * (1 + dist / DISTANCE_SCALE));
      }
      if (!t.cargo[item]) delete t.origin[item];
    }
    if (pay > 0) {
      earn(pay);
      this.payments.push({ amount: pay, x: hx, z: hz, age: 0 });
    }

    // Load what a later stop takes (any cargo when a depot comes later).
    const wanted = new Set<Item>(laterTakes);
    if (laterDepot && !depot) for (const it of Object.keys(ITEMS) as Item[]) wanted.add(it);
    let load = 0;
    for (const v of Object.values(t.cargo)) load += v ?? 0;
    for (const item of wanted) {
      if (load >= cap) break;
      const from = depot ? prod.originOf(here.id, item) : ([hx, hz] as [number, number]);
      const k = prod.take(here.id, item, cap - load);
      if (k <= 0) continue;
      const had = t.cargo[item] ?? 0;
      const o = t.origin[item];
      const src = from ?? [hx, hz];
      // Mixed loads: the origin is the weighted mean of where it came from.
      t.origin[item] = o ? [(o[0] * had + src[0] * k) / (had + k), (o[1] * had + src[1] * k) / (had + k)] : src;
      t.cargo[item] = had + k;
      load += k;
    }
  }

  // ------------------------------------------------------------ trains

  /** Advance the trains (see the header): stand, reserve the way on, run, arrive. */
  private tickTrains(
    dt: number,
    map: TerrainMap,
    byId: Map<number, Station>,
    prod: ProductionSim,
    earn: (amount: number) => void,
    noRoute: Set<number>,
    stalled: Set<number>,
    poses: Map<number, TruckPose>,
  ): void {
    const net = netOf(map);
    for (const t of this.trains) {
      const line = this.snap.lines.find((l) => l.id === t.lineId);
      if (!line) continue;
      // Its track changed (a switch built into it, a piece pulled up): find
      // it on the new network and carry on — or, if it's gone, start over.
      if (t.path && !pathValid(net, t.path) && !this.refindTrain(t, line, byId, map)) {
        this.releaseTrack(t);
        t.path = null;
        t.state = 'stop';
        t.v = 0;
      }
      if (!t.path) {
        t.timer -= dt;
        if (t.timer > 0) continue;
        t.timer = 1;
        const r = this.placeTrain(t, line, byId, map);
        if (r === 'noroute') noRoute.add(line.id);
        if (r !== 'go') continue;
      }
      const path = t.path!;
      if (t.state === 'stop' || t.state === 'noroute') {
        t.timer -= dt;
        if (t.timer > 0) {
          if (t.state === 'noroute') noRoute.add(line.id);
          if (t.blocked > STALL_WARN) stalled.add(line.id);
          continue;
        }
        const r = this.departTrain(t, line, byId, map, prod, earn);
        if (r === 'noroute') {
          t.state = 'noroute';
          t.timer = 1;
          noRoute.add(line.id);
        } else if (r === 'wait') {
          t.state = 'stop';
          t.timer = 0.5;
          t.blocked += 0.5;
          if (t.blocked > STALL_WARN) stalled.add(line.id);
        } else {
          t.state = 'drive';
          t.blocked = 0;
        }
        continue;
      }
      // Nearing a signal (or a spot it waits at): ask for the next block in
      // time to run on; at a red one, try a free way round, else wait.
      if (t.limit < path.length && t.limit - t.s < (t.v * t.v) / (2 * TRAIN_DECEL) + 1.5) {
        const nb = this.nextBlock(map, path, t.limit + SIGNAL_STOP, t.len);
        if (this.canReserve(t, nb.need)) {
          this.reserve(t, nb.need);
          t.limit = nb.limit;
          t.blocked = 0;
        } else if (t.s >= t.limit - 0.02) {
          if (!this.rerouteAtSignal(t, line, byId, map, nb.need)) {
            t.v = 0;
            t.blocked += dt;
            if (t.blocked > STALL_WARN) stalled.add(line.id);
            continue;
          }
        }
      }
      const path2 = t.path!;
      // Driving: brake for the bends, a truck stuck on a crossing, a red signal, the stop.
      const end = Math.min(path2.length, t.limit);
      let cap = brakeCapOn(path2, t.s, TRAIN_SPEED, TRAIN_DECEL, TRAIN_A_LAT, end);
      if (end - t.s > 0.02) cap = Math.max(cap, 0.2);
      cap = Math.min(cap, this.crossingCapTrain(t, map, poses));
      t.v = Math.min(t.v + TRAIN_ACCEL * dt, cap);
      t.s = Math.min(t.s + t.v * dt, end);
      this.freeBehind(t);
      if (t.s >= path2.length - 1e-6) {
        t.v = 0;
        t.state = 'stop';
        t.timer = TRAIN_STOP_TIME;
      }
    }
  }

  /**
   * After the track under a train changed: rebuild its path from its tail
   * (on the new edges) to where it was heading. False if it can't be found.
   */
  private refindTrain(t: Train, line: Line, byId: Map<number, Station>, map: TerrainMap): boolean {
    const net = netOf(map);
    const old = t.path!;
    const back = Math.min(t.len + 1, t.s);
    const [tx, tz] = laneAt(old, t.s - back);
    const [hx, hz] = laneAt(old, t.s - back + 0.2);
    const tail = locate(net, tx, tz, hx - tx, hz - tz);
    const st = byId.get(line.stops[t.target]);
    if (!tail || !st) return false;
    const going = t.state === 'drive' && t.s < old.length - 1e-6;
    let pieces: Array<[number, number, number]> | null = null;
    if (going) pieces = railRoute(net, tail, stopTargets(net, st))?.segs ?? null;
    else {
      // Standing: just the stretch it stands on.
      const [fx, fz] = laneAt(old, t.s);
      const front = locate(net, fx, fz, hx - tx, hz - tz);
      if (front) pieces = railRoute(net, tail, [{ ...front, platform: 0 }])?.segs ?? null;
    }
    if (!pieces) return false;
    const np = makePath(net, pieces);
    this.releaseTrack(t);
    t.path = np;
    t.s = Math.min(back, np.length);
    t.limit = Infinity;
    this.reserve(t, this.trainNeeds(map, np, t.s, t.len)); // it is there already: no waiting
    t.crossings = pathCells(map, np, 0, np.length).roads;
    return true;
  }

  /** Put a new train on the network, standing at its line's first stop (if it's free). */
  private placeTrain(t: Train, line: Line, byId: Map<number, Station>, map: TerrainMap): 'go' | 'wait' | 'noroute' {
    const net = netOf(map);
    const st = byId.get(line.stops[t.target]);
    if (!st) return 'noroute';
    const next = byId.get(line.stops[(t.target + 1) % line.stops.length]);
    const targets = stopTargets(net, st);
    if (!targets.length) return 'noroute';
    // Facing a way that leads on to the next stop, if there is one.
    const onward = (tg: (typeof targets)[number]) => (next ? !!railRoute(net, tg, stopTargets(net, next)) : false);
    const order = [...targets.filter(onward), ...targets.filter((tg) => !onward(tg))];
    for (const tg of order) {
      // The platform from its tail end to the stopping point.
      // Its whole length on the track behind the stopping point.
      const w = makePath(net, trackBehind(net, tg, t.len));
      if (w.length < 1) continue;
      const need = this.trainNeeds(map, w, 0, t.len);
      if (!this.canReserve(t, need)) continue;
      t.path = w;
      t.s = w.length;
      t.v = 0;
      t.limit = Infinity;
      this.reserve(t, need);
      t.crossings = pathCells(map, w, 0, w.length).roads;
      t.state = 'stop';
      t.timer = TRAIN_STOP_TIME;
      return 'go';
    }
    return 'wait';
  }

  /**
   * A standing train's departure: (un)load and head for the next stop —
   * if the way there is free all along (it reserves it), else wait.
   */
  private departTrain(
    t: Train,
    line: Line,
    byId: Map<number, Station>,
    map: TerrainMap,
    prod: ProductionSim,
    earn: (amount: number) => void,
  ): 'go' | 'wait' | 'noroute' {
    const net = netOf(map);
    const path = t.path!;
    const here = byId.get(line.stops[t.target]);
    const nextI = (t.target + 1) % line.stops.length;
    const to = byId.get(line.stops[nextI]);
    if (!here || !to) return 'noroute';
    // Take on the line's train length here — a longer train only if the
    // track behind is there and free for its extra wagons.
    const want = line.wagons ?? DEFAULT_WAGONS;
    if (want !== t.wagons) {
      const len = trainLength(want);
      const body = this.trainNeeds(map, path, t.s, len);
      if (want < t.wagons || (t.s >= len + 0.2 && this.canReserve(t, body))) {
        if (want > t.wagons) this.reserve(t, body);
        t.wagons = want;
        t.len = len;
        this.set({ fleet: this.snap.fleet + 1 });
      }
    }
    const from = pathAt(path, t.s);
    const targets = stopTargets(net, to);
    // Routes to each platform (and way of facing) of the next stop, nearest
    // first — preferring ones round track others hold (a passing loop).
    const held = (e: number) => {
      const h = this.railHeld.get('e' + e);
      return h !== undefined && h !== t.id;
    };
    const routesTo = (avoid?: (e: number) => boolean) =>
      targets
        .map((tg) => railRoute(net, from, [tg], avoid))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ r, len: r.segs.reduce((a, [, x, y]) => a + Math.abs(y - x), 0) }))
        .sort((x, y) => x.len - y.len);
    const any = routesTo();
    if (!any.length) return 'noroute';
    // Keep the bit of the old path the train stands on.
    const cut = Math.max(0, t.s - t.len - 1);
    const keep = clipPath(path, cut, t.s);
    const s0 = t.s - cut;
    const go = (np: RailPath, need: Map<string, number>, limit: number) => {
      this.serveStop(t, t.wagons * WAGON_CAPACITY, line, here, byId, map, prod, earn);
      for (const [k, u] of t.holds) t.holds.set(k, u - cut);
      t.path = np;
      t.s = s0;
      t.limit = limit;
      this.reserve(t, need);
      t.crossings = pathCells(map, np, 0, np.length).roads;
      t.target = nextI;
      return 'go' as const;
    };
    // With signals: also round the taken edges of the nearest route's first block.
    const first = this.nextBlock(map, makePath(net, [...keep, ...any[0].r.segs]), s0, t.len);
    const conflict = new Set<number>();
    for (const k of first.need.keys()) {
      const h = this.railHeld.get(k);
      if (k[0] === 'e' && h !== undefined && h !== t.id) conflict.add(Number(k.slice(1)));
    }
    const round = conflict.size ? [conflict, ...[...conflict].map((e) => new Set([e]))].flatMap((set) => routesTo((e) => set.has(e))) : [];
    let signalled = false;
    for (const { r } of [...routesTo(held), ...any, ...round]) {
      const np = makePath(net, [...keep, ...r.segs]);
      const block = this.nextBlock(map, np, s0, t.len);
      if (block.limit < Infinity) signalled = true;
      if (this.canReserve(t, block.need)) return go(np, block.need, block.limit);
    }
    // Signals on the way: wait for the first block here.
    if (signalled) return 'wait';
    // The way is taken: drive on as far as is safe to wait (short of the
    // taken track, where it blocks nobody's way on) — or wait here.
    const np = makePath(net, [...keep, ...any[0].r.segs]);
    const part = this.partialReserve(t, map, np, s0);
    return part ? go(np, part.need, part.limit) : 'wait';
  }

  /**
   * Where on path `p` (front now at `from`) a train may drive to and wait for
   * taken track ahead: the furthest node before it such that the track up to
   * there is free and every train holding the track ahead can still get on
   * its way round what this one would hold. Null: nowhere — wait here.
   */
  private partialReserve(t: Train, map: TerrainMap, p: RailPath, from: number): { need: Map<string, number>; limit: number } | null {
    const enter = new Map<string, number>();
    const leave = new Map<string, number>();
    for (const sg of p.segs) {
      const k = 'e' + sg.edge;
      if (!enter.has(k)) enter.set(k, sg.s0);
      leave.set(k, Math.max(leave.get(k) ?? -Infinity, sg.s0 + Math.abs(sg.b - sg.a)));
    }
    for (const [c, [a, b]] of pathCells(map, p, from - t.len, p.length).shared) {
      enter.set('c' + c, a - 0.3);
      leave.set('c' + c, b + 0.3);
    }
    const takenBy = (k: string) => {
      const h = this.railHeld.get(k);
      return h !== undefined && h !== t.id && this.trains.some((q) => q.id === h && q.path) ? h : null;
    };
    let conflict = Infinity;
    for (const [k, e] of enter) if (leave.get(k)! > from - t.len && takenBy(k) !== null) conflict = Math.min(conflict, e);
    if (conflict === Infinity || conflict <= from) return null;
    // Candidate waiting points: a cell short of each node before the conflict.
    const nodes = p.segs.map((sg) => sg.s0).filter((x) => x > from + 0.5 && x <= conflict + 1e-6);
    nodes.push(conflict);
    for (const node of [...new Set(nodes)].sort((a, b) => b - a)) {
      // Short of the node and of the cells round it shared with other track
      // (a switch's throat), so the other way past stays clear.
      let zone = node;
      for (let grew = true; grew; ) {
        grew = false;
        for (const [k, e] of enter)
          if (k[0] === 'c' && e < zone && e <= node + 0.5 && leave.get(k)! >= zone - 0.6) {
            zone = e;
            grew = true;
          }
      }
      const limit = zone - 0.4;
      if (limit <= from + 0.5) continue;
      const need = new Map<string, number>();
      for (const [k, e] of enter) if (e < limit + 0.05 && leave.get(k)! > from - t.len - 0.2) need.set(k, leave.get(k)!);
      if (!this.canReserve(t, need)) continue;
      // Everyone holding the track ahead must get past without the track
      // this train will stand on while it waits there.
      const mine = new Set<string>();
      for (const [k, e] of enter) if (e < limit + 0.05 && leave.get(k)! > limit - t.len - 0.15) mine.add(k);
      const holders = new Set<number>();
      for (const [k, e] of enter) {
        const h = e >= limit && takenBy(k);
        if (h) holders.add(h);
      }
      let ok = true;
      for (const h of holders) {
        const q = this.trains.find((x) => x.id === h)!;
        if (!this.canGetOn(q, map, mine)) ok = false;
      }
      if (ok) return { need, limit };
    }
    return null;
  }

  /** Could train `q` still go on its way (to its next stop) without the track in `taken` (edges 'e…', cells 'c…')? */
  private canGetOn(q: Train, map: TerrainMap, taken: Set<string>): boolean {
    const p = q.path;
    if (!p) return true;
    const clear = (path: RailPath, from: number) =>
      !clipPath(path, from, path.length).some(([e]) => taken.has('e' + e)) &&
      ![...pathCells(map, path, from, path.length).shared.keys()].some((c) => taken.has('c' + c));
    if (q.limit < p.length) return clear(p, q.s); // waiting on its own path: it needs that path
    const line = this.snap.lines.find((l) => l.id === q.lineId);
    if (!line) return true;
    const stops = map.stations ?? [];
    const next = stops.find((x) => x.id === line.stops[(q.target + 1) % line.stops.length]);
    if (!next) return true;
    const net = netOf(map);
    const from = pathAt(p, p.length);
    for (const tg of stopTargets(net, next)) {
      const r = railRoute(net, from, [tg], (e) => taken.has('e' + e));
      if (r && clear(makePath(net, r.segs), 0)) return true;
    }
    return false;
  }

  /**
   * The next block of path `p` after distance `from`: the track up to the
   * next signal facing the train (and where to halt before it), or — with
   * no signal left — all the rest of the way.
   */
  private nextBlock(map: TerrainMap, p: RailPath, from: number, len: number): { need: Map<string, number>; limit: number } {
    const sig = pathSignals(map, p).find((x) => x.s > from + 0.05);
    if (!sig) return { need: this.trainNeeds(map, p, from, len), limit: Infinity };
    const need = new Map<string, number>();
    for (const sg of p.segs) {
      const end = sg.s0 + Math.abs(sg.b - sg.a);
      if (sg.s0 >= sig.s - 1e-6 || end < from - len - 0.2) continue;
      const k = 'e' + sg.edge;
      need.set(k, Math.max(need.get(k) ?? -Infinity, end));
    }
    for (const [c, [a, b]] of pathCells(map, p, from - len, sig.s).shared) if (a < sig.s) need.set('c' + c, b + 0.3);
    return { need, limit: sig.s - SIGNAL_STOP };
  }

  /**
   * A train halted at a red signal: is there another way on to its stop
   * round the taken track (a passing loop's other track)? Takes it if its
   * first block is free.
   */
  private rerouteAtSignal(t: Train, line: Line, byId: Map<number, Station>, map: TerrainMap, blocked: Map<string, number>): boolean {
    const net = netOf(map);
    const path = t.path!;
    const to = byId.get(line.stops[t.target]);
    if (!to) return false;
    // Round the taken edges of the block ahead (the rest of the way may be taken too: later blocks).
    const avoid = new Set<number>();
    for (const k of blocked.keys()) {
      const h = this.railHeld.get(k);
      if (k[0] === 'e' && h !== undefined && h !== t.id) avoid.add(Number(k.slice(1)));
    }
    if (!avoid.size) return false;
    const from = pathAt(path, t.s);
    const cut = Math.max(0, t.s - t.len - 1);
    const keep = clipPath(path, cut, t.s);
    const s0 = t.s - cut;
    // Round all of them, or round each one (the others may be further on).
    const sets = [avoid, ...[...avoid].map((e) => new Set([e]))];
    for (const set of avoid.size > 1 ? sets : [avoid])
    for (const tg of stopTargets(net, to)) {
      const r = railRoute(net, from, [tg], (e) => set.has(e));
      if (!r) continue;
      const np = makePath(net, [...keep, ...r.segs]);
      const block = this.nextBlock(map, np, s0, t.len);
      if (!this.canReserve(t, block.need)) continue;
      for (const [k, u] of t.holds) t.holds.set(k, u - cut);
      t.path = np;
      t.s = s0;
      t.limit = block.limit;
      this.reserve(t, block.need);
      t.crossings = pathCells(map, np, 0, np.length).roads;
      t.blocked = 0;
      return true;
    }
    return false;
  }

  /**
   * Which signals show green now: those a train has reserved its way past
   * and not yet reached (keys `${index}:${sign}`, see rail.ts PathSignal).
   */
  signalGreens(map: TerrainMap): Set<string> {
    const out = new Set<string>();
    for (const t of this.trains) {
      if (!t.path) continue;
      for (const sg of pathSignals(map, t.path)) if (sg.s > t.s - 0.3 && sg.s < t.limit) out.add(`${sg.index}:${sg.sign}`);
    }
    return out;
  }

  /** The track a train on `p` needs from its front at `from` on: edges and shared cells. */
  private trainNeeds(map: TerrainMap, p: RailPath, from: number, len: number): Map<string, number> {
    const need = new Map<string, number>();
    for (const sg of p.segs) {
      const end = sg.s0 + Math.abs(sg.b - sg.a);
      if (end < from - len - 0.2) continue;
      const k = 'e' + sg.edge;
      need.set(k, Math.max(need.get(k) ?? -Infinity, end));
    }
    for (const [c, [, s]] of pathCells(map, p, from - len, p.length).shared) need.set('c' + c, s + 0.3);
    return need;
  }

  private canReserve(t: Train, need: Map<string, number>): boolean {
    for (const k of need.keys()) {
      const h = this.railHeld.get(k);
      if (h !== undefined && h !== t.id && this.trains.some((q) => q.id === h && q.path)) return false;
    }
    return true;
  }

  private reserve(t: Train, need: Map<string, number>): void {
    for (const [k, u] of need) {
      t.holds.set(k, Math.max(t.holds.get(k) ?? -Infinity, u));
      this.railHeld.set(k, t.id);
    }
  }

  /** Free the track the last wagon has left. */
  private freeBehind(t: Train): void {
    const tail = t.s - t.len - 0.15;
    for (const [k, u] of t.holds)
      if (u < tail) {
        t.holds.delete(k);
        if (this.railHeld.get(k) === t.id) this.railHeld.delete(k);
      }
  }

  private releaseTrack(t: Train): void {
    for (const k of t.holds.keys()) if (this.railHeld.get(k) === t.id) this.railHeld.delete(k);
    t.holds.clear();
    t.crossings.clear();
  }

  /** Is the level crossing at road cell `c` closed (a train near or on it)? */
  crossingClosed(c: number): boolean {
    for (const t of this.trains) {
      const r = t.path && t.crossings.get(c);
      if (r && t.s >= r[0] - CROSSING_CLOSE && t.s - t.len <= r[1] + 0.4) return true;
    }
    return false;
  }

  /**
   * Distance from a truck to where it must halt before a closed level
   * crossing within `range` ahead, or -1 (none; or it is on it already).
   */
  private crossingAhead(t: Truck, map: TerrainMap, range: number): number {
    const lane = t.lane;
    if (!lane || !this.trains.length) return -1;
    const n = map.size;
    const cellAt = (d: number) => {
      const [x, z] = laneAt(lane, d);
      const cx = Math.round(x), cz = Math.round(z);
      return cx >= 0 && cz >= 0 && cx < n && cz < n ? cx * n + cz : -1;
    };
    const here = cellAt(t.s);
    for (let d = 0.1; d <= range && t.s + d <= lane.length; d += 0.1) {
      const c = cellAt(t.s + d);
      if (c < 0 || c === here) continue;
      const x = Math.floor(c / n), z = c % n;
      if (map.cells[x][z] !== CellType.Road || !railAt(map, x, z)) continue;
      return this.crossingClosed(c) ? Math.max(0, d - 0.15) : -1;
    }
    return -1;
  }

  /** Speed cap for a train: stop before a level crossing a truck is still on. */
  private crossingCapTrain(t: Train, map: TerrainMap, poses: Map<number, TruckPose>): number {
    if (!t.crossings.size || !this.trucks.length) return Infinity;
    const range = (TRAIN_SPEED * TRAIN_SPEED) / (2 * TRAIN_DECEL) + 1;
    let cap = Infinity;
    for (const [c, [a]] of t.crossings) {
      const ahead = a - t.s;
      if (ahead < 0.2 || ahead > range) continue;
      const n = map.size;
      const cx = Math.floor(c / n), cz = c % n;
      for (const p of poses.values()) {
        const pts = [p.front, [p.x, p.z], p.rear];
        if (pts.some(([x, z]) => Math.abs(x - cx) < 0.7 && Math.abs(z - cz) < 0.7)) {
          cap = Math.min(cap, Math.sqrt(2 * TRAIN_DECEL * Math.max(0, ahead - 0.9)));
          break;
        }
      }
    }
    return cap;
  }

  /** Match the trucks on each line to its `vehicles` count. */
  private syncFleet(): void {
    let changed = false;
    for (const line of this.snap.lines) {
      if (line.kind === 'rail') {
        const mine = this.trains.filter((t) => t.lineId === line.id);
        for (let i = mine.length; i < line.vehicles; i++) {
          this.trains.push({
            id: this.nextTrain++,
            lineId: line.id,
            target: 0,
            path: null,
            s: 0,
            prevS: 0,
            prevPath: null,
            v: 0,
            limit: Infinity,
            state: 'stop',
            timer: 0,
            blocked: 0,
            cargo: {},
            origin: {},
            wagons: line.wagons ?? DEFAULT_WAGONS,
            len: trainLength(line.wagons ?? DEFAULT_WAGONS),
            holds: new Map(),
            crossings: new Map(),
          });
          changed = true;
        }
        if (mine.length > line.vehicles) {
          const drop = new Set(mine.slice(line.vehicles).map((t) => t.id));
          for (const t of mine.slice(line.vehicles)) this.releaseTrack(t);
          this.trains = this.trains.filter((t) => !drop.has(t.id));
          changed = true;
        }
        continue;
      }
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
          prevS: 0,
          prevLane: null,
          state: 'stop',
          v: 0,
          timer: STOP_TIME + i * 3,
          blocked: 0,
          holds: [],
          holdUntil: 0,
          waitFor: null,
          pass: 0,
          stopDone: -1,
          cargo: {},
          origin: {},
          depot: null,
        });
        changed = true;
      }
      if (mine.length > line.vehicles) {
        const drop = new Set(mine.slice(line.vehicles).map((t) => t.id));
        for (const t of mine.slice(line.vehicles)) {
          this.release(t);
          this.leaveDepot(t);
        }
        this.trucks = this.trucks.filter((t) => !drop.has(t.id));
        changed = true;
      }
    }
    // Trucks of stops that vanished keep waiting; lines are not auto-removed.
    if (changed) this.set({ fleet: this.snap.fleet + 1 });
  }

  /** How far real time has got from the last tick towards the next (0…1). */
  private drawAlpha(): number {
    const now = globalThis.performance?.now() ?? Date.now();
    return Math.min(1, Math.max(0, (now - this.tickAt) / this.tickGap));
  }

  /** A truck's pose for drawing now: between the last two ticks (smooth at any frame rate). */
  drawPose(t: Truck): TruckPose | null {
    if (!t.lane) return null;
    if (t.prevLane !== t.lane) return this.pose(t);
    return poseOnLane(t.lane, t.prevS + (t.s - t.prevS) * this.drawAlpha());
  }

  /** A train's front for drawing now (path distance), between the last two ticks. */
  trainDrawS(t: Train): number {
    if (t.prevPath !== t.path) return t.s;
    return t.prevS + (t.s - t.prevS) * this.drawAlpha();
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
