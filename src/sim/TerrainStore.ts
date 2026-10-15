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
  canBuildIndustry,
  canBuildRoad,
  canBulldoze,
  generateTerrain,
  type GenerateOptions,
  type TerrainMap,
} from './terrain';

type Listener = () => void;

export class TerrainStore {
  private map: TerrainMap;
  private readonly listeners = new Set<Listener>();
  private roadCount = 0;
  private industryCount = 0;

  constructor(options: GenerateOptions = {}) {
    this.map = generateTerrain(options);
  }

  /** Current immutable map snapshot (stable until the next mutation). */
  getMap(): TerrainMap {
    return this.map;
  }

  /** Number of Road cells currently on the map. */
  getRoadCount(): number {
    return this.roadCount;
  }

  /** Number of player-built industry cells (lumberjack + mine building). */
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
   * Build a road on `(x, z)` if the rules allow it (Empty ground or on top of
   * a Hill). Returns true if a road was placed. The cell's height is preserved,
   * so a road on a hill keeps the hill's elevation.
   */
  buildRoad(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    if (!canBuildRoad(this.map.cells[x][z])) return false;

    this.applyCell(x, z, CellType.Road);
    this.roadCount += 1;
    this.emit();
    return true;
  }

  /**
   * Build a player industry (lumberjack or mine building) on Empty ground.
   * `type` must be CellType.Lumberjack or CellType.MineBuilding.
   */
  buildIndustry(x: number, z: number, type: CellType): boolean {
    if (!this.inBounds(x, z)) return false;
    if (type !== CellType.Lumberjack && type !== CellType.MineBuilding) {
      return false;
    }
    if (!canBuildIndustry(this.map.cells[x][z])) return false;

    this.applyCell(x, z, type);
    this.industryCount += 1;
    this.emit();
    return true;
  }

  /**
   * Bulldoze `(x, z)` back to Empty if it holds a player-built thing (Road,
   * Lumberjack, MineBuilding). Natural terrain (Hills, Water, Forest, Mine,
   * CityCenter) cannot be bulldozed. Returns true if something was cleared.
   */
  bulldoze(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const current = this.map.cells[x][z];
    if (!canBulldoze(current)) return false;

    if (current === CellType.Road) this.roadCount -= 1;
    else this.industryCount -= 1;

    this.applyCell(x, z, CellType.Empty);
    this.emit();
    return true;
  }

  /**
   * Replace the whole map (e.g. regenerate with a new seed). Resets derived
   * counts.
   */
  regenerate(options: GenerateOptions = {}): void {
    this.map = generateTerrain(options);
    this.roadCount = this.countType(CellType.Road);
    this.industryCount =
      this.countType(CellType.Lumberjack) +
      this.countType(CellType.MineBuilding);
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Immutably update one cell: copy the touched column so the overall `cells`
   * reference changes (new TerrainMap object), which lets React detect the
   * change while unmodified columns keep their identity.
   */
  private applyCell(x: number, z: number, type: CellType): void {
    const cells = this.map.cells.slice();
    const col = cells[x].slice();
    col[z] = type;
    cells[x] = col;
    // `heights` is intentionally preserved (shared reference) so elevation
    // survives type changes — a Road built on a Hill keeps the hill height.
    this.map = { ...this.map, cells };
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

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
