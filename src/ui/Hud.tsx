/**
 * Hud — React overlay UI (money, building count, hints).
 *
 * Lives in the normal React DOM tree, layered above the canvas. It reads the
 * discrete World snapshot (not per-frame state), so it only updates when the
 * player places or removes something.
 */

import { useWorldSnapshot } from '../sim';
import './hud.css';

export function Hud() {
  const placements = useWorldSnapshot();

  return (
    <div className="hud">
      <div className="hud__panel">
        <div className="hud__row">
          <span className="hud__label">Épületek</span>
          <span className="hud__value">{placements.length}</span>
        </div>
      </div>

      <div className="hud__hint">
        Bal klikk a padlón: ház lerakása a legközelebbi rácspontra · Bal húzás:
        pásztázás · Jobb húzás: forgatás · Görgő: zoom
      </div>
    </div>
  );
}
