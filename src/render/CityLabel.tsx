/**
 * CityLabel — the city card floating above the city square: population, this
 * month's demand per item (delivered / wanted, with a bar), last month's
 * supply and whether the town is growing (see sim/CityDevelopment.ts).
 *
 * drei <Html>, like BuildingIcons; never takes pointer events.
 */

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import {
  CellType,
  CITY_ITEMS,
  cityBounds,
  ITEMS,
  POWER_MIN,
  useCitySnapshot,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import './cityLabel.css';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

const GROWTH_TEXT = {
  free: 'Kisváros — magától nő',
  supplied: 'Nő, amíg ellátod',
  stalled: 'Nem nő — szállíts ide árut és deszkát (megálló a város szélén)',
  nopower: 'Nem nő — kevés az áram (vigyél szenet az erőműbe)',
} as const;

/** MW → "1,25 GW" / "800 MW". */
export function formatPower(mw: number): string {
  return mw >= 1000 ? `${(mw / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 2 })} GW` : `${Math.round(mw)} MW`;
}

export function CityLabel({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const city = useCitySnapshot();
  const half = (map.size - 1) / 2;

  const box = useMemo(() => cityBounds(map), [map]);
  if (!box) return null;

  // Above the middle of the city, over its tallest buildings.
  const y = (FLAT_TOP + 4.5) * cellSize;
  return (
    <Html
      position={[((box.x0 + box.x1) / 2 - half) * cellSize, y, ((box.z0 + box.z1) / 2 - half) * cellSize]}
      center
      distanceFactor={16}
      zIndexRange={[10, 0]}
      occlude={false}
    >
      <div className="citycard">
        <div className="citycard__head">
          <span className="citycard__icon">🏙️</span>
          <span className="citycard__title">Város</span>
          <span className="citycard__pop">{city.population.toLocaleString('hu-HU')} lakos</span>
        </div>
        {CITY_ITEMS.map((it) => {
          const want = city.demand[it] ?? 0;
          const got = city.delivered[it] ?? 0;
          const f = want > 0 ? Math.min(1, got / want) : 0;
          const last = city.satisfaction?.[it];
          return (
            <div key={it} className="citycard__row">
              <span className="citycard__item">
                {ITEMS[it].icon} {ITEMS[it].label}
              </span>
              <span className="citycard__bar">
                <span className="citycard__fill" style={{ width: `${f * 100}%` }} />
              </span>
              <span className="citycard__num">
                {Math.round(got)}/{want}
              </span>
              {last !== undefined && <span className="citycard__last">ellátottság {Math.round(last * 100)}%</span>}
            </div>
          );
        })}
        <div className="citycard__row" title="Áram: az erőművek automatikusan ellátják a várost, ha szenet (vagy olajat) kapnak">
          <span className="citycard__item">⚡ Áram</span>
          <span className="citycard__bar">
            <span
              className={'citycard__fill' + (city.power.supply < city.power.demand * POWER_MIN ? ' citycard__fill--low' : '')}
              style={{ width: `${city.power.demand > 0 ? Math.min(1, city.power.supply / city.power.demand) * 100 : 100}%` }}
            />
          </span>
          <span className="citycard__num">{formatPower(city.power.supply)}</span>
          <span className="citycard__last">
            igény {formatPower(city.power.demand)}
            {city.powerSat !== null && ` · ellátottság ${Math.round(city.powerSat * 100)}% (min. ${Math.round(POWER_MIN * 100)}%)`}
          </span>
        </div>
        <div className={`citycard__growth citycard__growth--${city.growth}`}>{GROWTH_TEXT[city.growth]}</div>
      </div>
    </Html>
  );
}
