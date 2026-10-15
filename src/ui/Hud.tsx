/**
 * Hud — top-left status overlay (money + counters) and the bottom hint.
 *
 * Reads discrete simulation snapshots (not per-frame state): the player's
 * money, the number of auto-generated industries ("Épületek"), and the number
 * of roads ("Lerakott utak").
 */

import { useGameSnapshot, useIndustryCount, useRoadCount } from '../sim';
import './hud.css';

export function Hud() {
  const { money } = useGameSnapshot();
  const industryCount = useIndustryCount();
  const roadCount = useRoadCount();

  return (
    <div className="hud">
      <div className="hud__panel">
        <div className="hud__row">
          <span className="hud__label">Pénz</span>
          <span className="hud__value">${money}</span>
        </div>
        <div className="hud__row">
          <span className="hud__label">Épületek</span>
          <span className="hud__value">{industryCount}</span>
        </div>
        <div className="hud__row">
          <span className="hud__label">Lerakott utak</span>
          <span className="hud__value">{roadCount}</span>
        </div>
      </div>

      <div className="hud__hint">
        Út ($10) építése / Törlés: bal klikk · Mozgás: WASD vagy nyilak · Bal
        húzás: pásztázás · Jobb húzás: forgatás · Görgő: zoom
      </div>
    </div>
  );
}
