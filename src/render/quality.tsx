/**
 * Graphics quality — how hard the game works the GPU (laptops: heat,
 * battery). Three presets, remembered per browser:
 *
 *   - eco:      30 fps, 1× pixel ratio, 2048 shadow map
 *   - balanced: 60 fps, ≤ 1.5× pixel ratio, 2048 shadow map (default)
 *   - max:      no fps cap (the display's rate, e.g. 120 Hz), native pixel
 *               ratio, 4096 shadow map
 *
 * The fps cap: the Canvas renders on demand and <FrameLimiter> asks for a
 * frame at most `fps` times a second (animations still advance by real
 * time, just in fewer, larger steps).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';

export type QualityPreset = 'eco' | 'balanced' | 'max';

export interface Quality {
  preset: QualityPreset;
  /** Frames per second cap (0 = none). */
  fps: number;
  /** Device-pixel-ratio range for the Canvas. */
  dpr: [number, number];
  shadowMap: number;
}

const native = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

export const QUALITY: Record<QualityPreset, Quality> = {
  eco: { preset: 'eco', fps: 30, dpr: [1, 1], shadowMap: 2048 },
  balanced: { preset: 'balanced', fps: 60, dpr: [1, Math.min(native, 1.5)], shadowMap: 2048 },
  max: { preset: 'max', fps: 0, dpr: [1, native], shadowMap: 4096 },
};

export const QUALITY_LABEL: Record<QualityPreset, string> = {
  eco: 'Energiatakarékos',
  balanced: 'Kiegyensúlyozott',
  max: 'Maximum',
};

const KEY = 'tb.quality';

function load(): QualityPreset {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'eco' || v === 'balanced' || v === 'max') return v;
  } catch {
    // Storage unavailable: default.
  }
  return 'balanced';
}

let current: Quality = QUALITY[load()];
const listeners = new Set<() => void>();

export function setQuality(preset: QualityPreset): void {
  current = QUALITY[preset];
  try {
    localStorage.setItem(KEY, preset);
  } catch {
    // Not remembered — still applied for this session.
  }
  for (const l of listeners) l();
}

export function useQuality(): Quality {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Requests frames at most `fps` times a second (for a Canvas with
 * frameloop="demand"); `fps` 0 = every display frame.
 */
export function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = fps > 0 ? 1000 / fps : 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // A little slack, so a 60 fps cap on a 60 Hz display never skips.
      if (t - last >= step - 2) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}
