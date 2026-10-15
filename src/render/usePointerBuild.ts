/**
 * usePointerBuild — shared pointer handlers for click + drag building.
 *
 * The same gesture logic must run on every surface the player can build on —
 * the flat ground pick-plane AND the raised hill mesh — so that the raycaster
 * reports the hit on the ACTUAL geometry under the cursor (the sloped hill, not
 * the flat plane beneath it). This hook centralises that logic and returns a
 * set of R3F pointer handlers to spread onto each such mesh.
 *
 * Every handler calls `e.stopPropagation()` so a hit on the nearer surface
 * (e.g. a hill) does not "pass through" to meshes behind/below it (e.g. the
 * flat plane), which was the source of the hill click-accuracy bug.
 *
 * The hit's world-space `e.point` is forwarded via `onPaint`; because we hit
 * the real elevated surface, its x/z map to the correct grid cell.
 */

import { type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';

export interface PointerBuildHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
  onPointerLeave: (e: ThreeEvent<PointerEvent>) => void;
}

export function usePointerBuild(
  onPaint: (x: number, z: number) => void,
  onDragChange?: (dragging: boolean) => void,
): PointerBuildHandlers {
  // Shared across every surface using this hook within a component, so a drag
  // started on grass continues onto a hill and vice-versa.
  const dragging = useRef(false);

  return useMemo<PointerBuildHandlers>(() => {
    const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return; // left button only
      e.stopPropagation();
      dragging.current = true;
      onDragChange?.(true);
      onPaint(e.point.x, e.point.z); // paint the starting cell immediately
    };

    const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      onPaint(e.point.x, e.point.z);
    };

    const endDrag = (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      dragging.current = false;
      onDragChange?.(false);
    };

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
    };
  }, [onPaint, onDragChange]);
}
