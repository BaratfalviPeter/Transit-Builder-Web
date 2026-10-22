/**
 * Industries — renders the auto-generated industry buildings.
 *
 * Two kinds, placed by the generator next to their resource:
 *   - LumberMill (fatelep): the detailed animated LumberMillModel (3×3 lot).
 *   - Mine (bánya): the detailed animated open-pit MineModel (3×3 lot).
 *
 * There are only a handful of industry cells, so each is a small group of
 * primitive meshes (no instancing needed). World mapping matches the rest of
 * the map: cell [x][z] -> ((x-half)*cellSize, _, (z-half)*cellSize).
 */

import { useMemo } from 'react';
import {
  CellType,
  INDUSTRY_CENTER_OFFSET,
  INDUSTRY_MODEL_SCALE,
  LARGE_INDUSTRY,
  cornerHeightAt,
  SPECIAL_BUILDINGS,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { PowerPlantModel } from './PowerPlantModel';
import { MineModel } from './MineModel';
import { LumberMillModel } from './LumberMillModel';
import { FactoryModel } from './FactoryModel';
import { OilRigModel } from './OilRigModel';
import { WATER_LEVEL } from './TerrainSurface';

export interface IndustriesProps {
  map: TerrainMap;
  cellSize: number;
}

/** Grass surface top (where buildings rest on flat ground), in cellSize units. */
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function Industries({ map, cellSize }: IndustriesProps) {
  const half = (map.size - 1) / 2;

  const items = useMemo(() => {
    const out: Array<{ x: number; z: number; type: CellType }> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        const t = map.cells[x][z];
        if (SPECIAL_BUILDINGS.has(t)) out.push({ x, z, type: t });
      }
    }
    return out;
  }, [map]);

  return (
    <group>
      {items.map(({ x, z, type }) => {
        // Large industries sit at the CENTRE of their 6×6 lot (half a cell past
        // the anchor cell) and are scaled up from their 3×3 design size.
        const big = LARGE_INDUSTRY.has(type);
        const off = big ? INDUSTRY_CENTER_OFFSET : 0;
        const wx = (x - half + off) * cellSize;
        const wz = (z - half + off) * cellSize;
        const ms = cellSize * (big ? INDUSTRY_MODEL_SCALE : 1);
        // Buildings spawn on flat cells, so the cell's uniform corner height is
        // its surface top; raise the building onto it (hill-top buildings too).
        const wy = (FLAT_TOP + cornerHeightAt(map, x, z)) * cellSize;
        const key = `${x},${z}`;
        switch (type) {
          case CellType.LumberMill:
            return (
              <LumberMillModel
                key={key}
                position={[wx, wy, wz]}
                scale={ms}
                rotationY={(((x * 3 + z * 7) % 4) * Math.PI) / 2}
                phase={(x * 0.41 + z * 0.23) % 5}
              />
            );
          case CellType.Mine:
            return (
              <MineModel
                key={key}
                position={[wx, wy, wz]}
                scale={ms}
                rotationY={(((x * 5 + z * 11) % 4) * Math.PI) / 2}
                phase={(x * 0.53 + z * 0.29) % 5}
              />
            );
          case CellType.PowerPlant:
            return (
              <PowerPlantModel
                key={key}
                position={[wx, wy, wz]}
                scale={ms}
                rotationY={(((x * 7 + z * 13) % 4) * Math.PI) / 2}
                phase={(x * 0.37 + z * 0.61) % 5}
              />
            );
          case CellType.Factory:
            return (
              <FactoryModel
                key={key}
                position={[wx, wy, wz]}
                scale={ms}
                rotationY={(((x * 11 + z * 5) % 4) * Math.PI) / 2}
                phase={(x * 0.31 + z * 0.47) % 5}
              />
            );
          case CellType.OilRig:
            // Stands in a lake: its origin is the water surface.
            return (
              <OilRigModel
                key={key}
                position={[wx, WATER_LEVEL * cellSize, wz]}
                scale={ms}
                rotationY={(((x * 13 + z * 3) % 4) * Math.PI) / 2}
                phase={(x * 0.43 + z * 0.19) % 5}
              />
            );
          default:
            return null;
        }
      })}
    </group>
  );
}
