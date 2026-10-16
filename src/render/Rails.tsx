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

/** 2D point in cell-local (u, v) ∈ [-0.5, 0.5]. */
type P2 = [number, number];

/**
 * A raised 3D rail bar (a thin box cross-section) swept along a centre-line
 * polyline `pts` (cell-local u,v). Emits side walls + a top strip so the rail
 * reads as a solid steel bar, not a flat sticker. Local → world via wx/wz; the
 * bar sits between railY and railTop.
 */
function railBar(
  out: number[],
  pts: P2[],
  hw: number,
  railY: number,
  railTop: number,
  wx: (u: number) => number,
  wz: (v: number) => number,
): void {
  const L = pts.length;
  if (L < 2) return;
  // Per-point left/right offset points (world), using segment normals averaged
  // at joints so the ribbon keeps constant width around curves.
  const left: P2[] = [];
  const right: P2[] = [];
  for (let i = 0; i < L; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(L - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const n = Math.hypot(dx, dz) || 1;
    const nx = (-dz / n) * hw;
    const nz = (dx / n) * hw;
    left.push([pts[i][0] + nx, pts[i][1] + nz]);
    right.push([pts[i][0] - nx, pts[i][1] - nz]);
  }
  const W = (p: P2, y: number): [number, number, number] => [wx(p[0]), y, wz(p[1])];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < L - 1; i++) {
    const l0 = left[i], l1 = left[i + 1];
    const r0 = right[i], r1 = right[i + 1];
    // Top strip.
    quad(W(l0, railTop), W(l1, railTop), W(r1, railTop), W(r0, railTop));
    // Outer + inner side walls.
    quad(W(l0, railY), W(l1, railY), W(l1, railTop), W(l0, railTop));
    quad(W(r1, railY), W(r0, railY), W(r0, railTop), W(r1, railTop));
  }
}

