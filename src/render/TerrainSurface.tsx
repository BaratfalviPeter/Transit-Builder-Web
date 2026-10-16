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

import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { CellType, cornerHeightAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import {
  getVisual,
  subscribeVisual,
  useVisualKeys,
  type VisualSettings,
} from './visualSettings';
import { patchCloudShadows } from './cloudShadows';
import type { PointerBuildHandlers } from './usePointerBuild';

export interface TerrainSurfaceProps {
  map: TerrainMap;
  cellSize: number;
  handlers?: PointerBuildHandlers;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const WATER_SINK = 0.2;
/**
 * Uniform water surface height (cellSize units). ALL water cells render their
 * top at this single level, regardless of how deep the basin was dug — so a
 * body of water reads as one flat, filled surface (never a see-through hole).
 * It sits just below the grass base so shorelines look right.
 */
const WATER_LEVEL = FLAT_TOP - WATER_SINK;
/** How far below the grass base the solid block's floor sits (cellSize units). */
const FLOOR_DROP = 1.5;

const SIDE_COLOR = new THREE.Color('#7a5536'); // warm brown earth (diorama cliff)
const TMP_COLOR = new THREE.Color();

/** Vertices emitted per cell: top (4 triangles = 12) + 4 side walls × 6. */
const VERTS_PER_CELL = 36;

// --- "Crumpled paper" grass ------------------------------------------------
//
// Each top is split into 4 triangles around a centre vertex. On plain grass
// (Empty) cells the centre is nudged up/down by a deterministic hash, and grass
// corners shared ONLY by grass cells get a smaller jitter too — so the meadow
// reads as gently crumpled low-poly paper. Corners touching anything else
// (roads, rails, buildings, industry lots, water, hills, map border) stay
// exact, so every overlay that rests on cornerHeightAt still sits flush.
// Non-grass cells put the centre on the original quad's diagonal, so their
// surface is exactly the same plane(s) as before.

/** Max centre displacement of a grass cell (cellSize units). */
const GRASS_CENTER_AMP = 0.07;
/** Max displacement of an all-grass corner (cellSize units). */
const GRASS_CORNER_AMP = 0.04;

/** Deterministic 0..1 hash of an integer pair + salt. */
function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function isGrass(map: TerrainMap, x: number, z: number): boolean {
  return (
    x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Empty
  );
}

/**
 * Whether cell (x, z) belongs to a Mine's 3×3 lot (the Mine centre or an
 * IndustryLot ring cell next to one). Those cells are rendered as a hole.
 */
export function isMineLot(map: TerrainMap, x: number, z: number): boolean {
  const t = map.cells[x][z];
  if (t === CellType.Mine) return true;
  if (t !== CellType.IndustryLot) return false;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < map.size && nz < map.size && map.cells[nx][nz] === CellType.Mine)
        return true;
    }
  return false;
}

/** Jitter of corner (cx, cz) — only if all four cells around it are grass. */
function cornerJitter(map: TerrainMap, cx: number, cz: number): number {
  if (
    !isGrass(map, cx - 1, cz - 1) ||
    !isGrass(map, cx, cz - 1) ||
    !isGrass(map, cx - 1, cz) ||
    !isGrass(map, cx, cz)
  )
    return 0;
  return (hash01(cx, cz, map.seed) * 2 - 1) * GRASS_CORNER_AMP;
}

/**
 * Live terrain palette, refreshed from the visual-settings store (the in-game
 * "Látvány" tuner). Mutable module state so writeCell stays allocation-free.
 */
