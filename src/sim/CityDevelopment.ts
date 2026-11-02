/**
 * CityDevelopment — the city: its growing buildings and its economy.
 *
 * Pure TypeScript: no React, no Three.js. Driven by the in-game clock: the
 * React layer calls `advance(days, dateMs)` as whole game days pass (see
 * useCityDevelopment.ts), so growth follows the game speed and pause.
 *
 * Buildings: each growth step picks a random cell of the central CityCenter
 * zone — empty: a level-1 building; below MAX_LEVEL: one level up.
 *
 * Economy (the city as a consumer, through the stops on its square's sides —
 * stations.ts):
 *   - size = the sum of building levels; population = size × POP_PER_LEVEL;
 *   - monthly DEMAND per item (DEMAND: base + per level);
 *   - deliveries to a city stop count towards this month's demand and are paid
 *     in full up to it — beyond it at OVERSUPPLY_PRICE only;
 *   - SATISFACTION = delivered / demand per month (per item, max 1), averaged
 *     with the month before (deliveries come in loads, not evenly);
 *   - growth: up to UNSUPPLIED_LEVELS the town grows on its own (GROWTH_BASE a
 *     day); beyond that only as fast as it is supplied (GROWTH_SUPPLIED × the
 *     mean satisfaction) — an unsupplied city stops growing, and so does one
 *     short of power (below POWER_MIN of POWER_PER_POP per inhabitant).
 */

import type { Item } from './interior';
import { CellType, type TerrainMap } from './terrain';

/** Maximum development level a building can reach. */
export const MAX_LEVEL = 5;
/** Inhabitants per building level (display only). */
export const POP_PER_LEVEL = 40;
/** Monthly demand per item: `base + perLevel × size`. */
export const DEMAND: Readonly<Partial<Record<Item, { base: number; perLevel: number }>>> = {
  // Sized to a few trucks a month (one makes ~20–60 units a month).
  goods: { base: 40, perLevel: 2 },
  plank: { base: 20, perLevel: 1 },
};
/** The items the city takes (its stops' ACCEPTS). */
export const CITY_ITEMS = Object.keys(DEMAND) as Item[];
/** Price factor for deliveries beyond this month's demand. */
export const OVERSUPPLY_PRICE = 0.25;
/**
 * POWER: the city needs POWER_PER_POP MW per inhabitant, from the power
 * plants (automatic, see production.ts). Beyond the small town, below
 * POWER_MIN of it (the month's mean) it stops growing.
 */
export const POWER_PER_POP = 0.5;
export const POWER_MIN = 0.8;
/** Size (sum of levels) the town reaches without any supply. */
export const UNSUPPLIED_LEVELS = 40;
/** Expected growth steps per game day: on its own / when fully supplied. */
const GROWTH_BASE = 0.4;
const GROWTH_SUPPLIED = 0.6;

/** A single growing building, addressed by its grid cell. */
export interface Building {
  readonly x: number;
  readonly z: number;
  level: number;
}

export interface CitySnapshot {
  buildings: Building[];
  /** Sum of building levels. */
  size: number;
  population: number;
  /** This month's demand / delivered so far, per item. */
  demand: Partial<Record<Item, number>>;
  delivered: Partial<Record<Item, number>>;
  /** Supply (0…1) per item — last months' delivered / demand, smoothed; null before the first month ends. */
  satisfaction: Partial<Record<Item, number>> | null;
  /** Growing right now: 'free' (small town), 'supplied', 'stalled' (needs supply) or 'nopower'. */
  growth: 'free' | 'supplied' | 'stalled' | 'nopower';
  /** Power: the plants' output now / what the city needs now (MW). */
  power: { supply: number; demand: number };
  /** Power supply (0…1) of the last months, smoothed; null before the first month ends. */
  powerSat: number | null;
}

/** The saved part of the city. */
export interface CitySave {
  seed: number;
  buildings: Building[];
  delivered: Partial<Record<Item, number>>;
  satisfaction: Partial<Record<Item, number>> | null;
  month: number | null;
  growthCarry: number;
  powerSat?: number | null;
  powerSum?: number;
  powerDays?: number;
}

