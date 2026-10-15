/**
 * TerrainSurface — ONE continuous, low-poly heightmap mesh for the whole map,
 * built as a SOLID block (top surface + vertical side walls) so there are no
 * see-through gaps at height discontinuities (e.g. around sunken water).
 *
 * Performance: the geometry is built ONCE and kept in a ref. Terraforming does
 * NOT rebuild the whole mesh or swap it through React — instead we patch only
 * the affected cells' vertex positions/colors directly in the existing
 * attribute buffers and flag `needsUpdate`. The parent passes the current
 * `map` (whose `version` bumps on edits); we diff against the previous map and
 * update just the changed cells (plus their skirts).
 *
 * Layout (so patches can address a cell's vertices by index):
 *   - Top: 6 vertices per cell, cells in row-major (x*size + z) order.
 *   - Skirts: after the top block, 6 vertices per skirt quad; a lookup maps a
 *     cell to the skirt quads that depend on its corner heights.
 *
 * Picking: the mesh IS the real surface, so the raycaster hits it exactly on
 * flat ground and slopes; the shared build handlers are spread onto it.
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
/** The solid block's bottom, in cellSize units below the grass base. */
const FLOOR_DROP = 1.5;

const SIDE_COLOR = new THREE.Color('#4a4034'); // earthy side-wall tone

function surfaceColor(type: CellType): string {
  switch (type) {
    case CellType.Water:
      return CELL_STYLE[CellType.Water].color;
    case CellType.Forest:
      return CELL_STYLE[CellType.Forest].color;
    case CellType.Hill:
      return CELL_STYLE[CellType.Hill].color;
    case CellType.CityCenter:
      return CELL_STYLE[CellType.CityCenter].color;
    default:
      return CELL_STYLE[CellType.Empty].color;
  }
}

