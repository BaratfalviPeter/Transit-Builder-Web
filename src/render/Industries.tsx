/**
 * Industries — renders the auto-generated industry buildings.
 *
 * Two kinds, placed by the generator next to their resource:
 *   - LumberMill (fatelep): a brown sawmill building with a chimney.
 *   - Mine (bánya): a dark-grey quarry building with a conical rock/spoil pile.
 *
 * There are only a handful of industry cells, so each is a small group of
 * primitive meshes (no instancing needed). World mapping matches the rest of
 * the map: cell [x][z] -> ((x-half)*cellSize, _, (z-half)*cellSize).
 */

import { useMemo } from 'react';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface IndustriesProps {
  map: TerrainMap;
  cellSize: number;
}

export function Industries({ map, cellSize }: IndustriesProps) {
  const half = (map.size - 1) / 2;

  const items = useMemo(() => {
    const out: Array<{ x: number; z: number; type: CellType }> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        const t = map.cells[x][z];
        if (t === CellType.LumberMill || t === CellType.Mine) {
          out.push({ x, z, type: t });
        }
      }
    }
    return out;
  }, [map]);

  return (
    <group>
      {items.map(({ x, z, type }) => {
        const wx = (x - half) * cellSize;
        const wz = (z - half) * cellSize;
        return type === CellType.LumberMill ? (
          <LumberMill key={`${x},${z}`} x={wx} z={wz} cellSize={cellSize} />
        ) : (
          <Mine key={`${x},${z}`} x={wx} z={wz} cellSize={cellSize} />
        );
      })}
    </group>
  );
}

/** Brown sawmill building + a chimney. */
function LumberMill({
  x,
  z,
  cellSize,
}: {
  x: number;
  z: number;
  cellSize: number;
}) {
  const s = cellSize;
  const color = CELL_STYLE[CellType.LumberMill].color;
  const bodyW = 0.7 * s;
  const bodyH = 0.55 * s;
  const roofH = 0.3 * s;
  return (
    <group position={[x, 0, z]}>
      {/* Main building */}
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[bodyW, bodyH, bodyW]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Pitched roof (a 4-sided pyramid). */}
      <mesh position={[0, bodyH + roofH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[bodyW * 0.72, roofH, 4]} />
        <meshStandardMaterial color="#5c3a1b" roughness={0.9} />
      </mesh>
      {/* Chimney */}
      <mesh position={[bodyW * 0.28, bodyH + roofH * 0.6, bodyW * 0.28]} castShadow>
        <boxGeometry args={[0.12 * s, 0.5 * s, 0.12 * s]} />
        <meshStandardMaterial color="#3d2a19" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Dark-grey quarry building + a conical rock/spoil pile. */
function Mine({ x, z, cellSize }: { x: number; z: number; cellSize: number }) {
  const s = cellSize;
  const color = CELL_STYLE[CellType.Mine].color;
  const bodyW = 0.6 * s;
  const bodyH = 0.5 * s;
  return (
    <group position={[x, 0, z]}>
      {/* Quarry shed */}
      <mesh position={[-0.14 * s, bodyH / 2, -0.14 * s]} castShadow receiveShadow>
        <boxGeometry args={[bodyW, bodyH, bodyW]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {/* Spoil / rock pile */}
      <mesh position={[0.22 * s, 0.28 * s, 0.22 * s]} castShadow>
        <coneGeometry args={[0.34 * s, 0.56 * s, 7]} />
        <meshStandardMaterial color="#6b7079" roughness={1} />
      </mesh>
      {/* Mine-head headframe (simple A-frame suggestion) */}
      <mesh position={[-0.14 * s, bodyH + 0.18 * s, -0.14 * s]} castShadow>
        <boxGeometry args={[0.1 * s, 0.4 * s, 0.1 * s]} />
        <meshStandardMaterial color="#2f3238" roughness={0.9} />
      </mesh>
    </group>
  );
}