type Listener = () => void;

function key(x: number, z: number): string {
  return `${x},${z}`;
}

/** Calendar month index of an epoch-ms date (UTC). */
const monthOf = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

export class CityDevelopment {
  /** All CityCenter cell coordinates eligible for growth. */
  private cityCells: ReadonlyArray<readonly [number, number]> = [];
  private readonly byCell = new Map<string, Building>();
  private readonly listeners = new Set<Listener>();
  private size = 0;
  private delivered: Partial<Record<Item, number>> = {};
  private satisfaction: Partial<Record<Item, number>> | null = null;
  private month: number | null = null;
  /** Fractional growth steps carried between days. */
  private growthCarry = 0;
  /** The map (seed) the city belongs to. */
  private seed: number | null = null;
  /** Power now (MW) / Σ supply × days this month / days counted / smoothed supply share. */
  private powerNow = 0;
  private powerSum = 0;
  private powerDays = 0;
  private powerSat: number | null = null;

  // Cached immutable snapshot so React's useSyncExternalStore gets a stable
  // reference between mutations (no re-render loops).
  private snapshot: CitySnapshot;

  constructor(map: TerrainMap) {
    this.snapshot = this.build();
    this.reset(map);
  }

  /** A new map (other seed): start the city over. Same map: keep it. */
  reset(map: TerrainMap): void {
    if (this.seed === map.seed) return;
    this.seed = map.seed;
    const cells: Array<readonly [number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.CityCenter) cells.push([x, z] as const);
      }
    }
    this.cityCells = cells;
    this.byCell.clear();
    this.size = 0;
    this.delivered = {};
    this.satisfaction = null;
    this.month = null;
    this.growthCarry = 0;
    this.powerSum = 0;
    this.powerDays = 0;
    this.powerSat = null;
    this.emit();
  }

  /** What a save keeps (see save.ts). */
  exportState(): CitySave {
    return {
      seed: this.seed ?? 0,
      buildings: Array.from(this.byCell.values()).map((b) => ({ ...b })),
      delivered: { ...this.delivered },
      satisfaction: this.satisfaction && { ...this.satisfaction },
      month: this.month,
      growthCarry: this.growthCarry,
      powerSat: this.powerSat,
      powerSum: this.powerSum,
      powerDays: this.powerDays,
    };
  }

  /** Continue a saved city on `map` (its map; the city cells come from it). */
  importState(s: CitySave, map: TerrainMap): void {
    this.seed = null;
    this.reset(map); // city cells + a clean slate, seed = map.seed
    for (const b of s.buildings) this.byCell.set(key(b.x, b.z), { x: b.x, z: b.z, level: b.level });
    this.size = s.buildings.reduce((a, b) => a + b.level, 0);
    this.delivered = { ...s.delivered };
    this.satisfaction = s.satisfaction && { ...s.satisfaction };
    this.month = s.month;
    this.growthCarry = s.growthCarry;
    this.powerSat = s.powerSat ?? null;
    this.powerSum = s.powerSum ?? 0;
    this.powerDays = s.powerDays ?? 0;
    this.emit();
  }

  /** This month's demand for `item` (0 if the city doesn't take it). */
  demandOf(item: Item): number {
    const d = DEMAND[item];
    return d ? Math.round(d.base + d.perLevel * this.size) : 0;
  }

  /**
   * `n` units of `item` delivered to a city stop. Returns the units to pay
   * for: in full up to what's still wanted this month, OVERSUPPLY_PRICE beyond.
   */
  deliver(item: Item, n: number): number {
    if (n <= 0 || !DEMAND[item]) return 0;
    const had = this.delivered[item] ?? 0;
    const wanted = Math.max(0, this.demandOf(item) - had);
    const full = Math.min(n, wanted);
    this.delivered[item] = had + n;
    this.emit();
    return full + (n - full) * OVERSUPPLY_PRICE;
  }

  /** The power plants' output now (MW); counted into the month by `advance`. */
  setPower(mw: number): void {
    if (Math.abs(mw - this.powerNow) < 1) return;
    this.powerNow = mw;
    this.emit();
  }

  /** What the city needs now (MW). */
  powerDemand(): number {
    return this.size * POP_PER_LEVEL * POWER_PER_POP;
  }

  /** `days` whole game days passed; it is now `dateMs`. */
  advance(days: number, dateMs: number, rng: () => number = Math.random): void {
    if (days <= 0) return;
    // This month's power: the supply share of each day.
    const need = this.powerDemand();
    this.powerSum += (need > 0 ? Math.min(1, this.powerNow / need) : 1) * days;
    this.powerDays += days;
    const m = monthOf(dateMs);
    if (this.month === null) this.month = m;
    else if (m !== this.month) {
      this.endMonth();
      this.month = m;
    }
    this.growthCarry += days * this.growthPerDay();
    let changed = false;
    while (this.growthCarry >= 1) {
      this.growthCarry -= 1;
      if (this.grow(rng)) changed = true;
    }
    if (changed) this.emit();
  }

  getSnapshot(): CitySnapshot {
    return this.snapshot;
  }

  /** Stable list of all buildings; safe for useSyncExternalStore. */
  getBuildings(): Building[] {
    return this.snapshot.buildings;
  }

  get count(): number {
    return this.byCell.size;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------------ inner

  private meanSatisfaction(): number {
    if (!this.satisfaction) return 0;
    let s = 0;
    for (const it of CITY_ITEMS) s += this.satisfaction[it] ?? 0;
    return s / CITY_ITEMS.length;
  }

  private growthMode(): CitySnapshot['growth'] {
    if (this.size < UNSUPPLIED_LEVELS) return 'free';
    if (this.powerSat !== null && this.powerSat < POWER_MIN) return 'nopower';
    return this.meanSatisfaction() > 0.05 ? 'supplied' : 'stalled';
  }

  private growthPerDay(): number {
    const mode = this.growthMode();
    if (mode === 'free') return GROWTH_BASE;
    return mode === 'supplied' ? GROWTH_SUPPLIED * this.meanSatisfaction() : 0;
  }

  /** Month over: what was delivered against what was wanted. */
  private endMonth(): void {
    const sat: Partial<Record<Item, number>> = {};
    for (const it of CITY_ITEMS) {
      const want = this.demandOf(it);
      const now = want > 0 ? Math.min(1, (this.delivered[it] ?? 0) / want) : 1;
      const before = this.satisfaction?.[it];
      sat[it] = before === undefined ? now : (before + now) / 2;
    }
    this.satisfaction = sat;
    this.delivered = {};
    const p = this.powerDays > 0 ? this.powerSum / this.powerDays : 1;
    this.powerSat = this.powerSat === null ? p : (this.powerSat + p) / 2;
    this.powerSum = 0;
    this.powerDays = 0;
    this.emit();
  }

  /** One growth step: a new building or a level up. False if it hit a maxed one. */
  private grow(rng: () => number): boolean {
    if (this.cityCells.length === 0) return false;
    const [x, z] = this.cityCells[Math.floor(rng() * this.cityCells.length)];
    const k = key(x, z);
    const existing = this.byCell.get(k);
    if (!existing) this.byCell.set(k, { x, z, level: 1 });
    else if (existing.level < MAX_LEVEL) existing.level += 1;
    else return false;
    this.size++;
    return true;
  }

  private build(): CitySnapshot {
    const demand: Partial<Record<Item, number>> = {};
    for (const it of CITY_ITEMS) demand[it] = this.demandOf(it);
    return {
      // Shallow copies so consumers can't mutate state and identities change
      // when levels change (helps React diffing).
      buildings: Array.from(this.byCell.values()).map((b) => ({ ...b })),
      size: this.size,
      population: this.size * POP_PER_LEVEL,
      demand,
      delivered: { ...this.delivered },
      satisfaction: this.satisfaction && { ...this.satisfaction },
      growth: this.growthMode(),
      power: { supply: this.powerNow, demand: this.powerDemand() },
      powerSat: this.powerSat,
    };
  }

  private emit(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }
}
