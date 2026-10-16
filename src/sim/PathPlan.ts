/**
 * PathPlan — state of the two-click (Point A → Point B) road/rail planner.
 *
 * Pure TypeScript, observable (same pattern as TerraformPlan):
 *   - `pathbuildingState`: 'idle' (waiting for the first click) or
 *     'selecting_end' (A is fixed, the route follows the cursor);
 *   - `startNode`: the A cell (`startPt`: the exact clicked point);
 *   - `previewPath`: ROAD route cells from A to the hovered cell;
 *   - `rail`: RAIL plan — a smooth centre-line (railRoute.ts).
 * Both are drawn as the green (or red, if `blocked`) hologram.
 *
 * Points are grid coordinates (cell centre = integer). The building itself is
 * done by the canvas (TerrainStore + GameState).
 */

import { cellsToBuild, findTrackPath, isTrackPassable, type GridCell, type TrackType } from './pathfind';
import { canRailCell, EMPTY_NET, snapToNet } from './railNet';
import { planRail, type RailPlan } from './railRoute';
import { CellType, type TerrainMap } from './terrain';

export type PlanStep = GridCell;
export interface GridPoint {
  x: number;
  z: number;
}

/** Can a route of `type` start at this point? */
export function canStartRoute(map: TerrainMap, p: GridPoint, type: TrackType): boolean {
  const c = { x: Math.round(p.x), z: Math.round(p.z) };
  if (c.x < 0 || c.z < 0 || c.x >= map.size || c.z >= map.size) return false;
  if (type === CellType.Rail) return !!snapToNet(map.railNet ?? EMPTY_NET, p.x, p.z) || canRailCell(map, c.x, c.z);
  return isTrackPassable(map, c.x, c.z, type);
}

export type PathBuildingState = 'idle' | 'selecting_end';

export interface PathPlanSnapshot {
  pathbuildingState: PathBuildingState;
  startNode: GridCell | null;
  startPt: GridPoint | null;
  previewPath: PlanStep[];
  /** Rail plan (rail tool only). */
  rail: RailPlan | null;
  /** Track type being planned. */
  type: TrackType;
  /** Goal not reachable / not buildable — red hologram, click refused. */
  blocked: boolean;
  /** Cost units: new road cells, or rail length in cells. */
  newCells: number;
}

type Listener = () => void;

const IDLE: PathPlanSnapshot = {
  pathbuildingState: 'idle',
  startNode: null,
  startPt: null,
  previewPath: [],
  rail: null,
  type: CellType.Road,
  blocked: false,
  newCells: 0,
};

export class PathPlan {
  private snap: PathPlanSnapshot = IDLE;
  private readonly listeners = new Set<Listener>();
  /** Last hovered goal key, to skip recomputing while the cursor stays put. */
  private lastGoal: string | null = null;
  private goalPt: GridPoint | null = null;

  getSnapshot(): PathPlanSnapshot {
    return this.snap;
  }

  /** First click: fix A and enter 'selecting_end'. */
  begin(map: TerrainMap, start: GridPoint, type: TrackType): void {
    const cell = { x: Math.round(start.x), z: Math.round(start.z) };
    this.snap = {
      ...IDLE,
      pathbuildingState: 'selecting_end',
      startNode: cell,
      startPt: { ...start },
      previewPath: type === CellType.Rail ? [] : [cell],
      type,
      newCells: type === CellType.Rail || map.cells[cell.x][cell.z] === type ? 0 : 1,
    };
    this.lastGoal = null;
    this.goalPt = { ...start };
    this.emit();
  }

  /** Hover: recompute the route to `goal` (no-op if it hasn't moved enough). */
  preview(map: TerrainMap, goal: GridPoint, force = false): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'selecting_end' || !s.startNode || !s.startPt) return;
    // Rail re-plans every half cell (finer snapping onto tracks); road per cell.
    const q = s.type === CellType.Rail ? 2 : 1;
    const key = `${Math.round(goal.x * q)},${Math.round(goal.z * q)}`;
    if (!force && key === this.lastGoal) return;
    this.lastGoal = key;
    this.goalPt = { ...goal };
    if (s.type === CellType.Rail) {
      const rail = planRail(map, s.startPt, goal);
      this.snap = { ...s, rail, blocked: rail.blocked || rail.pts.length < 4, newCells: Math.ceil(rail.length) };
    } else {
      const gc = { x: Math.round(goal.x), z: Math.round(goal.z) };
      const { path, blocked } = findTrackPath(map, s.startNode, gc, s.type);
      this.snap = { ...s, previewPath: path, blocked, newCells: cellsToBuild(map, path, s.type).length };
    }
    this.emit();
  }

  /** The map changed under an active plan: re-route to the same goal. */
  refresh(map: TerrainMap): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'selecting_end' || !s.startPt) return;
    // The start itself may have become unusable (e.g. the city grew).
    if (!canStartRoute(map, s.startPt, s.type)) {
      this.clear();
      return;
    }
    this.preview(map, this.goalPt ?? s.startPt, true);
  }

  /** Cancel / finish: back to 'idle', hologram gone. */
  clear(): void {
    if (this.snap.pathbuildingState === 'idle') return;
    this.lastGoal = null;
    this.goalPt = null;
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
