/**
 * Hud — React overlay UI (counters + hints).
 *
 * Lives in the normal React DOM tree, layered above the canvas. It reads
 * discrete simulation snapshots (not per-frame state), so it only updates on
 * meaningful events: placing a house, or building a road.
 */

import { useRoadCount, useWorldSnapshot } from '../sim';
import './hud.css';

export function Hud() {
  const placements = useWorldSnapshot();
  const roadCount = useRoadCount();

  return (
    <div className="hud">
      <div className="hud__panel">
        <div className="hud__row">
          <span className="hud__label">Épületek</span>
          <span className="hud__value">{placements.length}</span>
        </div>
        <div className="hud__row">
          <span className="hud__label">Lerakott utak</span>
          <span className="hud__value">{roadCount}</span>
        </div>
      </div>

      <div className="hud__hint">
        Bal klikk a padlón: út építése üres (fű) cellára · Bal húzás: pásztázás ·
        Jobb húzás: forgatás · Görgő: zoom
      </div>
    </div>
  );
}
