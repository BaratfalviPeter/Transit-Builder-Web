/**
 * Road types (úttípusok): DIRT road (földút) and MAIN road (főút).
 *
 * A road cell is CellType.Road either way; the dirt ones are listed in
 * `map.dirt` (cell index x·size + z). Old saves have no list: all main.
 *   - Dirt: cheap, low upkeep, trucks go slower on it (DIRT_SPEED).
 *   - Main: the asphalt road.
 *   - Upgrade (felújítás): drawing a main road over a dirt one turns it main
 *     for the difference in price.
 * Trucks prefer the faster road when routing (`roadRoute` weights a dirt
 * step by DIRT_STEP / MAIN_STEP).
 */

import { CellType, type TerrainMap } from './terrain';
import type { ToolId } from './tools';
import type { PathPlanSnapshot } from './PathPlan';
import { HIGHWAY_PRICE, highwayPlan } from './highway';

export type RoadKind = 'dirt' | 'main';

/** Build price per cell ($). */
export const ROAD_PRICE: Record<RoadKind, number> = { dirt: 4, main: 10 };
/** Rail per cell ($; the rail tool's price). */
export const RAIL_PRICE = 20;
/** Dirt → main per cell ($): the difference, so dirt + upgrade = main. */
export const UPGRADE_PRICE = ROAD_PRICE.main - ROAD_PRICE.dirt;
/** Truck top speed on a dirt road, × the normal one. */
export const DIRT_SPEED = 0.7;
/** Truck running cost on dirt roads: × (1 + DIRT_WEAR × the share driven on dirt). */
export const DIRT_WEAR = 0.3;
/** Routing weights of a step (≈ the time it takes: 1 / speed). */
export const MAIN_STEP = 5;
export const DIRT_STEP = 7;
export const HIGHWAY_STEP = 3;

/** The road kind a tool builds (null: not a road tool). */
export function roadKindOf(tool: ToolId | string): RoadKind | null {
  return tool === 'road' ? 'main' : tool === 'dirtroad' ? 'dirt' : null;
}

/** Is the cell a dirt road? */
export function isDirt(map: TerrainMap, x: number, z: number): boolean {
  return !!map.dirt?.size && map.cells[x]?.[z] === CellType.Road && map.dirt.has(x * map.size + z);
}

/** The dirt road cells of a planned route (what a main road would upgrade). */
export function dirtOnPath(map: TerrainMap, path: ReadonlyArray<{ x: number; z: number }>): number {
  if (!map.dirt?.size) return 0;
  let n = 0;
  for (const { x, z } of path) if (isDirt(map, x, z)) n++;
  return n;
}

/** Cost of a planned road route: new cells + (main) the dirt cells it upgrades. */
export function roadPlanCost(map: TerrainMap, path: ReadonlyArray<{ x: number; z: number }>, newCells: number, kind: RoadKind): number {
  return newCells * ROAD_PRICE[kind] + (kind === 'main' ? dirtOnPath(map, path) * UPGRADE_PRICE : 0);
}

/** Cost of the road / rail planner's current plan (`kind`: the road tool's type). */
export function planCost(map: TerrainMap, p: PathPlanSnapshot, kind: RoadKind | 'highway'): number {
  if (p.type === CellType.Rail) return p.newCells * RAIL_PRICE;
  if (kind === 'highway') {
    const h = highwayPlan(map, p.previewPath);
    return h.newCells * HIGHWAY_PRICE + h.caps.length * ROAD_PRICE.main;
  }
  return roadPlanCost(map, p.previewPath, p.newCells, kind);
}
