/**
 * MapGrid — forest decoration on top of the unified terrain surface.
 *
 * The ground itself (grass, hills, water, city, ramps) is now one continuous
 * heightmap mesh (TerrainSurface). This component only adds the raised Forest
 * blocks so forests keep their chunky low-poly tree look, drawn as a single
 * InstancedMesh (one draw call). Forest cells are also colored green on the
 * terrain surface beneath, so the base reads correctly.
 *
 * Grid -> world mapping matches the rest of the map: cell [x][z] is centered at
 * ((x-half)*cellSize, _, (z-half)*cellSize).
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, cornerHeightAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface MapGridProps {
  map: TerrainMap;
  cellSize: number;
}

/** Grass surface top (where forest blocks rest), in cellSize units. */
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function MapGrid({ map, cellSize }: MapGridProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  const coords = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.Forest) out.push([x, z]);
      }
    }
    return out;
  }, [map]);

  const style = CELL_STYLE[CellType.Forest];

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const height = style.scaleY * cellSize;
    const foot = 0.9 * cellSize;
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      // Rest the tree block on the cell's SURFACE top: grass level plus the
      // cell's own corner height, so forests on a (flat) hill top are raised.
      const surfaceTop = (FLAT_TOP + cornerHeightAt(map, x, z)) * cellSize;
      dummy.position.set(
        (x - half) * cellSize,
        surfaceTop + height / 2,
        (z - half) * cellSize,
      );
      dummy.scale.set(foot, height, foot);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = coords.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [coords, cellSize, half, style.scaleY, map]);

  if (coords.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, coords.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={style.color} roughness={0.85} />
    </instancedMesh>
  );
}
