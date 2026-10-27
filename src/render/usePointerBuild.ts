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
 *
 * CLICK MODE (road/rail, two-click A→B planner): when `click.active()` is true
 * the hook does not drag-paint. Instead a left press+release without moving
 * (< CLICK_SLOP px) fires `click.onClick`, and every pointer move — no button
 * held — fires `click.onHover`, so the route preview follows the cursor.
 * A press that MOVES (≥ CLICK_SLOP) instead starts drawing if the tool draws
 * (`click.dragStart` returns true): then `dragMove` follows the pointer and
 * `dragEnd` fires on release.
 */

import { type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';

export interface PointerBuildHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
  onPointerLeave: (e: ThreeEvent<PointerEvent>) => void;
}

/** Max pointer travel (px) between press and release that still counts as a click. */
const CLICK_SLOP = 6;

export interface ClickModeHandlers {
  /** True while the active tool uses click (A→B) instead of drag building. */
  active: () => boolean;
  onClick: (x: number, z: number) => void;
  onHover: (x: number, z: number) => void;
  /** A drag began at (x, z) (the press point): true if the tool draws with it. */
  dragStart?: (x: number, z: number) => boolean;
  dragMove?: (x: number, z: number) => void;
  dragEnd?: () => void;
}

export function usePointerBuild(
  onPaint: (x: number, z: number) => void,
  onDragChange?: (dragging: boolean) => void,
  click?: ClickModeHandlers,
): PointerBuildHandlers {
  // Shared across every surface using this hook within a component, so a drag
  // started on grass continues onto a hill and vice-versa.
  const dragging = useRef(false);
  // Click mode: screen position of the left press (null = no press pending).
  const press = useRef<{ x: number; y: number; wx: number; wz: number } | null>(null);
  // Click mode: a drawing drag under way.
  const drawing = useRef(false);

  return useMemo<PointerBuildHandlers>(() => {
    const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return; // left button only
      e.stopPropagation();
      if (click?.active()) {
        press.current = { x: e.clientX, y: e.clientY, wx: e.point.x, wz: e.point.z };
        drawing.current = false;
        return;
      }
      dragging.current = true;
      onDragChange?.(true);
      onPaint(e.point.x, e.point.z); // paint the starting cell immediately
    };

    const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
      if (click?.active()) {
        e.stopPropagation();
        const p = press.current;
        if (p && !drawing.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP && click.dragStart?.(p.wx, p.wz)) {
          drawing.current = true;
        }
        if (drawing.current) click.dragMove?.(e.point.x, e.point.z);
        else click.onHover(e.point.x, e.point.z);
        return;
      }
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

    const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
      const p = press.current;
      if (p && e.button === 0) {
        press.current = null;
        e.stopPropagation();
        if (drawing.current) {
          drawing.current = false;
          click?.dragEnd?.();
          return;
        }
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (moved < CLICK_SLOP && click?.active()) click.onClick(e.point.x, e.point.z);
        return;
      }
      endDrag(e);
    };

    const onPointerLeave = (e: ThreeEvent<PointerEvent>) => {
      press.current = null;
      endDrag(e);
    };

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
    };
  }, [onPaint, onDragChange, click]);
}
