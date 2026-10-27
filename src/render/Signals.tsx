/**
 * Rail signals on the map: a mast on the right of the track (for the trains
 * it governs) with a head facing them — red, or green while a train has its
 * way reserved past it (TransportSim.signalGreens). Plus the placement
 * preview of the signal tool.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { SIGNAL_PRICE, signalsOf, useTransport, type SignalMode, type SignalSpot, type TerrainMap } from '../sim';
import { groundAtGrid } from './railGeometry';

/** Mast distance from the track centre (cells). */
const SIDE = 0.3;
const MAST_H = 0.46;

const RED = new THREE.Color('#ff3b30');
const GREEN = new THREE.Color('#34d058');
const POLE_MAT = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.6, metalness: 0.4 });
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.5 });
const POLE_GEO = new THREE.CylinderGeometry(0.018, 0.024, MAST_H, 8).translate(0, MAST_H / 2, 0);
const HEAD_GEO = new THREE.BoxGeometry(0.06, 0.15, 0.08);
const LAMP_GEO = new THREE.SphereGeometry(0.026, 10, 8);

/** Where a signal's mast stands and which way its head looks (grid coords; yaw about Y). */
function mastPlace(x: number, z: number, tx: number, tz: number, mode: SignalMode) {
  // Direction of the trains it governs, and its right-hand side.
  const dx = mode === 'fwd' ? tx : -tx, dz = mode === 'fwd' ? tz : -tz;
  return { mx: x - dz * SIDE, mz: z + dx * SIDE, yaw: Math.atan2(-dz, dx) };
}

/** One signal: mast + head; `lamp` is coloured by the caller. */
function SignalMast({ lampRef, ghost }: { lampRef?: (m: THREE.MeshBasicMaterial | null) => void; ghost?: string }) {
  const ghostMat = useMemo(() => (ghost ? new THREE.MeshBasicMaterial({ color: ghost, transparent: true, opacity: 0.6, depthWrite: false }) : null), [ghost]);
  return (
    <group>
      <mesh geometry={POLE_GEO} material={ghostMat ?? POLE_MAT} castShadow={!ghost} />
      {/* The head looks along −X (towards the trains coming); the lamp on its face. */}
      <group position={[0, MAST_H, 0]}>
        <mesh geometry={HEAD_GEO} material={ghostMat ?? HEAD_MAT} />
        <mesh geometry={LAMP_GEO} position={[-0.035, 0.03, 0]}>
          <meshBasicMaterial ref={lampRef} color={ghost ?? RED} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

export function RailSignals({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const half = (map.size - 1) / 2;
  const sigs = signalsOf(map);
  const all = map.signals ?? [];
  const lamps = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  useFrame(() => {
    if (!sigs.length) return;
    const green = sim.signalGreens(map);
    sigs.forEach((s, k) => {
      const m = lamps.current[k];
      if (!m) return;
      const i = all.indexOf(s);
      m.color.copy(green.has(`${i}:${s.mode === 'fwd' ? 1 : -1}`) ? GREEN : RED);
    });
  });
  return (
    <group scale={cellSize}>
      {sigs.map((s, k) => {
        const { mx, mz, yaw } = mastPlace(s.x, s.z, s.tx, s.tz, s.mode);
        return (
          <group key={`${s.x},${s.z}`} position={[mx - half, groundAtGrid(map, mx, mz), mz - half]} rotation-y={yaw}>
            <SignalMast lampRef={(m) => (lamps.current[k] = m)} />
          </group>
        );
      })}
    </group>
  );
}

/** The signal tool's preview: a ghost signal where it would go, with a tip. */
export function SignalPreview({ map, cellSize, spot, canAfford }: { map: TerrainMap; cellSize: number; spot: SignalSpot; canAfford: boolean }) {
  const half = (map.size - 1) / 2;
  const turn = spot.existing >= 0;
  const reason = spot.problem ?? (turn || canAfford ? null : 'Nincs elég pénz');
  const mode: SignalMode = turn ? (spot.mode === 'fwd' ? 'back' : 'fwd') : spot.mode;
  const { mx, mz, yaw } = mastPlace(spot.x, spot.z, spot.tx, spot.tz, mode);
  const y = groundAtGrid(map, mx, mz);
  return (
    <group scale={cellSize}>
      <group position={[mx - half, y, mz - half]} rotation-y={yaw}>
        <SignalMast ghost={reason ? '#f87171' : '#4ade80'} />
      </group>
      <Html position={[spot.x - half, y + 0.9, spot.z - half]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (reason ? ' is-bad' : '')}>{reason ?? (turn ? 'Jelző megfordítása' : `Jelző · $${SIGNAL_PRICE}`)}</div>
      </Html>
    </group>
  );
}
