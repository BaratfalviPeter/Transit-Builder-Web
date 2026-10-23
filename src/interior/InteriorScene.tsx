/**
 * InteriorScene — the 3D micro view of one industry: its floor and resource
 * tiles, the wall with a gate wherever a station is docked outside, the placed
 * machines, and the placement ghost under the cursor.
 *
 * Input runs on an invisible plane over the grid: hover moves the ghost, a
 * click places the selected machine (or removes one in remove mode), and a
 * left-drag with the conveyor lays a belt line that turns to follow the drag.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CellType,
  INTERIOR_SIZE,
  ITEMS,
  MACHINES,
  ROT_DIR,
  footprint,
  gateTiles,
  resourceTiles,
  type Interior,
  type Machine,
  type MachineKind,
  type ProductionSim,
  type Rot,
  type Side,
} from '../sim';
import { MachineModel, ResourceTile } from './MachineModels';

const N = INTERIOR_SIZE;
/** World centre of tile (x, z). */
export const tileCenter = (x: number, z: number): [number, number] => [x - N / 2 + 0.5, z - N / 2 + 0.5];

/** Floor colours per industry. */
const FLOOR: Partial<Record<CellType, [string, string]>> = {
  [CellType.Mine]: ['#8b7a62', '#7f6f58'],
  [CellType.LumberMill]: ['#7f8a48', '#76823f'],
  [CellType.OilRig]: ['#9a9790', '#8f8c85'],
  [CellType.Factory]: ['#bfb8aa', '#b3ac9e'],
  [CellType.PowerPlant]: ['#b9b4aa', '#ada89e'],
};

export interface Ghost {
  kind: MachineKind | 'remove';
  x: number;
  z: number;
  rot: Rot;
  problem: string | null;
}

export interface SceneInput {
  onHover: (x: number, z: number) => void;
  onLeave: () => void;
  onDown: (x: number, z: number) => void;
  onUp: () => void;
}

