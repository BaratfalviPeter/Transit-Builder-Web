/**
 * Visual settings — a tiny global store for every tunable light / colour value
 * of the scene, driven by the in-game "Látvány" tuner panel.
 *
 * - Values persist in localStorage, so a look survives a reload.
 * - The panel can copy all values as JSON (to send back and bake in as the
 *   new defaults).
 * - Renderers read values via `useVisual()` (re-render on change) or
 *   `getVisual()` + `subscribeVisual()` (imperative, no React re-render).
 */

import { useSyncExternalStore } from 'react';

export const VISUAL_DEFAULTS = {
  // --- Lights ---
  ambientIntensity: 0.55,
  ambientColor: '#fff4ee',
  hemiIntensity: 0.42,
  hemiSky: '#bcd0e6',
  hemiGround: '#6d7a4a',
  sunIntensity: 2.15,
  sunColor: '#ffeccc',
  /** Sun direction: compass angle (deg) and height above the horizon (deg). */
  sunAzimuth: 27,
  sunElevation: 48,
  shadowBias: -0.0004,
  shadowNormalBias: 0.04,
  /**
   * Live shadow updates every frame. OFF = the shadow map is computed once
   * (huge FPS win with ~1700 trees); moving cloud/bird shadows then stay put.
   * ON = clouds/birds cast moving shadows at a 60 fps cost.
   */
  liveShadows: false,
  /** Tone-mapping exposure (overall brightness). */
  exposure: 1,
  background: '#bccdd8',

  // --- Terrain ---
  grass1: '#7f8a48',
  grass2: '#788540',
  grass3: '#869250',
  grass4: '#7b8844',
  /** Per-facet brightness wobble on grass/hills (0 = none). */
  grassWobble: 0.05,
  hill1: '#8a9150',
  hill2: '#7f8847',
  hill3: '#9a9a58',
  forestFloor: '#5f7035',
  water: '#78a0ba',
  cliff: '#7b4b36',
  city: '#cdc8bc',
  /** Terrain roughness (0 = shiny, 1 = matte). */
  terrainRoughness: 0.95,

  // --- Grid lines ---
  gridVisible: true,
  gridCell: '#70803d',
  gridSection: '#667637',

  // --- Trees & rocks ---
  tree1: '#4a6232',
  tree2: '#566d36',
  tree3: '#3f5a2c',
  tree4: '#5f7a3c',
  tree5: '#3a5226',
  /** Extra brightness per higher tree tier (sun-lit tips). */
  treeTipLight: 0.06,
  trunk: '#5a3f28',
  rock1: '#8c8a86',
  rock2: '#9a9792',
  rock3: '#76736f',
  rock4: '#a3a09a',

  // --- Clouds ---
  cloudsVisible: true,
  cloudColor: '#f4eef2',
  cloudGlow: 0.2,
  cloudCount: 12,
  cloudSpeed: 0.65,
  cloudShadows: true,

  // --- Birds ---
  birdsVisible: true,
  /** Number of flocks circling over forests. */
  birdFlocks: 5,
  birdColor: '#2e2b29',
  birdSpeed: 1,
};

export type VisualSettings = typeof VISUAL_DEFAULTS;
export type VisualKey = keyof VisualSettings;

const STORAGE_KEY = 'tb.visual.v1';

function load(): VisualSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...VISUAL_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...VISUAL_DEFAULTS };
}

let state: VisualSettings = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, 250);
}

export function getVisual(): VisualSettings {
  return state;
}

export function setVisual<K extends VisualKey>(key: K, value: VisualSettings[K]): void {
  if (state[key] === value) return;
  state = { ...state, [key]: value };
  emit();
}

export function setVisualAll(next: Partial<VisualSettings>): void {
  state = { ...VISUAL_DEFAULTS, ...next };
  emit();
}

export function resetVisual(): void {
  state = { ...VISUAL_DEFAULTS };
  emit();
}

export function subscribeVisual(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whole settings object (re-renders on any change). */
export function useVisual(): VisualSettings {
  return useSyncExternalStore(subscribeVisual, getVisual, getVisual);
}

/** Only the values a component cares about — re-renders when they change. */
export function useVisualKeys<K extends VisualKey>(keys: readonly K[]): Pick<VisualSettings, K> {
  // Build a stable string signature so useSyncExternalStore compares cheaply.
  const sig = useSyncExternalStore(
    subscribeVisual,
    () => keys.map((k) => String(state[k])).join('|'),
    () => keys.map((k) => String(state[k])).join('|'),
  );
  void sig;
  const out = {} as Pick<VisualSettings, K>;
  for (const k of keys) out[k] = state[k];
  return out;
}

/** Sun position from azimuth/elevation at a given distance from the origin. */
export function sunPosition(
  azimuthDeg: number,
  elevationDeg: number,
  dist = 131,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const h = Math.cos(el) * dist;
  return [Math.cos(az) * h, Math.sin(el) * dist, Math.sin(az) * h];
}