const PAL = {
  grass: [] as THREE.Color[],
  hill: [] as THREE.Color[],
  forest: new THREE.Color(),
  water: new THREE.Color(),
  city: new THREE.Color(),
  wobble: 0.06,
};
/** Signature of the palette-relevant settings (to detect real changes). */
function paletteSig(v: VisualSettings): string {
  return [
    v.grass1, v.grass2, v.grass3, v.grass4, v.hill1, v.hill2, v.hill3,
    v.forestFloor, v.water, v.cliff, v.city, v.grassWobble,
  ].join('|');
}
function refreshPalette(v: VisualSettings): void {
  PAL.grass = [v.grass1, v.grass2, v.grass3, v.grass4].map((c) => new THREE.Color(c));
  PAL.hill = [v.hill1, v.hill2, v.hill3].map((c) => new THREE.Color(c));
  PAL.forest.set(v.forestFloor);
  PAL.water.set(v.water);
  PAL.city.set(v.city);
  SIDE_COLOR.set(v.cliff);
  PAL.wobble = v.grassWobble;
}
refreshPalette(getVisual());

/** Top colour of one top triangle (i = 0..3) of cell (x, z). */
function topColor(map: TerrainMap, x: number, z: number, i: number, out: THREE.Color): THREE.Color {
  const type = map.cells[x][z];
  let palette: THREE.Color[] | null = null;
  if (type === CellType.Empty || type === CellType.IndustryLot) palette = PAL.grass;
  else if (type === CellType.Hill) palette = PAL.hill;
  if (!palette) return out.copy(surfaceColor(type));
  const pick = Math.floor(hash01(x, z, map.seed + 17) * palette.length);
  out.copy(palette[pick]);
  // Small per-facet brightness wobble for an organic, hand-painted feel.
  const k = 1 - PAL.wobble / 2 + hash01(x * 4 + i, z, map.seed + 31) * PAL.wobble;
  return out.multiplyScalar(k);
}

