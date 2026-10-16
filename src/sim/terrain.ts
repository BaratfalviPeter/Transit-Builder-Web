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
  /** Player-built rail. Same build rules as Road (Empty or Hill slope). */
  Rail = 'Rail',
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
  /**
   * A cell occupied by the footprint of a large (3×3) industry, around its
   * center cell. Nothing can be built, sculpted or bulldozed here.
   */
  IndustryLot = 'IndustryLot',
}

/**
 * Special / industrial building types (the CENTER cell of an industry). These
 * get a floating UI icon and are counted as buildings.
 */
export const SPECIAL_BUILDINGS: ReadonlySet<CellType> = new Set([
  CellType.LumberMill,
  CellType.Mine,
  CellType.PowerPlant,
  CellType.Factory,
]);

/** Industries that occupy a 3×3 footprint (center ± 1 cell). */
export const LARGE_INDUSTRY: ReadonlySet<CellType> = new Set([
  CellType.PowerPlant,
  CellType.LumberMill,
  CellType.Mine,
  CellType.Factory,
]);

/**
 * Footprint radius of an industry in cells: 1 for the large 3×3 industries
 * (center ± 1), 0 for single-cell buildings.
 */
export function industryFootprintRadius(type: CellType): number {
  return LARGE_INDUSTRY.has(type) ? 1 : 0;
}

/** Cell types that count as flat, buildable ground for roads. */
export function isFlatGround(cell: CellType): boolean {
  return cell === CellType.Empty;
}

/**
 * Whether a road may be built on the cell currently of type `cell` (type-level
 * check only). Roads can go on Empty ground or on a Hill; the Hill case is
 * further constrained to buildable slopes by `canBuildRoadAt` below. Not on
 * Water, Forest, CityCenter, industry, or an existing Road.
 */
export function canBuildRoad(cell: CellType): boolean {
  return cell === CellType.Empty || cell === CellType.Hill;
}

/**
 * Slope classification of a cell, derived from its four corner heights.
 * (OpenTTD-style.)
 *   - 'flat'    : all four corners equal — flat ground or a flat hilltop.
 *   - 'slopeX'  : a clean, uni-directional ramp along the X axis (E–W).
 *   - 'slopeZ'  : a clean, uni-directional ramp along the Z axis (N–S).
 *   - 'invalid' : a corner piece, a peak, or any multi-directional break.
 */
export type SlopeKind = 'flat' | 'slopeX' | 'slopeZ' | 'invalid';

/** Cell height (in cellSize units), 0 outside the grid. */
function cellHeightAt(map: TerrainMap, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 0;
  return map.heights[x][z];
}

/**
 * Height of a grid CORNER (cx, cz), cx,cz in [0, size]. A corner's height is
 * the max of the up-to-4 cells touching it — the corner-max heightmap that the
 * terrain surface, hill roads, and slope rules all share. In cellSize units.
 */
export function cornerHeightAt(map: TerrainMap, cx: number, cz: number): number {
  return Math.max(
    cellHeightAt(map, cx - 1, cz - 1),
    cellHeightAt(map, cx, cz - 1),
    cellHeightAt(map, cx - 1, cz),
    cellHeightAt(map, cx, cz),
  );
}

/**
 * The four corner heights of cell (x, z), using the corner-max heightmap the
 * renderer uses. Returned as [h00, h10, h11, h01] for corners
 * (x,z),(x+1,z),(x+1,z+1),(x,z+1).
 */
export function cellCornerHeights(
  map: TerrainMap,
  x: number,
  z: number,
): [number, number, number, number] {
  return [
    cornerHeightAt(map, x, z),
    cornerHeightAt(map, x + 1, z),
    cornerHeightAt(map, x + 1, z + 1),
    cornerHeightAt(map, x, z + 1),
  ];
}

/**
 * Classify a cell's slope from its corner heights.
 * Corners: h00=(x,z), h10=(x+1,z), h11=(x+1,z+1), h01=(x,z+1).
 * X axis runs between x and x+1; Z axis between z and z+1.
 */
export function getSlopeKind(map: TerrainMap, x: number, z: number): SlopeKind {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);

  if (h00 === h10 && h10 === h11 && h11 === h01) return 'flat';

  // slopeX: constant along Z, i.e. the two corners at each X match
  // (low edge x, high edge x+1 or vice versa). => h00==h01 and h10==h11.
  if (h00 === h01 && h10 === h11 && h00 !== h10) return 'slopeX';

  // slopeZ: constant along X, i.e. the two corners at each Z match.
  // => h00==h10 and h01==h11.
  if (h00 === h10 && h01 === h11 && h00 !== h01) return 'slopeZ';

  // Anything else is a corner / peak / multi-break => not buildable.
  return 'invalid';
}

