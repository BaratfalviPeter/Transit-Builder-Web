/**
 * Farms — the countryside around the city (see farmland.ts for the mask).
 *
 *   - crop rows: golden wheat ridges, tall green corn rows, dark plowed
 *     furrows (one instanced box mesh, per-instance colour),
 *   - meadows: scattered wildflowers,
 *   - pastures: post-and-rail fences round the plot + grazing sheep that
 *     wander and nibble (animated),
 *   - farmsteads: red barns with a silo, and windmills with turning sails.
 *
 * Everything is derived from the map, so a road built through a field simply
 * removes that field cell's crops. Instanced where it counts (rows, flowers,
 * fence posts/rails, sheep); farmsteads are few, so plain meshes.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchCloudShadows } from './cloudShadows';
import { PLOT, farmCrop, farmstead, hash01, plotCrop, plotOf, type Crop } from './farmland';
import { registerNightGlow } from './dayNight';

export interface FarmsProps {
  map: TerrainMap;
  cellSize: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const BOX = new THREE.BoxGeometry(1, 1, 1);
BOX.translate(0, 0.5, 0); // base at y = 0

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
const M = {
  rows: std('#ffffff'),
  flowers: std('#ffffff'),
  post: std('#6b4a2b'),
  wool: std('#f1eee6', { roughness: 1 }),
  head: std('#2e2a27'),
  barn: std('#a8432f'),
  barnTrim: std('#efe9dc'),
  roof: std('#4a4442'),
  silo: std('#b9bcc0', { metalness: 0.3, roughness: 0.6 }),
  mill: std('#e9e2d2'),
  millCap: std('#7a4a2e'),
  sail: std('#d8cdb4'),
  door: std('#5a3a24'),
  window: std('#ffd36b', { emissive: '#ffb84a', emissiveIntensity: 0 }),
};
Object.values(M).forEach((m) => patchCloudShadows(m));
registerNightGlow(M.window, 0, 1.2);

const ROW_COL: Record<'wheat' | 'corn' | 'plowed', THREE.Color[]> = {
  wheat: ['#d9b54f', '#cfa944', '#e2c060'].map((c) => new THREE.Color(c)),
  corn: ['#5f7a2c', '#6b8732', '#56702a'].map((c) => new THREE.Color(c)),
  plowed: ['#5a4029', '#4f3824'].map((c) => new THREE.Color(c)),
};
const FLOWER_COL = ['#f4f1e6', '#f2d24a', '#b48ad8', '#e8738a'].map((c) => new THREE.Color(c));

interface Inst {
  p: [number, number, number];
  s: [number, number, number];
  ry: number;
  c?: THREE.Color;
}

/** Build all static farm instances from the map. */
function buildFarm(map: TerrainMap, cellSize: number) {
  const half = (map.size - 1) / 2;
  const y0 = FLAT_TOP * cellSize;
  const rows: Inst[] = [];
  const flowers: Inst[] = [];
  const posts: Inst[] = [];
  const rails: Inst[] = [];
  const steads: Array<{ x: number; z: number; kind: 'barn' | 'windmill'; ry: number }> = [];
  const pastures: Array<{ x0: number; z0: number; x1: number; z1: number; seed: number }> = [];
  const seed = map.seed;
  const W = (x: number) => (x - half) * cellSize;

  const steadAt = new Set<string>();
  const plotsSeen = new Set<string>();

  for (let x = 0; x < map.size; x++) {
    for (let z = 0; z < map.size; z++) {
      const crop = farmCrop(map, x, z);
      if (!crop) continue;
      const [px, pz] = plotOf(x, z);
      const pk = `${px},${pz}`;
      if (!plotsSeen.has(pk)) {
        plotsSeen.add(pk);
        const st = farmstead(map, px, pz);
        if (st) {
          steadAt.add(`${st.x},${st.z}`);
          steads.push({ ...st, ry: Math.floor(hash01(px, pz, seed + 507) * 4) * (Math.PI / 2) });
        }
        if (crop === 'pasture') {
          pastures.push({ x0: px * PLOT, z0: pz * PLOT, x1: px * PLOT + PLOT - 1, z1: pz * PLOT + PLOT - 1, seed: px * 131 + pz });
        }
      }
      if (steadAt.has(`${x},${z}`)) continue;

      const cx = W(x);
      const cz = W(z);
      const alongX = hash01(px, pz, seed + 505) < 0.5;
      if (crop === 'wheat' || crop === 'corn' || crop === 'plowed') {
        const n = 3;
        const h = crop === 'corn' ? 0.13 : crop === 'wheat' ? 0.06 : 0.03;
        const w = crop === 'plowed' ? 0.16 : crop === 'corn' ? 0.14 : 0.2;
        const pal = ROW_COL[crop];
        for (let i = 0; i < n; i++) {
          const off = ((i + 0.5) / n - 0.5) * cellSize;
          // Colour/height keyed by the ROW (not the cell), so each row runs
          // unbroken across the whole plot.
          const rowKey = (alongX ? z : x) * n + i;
          const jitterH = 1 + (hash01(rowKey, alongX ? 1 : 2, seed + 506) - 0.5) * 0.25;
          rows.push({
            p: [cx + (alongX ? 0 : off), y0, cz + (alongX ? off : 0)],
            s: alongX ? [cellSize * 1.001, h * cellSize * jitterH, w * cellSize] : [w * cellSize, h * cellSize * jitterH, cellSize * 1.001],
            ry: 0,
            c: pal[rowKey % pal.length],
          });
        }
      } else if (crop === 'meadow') {
        const n = 2 + Math.floor(hash01(x, z, seed + 508) * 3);
        for (let i = 0; i < n; i++) {
          const u = hash01(x, z * 7 + i, seed + 509) - 0.5;
          const v = hash01(x * 5 + i, z, seed + 510) - 0.5;
          flowers.push({
            p: [cx + u * cellSize * 0.9, y0, cz + v * cellSize * 0.9],
            s: [0.05 * cellSize, 0.07 * cellSize, 0.05 * cellSize],
            ry: u * 6,
            c: FLOWER_COL[Math.floor(hash01(x + i, z, seed + 511) * FLOWER_COL.length)],
          });
        }
      }

      // Post-and-rail fence on pasture plot borders (outer edges only).
      if (crop === 'pasture') {
        const edges: Array<[number, number]> = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ];
        for (const [dx, dz] of edges) {
          const nx = x + dx;
          const nz = z + dz;
          const inside =
            nx >= 0 && nz >= 0 && nx < map.size && nz < map.size &&
            plotOf(nx, nz)[0] === px && plotOf(nx, nz)[1] === pz && farmCrop(map, nx, nz) === 'pasture';
          if (inside) continue;
          // Edge line in world space.
          const ex = cx + dx * cellSize * 0.47;
          const ez = cz + dz * cellSize * 0.47;
          const alongEdgeX = dz !== 0;
          for (const t of [-0.5, 0]) {
            posts.push({
              p: [ex + (alongEdgeX ? t * cellSize : 0), y0, ez + (alongEdgeX ? 0 : t * cellSize)],
              s: [0.035 * cellSize, 0.16 * cellSize, 0.035 * cellSize],
              ry: 0,
            });
          }
          for (const hy of [0.07, 0.13]) {
            rails.push({
              p: [ex, y0 + hy * cellSize, ez],
              s: alongEdgeX ? [cellSize, 0.02 * cellSize, 0.02 * cellSize] : [0.02 * cellSize, 0.02 * cellSize, cellSize],
              ry: 0,
            });
          }
        }
      }
    }
  }
  return { rows, flowers, posts, rails, steads, pastures };
}

