/**
 * PathPlanInfo — small overlay for the two-click road/rail planner.
 *
 * While a route is being planned (A fixed, B follows the cursor) it shows the
 * track type, how many new cells the route builds, the cost, and why the
 * hologram is red (blocked / not enough money), plus the cancel hint.
 */

import { CellType, TOOLS, dirtOnPath, highwayPlan, planCost, roadOverHighway, roadKindOf, useGameSnapshot, usePathPlanSnapshot, useTerrainMap } from '../sim';
import './pathPlanInfo.css';

export function PathPlanInfo() {
  const snap = usePathPlanSnapshot();
  const { money, activeTool } = useGameSnapshot();
  const map = useTerrainMap();
  if (snap.pathbuildingState === 'idle') return null;
  const drawing = snap.pathbuildingState === 'drawing';

  const rail = snap.type === CellType.Rail;
  const hw = !rail && activeTool === 'highway' ? highwayPlan(map, snap.previewPath) : null;
  const kind = roadKindOf(activeTool) ?? 'main';
  const tool = TOOLS[rail ? 'rail' : hw ? 'highway' : kind === 'dirt' ? 'dirtroad' : 'road'];
  const cost = planCost(map, snap, hw ? 'highway' : kind);
  const upgrades = !rail && !hw && kind === 'main' ? dirtOnPath(map, snap.previewPath) : 0;
  const hwProblem = hw?.problem ?? (!rail && !hw ? roadOverHighway(map, snap.previewPath) : null);
  const poor = money < cost;
  const status = hwProblem
    ? hwProblem
    : snap.blocked
    ? snap.rail?.reason ?? 'Akadály – ide nem vezethető'
    : poor
      ? 'Nincs elég pénz'
      : drawing
        ? snap.rail?.reason ?? (snap.type === CellType.Rail ? 'Engedd el az építéshez · Shift: egyenesen' : 'Engedd el az építéshez · visszahúzva törlődik')
        : snap.type === CellType.Rail
          ? 'Kattints: lerakja, és innen folytatod · Esc: vége'
          : 'Kattints a célpontra az építéshez';

  return (
    <div className={`ppi ${snap.blocked || poor || hwProblem ? 'ppi--red' : ''}`}>
      <div className="ppi__row">
        <span className="ppi__title">
          {tool.label} · {hw ? hw.newCells : snap.newCells} {rail ? 'cella hosszú' : 'új cella'}
          {upgrades > 0 && ` · ${upgrades} felújítás`}
        </span>
        <span className="ppi__cost">${cost}</span>
      </div>
      <div className="ppi__status">{status}</div>
      <div className="ppi__hint">{drawing ? 'Esc: mégse' : 'Jobb klikk / Esc: mégse'}</div>
    </div>
  );
}
