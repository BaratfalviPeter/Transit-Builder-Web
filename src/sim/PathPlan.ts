/**
 * PathPlan — state of the two-click (Point A → Point B) road/rail planner.
 *
 * Pure TypeScript, observable (same pattern as TerraformPlan):
 *   - `pathbuildingState`: 'idle' (waiting for the first click) or
 *     'selecting_end' (A is fixed, the route follows the cursor);
 *   - `startNode`: the A cell;
 *   - `previewPath`: the current A* route from A to the hovered cell — drawn
 *     as the green (or red, if `blocked`) hologram.
 *
 * The store only holds state; pathfinding runs in `PathPlan.preview` via
 * `findTrackPath`, and the actual building is done by the canvas (TerrainStore
 * + GameState).
 */

import { cellsToBuild, findTrackPath, isTrackPassable, type GridCell, type TrackType } from './pathfind';
import { canHostRail, otherSide, pieceHeading, PIECE_SIDES, SIDE_DX, SIDE_DZ } from './railPieces';
import { findRailPath } from './railPath';
import { CellType, type TerrainMap } from './terrain';

/** A route cell; rail routes also carry the track piece laid in it. */
export interface PlanStep extends GridCell {
  piece?: number;
  isNew?: boolean;
}

/** Can a route of `type` start on this cell? */
export function canStartRoute(map: TerrainMap, c: GridCell, type: TrackType): boolean {
  return type === CellType.Rail ? canHostRail(map, c.x, c.z) : isTrackPassable(map, c.x, c.z, type);
}

/** Short Hungarian labels of the 8 rail headings (0 = E, counter-clockwise). */
export const HEADING_LABELS = ['K', 'ÉK', 'É', 'ÉNy', 'Ny', 'DNy', 'D', 'DK'];

/** Heading (0..7) a rail route leaves its first cell with, or null. */
function firstHeading(path: PlanStep[]): number | null {
  const a = path[0];
  if (!a || a.piece === undefined) return null;
  const b = path[1];
  let exit: number = PIECE_SIDES[a.piece][1];
  if (b) for (const sd of PIECE_SIDES[a.piece]) if (a.x + SIDE_DX[sd] === b.x && a.z + SIDE_DZ[sd] === b.z) exit = sd;
  return pieceHeading(a.piece, otherSide(a.piece, exit));
}

function route(map: TerrainMap, start: GridCell, goal: GridCell, type: TrackType, startHeading: number | null) {
  if (type === CellType.Rail) {
    const { steps, blocked } = findRailPath(map, start, goal, startHeading);
    return { path: steps as PlanStep[], blocked, newCells: steps.filter((s) => s.isNew).length };
  }
  const { path, blocked } = findTrackPath(map, start, goal, type);
  return { path: path as PlanStep[], blocked, newCells: cellsToBuild(map, path, type).length };
}

export type PathBuildingState = 'idle' | 'selecting_end';

export interface PathPlanSnapshot {
  pathbuildingState: PathBuildingState;
  startNode: GridCell | null;
  previewPath: PlanStep[];
  /** Track type being planned. */
  type: TrackType;
  /** Goal not reachable — the preview is only the possible part (red). */
  blocked: boolean;
  /** Rail: direction forced at A with R (0..7), or null = automatic. */
  startHeading: number | null;
  /** NEW cells (road) / pieces (rail) the route would build; existing track is free. */
  newCells: number;
}

type Listener = () => void;

const IDLE: PathPlanSnapshot = {
  pathbuildingState: 'idle',
  startNode: null,
  previewPath: [],
  type: CellType.Road,
  blocked: false,
  startHeading: null,
  newCells: 0,
};

export class PathPlan {
  private snap: PathPlanSnapshot = IDLE;
  private readonly listeners = new Set<Listener>();
  /** Last hovered goal, to skip recomputing A* while inside the same cell. */
  private lastGoal: string | null = null;
  private goalCell: GridCell | null = null;

  getSnapshot(): PathPlanSnapshot {
    return this.snap;
  }

  /** First click: fix A and enter 'selecting_end'. */
  begin(map: TerrainMap, start: GridCell, type: TrackType): void {
    this.snap = {
      pathbuildingState: 'selecting_end',
      startNode: { ...start },
      previewPath: type === CellType.Rail ? [] : [{ ...start }],
      type,
      blocked: false,
      startHeading: null,
      newCells: type === CellType.Rail || map.cells[start.x][start.z] === type ? 0 : 1,
    };
    this.lastGoal = `${start.x},${start.z}`;
    this.goalCell = { ...start };
    this.emit();
  }

  /** Hover: recompute the A* route to `goal` (no-op if the cell is unchanged). */
  preview(map: TerrainMap, goal: GridCell, force = false): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'selecting_end' || !s.startNode) return;
    const key = `${goal.x},${goal.z}`;
    if (!force && key === this.lastGoal) return;
    this.lastGoal = key;
    this.goalCell = { ...goal };
    const { path, blocked, newCells } = route(map, s.startNode, goal, s.type, s.startHeading);
    this.snap = { ...s, previewPath: path, blocked, newCells };
    this.emit();
  }

  /**
   * R / Shift+R while planning rail: turn the direction the route leaves A
   * by 45° (dir = +1 / −1). The first press starts from the current automatic
   * direction, so the route visibly swings one step.
   */
  rotateStart(map: TerrainMap, dir: 1 | -1): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'selecting_end' || s.type !== CellType.Rail) return;
    const base = s.startHeading ?? firstHeading(s.previewPath) ?? 0;
    const startHeading = s.startHeading === null && firstHeading(s.previewPath) === null ? base : (base + dir + 8) % 8;
    this.snap = { ...s, startHeading };
    this.preview(map, this.goalCell ?? s.startNode!, true);
  }

  /** The map changed under an active plan: re-route to the same goal. */
  refresh(map: TerrainMap): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'selecting_end' || !s.startNode) return;
    const st = s.startNode;
    // The start cell itself may have become unusable (e.g. the city grew).
    if (!canStartRoute(map, st, s.type)) {
      this.clear();
      return;
    }
    this.preview(map, this.goalCell ?? st, true);
  }

  /** Cancel / finish: back to 'idle', hologram gone. */
  clear(): void {
    if (this.snap.pathbuildingState === 'idle') return;
    this.lastGoal = null;
    this.goalCell = null;
    this.snap = { ...IDLE, type: this.snap.type };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
