/**
 * CityLabel — the city card floating above the market: population, this
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
  cornerHeightAt,
  INDUSTRY_CENTER_OFFSET,
  INDUSTRY_MODEL_SCALE,
  ITEMS,
  useCitySnapshot,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import './cityLabel.css';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

const GROWTH_TEXT = {
  free: 'Kisváros — magától nő',
  supplied: 'Nő, amíg ellátod',
  stalled: 'Nem nő — szállíts ide árut és deszkát',
} as const;

export function CityLabel({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const city = useCitySnapshot();
  const half = (map.size - 1) / 2;

  const market = useMemo(() => {
    for (let x = 0; x < map.size; x++) for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.Market) return { x, z };
    return null;
  }, [map]);
  if (!market) return null;

  const y = (FLAT_TOP + cornerHeightAt(map, market.x, market.z)) * cellSize + 3.2 * INDUSTRY_MODEL_SCALE * cellSize;
  return (
    <Html
      position={[(market.x - half + INDUSTRY_CENTER_OFFSET) * cellSize, y, (market.z - half + INDUSTRY_CENTER_OFFSET) * cellSize]}
      center
      distanceFactor={16}
      zIndexRange={[10, 0]}
      occlude={false}
    >
      <div className="citycard">
        <div className="citycard__head">
          <span className="citycard__icon">🏪</span>
          <span className="citycard__title">Piac</span>
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
        <div className={`citycard__growth citycard__growth--${city.growth}`}>{GROWTH_TEXT[city.growth]}</div>
      </div>
    </Html>
  );
}
