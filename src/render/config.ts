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
  // Covers the full 61×61 play area (half-extent >= size/2) so the click/pick
  // plane and reference grid span the whole map.
  gridHalfExtent: 40,
};
