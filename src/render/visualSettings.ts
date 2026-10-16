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
  ambientIntensity: 0.4,
  ambientColor: '#fdf6e3',
  hemiIntensity: 0.35,
  hemiSky: '#cfe3ff',
  hemiGround: '#5d7a45',
  sunIntensity: 2.2,
  sunColor: '#fff3d6',
  /** Sun direction: compass angle (deg) and height above the horizon (deg). */
  sunAzimuth: 27,
  sunElevation: 53,
  shadowBias: -0.0004,
  shadowNormalBias: 0.04,
  /** Tone-mapping exposure (overall brightness). */
  exposure: 1,
  background: '#bcd6e6',

  // --- Terrain ---
  grass1: '#7e9a45',
  grass2: '#76923f',
  grass3: '#86a24b',
  grass4: '#7a9642',
  /** Per-facet brightness wobble on grass/hills (0 = none). */
  grassWobble: 0.06,
  hill1: '#8b9a52',
  hill2: '#83924b',
  hill3: '#93a259',
  forestFloor: '#5f7f3b',
  water: '#5e9fc2',
  cliff: '#7a5536',
  city: '#cfc8b2',
  /** Terrain roughness (0 = shiny, 1 = matte). */
  terrainRoughness: 0.95,

  // --- Grid lines ---
  gridVisible: true,
  gridCell: '#6c8a3a',
  gridSection: '#62803a',

  // --- Trees & rocks ---
  tree1: '#3f6a33',
  tree2: '#4a7a3a',
  tree3: '#365d2e',
  tree4: '#567f3c',
  tree5: '#2f5529',
  /** Extra brightness per higher tree tier (sun-lit tips). */
  treeTipLight: 0.08,
  trunk: '#6b4a2b',
  rock1: '#6e6c69',
  rock2: '#7c7a76',
  rock3: '#5f5e5c',
  rock4: '#86847f',

  // --- Clouds ---
  cloudsVisible: true,
  cloudColor: '#ffffff',
  cloudGlow: 0.25,
  cloudCount: 8,
  cloudSpeed: 0.8,
  cloudShadows: true,
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
