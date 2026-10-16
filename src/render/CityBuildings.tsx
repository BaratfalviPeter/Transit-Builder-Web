/**
 * CityBuildings — renders the auto-growing city buildings in 3D.
 *
 * Buildings come from the pure-TS `CityDevelopment` simulation (list of
 * { x, z, level }). We draw them as light cubes that stand out from the green
 * terrain, using a single InstancedMesh (one draw call) and re-writing the
 * per-instance matrices whenever the building set/levels change.
 *
 * Vertical growth: a building's height scales with its level. Each level adds
 * `LEVEL_HEIGHT` (in cellSize units). The cube's Y position is half its height
 * (plus the CityCenter tile's top), so the base rests on the ground and the
 * building grows upward as it levels up.
 *
 * World mapping matches MapGrid: cell [x][z] -> ((x-half)*cellSize, _,
 * (z-half)*cellSize), so buildings land exactly on their CityCenter tiles.
 */

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Building, TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { CellType } from '../sim';
import { patchRef } from './cloudShadows';

export interface CityBuildingsProps {
  buildings: Building[];
  map: TerrainMap;
  cellSize: number;
}

/** Height contributed per development level, in cellSize units. */
const LEVEL_HEIGHT = 0.6;
/** Horizontal footprint of a building, as a fraction of a cell. */
const FOOTPRINT = 0.7;

// Top surface height of a CityCenter tile, so buildings rest on the ground.
const CITY_TILE_TOP = CELL_STYLE[CellType.CityCenter].scaleY; // in cellSize units

export function CityBuildings({ buildings, map, cellSize }: CityBuildingsProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  // InstancedMesh capacity is fixed at creation; size it to all CityCenter
  // cells so it never needs reallocation as buildings spawn.
  const capacity = countCityCells(map);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const foot = FOOTPRINT * cellSize;

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const height = b.level * LEVEL_HEIGHT * cellSize;
      const worldX = (b.x - half) * cellSize;
      const worldZ = (b.z - half) * cellSize;
      // Base on the tile top, so position.y = tileTop + height/2.
      const worldY = CITY_TILE_TOP * cellSize + height / 2;

      dummy.position.set(worldX, worldY, worldZ);
      dummy.scale.set(foot, height, foot);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    // Hide any unused instances by scaling them to zero.
    const zero = new THREE.Object3D();
    zero.scale.set(0, 0, 0);
    zero.updateMatrix();
    for (let i = buildings.length; i < capacity; i++) {
      mesh.setMatrixAt(i, zero.matrix);
    }

    mesh.count = capacity;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [buildings, cellSize, half, capacity]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, Math.max(capacity, 1)]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        ref={patchRef} color="#eef0f2" roughness={0.6} />
    </instancedMesh>
  );
}

function countCityCells(map: TerrainMap): number {
  let n = 0;
  for (let x = 0; x < map.size; x++) {
    for (let z = 0; z < map.size; z++) {
      if (map.cells[x][z] === CellType.CityCenter) n++;
    }
  }
  return n;
}
