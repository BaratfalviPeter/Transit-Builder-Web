/**
 * Structures — bridges and tunnels (sim/structures.ts), and the placement
 * preview of the Híd / Alagút tools.
 *
 * Bridge: a concrete deck at the abutments' height from one abutment's edge
 * to the other's, a pillar under every spanned cell (down to the ground or
 * the river bed), railings; a road surface with a centre line when it
 * carries a road (a rail is drawn by Rails.tsx at the deck height).
 * Tunnel: a stone portal at each end (where the span begins), opening into
 * the hill / under the road; what runs inside is not drawn.
 *
 * Built in world units from the cell grid ((x − half)·cellSize); one small
 * group of boxes per structure — there are only a handful.
 */

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { axisOf, CellType, interiorOf, type Structure, type StructureKind, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchCloudShadows } from './cloudShadows';
import { groundAtGrid } from './railGeometry';
import { WATER_LEVEL } from './TerrainSurface';
import './stations.css';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
/** Deck top above the abutments' ground (the road / rail surface sits here). */
export const DECK_LIFT = 0.03;
const DECK_T = 0.11;

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  patchCloudShadows(m);
  return m;
};
const M = {
  concrete: std('#b9b3a6'),
  concreteDark: std('#9a9488'),
  rail: std('#5f656d', { roughness: 0.5, metalness: 0.4 }),
  asphalt: std('#3a3d42', { roughness: 1 }),
  line: new THREE.MeshBasicMaterial({ color: '#e8e4d6' }),
  stone: std('#8d877c'),
  stoneDark: std('#6f6a61'),
  hole: new THREE.MeshBasicMaterial({ color: '#141518' }),
};
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** The plan the Híd / Alagút tool shows while dragging. */
export interface StructPlan {
  kind: StructureKind;
  a: [number, number];
  b: [number, number];
  problem: string | null;
  cost: number;
}

type V3 = [number, number, number];
function Box({ p, s, m, rotY = 0 }: { p: V3; s: V3; m: THREE.Material; rotY?: number }) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} rotation-y={rotY} castShadow receiveShadow />;
}

export function Structures({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const list = map.structures ?? [];
  if (!list.length) return null;
  return (
    <group>
      {list.map((s) => (s.kind === 'bridge' ? <Bridge key={s.id} map={map} cellSize={cellSize} s={s} /> : <Tunnel key={s.id} map={map} cellSize={cellSize} s={s} />))}
    </group>
  );
}

/** Local frame of a span: centre, length, yaw (+x of the group runs a → b). */
function frameOf(map: TerrainMap, s: Pick<Structure, 'a' | 'b'>, cellSize: number) {
  const half = (map.size - 1) / 2;
  const [dx, dz] = axisOf(s);
  const cx = (s.a[0] + s.b[0]) / 2, cz = (s.a[1] + s.b[1]) / 2;
  const len = Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]) - 1; // spanned cells
  return { pos: [(cx - half) * cellSize, 0, (cz - half) * cellSize] as V3, len, yaw: Math.atan2(-dz, dx) };
}

function Bridge({ map, cellSize, s }: { map: TerrainMap; cellSize: number; s: Structure }) {
  const parts = useMemo(() => {
    const { pos, len, yaw } = frameOf(map, s, cellSize);
    const top = FLAT_TOP + s.level + DECK_LIFT;
    const W = s.carries === 'road' ? 0.86 : 0.72;
    const cells = interiorOf(s);
    // Pillars: under every spanned cell, from the deck to the ground / river bed.
    const pillars = cells.map(([x, z], i) => {
      const water = map.cells[x][z] === CellType.Water;
      const g = water ? WATER_LEVEL - 0.25 : groundAtGrid(map, x, z) - 0.05;
      const t = i - (cells.length - 1) / 2; // along the span, cells from its middle
      return { t, g };
    });
    return { pos, len, yaw, top, W, pillars };
  }, [map, s, cellSize]);
  const { pos, len, yaw, top, W, pillars } = parts;
  const y0 = top - DECK_T / 2;
  return (
    <group position={pos} rotation-y={yaw} scale={cellSize}>
      {/* deck */}
      <Box p={[0, y0, 0]} s={[len, DECK_T, W]} m={M.concrete} />
      <Box p={[0, top - DECK_T - 0.02, 0]} s={[len, 0.04, W * 0.7]} m={M.concreteDark} />
      {/* pillars */}
      {pillars.map(({ t, g }) => {
        const h = top - DECK_T - g;
        return h > 0.02 ? <Box key={t} p={[t, g + h / 2, 0]} s={[0.16, h, W * 0.55]} m={M.concreteDark} /> : null;
      })}
      {/* railings: a rail on posts along both edges */}
      {[-1, 1].map((sd) => {
        const posts = Math.max(2, Math.round(len * 3) + 1);
        return (
          <group key={sd}>
            <Box p={[0, top + 0.07, (sd * W) / 2]} s={[len, 0.02, 0.025]} m={M.rail} />
            {Array.from({ length: posts }, (_, k) => (
              <Box key={k} p={[-len / 2 + (len * k) / (posts - 1), top + 0.035, (sd * W) / 2]} s={[0.02, 0.07, 0.02]} m={M.rail} />
            ))}
          </group>
        );
      })}
      {/* road surface + centre dashes */}
      {s.carries === 'road' && (
        <>
          <Box p={[0, top + 0.004, 0]} s={[len, 0.008, 0.7]} m={M.asphalt} />
          {Array.from({ length: Math.max(1, Math.floor(len / 0.26)) }, (_, k) => (
            <Box key={k} p={[-len / 2 + 0.13 + k * 0.26, top + 0.01, 0]} s={[0.14, 0.004, 0.032]} m={M.line} />
          ))}
        </>
      )}
    </group>
  );
}

