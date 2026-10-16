/**
 * CityBuildings — the auto-growing town, as low-poly buildings.
 *
 * Each CityCenter building (from the pure-TS CityDevelopment sim) is drawn by
 * its development level:
 *   - level 1–2: little houses with coloured walls and a gabled roof,
 *   - level 3–4: blocky apartment buildings with flat roofs + a parapet,
 *   - level 5:   a slim tower with a rooftop antenna.
 * Window bands wrap every floor; they read as dark glass by day and glow warm
 * at night (driven by the day/night cycle).
 *
 * Five InstancedMeshes for the whole town (walls, gable roofs, flat roofs,
 * window bands, antennas), each sized to the number of CityCenter cells and
 * hidden-by-zero-scale when unused, so growth never reallocates.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Building, TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { CellType } from '../sim';
import { patchCloudShadows } from './cloudShadows';
import { registerNightGlow } from './dayNight';

export interface CityBuildingsProps {
  buildings: Building[];
  map: TerrainMap;
  cellSize: number;
}

const CITY_TILE_TOP = CELL_STYLE[CellType.CityCenter].scaleY;
/** Max floors (window bands) per building. */
const MAX_FLOORS = 7;

const BOX = new THREE.BoxGeometry(1, 1, 1);
BOX.translate(0, 0.5, 0); // base at y = 0

/** Gable prism: width 1 (x), height 1, depth 1 (z), base at y = 0. */
const GABLE = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();

const std = (extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true, ...extra });
const WALL_MAT = std();
const ROOF_MAT = std({ roughness: 0.75 });
const FLAT_MAT = std({ color: '#8d8b86', roughness: 0.9 });
const WIN_MAT = std({ color: '#3a4652', roughness: 0.35, emissive: '#ffcf73', emissiveIntensity: 0 });
const ANT_MAT = std({ color: '#6e737a', metalness: 0.4 });
[WALL_MAT, ROOF_MAT, FLAT_MAT, WIN_MAT, ANT_MAT].forEach((m) => patchCloudShadows(m));
registerNightGlow(WIN_MAT, 0, 1.6);

const WALLS = ['#efe6d2', '#e3c9a3', '#d79a7a', '#c9d3d8', '#f3efe6', '#d8c08a', '#b7c4a5'].map((c) => new THREE.Color(c));
const ROOFS = ['#9a4433', '#7c3a2c', '#4f4a48', '#5e6670', '#8a5a3a'].map((c) => new THREE.Color(c));
const TOWER_WALLS = ['#c9cdd1', '#b7bec6', '#d8d4cb', '#a9b3bd'].map((c) => new THREE.Color(c));

function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Wall height (cell units) per level, and floor count. */
function shape(level: number): { h: number; floors: number; gable: boolean; foot: number } {
  switch (level) {
    case 1:
      return { h: 0.32, floors: 1, gable: true, foot: 0.62 };
    case 2:
      return { h: 0.55, floors: 2, gable: true, foot: 0.7 };
    case 3:
      return { h: 0.85, floors: 3, gable: false, foot: 0.74 };
    case 4:
      return { h: 1.3, floors: 5, gable: false, foot: 0.76 };
    default:
      return { h: 1.95, floors: 7, gable: false, foot: 0.6 };
  }
}

