/**
 * Rails — renders the rail network (sim/railNet.ts) by repeating ONE short
 * track unit along every centre-line.
 *
 * The unit is 1/10 cell long (railGeometry.UNIT): a tapered gravel ballast
 * slice plus the two steel rails. It is placed at every sample along the line,
 * rotated to the line's direction and pitched to its (smoothed) grade, so
 * straights, wide arcs and slopes all come out perfectly smooth — no per-cell
 * pieces, no seams. Wooden sleepers are a second instanced unit every 0.2.
 *
 * Extras: a yellow lever at every switch (3+ track ends meeting); at level
 * crossings (track over a road cell) the ballast/sleepers are left out (the
 * barriers: LevelCrossings.tsx).
 *
 * A few instanced draw calls for the whole network; rebuilt only when the cell
 * types / rail network change (memoized on cellsVersion).
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CellType, LineWalker, TRAIN_SCALE, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchRef } from './cloudShadows';
import { groundAtGrid, sampleTrack, type TrackSamples } from './railGeometry';

export interface RailsProps {
  map: TerrainMap;
  cellSize: number;
}

const GRAVEL_COLOR = CELL_STYLE[CellType.Rail].color;
const SLEEPER_COLOR = '#5a3f27';
const RAIL_COLOR = '#a3a9b0';
const SURFACE_LIFT = 0.02;
/** Rail half-gauge (cells) — sized to the trains / trucks (see TrainModel). */
const GAUGE = 0.075 * TRAIN_SCALE;

// --- unit models (1 cell long along +X; scaled to the unit length) ---------
const BALLAST_GEO = (() => {
  // Deep, tapered gravel bed: where the even grade runs a little above the
  // ground it reads as a low embankment instead of a floating track.
  const g = new THREE.BoxGeometry(1, 0.165, 0.5 * TRAIN_SCALE);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * (0.36 / 0.5)); // taper
  g.translate(0, -0.0375, 0); // spans y −0.12 … 0.045
  g.computeVertexNormals();
  return g;
})();
const RAILS_GEO = (() => {
  const a = new THREE.BoxGeometry(1, 0.035, 0.024).translate(0, 0.0825, GAUGE);
  const b = new THREE.BoxGeometry(1, 0.035, 0.024).translate(0, 0.0825, -GAUGE);
  return mergeGeometries([a, b])!;
})();
const SLEEPER_GEO = new THREE.BoxGeometry(0.07 * TRAIN_SCALE, 0.03, 0.3 * TRAIN_SCALE).translate(0, 0.05, 0);

/** Embankment: earth slopes from the ballast's foot down to the ground (1 : EMB_SLOPE). */
const EMB_COLOR = '#74674f';
const EMB_SLOPE = 1.3;
/** The bank starts at the ballast's top edge (see BALLAST_GEO) and hides its box sides. */
const FOOT_HW = 0.18 * TRAIN_SCALE;
const FOOT_Y = SURFACE_LIFT + 0.04;

interface Built {
  /** Embankment triangles (world xyz), one non-indexed soup. */
  embankment: number[];
  ballast: THREE.Matrix4[];
  rails: THREE.Matrix4[];
  sleepers: THREE.Matrix4[];
  levers: Array<[number, number, number]>;
}

function build(map: TerrainMap, cellSize: number): Built {
  const out: Built = { embankment: [], ballast: [], rails: [], sleepers: [], levers: [] };
  const net = map.railNet;
  if (!net) return out;
  const half = (map.size - 1) / 2;
  const cs = cellSize;
  const f = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);

  for (const e of net.edges) {
    const s = sampleTrack(map, e.pts);
    embankment(map, s, cs, half, out.embankment);
    for (let i = 0; i < s.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(s.n - 1, i + 1);
      const grade = b > a ? (s.h[b] - s.h[a]) / ((b - a) * s.step) : 0;
      f.set(s.tx[i], grade, s.tz[i]).normalize();
      side.crossVectors(f, Y).normalize();
      up.crossVectors(side, f);
      const wx = (s.x[i] - half) * cs, wz = (s.z[i] - half) * cs;
      const wy = (s.h[i] + SURFACE_LIFT) * cs;
      const unit = (sx: number) => {
        const m = new THREE.Matrix4().makeBasis(f, up, side);
        m.scale(new THREE.Vector3(sx, cs, cs));
        m.setPosition(wx, wy, wz);
        return m;
      };
      const cx = Math.round(s.x[i]), cz = Math.round(s.z[i]);
      const onRoad = map.cells[cx]?.[cz] === CellType.Road;
      out.rails.push(unit(s.step * cs * 1.04));
      if (onRoad) continue; // level crossing: rails set into the road
      out.ballast.push(unit(s.step * cs * 1.04));
      if (i % 2 === 0) out.sleepers.push(unit(cs));
    }
  }

  // Switch levers: where 3+ edge ends meet.
  const ends = new Map<string, Array<{ x: number; z: number; tx: number; tz: number; far: [number, number] }>>();
  for (const e of net.edges) {
    const w = new LineWalker(e.pts);
    const o = [0, 0, 0, 0];
    for (const atStart of [true, false]) {
      w.at(atStart ? 0 : w.total, o);
      const x = o[0], z = o[1];
      const tx = atStart ? -o[2] : o[2], tz = atStart ? -o[3] : o[3];
      const far = w.at(atStart ? Math.min(3, w.total) : Math.max(0, w.total - 3));
      const key = `${Math.round(x * 50)},${Math.round(z * 50)}`;
      let arr = ends.get(key);
      if (!arr) ends.set(key, (arr = []));
      arr.push({ x, z, tx, tz, far: [far[0], far[1]] });
    }
  }
  for (const arr of ends.values()) {
    if (arr.length < 3) continue;
    const { x, z, tx, tz } = arr[0];
    const px = -tz, pz = tx;
    let lat = 0;
    for (const q of arr) lat += px * (q.far[0] - x) + pz * (q.far[1] - z);
    const sg = lat > 0 ? -0.55 : 0.55;
    const lx = x + px * sg, lz = z + pz * sg;
    out.levers.push([(lx - half) * cs, (groundAtGrid(map, lx, lz) + SURFACE_LIFT) * cs, (lz - half) * cs]);
  }

  return out;
}