function Tunnel({ map, cellSize, s }: { map: TerrainMap; cellSize: number; s: Structure }) {
  const { pos, len, yaw } = frameOf(map, s, cellSize);
  const floor = FLAT_TOP + s.level;
  // A portal at each end of the span, facing out (towards its abutment).
  return (
    <group position={pos} rotation-y={yaw} scale={cellSize}>
      {[-1, 1].map((sd) => (
        <group key={sd} position={[(sd * len) / 2, floor, 0]} rotation-y={sd > 0 ? Math.PI : 0}>
          {/* facade wall with the opening; the face looks towards −x (the abutment) */}
          <Box p={[0.06, 0.24, -0.38]} s={[0.12, 0.48, 0.22]} m={M.stone} />
          <Box p={[0.06, 0.24, 0.38]} s={[0.12, 0.48, 0.22]} m={M.stone} />
          <Box p={[0.06, 0.43, 0]} s={[0.12, 0.1, 0.98]} m={M.stone} />
          <Box p={[0.04, 0.49, 0]} s={[0.15, 0.03, 1.02]} m={M.stoneDark} />
          {/* the dark mouth, a little way in */}
          <Box p={[0.15, 0.19, 0]} s={[0.1, 0.38, 0.54]} m={M.hole} />
          {/* a short roof slab into the span (an underpass reads as going under) */}
          <Box p={[0.28, 0.42, 0]} s={[0.36, 0.05, 0.98]} m={M.stoneDark} />
        </group>
      ))}
    </group>
  );
}

/** The Híd / Alagút tool's plan: the cells it spans (green / red) and a label. */
export function StructurePreview({ map, cellSize, plan, canAfford }: { map: TerrainMap; cellSize: number; plan: StructPlan; canAfford: boolean }) {
  const half = (map.size - 1) / 2;
  const ok = !plan.problem && canAfford;
  const color = ok ? '#46d36a' : '#e5484d';
  const span = interiorOf({ a: plan.a, b: plan.b });
  const ends = plan.a[0] === plan.b[0] && plan.a[1] === plan.b[1] ? [plan.a] : [plan.a, plan.b];
  const y = (x: number, z: number) => (groundAtGrid(map, x, z) + 0.06) * cellSize;
  const mid: V3 = [((plan.a[0] + plan.b[0]) / 2 - half) * cellSize, y(plan.a[0], plan.a[1]) + 1.2 * cellSize, ((plan.a[1] + plan.b[1]) / 2 - half) * cellSize];
  const icon = plan.kind === 'bridge' ? '🌉 Híd' : '🚇 Alagút';
  return (
    <group>
      {span.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[(x - half) * cellSize, y(x, z), (z - half) * cellSize]} rotation-x={-Math.PI / 2} renderOrder={12}>
          <planeGeometry args={[cellSize * 0.92, cellSize * 0.92]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} depthTest={false} />
        </mesh>
      ))}
      {ends.map(([x, z]) => (
        <mesh key={`e${x},${z}`} position={[(x - half) * cellSize, y(x, z), (z - half) * cellSize]} rotation-x={-Math.PI / 2} renderOrder={12}>
          <ringGeometry args={[cellSize * 0.28, cellSize * 0.42, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
        </mesh>
      ))}
      <Html position={mid} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>
          {plan.problem ?? (canAfford ? `${icon} · ${span.length} cella · $${plan.cost.toLocaleString('hu-HU')}` : `${icon} · nincs elég pénz ($${plan.cost.toLocaleString('hu-HU')})`)}
        </div>
      </Html>
    </group>
  );
}