function useInstances(ref: React.RefObject<THREE.InstancedMesh>, list: Inst[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const d = new THREE.Object3D();
    list.forEach((it, i) => {
      d.position.set(...it.p);
      d.rotation.set(0, it.ry, 0);
      d.scale.set(...it.s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (it.c) m.setColorAt(i, it.c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, list]);
}

export function Farms({ map, cellSize }: FarmsProps) {
  const farm = useMemo(() => buildFarm(map, cellSize), [map, cellSize]);
  const rowRef = useRef<THREE.InstancedMesh>(null);
  const flowerRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);
  useInstances(rowRef, farm.rows);
  useInstances(flowerRef, farm.flowers);
  useInstances(postRef, farm.posts);
  useInstances(railRef, farm.rails);
  const half = (map.size - 1) / 2;
  const y0 = FLAT_TOP * cellSize;

  return (
    <group>
      {farm.rows.length > 0 && (
        <instancedMesh key={`r${farm.rows.length}`} ref={rowRef} args={[BOX, M.rows, farm.rows.length]} castShadow receiveShadow />
      )}
      {farm.flowers.length > 0 && (
        <instancedMesh key={`f${farm.flowers.length}`} ref={flowerRef} args={[BOX, M.flowers, farm.flowers.length]} />
      )}
      {farm.posts.length > 0 && (
        <instancedMesh key={`p${farm.posts.length}`} ref={postRef} args={[BOX, M.post, farm.posts.length]} castShadow />
      )}
      {farm.rails.length > 0 && (
        <instancedMesh key={`l${farm.rails.length}`} ref={railRef} args={[BOX, M.post, farm.rails.length]} castShadow />
      )}
      {farm.steads.map((st) => (
        <group
          key={`${st.x},${st.z}`}
          position={[(st.x - half) * cellSize, y0, (st.z - half) * cellSize]}
          rotation={[0, st.ry, 0]}
          scale={cellSize}
        >
          {st.kind === 'barn' ? <Barn /> : <Windmill phase={st.x * 0.37 + st.z * 0.11} />}
        </group>
      ))}
      <Sheep map={map} cellSize={cellSize} pastures={farm.pastures} />
    </group>
  );
}

// --- Farmsteads (cell units, base at y = 0) ----------------------------------

const BARN_GABLE = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0, 0.24);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: false });
  g.translate(0, 0, -0.35);
  return g;
})();