export function TerrainSurface({ map, cellSize, handlers }: TerrainSurfaceProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const builtForRef = useRef<{ seed: number; size: number; cellSize: number } | null>(
    null,
  );
  const prevMapRef = useRef<TerrainMap | null>(null);

  // Build (or rebuild) the whole geometry only when the map identity changes
  // (new seed/size) or cellSize changes — NOT on every terraform edit.
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

    // Incremental patch: only the cells whose heights/types changed since the
    // previous map get their vertices rewritten in place (fast, no realloc).
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

// --- Geometry layout helpers ------------------------------------------------

/** Y (world) of a cell corner, with a per-cell water sink applied. */
function cornerY(
  map: TerrainMap,
  cx: number,
  cz: number,
  cellSize: number,
  sink: number,
): number {
  return FLAT_TOP * cellSize + cornerHeightAt(map, cx, cz) * cellSize - sink;
}

function cellSink(type: CellType, cellSize: number): number {
  return type === CellType.Water ? WATER_SINK * cellSize : 0;
}

/** The 4 top-corner world positions of a cell (CCW from above). */
function cellCorners(
  map: TerrainMap,
  x: number,
  z: number,
  cellSize: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const half = (map.size - 1) / 2;
  const sink = cellSink(map.cells[x][z], cellSize);
  const wx = (cx: number) => (cx - half - 0.5) * cellSize;
  const wz = (cz: number) => (cz - half - 0.5) * cellSize;
  return [
    new THREE.Vector3(wx(x), cornerY(map, x, z, cellSize, sink), wz(z)),
    new THREE.Vector3(wx(x + 1), cornerY(map, x + 1, z, cellSize, sink), wz(z)),
    new THREE.Vector3(wx(x + 1), cornerY(map, x + 1, z + 1, cellSize, sink), wz(z + 1)),
    new THREE.Vector3(wx(x), cornerY(map, x, z + 1, cellSize, sink), wz(z + 1)),
  ];
}

// --- Full build -------------------------------------------------------------

function buildTerrainGeometry(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry {
  const { size, cells } = map;

  const positions: number[] = [];
  const colors: number[] = [];
  const col = new THREE.Color();

  const push = (v: THREE.Vector3, c: THREE.Color) => {
    positions.push(v.x, v.y, v.z);
    colors.push(c.r, c.g, c.b);
  };
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ) => {
    push(a, color);
    push(b, color);
    push(c, color);
    push(a, color);
    push(c, color);
    push(d, color);
  };

  // 1) TOP surface — 6 verts per cell, row-major (x*size+z). This block comes
  //    first so patchChangedCells can address a cell at offset (x*size+z)*6.
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      col.set(surfaceColor(cells[x][z]));
      const [c00, c10, c11, c01] = cellCorners(map, x, z, cellSize);
      quad(c00, c01, c11, c10, col);
    }
  }

  const topVertexCount = size * size * 6;

  // 2) SIDE WALLS (skirts) — close the block so there are no see-through gaps
  //    at height steps (water pools, hill edges, the outer border). Computed by
  //    the shared helper so the full build and incremental rebuild stay in sync.
  const walls = buildSideWalls(map, cellSize);
  for (let i = 0; i < walls.positions.length; i += 3) {
    positions.push(walls.positions[i], walls.positions[i + 1], walls.positions[i + 2]);
    colors.push(walls.colors[i], walls.colors[i + 1], walls.colors[i + 2]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  // Remember how many verts the TOP block uses, so patches know the layout.
  geom.userData.topVertexCount = topVertexCount;
  return geom;
}

// --- Incremental patch ------------------------------------------------------

/**
 * Rewrite only the TOP-surface vertices of cells whose height or type changed
 * between `prev` and `next`, directly in the existing position/color buffers.
 * We also rebuild the whole geometry's side walls lazily only if a change
 * occurred (walls are comparatively few); for a localized terraform edit this
 * stays cheap. Flags the attributes `needsUpdate` and recomputes normals.
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
  const colArr = colAttr.array as Float32Array;
  const color = new THREE.Color();

  // A cell's top vertices depend on its own corners, which depend on the
  // corner-max of neighbours — so if any cell changed, its 8-neighbourhood of
  // top quads may shift. Collect the affected cells.
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
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) mark(x + dx, z + dz);
      }
    }
  }
  if (affected.size === 0) return;

  // Rewrite each affected cell's 6 top vertices in place.
  for (const idx of affected) {
    const x = Math.floor(idx / size);
    const z = idx % size;
    const [c00, c10, c11, c01] = cellCorners(next, x, z, cellSize);
    color.set(surfaceColor(next.cells[x][z]));
    const base = idx * 6;
    const verts = [c00, c01, c11, c00, c11, c10];
    for (let k = 0; k < 6; k++) {
      const o = (base + k) * 3;
      pos[o] = verts[k].x;
      pos[o + 1] = verts[k].y;
      pos[o + 2] = verts[k].z;
      colArr[o] = color.r;
      colArr[o + 1] = color.g;
      colArr[o + 2] = color.b;
    }
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;

  // Side walls are only a few per edit; rebuild them fully (cheap) so new
  // steps around the edited cells get fresh skirts and no gaps remain.
  rebuildSideWalls(geom, next, cellSize);

  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}

/**
 * Rebuild just the SIDE-WALL portion of the geometry (everything after the top
 * block) in place. Because the number of walls can change, we grow the buffers
 * only if needed; otherwise we overwrite and zero out any trailing slots.
 */
function rebuildSideWalls(
  geom: THREE.BufferGeometry,
  map: TerrainMap,
  cellSize: number,
): void {
  const topCount: number = geom.userData.topVertexCount;
  const walls = buildSideWalls(map, cellSize);
  const needed = topCount + walls.positions.length / 3;

  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;

  if (needed > posAttr.count) {
    // Grow: allocate new buffers preserving the top block.
    const newPos = new Float32Array(needed * 3);
    const newCol = new Float32Array(needed * 3);
    newPos.set((posAttr.array as Float32Array).subarray(0, topCount * 3), 0);
    newCol.set((colAttr.array as Float32Array).subarray(0, topCount * 3), 0);
    newPos.set(walls.positions, topCount * 3);
    newCol.set(walls.colors, topCount * 3);
    geom.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(newCol, 3));
  } else {
    const pos = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;
    pos.set(walls.positions, topCount * 3);
    colArr.set(walls.colors, topCount * 3);
    // Degenerate any leftover wall slots (collapse to a point so they vanish).
    for (let i = topCount * 3 + walls.positions.length; i < pos.length; i++) {
      pos[i] = 0;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
  geom.setDrawRange(0, needed);
}

/** Compute the side-wall vertex/color arrays for the whole map. */
function buildSideWalls(
  map: TerrainMap,
  cellSize: number,
): { positions: Float32Array; colors: Float32Array } {
  const { size, cells } = map;
  const half = (size - 1) / 2;
  const floorY = FLAT_TOP * cellSize - FLOOR_DROP * cellSize;
  const positions: number[] = [];
  const colors: number[] = [];
  const wx = (cx: number) => (cx - half - 0.5) * cellSize;
  const wz = (cz: number) => (cz - half - 0.5) * cellSize;

  const edgeY = (cxCell: number, czCell: number, cornerCx: number, cornerCz: number) => {
    if (cxCell < 0 || czCell < 0 || cxCell >= size || czCell >= size) return floorY;
    const sink = cellSink(cells[cxCell][czCell], cellSize);
    return cornerY(map, cornerCx, cornerCz, cellSize, sink);
  };
  const wall = (
    ax: number,
    az: number,
    aTop: number,
    bx: number,
    bz: number,
    bTop: number,
  ) => {
    const quad = (p: THREE.Vector3[]) =>
      p.forEach((v) => {
        positions.push(v.x, v.y, v.z);
        colors.push(SIDE_COLOR.r, SIDE_COLOR.g, SIDE_COLOR.b);
      });
    const a = new THREE.Vector3(ax, aTop, az);
    const b = new THREE.Vector3(bx, bTop, bz);
    const bF = new THREE.Vector3(bx, floorY, bz);
    const aF = new THREE.Vector3(ax, floorY, az);
    quad([a, b, bF, a, bF, aF]);
    quad([aF, bF, b, aF, b, a]);
  };

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const myX1z = edgeY(x, z, x + 1, z);
      const myX1z1 = edgeY(x, z, x + 1, z + 1);
      const nbX1z = edgeY(x + 1, z, x + 1, z);
      const nbX1z1 = edgeY(x + 1, z, x + 1, z + 1);
      if (myX1z !== nbX1z || myX1z1 !== nbX1z1) {
        wall(wx(x + 1), wz(z), Math.max(myX1z, nbX1z), wx(x + 1), wz(z + 1), Math.max(myX1z1, nbX1z1));
      }
      const myZ1 = edgeY(x, z, x, z + 1);
      const myZ1x1 = edgeY(x, z, x + 1, z + 1);
      const nbZ1 = edgeY(x, z + 1, x, z + 1);
      const nbZ1x1 = edgeY(x, z + 1, x + 1, z + 1);
      if (myZ1 !== nbZ1 || myZ1x1 !== nbZ1x1) {
        wall(wx(x), wz(z + 1), Math.max(myZ1, nbZ1), wx(x + 1), wz(z + 1), Math.max(myZ1x1, nbZ1x1));
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}
