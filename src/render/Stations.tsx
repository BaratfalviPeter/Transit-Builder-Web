/**
 * Stations — draws the rail stations docked onto industry sides (the track
 * itself is part of the rail network, drawn by Rails.tsx), and the placement
 * preview of the station tool.
 */

import { Html } from '@react-three/drei';
import {
  CellType,
  INDUSTRY_CENTER_OFFSET,
  INDUSTRY_MODEL_SCALE,
  cornerHeightAt,
  stationGeom,
  type Side,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { StationModel } from './StationModel';
import './stations.css';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

/** Rotation that turns the model's +Z (away from the industry) to `side`. */
const ROT: Record<Side, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

/** World placement of a station model: on the platform/track boundary. */
function placement(map: TerrainMap, cellSize: number, anchor: readonly [number, number], side: Side) {
  const half = (map.size - 1) / 2;
  const g = stationGeom(anchor, side);
  // Mid-point between the platform row and the track row, centred on the side.
  const [px, pz] = g.platform[0];
  const [tx, tz] = g.track[0];
  const alongX = side === 'N' || side === 'S';
  const gx = alongX ? anchor[0] + INDUSTRY_CENTER_OFFSET : (px + tx) / 2;
  const gz = alongX ? (pz + tz) / 2 : anchor[1] + INDUSTRY_CENTER_OFFSET;
  const y = (FLAT_TOP + cornerHeightAt(map, anchor[0], anchor[1])) * cellSize;
  return { pos: [(gx - half) * cellSize, y, (gz - half) * cellSize] as [number, number, number], rot: ROT[side] };
}

export function Stations({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  return (
    <group>
      {(map.stations ?? []).map((s) => {
        const { pos, rot } = placement(map, cellSize, s.anchor, s.side);
        return <StationModel key={s.id} position={pos} rotationY={rot} scale={cellSize * INDUSTRY_MODEL_SCALE} />;
      })}
    </group>
  );
}

export interface StationHover {
  anchor: [number, number];
  side: Side;
  /** Why it can't be built here, or null. */
  problem: string | null;
}

/** Green / red cells where the station would go, plus a label. */
export function StationPreview({ map, cellSize, hover, cost, canAfford }: { map: TerrainMap; cellSize: number; hover: StationHover; cost: number; canAfford: boolean }) {
  const half = (map.size - 1) / 2;
  const g = stationGeom(hover.anchor, hover.side);
  const reason = hover.problem ?? (canAfford ? null : 'Nincs elég pénz');
  const ok = reason === null;
  const y = (FLAT_TOP + cornerHeightAt(map, hover.anchor[0], hover.anchor[1])) * cellSize;
  const { pos } = placement(map, cellSize, hover.anchor, hover.side);
  return (
    <group>
      {[...g.platform, ...g.track].map(([x, z], i) => {
        if (x < 0 || z < 0 || x >= map.size || z >= map.size) return null;
        return (
          <mesh key={i} position={[(x - half) * cellSize, y + 0.06 * cellSize, (z - half) * cellSize]}>
            <boxGeometry args={[cellSize * 0.94, cellSize * 0.08, cellSize * 0.94]} />
            <meshBasicMaterial color={ok ? '#4ade80' : '#f87171'} transparent opacity={i < g.platform.length ? 0.55 : 0.4} depthWrite={false} />
          </mesh>
        );
      })}
      <Html position={[pos[0], pos[1] + cellSize * 1.4, pos[2]]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? `🚉 Vasútállomás · $${cost}` : reason}</div>
      </Html>
    </group>
  );
}
