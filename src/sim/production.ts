/**
 * ProductionSim — runs the industry interiors: machines make items, belts
 * carry them, and a belt leaving the grid through a GATE drops its item into
 * the outside station's storage (the hand-over to the macro map).
 *
 * The runtime state (items on belts, machine buffers and progress, station
 * stock) is mutable and changes many times a second, so it lives here, not
 * in the immutable layouts of InteriorStore. The 3D view reads it every
 * frame; React subscribers get a throttled notification (`subscribe`).
 *
 * Rules:
 *   - Extractors (no input) make one item per `seconds` per covered resource
 *     tile; converters take one input item and make one output.
 *   - A machine outputs on its `rot` side: onto an empty belt there, or
 *     straight into a machine that takes the item.
 *   - A belt moves its one item BELT_SPEED tiles/s; at the end it hands it on
 *     (belt / machine / gate) or waits.
 *
 * While the micro view is off (INTERIORS_ENABLED = false) the interiors are
 * skipped and every industry with a stop runs on FIXED production instead
 * (see FIXED_PRODUCTION below).
 *
 * Pure TypeScript.
 */

import { stationOn, stopGivesOut, stopShare, type Side, type Station } from './stations';
import { DEPOT_CAPACITY } from './depot';
import { CellType, type TerrainMap } from './terrain';
import {
  INTERIORS_ENABLED,
  INTERIOR_SIZE,
  MACHINES,
  ROT_DIR,
  footprint,
  gateTiles,
  resourceTiles,
  type Interior,
  type Item,
  type Machine,
} from './interior';

/** Belt speed (tiles per second). */
export const BELT_SPEED = 1.5;
/** Items a station on an industry side can hold (all kinds together). */
export const STATION_CAPACITY = 100;
/** Delivered items a stop can hold for its industry (a power plant's coal stock). */
export const INBOUND_CAPACITY = 300;
/** Machine input / output buffer sizes. */
const IN_CAP = 4;
const OUT_CAP = 3;

/**
 * Fixed production (micro view off), per game second:
 *   - `makes`: an extractor puts `rate` units of its product into its stops;
 *   - `turns`: a processor turns up to `rate` delivered units into its product;
 *   - `burns`: a consumer uses up to `rate` delivered units.
 * Only industries with at least one stop produce (nobody would pick it up).
 */
export const FIXED_PRODUCTION: Partial<
  Record<CellType, { makes?: Item; turns?: { from: Item; to: Item }; burns?: boolean; rate: number }>
> = {
  [CellType.Mine]: { makes: 'ore', rate: 0.5 },
  [CellType.LumberMill]: { makes: 'plank', rate: 0.5 },
  [CellType.OilRig]: { makes: 'oil', rate: 0.4 },
  [CellType.Factory]: { turns: { from: 'plank', to: 'goods' }, rate: 1 },
  [CellType.PowerPlant]: { burns: true, rate: 4 },
};

/**
 * POWER: a power plant makes MW_PER_FUEL MW from each unit of fuel (coal /
 * oil) it burns a second, smoothed over POWER_TAU game seconds; the city
 * gets all the plants' power automatically (no lines). See CityDevelopment
 * (POWER_PER_POP) for what it needs.
 */
export const MW_PER_FUEL = 1000;
const POWER_TAU = 20;
/** A plant burns its stock over this many game seconds (a steady output). */
const BURN_SPREAD = 30;

/**
 * Industry LEVELS (fixed production): an industry's output is its base rate ×
 * LEVEL_RATE[level − 1]. Every month it is judged by how much of what it
 * offered was taken away (`served`, smoothed with the month before): well
 * served (≥ LEVEL_UP) it grows a level, neglected (< LEVEL_DOWN) it shrinks.
 */
export const LEVEL_RATE = [0.5, 1, 1.5, 2, 3];
export const MAX_INDUSTRY_LEVEL = LEVEL_RATE.length;
export const START_LEVEL = 2;
const LEVEL_UP = 0.7;
const LEVEL_DOWN = 0.3;

