/**
 * Rails — renders player-built rail tiles (visual only for now).
 *
 * Mirrors Roads' flat-vs-slope split (via the shared corner-max heightmap), but
 * draws a railway look instead of a plain tile:
 *   - a gravel bed tile,
 *   - wooden sleepers (cross-ties) along the cell,
 *   - two parallel metal rails.
 * On sloped cells we draw a conforming gravel bed quad (sleepers/rails are kept
 * to flat cells to stay cheap); the rail still follows the incline.
 *
 * All elements use InstancedMesh so a long track stays a handful of draw calls.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, cellCornerHeights, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchRef } from './cloudShadows';

export interface RailsProps {
  map: TerrainMap;
  cellSize: number;
}

const RAIL_STYLE = CELL_STYLE[CellType.Rail];
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const SURFACE_LIFT = 0.02;

const GRAVEL_COLOR = RAIL_STYLE.color;
const SLEEPER_COLOR = '#5a3f27';
const RAIL_COLOR = '#9aa0a6';

/** Track geometry in cell units. */
const RAIL_GAUGE = 0.25; // half-distance between the two rails
const RAIL_HW = 0.03; // rail half-width
const SLEEPER_HALF = 0.34; // sleeper half-length (across the track)
const SLEEPER_HW = 0.055; // sleeper half-width (along the track)
const SLEEPER_PITCH = 0.22; // spacing of sleepers along the track

function isFlatRail(map: TerrainMap, x: number, z: number): boolean {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  return h00 === h10 && h10 === h11 && h11 === h01;
}

/** Does cell (x,z) connect to rail/road one step away? (rail auto-tiling) */
function railConnects(map: TerrainMap, x: number, z: number, dx: number, dz: number): boolean {
  const nx = x + dx;
  const nz = z + dz;
  if (nx < 0 || nz < 0 || nx >= map.size || nz >= map.size) return false;
  const t = map.cells[nx][nz];
  return t === CellType.Rail || t === CellType.Road;
}

export function Rails({ map, cellSize }: RailsProps) {
  const flatCoords = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = 0; x < map.size; x++) {
      for (let z = 0; z < map.size; z++) {
        if (map.cells[x][z] === CellType.Rail && isFlatRail(map, x, z)) {
          out.push([x, z]);
        }
      }
    }
    return out;
  }, [map]);

  return (
    <group>
      <FlatRails coords={flatCoords} map={map} cellSize={cellSize} />
      <SlopeRailBeds map={map} cellSize={cellSize} />
    </group>
  );
}

/** Flat ribbon quad on Y=y from (x0,z0)→(x1,z1), half-width hw, into `out`. */
function ribbon(
  out: number[],
  x0: number, z0: number, x1: number, z1: number,
  y: number, hw: number,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * hw;
  const nz = (dx / len) * hw;
  out.push(
    x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz,
    x0 + nx, y, z0 + nz, x1 - nx, y, z1 - nz, x0 - nx, y, z0 - nz,
  );
}

/**
 * Flat rail cells: an instanced gravel bed PLUS auto-tiled sleepers + two rails
 * built as merged ribbon geometry. The track follows the cell's connections:
 *   - straight: sleepers perpendicular to the run, two rails along it,
 *   - corner: the two rails curve through a 90° arc and sleepers fan along it,
 *   - T / cross: the through track is continuous; a branch adds a short spur,
 *   - dead-end / lone: a short stub of track.
 * This mirrors the road auto-tiling so rails read as a real, curving network.
 */