function Barn() {
  return (
    <group>
      <mesh geometry={BOX} material={M.barn} position={[0, 0, 0]} scale={[0.6, 0.36, 0.7]} castShadow receiveShadow />
      <mesh geometry={BARN_GABLE} material={M.barn} position={[0, 0.36, 0]} castShadow />
      {/* Roof slabs */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={BOX}
          material={M.roof}
          position={[side * 0.155, 0.36 + 0.115, 0]}
          rotation={[0, 0, -side * Math.atan2(0.24, 0.3)]}
          scale={[0.4, 0.025, 0.76]}
          castShadow
        />
      ))}
      {/* Big white-trimmed doors + a hay-loft window */}
      <mesh geometry={BOX} material={M.door} position={[0, 0, 0.351]} scale={[0.24, 0.26, 0.01]} />
      <mesh geometry={BOX} material={M.barnTrim} position={[0, 0.26, 0.352]} scale={[0.28, 0.02, 0.012]} />
      <mesh geometry={BOX} material={M.barnTrim} position={[-0.13, 0, 0.352]} scale={[0.02, 0.27, 0.012]} />
      <mesh geometry={BOX} material={M.barnTrim} position={[0.13, 0, 0.352]} scale={[0.02, 0.27, 0.012]} />
      <mesh geometry={BOX} material={M.window} position={[0, 0.42, 0.352]} scale={[0.08, 0.07, 0.01]} />
      {/* Silo */}
      <mesh material={M.silo} position={[0.42, 0.28, -0.15]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.56, 10]} />
      </mesh>
      <mesh material={M.roof} position={[0.42, 0.6, -0.15]} castShadow>
        <coneGeometry args={[0.12, 0.1, 10]} />
      </mesh>
    </group>
  );
}

function Windmill({ phase }: { phase: number }) {
  const sails = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (sails.current) sails.current.rotation.z = state.clock.getElapsedTime() * 0.9 + phase;
  });
  return (
    <group>
      <mesh material={M.mill} position={[0, 0.36, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.12, 0.2, 0.72, 8]} />
      </mesh>
      <mesh geometry={BOX} material={M.door} position={[0, 0, 0.17]} scale={[0.1, 0.16, 0.02]} />
      <mesh geometry={BOX} material={M.window} position={[0, 0.42, 0.135]} scale={[0.06, 0.06, 0.01]} />
      <mesh material={M.millCap} position={[0, 0.78, 0]} castShadow>
        <coneGeometry args={[0.15, 0.16, 8]} />
      </mesh>
      <group ref={sails} position={[0, 0.7, 0.17]}>
        <mesh material={M.millCap} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.06, 8]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
            <mesh geometry={BOX} material={M.millCap} position={[0, 0.02, 0.02]} scale={[0.018, 0.46, 0.012]} />
            <mesh geometry={BOX} material={M.sail} position={[0.045, 0.12, 0.025]} scale={[0.08, 0.32, 0.006]} castShadow />
          </group>
        ))}
      </group>
    </group>
  );
}

