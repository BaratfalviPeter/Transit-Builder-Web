/**
 * PathPlanInfo — small overlay for the two-click road/rail planner.
 *
 * While a route is being planned (A fixed, B follows the cursor) it shows the
 * track type, how many new cells the route builds, the cost, and why the
 * hologram is red (blocked / not enough money), plus the cancel hint.
 */

import { CellType, HEADING_LABELS, TOOLS, useGameSnapshot, usePathPlanSnapshot } from '../sim';
import './pathPlanInfo.css';

export function PathPlanInfo() {
  const snap = usePathPlanSnapshot();
  const { money } = useGameSnapshot();
  if (snap.pathbuildingState !== 'selecting_end') return null;

  const tool = TOOLS[snap.type === CellType.Rail ? 'rail' : 'road'];
  const cost = snap.newCells * tool.cost;
  const poor = money < cost;
  const status = snap.blocked
    ? 'Akadály – ide nem vezethető'
    : poor
      ? 'Nincs elég pénz'
      : 'Kattints a célpontra az építéshez';

  return (
    <div className={`ppi ${snap.blocked || poor ? 'ppi--red' : ''}`}>
      <div className="ppi__row">
        <span className="ppi__title">
          {tool.label} · {snap.newCells} {snap.type === CellType.Rail ? 'új sínelem' : 'új cella'}
        </span>
        <span className="ppi__cost">${cost}</span>
      </div>
      <div className="ppi__status">{status}</div>
      {snap.type === CellType.Rail && (
        <div className="ppi__hint">
          Indulási irány: <b>{snap.startHeading === null ? 'auto' : HEADING_LABELS[snap.startHeading]}</b> · R / Shift+R:
          forgatás
        </div>
      )}
      <div className="ppi__hint">Jobb klikk / Esc: mégse</div>
    </div>
  );
}
