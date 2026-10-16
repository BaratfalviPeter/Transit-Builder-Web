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
import { patchRef } from './cloudShadows';

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

// White lane-marking material (bright, unlit-ish so it reads on dark asphalt).
const MARKING_MAT = new THREE.MeshStandardMaterial({
  color: '#e8e4d6',
  roughness: 0.7,
  emissive: '#2a2824',
  emissiveIntensity: 0.4,
});
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
patchRef(MARKING_MAT);
const MARK_LIFT = 0.012; // markings sit just above the asphalt top

/** Does cell (x,z) connect to a road-like cell (road/rail) one step away? */
function connects(map: TerrainMap, x: number, z: number, dx: number, dz: number): boolean {
  const nx = x + dx;
  const nz = z + dz;
  if (nx < 0 || nz < 0 || nx >= map.size || nz >= map.size) return false;
  const t = map.cells[nx][nz];
  return t === CellType.Road || t === CellType.Rail;
}

/**
 * Thin asphalt tiles for roads on flat ground, PLUS dashed white centre-line
 * markings. Both are single InstancedMeshes (2 draw calls for every flat road
 * on the map). The dashes are laid toward each orthogonal neighbour that is
 * also a road/rail, so straight runs get a dashed line, corners/T/cross
 * junctions get dashes toward every arm, and a lone/dead-end tile gets a short
 * centre stub — orientation comes for free from the connection direction, no
 * texture needed.
 */
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
  const markRef = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  // Per-cell surface top + a flat dash plan, computed once per road set.
  const marks = useMemo(() => {
    const out: Array<{ x: number; z: number; dir: 'x' | 'z'; frac: number; surfaceTop: number }> = [];
    const DASHES = 3; // dashes along a full edge→centre arm
    for (const [x, z] of coords) {
      const cornerH = cellCornerHeights(map, x, z)[0];
      const surfaceTop = (FLAT_TOP + cornerH) * cellSize;
      const n = connects(map, x, z, 0, -1);
      const s = connects(map, x, z, 0, 1);
      const e = connects(map, x, z, 1, 0);
      const w = connects(map, x, z, -1, 0);
      const arms: Array<['x' | 'z', number]> = [];
      // Each arm: dashes from the cell centre out toward that neighbour.
      if (n) arms.push(['z', -1]);
      if (s) arms.push(['z', 1]);
      if (e) arms.push(['x', 1]);
      if (w) arms.push(['x', -1]);
      if (arms.length === 0) {
        out.push({ x, z, dir: 'x', frac: 0, surfaceTop }); // lone tile: centre dot
        continue;
      }
      for (const [dir, sign] of arms) {
        for (let i = 0; i < DASHES; i++) {
          // Positions 0 (centre) .. ~0.45 (near the edge), skipping the very
          // centre on straight runs so the dashes read as one continuous line.
          const frac = sign * ((i + 0.5) / DASHES) * 0.5;
          out.push({ x, z, dir, frac, surfaceTop });
        }
      }
    }
    return out;
  }, [coords, map, cellSize]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (mesh) {
      const dummy = new THREE.Object3D();
      const thickness = ROAD_STYLE.scaleY * cellSize;
      for (let i = 0; i < coords.length; i++) {
        const [x, z] = coords[i];
        const cornerH = cellCornerHeights(map, x, z)[0];
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
    }

    const mk = markRef.current;
    if (mk) {
      const dummy = new THREE.Object3D();
      const topLift = ROAD_STYLE.scaleY * cellSize + (SURFACE_LIFT + MARK_LIFT) * cellSize;
      const dashLen = 0.16 * cellSize;
      const dashW = 0.06 * cellSize;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const cx = (m.x - half) * cellSize;
        const cz = (m.z - half) * cellSize;
        const along = m.frac * cellSize;
        dummy.position.set(
          cx + (m.dir === 'x' ? along : 0),
          m.surfaceTop + topLift,
          cz + (m.dir === 'z' ? along : 0),
        );
        // Long axis points along the arm direction.
        if (m.dir === 'x') dummy.scale.set(dashLen, 0.02 * cellSize, dashW);
        else dummy.scale.set(dashW, 0.02 * cellSize, dashLen);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mk.setMatrixAt(i, dummy.matrix);
      }
      mk.count = marks.length;
      mk.instanceMatrix.needsUpdate = true;
      mk.computeBoundingSphere();
    }
  }, [coords, marks, cellSize, half, map]);

  if (coords.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={ref}
        args={[UNIT_BOX, undefined, coords.length]}
        castShadow
        receiveShadow
      >
        {/* polygonOffset pulls the road's polygons toward the camera in the
            depth buffer so they always win over the coplanar grass tile — a
            robust z-fighting fix on top of the small Y lift. */}
        <meshStandardMaterial
          ref={patchRef}
          color={ROAD_STYLE.color}
          roughness={0.8}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
      {marks.length > 0 && (
        <instancedMesh
          key={marks.length}
          ref={markRef}
          args={[UNIT_BOX, MARKING_MAT, marks.length]}
        />
      )}
    </group>
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
      <meshStandardMaterial
        ref={patchRef} color={ROAD_STYLE.color} roughness={0.85} />
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
