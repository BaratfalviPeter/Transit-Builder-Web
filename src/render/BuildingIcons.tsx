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
import { CellType, SPECIAL_BUILDINGS, type TerrainMap } from '../sim';
import './buildingIcons.css';

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
};

/** Extra CSS size modifier per type (factories get a larger badge). */
const SIZE_CLASS: Partial<Record<CellType, string>> = {
  [CellType.Factory]: 'bicon--lg',
};

export function BuildingIcons({ map, cellSize }: BuildingIconsProps) {
  const half = (map.size - 1) / 2;

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

  // Height of the icon above the ground, in world units.
  const iconY = 1.6 * cellSize;

  return (
    <group>
      {items.map(({ x, z, type }) => (
        <Html
          key={`${x},${z}`}
          position={[(x - half) * cellSize, iconY, (z - half) * cellSize]}
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
          </div>
        </Html>
      ))}
    </group>
  );
}
