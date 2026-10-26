/**
 * Traffic controls on the map (see sim/traffic.ts): signal heads on every
 * approach of a junction with lights (switching with the transport clock),
 * yield / STOP signs at the roadside just before their junction, and the
 * island of a roundabout. Plus the hover preview of the traffic tools.
 *
 * Units: cells (sized to the trucks: a pole is about 4.5 m tall).
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  allControls,
  CellType,
  CONTROL_LABEL,
  lightState,
  signJunction,
  useTransport,
  type ControlKind,
  type LightState,
  type TerrainMap,
} from '../sim';
import { groundAtGrid } from './railGeometry';

/** Road coat top above the ground (cells). */
const ROAD_TOP = 0.026;
const POLE_H = 0.38;
/** Where a pole stands: back from the junction edge, out at the roadside. */
const BACK = 0.62;
const SIDE = 0.45;

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

const POLE = new THREE.MeshStandardMaterial({ color: '#8d939a', roughness: 0.6, metalness: 0.3 });
const HOUSING = new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.7 });
const SIGN_RED = new THREE.MeshStandardMaterial({ color: '#c8261e', roughness: 0.5, side: THREE.DoubleSide });
const SIGN_WHITE = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5 });
const GRASS = new THREE.MeshStandardMaterial({ color: '#5f8a3a', roughness: 0.9 });
const CURB = new THREE.MeshStandardMaterial({ color: '#d8d5cc', roughness: 0.8 });
const BUSH = new THREE.MeshStandardMaterial({ color: '#3f6b2c', roughness: 0.9, flatShading: true });

const POLE_GEO = new THREE.CylinderGeometry(0.008, 0.009, POLE_H, 6);
const HEAD_GEO = new THREE.BoxGeometry(0.05, 0.13, 0.04);
const LAMP_GEO = new THREE.SphereGeometry(0.014, 8, 6);
const ISLAND_GEO = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24);
const CURB_GEO = new THREE.CylinderGeometry(0.185, 0.185, 0.022, 24);
const BUSH_GEO = new THREE.IcosahedronGeometry(0.06, 0);

function triangle(r: number): THREE.ShapeGeometry {
  // Point down (yield sign).
  const s = new THREE.Shape();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(s);
}
const YIELD_OUTER = triangle(0.07);
const YIELD_INNER = triangle(0.045);
const OCTAGON = new THREE.CircleGeometry(0.055, 8).rotateZ(Math.PI / 8);
const STOP_BAR = new THREE.PlaneGeometry(0.06, 0.014);

/** Lamp materials per approach axis and colour, switched every frame. */
const LAMP_COLOR: Record<LightState, string> = { red: '#ff3b2f', amber: '#ffb020', green: '#36e06a' };
const LAMPS = {
  x: { red: lamp(), amber: lamp(), green: lamp() },
  z: { red: lamp(), amber: lamp(), green: lamp() },
};
function lamp(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.4, toneMapped: false });
}
const OFF = new THREE.Color('#2a2a2a');

/** World position of a pole on the approach from arm cell (ax, az) into junction (jx, jz). */
function polePlace(map: TerrainMap, cellSize: number, jx: number, jz: number, ax: number, az: number) {
  const half = (map.size - 1) / 2;
  const hx = jx - ax, hz = jz - az; // heading into the junction
  const gx = jx - hx * BACK + -hz * SIDE;
  const gz = jz - hz * BACK + hx * SIDE;
  const y = (groundAtGrid(map, gx, gz) + ROAD_TOP) * cellSize;
  // The face (+Z of the group) looks back at the oncoming traffic.
  const rotY = Math.atan2(-hx, -hz);
  return { pos: [(gx - half) * cellSize, y, (gz - half) * cellSize] as [number, number, number], rotY };
}

function SignalPole({ axis }: { axis: 'x' | 'z' }) {
  const m = LAMPS[axis];
  return (
    <group>
      <mesh geometry={POLE_GEO} material={POLE} position={[0, POLE_H / 2, 0]} castShadow />
      <mesh geometry={HEAD_GEO} material={HOUSING} position={[0, POLE_H - 0.02, 0]} castShadow />
      <mesh geometry={LAMP_GEO} material={m.red} position={[0, POLE_H + 0.02, 0.018]} />
      <mesh geometry={LAMP_GEO} material={m.amber} position={[0, POLE_H - 0.02, 0.018]} />
      <mesh geometry={LAMP_GEO} material={m.green} position={[0, POLE_H - 0.06, 0.018]} />
    </group>
  );
}

