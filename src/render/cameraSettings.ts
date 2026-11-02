/**
 * Camera sensitivity (how fast WASD pans, the mouse turns and zooms),
 * and whether the wheel zooms towards the mouse — remembered per browser.
 * 1 = default; the Játék panel (Beállítások) and the Dev tab have the controls.
 */

import { useSyncExternalStore } from 'react';

export const CAMERA_SENS_MIN = 0.25;
export const CAMERA_SENS_MAX = 2;

const KEY = 'tb.cameraSens';

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= CAMERA_SENS_MIN && v <= CAMERA_SENS_MAX) return v;
  } catch {
    // Storage unavailable: default.
  }
  return 1;
}

let sens = load();
const listeners = new Set<() => void>();

/** Current sensitivity (for per-frame code). */
export const cameraSens = (): number => sens;

export function setCameraSens(v: number): void {
  sens = Math.min(CAMERA_SENS_MAX, Math.max(CAMERA_SENS_MIN, v));
  try {
    localStorage.setItem(KEY, String(sens));
  } catch {
    // Not remembered — still applied for this session.
  }
  for (const l of listeners) l();
}

export function useCameraSens(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sens,
  );
}

// ------------------------------------------------- zoom towards the mouse

const ZOOM_KEY = 'tb.zoomToCursor';
let zoomCursor = (() => {
  try {
    return localStorage.getItem(ZOOM_KEY) !== '0';
  } catch {
    return true;
  }
})();
const zoomListeners = new Set<() => void>();

/** The wheel zooms towards the point under the mouse (else towards the screen's centre). */
export function setZoomToCursor(on: boolean): void {
  zoomCursor = on;
  try {
    localStorage.setItem(ZOOM_KEY, on ? '1' : '0');
  } catch {
    // Not remembered — still applied for this session.
  }
  for (const l of zoomListeners) l();
}

export function useZoomToCursor(): boolean {
  return useSyncExternalStore(
    (l) => {
      zoomListeners.add(l);
      return () => zoomListeners.delete(l);
    },
    () => zoomCursor,
  );
}
