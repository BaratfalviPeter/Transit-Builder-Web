/**
 * Hills — renders hills as ONE continuous, low-poly heightmap surface.
 *
 * Previously each hill was an isolated inset frustum, which produced spiky,
 * disconnected shapes with gaps. Instead we now build a single mesh over the
 * whole grid using a corner-vertex heightmap:
 *
 *   - The mesh has (size+1)×(size+1) vertices, one per cell *corner*.
 *   - A corner's height is the max height of the (up to 4) cells touching it.
 *   - So a hill cell's interior corners are all raised (flat top), while a
 *     corner shared with flat ground stays low — giving clean ramps that blend
 *     seamlessly into neighbouring flat cells and into adjacent hills, with no
 *     gaps or spikes.
 *
 * Only the hilly region is meshed (corners that are entirely at ground level
 * and not touching any hill are skipped), so flat areas keep using the cheap
 * box tiles from MapGrid. The surface base sits exactly on the flat-tile top so
 * there's no seam.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import type { PointerBuildHandlers } from './usePointerBuild';

export interface HillsProps {
  map: TerrainMap;
  cellSize: number;
  /**
   * Shared pointer handlers (click + drag build). Attaching them to the raised
   * hill mesh means the raycaster hits the actual slope geometry, so builds on
   * a hill use the correct cell (not the flat plane beneath it). The handlers
   * call stopPropagation to prevent the click passing through to that plane.
   */
  handlers?: PointerBuildHandlers;
}

// Flat tile top (grass surface) height, so the hill base lines up with it.
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

export function Hills({ map, cellSize, handlers }: HillsProps) {
  const geometry = useMemo(
    () => buildHillSurface(map, cellSize),
    [map, cellSize],
  );

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow {...handlers}>
      <meshStandardMaterial
        color={CELL_STYLE[CellType.Hill].color}
        roughness={0.95}
        flatShading
      />
    </mesh>
  );
}

/**
 * Build the continuous hill surface. Returns null if there are no hills.
 */
function buildHillSurface(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry | null {
  const { size, heights } = map;
  const half = (size - 1) / 2;

  // Height (world units) of a cell, 0 if out of bounds / not a hill.
  const cellHeight = (x: number, z: number): number => {
    if (x < 0 || z < 0 || x >= size || z >= size) return 0;
    return heights[x][z];
  };

  // Corner (cx, cz) in [0, size], its height = max of the up-to-4 cells around
  // it. Corner (cx, cz) touches cells (cx-1,cz-1), (cx,cz-1), (cx-1,cz), (cx,cz).
  const cornerHeight = (cx: number, cz: number): number => {
    return Math.max(
      cellHeight(cx - 1, cz - 1),
      cellHeight(cx, cz - 1),
      cellHeight(cx - 1, cz),
      cellHeight(cx, cz),
    );
  };

  // World position of corner (cx, cz). Cell centers are at (i-half)*cellSize,
  // so a cell spans [center - cellSize/2, center + cellSize/2]; corner cx is at
  // the boundary = (cx - half - 0.5) * cellSize.
  const base = FLAT_TOP * cellSize;
  const cornerWorld = (cx: number, cz: number): THREE.Vector3 => {
    const h = cornerHeight(cx, cz);
    return new THREE.Vector3(
      (cx - half - 0.5) * cellSize,
      base + h * cellSize,
      (cz - half - 0.5) * cellSize,
    );
  };

  // Emit two triangles per cell that is a hill OR borders a hill, so the ramp
  // skirts around the hill mass are included.
  const touchesHill = (x: number, z: number): boolean => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (cellHeight(x + dx, z + dz) > 0) return true;
      }
    }
    return false;
  };

  const positions: number[] = [];
  const addQuad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };

  let any = false;
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (!touchesHill(x, z)) continue;
      // Corners of this cell (CCW seen from above for upward normals).
      const c00 = cornerWorld(x, z);
      const c10 = cornerWorld(x + 1, z);
      const c11 = cornerWorld(x + 1, z + 1);
      const c01 = cornerWorld(x, z + 1);
      addQuad(c00, c01, c11, c10);
      any = true;
    }
  }

  if (!any) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}