/** Cubic Bézier sample at t for control points p0..p3. */
function bezier(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
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
    // Edge mid-points of the cell toward each side, in local (u, v).
    const EDGE: Record<'n' | 's' | 'e' | 'w', P2> = {
      n: [0, -0.5],
      s: [0, 0.5],
      e: [0.5, 0],
      w: [-0.5, 0],
    };
    const C: P2 = [0, 0];

    for (const [x, z] of coords) {
      const cornerH = cellCornerHeights(map, x, z)[0];
      const topBed = FLAT_TOP + cornerH + SURFACE_LIFT + bedThick;
      const sleeperY = (topBed + 0.03) * cellSize;
      const railY = (topBed + 0.05) * cellSize;
      const railTop = (topBed + 0.1) * cellSize;
      const cx = (x - half) * cellSize;
      const cz = (z - half) * cellSize;
      const wx = (u: number) => cx + u * cellSize;
      const wz = (v: number) => cz + v * cellSize;
      const gauge = RAIL_GAUGE;
      const hw = RAIL_HW * cellSize;

      const n = railConnects(map, x, z, 0, -1);
      const s = railConnects(map, x, z, 0, 1);
      const e = railConnects(map, x, z, 1, 0);
      const w = railConnects(map, x, z, -1, 0);
      const sides = (['n', 's', 'e', 'w'] as const).filter((k) => ({ n, s, e, w }[k]));
      const count = sides.length;

      // Perpendicular unit (in u,v) of a direction, for the two rail offsets.
      const perp = (p: P2): P2 => {
        const n2 = Math.hypot(p[0], p[1]) || 1;
        return [-p[1] / n2, p[0] / n2];
      };

      /** Both steel rails + sleepers along a centre-line polyline. */
      const track = (pts: P2[]) => {
        for (const sgn of [-1, 1]) {
          const rail: P2[] = pts.map((p, i) => {
            const a = pts[Math.max(0, i - 1)];
            const b = pts[Math.min(pts.length - 1, i + 1)];
            const pv = perp([b[0] - a[0], b[1] - a[1]]);
            return [p[0] + pv[0] * gauge * sgn, p[1] + pv[1] * gauge * sgn];
          });
          railBar(R, rail, hw, railY, railTop, wx, wz);
        }
        // Sleepers across the centre-line at a roughly even arc spacing.
        let acc = SLEEPER_PITCH / 2;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
          while (acc <= seg) {
            const t = acc / seg;
            const mx = a[0] + (b[0] - a[0]) * t;
            const mz = a[1] + (b[1] - a[1]) * t;
            const pv = perp([b[0] - a[0], b[1] - a[1]]);
            ribbon(
              S,
              wx(mx + pv[0] * SLEEPER_HALF), wz(mz + pv[1] * SLEEPER_HALF),
              wx(mx - pv[0] * SLEEPER_HALF), wz(mz - pv[1] * SLEEPER_HALF),
              sleeperY, SLEEPER_HW * cellSize,
            );
            acc += SLEEPER_PITCH;
          }
          acc -= seg;
        }
      };

      /** Sample a cell edge→edge path: straight if opposite, Bézier if a bend. */
      const path = (from: P2, to: P2): P2[] => {
        const opposite = Math.abs(from[0] + to[0]) < 1e-6 && Math.abs(from[1] + to[1]) < 1e-6;
        if (opposite) return [from, to];
        // Sweeping curve: cubic Bézier whose end tangents point straight out of
        // each edge (so it meets the neighbour's straight rail with no kink),
        // handles pulled toward the centre for a gentle quarter-turn.
        const h = 0.55;
        const c1: P2 = [from[0] * (1 - h), from[1] * (1 - h)];
        const c2: P2 = [to[0] * (1 - h), to[1] * (1 - h)];
        const N = 12;
        const out: P2[] = [];
        for (let i = 0; i <= N; i++) out.push(bezier(from, c1, c2, to, i / N));
        return out;
      };

      if (count === 0) {
        track([[-0.22, 0], [0.22, 0]]); // lone stub
      } else if (count === 1) {
        track([C, EDGE[sides[0]]]); // dead-end: centre → the one edge
      } else if (count === 2) {
        // Straight or a sweeping curve between the two connected edges.
        track([...path(EDGE[sides[0]], EDGE[sides[1]])]);
      } else {
        // SWITCH / crossroad: pick the main through line (a straight pair if
        // present, else the first two edges) and draw it; every remaining arm
        // joins it as a sweeping-curve branch (Y-turnout).
        let mainA: 'n' | 's' | 'e' | 'w';
        let mainB: 'n' | 's' | 'e' | 'w';
        if (n && s) { mainA = 'n'; mainB = 's'; }
        else if (e && w) { mainA = 'e'; mainB = 'w'; }
        else { mainA = sides[0]; mainB = sides[1]; }
        track(path(EDGE[mainA], EDGE[mainB]));
        for (const k of sides) {
          if (k === mainA || k === mainB) continue;
          // Branch curves from its edge into the main line near the centre.
          track(path(EDGE[k], EDGE[mainB]));
        }
      }
    }
    const sg = S.length ? new THREE.BufferGeometry() : null;
    if (sg) { sg.setAttribute('position', new THREE.Float32BufferAttribute(S, 3)); sg.computeVertexNormals(); }
    const rg = R.length ? new THREE.BufferGeometry() : null;
    if (rg) { rg.setAttribute('position', new THREE.Float32BufferAttribute(R, 3)); rg.computeVertexNormals(); }
    return { sleeperGeom: sg, railGeom: rg };
  }, [coords, map, cellSize, half]);

  // Yellow switch levers: one per switch/crossroad cell, beside the track.
  const switches = useMemo(() => {
    const out: Array<[number, number, number]> = []; // world x, y, z
    const bedThick = RAIL_STYLE.scaleY;
    for (const [x, z] of coords) {
      let c = 0;
      if (railConnects(map, x, z, 0, -1)) c++;
      if (railConnects(map, x, z, 0, 1)) c++;
      if (railConnects(map, x, z, 1, 0)) c++;
      if (railConnects(map, x, z, -1, 0)) c++;
      if (c < 3) continue;
      const cornerH = cellCornerHeights(map, x, z)[0];
      const y = (FLAT_TOP + cornerH + SURFACE_LIFT + bedThick) * cellSize;
      out.push([(x - half + 0.32) * cellSize, y, (z - half + 0.32) * cellSize]);
    }
    return out;
  }, [coords, map, half, cellSize]);

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
      {switches.length > 0 && (
        <SwitchLevers positions={switches} cellSize={cellSize} />
      )}
    </group>
  );
}

