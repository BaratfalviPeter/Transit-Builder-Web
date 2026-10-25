/**
 * Industry interiors — the MICRO view. Every large industry has its own small
 * build grid (INTERIOR_SIZE²) where the player lays out the production:
 * machines (an excavator on ore, a saw, a crusher…) linked by conveyors.
 *
 * The interior meets the macro map at its GATES: wherever a station is docked
 * onto a lot side (see stations.ts), the same edge of the interior grid gets a
 * gate. (Production through the gates is the next step; this module is the
 * layout: catalogue, resource tiles, placement rules.)
 *
 * Pure TypeScript. Grid: tiles (x, z), x → +X (east), z → +Z (south), so the
 * interior's N/S/W/E edges match the lot sides.
 */

import { CellType, type TerrainMap } from './terrain';
import { stationOn, type Side } from './stations';

/** Interior grid edge length (tiles). */
export const INTERIOR_SIZE = 12;

/** What a resource tile holds. */
export type Resource = 'ore' | 'tree' | 'oil';

/** Goods that move through an interior (on belts, through gates). */
export type Item = 'ore' | 'crushed' | 'log' | 'plank' | 'oil' | 'goods';

/** `value`: base delivery price per unit (see transport.ts). */
export const ITEMS: Record<Item, { label: string; icon: string; color: string; value: number }> = {
  ore: { label: 'Érc', icon: '🪨', color: '#4a90c2', value: 10 },
  crushed: { label: 'Zúzott érc', icon: '🧱', color: '#9cc2de', value: 16 },
  log: { label: 'Rönk', icon: '🪵', color: '#7a5233', value: 8 },
  plank: { label: 'Deszka', icon: '🟫', color: '#d6a868', value: 14 },
  oil: { label: 'Olaj', icon: '🛢️', color: '#24262c', value: 20 },
  goods: { label: 'Áru', icon: '📦', color: '#e0782f', value: 30 },
};

/** What each industry takes in through its gates (and pays for on delivery). */
export const ACCEPTS: Partial<Record<CellType, Item[]>> = {
  [CellType.Factory]: ['plank'],
  [CellType.PowerPlant]: ['ore', 'crushed', 'oil'],
};

/** Industry icon (stop labels, line lists). */
export const INDUSTRY_ICON: Partial<Record<CellType, string>> = {
  [CellType.Mine]: '⛏️',
  [CellType.LumberMill]: '🪓',
  [CellType.OilRig]: '🛢️',
  [CellType.Factory]: '⚙️',
  [CellType.PowerPlant]: '⚡',
};

/**
 * What a machine makes. Extractors (no `input`) work faster the more
 * resource tiles they cover: `seconds` is per item for ONE covered tile.
 * A machine with no `output` just consumes (the boiler burns fuel).
 */
export interface Recipe {
  input?: Item | Item[];
  output?: Item;
  seconds: number;
}

export type MachineKind =
  | 'conveyor'
  | 'excavator'
  | 'crusher'
  | 'harvester'
  | 'saw'
  | 'pump'
  | 'tank'
  | 'assembler'
  | 'boiler';

export interface MachineDef {
  kind: MachineKind;
  label: string;
  icon: string;
  /** Footprint in tiles (before rotation; 1×1 or square, so rotation keeps it). */
  size: number;
  cost: number;
  /** Must stand on at least one tile of this resource. */
  needs?: Resource;
  /** Short help shown in the build bar. */
  hint: string;
  /** Production (conveyors just carry). */
  recipe?: Recipe;
}

