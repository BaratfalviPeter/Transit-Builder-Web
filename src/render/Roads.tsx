/**
 * Roads — renders player-built road tiles.
 *
 * A road is a flat, dark-grey tile. On flat ground it rests just above the
 * grass. On a hill (the cell's stored height > 0) the road is raised to the
 * hill's top so it visually runs over the slope — matching the requirement
 * that roads take the hill's elevation instead of lying on the base ground.
 *
 * All road tiles share geometry/material and are drawn with one InstancedMesh.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface RoadsProps {
  map: TerrainMap;
  cellSize: number;
}

const ROAD_STYLE = CELL_STYLE[CellType.Road];
// Flat grass tile top; the hill surface sits on this, so a road on a hill must
// line up with FLAT_TOP + hillHeight (see Hills.tsx).
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function Roads({ map, cellSize }: RoadsProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  const coords = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.Road) {
          out.push([x, z, map.heights[x][z]]);
        }
      }
    }
    return out;
  }, [map]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const thickness = ROAD_STYLE.scaleY * cellSize;

    for (let i = 0; i < coords.length; i++) {
      const [x, z, h] = coords[i];
      const worldX = (x - half) * cellSize;
      const worldZ = (z - half) * cellSize;
      // On a hill the road sits on the hill surface top (FLAT_TOP + h); on flat
      // ground h = 0, so it rests just above the grass via the style offset.
      const baseTop = h > 0 ? (FLAT_TOP + h) * cellSize : 0;
      const worldY = baseTop + thickness / 2 + ROAD_STYLE.offsetY * cellSize;

      dummy.position.set(worldX, worldY, worldZ);
      dummy.scale.set(cellSize, thickness, cellSize);
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
      args={[undefined, undefined, coords.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={ROAD_STYLE.color} roughness={0.8} />
    </instancedMesh>
  );
}
