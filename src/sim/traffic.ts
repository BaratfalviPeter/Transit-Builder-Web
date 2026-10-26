/**
 * Traffic controls the player places on the road network:
 *
 *   - light:      traffic lights on a junction (3+ way road cell). The two
 *                 axes take turns: entering along X needs the X green, etc.
 *   - roundabout: a junction becomes a small roundabout — trucks circle the
 *                 island counter-clockwise (right-hand traffic).
 *   - yield:      "Elsőbbségadás kötelező" on an approach (the road cell
 *                 next to a junction): give way to traffic from the other
 *                 arms before entering.
 *   - stop:       "STOP": like yield, but always halt at the line first.
 *
 * Stored on the map (`controls`, cell index → kind). Entries are validated
 * when read (`activeControl`): a sign whose junction was bulldozed simply
 * stops counting, and comes back if the junction does. Pure TypeScript.
 */

import { CellType, type TerrainMap } from './terrain';
import { hasRailAt } from './railNet';

export type ControlKind = 'light' | 'roundabout' | 'yield' | 'stop';

export const CONTROL_LABEL: Record<ControlKind, string> = {
  light: 'Közlekedési lámpa',
  roundabout: 'Körforgalom',
  yield: 'Elsőbbségadás tábla',
  stop: 'STOP tábla',
};

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

export const cellIndex = (map: TerrainMap, x: number, z: number) => x * map.size + z;

function isRoad(map: TerrainMap, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Road;
}

/** A road cell with 3+ road neighbours. */
export function isJunction(map: TerrainMap, x: number, z: number): boolean {
  if (!isRoad(map, x, z)) return false;
  let k = 0;
  for (let d = 0; d < 4; d++) if (isRoad(map, x + DX[d], z + DZ[d])) k++;
  return k >= 3;
}

/** The junction a sign at (x, z) controls (its one junction neighbour), or null. */
export function signJunction(map: TerrainMap, x: number, z: number): [number, number] | null {
  if (!isRoad(map, x, z) || isJunction(map, x, z)) return null;
  let found: [number, number] | null = null;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d], nz = z + DZ[d];
    if (!isJunction(map, nx, nz)) continue;
    if (found) return null; // between two junctions: ambiguous
    found = [nx, nz];
  }
  return found;
}

/** Why `kind` can't go on (x, z), or null if it can. */
export function controlProblem(map: TerrainMap, x: number, z: number, kind: ControlKind): string | null {
  if (!isRoad(map, x, z)) return 'Csak útra tehető';
  if (map.controls?.has(cellIndex(map, x, z))) return 'Itt már van valami — előbb bontsd le';
  if (kind === 'light' || kind === 'roundabout') {
    if (!isJunction(map, x, z)) return 'Kereszteződésre kell tenni (3–4 irányú)';
    if (hasRailAt(map, x, z)) return 'Vasúti átjáróra nem tehető';
    if (kind === 'roundabout') {
      for (let d = 0; d < 4; d++)
        if (isJunction(map, x + DX[d], z + DZ[d])) return 'A körforgalom mellett nem lehet másik kereszteződés';
    }
    return null;
  }
  if (!signJunction(map, x, z)) return 'Közvetlenül egy kereszteződés elé kell tenni';
  return null;
}

/** The control in effect at (x, z) (validated), or null. */
export function activeControl(map: TerrainMap, x: number, z: number): ControlKind | null {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return null;
  const k = map.controls?.get(cellIndex(map, x, z));
  if (!k) return null;
  if (k === 'light' || k === 'roundabout') return isJunction(map, x, z) ? k : null;
  return signJunction(map, x, z) ? k : null;
}

/** Every valid control: [x, z, kind]. */
export function allControls(map: TerrainMap): Array<[number, number, ControlKind]> {
  const out: Array<[number, number, ControlKind]> = [];
  for (const c of map.controls?.keys() ?? []) {
    const x = Math.floor(c / map.size), z = c % map.size;
    const k = activeControl(map, x, z);
    if (k) out.push([x, z, k]);
  }
  return out;
}

// ---------------------------------------------------------------- lights

/** Light cycle (game seconds): X green, X amber/all red, Z green, Z amber/all red. */
export const LIGHT_GREEN = 6;
export const LIGHT_AMBER = 2;
export const LIGHT_CYCLE = 2 * (LIGHT_GREEN + LIGHT_AMBER);

export type LightState = 'green' | 'amber' | 'red';

/** The light shown to traffic entering along `axis` at time `clock`. */
export function lightState(clock: number, axis: 'x' | 'z'): LightState {
  const t = ((clock % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  const half = LIGHT_GREEN + LIGHT_AMBER;
  const local = axis === 'x' ? t : (t + half) % LIGHT_CYCLE;
  if (local < LIGHT_GREEN) return 'green';
  if (local < half) return 'amber';
  return 'red';
}
