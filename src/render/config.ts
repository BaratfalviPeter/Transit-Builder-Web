/**
 * Shared, tweakable render-layer configuration.
 *
 * `cellSize` is the single source of truth for the grid scale and is threaded
 * through the grid floor, snap-to-grid math, and placement rendering.
 */

export interface RenderConfig {
  /**
   * World-space size of one grid cell. Halved (2 → 1) when the grid was
   * subdivided 2×: the map keeps its physical size (121 cells × 1 = the old
   * 61 × 2), but each old cell is now 4 finer cells. Everything that scales by
   * cellSize (roads, rails, industries, trees, rocks, city blocks, terrain
   * relief) automatically becomes half as big; snapping/picking use cellSize.
   */
  cellSize: number;
  /** Number of cells along one half-axis; grid spans [-gridHalfExtent, +gridHalfExtent]. */
  gridHalfExtent: number;
}

export const DEFAULT_CONFIG: RenderConfig = {
  cellSize: 1,
  // Covers the full 121×121 play area (half-extent >= size/2).
  gridHalfExtent: 80,
};
