/**
 * MapGrid — environment props on top of the terrain: low-poly pine trees and
 * rocks, all GPU-instanced (a handful of draw calls for the whole map).
 *
 * Trees: a brown cylinder trunk + 3 stacked, upward-shrinking green cones.
 *   - Forest cells get a dense cluster (3–4 trees each).
 *   - Plain grass cells get an occasional lone tree / small group.
 * Rocks: low-detail dodecahedrons, randomly rotated and non-uniformly scaled
 *   so they read as broken boulders; scattered on grass (and a few on hills).
 *
 * Placement is a deterministic hash of (cell, seed), so props never shuffle
 * when the map re-renders. Props only exist on Forest / Empty / Hill cells, so
 * building a road/rail or anything else on a cell removes them automatically
 * (this component re-derives its list whenever cell TYPES change). Every prop
 * rests on the exact crumpled surface via `surfaceYAt`.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { surfaceYAt } from './TerrainSurface';
import { useVisualKeys } from './visualSettings';
import { patchCloudShadows } from './cloudShadows';

export interface MapGridProps {
  map: TerrainMap;
  cellSize: number;
}

/** Chance that a plain grass cell gets tree(s) / rock(s). */
const GRASS_TREE_CHANCE = 0.05;
const GRASS_ROCK_CHANCE = 0.035;
const HILL_ROCK_CHANCE = 0.06;

/** Tree shape in cellSize units (scaled per tree). */
const TRUNK_H = 0.22;
const TIERS = [
  // [radius, height, base y]
  [0.26, 0.38, 0.16],
  [0.2, 0.32, 0.36],
  [0.13, 0.26, 0.54],
] as const;

/** Palette sizes (colours themselves come from the visual tuner). */
const TREE_SHADES = 5;
const ROCK_SHADES = 4;
const VISUAL_KEYS = [
  'tree1', 'tree2', 'tree3', 'tree4', 'tree5', 'treeTipLight', 'trunk',
  'rock1', 'rock2', 'rock3', 'rock4',
] as const;

// Shared geometries / materials (module level: created once).
const TRUNK_GEOM = new THREE.CylinderGeometry(0.04, 0.055, 1, 6);
TRUNK_GEOM.translate(0, 0.5, 0); // base at y = 0

/**
 * ONE merged crown geometry: the 3 stacked cones fused into a single buffer so
 * the whole foliage of every tree is drawn by a single InstancedMesh (trees =
 * 2 draw calls total: trunks + crowns).
 *
 * The per-tier "sun-catching tip" lightening can't come from a separate
 * InstancedMesh colour any more, so we bake it into the merged geometry as a
 * vertex-colour brightness that the per-instance colour is multiplied by. A
 * tiny yaw per tier keeps the chunky, layered silhouette.
 */
function buildCrownGeom(tipLight: number): THREE.BufferGeometry {
  // Expand each cone to non-indexed first, so the merged sizes are exact.
  const parts: THREE.BufferGeometry[] = TIERS.map(([r, h, baseY], ti) => {
    const base = new THREE.ConeGeometry(r, h, 7);
    base.translate(0, h / 2 + baseY, 0);
    base.rotateY(ti * 0.45);
    const g = base.toNonIndexed();
    base.dispose();
    // Bake the tier brightness into vertex colours (instance colour × this).
    const mul = 1 + ti * tipLight;
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(mul), 3));
    return g;
  });

  const total = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position').array as ArrayLike<number>;
    const nn = g.getAttribute('normal').array as ArrayLike<number>;
    const cc = g.getAttribute('color').array as ArrayLike<number>;
    pos.set(p, o);
    nor.set(nn, o);
    col.set(cc, o);
    o += p.length;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

const ROCK_GEOM = new THREE.DodecahedronGeometry(1, 0);
ROCK_GEOM.translate(0, 0.35, 0); // sink a bit into the ground

