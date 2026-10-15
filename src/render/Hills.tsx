/**
 * Hills — renders the gentle, ramp-like hills (OpenTTD-style slopes).
 *
 * Each Hill cell is drawn with a shared trapezoidal frustum geometry (see
 * hillGeometry.ts): a wide base on the ground and a smaller raised top with
 * sloped sides. All hills share one geometry/material and are drawn via a
 * single InstancedMesh (one draw call), consistent with the rest of the map.
 *
 * A cell is considered a hill if its stored height > 0, so a Road built on top
 * of a hill still shows the hill underneath (the road is drawn separately,
 * raised to the hill height).
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { createHillGeometry } from './hillGeometry';

export interface HillsProps {
  map: TerrainMap;
  cellSize: number;
}

export function Hills({ map, cellSize }: HillsProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  // Collect every cell that has elevation (hills, including those now carrying
  // a road — the hill body is still drawn beneath the road).
  const coords = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        const h = map.heights[x][z];
        if (h > 0) out.push([x, z, h]);
      }
    }
    return out;
  }, [map]);

  // One hill geometry, sized to a unit base; instances just translate it.
  // Height is baked in world units (max hill height); all hills share it.
  const geometry = useMemo(() => {
    const height = (coords[0]?.[2] ?? 0.9) * cellSize;
    return createHillGeometry({ height, baseWidth: cellSize });
  }, [coords, cellSize]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      dummy.position.set((x - half) * cellSize, 0, (z - half) * cellSize);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = coords.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [coords, cellSize, half]);

  if (coords.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, coords.length]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={CELL_STYLE[CellType.Hill].color}
        roughness={0.9}
      />
    </instancedMesh>
  );
}
