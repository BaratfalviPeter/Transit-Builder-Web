/**
 * Life — ambient movement that makes the world feel inhabited:
 *   - cars driving the road network (right-hand lane, random turns),
 *   - trains (locomotive + wagons) running on the rails,
 *   - little sailboats drifting across the lakes,
 *   - deer browsing along the forest edges.
 *
 * Purely visual: agents are derived from the current map (re-spawned when cell
 * types change) and simulated in useFrame. Everything is instanced (a few
 * draw calls in total) and capped, so it stays cheap on big maps.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, cellCornerHeights, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { surfaceYAt } from './TerrainSurface';
import { patchCloudShadows } from './cloudShadows';
import { registerNightGlow } from './dayNight';
import { hash01 } from './farmland';
import { useVisualKeys } from './visualSettings';

export interface LifeProps {
  map: TerrainMap;
  cellSize: number;
}

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const ROAD_TOP = CELL_STYLE[CellType.Road].scaleY + 0.02;
const RAIL_TOP = CELL_STYLE[CellType.Rail].scaleY + 0.02 + 0.08;
const WATER_Y = FLAT_TOP - 0.2;

const BOX = new THREE.BoxGeometry(1, 1, 1);
BOX.translate(0, 0.5, 0);
const std = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, flatShading: true, ...extra });
const M = {
  car: std('#ffffff'),
  cabin: std('#2c3640', { roughness: 0.3 }),
  lights: std('#fff2c4', { emissive: '#ffe7a0', emissiveIntensity: 0 }),
  loco: std('#b0352a'),
  wagon: std('#ffffff'),
  hull: std('#8a5a3a'),
  sail: std('#f4f1e8', { side: THREE.DoubleSide }),
  deer: std('#8a5b35'),
  deerHead: std('#6f4729'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));
registerNightGlow(M.lights, 0, 2.2);
const CAR_COLS = ['#c8402f', '#2f6db0', '#e8c13a', '#f1efe9', '#3c8a4e', '#4a4f57', '#d47a2c'].map((c) => new THREE.Color(c));
const LOCO_COL = new THREE.Color('#b0352a');
const WAGON_COLS = ['#5a6470', '#7a5236', '#3f5f86', '#6b6f45'].map((c) => new THREE.Color(c));

type Cell = [number, number];
const DIRS: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Bilinear terrain height (cell units) at a world point on (x,z) cell grid. */
function cornerY(map: TerrainMap, fx: number, fz: number): number {
  const x = Math.min(map.size - 1, Math.max(0, Math.round(fx)));
  const z = Math.min(map.size - 1, Math.max(0, Math.round(fz)));
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  const u = fx - (x - 0.5);
  const v = fz - (z - 0.5);
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

interface Walker {
  cx: number;
  cz: number;
  px: number; // previous cell (to avoid U-turns)
  pz: number;
  nx: number;
  nz: number;
  t: number;
  speed: number;
  color: number;
}

/** Pick the next cell on the network, avoiding a U-turn unless forced. */
function nextCell(
  isNet: (x: number, z: number) => boolean,
  w: Walker,
  rnd: number,
): Cell {
  const opts: Cell[] = [];
  for (const [dx, dz] of DIRS) {
    const x = w.nx + dx;
    const z = w.nz + dz;
    if (!isNet(x, z)) continue;
    if (x === w.cx && z === w.cz) continue;
    opts.push([x, z]);
  }
  if (opts.length === 0) return [w.cx, w.cz]; // dead end: turn around
  // Prefer going straight a bit more often.
  const sx = w.nx + (w.nx - w.cx);
  const sz = w.nz + (w.nz - w.cz);
  const straight = opts.find(([x, z]) => x === sx && z === sz);
  if (straight && rnd < 0.55) return straight;
  return opts[Math.floor(rnd * opts.length) % opts.length];
}

function spawnWalkers(
  map: TerrainMap,
  type: CellType,
  count: number,
  salt: number,
  speed: [number, number],
): Walker[] {
  const cells: Cell[] = [];
  for (let x = 0; x < map.size; x++)
    for (let z = 0; z < map.size; z++) if (map.cells[x][z] === type) cells.push([x, z]);
  const isNet = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === type;
  const out: Walker[] = [];
  for (let i = 0; i < count && cells.length > 0; i++) {
    const [cx, cz] = cells[Math.floor(hash01(i, salt, map.seed + 700) * cells.length)];
    const nbs = DIRS.map(([dx, dz]) => [cx + dx, cz + dz] as Cell).filter(([x, z]) => isNet(x, z));
    if (nbs.length === 0) continue;
    const [nx, nz] = nbs[Math.floor(hash01(i, salt, map.seed + 701) * nbs.length)];
    out.push({
      cx,
      cz,
      px: cx,
      pz: cz,
      nx,
      nz,
      t: hash01(i, salt, map.seed + 702),
      speed: speed[0] + hash01(i, salt, map.seed + 703) * (speed[1] - speed[0]),
      color: Math.floor(hash01(i, salt, map.seed + 704) * 16),
    });
  }
  return out;
}

export function Life({ map, cellSize }: LifeProps) {
  const { lifeVisible } = useVisualKeys(['lifeVisible'] as const);
  if (!lifeVisible) return null;
  return (
    <group>
      <Cars map={map} cellSize={cellSize} />
      <Trains map={map} cellSize={cellSize} />
      <Boats map={map} cellSize={cellSize} />
      <Deer map={map} cellSize={cellSize} />
    </group>
  );
}

// --- Cars -------------------------------------------------------------------------

function Cars({ map, cellSize }: LifeProps) {
  const half = (map.size - 1) / 2;
  const cars = useMemo(() => {
    let roads = 0;
    for (let x = 0; x < map.size; x++) for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.Road) roads++;
    return spawnWalkers(map, CellType.Road, Math.min(90, Math.floor(roads / 5)), 1, [0.9, 1.6]);
  }, [map]);
  const body = useRef<THREE.InstancedMesh>(null);
  const cab = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const isRoad = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Road;

  useFrame((state, delta) => {
    const b = body.current;
    const c = cab.current;
    const l = lights.current;
    if (!b || !c || !l) return;
    const dt = Math.min(delta, 0.1);
    cars.forEach((w, i) => {
      w.t += dt * w.speed;
      while (w.t >= 1) {
        w.t -= 1;
        const [x, z] = nextCell(isRoad, w, hash01(i, Math.floor(state.clock.elapsedTime * 7), map.seed));
        w.px = w.cx;
        w.pz = w.cz;
        w.cx = w.nx;
        w.cz = w.nz;
        w.nx = x;
        w.nz = z;
      }
      const dx = w.nx - w.cx;
      const dz = w.nz - w.cz;
      const fx = w.cx + dx * w.t;
      const fz = w.cz + dz * w.t;
      // Right-hand lane: offset perpendicular to travel.
      const lane = 0.2;
      const ox = -dz * lane;
      const oz = dx * lane;
      const gx = fx + ox;
      const gz = fz + oz;
      const y = (FLAT_TOP + cornerY(map, gx, gz) + ROAD_TOP) * cellSize;
      const yaw = Math.atan2(dx, dz);
      tmp.position.set((gx - half) * cellSize, y, (gz - half) * cellSize);
      tmp.rotation.set(0, yaw, 0);
      tmp.scale.set(0.2 * cellSize, 0.09 * cellSize, 0.36 * cellSize);
      tmp.updateMatrix();
      b.setMatrixAt(i, tmp.matrix);
      b.setColorAt(i, CAR_COLS[w.color % CAR_COLS.length]);
      tmp.position.y = y + 0.09 * cellSize;
      tmp.scale.set(0.17 * cellSize, 0.07 * cellSize, 0.18 * cellSize);
      tmp.updateMatrix();
      c.setMatrixAt(i, tmp.matrix);
      // Headlights at the front.
      tmp.position.set(((gx + dx * 0.18) - half) * cellSize, y + 0.03 * cellSize, ((gz + dz * 0.18) - half) * cellSize);
      tmp.scale.set(0.16 * cellSize, 0.03 * cellSize, 0.02 * cellSize);
      tmp.updateMatrix();
      l.setMatrixAt(i, tmp.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
  });
  if (cars.length === 0) return null;
  return (
    <group key={cars.length + ':' + map.cellsVersion}>
      <instancedMesh ref={body} args={[BOX, M.car, cars.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={cab} args={[BOX, M.cabin, cars.length]} frustumCulled={false} />
      <instancedMesh ref={lights} args={[BOX, M.lights, cars.length]} frustumCulled={false} />
    </group>
  );
}

// --- Trains -------------------------------------------------------------------------

const WAGONS = 3;

function Trains({ map, cellSize }: LifeProps) {
  const half = (map.size - 1) / 2;
  const trains = useMemo(() => {
    let rails = 0;
    for (let x = 0; x < map.size; x++) for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.Rail) rails++;
    const n = rails < 6 ? 0 : Math.min(5, 1 + Math.floor(rails / 40));
    return spawnWalkers(map, CellType.Rail, n, 2, [1.1, 1.5]).map((w) => ({
      w,
      trail: [] as Array<[number, number]>,
    }));
  }, [map]);
  const cars = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const isRail = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Rail;

  useFrame((state, delta) => {
    const m = cars.current;
    if (!m) return;
    const dt = Math.min(delta, 0.1);
    let k = 0;
    trains.forEach((tr, ti) => {
      const w = tr.w;
      w.t += dt * w.speed;
      while (w.t >= 1) {
        w.t -= 1;
        const [x, z] = nextCell(isRail, w, hash01(ti, Math.floor(state.clock.elapsedTime * 3), map.seed + 9));
        w.px = w.cx;
        w.pz = w.cz;
        w.cx = w.nx;
        w.cz = w.nz;
        w.nx = x;
        w.nz = z;
      }
      const fx = w.cx + (w.nx - w.cx) * w.t;
      const fz = w.cz + (w.nz - w.cz) * w.t;
      const last = tr.trail[tr.trail.length - 1];
      if (!last || Math.hypot(last[0] - fx, last[1] - fz) > 0.05) tr.trail.push([fx, fz]);
      if (tr.trail.length > 200) tr.trail.shift();
      // Place loco + wagons at fixed arc-length gaps back along the trail.
      for (let c = 0; c <= WAGONS; c++) {
        const back = c * 0.55;
        let acc = 0;
        let px = fx;
        let pz = fz;
        let dirx = w.nx - w.cx;
        let dirz = w.nz - w.cz;
        for (let j = tr.trail.length - 1; j > 0 && acc < back; j--) {
          const [ax, az] = tr.trail[j];
          const [bx, bz] = tr.trail[j - 1];
          const seg = Math.hypot(ax - bx, az - bz);
          if (acc + seg >= back) {
            const f = (back - acc) / seg;
            px = ax + (bx - ax) * f;
            pz = az + (bz - az) * f;
            dirx = ax - bx;
            dirz = az - bz;
            acc = back;
            break;
          }
          acc += seg;
          px = bx;
          pz = bz;
        }
        const y = (FLAT_TOP + cornerY(map, px, pz) + RAIL_TOP) * cellSize;
        tmp.position.set((px - half) * cellSize, y, (pz - half) * cellSize);
        tmp.rotation.set(0, Math.atan2(dirx, dirz), 0);
        tmp.scale.set(0.3 * cellSize, (c === 0 ? 0.24 : 0.18) * cellSize, 0.48 * cellSize);
        tmp.updateMatrix();
        m.setMatrixAt(k, tmp.matrix);
        m.setColorAt(k, c === 0 ? LOCO_COL : WAGON_COLS[(w.color + c) % WAGON_COLS.length]);
        k++;
      }
    });
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  if (trains.length === 0) return null;
  return (
    <instancedMesh
      key={trains.length + ':' + map.cellsVersion}
      ref={cars}
      args={[BOX, M.wagon, trains.length * (WAGONS + 1)]}
      castShadow
      frustumCulled={false}
    />
  );
}

// --- Boats --------------------------------------------------------------------------

function Boats({ map, cellSize }: LifeProps) {
  const half = (map.size - 1) / 2;
  const open = (x: number, z: number) => {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const a = Math.round(x) + dx;
        const b = Math.round(z) + dz;
        if (a < 0 || b < 0 || a >= map.size || b >= map.size || map.cells[a][b] !== CellType.Water) return false;
      }
    return true;
  };
  const boats = useMemo(() => {
    const spots: Cell[] = [];
    for (let x = 2; x < map.size - 2; x += 3)
      for (let z = 2; z < map.size - 2; z += 3) if (open(x, z)) spots.push([x, z]);
    const n = Math.min(10, Math.floor(spots.length / 12));
    return Array.from({ length: n }, (_, i) => {
      const [x, z] = spots[Math.floor(hash01(i, 3, map.seed + 710) * spots.length)];
      return { x, z, a: hash01(i, 4, map.seed + 711) * Math.PI * 2, sp: 0.25 + hash01(i, 5, map.seed + 712) * 0.2 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  const hull = useRef<THREE.InstancedMesh>(null);
  const sail = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame((state, delta) => {
    const h = hull.current;
    const s = sail.current;
    if (!h || !s) return;
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;
    boats.forEach((b, i) => {
      // Gentle drift; turn away whenever the water ahead isn't open.
      b.a += Math.sin(t * 0.2 + i) * 0.003;
      const nx = b.x + Math.cos(b.a) * b.sp * dt;
      const nz = b.z + Math.sin(b.a) * b.sp * dt;
      if (open(nx + Math.cos(b.a) * 1.5, nz + Math.sin(b.a) * 1.5)) {
        b.x = nx;
        b.z = nz;
      } else b.a += 1.3 * dt;
      const yaw = Math.atan2(Math.cos(b.a), Math.sin(b.a));
      const bob = Math.sin(t * 1.7 + i) * 0.01 * cellSize;
      tmp.position.set((b.x - half) * cellSize, WATER_Y * cellSize - 0.02 * cellSize + bob, (b.z - half) * cellSize);
      tmp.rotation.set(Math.sin(t * 1.3 + i) * 0.05, yaw, 0);
      tmp.scale.set(0.18 * cellSize, 0.07 * cellSize, 0.45 * cellSize);
      tmp.updateMatrix();
      h.setMatrixAt(i, tmp.matrix);
      tmp.position.y += 0.07 * cellSize;
      tmp.scale.set(0.02 * cellSize, 0.42 * cellSize, 0.3 * cellSize);
      tmp.updateMatrix();
      s.setMatrixAt(i, tmp.matrix);
    });
    h.instanceMatrix.needsUpdate = true;
    s.instanceMatrix.needsUpdate = true;
  });
  if (boats.length === 0) return null;
  return (
    <group key={boats.length + ':' + map.cellsVersion}>
      <instancedMesh ref={hull} args={[BOX, M.hull, boats.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={sail} args={[BOX, M.sail, boats.length]} castShadow frustumCulled={false} />
    </group>
  );
}

// --- Deer -----------------------------------------------------------------------------

function Deer({ map, cellSize }: LifeProps) {
  const half = (map.size - 1) / 2;
  const herd = useMemo(() => {
    const homes: Cell[] = [];
    for (let x = 1; x < map.size - 1; x++)
      for (let z = 1; z < map.size - 1; z++) {
        if (map.cells[x][z] !== CellType.Empty) continue;
        const f =
          map.cells[x + 1][z] === CellType.Forest ||
          map.cells[x - 1][z] === CellType.Forest ||
          map.cells[x][z + 1] === CellType.Forest ||
          map.cells[x][z - 1] === CellType.Forest;
        if (f && hash01(x, z, map.seed + 720) < 0.025) homes.push([x, z]);
      }
    return homes.slice(0, 30).map(([x, z], i) => ({ x, z, ph: hash01(i, 6, map.seed + 721) * 50 }));
  }, [map]);
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame((state) => {
    const b = body.current;
    const hd = head.current;
    if (!b || !hd) return;
    const t = state.clock.elapsedTime;
    herd.forEach((d, i) => {
      const k = t * 0.12 + d.ph;
      const browse = Math.max(0, Math.sin(k * 1.4)); // pauses
      const kk = k - browse * 0.5;
      const ux = Math.sin(kk) * 0.9;
      const uz = Math.sin(kk * 0.7 + 2) * 0.9;
      const fx = d.x + ux;
      const fz = d.z + uz;
      const cx = Math.round(fx);
      const cz = Math.round(fz);
      const y = cx >= 0 && cz >= 0 && cx < map.size && cz < map.size ? surfaceYAt(map, cx, cz, fx - cx, fz - cz, cellSize) : 0;
      const yaw = Math.atan2(Math.cos(kk) * 0.9, Math.cos(kk * 0.7 + 2) * 0.63);
      tmp.position.set((fx - half) * cellSize, y + 0.07 * cellSize, (fz - half) * cellSize);
      tmp.rotation.set(0, yaw, 0);
      tmp.scale.set(0.07 * cellSize, 0.08 * cellSize, 0.18 * cellSize);
      tmp.updateMatrix();
      b.setMatrixAt(i, tmp.matrix);
      const dip = browse * 0.07 * cellSize;
      tmp.position.set(
        (fx - half) * cellSize + Math.sin(yaw) * 0.1 * cellSize,
        y + 0.15 * cellSize - dip,
        (fz - half) * cellSize + Math.cos(yaw) * 0.1 * cellSize,
      );
      tmp.scale.set(0.045 * cellSize, 0.07 * cellSize, 0.06 * cellSize);
      tmp.updateMatrix();
      hd.setMatrixAt(i, tmp.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    hd.instanceMatrix.needsUpdate = true;
  });
  if (herd.length === 0) return null;
  return (
    <group key={herd.length + ':' + map.cellsVersion}>
      <instancedMesh ref={body} args={[BOX, M.deer, herd.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={head} args={[BOX, M.deerHead, herd.length]} frustumCulled={false} />
    </group>
  );
}
