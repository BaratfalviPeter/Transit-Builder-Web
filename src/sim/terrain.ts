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
  /** Natural ore deposit (terrain feature). */
  Mine = 'Mine',
  /** Player-built road. Buildable on Empty ground or on top of a Hill. */
  Road = 'Road',
  /** Player-built lumberjack (industry). Buildable on Empty ground. */
  Lumberjack = 'Lumberjack',
  /** Player-built mine building (industry). Buildable on Empty ground. */
  MineBuilding = 'MineBuilding',
}

/** Cell types that count as flat, buildable ground for roads. */
export function isFlatGround(cell: CellType): boolean {
  return cell === CellType.Empty;
}

/**
 * Whether a road may be built on the cell currently of type `cell`.
 * Roads can be placed on Empty ground or on top of a Hill (where the road
 * takes the hill's elevation). Not on Water, Forest, Mine, CityCenter,
 * industries, or an existing Road.
 */
export function canBuildRoad(cell: CellType): boolean {
  return cell === CellType.Empty || cell === CellType.Hill;
}

/** Whether a player industry (lumberjack/mine building) may be built here. */
export function canBuildIndustry(cell: CellType): boolean {
  return cell === CellType.Empty;
}

/**
 * Whether the bulldozer may clear this cell back to Empty.
 * Player-built things (Road, Lumberjack, MineBuilding) are removable; natural
 * terrain — Hills, Water, Forest, Mine, CityCenter — is not.
 */
export function canBulldoze(cell: CellType): boolean {
  return (
    cell === CellType.Road ||
    cell === CellType.Lumberjack ||
    cell === CellType.MineBuilding
  );
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

/** Elevation (in cellSize units) assigned to a Hill cell's flat top. */
export const HILL_HEIGHT = 0.9;

export interface GenerateOptions {
  /** Grid dimension (size × size). Default 21. */
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
  const size = options.size ?? 21;
  const seed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const cityHalf = options.cityHalf ?? 2;

  const rng = mulberry32(seed);

  // Two noise fields at different scales: one for the dominant biome mask,
  // one finer field to break up large uniform blobs.
  const elevation = makeValueNoise(rng, 8);
  const moisture = makeValueNoise(rng, 8);
  const detail = makeValueNoise(rng, 16);

  const center = Math.floor(size / 2);
  // How noise lattice coords map onto the grid (bigger => smaller features).
  const freq = 0.35;

  const cells: CellType[][] = [];
  const heights: number[][] = [];
  for (let x = 0; x < size; x++) {
    const col: CellType[] = [];
    const hcol: number[] = [];
    for (let z = 0; z < size; z++) {
      const t = classifyCell(x, z);
      col.push(t);
      hcol.push(t === CellType.Hill ? HILL_HEIGHT : 0);
    }
    cells.push(col);
    heights.push(hcol);
  }

  return { size, seed, cells, heights };

  function classifyCell(x: number, z: number): CellType {
    // 1) Central city square (fixed).
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
    const e = elevation(x * freq, z * freq);
    const m = moisture(x * freq * 1.3 + 10, z * freq * 1.3 + 10);
    const d = detail(x * freq * 2.1, z * freq * 2.1);

    // High elevation => hills (with a sprinkling of ore mines in the peaks).
    if (e > 0.68) {
      return d > 0.72 ? CellType.Mine : CellType.Hill;
    }
    // Low elevation + wet => water.
    if (e < 0.34 && m > 0.5) {
      return CellType.Water;
    }
    // Mid/high moisture => forest.
    if (m > 0.62 && d > 0.4) {
      return CellType.Forest;
    }
    // Occasional lone mines on buildable ground (ore deposits).
    if (d > 0.9) {
      return CellType.Mine;
    }

    return CellType.Empty;
  }
}
