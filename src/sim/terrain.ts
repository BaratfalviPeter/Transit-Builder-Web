/**
 * Terrain model + procedural generation. Pure TypeScript — no React, no Three.
 *
 * The map is a square 2D grid of cells, each carrying a `CellType`. Generation
 * is deterministic given a seed, so the same seed always yields the same map
 * (useful for reproducible gameplay / debugging). The result is a plain data
 * structure that the render layer draws and that future gameplay systems
 * (pathfinding, traffic, economy) can read directly.
 *
 * Coordinates: the grid is indexed by [x][z] with x,z in [0, size). The render
 * layer maps those indices to world positions using `cellSize`.
 */

/** The kind of terrain occupying a single cell. */
export enum CellType {
  Empty = 'Empty',
  CityCenter = 'CityCenter',
  Water = 'Water',
  /** Gentle, ramp-like hill (OpenTTD-style slope). Buildable on top. */
  Hill = 'Hill',
  Forest = 'Forest',
  /** Player-built road. Buildable on Empty ground or on top of a Hill. */
  Road = 'Road',
  /**
   * Auto-generated lumber mill (fatelep). Spawns on Empty cells next to a
   * Forest during map generation; the player cannot place these.
   */
  LumberMill = 'LumberMill',
  /**
   * Auto-generated mine (bánya). Spawns on Empty cells next to a Hill during
   * map generation; the player cannot place these.
   */
  Mine = 'Mine',
  /** Auto-generated power plant (erőmű). Spawns near water for testing. */
  PowerPlant = 'PowerPlant',
  /** Auto-generated factory (gyár). Spawns near the city for testing. */
  Factory = 'Factory',
}

/** Special / industrial building types that get a floating UI icon. */
export const SPECIAL_BUILDINGS: ReadonlySet<CellType> = new Set([
  CellType.LumberMill,
  CellType.Mine,
  CellType.PowerPlant,
  CellType.Factory,
]);

/** Cell types that count as flat, buildable ground for roads. */
export function isFlatGround(cell: CellType): boolean {
  return cell === CellType.Empty;
}

/**
 * Whether a road may be built on the cell currently of type `cell`.
 * Roads can be placed on Empty ground or on top of a Hill (where the road
 * takes the hill's elevation). Not on Water, Forest, CityCenter, auto-spawned
 * industry (LumberMill/Mine), or an existing Road.
 */
export function canBuildRoad(cell: CellType): boolean {
  return cell === CellType.Empty || cell === CellType.Hill;
}

/**
 * Whether the bulldozer may clear this cell back to Empty.
 * Only player-built roads are removable; natural terrain (Hills, Water,
 * Forest, CityCenter) and auto-generated industry (LumberMill, Mine) are not.
 */
export function canBulldoze(cell: CellType): boolean {
  return cell === CellType.Road;
}

/** Full generated map: a size×size grid of cell types plus its parameters. */
export interface TerrainMap {
  readonly size: number;
  readonly seed: number;
  /** Row-major grid: cells[x][z]. */
  readonly cells: CellType[][];
  /**
   * Row-major base elevation per cell, in cellSize units: heights[x][z].
   * Hills have a positive height; everything else is 0. This layer is stable
   * even when a cell's type changes (e.g. a Road built on a Hill keeps the
   * hill's height), so roads can inherit and render on the slope.
   */
  readonly heights: number[][];
}

/**
 * Height added per hill level, in cellSize units. Hills now stack in discrete
 * levels (1, 2, …); a level-N hill's top is at N * HILL_STEP. This is half the
 * previous single-step height (~0.9), so slopes are gentler — a level-2 hill
 * reaches the old level-1 height. The render layer reads the resulting
 * per-cell height directly, so ramps auto-adjust to this flatter scale.
 */
export const HILL_STEP = 0.45;

/** Reference grid size the noise frequency was tuned for. */
const REFERENCE_SIZE = 21;

export interface GenerateOptions {
  /** Grid dimension (size × size). Default 61 (large play area). */
  size?: number;
  /** Deterministic seed. Default: random. */
  seed?: number;
  /** Half-width of the central CityCenter square (2 => 5×5). Default 2. */
  cityHalf?: number;
}

// --- Deterministic PRNG + value noise (no external dependency) --------------

/** Mulberry32 PRNG — small, fast, deterministic for a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothstep interpolation. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * A simple 2D value-noise field. We build a small lattice of random values and
 * bilinearly interpolate between them, giving smooth, blobby regions — enough
 * to cluster water/forest/mountains naturally without a Simplex dependency.
 */
function makeValueNoise(rng: () => number, latticeSize: number) {
  const lattice: number[] = [];
  for (let i = 0; i < latticeSize * latticeSize; i++) lattice.push(rng());

  const at = (ix: number, iz: number): number => {
    const x = ((ix % latticeSize) + latticeSize) % latticeSize;
    const z = ((iz % latticeSize) + latticeSize) % latticeSize;
    return lattice[x * latticeSize + z];
  };

  /** Sample at continuous coords (fx, fz). */
  return (fx: number, fz: number): number => {
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = smooth(fx - x0);
    const tz = smooth(fz - z0);
    const v00 = at(x0, z0);
    const v10 = at(x0 + 1, z0);
    const v01 = at(x0, z0 + 1);
    const v11 = at(x0 + 1, z0 + 1);
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
  };
}