/**
 * Earth embankment under one edge: from each side of the ballast's foot a
 * slope runs down and out to the ground there, so a track on a hillside or
 * above a dip stands on a sloped bank instead of a floating box. Where the
 * ground is higher (cutting side) the bank stays hidden in the terrain.
 */
function embankment(map: TerrainMap, s: TrackSamples, cs: number, half: number, out: number[]): void {
  type Sec = [number, number, number][]; // outer L, foot L, foot R, outer R (cell units)
  const secs: Array<Sec | null> = [];
  for (let i = 0; i < s.n; i++) {
    const x = s.x[i], z = s.z[i];
    const cx = Math.round(x), cz = Math.round(z);
    if (map.cells[cx]?.[cz] === CellType.Road) {
      secs.push(null); // level crossing
      continue;
    }
    const nx = -s.tz[i], nz = s.tx[i];
    const fy = s.h[i] + FOOT_Y;
    const side = (sg: number): [number, number, number] => {
      // Ground under the foot, then once more where the slope lands.
      let drop = Math.max(0, fy - groundAtGrid(map, x + nx * FOOT_HW * sg, z + nz * FOOT_HW * sg));
      const o = FOOT_HW + drop * EMB_SLOPE;
      drop = Math.max(0, fy - groundAtGrid(map, x + nx * o * sg, z + nz * o * sg));
      const r = FOOT_HW + drop * EMB_SLOPE + 0.04;
      return [x + nx * r * sg, fy - drop - 0.04, z + nz * r * sg];
    };
    secs.push([side(1), [x + nx * FOOT_HW, fy, z + nz * FOOT_HW], [x - nx * FOOT_HW, fy, z - nz * FOOT_HW], side(-1)]);
  }
  const W = (p: [number, number, number]) => [(p[0] - half) * cs, p[1] * cs, (p[2] - half) * cs];
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  for (let i = 0; i + 1 < secs.length; i++) {
    const A = secs[i], B = secs[i + 1];
    if (!A || !B) continue;
    const a = A.map(W), b = B.map(W);
    quad(a[0], b[0], b[1], a[1]); // left slope (outer → foot)
    quad(a[2], b[2], b[3], a[3]); // right slope
  }
}

/** One InstancedMesh filled from a matrix list. */
function Instances({
  geo,
  mats,
  color,
  metal,
}: {
  geo: THREE.BufferGeometry;
  mats: THREE.Matrix4[];
  color: string;
  metal?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    mats.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [mats]);
  if (mats.length === 0) return null;
  return (
    <instancedMesh key={mats.length} ref={ref} args={[geo, undefined, mats.length]} castShadow receiveShadow>
      <meshStandardMaterial
        ref={patchRef}
        color={color}
        roughness={metal ? 0.35 : 0.95}
        metalness={metal ? 0.6 : 0}
      />
    </instancedMesh>
  );
}

export function Rails({ map, cellSize }: RailsProps) {
  const b = useMemo(() => build(map, cellSize), [map, cellSize]);
  const bank = useMemo(() => {
    if (!b.embankment.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.embankment, 3));
    g.computeVertexNormals();
    return g;
  }, [b]);
  useLayoutEffect(() => () => bank?.dispose(), [bank]);
  if (b.rails.length === 0) return null;
  return (
    <group>
      {bank && (
        <mesh geometry={bank} castShadow receiveShadow>
          <meshStandardMaterial ref={patchRef} color={EMB_COLOR} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      )}
      <Instances geo={BALLAST_GEO} mats={b.ballast} color={GRAVEL_COLOR} />
      <Instances geo={SLEEPER_GEO} mats={b.sleepers} color={SLEEPER_COLOR} />
      <Instances geo={RAILS_GEO} mats={b.rails} color={RAIL_COLOR} metal />
      {b.levers.length > 0 && <SwitchLevers positions={b.levers} cellSize={cellSize} />}
    </group>
  );
}

/** Small yellow switch-stand lever beside each turnout, instanced. */
function SwitchLevers({ positions, cellSize }: { positions: Array<[number, number, number]>; cellSize: number }) {
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const leverRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const set = (mesh: THREE.InstancedMesh | null, f: (p: [number, number, number]) => void) => {
      if (!mesh) return;
      positions.forEach((p, i) => {
        f(p);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    set(baseRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.03 * cellSize, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.08 * cellSize, 0.06 * cellSize, 0.08 * cellSize);
    });
    set(leverRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.13 * cellSize, z);
      d.rotation.set(0, 0, Math.PI / 5);
      d.scale.set(0.024 * cellSize, 0.16 * cellSize, 0.024 * cellSize);
    });
  }, [positions, cellSize]);
  return (
    <group>
      <instancedMesh key={`b${positions.length}`} ref={baseRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#2d2f34" roughness={0.6} metalness={0.3} />
      </instancedMesh>
      <instancedMesh key={`l${positions.length}`} ref={leverRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#e8b82e" roughness={0.5} />
      </instancedMesh>
    </group>
  );
}
