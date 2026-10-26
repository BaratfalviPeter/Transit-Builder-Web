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

import { stationOn, type Side, type Station } from './stations';
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
  [CellType.PowerPlant]: { burns: true, rate: 2 },
};

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
  /** Fractional fixed production carried between ticks, per industry. */
  private carry = new Map<string, number>();

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
    if (s && k > 0) s[item] = (s[item] ?? 0) - k;
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
    const k = Math.max(0, Math.min(n, STATION_CAPACITY - total));
    if (k > 0) {
      s[item] = (s[item] ?? 0) + k;
      this.inbound.set(id, s);
    }
    return k;
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
    for (const [key, stops] of byIndustry) {
      const [ax, az] = stops[0].anchor;
      const p = FIXED_PRODUCTION[map.cells[ax][az]];
      if (!p) continue;
      const budget = (this.carry.get(key) ?? 0) + p.rate * dt;
      let units = Math.floor(budget);
      this.carry.set(key, budget - units);
      // Processors / consumers first use up what was delivered.
      if (p.turns || p.burns) {
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
        if (!p.turns) continue;
        units = used;
      }
      // Output goes to the emptiest stop that has room.
      const item = p.makes ?? p.turns?.to;
      for (let i = 0; item && i < units; i++) {
        let best: Station | null = null;
        for (const st of stops) {
          const n = this.stationTotal(st.id);
          if (n < STATION_CAPACITY && (!best || n < this.stationTotal(best.id))) best = st;
        }
        if (!best) break;
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
