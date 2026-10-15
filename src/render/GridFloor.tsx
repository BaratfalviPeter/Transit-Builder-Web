/**
 * GridFloor — a 3D grid floor on the X/Z plane plus an invisible pick plane.
 *
 * - The visible grid lines are drawn with drei's <Grid> helper, scaled by
 *   `cellSize`.
 * - An invisible, pointer-enabled plane (`floorRef`) spans the whole grid and
 *   receives click events. We attach the raycast hit handler here and forward
 *   the world-space point to the parent, which performs snap-to-grid.
 */

import { Grid } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';

export interface GridFloorProps {
  cellSize: number;
  gridHalfExtent: number;
  /** Called with the world-space (x, z) where the floor was clicked. */
  onFloorClick?: (x: number, z: number) => void;
}

export function GridFloor({
  cellSize,
  gridHalfExtent,
  onFloorClick,
}: GridFloorProps) {
  // Total world extent of the grid (full width/depth in meters).
  const size = gridHalfExtent * 2 * cellSize;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // Only react to the primary (nearest) intersection.
    e.stopPropagation();
    onFloorClick?.(e.point.x, e.point.z);
  };

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

      {/* Invisible pick plane. Rotated to lie flat on X/Z. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
