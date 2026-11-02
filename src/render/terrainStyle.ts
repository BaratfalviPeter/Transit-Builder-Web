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
  [CellType.Empty]: { color: '#7e9a45', scaleY: 0.15, offsetY: 0 },
  [CellType.CityCenter]: { color: '#cfc8b2', scaleY: 0.12, offsetY: 0 },
  [CellType.Water]: { color: '#5e9fc2', scaleY: 0.12, offsetY: -0.2 },
  // Hill is drawn with a custom ramp geometry (see Hills.tsx); color only.
  [CellType.Hill]: { color: '#8b9a52', scaleY: 1, offsetY: 0 },
  [CellType.Forest]: { color: '#5f7f3b', scaleY: 1.5, offsetY: 0 },
  // Player-built road: flat, dark-grey tile resting on the ground.
  [CellType.Road]: { color: '#3a3d42', scaleY: 0.012, offsetY: 0.01 },
  // Player-built rail: gravel bed colour (rails/sleepers drawn in Rails.tsx).
  [CellType.Rail]: { color: '#6b6256', scaleY: 0.06, offsetY: 0.01 },
  // Auto-generated industries are drawn with custom meshes (Industries.tsx);
  // these colors are the main building color.
  [CellType.LumberMill]: { color: '#8a5a2b', scaleY: 1, offsetY: 0 },
  [CellType.Mine]: { color: '#555a60', scaleY: 1, offsetY: 0 },
  [CellType.PowerPlant]: { color: '#c9cdd4', scaleY: 1, offsetY: 0 },
  [CellType.Factory]: { color: '#7a7f88', scaleY: 1, offsetY: 0 },
  [CellType.OilRig]: { color: '#80838a', scaleY: 1, offsetY: 0 },
  // Footprint around a 3×3 industry — reads as grass under the model's base.
  [CellType.IndustryLot]: { color: '#7e9a45', scaleY: 0.15, offsetY: 0 },
  // Station platform: the ground under the StationModel (grass-coloured).
  [CellType.Station]: { color: '#7e9a45', scaleY: 0.15, offsetY: 0 },
};
