/**
 * GridFloor — a 3D grid floor on the X/Z plane plus an invisible pick plane.
 *
 * - The visible grid lines are drawn with drei's <Grid> helper, scaled by
 *   `cellSize`.
 * - An invisible, pointer-enabled plane spans the whole grid and receives
 *   pointer events. It drives both single-click building and drag-to-build:
 *     - onPointerDown  => begin a build gesture at the hit cell
 *     - onPointerMove  => while dragging, continue building along the path
 *     - onPointerUp    => end the gesture
 *   The parent is notified via `onPaint(worldX, worldZ)` for each cell that
 *   should be acted on, and via `onDragChange` when the drag state flips.
 *
 * We only react to the primary (left) button; camera rotation/zoom use the
 * other buttons (see CameraRig).
 */

import { Grid } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';

export interface GridFloorProps {
  cellSize: number;
  gridHalfExtent: number;
  /** Called for each cell to act on (world-space x,z of the pointer hit). */
  onPaint?: (x: number, z: number) => void;
  /** Called when a drag gesture starts (true) or ends (false). */
  onDragChange?: (dragging: boolean) => void;
}

export function GridFloor({
  cellSize,
  gridHalfExtent,
  onPaint,
  onDragChange,
}: GridFloorProps) {
  // Total world extent of the grid (full width/depth in meters).
  const size = gridHalfExtent * 2 * cellSize;

  const dragging = useRef(false);

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return; // left button only
    e.stopPropagation();
    dragging.current = true;
    onDragChange?.(true);
    onPaint?.(e.point.x, e.point.z); // paint the starting cell immediately
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    onPaint?.(e.point.x, e.point.z);
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onDragChange?.(false);
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
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
