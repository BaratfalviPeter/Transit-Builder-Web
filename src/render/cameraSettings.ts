/**
 * Camera sensitivity (how fast WASD pans, the mouse turns and zooms),
 * remembered per browser. 1 = default; the Dev tab has the slider.
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
