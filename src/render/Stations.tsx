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
  isOilLot,
  isRefinery,
  OIL_DEPOT_CAPACITY,
  oilCells,
  oilCenter,
  oilStub,
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
import { OIL_GAME_SINK, OilDepotModel } from './OilDepotModel';
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
        if (isOilLot(s)) return <OilDepot key={s.id} map={map} cellSize={cellSize} st={s} batch={batch} />;
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
                <StationModel position={pos} rotationY={rot} scale={cellSize * INDUSTRY_MODEL_SCALE} fill={total / STATION_CAPACITY} ext={s.ext ?? 0} />
              )}
            </StaticBatch>
            {total > 0 && (
              <Html zIndexRange={[10, 0]} position={[pos[0], pos[1] + cellSize * 1.3, pos[2]]} center style={{ pointerEvents: 'none' }}>
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

/** Where a lot model (depot, oil depot) stands: centre at the lot's ground, turned by `rot`. */
function lotPose(map: TerrainMap, cellSize: number, st: Station, [cx, cz]: readonly [number, number]) {
  const half = (map.size - 1) / 2;
  const y = (FLAT_TOP + cornerHeightAt(map, st.anchor[0], st.anchor[1])) * cellSize;
  const pos: [number, number, number] = [(cx - half) * cellSize, y, (cz - half) * cellSize];
  return { pos, rotY: -(st.rot ?? 0) * (Math.PI / 2), scale: cellSize * INDUSTRY_MODEL_SCALE };
}

/** A freight depot: the model (static parts batched), its lamps / stock, a label. */
function Depot({ map, cellSize, st, batch }: { map: TerrainMap; cellSize: number; st: Station; batch: boolean }) {
  const prod = useInteriorStore().production;
  const sim = useTransport();
  const { pos, rotY, scale } = lotPose(map, cellSize, st, depotCenter(st));
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
      <Html zIndexRange={[10, 0]} position={[pos[0], pos[1] + cellSize * 2.4, pos[2]]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip station-stock' + (total >= DEPOT_CAPACITY ? ' is-bad' : '')}>
          🏬 {parts.length ? parts.join('  ') : 'üres'} · {total}/{DEPOT_CAPACITY}
        </div>
      </Html>
    </group>
  );
}

/** An oil depot or a refinery (same lot): the model (batched), its stock as a label. */
function OilDepot({ map, cellSize, st, batch }: { map: TerrainMap; cellSize: number; st: Station; batch: boolean }) {
  const prod = useInteriorStore().production;
  const sim = useTransport();
  const { pos: lot, rotY, scale } = lotPose(map, cellSize, st, oilCenter(st));
  // Sunk so the slab is flush with the ground (the trucks drive straight on).
  const pos: [number, number, number] = [lot[0], lot[1] - OIL_GAME_SINK * scale, lot[2]];
  const refinery = isRefinery(st);
  const oil = Math.floor((refinery ? prod.inboundStock(st.id).oil : prod.stationStock(st.id).oil) ?? 0);
  const fuel = Math.floor(prod.stationStock(st.id).fuel ?? 0);
  const full = refinery ? fuel >= OIL_DEPOT_CAPACITY : oil >= OIL_DEPOT_CAPACITY;
  return (
    <group>
      <StaticBatch enabled={batch}>
        <OilDepotModel
          position={pos}
          rotationY={rotY}
          scale={scale}
          truckBays={st.bays ?? 2}
          railTracks={st.tracks ?? 1}
          phase={st.id * 0.7}
          noTracks
          status={() => sim.oilDepotStatus(st)}
          plant={refinery ? 'refinery' : 'depot'}
          units={st.units ?? 1}
        />
      </StaticBatch>
      <Html zIndexRange={[10, 0]} position={[pos[0], pos[1] + cellSize * 2.6, pos[2]]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip station-stock' + (full ? ' is-bad' : '')}>
          {refinery ? `🛢️ ${oil} → ⛽ ${fuel}/${OIL_DEPOT_CAPACITY}` : `🛢️ ${oil}/${OIL_DEPOT_CAPACITY}`}
        </div>
      </Html>
    </group>
  );
}

export interface StationHover {
  anchor: [number, number];
  side: Side;
  /** Platform extension (cells at each end; rail stations). */
  ext: number;
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
  const g = stationGeom(hover.anchor, hover.side, hover.ext);
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
      <Html zIndexRange={[10, 0]} position={[pos[0], pos[1] + cellSize * 1.4, pos[2]]} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? (kind === 'truck' ? `🚚 Kamionrakodó · $${cost}` : `🚉 Vasútállomás · ${6 + 2 * hover.ext} cellás peron · $${cost} · Q: hossz`) : reason}</div>
      </Html>
    </group>
  );
}

/** Row colours of the depot preview (local lz 0…5). */
const DEPOT_ROW_COLOR = ['#8aa0b8', '#8aa0b8', '#e6e2d6', '#e6e2d6', '#c9b37a', '#f0a03a'];

/** Props of a lot tool's preview (the depot / the oil depot). */
interface LotPlacementProps {
  map: TerrainMap;
  cellSize: number;
  x0: number;
  z0: number;
  rot: DepotRot;
  problem: string | null;
  cost: number;
  canAfford: boolean;
}

/** A label floating over a lot cell. */
interface LotLabel {
  at: readonly [number, number];
  text: string;
}

/**
 * A lot's preview: its cells tinted (red when it can't go there), small labels
 * (entrances), and the main tip over the centre.
 */
function LotPreview({
  map,
  cellSize,
  ground,
  cells,
  labels,
  center,
  tip,
  reason,
}: {
  map: TerrainMap;
  cellSize: number;
  /** The cell whose corner height the preview sits at. */
  ground: readonly [number, number];
  cells: { x: number; z: number; color: string }[];
  labels: LotLabel[];
  center: readonly [number, number];
  tip: string;
  reason: string | null;
}) {
  const half = (map.size - 1) / 2;
  const ok = reason === null;
  const gx = Math.min(map.size - 1, Math.max(0, ground[0]));
  const gz = Math.min(map.size - 1, Math.max(0, ground[1]));
  const y = (FLAT_TOP + cornerHeightAt(map, gx, gz)) * cellSize;
  const at = ([x, z]: readonly [number, number], h: number): [number, number, number] => [
    (x - half) * cellSize,
    y + cellSize * h,
    (z - half) * cellSize,
  ];
  return (
    <group>
      {cells.map(({ x, z, color }) => (
        <mesh key={`${x},${z}`} position={at([x, z], 0.06)}>
          <boxGeometry args={[cellSize * 0.94, cellSize * 0.06, cellSize * 0.94]} />
          <meshBasicMaterial color={ok ? color : '#f87171'} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      {labels.map((l) => (
        <Html key={l.text} zIndexRange={[10, 0]} position={at(l.at, 0.6)} center style={{ pointerEvents: 'none' }}>
          <div className="station-tip">{l.text}</div>
        </Html>
      ))}
      <Html zIndexRange={[10, 0]} position={at(center, 1.6)} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>{ok ? tip : reason}</div>
      </Html>
    </group>
  );
}

/** The depot tool's preview: the lot by rows (tracks, hall, bays, drive) and a tip. */
export function DepotPlacement({ map, cellSize, x0, z0, rot, problem, cost, canAfford }: LotPlacementProps) {
  const st: Station = { id: 0, anchor: [x0, z0], side: 'S', kind: 'depot', rot };
  return (
    <LotPreview
      map={map}
      cellSize={cellSize}
      ground={[x0 + 2, z0 + 2]}
      cells={depotCells(st).map(({ x, z, lz }) => ({ x, z, color: DEPOT_ROW_COLOR[lz] }))}
      labels={[
        { at: depotEntrance(st), text: '➡ behajtó' },
        { at: depotExit(st), text: 'kihajtó ➡' },
      ]}
      center={depotCenter(st)}
      tip={`🏬 Raktár · $${cost} · Q: forgatás`}
      reason={problem ?? (canAfford ? null : 'Nincs elég pénz')}
    />
  );
}

/** The oil depot tool's preview: the lot (the access road cell in orange) and a tip. */
export function OilDepotPlacement({ map, cellSize, x0, z0, rot, problem, cost, canAfford, refinery = false }: LotPlacementProps & { refinery?: boolean }) {
  const st: Station = { id: 0, anchor: [x0, z0], side: 'S', kind: refinery ? 'refinery' : 'oil', rot };
  const [sx, sz] = oilStub(st);
  return (
    <LotPreview
      map={map}
      cellSize={cellSize}
      ground={[x0, z0]}
      cells={oilCells(st).map(({ x, z }) => ({ x, z, color: x === sx && z === sz ? '#f0a03a' : '#c9b37a' }))}
      labels={[{ at: [sx, sz], text: '⇅ bejárat (ide jön az út)' }]}
      center={oilCenter(st)}
      tip={`${refinery ? '🏭 Finomító' : '🛢️ Olajdepó'} · $${cost} · Q: forgatás`}
      reason={problem ?? (canAfford ? null : 'Nincs elég pénz')}
    />
  );
}