export const MACHINES: Record<MachineKind, MachineDef> = {
  conveyor: { kind: 'conveyor', label: 'Futószalag', icon: '➡️', size: 1, cost: 10, hint: 'Anyagot szállít a nyíl irányába. Húzással is lerakható.' },
  excavator: { kind: 'excavator', label: 'Ásógép', icon: '⛏️', size: 2, cost: 300, needs: 'ore', hint: 'Ércet bányászik — érclelőhelyre kell tenni.', recipe: { output: 'ore', seconds: 8 } },
  crusher: { kind: 'crusher', label: 'Zúzó', icon: '🪨', size: 2, cost: 400, hint: 'Az ércből zúzott ércet készít.', recipe: { input: 'ore', output: 'crushed', seconds: 1.5 } },
  harvester: { kind: 'harvester', label: 'Favágó', icon: '🪓', size: 2, cost: 250, needs: 'tree', hint: 'Fát vág — fás területre kell tenni.', recipe: { output: 'log', seconds: 8 } },
  saw: { kind: 'saw', label: 'Fűrész', icon: '🪚', size: 2, cost: 350, hint: 'A rönkökből deszkát fűrészel.', recipe: { input: 'log', output: 'plank', seconds: 1.5 } },
  pump: { kind: 'pump', label: 'Szivattyú', icon: '🛢️', size: 1, cost: 350, needs: 'oil', hint: 'Olajat szivattyúz — olajkútra kell tenni.', recipe: { output: 'oil', seconds: 3 } },
  tank: { kind: 'tank', label: 'Tartály', icon: '🛢', size: 2, cost: 200, hint: 'Olajat gyűjt és ad tovább (puffer).', recipe: { input: 'oil', output: 'oil', seconds: 0.3 } },
  assembler: { kind: 'assembler', label: 'Szerelőgép', icon: '⚙️', size: 2, cost: 500, hint: 'Deszkából árut gyárt.', recipe: { input: 'plank', output: 'goods', seconds: 3 } },
  boiler: { kind: 'boiler', label: 'Kazán', icon: '🔥', size: 2, cost: 450, hint: 'Ércet vagy olajat éget (áramot termel).', recipe: { input: ['ore', 'oil'], seconds: 2 } },
};

/** Machines available per industry type (conveyor everywhere). */
export const CATALOGUE: Partial<Record<CellType, MachineKind[]>> = {
  [CellType.Mine]: ['conveyor', 'excavator', 'crusher'],
  [CellType.LumberMill]: ['conveyor', 'harvester', 'saw'],
  [CellType.OilRig]: ['conveyor', 'pump', 'tank'],
  [CellType.Factory]: ['conveyor', 'assembler'],
  [CellType.PowerPlant]: ['conveyor', 'boiler'],
};

export const INDUSTRY_NAME: Partial<Record<CellType, string>> = {
  [CellType.Mine]: 'Bánya',
  [CellType.LumberMill]: 'Fatelep',
  [CellType.OilRig]: 'Olajfúró',
  [CellType.Factory]: 'Gyár',
  [CellType.PowerPlant]: 'Erőmű',
};

/** Rotation: 0 = output towards +X (E), 1 = +Z (S), 2 = −X (W), 3 = −Z (N). */
export type Rot = 0 | 1 | 2 | 3;
export const ROT_DIR: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export interface Machine {
  readonly id: number;
  readonly kind: MachineKind;
  /** Top-left tile of the footprint. */
  readonly x: number;
  readonly z: number;
  readonly rot: Rot;
}

export interface Interior {
  /** Industry anchor cell on the map. */
  readonly anchor: readonly [number, number];
  readonly type: CellType;
  readonly machines: readonly Machine[];
}

export const interiorKey = (anchor: readonly [number, number]) => `${anchor[0]},${anchor[1]}`;

// ---------------------------------------------------------------- resources

/** Small deterministic hash → [0, 1). */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const resourceCache = new Map<string, Array<Resource | null>>();

/**
 * Resource tiles of an industry's interior (index x * INTERIOR_SIZE + z):
 * a few ore patches in a mine, groves in a lumber mill, single oil wells on
 * the rig. Deterministic per anchor, so the same industry always has the
 * same deposits.
 */
