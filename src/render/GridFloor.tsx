/**
 * GridFloor — a visible reference grid plus an invisible pick plane for FLAT
 * ground.
 *
 * - The visible grid lines are drawn with drei's <Grid> helper, scaled by
 *   `cellSize`.
 * - An invisible, pointer-enabled plane at y≈0 spans the whole grid and
 *   receives pointer events for building on flat terrain. Hills carry their own
 *   pointer handlers on their raised mesh (see Hills.tsx), so clicks on a hill
 *   hit the actual slope geometry rather than this plane beneath it.
 *
 * The shared build handlers (click + drag, with stopPropagation) come from
 * `usePointerBuild` in the parent and are spread onto the plane here.
 */

import { Grid } from '@react-three/drei';
import type { PointerBuildHandlers } from './usePointerBuild';

export interface GridFloorProps {
  cellSize: number;
  gridHalfExtent: number;
  /** Shared pointer handlers (click + drag build) for the flat plane. */
  handlers: PointerBuildHandlers;
}

export function GridFloor({ cellSize, gridHalfExtent, handlers }: GridFloorProps) {
  // Total world extent of the grid (full width/depth in meters).
  const size = gridHalfExtent * 2 * cellSize;

  return (
    <group>
      <Grid
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

      {/* Invisible pick plane for flat ground. Rotated to lie flat on X/Z. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} {...handlers}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
