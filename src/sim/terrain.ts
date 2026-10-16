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

/** Industries that occupy a large INDUSTRY_LOT_SIZE² footprint (6×6). */
export const LARGE_INDUSTRY: ReadonlySet<CellType> = new Set([
  CellType.PowerPlant,
  CellType.LumberMill,
  CellType.Mine,
  CellType.Factory,
]);

/** Edge length (in cells) of a large industry's square lot. */
export const INDUSTRY_LOT_SIZE = 6;

/**
 * Footprint of an industry as offsets from its anchor cell: the lot covers
 * anchor + [lo, hi] on both axes. A 6×6 lot has no single centre cell, so the
 * anchor (the cell holding the industry type) is the top-left of the middle
 * four: offsets −2…+3. Its true centre is half a cell past the anchor in X/Z.
 * Small industries are a single cell (0…0).
 */
export function industryFootprint(type: CellType): { lo: number; hi: number } {
  if (!LARGE_INDUSTRY.has(type)) return { lo: 0, hi: 0 };
  const lo = -Math.floor((INDUSTRY_LOT_SIZE - 1) / 2);
  return { lo, hi: lo + INDUSTRY_LOT_SIZE - 1 };
}

/**
 * Offset (in cells) from a large industry's anchor cell to the centre of its
 * lot — 0.5 for an even lot size, 0 for odd.
 */
export const INDUSTRY_CENTER_OFFSET = INDUSTRY_LOT_SIZE % 2 === 0 ? 0.5 : 0;

/** Model scale factor: models are built for a 3×3 lot. */
export const INDUSTRY_MODEL_SCALE = INDUSTRY_LOT_SIZE / 3;

/**
 * If (x, z) is part of a large industry's lot, return that industry's anchor
 * cell, else null.
 */
