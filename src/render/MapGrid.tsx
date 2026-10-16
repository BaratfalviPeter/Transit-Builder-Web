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

const TREE_GREENS = ['#3f6a33', '#4a7a3a', '#365d2e', '#567f3c', '#2f5529'].map(
  (c) => new THREE.Color(c),
);
const ROCK_GREYS = ['#6e6c69', '#7c7a76', '#5f5e5c', '#86847f'].map((c) => new THREE.Color(c));

// Shared geometries / materials (module level: created once).
const TRUNK_GEOM = new THREE.CylinderGeometry(0.04, 0.055, 1, 6);
TRUNK_GEOM.translate(0, 0.5, 0); // base at y = 0
const TIER_GEOMS = TIERS.map(([r, h]) => {
  const g = new THREE.ConeGeometry(r, h, 7);
  g.translate(0, h / 2, 0); // base at y = 0
  return g;
});
const ROCK_GEOM = new THREE.DodecahedronGeometry(1, 0);
ROCK_GEOM.translate(0, 0.35, 0); // sink a bit into the ground

const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9, flatShading: true });
const LEAF_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });

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
  color: THREE.Color;
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
  color: THREE.Color;
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
      color: TREE_GREENS[Math.floor(hash01(x, z * 3 + k, seed + 9) * TREE_GREENS.length)],
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
      color: ROCK_GREYS[Math.floor(hash01(x + k, z, seed + 71) * ROCK_GREYS.length)],
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
  const tierRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const rockRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
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
    TIERS.forEach(([, , baseY], ti) => {
      const mesh = tierRefs.current[ti];
      if (!mesh) return;
      const c = new THREE.Color();
      trees.forEach((t, i) => {
        d.position.set(t.x, t.y + baseY * t.s, t.z);
        d.rotation.set(0, t.rot + ti * 0.45, 0);
        d.scale.setScalar(t.s);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        // Upper tiers a touch lighter (sun-catching tips).
        mesh.setColorAt(i, c.copy(t.color).multiplyScalar(1 + ti * 0.08));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    const rock = rockRef.current;
    if (rock) {
      rocks.forEach((r, i) => {
        d.position.set(r.x, r.y - r.sy * 0.25, r.z);
        d.rotation.set(r.rx, r.ry, r.rz);
        d.scale.set(r.sx, r.sy, r.sz);
        d.updateMatrix();
        rock.setMatrixAt(i, d.matrix);
        rock.setColorAt(i, r.color);
      });
      rock.instanceMatrix.needsUpdate = true;
      if (rock.instanceColor) rock.instanceColor.needsUpdate = true;
      rock.computeBoundingSphere();
    }
  }, [trees, rocks]);

  return (
    <group>
      {trees.length > 0 && (
        // key on count: InstancedMesh capacity is fixed at creation.
        <group key={`t${trees.length}`}>
          <instancedMesh
            ref={trunkRef}
            args={[TRUNK_GEOM, TRUNK_MAT, trees.length]}
            castShadow
            receiveShadow
          />
          {TIER_GEOMS.map((g, ti) => (
            <instancedMesh
              key={ti}
              ref={(el) => {
                tierRefs.current[ti] = el;
              }}
              args={[g, LEAF_MAT, trees.length]}
              castShadow
              receiveShadow
            />
          ))}
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
