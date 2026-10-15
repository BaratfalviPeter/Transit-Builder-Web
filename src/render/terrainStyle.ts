/**
 * Visual style per terrain cell type. Keeps all look-and-feel in one place so
 * the MapGrid renderer stays declarative.
 *
 * - `color`:   mesh color
 * - `scaleY`:  vertical scale of the unit cube (1 = flat-ish tile)
 * - `offsetY`: extra vertical offset of the tile base (e.g. water sits low)
 *
 * Heights are expressed in multiples of `cellSize` by the renderer, so the look
 * is consistent regardless of grid scale.
 */

import { CellType } from '../sim';

export interface CellStyle {
  color: string;
  /** Vertical scale factor applied to a base tile height. */
  scaleY: number;
  /** Vertical offset of the tile (in cellSize units); negative = sunken. */
  offsetY: number;
}

export const CELL_STYLE: Record<CellType, CellStyle> = {
  [CellType.Empty]: { color: '#6f8f5f', scaleY: 0.15, offsetY: 0 },
  [CellType.CityCenter]: { color: '#b7e08a', scaleY: 0.12, offsetY: 0 },
  [CellType.Water]: { color: '#3b7fd4', scaleY: 0.12, offsetY: -0.2 },
  // Hill is drawn with a custom ramp geometry (see Hills.tsx); color only.
  [CellType.Hill]: { color: '#7d8a5c', scaleY: 1, offsetY: 0 },
  [CellType.Forest]: { color: '#2e6b32', scaleY: 1.5, offsetY: 0 },
  // Player-built road: flat, dark-grey tile resting on the ground.
  [CellType.Road]: { color: '#3a3d42', scaleY: 0.08, offsetY: 0.01 },
  // Auto-generated industries are drawn with custom meshes (Industries.tsx);
  // these colors are the main building color.
  [CellType.LumberMill]: { color: '#8a5a2b', scaleY: 1, offsetY: 0 },
  [CellType.Mine]: { color: '#555a60', scaleY: 1, offsetY: 0 },
  [CellType.PowerPlant]: { color: '#c9cdd4', scaleY: 1, offsetY: 0 },
  [CellType.Factory]: { color: '#7a7f88', scaleY: 1, offsetY: 0 },
};
