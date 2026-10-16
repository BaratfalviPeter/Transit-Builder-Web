/**
 * Plinth — the diorama base under the map: stacked strata (topsoil, clay,
 * light and dark rock) below the terrain's own earthy edge, each band a hair
 * inset from the one above, so the board reads like a cut-out slice of land.
 */

import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchCloudShadows } from './cloudShadows';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
/** Matches TerrainSurface's FLOOR_DROP (the terrain block's bottom). */
const FLOOR_DROP = 1.5;

/** [thickness, inset, colour] in cell units, top → bottom. */
const LAYERS: Array<[number, number, string]> = [
  [1.6, 0.0, '#6a4630'],
  [1.4, 0.12, '#8a6a4a'],
  [1.8, 0.24, '#8d8a84'],
  [1.4, 0.36, '#6d6a66'],
  [1.0, 0.48, '#4f4d4a'],
];
const MATS = LAYERS.map(([, , c]) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  patchCloudShadows(m);
  return m;
});
const BOX = new THREE.BoxGeometry(1, 1, 1);

export function Plinth({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const w = map.size * cellSize;
  let top = (FLAT_TOP - FLOOR_DROP) * cellSize;
  return (
    <group>
      {LAYERS.map(([th, inset], i) => {
        const h = th * cellSize;
        const y = top - h / 2;
        top -= h;
        const s = w - inset * 2 * cellSize;
        return <mesh key={i} geometry={BOX} material={MATS[i]} position={[0, y, 0]} scale={[s, h, s]} receiveShadow />;
      })}
    </group>
  );
}
