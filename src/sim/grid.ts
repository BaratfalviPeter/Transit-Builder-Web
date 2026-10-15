/**
 * Grid math helpers. Pure functions converting between continuous world
 * coordinates (meters, as used by Three.js) and discrete grid cell indices.
 *
 * Convention: a cell with index (cx, cz) is centered at world position
 * (cx * cellSize, _, cz * cellSize). The grid floor is on the X/Z plane
 * (Y is up), which matches the Three.js convention used by the render layer.
 */

import type { GridCoord } from './types';

/**
 * Snap a continuous world position (x, z) to the nearest grid cell index.
 */
export function worldToCell(x: number, z: number, cellSize: number): GridCoord {
  return {
    cx: Math.round(x / cellSize),
    cz: Math.round(z / cellSize),
  };
}

/**
 * Convert a grid cell index to the world position of that cell's center.
 * Returns a tuple [x, y, z] with y = 0 (floor plane).
 */
export function cellToWorld(
  coord: GridCoord,
  cellSize: number,
): [number, number, number] {
  return [coord.cx * cellSize, 0, coord.cz * cellSize];
}