function SignPole({ kind }: { kind: 'yield' | 'stop' }) {
  const top = POLE_H - 0.1;
  return (
    <group>
      <mesh geometry={POLE_GEO} material={POLE} position={[0, top / 2, 0]} scale={[1, top / POLE_H, 1]} castShadow />
      {kind === 'yield' ? (
        <group position={[0, top, 0.01]}>
          <mesh geometry={YIELD_OUTER} material={SIGN_RED} />
          <mesh geometry={YIELD_INNER} material={SIGN_WHITE} position={[0, 0.006, 0.001]} />
        </group>
      ) : (
        <group position={[0, top, 0.01]}>
          <mesh geometry={OCTAGON} material={SIGN_RED} />
          <mesh geometry={STOP_BAR} material={SIGN_WHITE} position={[0, 0, 0.001]} />
        </group>
      )}
    </group>
  );
}

export function TrafficControls({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const half = (map.size - 1) / 2;
  const items = useMemo(() => {
    const out: Array<{ key: string; pos: [number, number, number]; rotY: number; node: 'signal' | 'yield' | 'stop' | 'island'; axis: 'x' | 'z' }> = [];
    const road = (x: number, z: number) => x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === CellType.Road;
    for (const [x, z, kind] of allControls(map)) {
      if (kind === 'light') {
        for (let d = 0; d < 4; d++) {
          const ax = x + DX[d], az = z + DZ[d];
          if (!road(ax, az)) continue;
          const p = polePlace(map, cellSize, x, z, ax, az);
          out.push({ key: `l${x},${z},${d}`, ...p, node: 'signal', axis: d < 2 ? 'x' : 'z' });
        }
      } else if (kind === 'roundabout') {
        const y = (groundAtGrid(map, x, z) + ROAD_TOP) * cellSize;
        out.push({ key: `r${x},${z}`, pos: [(x - half) * cellSize, y, (z - half) * cellSize], rotY: 0, node: 'island', axis: 'x' });
      } else {
        const j = signJunction(map, x, z);
        if (!j) continue;
        const p = polePlace(map, cellSize, j[0], j[1], x, z);
        out.push({ key: `s${x},${z}`, ...p, node: kind, axis: 'x' });
      }
    }
    return out;
  }, [map, cellSize, half]);

  // Switch the lamps with the lights' cycle.
  useFrame(() => {
    for (const axis of ['x', 'z'] as const) {
      const on = lightState(sim.clock, axis);
      for (const c of ['red', 'amber', 'green'] as const) {
        const m = LAMPS[axis][c];
        if (c === on) {
          m.color.set(LAMP_COLOR[c]);
          m.emissive.set(LAMP_COLOR[c]);
          m.emissiveIntensity = 2.2;
        } else {
          m.color.copy(OFF);
          m.emissiveIntensity = 0;
        }
      }
    }
  });

  return (
    <group scale={1}>
      {items.map((it) => (
        <group key={it.key} position={it.pos} rotation-y={it.rotY} scale={cellSize}>
          {it.node === 'signal' && <SignalPole axis={it.axis} />}
          {(it.node === 'yield' || it.node === 'stop') && <SignPole kind={it.node} />}
          {it.node === 'island' && (
            <>
              <mesh geometry={CURB_GEO} material={CURB} position={[0, 0.011, 0]} receiveShadow />
              <mesh geometry={ISLAND_GEO} material={GRASS} position={[0, 0.02, 0]} receiveShadow />
              <mesh geometry={BUSH_GEO} material={BUSH} position={[0, 0.07, 0]} castShadow />
            </>
          )}
        </group>
      ))}
    </group>
  );
}

/** Hover preview of a traffic tool: the cell (green / red) and a tip. */
export function TrafficPreview({
  map,
  cellSize,
  x,
  z,
  kind,
  problem,
  cost,
  canAfford,
}: {
  map: TerrainMap;
  cellSize: number;
  x: number;
  z: number;
  kind: ControlKind;
  problem: string | null;
  cost: number;
  canAfford: boolean;
}) {
  const half = (map.size - 1) / 2;
  const reason = problem ?? (canAfford ? null : 'Nincs elég pénz');
  const ok = reason === null;
  const y = (groundAtGrid(map, x, z) + ROAD_TOP) * cellSize;
  return (
    <group position={[(x - half) * cellSize, y, (z - half) * cellSize]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <planeGeometry args={[cellSize * 0.94, cellSize * 0.94]} />
        <meshBasicMaterial color={ok ? '#4ade80' : '#f87171'} transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <Html position={[0, cellSize * 0.9, 0]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? `${CONTROL_LABEL[kind]} · $${cost}` : reason}</div>
      </Html>
    </group>
  );
}
