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

  // Per-cell AUTO-TILED marking plan. We classify each road cell by its 4-
  // neighbour mask and emit the matching dash set, so the white line reads as a
  // real road network: straight runs get a centred dashed line, corners bend
  // through a quarter-arc of dashes, T/cross junctions send a line to every
  // arm, and dead-ends/lone tiles get a short stub. Each dash is a positioned,
  // rotated box (ox/oz in cell units, yaw radians, len in cell units).
  const marks = useMemo(() => {
    const out: Array<{ x: number; z: number; ox: number; oz: number; yaw: number; len: number; surfaceTop: number }> = [];
    for (const [x, z] of coords) {
      const cornerH = cellCornerHeights(map, x, z)[0];
      const surfaceTop = (FLAT_TOP + cornerH) * cellSize;
      const push = (ox: number, oz: number, yaw: number, len: number) =>
        out.push({ x, z, ox, oz, yaw, len, surfaceTop });

      const n = connects(map, x, z, 0, -1);
      const s = connects(map, x, z, 0, 1);
      const e = connects(map, x, z, 1, 0);
      const w = connects(map, x, z, -1, 0);
      const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);

      // A straight dash "arm" from the centre out toward one side (3 dashes).
      const arm = (dirX: number, dirZ: number) => {
        const yaw = dirX !== 0 ? 0 : Math.PI / 2;
        for (let i = 0; i < 3; i++) {
          const t = ((i + 0.5) / 3) * 0.5; // 0.08..0.42 from centre
          push(dirX * t, dirZ * t, yaw, 0.17);
        }
      };

      if (count === 0) {
        push(0, 0, 0, 0.14); // lone tile: a centre dot
      } else if (count === 1) {
        // Dead end: arm toward the single neighbour (so the line reaches in).
        if (n) arm(0, -1);
        else if (s) arm(0, 1);
        else if (e) arm(1, 0);
        else arm(-1, 0);
      } else if (count === 2 && ((n && s) || (e && w))) {
        // Straight: one continuous dashed line across the whole cell.
        const yaw = n && s ? Math.PI / 2 : 0;
        for (let i = 0; i < 5; i++) {
          const t = (i - 2) * 0.2; // -0.4..0.4
          push(n && s ? 0 : t, n && s ? t : 0, yaw, 0.17);
        }
      } else if (count === 2) {
        // Corner: a quarter-arc of small dashes between the two arms. The two
        // connected sides define the bend; dashes follow a 90° arc of radius
        // ~0.3 centred on the inner corner.
        const dx = e ? 1 : w ? -1 : 0;
        const dz = s ? 1 : n ? -1 : 0;
        // Pick the two connected directions.
        const dirs: Array<[number, number]> = [];
        if (n) dirs.push([0, -1]);
        if (s) dirs.push([0, 1]);
        if (e) dirs.push([1, 0]);
        if (w) dirs.push([-1, 0]);
        const [a0, a1] = dirs;
        const R = 0.3;
        // Arc centre = opposite quadrant corner of the cell.
        const cxArc = -dx * R;
        const czArc = -dz * R;
        const ang0 = Math.atan2(a0[1] * 0.5 - czArc, a0[0] * 0.5 - cxArc);
        let ang1 = Math.atan2(a1[1] * 0.5 - czArc, a1[0] * 0.5 - cxArc);
        if (ang1 - ang0 > Math.PI) ang1 -= Math.PI * 2;
        if (ang0 - ang1 > Math.PI) ang1 += Math.PI * 2;
        const N = 5;
        for (let i = 0; i < N; i++) {
          const a = ang0 + ((ang1 - ang0) * (i + 0.5)) / N;
          push(cxArc + Math.cos(a) * R, czArc + Math.sin(a) * R, a + Math.PI / 2, 0.15);
        }
      } else {
        // T-junction (3) or crossroad (4): a short dash toward each arm, with a
        // small centre square so the arms visually meet.
        push(0, 0, 0, 0.1);
        if (n) { push(0, -0.3, Math.PI / 2, 0.17); push(0, -0.44, Math.PI / 2, 0.12); }
        if (s) { push(0, 0.3, Math.PI / 2, 0.17); push(0, 0.44, Math.PI / 2, 0.12); }
        if (e) { push(0.3, 0, 0, 0.17); push(0.44, 0, 0, 0.12); }
        if (w) { push(-0.3, 0, 0, 0.17); push(-0.44, 0, 0, 0.12); }
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
      const dashW = 0.06 * cellSize;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const cx = (m.x - half) * cellSize;
        const cz = (m.z - half) * cellSize;
        dummy.position.set(
          cx + m.ox * cellSize,
          m.surfaceTop + topLift,
          cz + m.oz * cellSize,
        );
        // Dash is long along local X; yaw (around Y) points it along the arm.
        dummy.scale.set(m.len * cellSize, 0.02 * cellSize, dashW);
        dummy.rotation.set(0, m.yaw, 0);
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
