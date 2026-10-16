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
 * Extras: a yellow lever at every switch (3+ track ends meeting), and at level
 * crossings (track over a road cell) the ballast/sleepers are left out and
 * red/white barrier posts stand beside the road.
 *
 * A few instanced draw calls for the whole network; rebuilt only when the cell
 * types / rail network change (memoized on cellsVersion).
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CellType, LineWalker, railIndex, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchRef } from './cloudShadows';
import { groundAtGrid, sampleTrack } from './railGeometry';

export interface RailsProps {
  map: TerrainMap;
  cellSize: number;
}

const GRAVEL_COLOR = CELL_STYLE[CellType.Rail].color;
const SLEEPER_COLOR = '#5a3f27';
const RAIL_COLOR = '#a3a9b0';
const SURFACE_LIFT = 0.02;
/** Rail half-gauge (cells). */
const GAUGE = 0.2;

// --- unit models (1 cell long along +X; scaled to the unit length) ---------
const BALLAST_GEO = (() => {
  // Deep, tapered gravel bed: where the even grade runs a little above the
  // ground it reads as a low embankment instead of a floating track.
  const g = new THREE.BoxGeometry(1, 0.165, 0.8);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * (0.54 / 0.8)); // taper
  g.translate(0, -0.0375, 0); // spans y −0.12 … 0.045
  g.computeVertexNormals();
  return g;
})();
const RAILS_GEO = (() => {
  const a = new THREE.BoxGeometry(1, 0.04, 0.05).translate(0, 0.08, GAUGE);
  const b = new THREE.BoxGeometry(1, 0.04, 0.05).translate(0, 0.08, -GAUGE);
  return mergeGeometries([a, b])!;
})();
const SLEEPER_GEO = new THREE.BoxGeometry(0.09, 0.035, 0.62).translate(0, 0.0475, 0);

interface Built {
  ballast: THREE.Matrix4[];
  rails: THREE.Matrix4[];
  sleepers: THREE.Matrix4[];
  levers: Array<[number, number, number]>;
  barriers: Array<[number, number, number, number]>;
}

function build(map: TerrainMap, cellSize: number): Built {
  const out: Built = { ballast: [], rails: [], sleepers: [], levers: [], barriers: [] };
  const net = map.railNet;
  if (!net) return out;
  const half = (map.size - 1) / 2;
  const cs = cellSize;
  const f = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);

  for (const e of net.edges) {
    const s = sampleTrack(map, e.pts);
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

  // Level-crossing barriers: two posts per crossed road cell.
  const n = map.size;
  for (const [k, tracks] of railIndex(map)) {
    const x = Math.floor(k / n), z = k - x * n;
    if (map.cells[x][z] !== CellType.Road) continue;
    const t = tracks[0];
    const alongZ = Math.abs(t.tz) >= Math.abs(t.tx); // track ~N–S → road along x
    const y = (groundAtGrid(map, x, z) + CELL_STYLE[CellType.Road].scaleY + SURFACE_LIFT) * cs;
    for (const sgn of [-1, 1]) {
      const u = alongZ ? 0.36 * sgn : 0.44 * sgn;
      const v = alongZ ? -0.44 * sgn : 0.36 * sgn;
      out.barriers.push([(x - half + u) * cs, y, (z - half + v) * cs, alongZ ? 0 : Math.PI / 2]);
    }
  }
  return out;
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
  if (b.rails.length === 0) return null;
  return (
    <group>
      <Instances geo={BALLAST_GEO} mats={b.ballast} color={GRAVEL_COLOR} />
      <Instances geo={SLEEPER_GEO} mats={b.sleepers} color={SLEEPER_COLOR} />
      <Instances geo={RAILS_GEO} mats={b.rails} color={RAIL_COLOR} metal />
      {b.levers.length > 0 && <SwitchLevers positions={b.levers} cellSize={cellSize} />}
      {b.barriers.length > 0 && <Barriers posts={b.barriers} cellSize={cellSize} />}
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

/** Level-crossing barriers: a white post with a raised red boom, instanced. */
function Barriers({ posts, cellSize }: { posts: Array<[number, number, number, number]>; cellSize: number }) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const boomRef = useRef<THREE.InstancedMesh>(null);
  const tipRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const c = cellSize;
    const each = (mesh: THREE.InstancedMesh | null, f: (p: [number, number, number, number]) => void) => {
      if (!mesh) return;
      posts.forEach((p, i) => {
        f(p);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    each(postRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.14 * c, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.06 * c, 0.28 * c, 0.06 * c);
    });
    each(boomRef.current, ([x, y, z, yaw]) => {
      d.position.set(x, y + 0.52 * c, z);
      d.rotation.set(0, yaw, 0);
      d.rotateZ(-0.18);
      d.scale.set(0.03 * c, 0.5 * c, 0.03 * c);
    });
    each(tipRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.3 * c, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.09 * c, 0.05 * c, 0.09 * c);
    });
  }, [posts, cellSize]);
  const n = posts.length;
  return (
    <group>
      <instancedMesh key={`p${n}`} ref={postRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#f2f0ea" roughness={0.6} />
      </instancedMesh>
      <instancedMesh key={`b${n}`} ref={boomRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#d8342c" roughness={0.5} />
      </instancedMesh>
      <instancedMesh key={`t${n}`} ref={tipRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#d8342c" roughness={0.5} emissive="#5a0b08" />
      </instancedMesh>
    </group>
  );
}