/**
 * Full road-build rule at a specific cell: the type must allow a road, and if
 * it's a Hill the slope must be flat or a single straight ramp (not a corner
 * or peak). Flat ground (height 0) is always allowed.
 */
export function canBuildRoadAt(map: TerrainMap, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  if (!canBuildRoad(map.cells[x][z])) return false;
  // Slope rule is driven by the cell's corner heights (which reflect the
  // surrounding terrain), not the cell's nominal center height — so a cell at
  // the foot of a corner ramp is still rejected. Flat, slopeX and slopeZ are
  // buildable; corners / peaks / multi-breaks are not.
  const kind = getSlopeKind(map, x, z);
  if (kind !== 'flat' && kind !== 'slopeX' && kind !== 'slopeZ') return false;
  // The cell itself may rise at most ONE level across it — so a road climbs a
  // hill one step at a time (0->1->2), never a single 2-high cliff/wall.
  if (!cellRiseWithinOneStep(map, x, z)) return false;
  // Max-slope connectivity: the new cell may not connect to an adjacent
  // road/rail that is more than one height level away.
  return connectsWithinSlope(map, x, z, [CellType.Road]);
}

/** Rail follows the same placement rules as road (Empty/Hill, flat or ramp). */
export function canBuildRailAt(map: TerrainMap, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  if (!canBuildRoad(map.cells[x][z])) return false;
  const kind = getSlopeKind(map, x, z);
  if (kind !== 'flat' && kind !== 'slopeX' && kind !== 'slopeZ') return false;
  if (!cellRiseWithinOneStep(map, x, z)) return false;
  return connectsWithinSlope(map, x, z, [CellType.Rail]);
}

/**
 * True if the cell's own corner heights span at most ONE level (HILL_STEP).
 * A flat cell spans 0; a single-step ramp spans one HILL_STEP (buildable); a
 * cell whose corners jump two levels is a steep wall/cliff face — a road laid
 * there would climb two levels in one tile, which we forbid (you must step up
 * one level per cell: 0 -> 1 -> 2).
 */
function cellRiseWithinOneStep(map: TerrainMap, x: number, z: number): boolean {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  const span = Math.max(h00, h10, h11, h01) - Math.min(h00, h10, h11, h01);
  return span <= HILL_STEP + 1e-6;
}

/**
 * Max-slope connectivity rule: a new track (road/rail) must not connect to an
 * orthogonally-adjacent track of the same `trackTypes` whose height differs by
 * more than one level (HILL_STEP). I.e. you can run a track up/down a single
 * ramp step, but you cannot drop a track straight onto the top of a 2-high
 * hill next to a ground-level track. Cells with no adjacent track of that type
 * are always allowed (a fresh segment).
 */
function connectsWithinSlope(
  map: TerrainMap,
  x: number,
  z: number,
  trackTypes: CellType[],
): boolean {
  const h = cellHeightAt(map, x, z);
  // Allow a sub-level of float slack so one HILL_STEP passes but two don't.
  const maxDelta = HILL_STEP + 1e-6;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of dirs) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= map.size || nz >= map.size) continue;
    if (!trackTypes.includes(map.cells[nx][nz])) continue;
    const nh = cellHeightAt(map, nx, nz);
    if (Math.abs(h - nh) > maxDelta) return false; // too steep a connection
  }
  return true;
}

/**
 * Whether the bulldozer may clear this cell back to Empty. The player can
 * remove their own roads and rails, plus natural forest (trees). Hills, water,
 * city center and auto-generated industry are not bulldozable.
 */
