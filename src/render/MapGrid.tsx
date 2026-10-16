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
import { CellType, HILL_STEP, type TerrainMap } from '../sim';
import { surfaceYAt } from './TerrainSurface';
import { useVisualKeys } from './visualSettings';
import { patchCloudShadows } from './cloudShadows';

export interface MapGridProps {
  map: TerrainMap;
  cellSize: number;
}

/** Chance that a plain grass cell gets tree(s) / rock(s). */
// Per-cell chances. The grid is now 2× finer (4 cells per old cell), so these
// are ~¼ of the old values to keep the same physical density of lone props.
const GRASS_TREE_CHANCE = 0.015;
const GRASS_ROCK_CHANCE = 0.011;
const HILL_ROCK_CHANCE = 0.02;

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
// Round crowns (deciduous / birch / autumn / bushes): a chunky icosahedron.
const ROUND_GEOM = new THREE.IcosahedronGeometry(1, 0);
const ROUND_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
[TRUNK_MAT, LEAF_MAT, ROCK_MAT, ROUND_MAT].forEach((m) => patchCloudShadows(m));

/** Tree species. Pines use the stacked-cone crown; the rest a round crown. */
const enum Sp {
  Pine = 0,
  Round = 1,
  Birch = 2,
  Autumn = 3,
  Bush = 4,
}
const ROUND_GREENS = ['#5e7f37', '#6c8a3c', '#52722f', '#789641'].map((c) => new THREE.Color(c));
const BIRCH_GREENS = ['#86a24a', '#93ab52'].map((c) => new THREE.Color(c));
const AUTUMN = ['#c8862f', '#d4a33a', '#b5582a', '#c97a2c'].map((c) => new THREE.Color(c));
const BUSH_GREENS = ['#4c6a2c', '#58772f', '#46622a'].map((c) => new THREE.Color(c));
const BIRCH_BARK = new THREE.Color('#e8e4da');

