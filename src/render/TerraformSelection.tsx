/**
 * TerraformSelection — draws the pending terraform selection on the grid:
 *   - SELECTING phase: a RED outlined tile on each chosen cell.
 *   - BUILDING phase:  a YELLOW "under construction" tile (hazard look) on
 *     each cell while the short build timer runs.
 *
 * These are thin flat markers hovering just above each cell's surface top, so
 * they read clearly without affecting picking (they're non-interactive).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import {
  cornerHeightAt,
  CellType,
  type TerrainMap,
  type TerraformSnapshot,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface TerraformSelectionProps {
  plan: TerraformSnapshot;
  map: TerrainMap;
  cellSize: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const SELECT_COLOR = '#e23c2f'; // red while selecting
const BUILD_COLOR = '#f2c438'; // yellow while under construction

export function TerraformSelection({
  plan,
  map,
  cellSize,
}: TerraformSelectionProps) {
  const half = (map.size - 1) / 2;
  const color = plan.phase === 'building' ? BUILD_COLOR : SELECT_COLOR;

  // Marker geometry (a flat ring-like tile) is shared; positions per cell.
  const markers = useMemo(() => {
    return plan.cells.map(({ x, z }) => {
      const top = (FLAT_TOP + cornerHeightAt(map, x, z)) * cellSize;
      return {
        key: `${x},${z}`,
        pos: [(x - half) * cellSize, top + 0.06 * cellSize, (z - half) * cellSize] as [
          number,
          number,
          number,
        ],
      };
    });
  }, [plan.cells, map, cellSize, half]);

  if (markers.length === 0) return null;

  return (
    <group>
      {markers.map(({ key, pos }) => (
        <group key={key} position={pos}>
          {/* translucent fill */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[cellSize * 0.92, cellSize * 0.92]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={plan.phase === 'building' ? 0.35 : 0.25}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* bright outline */}
          <lineSegments rotation={[-Math.PI / 2, 0, 0]}>
            <edgesGeometry
              args={[new THREE.PlaneGeometry(cellSize * 0.92, cellSize * 0.92)]}
            />
            <lineBasicMaterial color={color} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}
