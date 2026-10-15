/**
 * CityDevelopment — the auto-spawn & growth simulation for the city zone.
 *
 * Pure TypeScript: no React, no Three.js. It owns the set of growing buildings
 * and advances them on discrete "ticks". The render/UI layer drives the tick
 * clock (setInterval) and subscribes for redraws; it never reaches into the
 * growth rules, which live entirely here.
 *
 * Each tick:
 *   1. Pick a random cell inside the central CityCenter zone.
 *   2. If empty -> create a level-1 building there.
 *   3. If occupied and below MAX_LEVEL -> level it up by one.
 *   4. If already at MAX_LEVEL -> no-op (another random pick next tick).
 */

import { CellType, type TerrainMap } from './terrain';

/** Maximum development level a building can reach. */
export const MAX_LEVEL = 5;

/** A single growing building, addressed by its grid cell. */
export interface Building {
  readonly x: number;
  readonly z: number;
  level: number;
}

type Listener = () => void;

function key(x: number, z: number): string {
  return `${x},${z}`;
}

export class CityDevelopment {
  /** All CityCenter cell coordinates eligible for growth. */
  private readonly cityCells: ReadonlyArray<readonly [number, number]>;
  private readonly byCell = new Map<string, Building>();
  private readonly listeners = new Set<Listener>();

  // Cached immutable snapshot so React's useSyncExternalStore gets a stable
  // reference between mutations (no re-render loops).
  private snapshot: Building[] = [];

  constructor(map: TerrainMap) {
    const cells: Array<readonly [number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.CityCenter) {
          cells.push([x, z] as const);
        }
      }
    }
    this.cityCells = cells;
  }

  /**
   * Advance the simulation by one tick. Returns the affected building (either
   * newly spawned or upgraded), or null if the chosen cell was already maxed.
   */
  tick(rng: () => number = Math.random): Building | null {
    if (this.cityCells.length === 0) return null;

    const [x, z] = this.cityCells[Math.floor(rng() * this.cityCells.length)];
    const k = key(x, z);
    const existing = this.byCell.get(k);

    let affected: Building | null = null;
    if (!existing) {
      affected = { x, z, level: 1 };
      this.byCell.set(k, affected);
    } else if (existing.level < MAX_LEVEL) {
      existing.level += 1;
      affected = existing;
    } else {
      // Already at max; nothing changes this tick.
      return null;
    }

    this.emit();
    return affected;
  }

  /** Stable snapshot of all buildings; safe for useSyncExternalStore. */
  getBuildings(): Building[] {
    return this.snapshot;
  }

  get count(): number {
    return this.byCell.size;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    // Rebuild snapshot with shallow copies so consumers can't mutate state and
    // so object identities change when levels change (helps React diffing).
    this.snapshot = Array.from(this.byCell.values()).map((b) => ({ ...b }));
    for (const l of this.listeners) l();
  }
}