function Floor({ type }: { type: CellType }) {
  const [a, b] = FLOOR[type] ?? ['#bfb8aa', '#b3ac9e'];
  const tiles = useMemo(() => {
    const out: Array<[number, number, string]> = [];
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) out.push([x, z, (x + z) % 2 ? a : b]);
    return out;
  }, [a, b]);
  return (
    <group>
      {/* Base slab under the grid */}
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[N + 1.2, 0.3, N + 1.2]} />
        <meshStandardMaterial color="#6e6458" roughness={1} />
      </mesh>
      {tiles.map(([x, z, c]) => {
        const [wx, wz] = tileCenter(x, z);
        return (
          <mesh key={`${x},${z}`} position={[wx, -0.005, wz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[0.98, 0.98]} />
            <meshStandardMaterial color={c} roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Low wall around the grid, open at the gates. */
function Walls({ gates }: { gates: Side[] }) {
  const H = 0.35;
  const T = 0.2;
  const half = N / 2 + T / 2;
  const segs: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
  for (const side of ['N', 'S', 'W', 'E'] as Side[]) {
    const alongX = side === 'N' || side === 'S';
    const off = side === 'N' || side === 'W' ? -half : half;
    const open = gates.includes(side);
    // Either one full wall, or two pieces leaving the 2-tile gate opening.
    const pieces: Array<[number, number]> = open
      ? [
          [-N / 2 - T, -1],
          [1, N / 2 + T],
        ]
      : [[-N / 2 - T, N / 2 + T]];
    for (const [a, b] of pieces) {
      const mid = (a + b) / 2;
      const len = b - a;
      segs.push(alongX ? { p: [mid, H / 2, off], s: [len, H, T] } : { p: [off, H / 2, mid], s: [T, H, len] });
    }
  }
  return (
    <group>
      {segs.map((w, i) => (
        <mesh key={i} position={w.p} castShadow receiveShadow>
          <boxGeometry args={w.s} />
          <meshStandardMaterial color="#8a8378" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** A gate: an arch over the opening, a blue band and a station label. */
function Gate({ side, stock }: { side: Side; stock?: string }) {
  const half = N / 2 + 0.1;
  const pos: [number, number, number] =
    side === 'N' ? [0, 0, -half] : side === 'S' ? [0, 0, half] : side === 'W' ? [-half, 0, 0] : [half, 0, 0];
  const rot = side === 'N' || side === 'S' ? 0 : Math.PI / 2;
  const label = { N: 'É', S: 'D', W: 'Ny', E: 'K' }[side];
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      {[-1.05, 1.05].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]} castShadow>
          <boxGeometry args={[0.16, 1.1, 0.3]} />
          <meshStandardMaterial color="#5d6670" />
        </mesh>
      ))}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[2.3, 0.18, 0.3]} />
        <meshStandardMaterial color="#2f5d9a" />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2, 0.4]} />
        <meshStandardMaterial color="#e2b52c" />
      </mesh>
      <Html position={[0, 1.55, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="iv-gate">
          🚉 Állomás ({label})
          {stock && <div className="iv-gate__stock">{stock}</div>}
        </div>
      </Html>
    </group>
  );
}

/** Items riding the belts: one instanced mesh, placed every frame. */
function BeltItems({ machines, sim }: { machines: readonly Machine[]; sim: ProductionSim }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const MAX = N * N;
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color() }), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    // Allocate the colour buffer up front.
    for (let i = 0; i < MAX; i++) mesh.setColorAt(i, tmp.c.set('#ffffff'));
  }, [MAX, tmp]);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let i = 0;
    for (const m of machines) {
      if (m.kind !== 'conveyor') continue;
      const b = sim.beltItem(m.id);
      if (!b) continue;
      const [wx, wz] = tileCenter(m.x, m.z);
      const [dx, dz] = ROT_DIR[m.rot];
      tmp.o.position.set(wx + dx * (b.progress - 0.5), 0.24, wz + dz * (b.progress - 0.5));
      tmp.o.rotation.set(0, (-m.rot * Math.PI) / 2, 0);
      tmp.o.scale.set(b.item === 'log' ? 0.42 : 0.24, 0.16, b.item === 'log' ? 0.16 : 0.24);
      tmp.o.updateMatrix();
      mesh.setMatrixAt(i, tmp.o.matrix);
      mesh.setColorAt(i, tmp.c.set(ITEMS[b.item].color));
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX]} castShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  );
}

const LAMP = { work: '#4ade80', wait: '#facc15', blocked: '#f87171', idle: '#6b7280' } as const;

/** Status light over a machine: green works, yellow waits for input, red is blocked. */
function StatusLamp({ m, sim }: { m: Machine; sim: ProductionSim }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: LAMP.idle, emissive: LAMP.idle, emissiveIntensity: 0.8 }), []);
  useFrame(() => {
    const c = LAMP[sim.machineStatus(m.id)];
    mat.color.set(c);
    mat.emissive.set(c);
  });
  const n = MACHINES[m.kind].size;
  const [wx, wz] = tileCenter(m.x, m.z);
  return (
    <mesh material={mat} position={[wx + (n - 1) / 2, n === 1 ? 1.15 : 1.6, wz + (n - 1) / 2]}>
      <sphereGeometry args={[0.1, 10, 8]} />
    </mesh>
  );
}

function Resources({ interior }: { interior: Interior }) {
  const res = resourceTiles(interior.type, interior.anchor);
  return (
    <group>
      {res.map((r, i) => {
        if (!r) return null;
        const x = Math.floor(i / N), z = i % N;
        const [wx, wz] = tileCenter(x, z);
        return (
          <group key={i} position={[wx, 0, wz]}>
            <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[0.98, 0.98]} />
              <meshStandardMaterial color={r === 'ore' ? '#5e5248' : r === 'tree' ? '#5f7436' : '#4a4a4a'} roughness={1} />
            </mesh>
            <ResourceTile res={r} seed={i + interior.anchor[0] * 31} />
          </group>
        );
      })}
    </group>
  );
}

