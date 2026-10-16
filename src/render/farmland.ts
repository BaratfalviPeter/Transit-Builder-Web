/**
 * farmland — a deterministic, render-only "where are the farm fields" mask.
 *
 * Farmland is NOT a sim cell type: it lives on ordinary Empty cells in a ring
 * around the city, grouped into rectangular PLOTS (PLOT × PLOT cells), each
 * with one crop. Because it's derived purely from the map (+ seed), building a
 * road/rail on a field cell simply removes the field there (the cell is no
 * longer Empty) — no extra state, no save data.
 *
 * Used by TerrainSurface (flat, crop-coloured ground), MapGrid (no trees/rocks
 * on fields) and Farms (crop rows, fences, barns, windmills, sheep).
 */

import { CellType, GRID_SCALE, cellCornerHeights, type TerrainMap } from '../sim';

export type Crop = 'wheat' | 'corn' | 'plowed' | 'pasture' | 'meadow';

/** Plot edge length in cells. */
export const PLOT = 6;

const CITY_HALF = 2 * GRID_SCALE + 1;
/** Farm ring around the city, Chebyshev distance in cells. */
const RING_IN = CITY_HALF + 3;
const RING_OUT = CITY_HALF + 30;

export function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function nearWater(map: TerrainMap, x: number, z: number, r: number): boolean {
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < map.size && nz < map.size && map.cells[nx][nz] === CellType.Water)
        return true;
    }
  return false;
}

/** Plot indices of a cell. */
export function plotOf(x: number, z: number): [number, number] {
  return [Math.floor(x / PLOT), Math.floor(z / PLOT)];
}

/** Crop of a whole plot (or null if the plot isn't farmland), ignoring cells. */
export function plotCrop(map: TerrainMap, px: number, pz: number): Crop | null {
  const c = Math.floor(map.size / 2);
  const mx = px * PLOT + PLOT / 2;
  const mz = pz * PLOT + PLOT / 2;
  const d = Math.max(Math.abs(mx - c), Math.abs(mz - c));
  if (d < RING_IN || d > RING_OUT) return null;
  // Denser near town, thinning out toward the wild.
  const p = 0.75 - ((d - RING_IN) / (RING_OUT - RING_IN)) * 0.45;
  if (hash01(px, pz, map.seed + 501) > p) return null;
  const r = hash01(px, pz, map.seed + 502);
  if (r < 0.3) return 'wheat';
  if (r < 0.55) return 'corn';
  if (r < 0.7) return 'plowed';
  if (r < 0.9) return 'pasture';
  return 'meadow';
}

/** Crop on cell (x, z), or null if the cell is not farmland. */
export function farmCrop(map: TerrainMap, x: number, z: number): Crop | null {
  if (map.cells[x][z] !== CellType.Empty) return null;
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  if (h00 !== 0 || h10 !== 0 || h11 !== 0 || h01 !== 0) return null;
  if (nearWater(map, x, z, 1)) return null;
  const [px, pz] = plotOf(x, z);
  return plotCrop(map, px, pz);
}

/** The farmstead (barn / windmill) cell of a plot, if it has one. */
export function farmstead(
  map: TerrainMap,
  px: number,
  pz: number,
): { x: number; z: number; kind: 'barn' | 'windmill' } | null {
  if (!plotCrop(map, px, pz)) return null;
  if (hash01(px, pz, map.seed + 503) > 0.3) return null;
  const x = px * PLOT + 1;
  const z = pz * PLOT + 1;
  if (x >= map.size || z >= map.size || !farmCrop(map, x, z)) return null;
  return { x, z, kind: hash01(px, pz, map.seed + 504) < 0.6 ? 'barn' : 'windmill' };
}

/** Base ground colour of each crop (the rows on top add the texture). */
export const CROP_GROUND: Record<Crop, string> = {
  wheat: '#a8913f',
  corn: '#6f7d35',
  plowed: '#6e5134',
  pasture: '#8ea24f',
  meadow: '#86994a',
};
