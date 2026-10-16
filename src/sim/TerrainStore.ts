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
  MAX_GEN_LEVEL,
  canBuildRoadAt,
  canBulldoze,
  canClearProps,
  cellKey,
  generateTerrain,
  HILL_STEP,
  SPECIAL_BUILDINGS,
  type GenerateOptions,
  type TerrainMap,
} from './terrain';
import { canAddRailPiece, railBitsAt, roadCrossingAxis } from './railPieces';

type Listener = () => void;

/** Lowest a cell may be dug (in cellSize units) — one step below ground. */
const MIN_HEIGHT = -HILL_STEP;
/** Highest a cell may be raised (one step above the tallest generated peak). */
const MAX_HEIGHT = (MAX_GEN_LEVEL + 1) * HILL_STEP;

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

  /**
   * Build a whole planned ROAD route in ONE commit + ONE emit, so the overlays
   * rebuild once instead of once per cell. Existing road cells are skipped
   * (joined, not rebuilt). A straight rail on the way becomes a level crossing
   * (the cell turns Road, its rail piece stays). Each new cell is checked
   * against the build rules as the route grows. Returns the cells placed.
   */
  buildPath(path: ReadonlyArray<{ x: number; z: number }>): number {
    let cells: CellType[][] | null = null;
    const touched = new Set<number>();
    let placed = 0;
    for (const { x, z } of path) {
      if (!this.inBounds(x, z)) continue;
      const cur = (cells ?? this.map.cells)[x][z];
      if (cur === CellType.Road) continue;
      // Rules see the cells placed so far (slope-connectivity checks).
      const view = cells ? { ...this.map, cells } : this.map;
      const ok = cur === CellType.Rail ? roadCrossingAxis(view, x, z) !== null : canBuildRoadAt(view, x, z);
      if (!ok) continue;
      if (!cells) cells = this.map.cells.slice();
      if (!touched.has(x)) {
        cells[x] = cells[x].slice();
        touched.add(x);
      }
      cells[x][z] = CellType.Road;
      placed++;
    }
    if (!cells || placed === 0) return 0;
    this.roadCount += placed;
    this.commit({ cells }, true);
    this.emit();
    return placed;
  }

  /**
   * Lay a planned RAIL route (a list of track pieces) in one commit. Pieces
   * already on the map are skipped; each new one is checked with
   * `canAddRailPiece` against the pieces laid so far. Empty/Hill cells become
   * Rail; Rail cells gain the piece (switch / crossing); a Road cell gains it
   * as a level crossing. Returns the number of pieces placed.
   */
  buildRailRoute(steps: ReadonlyArray<{ x: number; z: number; piece: number }>): number {
    const size = this.map.size;
    const rails = this.map.rails ? this.map.rails.slice() : new Uint8Array(size * size);
    let cells: CellType[][] | null = null;
    const touched = new Set<number>();
    let placed = 0;
    for (const { x, z, piece } of steps) {
      if (!this.inBounds(x, z)) continue;
      const view: TerrainMap = { ...this.map, cells: cells ?? this.map.cells, rails };
      const bit = 1 << piece;
      if (rails[x * size + z] & bit) continue;
      if (!canAddRailPiece(view, x, z, piece)) continue;
      rails[x * size + z] |= bit;
      const t = view.cells[x][z];
      if (t === CellType.Empty || t === CellType.Hill) {
        if (!cells) cells = this.map.cells.slice();
        if (!touched.has(x)) {
          cells[x] = cells[x].slice();
          touched.add(x);
        }
        cells[x][z] = CellType.Rail;
      }
      placed++;
    }
    if (placed === 0) return 0;
    this.commit(cells ? { cells, rails } : { rails }, true);
    this.emit();
    return placed;
  }

  /**
   * Bulldoze `(x, z)` back to Empty if it holds something removable (road,
   * rail, or forest). Hills, water, city and industry are not bulldozable.
   * Returns true if something was cleared.
   */
  bulldoze(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const current = this.map.cells[x][z];
    const key = cellKey(this.map.size, x, z);
    const cleared = this.map.cleared ?? new Set<number>();

    // Level crossing: the first bulldoze lifts the rails, keeping the road.
    if (current === CellType.Road && railBitsAt(this.map, x, z)) {
      this.commit({ rails: this.withoutRails(x, z) }, true);
      this.emit();
      return true;
    }

    if (canBulldoze(current)) {
      // Road / rail / forest → bare ground, and mark it cleared so no fringe
      // tree or rock pops back onto the freshly cleared cell.
      if (current === CellType.Road) this.roadCount -= 1;
      const next = new Set(cleared);
      next.add(key);
      this.map = { ...this.map, cleared: next };
      // A road/rail on a raised cell goes back to hillside, not flat grass.
      const raised = (current === CellType.Road || current === CellType.Rail) && this.map.heights[x][z] > 0;
      if (current === CellType.Rail) this.map = { ...this.map, rails: this.withoutRails(x, z) };
      this.applyCell(x, z, raised ? CellType.Hill : CellType.Empty);
      this.emit();
      return true;
    }
    if (canClearProps(current) && !cleared.has(key)) {
      // Lone trees / bushes / rocks on grass or mountainside.
      const next = new Set(cleared);
      next.add(key);
      this.commit({ cleared: next }, true);
      this.emit();
      return true;
    }
    // Buildings, city, industry lots and water are not bulldozable.
    return false;
  }

  /** Raise `(x, z)` by one terraform step. Returns true if it changed. */
  raise(x: number, z: number): boolean {
    return this.terraformBatch([{ x, z, delta: +HILL_STEP }]);
  }

  /** Lower `(x, z)` by one terraform step. Returns true if it changed. */
  lower(x: number, z: number): boolean {
    return this.terraformBatch([{ x, z, delta: -HILL_STEP }]);
  }

  /** One terraform step (in cellSize units) up or down. */
  terraformStep(): number {
    return HILL_STEP;
  }

  /**
   * Whether `(x, z)` can be sculpted: in bounds and not under the city, an
   * industry, a road or a rail. Used to validate a selection before building.
   */
  canTerraform(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const t = this.map.cells[x][z];
    return (
      t !== CellType.CityCenter &&
      !SPECIAL_BUILDINGS.has(t) &&
      t !== CellType.IndustryLot && // big-industry (6×6) footprint
      t !== CellType.Road &&
      t !== CellType.Rail
    );
  }

  /**
   * Apply many terraform edits in ONE commit (one geometry update, one emit) —
   * used by the confirmed, batched terraforming flow so a whole selection is
   * applied at once rather than cell-by-cell. Each edit raises/lowers a cell by
   * `delta` (clamped). Water physics is applied per cell after all heights are
   * set. Returns true if anything changed.
   */
  terraformBatch(edits: Array<{ x: number; z: number; delta: number }>): boolean {
    const heights = this.map.heights.map((col) => col.slice());
    const cells = this.map.cells.map((col) => col.slice());
    let changed = false;
    let typeChanged = false;

    // 1) Apply all height deltas first (so adjacency/water sees final heights).
    for (const { x, z, delta } of edits) {
      if (!this.canTerraform(x, z)) continue;
      const cur = heights[x][z];
      const next = clamp(cur + delta, MIN_HEIGHT, MAX_HEIGHT);
      if (next === cur) continue;
      heights[x][z] = next;
      changed = true;
    }
    if (!changed) return false;

    // 2) Resolve cell types from the new heights (water physics).
    for (const { x, z } of edits) {
      if (!this.inBounds(x, z)) continue;
      const h = heights[x][z];
      const before = cells[x][z];
      if (h < 0) {
        cells[x][z] = CellType.Water;
      } else if (h === 0 && this.adjacentToWaterIn(cells, x, z)) {
        cells[x][z] = CellType.Water;
      } else if (before === CellType.Water) {
        cells[x][z] = CellType.Empty;
      } else if (before === CellType.Forest) {
        cells[x][z] = CellType.Empty;
      }
      if (cells[x][z] !== before) typeChanged = true;
    }

    this.commit({ cells, heights }, typeChanged);
    return true;
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

  /** True if any orthogonal neighbour of (x,z) is Water in `cells`. */
  private adjacentToWaterIn(cells: CellType[][], x: number, z: number): boolean {
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
    partial: {
      cells?: CellType[][];
      heights?: number[][];
      cleared?: ReadonlySet<number>;
      rails?: Uint8Array;
    },
    typeChanged: boolean,
  ): void {
    this.map = {
      ...this.map,
      ...partial,
      version: this.map.version + 1,
      cellsVersion: this.map.cellsVersion + (typeChanged ? 1 : 0),
    };
  }

  /** Copy of the rail layer with cell (x, z) cleared. */
  private withoutRails(x: number, z: number): Uint8Array | undefined {
    if (!this.map.rails) return undefined;
    const rails = this.map.rails.slice();
    rails[x * this.map.size + z] = 0;
    return rails;
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
