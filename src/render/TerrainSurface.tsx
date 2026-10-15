/**
 * TerrainSurface — ONE continuous, low-poly heightmap mesh for the whole map.
 *
 * This replaces the previous split of flat box tiles (MapGrid) + a separate
 * hill surface (Hills) + an invisible flat pick-plane (GridFloor). Because the
 * entire ground is now a single mesh whose geometry follows the corner-max
 * heightmap, the raycaster always hits the REAL surface under the cursor — on
 * flat ground AND on slopes — so build picking is exact everywhere and there is
 * no flat plane beneath hills to "pass through" to.
 *
 * Geometry: 2 triangles per cell from its four corner world-positions (corners
 * shared via the corner-max heightmap, so hills ramp up and blend seamlessly
 * into flat ground). Non-shared vertices per cell + `flatShading` give crisp
 * low-poly facets and let each cell carry its own flat color.
 *
 * Colour: per-cell vertex colors from CELL_STYLE — grass/hill/city/forest/
 * water. Roads, industry, buildings and icons are still drawn as their own
 * meshes on top of this surface.
 *
 * Water: water cells are dropped by WATER_SINK so they read as sunken pools,
 * matching the old look.
 *
 * The shared build pointer handlers are spread onto this mesh (click + drag,
 * with stopPropagation).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { CellType, cornerHeightAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import type { PointerBuildHandlers } from './usePointerBuild';

export interface TerrainSurfaceProps {
  map: TerrainMap;
  cellSize: number;
  handlers?: PointerBuildHandlers;
}

// Grass tile top (grass surface) height, in cellSize units — the flat base all
// non-hill cells sit at (matches the old FLAT_TOP so roads/buildings line up).
const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
// How far below the base water cells sit (sunken pools), in cellSize units.
const WATER_SINK = 0.2;

/** Surface color for a cell type (buildings/roads are drawn separately). */
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
    // Empty + anything a building/road sits on reads as grass underneath.
    default:
      return CELL_STYLE[CellType.Empty].color;
  }
}

export function TerrainSurface({ map, cellSize, handlers }: TerrainSurfaceProps) {
  // Rebuild when the terrain changes shape/biome: seed+size (regeneration) and
  // `version`, which the store bumps on every runtime edit (terraforming edits
  // heights and water cells, which DO change the surface). Road/building
  // overlays also bump version but read as grass here, so a rebuild is cheap
  // and harmless.
  const geometry = useMemo(
    () => buildTerrainGeometry(map, cellSize),
    [map.seed, map.size, map.version, cellSize],
  );

  return (
    <mesh geometry={geometry} receiveShadow castShadow {...handlers}>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

function buildTerrainGeometry(
  map: TerrainMap,
  cellSize: number,
): THREE.BufferGeometry {
  const { size, cells } = map;
  const half = (size - 1) / 2;
  const base = FLAT_TOP * cellSize;

  // Corner world position. Cells are centered at (i-half)*cellSize, so corner
  // (cx,cz) is at the cell boundary (cx-half-0.5)*cellSize. Y from the shared
  // corner-max heightmap. `sink` lowers a cell's own quad for water pools.
  const cornerWorld = (cx: number, cz: number, sink: number): THREE.Vector3 =>
    new THREE.Vector3(
      (cx - half - 0.5) * cellSize,
      base + cornerHeightAt(map, cx, cz) * cellSize - sink,
      (cz - half - 0.5) * cellSize,
    );

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  const pushVertex = (v: THREE.Vector3) => {
    positions.push(v.x, v.y, v.z);
    colors.push(color.r, color.g, color.b);
  };

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const type = cells[x][z];
      color.set(surfaceColor(type));
      const sink = type === CellType.Water ? WATER_SINK * cellSize : 0;

      // Four corners, CCW seen from above for upward-facing normals.
      const c00 = cornerWorld(x, z, sink);
      const c10 = cornerWorld(x + 1, z, sink);
      const c11 = cornerWorld(x + 1, z + 1, sink);
      const c01 = cornerWorld(x, z + 1, sink);

      // Triangles (c00, c01, c11) and (c00, c11, c10).
      pushVertex(c00);
      pushVertex(c01);
      pushVertex(c11);
      pushVertex(c00);
      pushVertex(c11);
      pushVertex(c10);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}
