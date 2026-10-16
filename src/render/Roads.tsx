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
import { useVisualKeys } from './visualSettings';

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
// Dash rhythm (cell units). Gap is HALF the dash length → airy centre-line.
const DASH = 0.17;
const GAP = DASH / 2;
const PITCH = DASH + GAP; // 0.255: centre-to-centre spacing of consecutive dashes

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

  // Tunable EXTRA rotation of the dashes inside a corner (degrees → radians).
  // 0 = aligned with the arc tangent (default); ± spins each corner dash in
  // place without moving it off the curve.
  const { roadCornerAngle } = useVisualKeys(['roadCornerAngle'] as const);
  const cornerRot = (roadCornerAngle * Math.PI) / 180;

  // Per-cell AUTO-TILED marking plan. We classify each road cell by its 4-
  // neighbour mask and emit the matching dash set, so the white line reads as a
  // real road network: straight runs get a centred dashed line, corners bend
  // through an arc of dashes, T/cross junctions send a line to every arm, and
  // dead-ends/lone tiles get a short stub. Each dash is a positioned, rotated
  // box (ox/oz in cell units, yaw radians, len in cell units).
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
        // Dashes from the centre out to the connected edge, at the shared
        // DASH/PITCH rhythm (airy: gap = half the dash length).
        const yaw = dirX !== 0 ? 0 : Math.PI / 2;
        for (let d = PITCH / 2; d <= 0.5 - DASH / 2 + 1e-6; d += PITCH) {
          push(dirX * d, dirZ * d, yaw, DASH);
        }
      };

      if (count === 0) {
        push(0, 0, 0, DASH * 0.8); // lone tile: a small centre dot
      } else if (count === 1) {
        // Dead end: arm toward the single neighbour (so the line reaches in).
        if (n) arm(0, -1);
        else if (s) arm(0, 1);
        else if (e) arm(1, 0);
        else arm(-1, 0);
      } else if (count === 2 && ((n && s) || (e && w))) {
        // Straight: one continuous dashed line across the whole cell, evenly
        // spaced and phase-aligned to the grid so neighbours line up.
        const yaw = n && s ? Math.PI / 2 : 0;
        for (let t = -0.5 + PITCH / 2; t < 0.5; t += PITCH) {
          push(n && s ? 0 : t, n && s ? t : 0, yaw, DASH);
        }
      } else if (count === 2) {
        // Corner: a quarter-circle fillet on the ROAD CENTRE-LINE, tangent to
        // both straight centre-lines. A circle tangent to the x- and z-centre
        // lines in the quadrant toward the two arms has radius 0.5 and centre
        // (dirX·0.5, dirZ·0.5); it touches the straights exactly at the two
        // edge mid-points (dirX·0.5, 0) and (0, dirZ·0.5), so the dashed line
        // flows straight → curve → straight with no kink and stays centred.
        const dirX = e ? 1 : -1;
        const dirZ = s ? 1 : -1;
        const R = 0.5;
        const cxArc = dirX * R;
        const czArc = dirZ * R;
        // Angle of each touch point as seen from the arc centre.
        const ang0 = Math.atan2(0 - czArc, dirX * 0.5 - cxArc); // → (dirX·0.5, 0)
        const ang1 = Math.atan2(dirZ * 0.5 - czArc, 0 - cxArc); // → (0, dirZ·0.5)
        let span = ang1 - ang0;
        if (span > Math.PI) span -= Math.PI * 2;
        if (span < -Math.PI) span += Math.PI * 2; // the 90° (short) way
        const arcLen = Math.abs(span) * R;
        // The dashes sit on the fixed quarter-arc; each one's ORIENTATION is
        // the arc tangent (a + 90°) PLUS the user-tunable extra rotation
        // `cornerRot` (radians, 0 = tangent/default). This lets the player spin
        // the corner dashes without moving them off the curve.
        const N = Math.max(2, Math.round(arcLen / PITCH) + 1);
        for (let i = 0; i < N; i++) {
          const a = ang0 + (span * i) / (N - 1); // include both endpoints
          push(cxArc + Math.cos(a) * R, czArc + Math.sin(a) * R, a + Math.PI / 2 + cornerRot, DASH);
        }
      } else {
        // T-junction (3) or crossroad (4): a dashed line toward each arm, same
        // rhythm, with a small centre square so the arms visually meet.
        push(0, 0, 0, DASH * 0.7);
        const armDashes = (dirX: number, dirZ: number) => {
          const yaw = dirX !== 0 ? 0 : Math.PI / 2;
          for (let d = PITCH; d <= 0.5 - DASH / 2 + 1e-6; d += PITCH) {
            push(dirX * d, dirZ * d, yaw, DASH);
          }
        };
        if (n) armDashes(0, -1);
        if (s) armDashes(0, 1);
        if (e) armDashes(1, 0);
        if (w) armDashes(-1, 0);
      }
    }
    return out;
  }, [coords, map, cellSize, roadCornerAngle]);

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

