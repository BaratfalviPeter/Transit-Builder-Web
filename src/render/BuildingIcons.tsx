/**
 * BuildingIcons — floating UI icons above special / industrial buildings.
 *
 * Uses drei's <Html center> to anchor a small HTML/CSS badge in 3D space above
 * each special building, so testers can identify building types at a glance.
 * Icons are mapped per CellType (emoji glyphs). A gentle CSS bobbing animation
 * (see buildingIcons.css) makes them float.
 *
 * World mapping matches the rest of the map: cell [x][z] ->
 * ((x-half)*cellSize, _, (z-half)*cellSize). The icon sits above the building
 * at ~1.5 cells up. Icons never intercept pointer events (pointer-events:none),
 * so map clicks still pass through to the terrain.
 */

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import {
  CellType,
  cornerHeightAt,
  FIXED_PRODUCTION,
  MAX_INDUSTRY_LEVEL,
  useInteriorStore,
  useProductionVersion,
  INDUSTRY_CENTER_OFFSET,
  INDUSTRY_MODEL_SCALE,
  LARGE_INDUSTRY,
  SPECIAL_BUILDINGS,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import './buildingIcons.css';

/** Grass surface top, in cellSize units (icons float above the cell top). */
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export interface BuildingIconsProps {
  map: TerrainMap;
  cellSize: number;
}

/** Emoji glyph per special building type. */
const ICON: Partial<Record<CellType, string>> = {
  [CellType.PowerPlant]: '⚡',
  [CellType.Mine]: '⛏️',
  [CellType.LumberMill]: '🪓',
  [CellType.Factory]: '⚙️',
  [CellType.OilRig]: '🛢️',
};

/** Extra CSS size modifier per type (factories get a larger badge). */
const SIZE_CLASS: Partial<Record<CellType, string>> = {
  [CellType.Factory]: 'bicon--lg',
};

export function BuildingIcons({ map, cellSize }: BuildingIconsProps) {
  const half = (map.size - 1) / 2;
  // Industry levels (production.ts): re-read on the production's publishes.
  const prod = useInteriorStore().production;
  useProductionVersion();
  const stopAt = useMemo(() => new Set((map.stations ?? []).map((s) => `${s.anchor[0]},${s.anchor[1]}`)), [map]);

  const items = useMemo(() => {
    const out: Array<{ x: number; z: number; type: CellType }> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        const t = map.cells[x][z];
        if (SPECIAL_BUILDINGS.has(t) && ICON[t]) out.push({ x, z, type: t });
      }
    }
    return out;
  }, [map]);

  return (
    <group>
      {items.map(({ x, z, type }) => {
        // Float above the building, which rests on the cell's surface top
        // (grass level + the cell's corner height, raised on hills).
        const big = LARGE_INDUSTRY.has(map.cells[x][z]);
        const iconY = (FLAT_TOP + cornerHeightAt(map, x, z)) * cellSize + (big ? 3.2 * INDUSTRY_MODEL_SCALE : 1.6) * cellSize;
        return (
        <Html
          key={`${x},${z}`}
          position={[(x - half + (big ? INDUSTRY_CENTER_OFFSET : 0)) * cellSize, iconY, (z - half + (big ? INDUSTRY_CENTER_OFFSET : 0)) * cellSize]}
          center
          distanceFactor={16}
          zIndexRange={[10, 0]}
          // Keep icons visible even when "behind" building geometry so testers
          // always see them.
          occlude={false}
        >
          <div className={`bicon${SIZE_CLASS[type] ? ` ${SIZE_CLASS[type]}` : ''}`}>
            <span className="bicon__glyph" role="img" aria-label={type}>
              {ICON[type]}
            </span>
            {(FIXED_PRODUCTION[type]?.makes || FIXED_PRODUCTION[type]?.turns) && stopAt.has(`${x},${z}`) && <Level st={prod.industry([x, z])} />}
          </div>
        </Html>
        );
      })}
    </group>
  );
}

/** An industry's level (dots), its last change and how much of its output is taken away. */
function Level({ st }: { st: { level: number; served: number | null; trend: number } }) {
  return (
    <span
      className="bicon__lvl"
      title="Termelési szint: nő, ha elszállítod, amit termel (≥ 70%), visszaesik, ha nem (< 30%)"
    >
      {'●'.repeat(st.level)}
      <span className="bicon__lvl-off">{'●'.repeat(MAX_INDUSTRY_LEVEL - st.level)}</span>
      {st.trend > 0 && <span className="bicon__up"> ▲</span>}
      {st.trend < 0 && <span className="bicon__down"> ▼</span>}
      {st.served !== null && <span className="bicon__served"> {Math.round(st.served * 100)}%</span>}
    </span>
  );
}
