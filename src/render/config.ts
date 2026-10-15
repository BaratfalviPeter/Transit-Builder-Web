/**
 * Shared, tweakable render-layer configuration.
 *
 * `cellSize` is the single source of truth for the grid scale and is threaded
 * through the grid floor, snap-to-grid math, and placement rendering.
 */

export interface RenderConfig {
  /** World-space size (in meters) of one grid cell. */
  cellSize: number;
  /** Number of cells along one half-axis; grid spans [-gridHalfExtent, +gridHalfExtent]. */
  gridHalfExtent: number;
}

export const DEFAULT_CONFIG: RenderConfig = {
  cellSize: 2,
  gridHalfExtent: 25,
};
