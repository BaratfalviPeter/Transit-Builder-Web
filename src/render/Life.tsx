/**
 * Life — ambient sailboats drifting across the lakes (purely visual).
 *
 * Boats are derived from the current map (re-spawned when cell types change),
 * steer away from shores, and bob gently. Two instanced meshes in total.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchCloudShadows } from './cloudShadows';
import { useVisualKeys } from './visualSettings';

export interface LifeProps {
  map: TerrainMap;
  cellSize: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const WATER_Y = FLAT_TOP - 0.2;

const BOX = new THREE.BoxGeometry(1, 1, 1);
BOX.translate(0, 0.5, 0);
const std = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, flatShading: true, ...extra });
const M = {
  hull: std('#8a5a3a'),
  sail: std('#f4f1e8', { side: THREE.DoubleSide }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));

type Cell = [number, number];

function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function Life({ map, cellSize }: LifeProps) {
  const { lifeVisible } = useVisualKeys(['lifeVisible'] as const);
  if (!lifeVisible) return null;
  return <Boats map={map} cellSize={cellSize} />;
}

// --- Boats --------------------------------------------------------------------------

function Boats({ map, cellSize }: LifeProps) {
  const half = (map.size - 1) / 2;
  const open = (x: number, z: number) => {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const a = Math.round(x) + dx;
        const b = Math.round(z) + dz;
        if (a < 0 || b < 0 || a >= map.size || b >= map.size || map.cells[a][b] !== CellType.Water) return false;
      }
    return true;
  };
  const boats = useMemo(() => {
    const spots: Cell[] = [];
    for (let x = 2; x < map.size - 2; x += 3)
      for (let z = 2; z < map.size - 2; z += 3) if (open(x, z)) spots.push([x, z]);
    const n = Math.min(10, Math.floor(spots.length / 12));
    return Array.from({ length: n }, (_, i) => {
      const [x, z] = spots[Math.floor(hash01(i, 3, map.seed + 710) * spots.length)];
      return { x, z, a: hash01(i, 4, map.seed + 711) * Math.PI * 2, sp: 0.25 + hash01(i, 5, map.seed + 712) * 0.2 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  const hull = useRef<THREE.InstancedMesh>(null);
  const sail = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame((state, delta) => {
    const h = hull.current;
    const s = sail.current;
    if (!h || !s) return;
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;
    boats.forEach((b, i) => {
      // Gentle drift; turn away whenever the water ahead isn't open.
      b.a += Math.sin(t * 0.2 + i) * 0.003;
      const nx = b.x + Math.cos(b.a) * b.sp * dt;
      const nz = b.z + Math.sin(b.a) * b.sp * dt;
      if (open(nx + Math.cos(b.a) * 1.5, nz + Math.sin(b.a) * 1.5)) {
        b.x = nx;
        b.z = nz;
      } else b.a += 1.3 * dt;
      const yaw = Math.atan2(Math.cos(b.a), Math.sin(b.a));
      const bob = Math.sin(t * 1.7 + i) * 0.01 * cellSize;
      tmp.position.set((b.x - half) * cellSize, WATER_Y * cellSize - 0.02 * cellSize + bob, (b.z - half) * cellSize);
      tmp.rotation.set(Math.sin(t * 1.3 + i) * 0.05, yaw, 0);
      tmp.scale.set(0.18 * cellSize, 0.07 * cellSize, 0.45 * cellSize);
      tmp.updateMatrix();
      h.setMatrixAt(i, tmp.matrix);
      tmp.position.y += 0.07 * cellSize;
      tmp.scale.set(0.02 * cellSize, 0.42 * cellSize, 0.3 * cellSize);
      tmp.updateMatrix();
      s.setMatrixAt(i, tmp.matrix);
    });
    h.instanceMatrix.needsUpdate = true;
    s.instanceMatrix.needsUpdate = true;
  });
  if (boats.length === 0) return null;
  return (
    <group key={boats.length + ':' + map.cellsVersion}>
      <instancedMesh ref={hull} args={[BOX, M.hull, boats.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={sail} args={[BOX, M.sail, boats.length]} castShadow frustumCulled={false} />
    </group>
  );
}
