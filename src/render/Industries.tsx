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
  cornerHeightAt,
  SPECIAL_BUILDINGS,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { PowerPlantModel } from './PowerPlantModel';
import { MineModel } from './MineModel';
import { LumberMillModel } from './LumberMillModel';

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
        const wx = (x - half) * cellSize;
        const wz = (z - half) * cellSize;
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
                scale={cellSize}
                rotationY={(((x * 3 + z * 7) % 4) * Math.PI) / 2}
                phase={(x * 0.41 + z * 0.23) % 5}
              />
            );
          case CellType.Mine:
            return (
              <MineModel
                key={key}
                position={[wx, wy, wz]}
                scale={cellSize}
                rotationY={(((x * 5 + z * 11) % 4) * Math.PI) / 2}
                phase={(x * 0.53 + z * 0.29) % 5}
              />
            );
          case CellType.PowerPlant:
            return (
              <PowerPlantModel
                key={key}
                position={[wx, wy, wz]}
                scale={cellSize}
                rotationY={(((x * 7 + z * 13) % 4) * Math.PI) / 2}
                phase={(x * 0.37 + z * 0.61) % 5}
              />
            );
          case CellType.Factory:
            return <Factory key={key} x={wx} y={wy} z={wz} cellSize={cellSize} />;
          default:
            return null;
        }
      })}
    </group>
  );
}

/** Grey factory with two chimney stacks. */
function Factory({
  x,
  y,
  z,
  cellSize,
}: {
  x: number;
  y: number;
  z: number;
  cellSize: number;
}) {
  const s = cellSize;
  const color = CELL_STYLE[CellType.Factory].color;
  const bodyW = 0.75 * s;
  const bodyH = 0.5 * s;
  return (
    <group position={[x, y, z]}>
      {/* Main hall */}
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[bodyW, bodyH, bodyW]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Two chimney stacks */}
      <mesh position={[-0.18 * s, bodyH + 0.25 * s, -0.18 * s]} castShadow>
        <cylinderGeometry args={[0.07 * s, 0.07 * s, 0.5 * s, 12]} />
        <meshStandardMaterial color="#4a4e55" roughness={0.9} />
      </mesh>
      <mesh position={[0.02 * s, bodyH + 0.32 * s, -0.18 * s]} castShadow>
        <cylinderGeometry args={[0.07 * s, 0.07 * s, 0.64 * s, 12]} />
        <meshStandardMaterial color="#4a4e55" roughness={0.9} />
      </mesh>
    </group>
  );
}