export function CityBuildings({ buildings, map, cellSize }: CityBuildingsProps) {
  const half = (map.size - 1) / 2;
  const capacity = useMemo(() => {
    let n = 0;
    for (let x = 0; x < map.size; x++)
      for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.CityCenter) n++;
    return Math.max(n, 1);
  }, [map]);

  const wallRef = useRef<THREE.InstancedMesh>(null);
  const gableRef = useRef<THREE.InstancedMesh>(null);
  const flatRef = useRef<THREE.InstancedMesh>(null);
  const winRef = useRef<THREE.InstancedMesh>(null);
  const antRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const wall = wallRef.current;
    const gable = gableRef.current;
    const flat = flatRef.current;
    const win = winRef.current;
    const ant = antRef.current;
    if (!wall || !gable || !flat || !win || !ant) return;
    const d = new THREE.Object3D();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let gi = 0;
    let fi = 0;
    let wi = 0;
    let ai = 0;
    const base = CITY_TILE_TOP * cellSize;
    // Make sure the per-instance colour buffers exist from the very first
    // render (even with no buildings yet), so the shader compiles WITH
    // instance colours and later growth shows its colours.
    if (!wall.instanceColor) for (let i = 0; i < capacity; i++) wall.setColorAt(i, WALLS[0]);
    if (!gable.instanceColor) for (let i = 0; i < capacity; i++) gable.setColorAt(i, ROOFS[0]);
    buildings.forEach((b, i) => {
      const sh = shape(b.level);
      const wx = (b.x - half) * cellSize;
      const wz = (b.z - half) * cellSize;
      const yaw = hash01(b.x, b.z, map.seed + 61) < 0.5 ? 0 : Math.PI / 2;
      const foot = sh.foot * cellSize;
      const depth = foot * (sh.gable ? 0.86 : 1);
      const h = sh.h * cellSize;
      d.position.set(wx, base, wz);
      d.rotation.set(0, yaw, 0);
      d.scale.set(foot, h, depth);
      d.updateMatrix();
      wall.setMatrixAt(i, d.matrix);
      const pal = b.level >= 4 ? TOWER_WALLS : WALLS;
      wall.setColorAt(i, pal[Math.floor(hash01(b.x, b.z, map.seed + 62) * pal.length)]);

      if (sh.gable) {
        d.position.set(wx, base + h, wz);
        d.scale.set(foot * 1.08, 0.3 * cellSize, depth * 1.06);
        d.updateMatrix();
        gable.setMatrixAt(gi, d.matrix);
        gable.setColorAt(gi, ROOFS[Math.floor(hash01(b.x, b.z, map.seed + 63) * ROOFS.length)]);
        gi++;
      } else {
        d.position.set(wx, base + h, wz);
        d.scale.set(foot * 1.04, 0.05 * cellSize, depth * 1.04);
        d.updateMatrix();
        flat.setMatrixAt(fi++, d.matrix);
        // Rooftop box (stairwell / AC) for character.
        d.position.set(wx + foot * 0.18, base + h + 0.05 * cellSize, wz - depth * 0.15);
        d.scale.set(foot * 0.3, 0.1 * cellSize, depth * 0.3);
        d.updateMatrix();
        flat.setMatrixAt(fi++, d.matrix);
      }
      // One window band per floor, a hair bigger than the walls.
      const fh = h / sh.floors;
      for (let f = 0; f < sh.floors && f < MAX_FLOORS; f++) {
        d.position.set(wx, base + fh * f + fh * 0.42, wz);
        d.scale.set(foot * 1.01, fh * 0.28, depth * 1.01);
        d.updateMatrix();
        win.setMatrixAt(wi++, d.matrix);
      }
      if (b.level >= 5) {
        d.position.set(wx, base + h + 0.05 * cellSize, wz);
        d.rotation.set(0, 0, 0);
        d.scale.set(0.03 * cellSize, 0.45 * cellSize, 0.03 * cellSize);
        d.updateMatrix();
        ant.setMatrixAt(ai++, d.matrix);
      }
    });
    for (let i = buildings.length; i < capacity; i++) wall.setMatrixAt(i, zero);
    for (let i = gi; i < capacity; i++) gable.setMatrixAt(i, zero);
    for (let i = fi; i < capacity * 2; i++) flat.setMatrixAt(i, zero);
    for (let i = wi; i < capacity * MAX_FLOORS; i++) win.setMatrixAt(i, zero);
    for (let i = ai; i < capacity; i++) ant.setMatrixAt(i, zero);
    for (const m of [wall, gable, flat, win, ant]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [buildings, cellSize, half, capacity, map.seed]);

  return (
    <group key={capacity}>
      <instancedMesh ref={wallRef} args={[BOX, WALL_MAT, capacity]} castShadow receiveShadow />
      <instancedMesh ref={gableRef} args={[GABLE, ROOF_MAT, capacity]} castShadow receiveShadow />
      <instancedMesh ref={flatRef} args={[BOX, FLAT_MAT, capacity * 2]} castShadow receiveShadow />
      <instancedMesh ref={winRef} args={[BOX, WIN_MAT, capacity * MAX_FLOORS]} />
      <instancedMesh ref={antRef} args={[BOX, ANT_MAT, capacity]} castShadow />
    </group>
  );
}
