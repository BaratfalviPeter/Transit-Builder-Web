/**
 * Birds — small flocks of low-poly birds lazily circling over the forests.
 *
 * Each bird is a tiny body + two flat triangular wings that flap (wings rotate
 * around the body's long axis), with occasional gliding. Flocks orbit a forest
 * cell in a loose, bobbing formation. Everything is instanced: three
 * InstancedMeshes (bodies, left wings, right wings) for all birds, matrices
 * updated per frame (a few dozen birds → negligible cost).
 *
 * Flock centres are picked deterministically from Forest cells (spread apart),
 * re-derived when cell types change.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { useVisualKeys } from './visualSettings';

export interface BirdsProps {
  map: TerrainMap;
  cellSize: number;
}

const BIRDS_PER_FLOCK_MIN = 4;
const BIRDS_PER_FLOCK_MAX = 8;
const MAX_BIRDS = 20 * BIRDS_PER_FLOCK_MAX;

function rand(seed: number, i: number): number {
  let h = (seed * 2246822519 + i * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Wing: a flat triangle, root along the body (z from -0.12 to 0.1), tip at +X.
function wingGeom(side: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([0, 0, 0.1, side * 0.55, 0, -0.08, 0, 0, -0.14]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const WING_L = wingGeom(-1);
const WING_R = wingGeom(1);
const BODY = new THREE.ConeGeometry(0.06, 0.34, 4);
BODY.rotateX(Math.PI / 2); // point along +Z (flight direction)
const BIRD_MAT = new THREE.MeshStandardMaterial({
  color: '#2e2b29',
  roughness: 0.9,
  flatShading: true,
  side: THREE.DoubleSide,
});

interface Bird {
  flock: number;
  /** Angular offset within the flock + radial / height offsets. */
  da: number;
  dr: number;
  dy: number;
  flap: number;
  flapPhase: number;
}
interface Flock {
  cx: number;
  cz: number;
  y: number;
  r: number;
  w: number; // angular speed (rad/s), sign = direction
  a0: number;
}

export function Birds({ map, cellSize }: BirdsProps) {
  const vis = useVisualKeys(['birdsVisible', 'birdFlocks', 'birdColor', 'birdSpeed'] as const);
  BIRD_MAT.color.set(vis.birdColor);
  const flockCount = Math.round(vis.birdFlocks);

  const { flocks, birds } = useMemo(() => {
    const half = (map.size - 1) / 2;
    const forest: Array<[number, number]> = [];
    for (let x = 0; x < map.size; x++)
      for (let z = 0; z < map.size; z++)
        if (map.cells[x][z] === CellType.Forest) forest.push([x, z]);
    const flocks: Flock[] = [];
    const birds: Bird[] = [];
    if (forest.length === 0) return { flocks, birds };
    const minDist = map.size / 5;
    let k = 0;
    for (let tries = 0; tries < 200 && flocks.length < flockCount; tries++) {
      const [x, z] = forest[Math.floor(rand(map.seed + 11, k++) * forest.length)];
      const wx = (x - half) * cellSize;
      const wz = (z - half) * cellSize;
      if (flocks.some((f) => Math.hypot(f.cx - wx, f.cz - wz) < minDist * cellSize)) continue;
      const fi = flocks.length;
      flocks.push({
        cx: wx,
        cz: wz,
        y: 6 + rand(map.seed + 12, fi) * 4,
        r: 3 + rand(map.seed + 13, fi) * 4,
        w: (0.25 + rand(map.seed + 14, fi) * 0.2) * (rand(map.seed + 15, fi) < 0.5 ? -1 : 1),
        a0: rand(map.seed + 16, fi) * Math.PI * 2,
      });
      const n =
        BIRDS_PER_FLOCK_MIN +
        Math.floor(rand(map.seed + 17, fi) * (BIRDS_PER_FLOCK_MAX - BIRDS_PER_FLOCK_MIN + 1));
      for (let b = 0; b < n; b++) {
        birds.push({
          flock: fi,
          da: (b - n / 2) * 0.16 + (rand(map.seed + 18, fi * 16 + b) - 0.5) * 0.12,
          dr: (rand(map.seed + 19, fi * 16 + b) - 0.5) * 1.6,
          dy: (rand(map.seed + 20, fi * 16 + b) - 0.5) * 0.9,
          flap: 7 + rand(map.seed + 21, fi * 16 + b) * 4,
          flapPhase: rand(map.seed + 22, fi * 16 + b) * Math.PI * 2,
        });
      }
    }
    return { flocks, birds: birds.slice(0, MAX_BIRDS) };
  }, [map, cellSize, flockCount]);

  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const lRef = useRef<THREE.InstancedMesh>(null);
  const rRef = useRef<THREE.InstancedMesh>(null);
  const speedRef = useRef(vis.birdSpeed);
  speedRef.current = vis.birdSpeed;
  const tRef = useRef(0);

  const tmp = useMemo(
    () => ({
      o: new THREE.Object3D(),
      w: new THREE.Object3D(),
      m: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame((state, delta) => {
    const body = bodyRef.current;
    const lw = lRef.current;
    const rw = rRef.current;
    if (!body || !lw || !rw) return;
    tRef.current += Math.min(delta, 0.1) * speedRef.current;
    const t = tRef.current;
    const wall = state.clock.getElapsedTime();
    const { o, w } = tmp;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const f = flocks[b.flock];
      const a = f.a0 + f.w * t + b.da;
      // Slightly elliptical, wobbling orbit.
      const rr = f.r + b.dr + Math.sin(t * 0.5 + b.flapPhase) * 0.6;
      const x = f.cx + Math.cos(a) * rr;
      const z = f.cz + Math.sin(a) * rr * 0.8;
      const y = f.y + b.dy + Math.sin(t * 0.9 + b.flapPhase) * 0.35;
      // Heading = orbit tangent (direction of travel).
      const tx = -Math.sin(a) * Math.sign(f.w);
      const tz = Math.cos(a) * 0.8 * Math.sign(f.w);
      const yaw = Math.atan2(tx, tz);
      // Bank into the turn.
      const bank = -0.35 * Math.sign(f.w);

      o.position.set(x, y, z);
      o.rotation.set(0, yaw, bank, 'YXZ');
      o.scale.setScalar(1.4);
      o.updateMatrix();
      body.setMatrixAt(i, o.matrix);

      // Flap, with periodic glides (wings held slightly up).
      const glide = Math.sin(wall * 0.4 + b.flapPhase) > 0.55;
      const flap = glide ? 0.15 : Math.sin(wall * b.flap + b.flapPhase) * 0.7;
      for (const [mesh, side] of [
        [lw, -1],
        [rw, 1],
      ] as const) {
        w.position.set(0, 0, 0);
        w.rotation.set(0, 0, side * flap);
        w.updateMatrix();
        tmp.m.multiplyMatrices(o.matrix, w.matrix);
        mesh.setMatrixAt(i, tmp.m);
      }
    }
    body.count = lw.count = rw.count = birds.length;
    body.instanceMatrix.needsUpdate = true;
    lw.instanceMatrix.needsUpdate = true;
    rw.instanceMatrix.needsUpdate = true;
  });

  if (!vis.birdsVisible || birds.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[BODY, BIRD_MAT, MAX_BIRDS]} castShadow frustumCulled={false} />
      <instancedMesh ref={lRef} args={[WING_L, BIRD_MAT, MAX_BIRDS]} castShadow frustumCulled={false} />
      <instancedMesh ref={rRef} args={[WING_R, BIRD_MAT, MAX_BIRDS]} castShadow frustumCulled={false} />
    </group>
  );
}
