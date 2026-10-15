/**
 * MapGrid — renders a generated TerrainMap in 3D.
 *
 * The map data comes from the pure-TS simulation (`generateTerrain`) and is
 * held in React state by the parent, so gameplay systems (pathfinding, traffic)
 * can read the same grid later.
 *
 * Rendering strategy: cells are grouped by CellType and drawn with one
 * InstancedMesh per type. All cells of a type share geometry/material and a
 * uniform vertical scale/offset (from CELL_STYLE), so a single instanced draw
 * call per type keeps the 21×21 (441-cell) grid cheap — consistent with the
 * project's "don't go through React/instance heavy things" principle.
 *
 * Grid -> world mapping: cell [x][z] is centered at
 *   worldX = (x - (size-1)/2) * cellSize
 *   worldZ = (z - (size-1)/2) * cellSize
 * i.e. the whole map is centered on the origin.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export interface MapGridProps {
  map: TerrainMap;
  cellSize: number;
}

/** Base (unscaled) height of a tile cube, in cellSize units. */
const BASE_TILE_HEIGHT = 1;

/** Types MapGrid does NOT draw as flat boxes (handled by dedicated meshes). */
const SKIP_TYPES = new Set<CellType>([CellType.Hill, CellType.Road]);
/** Industry types: drawn by Industries.tsx, but need a grass base beneath. */
const INDUSTRY_TYPES = new Set<CellType>([CellType.LumberMill, CellType.Mine]);

export function MapGrid({ map, cellSize }: MapGridProps) {
  // Bucket cell coordinates by type so each type becomes one InstancedMesh.
  // Hills (custom ramp geometry) and Roads (may sit on hills) are drawn by
  // their own components, so they're skipped here.
  const buckets = useMemo(() => {
    const byType = new Map<CellType, Array<[number, number]>>();
    const push = (t: CellType, x: number, z: number) => {
      let arr = byType.get(t);
      if (!arr) {
        arr = [];
        byType.set(t, arr);
      }
      arr.push([x, z]);
    };
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        const t = map.cells[x][z];
        // A road on flat ground still needs a grass base tile beneath it; a
        // road on a hill sits on the hill body instead.
        if (t === CellType.Road) {
          if (map.heights[x][z] === 0) push(CellType.Empty, x, z);
          continue;
        }
        // Industries sit on grass: draw an Empty base, building drawn elsewhere.
        if (INDUSTRY_TYPES.has(t)) {
          push(CellType.Empty, x, z);
          continue;
        }
        if (SKIP_TYPES.has(t)) continue;
        push(t, x, z);
      }
    }
    return byType;
  }, [map]);

  const half = (map.size - 1) / 2;

  return (
    <group>
      {Array.from(buckets.entries()).map(([type, coords]) => (
        <TerrainInstances
          key={type}
          type={type}
          coords={coords}
          cellSize={cellSize}
          half={half}
        />
      ))}
    </group>
  );
}

interface TerrainInstancesProps {
  type: CellType;
  coords: Array<[number, number]>;
  cellSize: number;
  half: number;
}

function TerrainInstances({
  type,
  coords,
  cellSize,
  half,
}: TerrainInstancesProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const style = CELL_STYLE[type];

  // Position every instance once (static terrain) after mount.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const tileHeight = BASE_TILE_HEIGHT * cellSize;
    const scaledHeight = tileHeight * style.scaleY;

    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      const worldX = (x - half) * cellSize;
      const worldZ = (z - half) * cellSize;
      // Sit the tile on the floor: its center is half its (scaled) height up,
      // plus any per-type vertical offset (e.g. water sinks).
      const worldY = scaledHeight / 2 + style.offsetY * cellSize;

      dummy.position.set(worldX, worldY, worldZ);
      dummy.scale.set(cellSize, scaledHeight, cellSize);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [coords, cellSize, half, style.scaleY, style.offsetY]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, coords.length]}
      castShadow
      receiveShadow
    >
      {/* Unit box; per-instance matrix scales it to the right tile size. */}
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={style.color} roughness={0.85} />
    </instancedMesh>
  );
}
