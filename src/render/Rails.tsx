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

const SLEEPERS_PER_CELL = 4;

function isFlatRail(map: TerrainMap, x: number, z: number): boolean {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  return h00 === h10 && h10 === h11 && h11 === h01;
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

/** Flat rail cells: gravel bed + sleepers + two rails, all instanced. */
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
  const sleeperRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);
  const half = (map.size - 1) / 2;

  useLayoutEffect(() => {
    const bed = bedRef.current;
    const sleeper = sleeperRef.current;
    const rail = railRef.current;
    if (!bed || !sleeper || !rail) return;

    const dummy = new THREE.Object3D();
    const bedThick = RAIL_STYLE.scaleY * cellSize;
    const sleeperH = 0.05 * cellSize;
    const railH = 0.05 * cellSize;

    let si = 0;
    let ri = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x, z] = coords[i];
      const cx = (x - half) * cellSize;
      const cz = (z - half) * cellSize;
      const cornerH = cellCornerHeights(map, x, z)[0];
      const top = (FLAT_TOP + cornerH) * cellSize + SURFACE_LIFT * cellSize;

      // Gravel bed tile.
      dummy.position.set(cx, top + bedThick / 2, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(cellSize, bedThick, cellSize);
      dummy.updateMatrix();
      bed.setMatrixAt(i, dummy.matrix);

      // Sleepers (cross-ties) spanning the cell, spaced along Z.
      for (let s = 0; s < SLEEPERS_PER_CELL; s++) {
        const fz = (s + 0.5) / SLEEPERS_PER_CELL - 0.5; // -0.5..0.5
        dummy.position.set(cx, top + bedThick + sleeperH / 2, cz + fz * cellSize);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(cellSize * 0.8, sleeperH, cellSize * 0.12);
        dummy.updateMatrix();
        sleeper.setMatrixAt(si++, dummy.matrix);
      }

      // Two parallel rails running along Z, offset in X.
      for (const sx of [-0.25, 0.25]) {
        dummy.position.set(
          cx + sx * cellSize,
          top + bedThick + sleeperH + railH / 2,
          cz,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(cellSize * 0.06, railH, cellSize);
        dummy.updateMatrix();
        rail.setMatrixAt(ri++, dummy.matrix);
      }
    }

    bed.count = coords.length;
    sleeper.count = coords.length * SLEEPERS_PER_CELL;
    rail.count = coords.length * 2;
    bed.instanceMatrix.needsUpdate = true;
    sleeper.instanceMatrix.needsUpdate = true;
    rail.instanceMatrix.needsUpdate = true;
    bed.computeBoundingSphere();
    sleeper.computeBoundingSphere();
    rail.computeBoundingSphere();
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
          color={GRAVEL_COLOR}
          roughness={1}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
      <instancedMesh
        ref={sleeperRef}
        args={[undefined, undefined, coords.length * SLEEPERS_PER_CELL]}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SLEEPER_COLOR} roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={railRef}
        args={[undefined, undefined, coords.length * 2]}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
      </instancedMesh>
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
      <meshStandardMaterial color={GRAVEL_COLOR} roughness={1} />
    </mesh>
  );
}