/** Species mix: forest core is mostly pine; edges and loners are mixed. */
function pickSpecies(h: number, edge: boolean): Sp {
  if (!edge) return h < 0.8 ? Sp.Pine : h < 0.93 ? Sp.Round : Sp.Birch;
  return h < 0.35 ? Sp.Pine : h < 0.68 ? Sp.Round : h < 0.84 ? Sp.Birch : Sp.Autumn;
}

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
  sp: Sp;
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

  const addTree = (
    x: number,
    z: number,
    k: number,
    u: number,
    v: number,
    s: number,
    sp: Sp = Sp.Pine,
  ) => {
    trees.push({
      x: (x - half + u) * cellSize,
      y: surfaceYAt(map, x, z, u, v, cellSize),
      z: (z - half + v) * cellSize,
      s: s * cellSize,
      rot: hash01(x * 7 + k, z, seed + 5) * Math.PI * 2,
      color: Math.floor(hash01(x, z * 3 + k, seed + 9) * 16),
      sp,
    });
  };
  const typeAt = (x: number, z: number): CellType | null =>
    x < 0 || z < 0 || x >= map.size || z >= map.size ? null : map.cells[x][z];
  const besideForest = (x: number, z: number) =>
    typeAt(x - 1, z) === CellType.Forest ||
    typeAt(x + 1, z) === CellType.Forest ||
    typeAt(x, z - 1) === CellType.Forest ||
    typeAt(x, z + 1) === CellType.Forest;
  const forestEdge = (x: number, z: number) =>
    typeAt(x - 1, z) !== CellType.Forest ||
    typeAt(x + 1, z) !== CellType.Forest ||
    typeAt(x, z - 1) !== CellType.Forest ||
    typeAt(x, z + 1) !== CellType.Forest;
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

  const cleared = map.cleared;
  for (let x = 0; x < map.size; x++) {
    for (let z = 0; z < map.size; z++) {
      // The player bulldozed this cell's scenery: keep it clear.
      if (cleared?.has(x * map.size + z)) continue;
      const t = map.cells[x][z];
      if (t === CellType.Forest) {
        // Forest cells are now ¼ of the old area, so 1–2 trees each (≈1.5× the
        // old physical density, with trees half the size → a finer, denser,
        // more natural forest without exploding the instance count).
        const n = 1 + (hash01(x, z, seed + 1) < 0.4 ? 1 : 0);
        const slots: Array<[number, number]> = n === 1 ? [[0, 0]] : [[-0.18, -0.15], [0.2, 0.17]];
        const edge = forestEdge(x, z);
        for (let k = 0; k < n; k++) {
          const [ju, jv] = spot(x, z, k, n === 1 ? 0.3 : 0.16);
          const s = 0.95 + hash01(x, z, seed + 300 + k) * 0.55;
          addTree(x, z, k, slots[k][0] + ju, slots[k][1] + jv, s, pickSpecies(hash01(x, z, seed + 320 + k), edge));
        }
      } else if (t === CellType.Empty) {
        const r = hash01(x, z, seed + 3);
        // Ragged forest fringe: grass right next to a forest often gets a
        // (mixed-species) tree, so forests fade out instead of ending in a
        // hard cell-aligned edge.
        if (besideForest(x, z) && hash01(x, z, seed + 12) < 0.32) {
          const [u, v] = spot(x, z, 0, 0.5);
          addTree(x, z, 0, u, v, 0.7 + hash01(x, z, seed + 13) * 0.5, pickSpecies(hash01(x, z, seed + 14), true));
          continue;
        }
        if (r < GRASS_TREE_CHANCE) {
          const n = 1 + Math.floor(hash01(x, z, seed + 4) * 2);
          for (let k = 0; k < n; k++) {
            const [u, v] = spot(x, z, k, 0.6);
            addTree(x, z, k, u, v, 0.75 + hash01(x, z, seed + 310 + k) * 0.5, pickSpecies(hash01(x, z, seed + 330 + k), true));
          }
        } else if (r < GRASS_TREE_CHANCE + 0.02) {
          const [u, v] = spot(x, z, 9, 0.6);
          addTree(x, z, 9, u, v, 0.5 + hash01(x, z, seed + 18) * 0.3, Sp.Bush);
        } else if (r < GRASS_TREE_CHANCE + 0.02 + GRASS_ROCK_CHANCE) {
          const n = 1 + Math.floor(hash01(x, z, seed + 6) * 3);
          for (let k = 0; k < n; k++) {
            const [u, v] = spot(x, z, k, 0.55);
            addRock(x, z, k, u, v, k === 0 ? 1.3 : 0.8);
          }
        }
      } else if (t === CellType.Hill) {
        const lvl = map.heights[x][z] / HILL_STEP;
        // Alpine pines on the lower mountain flanks, thinning with height.
        if (lvl <= 4 && hash01(x, z, seed + 19) < 0.1 * (1 - lvl / 5)) {
          const [u, v] = spot(x, z, 0, 0.4);
          addTree(x, z, 0, u, v, 0.7 + hash01(x, z, seed + 20) * 0.4, Sp.Pine);
        } else if (hash01(x, z, seed + 8) < HILL_ROCK_CHANCE * (1 + lvl * 0.6)) {
          // Boulders get more common the higher (and rockier) it gets.
          const [u, v] = spot(x, z, 0, 0.4);
          addRock(x, z, 0, u, v, 1.3 + lvl * 0.12);
        }
      }
    }
  }
  return { trees, rocks };
}

