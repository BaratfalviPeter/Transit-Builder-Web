/**
 * GridFloor — the visible reference grid lines only.
 *
 * Building/picking now happens on the unified TerrainSurface mesh (which is the
 * real geometry everywhere), so this component no longer owns an invisible pick
 * plane — it just draws drei's <Grid> helper for visual reference, sitting just
 * above the grass surface so the lines read on flat ground.
 */

import { Grid } from '@react-three/drei';
import { useVisualKeys } from './visualSettings';
import { CellType } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface GridFloorProps {
  cellSize: number;
  gridHalfExtent: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function GridFloor({ cellSize, gridHalfExtent }: GridFloorProps) {
  const size = gridHalfExtent * 2 * cellSize;
  const vis = useVisualKeys(['gridVisible', 'gridCell', 'gridSection'] as const);
  if (!vis.gridVisible) return null;

  return (
    <Grid
      // drei's <Grid> draws lines through the origin (0, ±cellSize, …), but a
      // cell CENTER sits at (i-half)*cellSize — i.e. ON a line intersection.
      // Shift the grid by half a cell in X/Z so each cell center lands in the
      // MIDDLE of a grid square, matching where roads/buildings render.
      position={[
        cellSize / 2,
        FLAT_TOP * cellSize + 0.01 * cellSize,
        cellSize / 2,
      ]}
      args={[size, size]}
      cellSize={cellSize}
      cellThickness={0.6}
      cellColor={vis.gridCell}
      sectionSize={cellSize * 5}
      sectionThickness={0.9}
      sectionColor={vis.gridSection}
      infiniteGrid={false}
      fadeDistance={size * 1.5}
      fadeStrength={1}
      followCamera={false}
    />
  );
}
