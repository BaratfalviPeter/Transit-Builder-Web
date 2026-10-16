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
import { canHostRail } from './railPieces';
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

function route(map: TerrainMap, start: GridCell, goal: GridCell, type: TrackType) {
  if (type === CellType.Rail) {
    const { steps, blocked } = findRailPath(map, start, goal);
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
    const { path, blocked, newCells } = route(map, s.startNode, goal, s.type);
    this.snap = { ...s, previewPath: path, blocked, newCells };
    this.emit();
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
