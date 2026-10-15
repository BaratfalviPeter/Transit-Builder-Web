/**
 * Roads — renders player-built road tiles.
 *
 * Flat-ground roads are thin dark tiles resting just above the grass, drawn as
 * one InstancedMesh (cheap).
 *
 * Hill roads conform to the slope: for each road cell that sits on elevation we
 * build a quad from the cell's four CORNER heights (the same corner-max
 * heightmap the hill surface uses), lifted slightly above the surface. This
 * makes the road take the hill's angle and height — flat hilltops stay flat,
 * ramp cells tilt along the slope, and diagonal/corner ramps are handled
 * naturally — instead of floating as a horizontal tile.
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
// Flat grass tile top; hill surface + hill roads sit relative to this.
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
// Small lift so the road never z-fights the hill surface it rests on.
const SURFACE_LIFT = 0.02;

export function Roads({ map, cellSize }: RoadsProps) {
  const flatCoords = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.Road && map.heights[x][z] === 0) {
          out.push([x, z]);
        }
      }
    }
    return out;
  }, [map]);

  return (
    <group>
      <FlatRoads coords={flatCoords} map={map} cellSize={cellSize} />
      <HillRoads map={map} cellSize={cellSize} />
    </group>
  );
}

/** Thin tiles for roads on flat ground. */
function FlatRoads({
  coords,
  map,
  cellSize,
}: {
  coords: Array<[number, number]>;
  map: TerrainMap;
  cellSize: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const thickness = ROAD_STYLE.scaleY * cellSize;
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      dummy.position.set(
        (x - half) * cellSize,
        thickness / 2 + ROAD_STYLE.offsetY * cellSize,
        (z - half) * cellSize,
      );
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

/** Slope-conforming surface for roads sitting on hills. */
function HillRoads({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const geometry = useMemo(
    () => buildHillRoadSurface(map, cellSize),
    [map, cellSize],
  );
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={ROAD_STYLE.color} roughness={0.85} />
    </mesh>
  );
}

function buildHillRoadSurface(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry | null {
  const { size, heights, cells } = map;
  const half = (size - 1) / 2;

  const cellHeight = (x: number, z: number): number =>
    x < 0 || z < 0 || x >= size || z >= size ? 0 : heights[x][z];

  // Corner height = max of the up-to-4 cells touching the corner (matches the
  // hill surface, so the road lies exactly on it).
  const cornerHeight = (cx: number, cz: number): number =>
    Math.max(
      cellHeight(cx - 1, cz - 1),
      cellHeight(cx, cz - 1),
      cellHeight(cx - 1, cz),
      cellHeight(cx, cz),
    );

  const base = FLAT_TOP * cellSize + SURFACE_LIFT * cellSize;
  const corner = (cx: number, cz: number): THREE.Vector3 =>
    new THREE.Vector3(
      (cx - half - 0.5) * cellSize,
      base + cornerHeight(cx, cz) * cellSize,
      (cz - half - 0.5) * cellSize,
    );

  const positions: number[] = [];
  let any = false;
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (cells[x][z] !== CellType.Road || heights[x][z] === 0) continue;
      const c00 = corner(x, z);
      const c10 = corner(x + 1, z);
      const c11 = corner(x + 1, z + 1);
      const c01 = corner(x, z + 1);
      // Two triangles (CCW from above).
      positions.push(c00.x, c00.y, c00.z, c01.x, c01.y, c01.z, c11.x, c11.y, c11.z);
      positions.push(c00.x, c00.y, c00.z, c11.x, c11.y, c11.z, c10.x, c10.y, c10.z);
      any = true;
    }
  }
  if (!any) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}