// --- Generation --------------------------------------------------------------

/**
 * Generate a terrain map. The central `cityHalf`-radius square is forced to
 * CityCenter; everything else is assigned from layered noise thresholds, with a
 * guaranteed buffer of Empty around the city so the town has room to grow.
 */
export function generateTerrain(options: GenerateOptions = {}): TerrainMap {
  const size = options.size ?? 61;
  const seed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const cityHalf = options.cityHalf ?? 2;

  const rng = mulberry32(seed);

  // Noise fields. Larger lattices on a larger grid keep feature density sane.
  const elevation = makeValueNoise(rng, 10);
  const moisture = makeValueNoise(rng, 10);
  const detail = makeValueNoise(rng, 20);

  const center = Math.floor(size / 2);
  // Noise frequency is scaled to the reference grid so that biomes stay the
  // same *relative* size as the map grows — i.e. bigger maps get larger,
  // fewer blobs of hills/forest/water rather than fine-grained noise.
  const freq = 0.35 * (REFERENCE_SIZE / size);

  const cells: CellType[][] = [];
  const heights: number[][] = [];
  for (let x = 0; x < size; x++) {
    const col: CellType[] = [];
    const hcol: number[] = [];
    for (let z = 0; z < size; z++) {
      const t = classifyCell(x, z);
      col.push(t);
      hcol.push(t === CellType.Hill ? hillHeight(x, z) : 0);
    }
    cells.push(col);
    heights.push(hcol);
  }

  // Auto-spawn industry next to natural resources (deterministic via `rng`):
  //  - LumberMill on Empty cells adjacent to a Forest.
  //  - Mine on Empty cells adjacent to a Hill.
  //  - PowerPlant on Empty cells adjacent to Water (for testing icons).
  //  - Factory on Empty cells adjacent to the CityCenter (for testing icons).
  spawnIndustry(cells, size, CellType.Forest, CellType.LumberMill, rng);
  spawnIndustry(cells, size, CellType.Hill, CellType.Mine, rng);
  spawnIndustry(cells, size, CellType.Water, CellType.PowerPlant, rng);
  spawnIndustry(cells, size, CellType.CityCenter, CellType.Factory, rng);

  return { size, seed, cells, heights };

  /** Discrete hill level (0 = flat, 1, 2, …) from the elevation field. */
  function hillLevel(x: number, z: number): number {
    const e = elevation(x * freq, z * freq);
    // Rarer hills than before (threshold raised 0.68 -> 0.78) and stacked into
    // levels, so most high ground is a gentle level-1 rise with occasional
    // level-2 peaks.
    if (e > 0.9) return 2;
    if (e > 0.78) return 1;
    return 0;
  }

  /** Per-cell hill height in cellSize units (level * step). */
  function hillHeight(x: number, z: number): number {
    return hillLevel(x, z) * HILL_STEP;
  }

  function classifyCell(x: number, z: number): CellType {
    // 1) Central city square (fixed) — stays at the exact map center.
    if (Math.abs(x - center) <= cityHalf && Math.abs(z - center) <= cityHalf) {
      return CellType.CityCenter;
    }

    // 2) Keep a one-cell ring around the city clear so it isn't walled in.
    if (
      Math.abs(x - center) <= cityHalf + 1 &&
      Math.abs(z - center) <= cityHalf + 1
    ) {
      return CellType.Empty;
    }

    // 3) Noise-based biome classification.
    const m = moisture(x * freq * 1.3 + 10, z * freq * 1.3 + 10);
    const d = detail(x * freq * 2.1, z * freq * 2.1);

    // High elevation => hills (rarer now; see hillLevel threshold).
    if (hillLevel(x, z) > 0) {
      return CellType.Hill;
    }
    // Low elevation + wet => water (kept uncommon).
    const e = elevation(x * freq, z * freq);
    if (e < 0.3 && m > 0.55) {
      return CellType.Water;
    }
    // Mid/high moisture => forest.
    if (m > 0.64 && d > 0.42) {
      return CellType.Forest;
    }

    return CellType.Empty;
  }
}

/** 4-neighbour offsets (N/S/E/W). */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Replace 2–3 random Empty cells that are adjacent to a `resource` cell with
 * `industry`. Mutates `cells` in place. Deterministic given `rng`.
 */
function spawnIndustry(
  cells: CellType[][],
  size: number,
  resource: CellType,
  industry: CellType,
  rng: () => number,
): void {
  // Collect all Empty cells with at least one orthogonal `resource` neighbour.
  const candidates: Array<[number, number]> = [];
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (cells[x][z] !== CellType.Empty) continue;
      const adjacent = NEIGHBORS.some(([dx, dz]) => {
        const nx = x + dx;
        const nz = z + dz;
        return (
          nx >= 0 &&
          nz >= 0 &&
          nx < size &&
          nz < size &&
          cells[nx][nz] === resource
        );
      });
      if (adjacent) candidates.push([x, z]);
    }
  }

  if (candidates.length === 0) return;

  // Shuffle (Fisher–Yates with the deterministic rng) and take 2–3.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const target = 2 + Math.floor(rng() * 2); // 2 or 3
  const count = Math.min(target, candidates.length);
  for (let i = 0; i < count; i++) {
    const [x, z] = candidates[i];
    cells[x][z] = industry;
  }
}
