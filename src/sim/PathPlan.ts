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
 * DRAWING ('drawing'): instead of two clicks the player drags — the road
 * follows the cursor cell by cell (dragging back over it takes it off), and
 * is built on release.
 *
 * RAIL (Voxel Tycoon-like): from its start the shortest track to the cursor,
 * any length — straight on from the start heading, then curves (swinging the
 * cursor sideways bends it). It only takes a small detour round obstacles
 * (railRoute DETOUR); a bigger one is shown red. Shift: straight on only.
 * Clicking lays it and the next piece starts at its end (Esc / right click
 * stops); a drag is built on release.
 *
 * Points are grid coordinates (cell centre = integer). The building itself is
 * done by the canvas (TerrainStore + GameState).
 */

import { cellsToBuild, findTrackPath, isTrackPassable, trackStepOk, type GridCell, type TrackType } from './pathfind';
import { canRailCell, EMPTY_NET, snapToNet } from './railNet';
import { planRail, type RailPlan } from './railRoute';
import { CellType, type TerrainMap } from './terrain';

export type PlanStep = GridCell;

/** Unit steps of the 8 headings (0 = +x, counter-clockwise). */
const STEP: ReadonlyArray<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * The rail planner's goal. Straight (Shift): the cursor projected onto the
 * straight line on from the start — along the track the start snapped to,
 * else the octilinear direction closest to the cursor.
 */
function railGoal(start: GridPoint, goal: GridPoint, straight: boolean, from: RailPlan | null): GridPoint {
  if (!straight) return goal;
  const dx = goal.x - start.x, dz = goal.z - start.z;
  // Off a dead end: on along it (a switch from a mid-track snap must curve).
  const sn = from?.start?.kind === 'end' ? from.start : null;
  const o = sn ? { x: sn.x, z: sn.z } : { x: Math.round(start.x), z: Math.round(start.z) };
  let best = STEP[0], bd = -Infinity;
  for (const st of STEP) {
    if (sn && (Math.abs(st[0] * sn.tz - st[1] * sn.tx) > 1e-3 || st[0] * sn.tx + st[1] * sn.tz < 0)) continue;
    const d = (st[0] * dx + st[1] * dz) / Math.hypot(st[0], st[1]);
    if (d > bd) {
      bd = d;
      best = st;
    }
  }
  const k = Math.max(1, Math.round((best[0] * dx + best[1] * dz) / (best[0] * best[0] + best[1] * best[1])));
  return { x: o.x + best[0] * k, z: o.z + best[1] * k };
}

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