const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9, flatShading: true });
// vertexColors: the baked per-tier brightness; instance colours multiply it.
const LEAF_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.85,
  flatShading: true,
  vertexColors: true,
});
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
[TRUNK_MAT, LEAF_MAT, ROCK_MAT].forEach((m) => patchCloudShadows(m));

function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  color: number;
}
interface Rock {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  color: number;
}

function scatter(map: TerrainMap, cellSize: number): { trees: Tree[]; rocks: Rock[] } {
  const half = (map.size - 1) / 2;
  const trees: Tree[] = [];
  const rocks: Rock[] = [];
  const seed = map.seed;

  const addTree = (x: number, z: number, k: number, u: number, v: number, s: number) => {
    trees.push({
      x: (x - half + u) * cellSize,
      y: surfaceYAt(map, x, z, u, v, cellSize),
      z: (z - half + v) * cellSize,
      s: s * cellSize,
      rot: hash01(x * 7 + k, z, seed + 5) * Math.PI * 2,
      color: Math.floor(hash01(x, z * 3 + k, seed + 9) * TREE_SHADES),
    });
  };
  const addRock = (x: number, z: number, k: number, u: number, v: number, big: number) => {
    const r = (0.07 + hash01(x, z + k, seed + 41) * 0.09) * big * cellSize;
    rocks.push({
      x: (x - half + u) * cellSize,
      y: surfaceYAt(map, x, z, u, v, cellSize),
      z: (z - half + v) * cellSize,
      sx: r * (0.8 + hash01(x + k, z, seed + 43) * 0.6),
      sy: r * (0.55 + hash01(x, z + k, seed + 47) * 0.45),
      sz: r * (0.8 + hash01(x + k, z + k, seed + 53) * 0.6),
      rx: hash01(x, z, seed + 59 + k) * Math.PI,
      ry: hash01(x, z, seed + 61 + k) * Math.PI * 2,
      rz: hash01(x, z, seed + 67 + k) * Math.PI,
      color: Math.floor(hash01(x + k, z, seed + 71) * ROCK_SHADES),
    });
  };
  // A jittered spot inside the cell, kept away from the edges.
  const spot = (x: number, z: number, k: number, spread: number): [number, number] => [
    (hash01(x, z, seed + 200 + k * 2) - 0.5) * spread,
    (hash01(x, z, seed + 201 + k * 2) - 0.5) * spread,
  ];

  for (let x = 0; x < map.size; x++) {
    for (let z = 0; z < map.size; z++) {
      const t = map.cells[x][z];
      if (t === CellType.Forest) {
        // Dense cluster: 3–4 trees on a jittered 2×2 layout.
        const n = 3 + (hash01(x, z, seed + 1) < 0.5 ? 1 : 0);
        const slots: Array<[number, number]> = [
          [-0.22, -0.22],
          [0.22, -0.2],
          [-0.2, 0.22],
          [0.22, 0.22],
        ];
        for (let k = 0; k < n; k++) {
          const [ju, jv] = spot(x, z, k, 0.16);
          const s = 0.85 + hash01(x, z, seed + 300 + k) * 0.55;
          addTree(x, z, k, slots[k][0] + ju, slots[k][1] + jv, s);
        }
      } else if (t === CellType.Empty) {
        const r = hash01(x, z, seed + 3);
        if (r < GRASS_TREE_CHANCE) {
          const n = 1 + Math.floor(hash01(x, z, seed + 4) * 2);
          for (let k = 0; k < n; k++) {
            const [u, v] = spot(x, z, k, 0.6);
            addTree(x, z, k, u, v, 0.75 + hash01(x, z, seed + 310 + k) * 0.5);
          }
        } else if (r < GRASS_TREE_CHANCE + GRASS_ROCK_CHANCE) {
          const n = 1 + Math.floor(hash01(x, z, seed + 6) * 3);
          for (let k = 0; k < n; k++) {
            const [u, v] = spot(x, z, k, 0.55);
            addRock(x, z, k, u, v, k === 0 ? 1.3 : 0.8);
          }
        }
      } else if (t === CellType.Hill) {
        if (hash01(x, z, seed + 8) < HILL_ROCK_CHANCE) {
          const [u, v] = spot(x, z, 0, 0.4);
          addRock(x, z, 0, u, v, 1.5);
        }
      }
    }
  }
  return { trees, rocks };
}