export function canBulldoze(cell: CellType): boolean {
  return (
    cell === CellType.Road ||
    cell === CellType.Rail ||
    cell === CellType.Forest
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
   * hill's height), so roads can inherit and render on the slope. Terraforming
   * (raise/lower) edits these at runtime, and may introduce negative values
   * (basins) which become Water.
   */
  readonly heights: number[][];
  /**
   * Bumped on every runtime edit (type OR height). The terrain surface mesh
   * keys on this, since both height and water-type changes alter it.
   */
  readonly version: number;
  /**
   * Bumped ONLY when a cell's TYPE changes (road/rail/industry/forest/water).
   * Overlay renderers (roads, rails, industry, forest, icons) key on this so a
   * pure height edit (terraform) does NOT force them to rebuild their geometry.
   */
  readonly cellsVersion: number;
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

/**
 * Protective buffer (in cells, Chebyshev radius) around the city center in
 * which no hills may spawn — guarantees flat, buildable room to expand.
 */
const CITY_BUFFER = 5;

/**
 * Industry placement tuning.
 *  - INDUSTRY_CITY_GAP: keep industry at least this far (Chebyshev) from the
 *    city center, so it must be connected by road (logistics gameplay).
 *  - INDUSTRY_MIN_SPACING: minimum distance (Chebyshev) between any two placed
 *    industry buildings, so they stay scattered and never clump/stack.
 *  - INDUSTRY_PER_TYPE: how many of each industry type to try to place.
 */
const INDUSTRY_CITY_GAP = 8;
const INDUSTRY_MIN_SPACING = 6;
const INDUSTRY_PER_TYPE = 3;

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

  // --- Pass 1: base terrain (hills, water, city, empty) + heights ---------
  // Trees and buildings are NOT placed here — the ground is generated first.
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

  const base: TerrainMap = {
    size,
    seed,
    cells,
    heights,
    version: 0,
    cellsVersion: 0,
  };

  /**
   * A cell can host a decoration/building only if its slope is a clean flat
   * (all four corners equal) — never a corner/peak/multi-break piece. This is
   * the same corner rule roads use, applied to trees & buildings too, so
   * nothing sits on broken geometry.
   */
  const isFlatCell = (x: number, z: number): boolean => {
    const [h00, h10, h11, h01] = cellCornerHeights(base, x, z);
    return h00 === h10 && h10 === h11 && h11 === h01;
  };

  // --- Pass 2: forests (trees) on top of the terrain ----------------------
  // Trees grow on grass OR on flat hill tops (raised), on moist ground, but
  // never on a sloped corner cell. The cell keeps its height, so hill forests
  // render elevated.
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const t = cells[x][z];
      if (t !== CellType.Empty && t !== CellType.Hill) continue;
      if (distFromCity(x, z) <= cityHalf + 1) continue; // keep city clear
      if (!isFlatCell(x, z)) continue; // corner rule for trees too
      const m = moisture(x * freq * 1.3 + 10, z * freq * 1.3 + 10);
      const d = detail(x * freq * 2.1, z * freq * 2.1);
      if (m > 0.64 && d > 0.42) cells[x][z] = CellType.Forest;
    }
  }

  // --- Pass 3: auto-spawn industry scattered across the map ----------------
  // This is a logistics road-building game, so industry is NOT glued to the
  // city — it spawns anywhere on flat, empty ground (away from the city), as
  // spread out as possible so the player must connect it with roads. Each type
  // keeps a minimum distance from every other placed industry, so nothing
  // tornyosul / clumps together.
  spawnScatteredIndustry(base, rng, isFlatCell, distFromCity);

  return base;

  /** Chebyshev distance (in cells) from the city center. */
  function distFromCity(x: number, z: number): number {
    return Math.max(Math.abs(x - center), Math.abs(z - center));
  }

  /**
   * Discrete hill level (0 = flat, 1, 2, …) from the elevation field, shaped by
   * two constraints so the city never gets walled in:
   *   - Buffer zone: no hills within CITY_BUFFER cells of the city center.
   *   - Expansion corridors: the elevation threshold is raised near the north &
   *     south map edges (low z and high z), drastically lowering hill chance
   *     there, so those two directions stay open for the town to grow.
   * Overall the thresholds are higher than before, making hills rarer and the
   * landscape flatter / more spacious.
   */
  function hillLevel(x: number, z: number): number {
    // Hard buffer: absolutely no hills close to the city.
    if (distFromCity(x, z) <= CITY_BUFFER) return 0;

    const e = elevation(x * freq, z * freq);

    // Keep north/south corridors clear: strongly suppress hills within a band
    // of the top/bottom edges by raising the required elevation there.
    const edgeBand = Math.max(4, Math.floor(size * 0.14));
    const nearNorth = z < edgeBand;
    const nearSouth = z >= size - edgeBand;
    const corridorPenalty = nearNorth || nearSouth ? 0.18 : 0;

    const lvl1 = 0.82 + corridorPenalty; // rarer than before (was 0.78)
    const lvl2 = 0.93 + corridorPenalty; // rarer (was 0.9)

    if (e > lvl2) return 2;
    if (e > lvl1) return 1;
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
    // High elevation => hills (rarer now; see hillLevel threshold).
    if (hillLevel(x, z) > 0) {
      return CellType.Hill;
    }
    // Low elevation + wet => water (kept uncommon).
    const e = elevation(x * freq, z * freq);
    const m = moisture(x * freq * 1.3 + 10, z * freq * 1.3 + 10);
    if (e < 0.3 && m > 0.55) {
      return CellType.Water;
    }

    // Forests are placed in a later pass (so they can sit on hills too).
    return CellType.Empty;
  }
}

