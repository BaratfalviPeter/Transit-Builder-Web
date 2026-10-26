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
import { activeControl, CellType, cellCornerHeights, hasRailAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchRef } from './cloudShadows';

export interface RoadsProps {
  map: TerrainMap;
  cellSize: number;
}

const ROAD_STYLE = CELL_STYLE[CellType.Road];
// Flat grass tile top; hill surface + hill roads sit relative to this.
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
// Small lift so the road never z-fights the hill surface it rests on (the
// road is a thin coat, like paint, not a raised slab).
const SURFACE_LIFT = 0.012;

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
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
patchRef(MARKING_MAT);
// Single, uniform Y for ALL flat markings so corner ends meet straights
// exactly. Must sit just ABOVE the asphalt tile top (tile top ≈ scaleY +
// SURFACE_LIFT ≈ 0.024 cell), else the marks are buried inside the asphalt.
const MARK_Y = ROAD_STYLE.scaleY + SURFACE_LIFT + 0.006; // ≈ 0.03 cell units
// Sized to the trucks (≈ 0.21 cell wide ≈ 2.5 m): a ~15 cm line, short dashes.
const DASH = 0.14;
const GAP = 0.12;
const PITCH = DASH + GAP; // 0.26
const DASH_W = 0.016; // half-width of a dash/line ribbon

/**
 * Does cell (x,z) connect to a road one step away? (Rails no longer count:
 * they connect through their own track pieces; a road meets a rail only at a
 * level crossing, which is itself a Road cell.)
 */
function connects(map: TerrainMap, x: number, z: number, dx: number, dz: number): boolean {
  const nx = x + dx;
  const nz = z + dz;
  if (nx < 0 || nz < 0 || nx >= map.size || nz >= map.size) return false;
  return map.cells[nx][nz] === CellType.Road;
}

/**
 * A flat ribbon quad on the Y=y plane, from point (x0,z0) to (x1,z1), with a
 * given half-width, pushed into the positions array as 2 triangles. The ribbon
 * is centred on the segment and perpendicular-extruded by `hw`.
 */
function ribbon(
  out: number[],
  x0: number, z0: number, x1: number, z1: number,
  y: number, hw: number,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * hw; // perpendicular
  const nz = (dx / len) * hw;
  const ax = x0 + nx, az = z0 + nz;
  const bx = x1 + nx, bz = z1 + nz;
  const cx = x1 - nx, cz = z1 - nz;
  const dx2 = x0 - nx, dz2 = z0 - nz;
  out.push(ax, y, az, bx, y, bz, cx, y, cz, ax, y, az, cx, y, cz, dx2, y, dz2);
}

