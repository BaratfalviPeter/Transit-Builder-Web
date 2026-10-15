/**
 * TerrainStore — a mutable, observable wrapper around a generated TerrainMap.
 *
 * Pure TypeScript (no React/Three). It owns the authoritative grid and exposes
 * imperative mutations (currently: build a road). A cached, immutable snapshot
 * is published on every change so React consumers get a stable reference
 * between mutations (safe for useSyncExternalStore).
 *
 * Grid indexing matches `generateTerrain`: cells[x][z], x,z in [0, size).
 */

import {
  CellType,
  canBuildRailAt,
  canBuildRoadAt,
  canBulldoze,
  generateTerrain,
  HILL_STEP,
  SPECIAL_BUILDINGS,
  type GenerateOptions,
  type TerrainMap,
} from './terrain';

type Listener = () => void;

/** Lowest a cell may be dug (in cellSize units) — one step below ground. */
const MIN_HEIGHT = -HILL_STEP;
/** Highest a cell may be raised. */
const MAX_HEIGHT = 3 * HILL_STEP;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class TerrainStore {
  private map: TerrainMap;
  private readonly listeners = new Set<Listener>();
  private roadCount = 0;
  private industryCount = 0;

  constructor(options: GenerateOptions = {}) {
    this.map = generateTerrain(options);
    // Count the special buildings placed by the auto-spawn pass at gen time.
    this.industryCount = this.countSpecialBuildings();
  }

  /** Current immutable map snapshot (stable until the next mutation). */
  getMap(): TerrainMap {
    return this.map;
  }

  /** Number of Road cells currently on the map. */
  getRoadCount(): number {
    return this.roadCount;
  }

  /**
   * Number of auto-generated special buildings (lumber mills, mines, power
   * plants, factories).
   */
  getIndustryCount(): number {
    return this.industryCount;
  }

  /** True if `(x, z)` is in bounds. */
  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.map.size && z < this.map.size;
  }

  /** The cell type at `(x, z)`, or null if out of bounds. */
  cellAt(x: number, z: number): CellType | null {
    if (!this.inBounds(x, z)) return null;
    return this.map.cells[x][z];
  }

  /**
   * Build a road on `(x, z)` if the rules allow it: Empty ground, or a Hill
   * cell whose slope is flat or a single straight ramp (OpenTTD-style — corner
   * and peak cells are rejected). Returns true if a road was placed; the cell's
   * height is preserved so a road on a hill keeps the hill's elevation.
   */
  buildRoad(x: number, z: number): boolean {
    if (!canBuildRoadAt(this.map, x, z)) return false;

    this.applyCell(x, z, CellType.Road);
    this.roadCount += 1;
    this.emit();
    return true;
  }

  /** Build rail on `(x, z)` — same placement rules as a road. */
  buildRail(x: number, z: number): boolean {
    if (!canBuildRailAt(this.map, x, z)) return false;
    this.applyCell(x, z, CellType.Rail);
    this.emit();
    return true;
  }

  /**
   * Bulldoze `(x, z)` back to Empty if it holds something removable (road,
   * rail, or forest). Hills, water, city and industry are not bulldozable.
   * Returns true if something was cleared.
   */
  bulldoze(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const current = this.map.cells[x][z];
    if (!canBulldoze(current)) return false;

    if (current === CellType.Road) this.roadCount -= 1;
    this.applyCell(x, z, CellType.Empty);
    this.emit();
    return true;
  }

  /** Raise `(x, z)` by one terraform step. Returns true if it changed. */
  raise(x: number, z: number): boolean {
    return this.terraform(x, z, +HILL_STEP);
  }

  /** Lower `(x, z)` by one terraform step. Returns true if it changed. */
  lower(x: number, z: number): boolean {
    return this.terraform(x, z, -HILL_STEP);
  }

  /**
   * Replace the whole map (e.g. regenerate with a new seed). Resets derived
   * counts.
   */
  regenerate(options: GenerateOptions = {}): void {
    this.map = generateTerrain(options);
    this.roadCount = this.countType(CellType.Road);
    this.industryCount = this.countSpecialBuildings();
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Terraform `(x, z)` by `delta` (±HILL_STEP), clamped to [MIN, MAX]. Updates
   * the cell's height AND applies water physics:
   *   - If the cell is lowered to ground level or below (height <= 0) it
   *     becomes Water.
   *   - Flood fill: any lowered-to-ground cell that is orthogonally adjacent to
   *     existing Water also floods (becomes Water), cascading outward.
   *   - Raising a Water cell back above ground turns it to Empty.
   * Only player terrain is terraformable (not city/industry). Returns true if
   * anything changed. Batches cell + height edits into one new map + one emit.
   */
  private terraform(x: number, z: number, delta: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const t = this.map.cells[x][z];
    // Don't let the player sculpt under the city or industry footprints.
    if (
      t === CellType.CityCenter ||
      SPECIAL_BUILDINGS.has(t) ||
      t === CellType.Road ||
      t === CellType.Rail
    ) {
      return false;
    }

    const cur = this.map.heights[x][z];
    const next = clamp(cur + delta, MIN_HEIGHT, MAX_HEIGHT);
    if (next === cur) return false;

    // Working copies (immutable update of the touched columns).
    const heights = this.map.heights.map((col) => col.slice());
    const cells = this.map.cells.map((col) => col.slice());

    heights[x][z] = next;

    // Water physics.
    const before = cells[x][z];
    if (next < 0) {
      // Dug BELOW ground level -> a basin that fills with water.
      cells[x][z] = CellType.Water;
    } else if (next === 0 && this.adjacentToWater(cells, x, z)) {
      // Lowered back to exactly ground level next to existing water -> the
      // water pours in and floods this cell too.
      cells[x][z] = CellType.Water;
    } else if (cells[x][z] === CellType.Water) {
      // Raised a former water cell back above ground -> dry land.
      cells[x][z] = CellType.Empty;
    } else if (cells[x][z] === CellType.Forest) {
      // Terraforming clears trees off the sculpted cell.
      cells[x][z] = CellType.Empty;
    }

    // A pure height change doesn't touch cell TYPES; only bump cellsVersion if
    // the type actually changed (water appeared/disappeared, tree cleared), so
    // overlay renderers don't rebuild on ordinary raise/lower.
    const typeChanged = cells[x][z] !== before;
    this.commit({ cells, heights }, typeChanged);
    return true;
  }

  /** True if any orthogonal neighbour of (x,z) is Water. */
  private adjacentToWater(cells: CellType[][], x: number, z: number): boolean {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    return dirs.some(([dx, dz]) => {
      const nx = x + dx;
      const nz = z + dz;
      return this.inBounds(nx, nz) && cells[nx][nz] === CellType.Water;
    });
  }

  /**
   * Immutably update one cell type: copy the touched column so the overall
   * `cells` reference changes, bump `version`. `heights` is shared (unchanged),
   * so elevation survives type changes.
   */
  private applyCell(x: number, z: number, type: CellType): void {
    const cells = this.map.cells.slice();
    const col = cells[x].slice();
    col[z] = type;
    cells[x] = col;
    this.commit({ cells }, true); // a cell type changed
  }

  /**
   * Commit new cells/heights into a fresh map object. `version` always bumps
   * (the terrain surface rebuilds on any edit). `cellsVersion` bumps only when
   * a cell TYPE changed, so overlay renderers (roads/rail/industry/forest)
   * skip their geometry rebuild on pure height edits.
   */
  private commit(
    partial: { cells?: CellType[][]; heights?: number[][] },
    typeChanged: boolean,
  ): void {
    this.map = {
      ...this.map,
      ...partial,
      version: this.map.version + 1,
      cellsVersion: this.map.cellsVersion + (typeChanged ? 1 : 0),
    };
  }

  private countType(type: CellType): number {
    let n = 0;
    for (let x = 0; x < this.map.size; x++) {
      for (let z = 0; z < this.map.size; z++) {
        if (this.map.cells[x][z] === type) n++;
      }
    }
    return n;
  }

  private countSpecialBuildings(): number {
    let n = 0;
    for (let x = 0; x < this.map.size; x++) {
      for (let z = 0; z < this.map.size; z++) {
        if (SPECIAL_BUILDINGS.has(this.map.cells[x][z])) n++;
      }
    }
    return n;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