function FlatRails({
  coords,
  map,
  cellSize,
}: {
  coords: Array<[number, number]>;
  map: TerrainMap;
  cellSize: number;
}) {
  const bedRef = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  const { sleeperGeom, railGeom } = useMemo(() => {
    const S: number[] = []; // sleeper triangles (wood)
    const R: number[] = []; // rail triangles (metal)
    const bedThick = RAIL_STYLE.scaleY;
    for (const [x, z] of coords) {
      const cornerH = cellCornerHeights(map, x, z)[0];
      const topBed = FLAT_TOP + cornerH + SURFACE_LIFT + bedThick;
      const sleeperY = (topBed + 0.03) * cellSize;
      const railY = (topBed + 0.06) * cellSize;
      const cx = (x - half) * cellSize;
      const cz = (z - half) * cellSize;
      const wx = (u: number) => cx + u * cellSize;
      const wz = (v: number) => cz + v * cellSize;

      const n = railConnects(map, x, z, 0, -1);
      const s = railConnects(map, x, z, 0, 1);
      const e = railConnects(map, x, z, 1, 0);
      const w = railConnects(map, x, z, -1, 0);
      const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);

      // --- Straight track along an axis, from u0..u1 (the "along" coord) ---
      const straight = (axis: 'x' | 'z', a0: number, a1: number) => {
        const along = (t: number): [number, number] => (axis === 'x' ? [t, 0] : [0, t]);
        // Two rails offset across the track.
        for (const off of [-RAIL_GAUGE, RAIL_GAUGE]) {
          const p0 = along(a0), p1 = along(a1);
          if (axis === 'x') ribbon(R, wx(p0[0]), wz(off), wx(p1[0]), wz(off), railY, RAIL_HW * cellSize);
          else ribbon(R, wx(off), wz(p0[1]), wx(off), wz(p1[1]), railY, RAIL_HW * cellSize);
        }
        // Sleepers perpendicular, spaced along the run.
        for (let t = a0 + SLEEPER_PITCH / 2; t <= a1 - 1e-6; t += SLEEPER_PITCH) {
          if (axis === 'x') ribbon(S, wx(t), wz(-SLEEPER_HALF), wx(t), wz(SLEEPER_HALF), sleeperY, SLEEPER_HW * cellSize);
          else ribbon(S, wx(-SLEEPER_HALF), wz(t), wx(SLEEPER_HALF), wz(t), sleeperY, SLEEPER_HW * cellSize);
        }
      };

      // --- Curved corner track between two arms (e.g. E+S) ---
      const corner = () => {
        const dirX = e ? 1 : -1;
        const dirZ = s ? 1 : -1;
        const ccx = dirX * 0.5;
        const ccz = dirZ * 0.5;
        const a0 = Math.atan2(0 - ccz, dirX * 0.5 - ccx);
        let a1 = Math.atan2(dirZ * 0.5 - ccz, 0 - ccx);
        if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
        const NSEG = 10;
        // Two rails at radius 0.5 ± gauge; sleepers across them.
        for (const rr of [0.5 - RAIL_GAUGE, 0.5 + RAIL_GAUGE]) {
          let prev: [number, number] | null = null;
          for (let i = 0; i <= NSEG; i++) {
            const b = a0 + ((a1 - a0) * i) / NSEG;
            const p: [number, number] = [ccx + Math.cos(b) * rr, ccz + Math.sin(b) * rr];
            if (prev) ribbon(R, wx(prev[0]), wz(prev[1]), wx(p[0]), wz(p[1]), railY, RAIL_HW * cellSize);
            prev = p;
          }
        }
        const nTie = 5;
        for (let i = 0; i < nTie; i++) {
          const b = a0 + ((a1 - a0) * (i + 0.5)) / nTie;
          const inx = ccx + Math.cos(b) * (0.5 - SLEEPER_HALF);
          const inz = ccz + Math.sin(b) * (0.5 - SLEEPER_HALF);
          const ox = ccx + Math.cos(b) * (0.5 + SLEEPER_HALF);
          const oz = ccz + Math.sin(b) * (0.5 + SLEEPER_HALF);
          ribbon(S, wx(inx), wz(inz), wx(ox), wz(oz), sleeperY, SLEEPER_HW * cellSize);
        }
      };

      if (count === 0) {
        straight('x', -0.2, 0.2);
      } else if (count === 1) {
        if (n) straight('z', -0.5, 0);
        else if (s) straight('z', 0, 0.5);
        else if (e) straight('x', 0, 0.5);
        else straight('x', -0.5, 0);
      } else if (count === 2 && ((n && s) || (e && w))) {
        if (n && s) straight('z', -0.5, 0.5);
        else straight('x', -0.5, 0.5);
      } else if (count === 2) {
        corner();
      } else {
        // T / cross: straight through on each present axis (overlaps in centre).
        if (n || s) straight('z', n ? -0.5 : 0, s ? 0.5 : 0);
        if (e || w) straight('x', w ? -0.5 : 0, e ? 0.5 : 0);
      }
    }
    const sg = S.length ? new THREE.BufferGeometry() : null;
    if (sg) { sg.setAttribute('position', new THREE.Float32BufferAttribute(S, 3)); sg.computeVertexNormals(); }
    const rg = R.length ? new THREE.BufferGeometry() : null;
    if (rg) { rg.setAttribute('position', new THREE.Float32BufferAttribute(R, 3)); rg.computeVertexNormals(); }
    return { sleeperGeom: sg, railGeom: rg };
  }, [coords, map, cellSize, half]);

  useLayoutEffect(() => {
    const bed = bedRef.current;
    if (!bed) return;
    const dummy = new THREE.Object3D();
    const bedThick = RAIL_STYLE.scaleY * cellSize;
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      const cx = (x - half) * cellSize;
      const cz = (z - half) * cellSize;
      const cornerH = cellCornerHeights(map, x, z)[0];
      const top = (FLAT_TOP + cornerH) * cellSize + SURFACE_LIFT * cellSize;
      dummy.position.set(cx, top + bedThick / 2, cz);
      dummy.scale.set(cellSize, bedThick, cellSize);
      dummy.updateMatrix();
      bed.setMatrixAt(i, dummy.matrix);
    }
    bed.count = coords.length;
    bed.instanceMatrix.needsUpdate = true;
    bed.computeBoundingSphere();
  }, [coords, cellSize, half, map]);

  if (coords.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={bedRef}
        args={[undefined, undefined, coords.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          ref={patchRef}
          color={GRAVEL_COLOR}
          roughness={1}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
      {sleeperGeom && (
        <mesh geometry={sleeperGeom} castShadow>
          <meshStandardMaterial
            ref={patchRef}
            color={SLEEPER_COLOR}
            roughness={0.9}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
      {railGeom && (
        <mesh geometry={railGeom} castShadow>
          <meshStandardMaterial
            ref={patchRef}
            color={RAIL_COLOR}
            metalness={0.6}
            roughness={0.4}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
      )}
    </group>
  );
}

/** Conforming gravel bed for rail cells on a slope. */
function SlopeRailBeds({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const geometry = useMemo(() => {
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
    const flat = (x: number, z: number): boolean => {
      const a = cornerHeight(x, z);
      const b = cornerHeight(x + 1, z);
      const c = cornerHeight(x + 1, z + 1);
      const d = cornerHeight(x, z + 1);
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
        if (cells[x][z] !== CellType.Rail || flat(x, z)) continue;
        const c00 = corner(x, z);
        const c10 = corner(x + 1, z);
        const c11 = corner(x + 1, z + 1);
        const c01 = corner(x, z + 1);
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
  }, [map, cellSize]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        ref={patchRef} color={GRAVEL_COLOR} roughness={1} />
    </mesh>
  );
}