/** An industry's level and how well it is served (for the UI). */
export interface IndustryState {
  level: number;
  /** Share of its output taken away, smoothed (null before its first judged month). */
  served: number | null;
  /** Last change: +1 grew / −1 shrank / 0 (at the last month's end). */
  trend: number;
}

/** The saved stop stocks (station id → items) and the industries' levels. */
export interface ProductionSave {
  stock: Record<string, Partial<Record<Item, number>>>;
  inbound: Record<string, Partial<Record<Item, number>>>;
  origins: Record<string, Partial<Record<Item, [number, number]>>>;
  carry: Record<string, number>;
  /** When each kind of a depot's stock was first loaded (TransportSim clock; weighted mean). */
  since?: Record<string, Partial<Record<Item, number>>>;
  industries?: Record<string, IndustryState>;
  power?: Record<string, number>;
}

export type MachineStatus = 'work' | 'wait' | 'blocked' | 'idle';

interface MachineRt {
  progress: number;
  inBuf: number;
  inItem: Item | null;
  outBuf: number;
  outItem: Item | null;
  /** Round-robin start among the output tiles. */
  rr: number;
  status: MachineStatus;
}

interface BeltRt {
  item: Item | null;
  /** 0 = entered the tile, 1 = at its far edge. */
  progress: number;
}

type Listener = () => void;

const N = INTERIOR_SIZE;

export class ProductionSim {
  private machines = new Map<number, MachineRt>();
  private belts = new Map<number, BeltRt>();
  private stock = new Map<number, Partial<Record<Item, number>>>();
  /** Delivered goods waiting at a stop to go IN through its gate. */
  private inbound = new Map<number, Partial<Record<Item, number>>>();
  private readonly listeners = new Set<Listener>();
  private sincePublish = 0;
  private version = 0;
  /** Depot stock origins (see `store`). */
  private origins = new Map<number, Partial<Record<Item, [number, number]>>>();
  /** Fractional fixed production carried between ticks, per industry. */
  private carry = new Map<string, number>();
  /** Depot stock load times (see `store`). */
  private since = new Map<number, Partial<Record<Item, number>>>();
  /** Industry (anchor key) → level / service. */
  private industries = new Map<string, IndustryState>();
  /** This month, per industry: units offered (it would have made) / taken away from its stops. */
  private offered = new Map<string, number>();
  private taken = new Map<string, number>();
  /** Power plant (anchor key) → its output now (MW, smoothed). */
  private power = new Map<string, number>();
  /** Output handed to each stop so far (for the shares between them). */
  private outCount = new Map<number, number>();
  /** Stop id → its industry's key (for counting what is taken). */
  private stopIndustry = new Map<number, string>();

  /** Stop stocks (what a save keeps; see save.ts). Machines / belts are not saved. */
  exportState(): ProductionSave {
    const obj = <T>(m: Map<number | string, T>) => Object.fromEntries(m) as Record<string, T>;
    return {
      stock: obj(this.stock),
      inbound: obj(this.inbound),
      origins: obj(this.origins),
      carry: obj(this.carry),
      since: obj(this.since),
      power: Object.fromEntries(this.power),
      industries: Object.fromEntries([...this.industries].map(([k, v]) => [k, { ...v }])),
    };
  }