function surfaceColor(type: CellType): THREE.Color {
  switch (type) {
    case CellType.Water:
      return PAL.water;
    case CellType.Forest:
      return PAL.forest;
    case CellType.Hill:
      return PAL.hill[0];
    case CellType.CityCenter:
      return PAL.city;
    default:
      return PAL.grass[0];
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

  // Live recolour from the tuner: rewrite every cell in the SAME buffers (the
  // positions come out identical, so no normal recompute is needed).
  useEffect(() => {
    let sig = paletteSig(getVisual());
    return subscribeVisual(() => {
      const v = getVisual();
      const next = paletteSig(v);
      if (next === sig) return;
      sig = next;
      refreshPalette(v);
      const geom = geomRef.current;
      const m = prevMapRef.current;
      if (!geom || !m) return;
      const pos = geom.getAttribute('position') as THREE.BufferAttribute;
      const col = geom.getAttribute('color') as THREE.BufferAttribute;
      for (let x = 0; x < m.size; x++)
        for (let z = 0; z < m.size; z++)
          writeCell(
            pos.array as Float32Array,
            col.array as Float32Array,
            (x * m.size + z) * VERTS_PER_CELL,
            m, x, z, builtForRef.current!.cellSize,
          );
      col.needsUpdate = true;
    });
  }, []);

  const { terrainRoughness } = useVisualKeys(['terrainRoughness'] as const);

  return (
    <mesh ref={meshRef} receiveShadow castShadow {...handlers}>
      <meshStandardMaterial
        ref={(m) => {
          if (m) patchCloudShadows(m);
        }}
        vertexColors
        flatShading
        roughness={terrainRoughness}
      />
    </mesh>
  );
}

// --- Shared geometry math ---------------------------------------------------

/** World Y of a cell corner from the corner-max heightmap. */
function cornerY(map: TerrainMap, cx: number, cz: number, cellSize: number): number {
  return FLAT_TOP * cellSize + cornerHeightAt(map, cx, cz) * cellSize;
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
  const isWater = map.cells[x][z] === CellType.Water;

  const wx = (cx: number) => (cx - half - 0.5) * cellSize;
  const wz = (cz: number) => (cz - half - 0.5) * cellSize;
  // Water renders its TOP as one flat, uniform surface (so a dug basin fills
  // back up to the common water level — no holes). Non-water uses the real
  // corner-max heightmap.
  // Mine lots are cut OUT of the terrain (top collapsed to the floor): the
  // MineModel supplies its own deck + a quarry pit that reaches below ground,
  // and the neighbours' side walls line the hole.
  const hole = isMineLot(map, x, z);
  const y = (cx: number, cz: number) =>
    hole
      ? floorY
      : isWater
        ? WATER_LEVEL * cellSize
        : cornerY(map, cx, cz, cellSize) + cornerJitter(map, cx, cz) * cellSize;

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

  // --- Top: 4 triangles around a centre vertex (CCW from above) ---
  // Centre on the (x0,z0)-(x1,z1) diagonal keeps non-grass tops identical to
  // the old 2-triangle split; grass gets a hashed bump for the crumpled look.
  const cxW = (x0 + x1) / 2;
  const czW = (z0 + z1) / 2;
  let cy = (y00 + y11) / 2;
  if (!hole && isGrass(map, x, z)) {
    cy += (hash01(x, z, map.seed + 101) * 2 - 1) * GRASS_CENTER_AMP * cellSize;
  }
  const tc = TMP_COLOR;
  // -X side: (x0,z0) -> (x0,z1)
  topColor(map, x, z, 0, tc);
  put(x0, y00, z0, tc);
  put(x0, y01, z1, tc);
  put(cxW, cy, czW, tc);
  // +Z side: (x0,z1) -> (x1,z1)
  topColor(map, x, z, 1, tc);
  put(x0, y01, z1, tc);
  put(x1, y11, z1, tc);
  put(cxW, cy, czW, tc);
  // +X side: (x1,z1) -> (x1,z0)
  topColor(map, x, z, 2, tc);
  put(x1, y11, z1, tc);
  put(x1, y10, z0, tc);
  put(cxW, cy, czW, tc);
  // -Z side: (x1,z0) -> (x0,z0)
  topColor(map, x, z, 3, tc);
  put(x1, y10, z0, tc);
  put(x0, y00, z0, tc);
  put(cxW, cy, czW, tc);

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

// --- Surface sampling (for props resting on the crumpled terrain) -----------

/**
 * World Y of the rendered top surface of cell (x, z) at local offset (u, v),
 * each in [-0.5, 0.5] cell units from the cell centre. Matches the exact
 * 4-triangle top built by writeCell (corner jitter + grass centre bump), so
 * trees and rocks sit flush on the crumpled ground.
 */
export function surfaceYAt(
  map: TerrainMap,
  x: number,
  z: number,
  u: number,
  v: number,
  cellSize: number,
): number {
  if (map.cells[x][z] === CellType.Water) return WATER_LEVEL * cellSize;
  const cy = (cx: number, cz: number) =>
    cornerY(map, cx, cz, cellSize) + cornerJitter(map, cx, cz) * cellSize;
  const y00 = cy(x, z);
  const y10 = cy(x + 1, z);
  const y11 = cy(x + 1, z + 1);
  const y01 = cy(x, z + 1);
  let yc = (y00 + y11) / 2;
  if (isGrass(map, x, z)) {
    yc += (hash01(x, z, map.seed + 101) * 2 - 1) * GRASS_CENTER_AMP * cellSize;
  }
  // Pick the top triangle (apex at the centre) containing (u, v), then
  // interpolate: p = a·(A − C) + b·(B − C).
  let ax: number, az: number, ay: number, bx: number, bz: number, by: number;
  if (Math.abs(u) >= Math.abs(v)) {
    if (u < 0) [ax, az, ay, bx, bz, by] = [-0.5, -0.5, y00, -0.5, 0.5, y01];
    else [ax, az, ay, bx, bz, by] = [0.5, 0.5, y11, 0.5, -0.5, y10];
  } else if (v > 0) [ax, az, ay, bx, bz, by] = [-0.5, 0.5, y01, 0.5, 0.5, y11];
  else [ax, az, ay, bx, bz, by] = [0.5, -0.5, y10, -0.5, -0.5, y00];
  const det = ax * bz - az * bx;
  const a = (u * bz - v * bx) / det;
  const b = (ax * v - az * u) / det;
  return yc + a * (ay - yc) + b * (by - yc);
}
