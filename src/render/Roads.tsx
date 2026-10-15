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
import { CellType, cellCornerHeights, type TerrainMap } from '../sim';
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

/**
 * A road cell is drawn FLAT only if all four of its corner heights are equal
 * (true flat ground, or a flat hilltop). If the corners differ the cell is on a
 * slope — even when its own nominal `heights[x][z]` is 0 (a ramp foot whose
 * corners rise toward a neighbouring hill) — so it must be drawn by HillRoads
 * to actually sit on the incline. This mirrors the build rule's corner-based
 * slope check, fixing roads that previously rendered flat at the slope's base.
 */
function isFlatRoad(map: TerrainMap, x: number, z: number): boolean {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  return h00 === h10 && h10 === h11 && h11 === h01;
}

export function Roads({ map, cellSize }: RoadsProps) {
  const flatCoords = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.Road && isFlatRoad(map, x, z)) {
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
    // Rest the road ON TOP of the surface. For a flat cell all corners are
    // equal, so the uniform corner height gives the tile's elevation (0 on flat
    // ground, or the hill top for a flat hilltop). Previously it was pinned to
    // grass level, so hilltop roads sank into the hill.
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      const cornerH = cellCornerHeights(map, x, z)[0]; // all equal => any corner
      const surfaceTop = (FLAT_TOP + cornerH) * cellSize;
      dummy.position.set(
        (x - half) * cellSize,
        surfaceTop + thickness / 2 + SURFACE_LIFT * cellSize,
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
      {/* polygonOffset pulls the road's polygons toward the camera in the depth
          buffer so they always win over the coplanar grass tile — a robust
          z-fighting fix on top of the small Y lift. */}
      <meshStandardMaterial
        color={ROAD_STYLE.color}
        roughness={0.8}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
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

  // A cell is flat iff its four corners are equal (handled by FlatRoads).
  const isFlatRoadCorners = (
    cornerH: (cx: number, cz: number) => number,
    x: number,
    z: number,
  ): boolean => {
    const a = cornerH(x, z);
    const b = cornerH(x + 1, z);
    const c = cornerH(x + 1, z + 1);
    const d = cornerH(x, z + 1);
    return a === b && b === c && c === d;
  };

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
      if (cells[x][z] !== CellType.Road) continue;
      // Only slope cells here; flat cells (all corners equal) are drawn as
      // tiles by FlatRoads. A ramp foot can have heights[x][z] === 0 yet have
      // unequal corners, so classify by corners — this is the fix for level-1
      // ramp roads previously rendering flat at the slope base.
      if (isFlatRoadCorners(cornerHeight, x, z)) continue;
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
