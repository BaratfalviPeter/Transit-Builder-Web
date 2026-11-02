/**
 * save — the game as JSON in the browser (localStorage).
 *
 * Saved: the map with everything built on it (cells, heights, rail network,
 * stops, signals, traffic controls, cleared scenery), the lines, the money /
 * books / loan / date, the city and the stop stocks. NOT saved: where the
 * vehicles are — on loading they start again from their lines' stops.
 *
 * Pure TypeScript; the React side (useSave.ts) decides when to save / load.
 */

import type { CitySave } from './CityDevelopment';
import type { GameSave } from './GameState';
import type { ProductionSave } from './production';
import type { TerrainMap } from './terrain';
import type { ControlKind } from './traffic';
import type { Line } from './transport';

export const SAVE_KEY = 'transit-builder:save';
/** Bump when the format changes incompatibly: an older save is then ignored. */
export const SAVE_VERSION = 1;

/** The map as plain JSON (its Set / Map fields as arrays). */
type MapSave = Omit<TerrainMap, 'cleared' | 'controls'> & {
  cleared?: number[];
  controls?: Array<[number, ControlKind]>;
};

export interface SaveData {
  version: number;
  /** Real time of the save (ms). */
  savedAt: number;
  map: MapSave;
  lines: Line[];
  game: GameSave;
  city: CitySave;
  production: ProductionSave;
}

export interface SaveParts {
  map: TerrainMap;
  lines: readonly Line[];
  game: GameSave;
  city: CitySave;
  production: ProductionSave;
}

export function toSave(p: SaveParts): SaveData {
  const { cleared, controls, ...rest } = p.map;
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    map: {
      ...rest,
      ...(cleared ? { cleared: [...cleared] } : {}),
      ...(controls ? { controls: [...controls] } : {}),
    },
    lines: p.lines.slice(),
    game: p.game,
    city: p.city,
    production: p.production,
  };
}

/** The map of a save, with its Set / Map fields rebuilt. */
export function mapOf(s: SaveData): TerrainMap {
  const { cleared, controls, ...rest } = s.map;
  return {
    ...rest,
    ...(cleared ? { cleared: new Set(cleared) } : {}),
    ...(controls ? { controls: new Map(controls) } : {}),
  };
}

/** Write the save; false if the browser refused (storage full / blocked). */
export function writeSave(p: SaveParts): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave(p)));
    return true;
  } catch {
    return false;
  }
}

/** The stored save, or null (none, unreadable, or an older format). */
export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SaveData;
    return s && s.version === SAVE_VERSION && s.map?.cells ? s : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* blocked storage: nothing to clear */
  }
}