function Machines({ machines, hideUnder }: { machines: readonly Machine[]; hideUnder: Machine | null }) {
  return (
    <group>
      {machines.map((m) => {
        const n = MACHINES[m.kind].size;
        const [wx, wz] = tileCenter(m.x, m.z);
        // Resources under a machine are hidden by it; trees would poke through.
        return (
          <group key={m.id} position={[wx + (n - 1) / 2, 0, wz + (n - 1) / 2]}>
            <MachineModel kind={m.kind} rot={m.rot} phase={m.id * 0.37} />
            {hideUnder?.id === m.id && (
              <mesh position={[0, 0.6, 0]}>
                <boxGeometry args={[n * 0.98, 1.3, n * 0.98]} />
                <meshBasicMaterial color="#f87171" transparent opacity={0.35} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function GhostView({ ghost }: { ghost: Ghost }) {
  if (ghost.kind === 'remove') {
    const [wx, wz] = tileCenter(ghost.x, ghost.z);
    return (
      <mesh position={[wx, 0.02, wz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.96, 0.96]} />
        <meshBasicMaterial color="#f87171" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    );
  }
  const n = MACHINES[ghost.kind].size;
  const ok = ghost.problem === null;
  const [wx, wz] = tileCenter(ghost.x, ghost.z);
  const cx = wx + (n - 1) / 2;
  const cz = wz + (n - 1) / 2;
  return (
    <group>
      {footprint(ghost.kind, ghost.x, ghost.z).map(([x, z]) => {
        const [tx, tz] = tileCenter(x, z);
        return (
          <mesh key={`${x},${z}`} position={[tx, 0.02, tz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.96, 0.96]} />
            <meshBasicMaterial color={ok ? '#4ade80' : '#f87171'} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        );
      })}
      {ok && (
        <group position={[cx, 0.01, cz]}>
          <MachineModel kind={ghost.kind} rot={ghost.rot} />
        </group>
      )}
      {!ok && (
        <Html position={[cx, 1.2, cz]} center style={{ pointerEvents: 'none' }}>
          <div className="iv-tip is-bad">{ghost.problem}</div>
        </Html>
      )}
    </group>
  );
}

export function InteriorScene({
  interior,
  gates,
  gateStock,
  sim,
  ghost,
  removeTarget,
  input,
}: {
  interior: Interior;
  gates: Side[];
  /** Station stock text per gate side. */
  gateStock: Partial<Record<Side, string>>;
  sim: ProductionSim;
  ghost: Ghost | null;
  removeTarget: Machine | null;
  input: SceneInput;
}) {
  const down = useRef(false);
  const tileOf = (e: ThreeEvent<PointerEvent>) => {
    const x = Math.floor(e.point.x + N / 2);
    const z = Math.floor(e.point.z + N / 2);
    return x >= 0 && z >= 0 && x < N && z < N ? ([x, z] as const) : null;
  };
  // Gate tiles marked on the floor (where belts leave / enter).
  const gateMarks = gates.flatMap(gateTiles);
  return (
    <group>
      <Floor type={interior.type} />
      <Resources interior={interior} />
      {gateMarks.map(([x, z]) => {
        const [wx, wz] = tileCenter(x, z);
        return (
          <mesh key={`g${x},${z}`} position={[wx, 0.003, wz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.96, 0.96]} />
            <meshStandardMaterial color="#6f8fbf" roughness={1} />
          </mesh>
        );
      })}
      <Walls gates={gates} />
      {gates.map((g) => (
        <Gate key={g} side={g} stock={gateStock[g]} />
      ))}
      <Machines machines={interior.machines} hideUnder={removeTarget} />
      <BeltItems machines={interior.machines} sim={sim} />
      {interior.machines.map((m) => (MACHINES[m.kind].recipe ? <StatusLamp key={m.id} m={m} sim={sim} /> : null))}
      {ghost && <GhostView ghost={ghost} />}
      {/* Input plane over the whole grid */}
      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onPointerMove={(e) => {
          const t = tileOf(e);
          if (t) input.onHover(t[0], t[1]);
          else input.onLeave();
        }}
        onPointerLeave={() => input.onLeave()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const t = tileOf(e);
          if (!t) return;
          down.current = true;
          input.onDown(t[0], t[1]);
        }}
        onPointerUp={() => {
          if (!down.current) return;
          down.current = false;
          input.onUp();
        }}
      >
        <planeGeometry args={[N, N]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