export function MapGrid({ map, cellSize }: MapGridProps) {
  const { trees, rocks } = useMemo(() => scatter(map, cellSize), [map, cellSize]);

  const pines = useMemo(() => trees.filter((t) => t.sp === Sp.Pine), [trees]);
  const rounds = useMemo(() => trees.filter((t) => t.sp !== Sp.Pine), [trees]);

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const roundRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);

  const vis = useVisualKeys(VISUAL_KEYS);
  const visSig = VISUAL_KEYS.map((k) => vis[k]).join('|');

  // The baked tier brightness lives in the crown geometry, so it only needs
  // rebuilding when treeTipLight changes (not on every colour tweak).
  const crownGeom = useMemo(() => buildCrownGeom(vis.treeTipLight), [vis.treeTipLight]);

  useLayoutEffect(() => {
    const greens = [vis.tree1, vis.tree2, vis.tree3, vis.tree4, vis.tree5].map((c) => new THREE.Color(c));
    const greys = [vis.rock1, vis.rock2, vis.rock3, vis.rock4].map((c) => new THREE.Color(c));
    // Trunk colour comes per instance (brown, or white birch bark).
    const trunkCol = new THREE.Color(vis.trunk);
    TRUNK_MAT.color.set('#ffffff');
    const d = new THREE.Object3D();
    const trunk = trunkRef.current;
    if (trunk) {
      trees.forEach((t, i) => {
        const round = t.sp !== Sp.Pine;
        const th = t.sp === Sp.Bush ? 0.001 : t.sp === Sp.Birch ? 0.42 : round ? 0.3 : TRUNK_H;
        d.position.set(t.x, t.y - 0.02 * t.s, t.z);
        d.rotation.set(0, t.rot, 0);
        d.scale.set(t.s * (t.sp === Sp.Birch ? 0.8 : 1), t.s * th, t.s * (t.sp === Sp.Birch ? 0.8 : 1));
        d.updateMatrix();
        trunk.setMatrixAt(i, d.matrix);
        trunk.setColorAt(i, t.sp === Sp.Birch ? BIRCH_BARK : trunkCol);
      });
      trunk.instanceMatrix.needsUpdate = true;
      if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
      trunk.computeBoundingSphere();
    }
    // Round crowns: deciduous, birch, autumn and bushes.
    const round = roundRef.current;
    if (round) {
      rounds.forEach((t, i) => {
        const sp = t.sp;
        const r = sp === Sp.Bush ? 0.2 : sp === Sp.Birch ? 0.17 : 0.24;
        const h = sp === Sp.Bush ? 0.15 : sp === Sp.Birch ? 0.3 : 0.26;
        const cy = sp === Sp.Bush ? 0.1 : sp === Sp.Birch ? 0.56 : 0.44;
        d.position.set(t.x, t.y + cy * t.s, t.z);
        d.rotation.set(t.rot * 0.3, t.rot, 0);
        d.scale.set(r * t.s, h * t.s, r * t.s);
        d.updateMatrix();
        round.setMatrixAt(i, d.matrix);
        const pal =
          sp === Sp.Autumn ? AUTUMN : sp === Sp.Birch ? BIRCH_GREENS : sp === Sp.Bush ? BUSH_GREENS : ROUND_GREENS;
        round.setColorAt(i, pal[t.color % pal.length]);
      });
      round.instanceMatrix.needsUpdate = true;
      if (round.instanceColor) round.instanceColor.needsUpdate = true;
      round.computeBoundingSphere();
    }
    // One crown per pine (all 3 tiers baked into crownGeom).
    const crown = crownRef.current;
    if (crown) {
      pines.forEach((t, i) => {
        d.position.set(t.x, t.y, t.z);
        d.rotation.set(0, t.rot, 0);
        d.scale.setScalar(t.s);
        d.updateMatrix();
        crown.setMatrixAt(i, d.matrix);
        crown.setColorAt(i, greens[t.color % TREE_SHADES]);
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
  }, [trees, pines, rounds, rocks, visSig]);

  return (
    <group>
      {trees.length > 0 && (
        // key on count + crown geometry: InstancedMesh capacity + the crown
        // buffer are fixed at creation, so rebuild if either changes.
        <group key={`t${trees.length}:${pines.length}:${vis.treeTipLight}`}>
          {/* 1 — all trunks */}
          <instancedMesh
            ref={trunkRef}
            args={[TRUNK_GEOM, TRUNK_MAT, trees.length]}
            castShadow
            receiveShadow
          />
          {/* 2 — pine crowns (3 tiers merged into one geometry) */}
          {pines.length > 0 && (
            <instancedMesh
              ref={crownRef}
              args={[crownGeom, LEAF_MAT, pines.length]}
              castShadow
              receiveShadow
            />
          )}
          {/* 3 — round crowns (deciduous / birch / autumn / bushes) */}
          {rounds.length > 0 && (
            <instancedMesh
              ref={roundRef}
              args={[ROUND_GEOM, ROUND_MAT, rounds.length]}
              castShadow
              receiveShadow
            />
          )}
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