/** Slope-conforming surface for roads sitting on hills, with centre-lines. */
function HillRoads({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const geometry = useMemo(
    () => buildHillRoadSurface(map, cellSize),
    [map, cellSize],
  );
  const markGeom = useMemo(
    () => buildHillRoadMarkings(map, cellSize),
    [map, cellSize],
  );
  if (!geometry) return null;
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial ref={patchRef} color={ROAD_STYLE.color} roughness={0.85} />
      </mesh>
      {markGeom && (
        <mesh geometry={markGeom}>
          <meshStandardMaterial
            color="#e8e4d6"
            roughness={0.7}
            emissive="#2a2824"
            emissiveIntensity={0.4}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Dashed centre-line for the SLOPED road cells. For each such cell we read its
 * four corner heights (same corner-max map the surface uses), then lay a run of
 * dashes along the cell's dominant down-slope axis, bilinearly sampling the
 * surface height and lifting each dash a touch along the face so it hugs the
 * incline. One merged geometry (a handful of quads) — hill roads are few.
 */
function buildHillRoadMarkings(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry | null {
  const { size, heights, cells } = map;
  const half = (size - 1) / 2;
  const cellHeight = (x: number, z: number): number =>
    x < 0 || z < 0 || x >= size || z >= size ? 0 : heights[x][z];
  const cornerHeight = (cx: number, cz: number): number =>
    Math.max(
      cellHeight(cx - 1, cz - 1),
      cellHeight(cx, cz - 1),
      cellHeight(cx - 1, cz),
      cellHeight(cx, cz),
    );
  // Lift the centre-line clearly above the sloped asphalt. On a tilt a tiny
  // offset loses to the surface at grazing angles, so we raise it more than the
  // flat-road markings and also keep polygonOffset on the material.
  const base = FLAT_TOP * cellSize + (SURFACE_LIFT + 0.05) * cellSize;

  const isRoadLike = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= size || z >= size) return false;
    const t = cells[x][z];
    return t === CellType.Road || t === CellType.Rail;
  };

  const positions: number[] = [];
  const DASH_W = 0.06;
  let any = false;

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (cells[x][z] !== CellType.Road) continue;
      const h00 = cornerHeight(x, z);
      const h10 = cornerHeight(x + 1, z);
      const h11 = cornerHeight(x + 1, z + 1);
      const h01 = cornerHeight(x, z + 1);
      if (h00 === h10 && h10 === h11 && h11 === h01) continue; // flat → FlatRoads

      // Surface point at local (u,v) in [0,1]² within the cell.
      const px = (x - half - 0.5) * cellSize;
      const pz = (z - half - 0.5) * cellSize;
      const surf = (u: number, v: number): [number, number, number] => {
        const h = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
        return [px + u * cellSize, base + h * cellSize, pz + v * cellSize];
      };

      // Dominant axis = whichever direction has road neighbours (so the line
      // runs along the road), else the steeper slope direction.
      const alongX = isRoadLike(x - 1, z) || isRoadLike(x + 1, z);
      const dashLen = 0.17;
      const gap = dashLen / 2;
      const pitch = dashLen + gap;
      // March dashes from 0..1 along the axis, centred on the cell mid-line.
      for (let c = pitch / 2; c <= 1 - dashLen / 2 + 1e-6; c += pitch) {
        const a0 = c - dashLen / 2;
        const a1 = c + dashLen / 2;
        // Quad corners in (u,v): long axis = dominant, width = DASH_W.
        const w0 = 0.5 - DASH_W / 2;
        const w1 = 0.5 + DASH_W / 2;
        const quad = alongX
          ? [surf(a0, w0), surf(a1, w0), surf(a1, w1), surf(a0, w1)]
          : [surf(w0, a0), surf(w0, a1), surf(w1, a1), surf(w1, a0)];
        const [q0, q1, q2, q3] = quad;
        positions.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
        any = true;
      }
    }
  }
  if (!any) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
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