/**
 * How close (Chebyshev radius, in cells) an industry must be to its resource.
 * A lumber mill wants trees nearby, a mine wants hills, a power plant wants
 * water. The factory has no resource and may go anywhere.
 */
const RESOURCE_RADIUS = 2;

interface IndustrySpec {
  type: CellType;
  /** Resource the industry wants nearby, or null (factory: anywhere). */
  resource: CellType | null;
}

/** Placement order; resource-bound types first so they claim good spots. */
const INDUSTRY_SPECS: readonly IndustrySpec[] = [
  { type: CellType.LumberMill, resource: CellType.Forest },
  { type: CellType.Mine, resource: CellType.Hill },
  { type: CellType.PowerPlant, resource: CellType.Water },
  { type: CellType.Factory, resource: null },
];

/**
 * Auto-place industry: thematically near its resource (lumber mill by forest,
 * mine by hills, power plant by water) AND scattered — away from the city
 * (>= INDUSTRY_CITY_GAP) and at least INDUSTRY_MIN_SPACING from every other
 * placed industry, so nothing clumps, stacks, or lines up. Deterministic.
 *
 * Per type we gather eligible cells (flat, empty, far from city, and — unless
 * it's the factory — within RESOURCE_RADIUS of the resource), shuffle them,
 * then greedily place up to INDUSTRY_PER_TYPE respecting the global spacing.
 */
function spawnScatteredIndustry(
  map: TerrainMap,
  rng: () => number,
  isFlat: (x: number, z: number) => boolean,
  distFromCity: (x: number, z: number) => number,
): void {
  const { size, cells } = map;

  const placed: Array<[number, number]> = [];
  const farEnough = (x: number, z: number): boolean =>
    placed.every(
      ([px, pz]) =>
        Math.max(Math.abs(px - x), Math.abs(pz - z)) >= INDUSTRY_MIN_SPACING,
    );

  // True if any cell within `radius` (Chebyshev) of (x,z) is of `resource` type.
  const nearResource = (
    x: number,
    z: number,
    resource: CellType,
    radius: number,
  ): boolean => {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (cells[nx][nz] === resource) return true;
      }
    }
    return false;
  };

  /**
   * Whether the whole footprint (center ± r) is free, flat, level ground:
   * every cell in bounds, Empty, flat (all corners equal) and at the same
   * corner height as the center — so a 3×3 industry sits on a level lot.
   */
  const footprintFree = (x: number, z: number, r: number): boolean => {
    const level = cornerHeightAt(map, x, z);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) return false;
        if (cells[nx][nz] !== CellType.Empty) return false;
        if (!isFlat(nx, nz)) return false;
        if (cornerHeightAt(map, nx, nz) !== level) return false;
      }
    }
    return true;
  };

  for (const { type, resource } of INDUSTRY_SPECS) {
    const r = industryFootprintRadius(type);

    // Gather eligible center cells for this industry.
    const candidates: Array<[number, number]> = [];
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (distFromCity(x, z) < INDUSTRY_CITY_GAP + r) continue;
        if (!footprintFree(x, z, r)) continue;
        // The resource must be near the lot's edge, not just its center.
        if (resource !== null && !nearResource(x, z, resource, RESOURCE_RADIUS + r)) {
          continue;
        }
        candidates.push([x, z]);
      }
    }

    // Deterministic Fisher–Yates shuffle.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Greedily place up to N, honoring the global min spacing (which is far
    // larger than a footprint, so lots can never overlap).
    let n = 0;
    for (const [x, z] of candidates) {
      if (n >= INDUSTRY_PER_TYPE) break;
      if (!farEnough(x, z)) continue;
      if (!footprintFree(x, z, r)) continue; // re-check after earlier placements
      // Mark the surrounding footprint as occupied, the center as the industry.
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          cells[x + dx][z + dz] = CellType.IndustryLot;
        }
      }
      cells[x][z] = type;
      placed.push([x, z]);
      n++;
    }
  }
}