export function industryAnchorOf(map: TerrainMap, x: number, z: number): [number, number] | null {
  const t = map.cells[x][z];
  if (LARGE_INDUSTRY.has(t)) return [x, z];
  if (t !== CellType.IndustryLot) return null;
  const lo = -Math.floor((INDUSTRY_LOT_SIZE - 1) / 2);
  const hi = lo + INDUSTRY_LOT_SIZE - 1;
  // anchor + lo <= x <= anchor + hi  ⇔  x − hi <= anchor <= x − lo
  for (let ax = x - hi; ax <= x - lo; ax++)
    for (let az = z - hi; az <= z - lo; az++) {
      if (ax < 0 || az < 0 || ax >= map.size || az >= map.size) continue;
      if (LARGE_INDUSTRY.has(map.cells[ax][az])) return [ax, az];
    }
  return null;
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
export function cellRiseWithinOneStep(map: TerrainMap, x: number, z: number): boolean {
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

/**
 * Whether the bulldozer may clear the loose scenery (lone trees, bushes,
 * rocks) on this cell. Only open ground carries such props — Empty grass and
 * Hill/mountain cells. Buildings, city, industry lots and water: never.
 */
export function canClearProps(cell: CellType): boolean {
  return cell === CellType.Empty || cell === CellType.Hill;
}

/** Key of a cell in `TerrainMap.cleared`. */
export function cellKey(size: number, x: number, z: number): number {
  return x * size + z;
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
   * Cells whose loose scenery (trees, bushes, rocks) the player bulldozed.
   * The props are derived from the map at render time, so this set is what
   * keeps a cleared cell clear. Keys: `cellKey(size, x, z)`.
   */
  readonly cleared?: ReadonlySet<number>;
  /**
   * The rail network as smooth centre-lines (see `railNet.ts`). Cells under a
   * track are CellType.Rail (or Road at a level crossing). Undefined = none.
   */
  readonly railNet?: import('./railNet').RailNet;
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

/** Highest level the generator creates (mountain peaks). */
export const MAX_GEN_LEVEL = 13;

/** Highest level forests grow on (the treeline). */
export const TREELINE_LEVEL = 4;

/** Above this level mountain flanks may rise 2 levels per cell (rocky, unbuildable). */
export const STEEP_FROM_LEVEL = 3;

/** Reference grid size the noise frequency was tuned for. */
const REFERENCE_SIZE = 21;

/**
 * Grid subdivision factor. The map keeps its PHYSICAL size, but every former
 * cell is now split into GRID_SCALE × GRID_SCALE finer cells (2 → each old cell
 * becomes 4). All generation distances that are measured in cells (city size,
 * buffers, industry spacing, resource radius) are multiplied by this so the
 * physical layout stays the same; only the resolution gets finer. Noise
 * frequency already scales with map size, so biomes keep their physical size.
 */
export const GRID_SCALE = 2;

/** Default map size: (61 − 1) · GRID_SCALE + 1 = 121 (odd keeps a centre cell). */
export const DEFAULT_MAP_SIZE = 60 * GRID_SCALE + 1;

/**
 * Protective buffer (in cells, Chebyshev radius) around the city center in
 * which no hills may spawn — guarantees flat, buildable room to expand.
 */
const CITY_BUFFER = 5 * GRID_SCALE;

/**
 * Industry placement tuning.
 *  - INDUSTRY_CITY_GAP: keep industry at least this far (Chebyshev) from the
 *    city center, so it must be connected by road (logistics gameplay).
 *  - INDUSTRY_MIN_SPACING: minimum distance (Chebyshev) between any two placed
 *    industry buildings, so they stay scattered and never clump/stack.
 *  - INDUSTRY_PER_TYPE: how many of each industry type to try to place.
 */
const INDUSTRY_CITY_GAP = 8 * GRID_SCALE;
const INDUSTRY_MIN_SPACING = 7 * GRID_SCALE; // > lot size, so lots never touch
const INDUSTRY_PER_TYPE = 3;

export interface GenerateOptions {
  /** Grid dimension (size × size). Default DEFAULT_MAP_SIZE (121). */
  size?: number;
  /** Deterministic seed. Default: random. */
  seed?: number;
  /** Half-width of the central CityCenter square. Default 2·GRID_SCALE+1 (=5 → 11×11, ≈ the old 5×5 physically). */
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
  const size = options.size ?? DEFAULT_MAP_SIZE;
  const seed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const cityHalf = options.cityHalf ?? 2 * GRID_SCALE + 1;

  const rng = mulberry32(seed);

  // Noise fields. Larger lattices on a larger grid keep feature density sane.
  const elevation = makeValueNoise(rng, 10);
  const moisture = makeValueNoise(rng, 10);
  const detail = makeValueNoise(rng, 20);
  // Ridge noise roughens the peaks so they aren't perfect cones.
  const ridges = makeValueNoise(rng, 14);

  const center = Math.floor(size / 2);
  // Noise frequency is scaled to the reference grid so that biomes stay the
  // same *relative* size as the map grows — i.e. bigger maps get larger,
  // fewer blobs of hills/forest/water rather than fine-grained noise.
  const freq = 0.35 * (REFERENCE_SIZE / size);

  // --- Pass 0: discrete height levels (rolling hills + mountain ranges) ----
  // Levels are smoothed so neighbouring cells differ by at most ONE level:
  // mountains become stepped, OpenTTD-style terraced cones that roads can
  // climb one level per cell (switchbacks), never sheer multi-level walls.
  const peaks = placePeaks();
  const levels = computeLevels();

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
      hcol.push(t === CellType.Hill ? levels[x][z] * HILL_STEP : 0);
    }
    cells.push(col);
    heights.push(hcol);
  }

  // --- Pass 1b: rivers ------------------------------------------------------
  // A couple of meandering rivers wind across the lowlands, joining lakes and
  // running off the map edge. They only cut through flat ground (never
  // mountains or the city), so the land stays connected by bridges-to-be.
  carveRivers(cells, heights, levels);

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
      if (levels[x][z] > TREELINE_LEVEL) continue; // no forest above the treeline
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
   * A few isolated, steep, pointy mountains — scenery more than terrain to
   * build on. Each is a (slightly elliptical, noise-roughened) cone with a
   * short gentle foothill skirt; some get a smaller twin peak beside them.
   */
  function placePeaks(): Array<{ x: number; z: number; h: number; ang: number; stretch: number }> {
    const out: Array<{ x: number; z: number; h: number; ang: number; stretch: number }> = [];
    const edgeBand = Math.max(4, Math.floor(size * 0.14));
    const want = 3 + Math.floor(rng() * 4); // 3–6 mountains
    for (let tries = 0; tries < 400 && out.length < want; tries++) {
      const x = 8 + Math.floor(rng() * (size - 16));
      const z = edgeBand + Math.floor(rng() * (size - edgeBand * 2));
      if (distFromCity(x, z) < CITY_BUFFER + 16) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 24)) continue;
      const h = 9 + Math.floor(rng() * (MAX_GEN_LEVEL - 8));
      out.push({ x, z, h, ang: rng() * Math.PI, stretch: 0.75 + rng() * 0.5 });
      if (rng() < 0.4) {
        const a = rng() * Math.PI * 2;
        out.push({
          x: Math.round(x + Math.cos(a) * 5),
          z: Math.round(z + Math.sin(a) * 5),
          h: Math.max(6, h - 3 - Math.floor(rng() * 3)),
          ang: rng() * Math.PI,
          stretch: 0.8 + rng() * 0.4,
        });
      }
    }
    return out;
  }

  /** Level contributed by the peaks at (x, z). */
  function peakLevel(x: number, z: number): number {
    let best = 0;
    for (const p of peaks) {
      const dx = x - p.x;
      const dz = z - p.z;
      const ca = Math.cos(p.ang);
      const sa = Math.sin(p.ang);
      const u = (dx * ca + dz * sa) * p.stretch;
      const v = (-dx * sa + dz * ca) / p.stretch;
      const d = Math.hypot(u, v);
      // Steep cone (1.35 levels/cell — ≤2 even diagonally, so the slope rule
      // keeps the full height) down to level 3, then a short gentle skirt.
      const d3 = (p.h - 3) / 1.35;
      let lvl = d <= d3 ? p.h - d * 1.35 : 3 - (d - d3) * 0.7;
      // Rough, rocky crests near the top.
      if (d <= d3) lvl += (ridges(x * 0.35, z * 0.35) - 0.5) * 1.6;
      best = Math.max(best, lvl);
    }
    return Math.max(0, Math.min(MAX_GEN_LEVEL, Math.floor(best)));
  }

  /** Raw (unsmoothed) level: old rolling hills + the isolated peaks. */
  function rawLevel(x: number, z: number): number {
    if (distFromCity(x, z) <= CITY_BUFFER) return 0;
    const lvl = Math.max(hillLevel(x, z), peakLevel(x, z));
    // Keep a soft ramp-up away from the city so it is never walled in.
    const dc = distFromCity(x, z) - CITY_BUFFER;
    return Math.min(lvl, Math.max(0, Math.floor(dc)));
  }

  /**
   * Levels grid with the slope rule enforced (iterative erosion): at most one
   * level between neighbours in the foothills, two on the upper flanks.
   */
  function computeLevels(): number[][] {
    const L: number[][] = [];
    for (let x = 0; x < size; x++) {
      const col: number[] = [];
      for (let z = 0; z < size; z++) col.push(rawLevel(x, z));
      L.push(col);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          let lo = L[x][z];
          for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++) {
              const nx = x + dx;
              const nz = z + dz;
              if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
              // Foothills climb one level per cell (roads can follow); higher
              // up the flanks may rise two per cell → steep rocky slopes.
              lo = Math.min(lo, L[nx][nz] + (L[nx][nz] >= STEEP_FROM_LEVEL ? 2 : 1));
            }
          if (lo < L[x][z]) {
            L[x][z] = lo;
            changed = true;
          }
        }
      }
    }
    return L;
  }

  /** Meandering rivers through the lowlands (see Pass 1b). */
  function carveRivers(cellsG: CellType[][], heightsG: number[][], L: number[][]): void {
    const rivers = 2;
    for (let r = 0; r < rivers; r++) {
      // Start on a random edge, heading inward.
      const side = Math.floor(rng() * 4);
      const along = Math.floor(size * (0.2 + rng() * 0.6));
      let px = side === 0 ? 0 : side === 1 ? size - 1 : along;
      let pz = side === 2 ? 0 : side === 3 ? size - 1 : along;
      let ang =
        side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      ang += (rng() - 0.5) * 0.8;
      const width = 1 + (rng() < 0.5 ? 1 : 0);
      let fx = px;
      let fz = pz;
      for (let step = 0; step < size * 3; step++) {
        // Meander: slowly drifting heading, steered off mountains.
        ang += (detail(fx * 0.09 + r * 13, fz * 0.09) - 0.5) * 0.5;
        let best = ang;
        let bestCost = Infinity;
        for (const da of [-0.6, -0.3, 0, 0.3, 0.6]) {
          const a = ang + da;
          const tx = Math.round(fx + Math.cos(a) * 2);
          const tz = Math.round(fz + Math.sin(a) * 2);
          if (tx < 0 || tz < 0 || tx >= size || tz >= size) {
            if (da === 0) bestCost = -1; // allow running off the map edge
            continue;
          }
          const cost =
            L[tx][tz] * 10 + Math.abs(da) * 0.5 + (distFromCity(tx, tz) <= CITY_BUFFER + 2 ? 50 : 0);
          if (cost < bestCost) {
            bestCost = cost;
            best = a;
          }
        }
        ang = best;
        fx += Math.cos(ang);
        fz += Math.sin(ang);
        px = Math.round(fx);
        pz = Math.round(fz);
        if (px < 0 || pz < 0 || px >= size || pz >= size) break;
        for (let wx = 0; wx < width + 1; wx++)
          for (let wz = 0; wz < width + 1; wz++) {
            const cx = px + wx - (width >> 1);
            const cz = pz + wz - (width >> 1);
            if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
            if (L[cx][cz] !== 0) continue;
            if (distFromCity(cx, cz) <= cityHalf + 3) continue;
            cellsG[cx][cz] = CellType.Water;
            heightsG[cx][cz] = 0;
          }
        // Stop once we've run long enough and reached a lake.
        if (step > size * 0.6 && cellsG[px][pz] === CellType.Water && lakeAround(px, pz)) break;
      }
    }
    function lakeAround(x: number, z: number): boolean {
      let n = 0;
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < size && nz < size && cellsG[nx][nz] === CellType.Water) n++;
        }
      return n > 35;
    }
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
    // Any raised level => hill / mountain.
    if (levels[x][z] > 0) {
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
const RESOURCE_RADIUS = 2 * GRID_SCALE;

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
   * Whether the whole footprint (anchor + [lo, hi]) is free, flat, level
   * ground: every cell in bounds, Empty, flat (all corners equal) and at the
   * same corner height as the anchor — so a big industry sits on a level lot.
   */
  const footprintFree = (x: number, z: number, lo: number, hi: number): boolean => {
    const level = cornerHeightAt(map, x, z);
    for (let dx = lo; dx <= hi; dx++) {
      for (let dz = lo; dz <= hi; dz++) {
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
    const { lo, hi } = industryFootprint(type);
    const r = Math.max(-lo, hi); // reach of the lot from its anchor

    // Gather eligible center cells for this industry.
    const candidates: Array<[number, number]> = [];
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (distFromCity(x, z) < INDUSTRY_CITY_GAP + r) continue;
        if (!footprintFree(x, z, lo, hi)) continue;
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
      if (!footprintFree(x, z, lo, hi)) continue; // re-check after earlier placements
      // Mark the surrounding footprint as occupied, the center as the industry.
      for (let dx = lo; dx <= hi; dx++) {
        for (let dz = lo; dz <= hi; dz++) {
          cells[x + dx][z + dz] = CellType.IndustryLot;
        }
      }
      cells[x][z] = type;
      placed.push([x, z]);
      n++;
    }
  }
}