export function MapGrid({ map, cellSize }: MapGridProps) {
  const { trees, rocks } = useMemo(() => scatter(map, cellSize), [map, cellSize]);

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);

  const vis = useVisualKeys(VISUAL_KEYS);
  const visSig = VISUAL_KEYS.map((k) => vis[k]).join('|');

  // The baked tier brightness lives in the crown geometry, so it only needs
  // rebuilding when treeTipLight changes (not on every colour tweak).
  const crownGeom = useMemo(() => buildCrownGeom(vis.treeTipLight), [vis.treeTipLight]);

  useLayoutEffect(() => {
    const greens = [vis.tree1, vis.tree2, vis.tree3, vis.tree4, vis.tree5].map((c) => new THREE.Color(c));
    const greys = [vis.rock1, vis.rock2, vis.rock3, vis.rock4].map((c) => new THREE.Color(c));
    TRUNK_MAT.color.set(vis.trunk);
    const d = new THREE.Object3D();
    const trunk = trunkRef.current;
    if (trunk) {
      trees.forEach((t, i) => {
        d.position.set(t.x, t.y - 0.02 * t.s, t.z);
        d.rotation.set(0, t.rot, 0);
        d.scale.set(t.s, t.s * TRUNK_H, t.s);
        d.updateMatrix();
        trunk.setMatrixAt(i, d.matrix);
      });
      trunk.instanceMatrix.needsUpdate = true;
      trunk.computeBoundingSphere();
    }
    // One crown per tree (all 3 tiers baked into crownGeom).
    const crown = crownRef.current;
    if (crown) {
      trees.forEach((t, i) => {
        d.position.set(t.x, t.y, t.z);
        d.rotation.set(0, t.rot, 0);
        d.scale.setScalar(t.s);
        d.updateMatrix();
        crown.setMatrixAt(i, d.matrix);
        crown.setColorAt(i, greens[t.color]);
      });
      crown.instanceMatrix.needsUpdate = true;
      if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
      crown.computeBoundingSphere();
    }
    const rock = rockRef.current;
    if (rock) {
      rocks.forEach((r, i) => {
        d.position.set(r.x, r.y - r.sy * 0.25, r.z);
        d.rotation.set(r.rx, r.ry, r.rz);
        d.scale.set(r.sx, r.sy, r.sz);
        d.updateMatrix();
        rock.setMatrixAt(i, d.matrix);
        rock.setColorAt(i, greys[r.color]);
      });
      rock.instanceMatrix.needsUpdate = true;
      if (rock.instanceColor) rock.instanceColor.needsUpdate = true;
      rock.computeBoundingSphere();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees, rocks, visSig]);

  return (
    <group>
      {trees.length > 0 && (
        // key on count + crown geometry: InstancedMesh capacity + the crown
        // buffer are fixed at creation, so rebuild if either changes.
        <group key={`t${trees.length}:${vis.treeTipLight}`}>
          {/* 1 — all trunks */}
          <instancedMesh
            ref={trunkRef}
            args={[TRUNK_GEOM, TRUNK_MAT, trees.length]}
            castShadow
            receiveShadow
          />
          {/* 2 — all crowns (3 tiers merged into one geometry) */}
          <instancedMesh
            ref={crownRef}
            args={[crownGeom, LEAF_MAT, trees.length]}
            castShadow
            receiveShadow
          />
        </group>
      )}
      {rocks.length > 0 && (
        <instancedMesh
          key={`r${rocks.length}`}
          ref={rockRef}
          args={[ROCK_GEOM, ROCK_MAT, rocks.length]}
          castShadow
          receiveShadow
        />
      )}
    </group>
  );
}