/** Small yellow switch-stand lever beside each turnout, instanced. */
function SwitchLevers({ positions, cellSize }: { positions: Array<[number, number, number]>; cellSize: number }) {
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const leverRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const base = baseRef.current;
    const lever = leverRef.current;
    if (base) {
      positions.forEach(([x, y, z], i) => {
        d.position.set(x, y + 0.03 * cellSize, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(0.07 * cellSize, 0.06 * cellSize, 0.07 * cellSize);
        d.updateMatrix();
        base.setMatrixAt(i, d.matrix);
      });
      base.instanceMatrix.needsUpdate = true;
      base.computeBoundingSphere();
    }
    if (lever) {
      positions.forEach(([x, y, z], i) => {
        d.position.set(x, y + 0.12 * cellSize, z);
        d.rotation.set(0, 0, Math.PI / 5);
        d.scale.set(0.02 * cellSize, 0.14 * cellSize, 0.02 * cellSize);
        d.updateMatrix();
        lever.setMatrixAt(i, d.matrix);
      });
      lever.instanceMatrix.needsUpdate = true;
      lever.computeBoundingSphere();
    }
  }, [positions, cellSize]);
  return (
    <group>
      <instancedMesh key={`b${positions.length}`} ref={baseRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#2d2f34" roughness={0.6} metalness={0.3} />
      </instancedMesh>
      <instancedMesh key={`l${positions.length}`} ref={leverRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#e8b82e" roughness={0.5} />
      </instancedMesh>
    </group>
  );
}

/**
 * Rail cells on a slope: a conforming gravel bed PLUS sleepers and the two
 * rails, all laid ON the incline. Every piece is an axis-aligned rectangle in
 * the cell's (u, v) space, bilinearly lifted onto the cell's four corner
 * heights and wound counter-clockwise seen from above (front-facing), so the
 * track visibly climbs the ramp instead of only the gravel colour doing so.
 */
function SlopeRailBeds({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const geoms = useMemo(() => {
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
    const isTrack = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < size && z < size &&
      (cells[x][z] === CellType.Rail || cells[x][z] === CellType.Road);
    const bed: number[] = [];
    const ties: number[] = [];
    const rails: number[] = [];
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (cells[x][z] !== CellType.Rail) continue;
        const h00 = cornerHeight(x, z);
        const h10 = cornerHeight(x + 1, z);
        const h11 = cornerHeight(x + 1, z + 1);
        const h01 = cornerHeight(x, z + 1);
        if (h00 === h10 && h10 === h11 && h11 === h01) continue; // flat → FlatRails
        const px = (x - half - 0.5) * cellSize;
        const pz = (z - half - 0.5) * cellSize;
        // Surface point at (u, v) ∈ [0,1]², lifted `lift` cell units.
        const surf = (u: number, v: number, lift: number): [number, number, number] => {
          const h = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
          return [px + u * cellSize, (FLAT_TOP + SURFACE_LIFT + h + lift) * cellSize, pz + v * cellSize];
        };
        // CCW-from-above rectangle (u0,v0)-(u1,v1), u0<u1, v0<v1.
        const rect = (out: number[], u0: number, v0: number, u1: number, v1: number, lift: number) => {
          const a = surf(u0, v0, lift);
          const b = surf(u0, v1, lift);
          const c = surf(u1, v1, lift);
          const d = surf(u1, v0, lift);
          out.push(...a, ...b, ...c, ...a, ...c, ...d);
        };
        rect(bed, 0, 0, 1, 1, 0);
        // Track direction: along X if it connects east/west, else along Z.
        const alongX = isTrack(x - 1, z) || isTrack(x + 1, z);
        const g0 = 0.5 - RAIL_GAUGE;
        const g1 = 0.5 + RAIL_GAUGE;
        for (let t = SLEEPER_PITCH / 2; t < 1; t += SLEEPER_PITCH) {
          const a0 = t - SLEEPER_HW;
          const a1 = t + SLEEPER_HW;
          const s0 = 0.5 - SLEEPER_HALF;
          const s1 = 0.5 + SLEEPER_HALF;
          if (alongX) rect(ties, a0, s0, a1, s1, 0.03);
          else rect(ties, s0, a0, s1, a1, 0.03);
        }
        for (const g of [g0, g1]) {
          if (alongX) rect(rails, 0, g - RAIL_HW, 1, g + RAIL_HW, 0.06);
          else rect(rails, g - RAIL_HW, 0, g + RAIL_HW, 1, 0.06);
        }
      }
    }
    const make = (arr: number[]) => {
      if (!arr.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    };
    return { bed: make(bed), ties: make(ties), rails: make(rails) };
  }, [map, cellSize]);

  if (!geoms.bed) return null;
  return (
    <group>
      <mesh geometry={geoms.bed} castShadow receiveShadow>
        <meshStandardMaterial ref={patchRef} color={GRAVEL_COLOR} roughness={1} />
      </mesh>
      {geoms.ties && (
        <mesh geometry={geoms.ties} castShadow>
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
      {geoms.rails && (
        <mesh geometry={geoms.rails} castShadow>
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