  /** Continue saved stocks, or (null) start empty. */
  importState(s: ProductionSave | null): void {
    const num = <T>(o: Record<string, T> | undefined) => new Map(Object.entries(o ?? {}).map(([k, v]) => [Number(k), v]));
    this.stock = num(s?.stock);
    this.inbound = num(s?.inbound);
    this.origins = num(s?.origins);
    this.carry = new Map(Object.entries(s?.carry ?? {}));
    this.since = num(s?.since);
    this.power = new Map(Object.entries(s?.power ?? {}));
    this.industries = new Map(Object.entries(s?.industries ?? {}).map(([k, v]) => [k, { ...v }]));
    this.offered.clear();
    this.taken.clear();
    this.machines.clear();
    this.belts.clear();
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Advance every interior by `dt` game seconds. */
  tick(dt: number, interiors: Iterable<Interior>, map: TerrainMap): void {
    if (dt <= 0) return;
    const live = new Set<number>();
    if (INTERIORS_ENABLED) for (const it of interiors) this.tickInterior(it, map, dt, live);
    else this.tickFixed(map, dt);
    // Machines / belts that were removed lose their contents.
    for (const id of this.machines.keys()) if (!live.has(id)) this.machines.delete(id);
    for (const id of this.belts.keys()) if (!live.has(id)) this.belts.delete(id);
    this.sincePublish += dt;
    if (this.sincePublish >= 0.5) {
      this.sincePublish = 0;
      this.version++;
      for (const l of this.listeners) l();
    }
  }

  /** Item on a belt (for drawing): null when empty. */
  beltItem(id: number): { item: Item; progress: number } | null {
    const b = this.belts.get(id);
    return b?.item ? { item: b.item, progress: b.progress } : null;
  }

  machineStatus(id: number): MachineStatus {
    return this.machines.get(id)?.status ?? 'idle';
  }

  /** What a station holds. */
  stationStock(id: number): Partial<Record<Item, number>> {
    return this.stock.get(id) ?? {};
  }

  stationTotal(id: number): number {
    let n = 0;
    for (const v of Object.values(this.stationStock(id))) n += v ?? 0;
    return n;
  }

  /** Take up to `n` of `item` from a stop's outgoing stock; returns how many. */
  take(id: number, item: Item, n: number): number {
    const s = this.stock.get(id);
    const k = Math.min(n, s?.[item] ?? 0);
    if (s && k > 0) {
      s[item] = (s[item] ?? 0) - k;
      const key = this.stopIndustry.get(id);
      if (key) this.taken.set(key, (this.taken.get(key) ?? 0) + k);
    }
    return k;
  }

  /** Delivered goods waiting at a stop to go in through its gate. */
  inboundStock(id: number): Partial<Record<Item, number>> {
    return this.inbound.get(id) ?? {};
  }

  /** Leave `n` of `item` at a stop for its industry; returns how many fit. */
  deliver(id: number, item: Item, n: number): number {
    const s = this.inbound.get(id) ?? {};
    let total = 0;
    for (const v of Object.values(s)) total += v ?? 0;
    const k = Math.max(0, Math.min(n, INBOUND_CAPACITY - total));
    if (k > 0) {
      s[item] = (s[item] ?? 0) + k;
      this.inbound.set(id, s);
    }
    return k;
  }

  /**
   * Store cargo in a depot (all kinds share DEPOT_CAPACITY); `origin` is
   * where it came from — the stock keeps the weighted mean per kind, so it
   * is paid for the whole way when delivered. Returns how many fit.
   */
  store(id: number, item: Item, n: number, origin: [number, number], since = 0): number {
    const k = Math.max(0, Math.min(n, DEPOT_CAPACITY - this.stationTotal(id)));
    if (k <= 0) return 0;
    const s = this.stock.get(id) ?? {};
    const had = s[item] ?? 0;
    const o = this.origins.get(id) ?? {};
    const prev = o[item];
    o[item] = prev && had > 0 ? [(prev[0] * had + origin[0] * k) / (had + k), (prev[1] * had + origin[1] * k) / (had + k)] : origin;
    this.origins.set(id, o);
    const t = this.since.get(id) ?? {};
    const pt = t[item];
    t[item] = pt !== undefined && had > 0 ? (pt * had + since * k) / (had + k) : since;
    this.since.set(id, t);
    s[item] = had + k;
    this.stock.set(id, s);
    return k;
  }

  /** Where a depot's stock of `item` came from (weighted mean), or null. */
  originOf(id: number, item: Item): [number, number] | null {
    return this.origins.get(id)?.[item] ?? null;
  }

  /** When a depot's stock of `item` was loaded (weighted mean), or null. */
  sinceOf(id: number, item: Item): number | null {
    return this.since.get(id)?.[item] ?? null;
  }

  /** All the power plants' output now (MW): what the city gets. */
  powerSupply(): number {
    let mw = 0;
    for (const v of this.power.values()) mw += v;
    return mw;
  }

  /** One power plant's output now (MW). */
  plantPower(anchor: readonly [number, number]): number {
    return this.power.get(`${anchor[0]},${anchor[1]}`) ?? 0;
  }

  /** An industry's level / service (by its anchor). */
  industry(anchor: readonly [number, number]): IndustryState {
    return this.industries.get(`${anchor[0]},${anchor[1]}`) ?? { level: START_LEVEL, served: null, trend: 0 };
  }

  /**
   * A month is over: judge every industry that offered something by the share
   * of it taken away, and move its level up / down.
   */
  closeMonth(): void {
    for (const [key, off] of this.offered) {
      if (off < 1) continue;
      const st = this.industries.get(key) ?? { level: START_LEVEL, served: null, trend: 0 };
      const share = Math.min(1, (this.taken.get(key) ?? 0) / off);
      const first = st.served === null;
      st.served = first ? share : (st.served! + share) / 2;
      st.trend = 0;
      // Its first judged month (a new stop, a new line) doesn't count yet.
      if (first) {
        this.industries.set(key, st);
        continue;
      }
      if (st.served >= LEVEL_UP && st.level < MAX_INDUSTRY_LEVEL) {
        st.level++;
        st.trend = 1;
      } else if (st.served < LEVEL_DOWN && st.level > 1) {
        st.level--;
        st.trend = -1;
      }
      this.industries.set(key, st);
    }
    this.offered.clear();
    this.taken.clear();
    this.outCount.clear();
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Bumped on every throttled publish (for useSyncExternalStore). */
  getVersion(): number {
    return this.version;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ------------------------------------------------------------- internals

  /** Fixed production: every industry with stops makes / turns / burns. */
  private tickFixed(map: TerrainMap, dt: number): void {
    const byIndustry = new Map<string, Station[]>();
    for (const st of map.stations ?? []) {
      const key = `${st.anchor[0]},${st.anchor[1]}`;
      const list = byIndustry.get(key);
      if (list) list.push(st);
      else byIndustry.set(key, [st]);
    }
    // A plant that lost its stops makes nothing.
    for (const key of this.power.keys()) if (!byIndustry.has(key)) this.power.delete(key);
    for (const [key, stops] of byIndustry) {
      const [ax, az] = stops[0].anchor;
      const p = FIXED_PRODUCTION[map.cells[ax][az]];
      if (!p) continue;
      for (const st of stops) this.stopIndustry.set(st.id, key);
      const level = this.industries.get(key)?.level ?? START_LEVEL;
      const budget = (this.carry.get(key) ?? 0) + p.rate * LEVEL_RATE[level - 1] * dt;
      let units = Math.floor(budget);
      this.carry.set(key, budget - units);
      // Processors / consumers first use up what was delivered.
      if (p.burns) {
        // A power plant burns its fuel stock steadily (spread over
        // BURN_SPREAD seconds, at most its rate): deliveries come in loads.
        let total = 0;
        for (const st of stops) for (const v of Object.values(this.inbound.get(st.id) ?? {})) total += v ?? 0;
        const burn = Math.min(p.rate * LEVEL_RATE[level - 1] * dt, (total * dt) / BURN_SPREAD, total);
        if (total > 0)
          for (const st of stops) {
            const inb = this.inbound.get(st.id);
            if (inb) for (const item of Object.keys(inb) as Item[]) inb[item] = Math.max(0, (inb[item] ?? 0) - ((inb[item] ?? 0) / total) * burn);
          }
        const mw = (burn / dt) * MW_PER_FUEL;
        const was = this.power.get(key) ?? 0;
        this.power.set(key, was + (mw - was) * (1 - Math.exp(-dt / POWER_TAU)));
        continue;
      }
      if (p.turns) {
        let used = 0;
        for (const st of stops) {
          const inb = this.inbound.get(st.id);
          if (!inb) continue;
          for (const item of Object.keys(inb) as Item[]) {
            if (p.turns && item !== p.turns.from) continue;
            const k = Math.min(units - used, inb[item] ?? 0);
            inb[item] = (inb[item] ?? 0) - k;
            used += k;
          }
        }
        units = used;
      }
      // Output goes to the emptiest stop that has room.
      const item = p.makes ?? p.turns?.to;
      if (item && units > 0) this.offered.set(key, (this.offered.get(key) ?? 0) + units);
      // Split between the stops that take output, by their shares (a stop
      // with room, furthest behind its share, gets the next unit).
      const outs = stops.filter(stopGivesOut);
      const anyShare = outs.some((st) => stopShare(st) > 0);
      for (let i = 0; item && i < units; i++) {
        let best: Station | null = null;
        let bestScore = Infinity;
        for (const st of outs) {
          const w = anyShare ? stopShare(st) : 1;
          if (w <= 0 || this.stationTotal(st.id) >= STATION_CAPACITY) continue;
          const score = ((this.outCount.get(st.id) ?? 0) + 1) / w;
          if (score < bestScore) {
            bestScore = score;
            best = st;
          }
        }
        if (!best) break;
        this.outCount.set(best.id, (this.outCount.get(best.id) ?? 0) + 1);
        const s = this.stock.get(best.id) ?? {};
        s[item] = (s[item] ?? 0) + 1;
        this.stock.set(best.id, s);
      }
    }
  }

  private tickInterior(it: Interior, map: TerrainMap, dt: number, live: Set<number>): void {
    // Tile → machine occupancy.
    const grid: Array<Machine | null> = new Array(N * N).fill(null);
    for (const m of it.machines) {
      live.add(m.id);
      for (const [x, z] of footprint(m.kind, m.x, m.z)) grid[x * N + z] = m;
    }
    const at = (x: number, z: number) => (x >= 0 && z >= 0 && x < N && z < N ? grid[x * N + z] : null);
    const res = resourceTiles(it.type, it.anchor);

    // Gate exits: (tile, outward direction) → station id.
    const exits = new Map<string, number>();
    for (const side of ['N', 'S', 'W', 'E'] as Side[]) {
      const st = stationOn(map, it.anchor, side);
      if (!st) continue;
      const d = side === 'N' ? '0,-1' : side === 'S' ? '0,1' : side === 'W' ? '-1,0' : '1,0';
      for (const [x, z] of gateTiles(side)) exits.set(`${x},${z},${d}`, st.id);
    }

    /** Hand `item` to the machine/belt at (x, z); true if taken. */
    const deliver = (x: number, z: number, item: Item): boolean => {
      const t = at(x, z);
      if (!t) return false;
      if (t.kind === 'conveyor') {
        const b = this.belt(t.id);
        if (b.item) return false;
        b.item = item;
        b.progress = 0;
        return true;
      }
      return this.accept(t, item);
    };

    // 0) Delivered goods enter through the gates onto inward-pointing belts.
    for (const side of ['N', 'S', 'W', 'E'] as Side[]) {
      const st = stationOn(map, it.anchor, side);
      const inb = st && this.inbound.get(st.id);
      if (!inb) continue;
      const inward: [number, number] = side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'W' ? [1, 0] : [-1, 0];
      for (const [x, z] of gateTiles(side)) {
        const t = at(x, z);
        if (!t || t.kind !== 'conveyor') continue;
        const [dx, dz] = ROT_DIR[t.rot];
        if (dx !== inward[0] || dz !== inward[1]) continue;
        const b = this.belt(t.id);
        if (b.item) continue;
        const item = (Object.keys(inb) as Item[]).find((k) => (inb[k] ?? 0) > 0);
        if (!item) break;
        inb[item] = (inb[item] ?? 0) - 1;
        b.item = item;
        b.progress = 0;
      }
    }

    // 1) Belts move (this frees room for the machines below).
    for (const m of it.machines) {
      if (m.kind !== 'conveyor') continue;
      const b = this.belt(m.id);
      if (!b.item) continue;
      b.progress = Math.min(1, b.progress + dt * BELT_SPEED);
      if (b.progress < 1) continue;
      const [dx, dz] = ROT_DIR[m.rot];
      const tx = m.x + dx, tz = m.z + dz;
      if (tx >= 0 && tz >= 0 && tx < N && tz < N) {
        if (deliver(tx, tz, b.item)) b.item = null;
      } else {
        const st = exits.get(`${m.x},${m.z},${dx},${dz}`);
        if (st !== undefined && this.stationTotal(st) < STATION_CAPACITY) {
          const s = this.stock.get(st) ?? {};
          s[b.item] = (s[b.item] ?? 0) + 1;
          this.stock.set(st, s);
          b.item = null;
        }
      }
    }

    // 2) Machines work and push their output.
    for (const m of it.machines) {
      const def = MACHINES[m.kind];
      const r = def.recipe;
      if (!r) continue;
      const rt = this.machine(m.id);
      if (!r.input) {
        // Extractor: faster on more resource tiles.
        let cover = 0;
        for (const [x, z] of footprint(m.kind, m.x, m.z)) if (res[x * N + z] === def.needs) cover++;
        if (rt.progress < 1) rt.progress = Math.min(1, rt.progress + (dt * cover) / r.seconds);
        if (rt.progress >= 1 && rt.outBuf < OUT_CAP && r.output) {
          rt.outBuf++;
          rt.outItem = r.output;
          rt.progress = 0;
        }
      } else {
        if (rt.progress <= 0 && rt.inBuf > 0) {
          rt.inBuf--;
          rt.progress = 1e-6; // started
          if (rt.inBuf === 0) rt.inItem = null;
        }
        if (rt.progress > 0 && rt.progress < 1) rt.progress = Math.min(1, rt.progress + dt / r.seconds);
        if (rt.progress >= 1) {
          if (!r.output) rt.progress = 0;
          else if (rt.outBuf < OUT_CAP) {
            rt.outBuf++;
            rt.outItem = r.output;
            rt.progress = 0;
          }
        }
      }
      // Output onto the tiles beyond the `rot` side of the footprint.
      if (rt.outBuf > 0 && rt.outItem) {
        const outs = outputTiles(m);
        for (let k = 0; k < outs.length && rt.outBuf > 0; k++) {
          const [x, z] = outs[(rt.rr + k) % outs.length];
          if (deliver(x, z, rt.outItem)) {
            rt.outBuf--;
            rt.rr = (rt.rr + k + 1) % outs.length;
          }
        }
      }
      const full = rt.outBuf >= OUT_CAP && rt.progress >= 1;
      // Extractors always work unless full; converters wait for input.
      rt.status = full ? 'blocked' : !r.input || rt.progress > 0 ? 'work' : 'wait';
    }
  }

  /** Can machine `m` take `item` into its input buffer? (takes it if so) */
  private accept(m: Machine, item: Item): boolean {
    const r = MACHINES[m.kind].recipe;
    if (!r?.input) return false;
    const ins = Array.isArray(r.input) ? r.input : [r.input];
    if (!ins.includes(item)) return false;
    const rt = this.machine(m.id);
    if (rt.inBuf >= IN_CAP || (rt.inItem && rt.inItem !== item)) return false;
    rt.inBuf++;
    rt.inItem = item;
    return true;
  }

  private machine(id: number): MachineRt {
    let rt = this.machines.get(id);
    if (!rt) this.machines.set(id, (rt = { progress: 0, inBuf: 0, inItem: null, outBuf: 0, outItem: null, rr: 0, status: 'idle' }));
    return rt;
  }

  private belt(id: number): BeltRt {
    let b = this.belts.get(id);
    if (!b) this.belts.set(id, (b = { item: null, progress: 0 }));
    return b;
  }
}

/** Tiles just past a machine's output side (rot). */
export function outputTiles(m: Machine): Array<[number, number]> {
  const n = MACHINES[m.kind].size;
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    if (m.rot === 0) out.push([m.x + n, m.z + k]);
    else if (m.rot === 1) out.push([m.x + k, m.z + n]);
    else if (m.rot === 2) out.push([m.x - 1, m.z + k]);
    else out.push([m.x + k, m.z - 1]);
  }
  return out;
}