export function resourceTiles(type: CellType, anchor: readonly [number, number]): Array<Resource | null> {
  const key = `${type}:${interiorKey(anchor)}`;
  const hit = resourceCache.get(key);
  if (hit) return hit;
  const N = INTERIOR_SIZE;
  const out: Array<Resource | null> = new Array(N * N).fill(null);
  const res: Resource | null = type === CellType.Mine ? 'ore' : type === CellType.LumberMill ? 'tree' : type === CellType.OilRig ? 'oil' : null;
  if (res) {
    const blobs = res === 'oil' ? 4 : 3;
    for (let b = 0; b < blobs; b++) {
      // Keep the outer ring free (gates, conveyors to them).
      const cx = 2 + Math.floor(hash(anchor[0], anchor[1], b * 2 + 1) * (N - 4));
      const cz = 2 + Math.floor(hash(anchor[1], anchor[0], b * 2 + 7) * (N - 4));
      const r = res === 'oil' ? 0.6 : 1.4 + hash(anchor[0], b, 11) * 0.9;
      for (let x = 1; x < N - 1; x++)
        for (let z = 1; z < N - 1; z++) {
          const d = Math.hypot(x - cx, z - cz) + (hash(x, z, anchor[0] + b) - 0.5) * 0.8;
          if (d <= r) out[x * N + z] = res;
        }
    }
  }
  resourceCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- gates

/** Gate tiles on an edge: the two middle tiles of that edge (inside the grid). */
export function gateTiles(side: Side): Array<[number, number]> {
  const N = INTERIOR_SIZE;
  const m = N / 2;
  switch (side) {
    case 'N':
      return [
        [m - 1, 0],
        [m, 0],
      ];
    case 'S':
      return [
        [m - 1, N - 1],
        [m, N - 1],
      ];
    case 'W':
      return [
        [0, m - 1],
        [0, m],
      ];
    case 'E':
      return [
        [N - 1, m - 1],
        [N - 1, m],
      ];
  }
}

/** Sides of this industry that have a station docked (= interior gates). */
export function gatesOf(map: TerrainMap, anchor: readonly [number, number]): Side[] {
  return (['N', 'S', 'W', 'E'] as Side[]).filter((s) => stationOn(map, anchor, s));
}

// ---------------------------------------------------------------- placement

/** Tiles a machine of `kind` would cover at (x, z). */
export function footprint(kind: MachineKind, x: number, z: number): Array<[number, number]> {
  const n = MACHINES[kind].size;
  const out: Array<[number, number]> = [];
  for (let dx = 0; dx < n; dx++) for (let dz = 0; dz < n; dz++) out.push([x + dx, z + dz]);
  return out;
}

/** The machine covering tile (x, z), or null. */
export function machineAt(interior: Interior, x: number, z: number): Machine | null {
  for (const m of interior.machines) {
    const n = MACHINES[m.kind].size;
    if (x >= m.x && x < m.x + n && z >= m.z && z < m.z + n) return m;
  }
  return null;
}

/**
 * Why `kind` can't go at (x, z) — Hungarian, for the UI — or null. Gate
 * tiles take only conveyors (they carry goods through the gate).
 */
export function placementProblem(
  map: TerrainMap,
  interior: Interior,
  kind: MachineKind,
  x: number,
  z: number,
): string | null {
  const N = INTERIOR_SIZE;
  const def = MACHINES[kind];
  const tiles = footprint(kind, x, z);
  if (tiles.some(([a, b]) => a < 0 || b < 0 || a >= N || b >= N)) return 'Kilóg a területről';
  if (tiles.some(([a, b]) => machineAt(interior, a, b))) return 'Foglalt hely';
  const gates = gatesOf(map, interior.anchor).flatMap(gateTiles);
  if (kind !== 'conveyor' && tiles.some(([a, b]) => gates.some(([g, h]) => g === a && h === b)))
    return 'A kapuhoz csak futószalag vezethet';
  if (def.needs) {
    const res = resourceTiles(interior.type, interior.anchor);
    if (!tiles.some(([a, b]) => res[a * N + b] === def.needs)) {
      return def.needs === 'ore' ? 'Érclelőhelyre kell tenni' : def.needs === 'tree' ? 'Fás területre kell tenni' : 'Olajkútra kell tenni';
    }
  }
  return null;
}
