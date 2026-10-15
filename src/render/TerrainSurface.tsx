/**
 * TerrainSurface — ONE continuous, low-poly heightmap mesh for the whole map,
 * built as a SOLID block so there are never see-through gaps at height steps
 * (water pools, hill edges, borders).
 *
 * FIXED-BUFFER design (robust + fast):
 *   Every cell always contributes the SAME, fixed set of vertices:
 *     - 1 top quad   (6 verts)
 *     - 4 side walls (one per edge: -X, +X, -Z, +Z), each a quad = 6 verts
 *   => 30 vertices per cell, laid out in row-major (x*size + z) order.
 *   The buffer size NEVER changes, so terraforming can't reallocate, swap the
 *   mesh, or make geometry disappear. Each column is a little solid block from
 *   its top surface down to a floor below the base; adjacent columns share
 *   coplanar inner walls (hidden), and only exposed walls at steps/borders show.
 *
 * Terraforming patches ONLY the Y of the affected cells' (and their
 * neighbours') top + wall-top vertices directly in the position buffer, then
 * sets needsUpdate — no React re-render, no reallocation.
 */

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { CellType, cornerHeightAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import type { PointerBuildHandlers } from './usePointerBuild';

export interface TerrainSurfaceProps {
  map: TerrainMap;
  cellSize: number;
  handlers?: PointerBuildHandlers;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const WATER_SINK = 0.2;
/** How far below the grass base the solid block's floor sits (cellSize units). */
const FLOOR_DROP = 1.5;

const SIDE_COLOR = new THREE.Color('#4a4034'); // earthy side-wall tone

/** Vertices emitted per cell: 1 top quad + 4 side walls, each 6 verts. */
const VERTS_PER_CELL = 30;

function surfaceColor(type: CellType): THREE.Color {
  switch (type) {
    case CellType.Water:
      return new THREE.Color(CELL_STYLE[CellType.Water].color);
    case CellType.Forest:
      return new THREE.Color(CELL_STYLE[CellType.Forest].color);
    case CellType.Hill:
      return new THREE.Color(CELL_STYLE[CellType.Hill].color);
    case CellType.CityCenter:
      return new THREE.Color(CELL_STYLE[CellType.CityCenter].color);
    default:
      return new THREE.Color(CELL_STYLE[CellType.Empty].color);
  }
}

export function TerrainSurface({ map, cellSize, handlers }: TerrainSurfaceProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const builtForRef = useRef<{ seed: number; size: number; cellSize: number } | null>(
    null,
  );
  const prevMapRef = useRef<TerrainMap | null>(null);

  useLayoutEffect(() => {
    const needsFullBuild =
      !geomRef.current ||
      !builtForRef.current ||
      builtForRef.current.seed !== map.seed ||
      builtForRef.current.size !== map.size ||
      builtForRef.current.cellSize !== cellSize;

    if (needsFullBuild) {
      geomRef.current?.dispose();
      geomRef.current = buildTerrainGeometry(map, cellSize);
      builtForRef.current = { seed: map.seed, size: map.size, cellSize };
      prevMapRef.current = map;
      if (meshRef.current) meshRef.current.geometry = geomRef.current;
      return;
    }

    const prev = prevMapRef.current;
    if (prev && prev !== map) {
      patchChangedCells(geomRef.current!, prev, map, cellSize);
      prevMapRef.current = map;
    }
  }, [map, cellSize]);

  return (
    <mesh ref={meshRef} receiveShadow castShadow {...handlers}>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

// --- Shared geometry math ---------------------------------------------------

function cellSink(type: CellType, cellSize: number): number {
  return type === CellType.Water ? WATER_SINK * cellSize : 0;
}

/** World Y of a cell corner (corner-max heightmap), minus the cell's sink. */
function cornerY(
  map: TerrainMap,
  cx: number,
  cz: number,
  cellSize: number,
  sink: number,
): number {
  return FLAT_TOP * cellSize + cornerHeightAt(map, cx, cz) * cellSize - sink;
}

/**
 * Write a single cell's 30 vertices (top quad + 4 side walls) into `pos`/`col`
 * starting at vertex index `base`. Used by both the full build and patching, so
 * the layout is guaranteed identical.
 */
function writeCell(
  pos: Float32Array,
  col: Float32Array,
  base: number,
  map: TerrainMap,
  x: number,
  z: number,
  cellSize: number,
): void {
  const { size } = map;
  const half = (size - 1) / 2;
  const floorY = FLAT_TOP * cellSize - FLOOR_DROP * cellSize;
  const sink = cellSink(map.cells[x][z], cellSize);

  const wx = (cx: number) => (cx - half - 0.5) * cellSize;
  const wz = (cz: number) => (cz - half - 0.5) * cellSize;
  const y = (cx: number, cz: number) => cornerY(map, cx, cz, cellSize, sink);

  const top = surfaceColor(map.cells[x][z]);

  // 4 top corners.
  const x0 = wx(x);
  const x1 = wx(x + 1);
  const z0 = wz(z);
  const z1 = wz(z + 1);
  const y00 = y(x, z);
  const y10 = y(x + 1, z);
  const y11 = y(x + 1, z + 1);
  const y01 = y(x, z + 1);

  let o = base * 3;
  let co = base * 3;

  const put = (vx: number, vy: number, vz: number, c: THREE.Color) => {
    pos[o++] = vx;
    pos[o++] = vy;
    pos[o++] = vz;
    col[co++] = c.r;
    col[co++] = c.g;
    col[co++] = c.b;
  };

  // --- Top quad (CCW from above): (x0,z0)->(x0,z1)->(x1,z1)->(x1,z0) ---
  put(x0, y00, z0, top);
  put(x0, y01, z1, top);
  put(x1, y11, z1, top);
  put(x0, y00, z0, top);
  put(x1, y11, z1, top);
  put(x1, y10, z0, top);

  // --- 4 side walls, each from the top edge down to the floor ---
  // Wall helper writes 2 triangles (6 verts). Winding doesn't matter visually
  // because inner walls are hidden; we draw them single-sided-ish but with the
  // flatShading material they read fine from outside.
  const wall = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    // top a, top b, floor b | top a, floor b, floor a
    put(ax, ay, az, SIDE_COLOR);
    put(bx, by, bz, SIDE_COLOR);
    put(bx, floorY, bz, SIDE_COLOR);
    put(ax, ay, az, SIDE_COLOR);
    put(bx, floorY, bz, SIDE_COLOR);
    put(ax, floorY, az, SIDE_COLOR);
  };

  // -X edge (x0): from (x0,z1) to (x0,z0)
  wall(x0, y01, z1, x0, y00, z0);
  // +X edge (x1): from (x1,z0) to (x1,z1)
  wall(x1, y10, z0, x1, y11, z1);
  // -Z edge (z0): from (x0,z0) to (x1,z0)
  wall(x0, y00, z0, x1, y10, z0);
  // +Z edge (z1): from (x1,z1) to (x0,z1)
  wall(x1, y11, z1, x0, y01, z1);
}

// --- Full build -------------------------------------------------------------

function buildTerrainGeometry(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry {
  const { size } = map;
  const vertexCount = size * size * VERTS_PER_CELL;
  const pos = new Float32Array(vertexCount * 3);
  const col = new Float32Array(vertexCount * 3);

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const base = (x * size + z) * VERTS_PER_CELL;
      writeCell(pos, col, base, map, x, z, cellSize);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

// --- Incremental patch (fixed buffer, Y + colors only) ----------------------

/**
 * Rewrite only the cells whose height/type changed between `prev` and `next`,
 * plus their 8-neighbourhood (corner-max coupling), directly in the existing
 * fixed-size buffers. No reallocation, no mesh swap, no React render.
 */
function patchChangedCells(
  geom: THREE.BufferGeometry,
  prev: TerrainMap,
  next: TerrainMap,
  cellSize: number,
): void {
  const size = next.size;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const col = colAttr.array as Float32Array;

  const affected = new Set<number>();
  const mark = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= size || z >= size) return;
    affected.add(x * size + z);
  };
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (
        next.cells[x][z] !== prev.cells[x][z] ||
        next.heights[x][z] !== prev.heights[x][z]
      ) {
        // A cell's corners (and its neighbours' shared corners) use corner-max,
        // so re-emit the whole 8-neighbourhood to keep walls/top consistent.
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) mark(x + dx, z + dz);
      }
    }
  }
  if (affected.size === 0) return;

  for (const idx of affected) {
    const x = Math.floor(idx / size);
    const z = idx % size;
    const base = idx * VERTS_PER_CELL;
    writeCell(pos, col, base, next, x, z, cellSize);
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}
