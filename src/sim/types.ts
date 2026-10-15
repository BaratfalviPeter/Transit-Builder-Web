/**
 * Pure simulation types. No React, no Three.js here.
 *
 * The simulation works in abstract "grid coordinates" (integer cell indices).
 * The render layer is responsible for mapping grid coords <-> world coords
 * using `cellSize`. Keeping the sim in cell-index space means the simulation
 * is independent of any particular rendering scale or engine.
 */

/** A discrete cell position on the grid, in integer cell indices. */
export interface GridCoord {
  readonly cx: number;
  readonly cz: number;
}

/** Kinds of placeable objects. Will grow (roads, factories, ...) over time. */
export type PlaceableKind = 'house';

/** A single placed object occupying exactly one cell. */
export interface Placement {
  readonly id: string;
  readonly kind: PlaceableKind;
  readonly coord: GridCoord;
}

/** Serializable key for a cell, used for O(1) occupancy lookups. */
export type CellKey = string;

export function cellKey(cx: number, cz: number): CellKey {
  return `${cx},${cz}`;
}
