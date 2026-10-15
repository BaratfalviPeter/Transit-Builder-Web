/**
 * World — the authoritative simulation state container.
 *
 * This is a plain TypeScript class with no dependency on React or Three.js.
 * It owns the set of placements and the cell occupancy index, and exposes
 * imperative methods to mutate that state. A lightweight subscription
 * mechanism lets the render/UI layer react to changes without the sim
 * knowing anything about those layers.
 *
 * Future simulation systems (road graph, pathfinding, traffic, economy)
 * will live alongside this in `src/sim`, operating on the same state.
 */

import {
  cellKey,
  type CellKey,
  type GridCoord,
  type PlaceableKind,
  type Placement,
} from './types';

type Listener = () => void;

export class World {
  private readonly placements = new Map<string, Placement>();
  private readonly occupancy = new Map<CellKey, string>();
  private readonly listeners = new Set<Listener>();
  private nextId = 1;

  // Cached immutable snapshot of placements. Rebuilt only on mutation so that
  // consumers (e.g. React's useSyncExternalStore) get a stable reference
  // between changes and don't loop.
  private snapshot: Placement[] = [];

  /** True if the given cell already holds an object. */
  isOccupied(coord: GridCoord): boolean {
    return this.occupancy.has(cellKey(coord.cx, coord.cz));
  }

  /** The placement at a cell, or undefined if empty. */
  placementAt(coord: GridCoord): Placement | undefined {
    const id = this.occupancy.get(cellKey(coord.cx, coord.cz));
    return id ? this.placements.get(id) : undefined;
  }

  /**
   * Place an object on a cell. One object per cell: if the cell is already
   * occupied this is a no-op and returns null.
   */
  place(kind: PlaceableKind, coord: GridCoord): Placement | null {
    const key = cellKey(coord.cx, coord.cz);
    if (this.occupancy.has(key)) return null;

    const placement: Placement = {
      id: `p${this.nextId++}`,
      kind,
      coord,
    };
    this.placements.set(placement.id, placement);
    this.occupancy.set(key, placement.id);
    this.emit();
    return placement;
  }

  /** Remove the object at a cell, if any. Returns true if something was removed. */
  removeAt(coord: GridCoord): boolean {
    const key = cellKey(coord.cx, coord.cz);
    const id = this.occupancy.get(key);
    if (!id) return false;
    this.occupancy.delete(key);
    this.placements.delete(id);
    this.emit();
    return true;
  }

  /**
   * Snapshot of all current placements. The returned array reference is
   * stable until the next mutation, which makes it safe to use directly as a
   * `useSyncExternalStore` snapshot.
   */
  getPlacements(): Placement[] {
    return this.snapshot;
  }

  get count(): number {
    return this.placements.size;
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.snapshot = Array.from(this.placements.values());
    for (const l of this.listeners) l();
  }
}
