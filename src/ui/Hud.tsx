/**
 * Hud — top-left counters (industries, roads) and the bottom controls hint.
 * Money and the date/economy now live in the SidePanel.
 */

import { useIndustryCount, useRoadCount } from '../sim';
import './hud.css';

export function Hud() {
  const industryCount = useIndustryCount();
  const roadCount = useRoadCount();

  return (
    <div className="hud">
      <div className="hud__panel">
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
        Bal klikk/húzás: építés–tereprendezés a kiválasztott eszközzel · Mozgás:
        WASD vagy nyilak · Jobb húzás: forgatás · Görgő: zoom
      </div>
    </div>
  );
}
