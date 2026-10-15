/**
 * GridFloor — the visible reference grid lines only.
 *
 * Building/picking now happens on the unified TerrainSurface mesh (which is the
 * real geometry everywhere), so this component no longer owns an invisible pick
 * plane — it just draws drei's <Grid> helper for visual reference, sitting just
 * above the grass surface so the lines read on flat ground.
 */

import { Grid } from '@react-three/drei';
import { CellType } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface GridFloorProps {
  cellSize: number;
  gridHalfExtent: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function GridFloor({ cellSize, gridHalfExtent }: GridFloorProps) {
  const size = gridHalfExtent * 2 * cellSize;

  return (
    <Grid
      // Lift the lines just above the grass surface top to avoid z-fighting.
      position={[0, FLAT_TOP * cellSize + 0.01 * cellSize, 0]}
      args={[size, size]}
      cellSize={cellSize}
      cellThickness={1}
      cellColor="#5a5a6e"
      sectionSize={cellSize * 5}
      sectionThickness={1.3}
      sectionColor="#8a8aa0"
      infiniteGrid={false}
      fadeDistance={size * 1.5}
      fadeStrength={1}
      followCamera={false}
    />
  );
}
