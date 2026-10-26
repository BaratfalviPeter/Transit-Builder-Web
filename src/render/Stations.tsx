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
  ITEMS,
  STATION_CAPACITY,
  cornerHeightAt,
  DEPOT_CAPACITY,
  depotCells,
  depotCenter,
  depotEntrance,
  depotExit,
  type DepotRot,
  isDepot,
  stationGeom,
  useTransport,
  type Station,
  stopKind,
  useInteriorStore,
  useProductionVersion,
  type Item,
  type Side,
  type StopKind,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { StationModel } from './StationModel';
import { TruckStopModel } from './TruckStopModel';
import { DepotDynamic, DepotModel } from './DepotModel';
import { StaticBatch } from './StaticBatch';
import { useDev } from '../dev/modelEditorStore';
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
  // Stock comes from the interiors' production (re-rendered ~2×/s).
  const prod = useInteriorStore().production;
  useProductionVersion();
  const batch = !useDev().editorOn;
  return (
    <group>
      {(map.stations ?? []).map((s) => {
        if (isDepot(s)) return <Depot key={s.id} map={map} cellSize={cellSize} st={s} batch={batch} />;
        const { pos, rot } = placement(map, cellSize, s.anchor, s.side);
        const total = prod.stationTotal(s.id);
        const stock = prod.stationStock(s.id);
        const parts = (Object.keys(stock) as Item[]).filter((k) => stock[k]).map((k) => `${ITEMS[k].icon} ${stock[k]}`);
        return (
          <group key={s.id}>
            <StaticBatch enabled={batch}>
              {stopKind(s) === 'truck' ? (
                <TruckStopModel position={pos} rotationY={rot} scale={cellSize * INDUSTRY_MODEL_SCALE} fill={total / STATION_CAPACITY} />
              ) : (
                <StationModel position={pos} rotationY={rot} scale={cellSize * INDUSTRY_MODEL_SCALE} fill={total / STATION_CAPACITY} />
              )}
            </StaticBatch>
            {total > 0 && (
              <Html position={[pos[0], pos[1] + cellSize * 1.3, pos[2]]} center style={{ pointerEvents: 'none' }}>
                <div className={'station-tip station-stock' + (total >= STATION_CAPACITY ? ' is-bad' : '')}>
                  {parts.join('  ')} · {total}/{STATION_CAPACITY}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** A freight depot: the model (static parts batched), its lamps / stock, a label. */
function Depot({ map, cellSize, st, batch }: { map: TerrainMap; cellSize: number; st: Station; batch: boolean }) {
  const prod = useInteriorStore().production;
  const sim = useTransport();
  const half = (map.size - 1) / 2;
  const [cx, cz] = depotCenter(st);
  const y = (FLAT_TOP + cornerHeightAt(map, st.anchor[0], st.anchor[1])) * cellSize;
  const pos: [number, number, number] = [(cx - half) * cellSize, y, (cz - half) * cellSize];
  const rotY = -(st.rot ?? 0) * (Math.PI / 2);
  const scale = cellSize * INDUSTRY_MODEL_SCALE;
  const total = prod.stationTotal(st.id);
  const stock = prod.stationStock(st.id);
  const parts = (Object.keys(stock) as Item[]).filter((k) => stock[k]).map((k) => `${ITEMS[k].icon} ${stock[k]}`);
  return (
    <group>
      <StaticBatch enabled={batch}>
        <DepotModel position={pos} rotationY={rotY} scale={scale} staticOnly />
      </StaticBatch>
      <group position={pos} rotation-y={rotY} scale={scale}>
        <DepotDynamic fill={total / DEPOT_CAPACITY} bays={sim.depotBays(st.id)} open={sim.depotOpen(st.id)} />
      </group>
      <Html position={[pos[0], pos[1] + cellSize * 2.4, pos[2]]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip station-stock' + (total >= DEPOT_CAPACITY ? ' is-bad' : '')}>
          🏬 {parts.length ? parts.join('  ') : 'üres'} · {total}/{DEPOT_CAPACITY}
        </div>
      </Html>
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
export function StationPreview({
  map,
  cellSize,
  hover,
  kind,
  cost,
  canAfford,
}: {
  map: TerrainMap;
  cellSize: number;
  hover: StationHover;
  kind: StopKind;
  cost: number;
  canAfford: boolean;
}) {
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
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? `${kind === 'truck' ? '🚚 Kamionrakodó' : '🚉 Vasútállomás'} · $${cost}` : reason}</div>
      </Html>
    </group>
  );
}

/** Row colours of the depot preview (local lz 0…5). */
const DEPOT_ROW_COLOR = ['#8aa0b8', '#8aa0b8', '#e6e2d6', '#e6e2d6', '#c9b37a', '#f0a03a'];

/** The depot tool's preview: the lot by rows (tracks, hall, bays, drive) and a tip. */
export function DepotPlacement({
  map,
  cellSize,
  x0,
  z0,
  rot,
  problem,
  cost,
  canAfford,
}: {
  map: TerrainMap;
  cellSize: number;
  x0: number;
  z0: number;
  rot: DepotRot;
  problem: string | null;
  cost: number;
  canAfford: boolean;
}) {
  const half = (map.size - 1) / 2;
  const reason = problem ?? (canAfford ? null : 'Nincs elég pénz');
  const ok = reason === null;
  const st: Station = { id: 0, anchor: [x0, z0], side: 'S', kind: 'depot', rot };
  const cx = Math.min(map.size - 1, Math.max(0, x0 + 2)), cz = Math.min(map.size - 1, Math.max(0, z0 + 2));
  const y = (FLAT_TOP + cornerHeightAt(map, cx, cz)) * cellSize;
  const [mx, mz] = depotCenter(st);
  const [ex, ez] = depotEntrance(st);
  const [ox, oz] = depotExit(st);
  return (
    <group>
      {depotCells(st).map(({ x, z, lz }) => (
        <mesh key={`${x},${z}`} position={[(x - half) * cellSize, y + 0.06 * cellSize, (z - half) * cellSize]}>
          <boxGeometry args={[cellSize * 0.94, cellSize * 0.06, cellSize * 0.94]} />
          <meshBasicMaterial color={ok ? DEPOT_ROW_COLOR[lz] : '#f87171'} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      <Html position={[(ex - half) * cellSize, y + cellSize * 0.6, (ez - half) * cellSize]} center style={{ pointerEvents: 'none' }}>
        <div className="station-tip">➡ behajtó</div>
      </Html>
      <Html position={[(ox - half) * cellSize, y + cellSize * 0.6, (oz - half) * cellSize]} center style={{ pointerEvents: 'none' }}>
        <div className="station-tip">kihajtó ➡</div>
      </Html>
      <Html position={[(mx - half) * cellSize, y + cellSize * 1.6, (mz - half) * cellSize]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? `🏬 Raktár · $${cost} · Q: forgatás` : reason}</div>
      </Html>
    </group>
  );
}