// --- Sheep ------------------------------------------------------------------------

const MAX_SHEEP_PER = 5;
const SHEEP_BODY = new THREE.IcosahedronGeometry(1, 0);

function Sheep({
  map,
  cellSize,
  pastures,
}: {
  map: TerrainMap;
  cellSize: number;
  pastures: Array<{ x0: number; z0: number; x1: number; z1: number; seed: number }>;
}) {
  const half = (map.size - 1) / 2;
  const y0 = FLAT_TOP * cellSize;
  const flock = useMemo(() => {
    const out: Array<{ cx: number; cz: number; rx: number; rz: number; ph: number; sp: number }> = [];
    for (const p of pastures) {
      const n = 3 + Math.floor(hash01(p.seed, 1, map.seed + 520) * (MAX_SHEEP_PER - 2));
      for (let i = 0; i < n; i++) {
        const cx = ((p.x0 + p.x1) / 2 - half) * cellSize;
        const cz = ((p.z0 + p.z1) / 2 - half) * cellSize;
        out.push({
          cx: cx + (hash01(p.seed, i, map.seed + 521) - 0.5) * PLOT * 0.4 * cellSize,
          cz: cz + (hash01(i, p.seed, map.seed + 522) - 0.5) * PLOT * 0.4 * cellSize,
          rx: PLOT * 0.22 * cellSize,
          rz: PLOT * 0.22 * cellSize,
          ph: hash01(p.seed * 3 + i, 7, map.seed + 523) * 100,
          sp: 0.05 + hash01(i, p.seed * 5, map.seed + 524) * 0.06,
        });
      }
    }
    return out;
  }, [pastures, map.seed, half, cellSize]);

  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), h: new THREE.Object3D() }), []);
  useFrame((state) => {
    const b = body.current;
    const hd = head.current;
    if (!b || !hd) return;
    const t = state.clock.getElapsedTime();
    flock.forEach((s, i) => {
      // Wander on a slow Lissajous loop with pauses (grazing).
      const tt = (t * s.sp + s.ph);
      const graze = Math.max(0, Math.sin(tt * 0.7)); // 0 = walking, >0 = paused-ish
      const k = tt - graze * 0.6;
      const x = s.cx + Math.sin(k * 1.3) * s.rx;
      const z = s.cz + Math.sin(k * 0.9 + 1.7) * s.rz;
      const vx = Math.cos(k * 1.3) * 1.3 * s.rx;
      const vz = Math.cos(k * 0.9 + 1.7) * 0.9 * s.rz;
      const yaw = Math.atan2(vx, vz);
      const bob = graze > 0.3 ? 0 : Math.abs(Math.sin(t * 6 + s.ph)) * 0.012 * cellSize;
      tmp.o.position.set(x, y0 + 0.07 * cellSize + bob, z);
      tmp.o.rotation.set(0, yaw, 0);
      tmp.o.scale.set(0.07 * cellSize, 0.055 * cellSize, 0.095 * cellSize);
      tmp.o.updateMatrix();
      b.setMatrixAt(i, tmp.o.matrix);
      // Head: forward, dipped down while grazing.
      const dip = graze * 0.04 * cellSize;
      tmp.h.position.set(x + Math.sin(yaw) * 0.1 * cellSize, y0 + 0.09 * cellSize - dip, z + Math.cos(yaw) * 0.1 * cellSize);
      tmp.h.rotation.set(0, yaw, 0);
      tmp.h.scale.set(0.035 * cellSize, 0.035 * cellSize, 0.045 * cellSize);
      tmp.h.updateMatrix();
      hd.setMatrixAt(i, tmp.h.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    hd.instanceMatrix.needsUpdate = true;
  });
  if (flock.length === 0) return null;
  return (
    <group>
      <instancedMesh key={`sb${flock.length}`} ref={body} args={[SHEEP_BODY, M.wool, flock.length]} castShadow frustumCulled={false} />
      <instancedMesh key={`sh${flock.length}`} ref={head} args={[SHEEP_BODY, M.head, flock.length]} frustumCulled={false} />
    </group>
  );
}

// Re-export so GameCanvas can memo on cells.
export type { Crop };
export { plotCrop };