export type PathBuildingState = 'idle' | 'selecting_end' | 'drawing';

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
  /** Shift held: rail straight on only. */
  private straight = false;

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
      const rail = planRail(map, s.startPt, railGoal(s.startPt, goal, this.straight, s.rail));
      this.snap = { ...s, rail, blocked: rail.blocked || rail.pts.length < 4, newCells: Math.ceil(rail.length) };
    } else {
      const gc = { x: Math.round(goal.x), z: Math.round(goal.z) };
      const { path, blocked } = findTrackPath(map, s.startNode, gc, s.type);
      this.snap = { ...s, previewPath: path, blocked, newCells: cellsToBuild(map, path, s.type).length };
    }
    this.emit();
  }

  /** Start drawing (drag) at grid point `p`. False if no track can start there. */
  drawBegin(map: TerrainMap, p: GridPoint, type: TrackType): boolean {
    this.lastGoal = null;
    this.goalPt = null;
    if (type === CellType.Rail) {
      if (!canStartRoute(map, p, type)) return false;
      this.snap = { ...IDLE, pathbuildingState: 'drawing', type, startPt: { ...p } };
    } else {
      const c = { x: Math.round(p.x), z: Math.round(p.z) };
      if (!isTrackPassable(map, c.x, c.z, type)) return false;
      this.snap = { ...IDLE, pathbuildingState: 'drawing', type, startNode: c, startPt: { ...p }, previewPath: [c], newCells: cellsToBuild(map, [c], type).length };
    }
    this.emit();
    return true;
  }

  /** Drawing: follow the cursor at grid point `p` (lay on / take off track). */
  drawTo(map: TerrainMap, p: GridPoint): void {
    const s = this.snap;
    if (s.pathbuildingState !== 'drawing') return;
    if (s.type === CellType.Rail) {
      if (!s.startPt) return;
      this.goalPt = { ...p };
      const g = railGoal(s.startPt, p, this.straight, s.rail);
      const key = `${Math.round(g.x * 2)},${Math.round(g.z * 2)}`;
      if (key === this.lastGoal) return;
      this.lastGoal = key;
      const rail = planRail(map, s.startPt, g);
      this.snap = { ...s, rail, blocked: rail.blocked || rail.pts.length < 4, newCells: Math.ceil(rail.length) };
    } else {
      const t = { x: Math.round(p.x), z: Math.round(p.z) };
      let cells = s.previewPath.slice();
      for (let guard = 0; guard < 400; guard++) {
        const last = cells[cells.length - 1];
        if (last.x === t.x && last.z === t.z) break;
        // Back over the drawn road: cut it there.
        const back = cells.findIndex((c) => c.x === t.x && c.z === t.z);
        if (back >= 0) {
          cells = cells.slice(0, back + 1);
          break;
        }
        const dx = t.x - last.x, dz = t.z - last.z;
        const prev = cells[cells.length - 2];
        const alongX = prev ? prev.z === last.z : true;
        // Step along the longer axis (keeping the current one on a tie).
        const stepX = Math.abs(dx) > Math.abs(dz) || (Math.abs(dx) === Math.abs(dz) && alongX);
        const next = stepX ? { x: last.x + Math.sign(dx), z: last.z } : { x: last.x, z: last.z + Math.sign(dz) };
        if (prev && prev.x === next.x && prev.z === next.z) cells.pop();
        else cells.push(next);
      }
      let blocked = cells.length < 2;
      for (let i = 1; i < cells.length && !blocked; i++) if (!trackStepOk(map, cells[i - 1], cells[i], s.type)) blocked = true;
      this.snap = { ...s, previewPath: cells, blocked, newCells: cellsToBuild(map, cells, s.type).length };
    }
    this.emit();
  }

  /** Shift pressed / released: rail straight on only (re-plans at once). */
  setStraight(map: TerrainMap, on: boolean): void {
    if (this.straight === on) return;
    this.straight = on;
    this.lastGoal = null;
    const s = this.snap;
    if (s.type !== CellType.Rail || !this.goalPt) return;
    if (s.pathbuildingState === 'selecting_end') this.preview(map, this.goalPt, true);
    else if (s.pathbuildingState === 'drawing') this.drawTo(map, this.goalPt);
  }

  /** Rail: the next piece starts at `p` (the end of the one just laid), in the same mode. */
  continueRail(map: TerrainMap, p: GridPoint): void {
    const s = this.snap;
    if (s.type !== CellType.Rail || s.pathbuildingState === 'idle') return;
    if (s.pathbuildingState === 'selecting_end') {
      this.begin(map, p, CellType.Rail);
      if (this.goalPt) this.preview(map, this.goalPt, true);
      return;
    }
    this.lastGoal = null;
    this.snap = { ...IDLE, pathbuildingState: 'drawing', type: CellType.Rail, startPt: { ...p } };
    this.emit();
  }

  /** The map changed under an active plan: re-route to the same goal. */
  refresh(map: TerrainMap): void {
    const s = this.snap;
    if (s.pathbuildingState === 'drawing') {
      if (s.type === CellType.Rail && s.startPt && this.goalPt) {
        const rail = planRail(map, s.startPt, railGoal(s.startPt, this.goalPt, this.straight, s.rail));
        this.snap = { ...s, rail, blocked: rail.blocked || rail.pts.length < 4, newCells: Math.ceil(rail.length) };
        this.emit();
      }
      return;
    }
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