/**
 * Thin asphalt tiles (instanced) for flat roads, PLUS one MERGED marking
 * geometry carrying the whole network's centre-lines. Building the markings as
 * real ribbon triangles — not rotated boxes — lets corners be a genuine
 * continuous 90° curve and T-junctions keep the main road running straight
 * while the branch stops at the junction edge. A separate merged "corner fill"
 * geometry adds small quarter-disc asphalt fillets so the outer road corners
 * read as rounded, not blocky. All markings share one Y (MARK_Y) so curve ends
 * meet the straights exactly.
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
  const half = (map.size - 1) / 2;

  const { markGeom } = useMemo(() => {
    const M: number[] = []; // marking (white) triangles

    for (const [x, z] of coords) {
      // Level crossing: no lane markings across the tracks; a roundabout has
      // its island instead.
      if (hasRailAt(map, x, z) || activeControl(map, x, z) === 'roundabout') continue;
      const cornerH = cellCornerHeights(map, x, z)[0];
      const topY = (FLAT_TOP + cornerH) * cellSize + MARK_Y * cellSize;
      // Cell centre in world space; local offsets are in cell units × cellSize.
      const cx = (x - half) * cellSize;
      const cz = (z - half) * cellSize;
      const hw = DASH_W * cellSize;
      // Local→world helpers (local coords in [-0.5,0.5] cell units).
      const wx = (u: number) => cx + u * cellSize;
      const wz = (v: number) => cz + v * cellSize;

      const n = connects(map, x, z, 0, -1);
      const s = connects(map, x, z, 0, 1);
      const e = connects(map, x, z, 1, 0);
      const w = connects(map, x, z, -1, 0);
      const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);

      // Dashed straight line between two local points, phase-aligned so the
      // pattern is continuous across cell boundaries.
      const dashedLine = (u0: number, v0: number, u1: number, v1: number) => {
        const L = Math.hypot(u1 - u0, v1 - v0);
        const du = (u1 - u0) / L;
        const dv = (v1 - v0) / L;
        // March in cell units; phase from the cell's world start so neighbours
        // line up. Start at the first dash centre ≥ u0.
        for (let t = DASH / 2; t <= L - DASH / 2 + 1e-6; t += PITCH) {
          const a0 = t - DASH / 2;
          const a1 = t + DASH / 2;
          ribbon(M, wx(u0 + du * a0), wz(v0 + dv * a0), wx(u0 + du * a1), wz(v0 + dv * a1), topY, hw);
        }
      };

      if (count === 0) {
        // Lone tile: a small centre dot.
        ribbon(M, wx(-DASH * 0.4), wz(0), wx(DASH * 0.4), wz(0), topY, hw);
      } else if (count === 1) {
        // Dead end: a dashed line from the centre to the connected edge.
        if (n) dashedLine(0, 0, 0, -0.5);
        else if (s) dashedLine(0, 0, 0, 0.5);
        else if (e) dashedLine(0, 0, 0.5, 0);
        else dashedLine(0, 0, -0.5, 0);
      } else if (count === 2 && ((n && s) || (e && w))) {
        // Straight: one continuous dashed line across the whole cell.
        if (n && s) dashedLine(0, -0.5, 0, 0.5);
        else dashedLine(-0.5, 0, 0.5, 0);
      } else if (count === 2) {
        // Corner: a REAL continuous 90° arc of the centre-line, radius 0.5,
        // centred on the cell corner between the two arms. The arc is built as
        // a chain of short ribbon segments that each follow the curve (so the
        // white line genuinely bends). It meets both straights exactly at the
        // edge mid-points, at the shared MARK_Y.
        const dirX = e ? 1 : -1;
        const dirZ = s ? 1 : -1;
        const R = 0.5;
        const ccx = dirX * R;
        const ccz = dirZ * R;
        const a0 = Math.atan2(0 - ccz, dirX * 0.5 - ccx); // → (dirX·0.5, 0)
        let a1 = Math.atan2(dirZ * 0.5 - ccz, 0 - ccx); // → (0, dirZ·0.5)
        if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
        const arcLen = Math.abs(a1 - a0) * R; // ≈ 0.785
        // Dash pattern ALONG the arc: alternate solid/gap by arc-length.
        const SEG = 0.02; // fine sub-segments for a smooth curve
        const nSeg = Math.max(8, Math.round(arcLen / SEG));
        for (let i = 0; i < nSeg; i++) {
          const t0 = i / nSeg;
          const t1 = (i + 1) / nSeg;
          // Dash on/off along the arc length at the shared PITCH rhythm.
          const sMid = ((t0 + t1) / 2) * arcLen;
          if (sMid % PITCH > DASH) continue; // in a gap
          const b0 = a0 + (a1 - a0) * t0;
          const b1 = a0 + (a1 - a0) * t1;
          ribbon(
            M,
            wx(ccx + Math.cos(b0) * R), wz(ccz + Math.sin(b0) * R),
            wx(ccx + Math.cos(b1) * R), wz(ccz + Math.sin(b1) * R),
            topY, hw,
          );
        }
      } else if (count === 3) {
        // T-junction: the THROUGH road (the two opposite arms) runs as one
        // continuous dashed line; the BRANCH arm stops at the junction edge of
        // the through road (does not poke to the centre).
        const throughNS = n && s;
        if (throughNS) dashedLine(0, -0.5, 0, 0.5);
        else dashedLine(-0.5, 0, 0.5, 0);
        // Branch: from its edge inward, stopping ~0.15 short of centre.
        if (!throughNS) {
          // branch is N or S
          if (n) dashedLine(0, -0.5, 0, -0.18);
          if (s) dashedLine(0, 0.5, 0, 0.18);
        } else {
          if (e) dashedLine(0.5, 0, 0.18, 0);
          if (w) dashedLine(-0.5, 0, -0.18, 0);
        }
      } else {
        // Crossroad (4): both through lines run continuously; they overlap in
        // the centre, which reads as a clean cross.
        dashedLine(0, -0.5, 0, 0.5);
        dashedLine(-0.5, 0, 0.5, 0);
      }
    }

    const mk = M.length ? new THREE.BufferGeometry() : null;
    if (mk) {
      mk.setAttribute('position', new THREE.Float32BufferAttribute(M, 3));
      mk.computeVertexNormals();
    }
    return { markGeom: mk };
  }, [coords, map, cellSize, half]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
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
  }, [coords, cellSize, half, map]);

  if (coords.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={ref}
        args={[UNIT_BOX, undefined, coords.length]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          ref={patchRef}
          color={ROAD_STYLE.color}
          roughness={0.8}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
      {markGeom && <mesh geometry={markGeom} material={MARKING_MAT} />}
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
  const base = FLAT_TOP * cellSize + (SURFACE_LIFT + 0.02) * cellSize;

  const isRoadLike = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= size || z >= size) return false;
    const t = cells[x][z];
    return t === CellType.Road;
  };

  const positions: number[] = [];
  const DASH_W = 0.032; // full width, same as the flat-road dashes (2 × 0.016)
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
        // Both orders wind counter-clockwise seen from ABOVE (normal up), so
        // the dashes are front faces. (The X order used to be clockwise →
        // back-face culled on the GPU → invisible on X-running ramps.)
        const quad = alongX
          ? [surf(a0, w0), surf(a0, w1), surf(a1, w1), surf(a1, w0)]
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
