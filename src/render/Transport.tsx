/**
 * Transport rendering: the trucks on the roads, the "+$" of deliveries, and
 * the NETWORK VIEW — a top-down, greyed-out map where the stops are markers
 * and every line is a coloured route. Lines sharing a road run side by side
 * like on a metro map; a new line is drafted by clicking stops in order.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line as DreiLine } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import {
  isDepot,
  stopLabel,
  stopCenter,
  stopKind,
  laneAt,
  TRAILER_AXLE,
  TRAIN_LEN,
  TRUCK_HITCH,
  useTransport,
  useTransportSnapshot,
  type Line,
  type TerrainMap,
} from '../sim';
import { groundAtGrid } from './railGeometry';
import { Tractor, Trailer, truckColors, type TruckColors } from './TruckModel';
import './transport.css';

/** Height (world) of the grey veil over the map. */
const VEIL_Y = 12;
/** The network is drawn this high above the ground (cells) — on the roads,
 *  like a highlight of them — and over the veil (no depth test). */
const NET_LIFT = 0.12;
/** Line width (cells, world units: it scales with the zoom like the road). */
const LINE_WIDTH = 0.38;
/** Gap between lines sharing a road (cells). */
const LINE_GAP = 0.42;

type Cell = [number, number];
/** Top of the road coat above the ground (cells): the trucks drive on it. */
const ROAD_TOP = 0.026;

// ---------------------------------------------------------------- trucks

/** One articulated truck, placed every frame from the simulation. */
function TruckView({ id, colors, map, cellSize }: { id: number; colors: TruckColors; map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const root = useRef<THREE.Group>(null);
  const tractor = useRef<THREE.Group>(null);
  const trailer = useRef<THREE.Group>(null);
  const half = (map.size - 1) / 2;
  useFrame(() => {
    const g = root.current, tr = tractor.current, tl = trailer.current;
    const t = sim.allTrucks().find((q) => q.id === id);
    if (!g || !tr || !tl || !t) return;
    const p = sim.pose(t);
    g.visible = !!p; // in the depot: not on the map yet
    if (!p) return;
    const ground = (x: number, z: number) => groundAtGrid(map, x, z) + ROAD_TOP;
    const gh = ground(p.x, p.z);
    const ax = p.x - Math.cos(p.trailerYaw) * TRAILER_AXLE, az = p.z + Math.sin(p.trailerYaw) * TRAILER_AXLE;
    // Both parts pivot at the fifth wheel; they pitch with the ground.
    g.position.set((p.x - half) * cellSize, gh * cellSize, (p.z - half) * cellSize);
    tr.rotation.set(0, p.yaw, Math.atan2(ground(p.front[0], p.front[1]) - gh, TRUCK_HITCH));
    tl.rotation.set(0, p.trailerYaw, Math.atan2(gh - ground(ax, az), TRAILER_AXLE));
  });
  return (
    <group ref={root} scale={cellSize} visible={false}>
      <Tractor ref={tractor} colors={colors} />
      <Trailer ref={trailer} colors={colors} />
    </group>
  );
}

export function Trucks({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const snap = useTransportSnapshot(); // re-render on fleet / line changes
  const colors = new Map(snap.lines.map((l) => [l.id, l.color]));
  return (
    <group>
      {sim.allTrucks().map((t) => (
        <TruckView key={t.id} id={t.id} colors={{ ...truckColors(t.id), stripe: colors.get(t.lineId) ?? '#888' }} map={map} cellSize={cellSize} />
      ))}
      <Payments map={map} cellSize={cellSize} />
    </group>
  );
}

/** Floating "+$" over stops that just got a delivery. */
function Payments({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const half = (map.size - 1) / 2;
  // A few pooled labels, moved imperatively (no React re-render per frame).
  const pool = 6;
  const labels = useRef<Array<HTMLDivElement | null>>([]);
  const anchors = useRef<Array<THREE.Group | null>>([]);
  useFrame(() => {
    for (let i = 0; i < pool; i++) {
      const p = sim.payments[sim.payments.length - 1 - i];
      const a = anchors.current[i];
      const el = labels.current[i];
      if (!a || !el) continue;
      if (!p) {
        el.style.opacity = '0';
        continue;
      }
      a.position.set((p.x - half) * cellSize, (1.5 + p.age * 0.8) * cellSize, (p.z - half) * cellSize);
      el.textContent = `+$${p.amount}`;
      el.style.opacity = String(Math.max(0, 1 - p.age / 3));
    }
  });
  return (
    <group>
      {Array.from({ length: pool }).map((_, i) => (
        <group key={i} ref={(g) => (anchors.current[i] = g)}>
          <Html center style={{ pointerEvents: 'none' }}>
            <div ref={(d) => (labels.current[i] = d)} className="pay-pop" style={{ opacity: 0 }} />
          </Html>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- network view

/**
 * Polylines of all lines with metro-style offsets: every road segment used by
 * several lines gets them side by side, in line-id order.
 */
function metroLines(lines: readonly Line[], paths: Map<number, Cell[]>): Map<number, Array<[number, number]>> {
  const key = (a: Cell, b: Cell) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a[0]},${a[1]}|${b[0]},${b[1]}` : `${b[0]},${b[1]}|${a[0]},${a[1]}`);
  const users = new Map<string, number[]>();
  for (const l of lines) {
    const p = paths.get(l.id) ?? [];
    for (let i = 0; i + 1 < p.length; i++) {
      const k = key(p[i], p[i + 1]);
      const u = users.get(k) ?? [];
      if (!u.includes(l.id)) u.push(l.id);
      users.set(k, u);
    }
  }
  const out = new Map<number, Array<[number, number]>>();
  for (const l of lines) {
    const p = paths.get(l.id) ?? [];
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < p.length; i++) {
      const [a, b] = [p[i], p[i + 1]];
      const u = (users.get(key(a, b)) ?? [l.id]).slice().sort((x, y) => x - y);
      const off = (u.indexOf(l.id) - (u.length - 1) / 2) * LINE_GAP;
      // Perpendicular of the segment in a fixed (sorted) direction, so a line
      // keeps its side whichever way it travels.
      const [s, e] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
      const dx = e[0] - s[0], dz = e[1] - s[1];
      const ox = -dz * off, oz = dx * off;
      const A: [number, number] = [a[0] + ox, a[1] + oz];
      const B: [number, number] = [b[0] + ox, b[1] + oz];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== A[0] || last[1] !== A[1]) pts.push(A);
      pts.push(B);
    }
    out.set(l.id, pts);
  }
  return out;
}

/** Points the camera straight down while the network view is open. */
function TopDownCamera() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    const pos = camera.position.clone();
    const tgt = controls.target.clone();
    const dist = Math.max(70, pos.distanceTo(tgt));
    camera.position.set(tgt.x, tgt.y + dist, tgt.z + 0.01);
    controls.update();
    return () => {
      // Back to the same spot, from the old angle.
      const d = controls.target.clone().sub(tgt);
      camera.position.copy(pos).add(d);
      controls.update();
    };
  }, [camera, controls]);
  return null;
}

export function NetworkView({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const snap = useTransportSnapshot();
  const half = (map.size - 1) / 2;
  const W = (x: number) => (x - half) * cellSize;
  const stops = map.stations ?? [];
  const nameOf = (id: number) => stopLabel(map, stops.find((s) => s.id === id));

  const paths = useMemo(() => {
    const m = new Map<number, Cell[]>();
    for (const l of snap.lines) {
      if (l.kind === 'rail') continue;
      const legs = sim.linePaths(map, l);
      const all: Cell[] = [];
      for (const leg of legs) if (leg) all.push(...leg);
      m.set(l.id, all);
    }
    return m;
  }, [snap.lines, map, sim]);
  const drawn = useMemo(() => {
    const out = metroLines(
      snap.lines.filter((l) => l.kind !== 'rail'),
      paths,
    );
    // Rail lines: along the track itself.
    for (const l of snap.lines) if (l.kind === 'rail') out.set(l.id, sim.railLinePath(map, l.stops) ?? sim.railLinePath(map, l.stops, false) ?? []);
    return out;
  }, [snap.lines, paths, sim, map]);

  const draftPts = useMemo(() => {
    const d = snap.draft;
    if (!d || d.length < 2) return null;
    if (snap.draftKind === 'rail') return sim.railLinePath(map, d, false);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < d.length; i++) {
      const r = sim.route(map, stops.find((s) => s.id === d[i]) ?? null, stops.find((s) => s.id === d[i + 1]) ?? null);
      if (r) pts.push(...r);
    }
    return pts.length > 1 ? pts : null;
  }, [snap.draft, snap.draftKind, map, sim, stops]);

  const y = VEIL_Y;
  /** World height of the network at grid point (x, z): just above the road. */
  const netY = (x: number, z: number, dy = 0) => (groundAtGrid(map, x, z) + NET_LIFT + dy) * cellSize;
  const toV = (pts: Array<[number, number]>, dy = 0) => pts.map(([x, z]) => new THREE.Vector3(W(x), netY(x, z, dy), W(z)));

  return (
    <group>
      <TopDownCamera />
      {/* Grey veil over the whole map */}
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <planeGeometry args={[map.size * cellSize * 1.3, map.size * cellSize * 1.3]} />
        <meshBasicMaterial color="#2b2f36" transparent opacity={0.66} depthWrite={false} />
      </mesh>
      {/* Lines */}
      {snap.lines.map((l) => {
        const pts = drawn.get(l.id);
        if (!pts || pts.length < 2) return null;
        return <DreiLine key={l.id} points={toV(pts)} color={l.color} lineWidth={LINE_WIDTH * cellSize} worldUnits depthTest={false} renderOrder={10} />;
      })}
      {draftPts && <DreiLine points={toV(draftPts, 0.02)} color="#ffffff" lineWidth={LINE_WIDTH * 0.7 * cellSize} worldUnits dashed dashSize={0.8} gapSize={0.5} depthTest={false} renderOrder={11} />}
      {/* Stops */}
      {stops.map((s) => {
        const depot = isDepot(s);
        const truck = stopKind(s) === 'truck' || depot;
        const rail = stopKind(s) === 'rail' || depot;
        // Lit: stops of the kind being drafted (else the truck ones, as before).
        const lit = snap.draft ? (snap.draftKind === 'rail' ? rail : truck) : true;
        const [cx, cz] = stopCenter(s);
        const picked = snap.draft?.includes(s.id);
        return (
          <group key={s.id} position={[W(cx), netY(cx, cz, 0.04), W(cz)]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={12}
              onClick={(e) => {
                e.stopPropagation();
                if (lit && snap.draft) sim.addDraftStop(s.id);
              }}
            >
              <circleGeometry args={[1.1 * cellSize, 24]} />
              <meshBasicMaterial color={picked ? '#ffffff' : depot ? '#c084fc' : truck ? '#f0a03a' : '#5b8fd6'} depthTest={false} transparent opacity={lit ? 1 : 0.35} />
            </mesh>
            <Html center position={[0, 0.2, -2.6 * cellSize]} style={{ pointerEvents: 'none' }}>
              <div className={'net-stop' + (lit ? '' : ' is-rail') + (picked ? ' is-picked' : '')}>
                {depot ? '' : truck ? '🚚 ' : '🚉 '}
                {nameOf(s.id)}
              </div>
            </Html>
          </group>
        );
      })}
      <NetTrucks map={map} cellSize={cellSize} />
      <NetTrains map={map} cellSize={cellSize} />
    </group>
  );
}

/** Trains as (bigger) dots on the network view. */
function NetTrains({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const snap = useTransportSnapshot();
  const half = (map.size - 1) / 2;
  const refs = useRef<Map<number, THREE.Mesh>>(new Map());
  useFrame(() => {
    for (const t of sim.allTrains()) {
      const m = refs.current.get(t.id);
      if (!m) continue;
      m.visible = !!t.path;
      if (!t.path) continue;
      const [x, z] = laneAt(t.path, t.s - TRAIN_LEN / 2);
      m.position.set((x - half) * cellSize, (groundAtGrid(map, x, z) + NET_LIFT + 0.07) * cellSize, (z - half) * cellSize);
    }
  });
  const colors = new Map(snap.lines.map((l) => [l.id, l.color]));
  return (
    <group>
      {sim.allTrains().map((t) => (
        <mesh
          key={t.id}
          ref={(m) => {
            if (m) refs.current.set(t.id, m);
            else refs.current.delete(t.id);
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={13}
        >
          <ringGeometry args={[0.3 * cellSize, 0.62 * cellSize, 20]} />
          <meshBasicMaterial color={colors.get(t.lineId) ?? '#888'} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Trucks as dots on the network view. */
function NetTrucks({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const snap = useTransportSnapshot();
  const half = (map.size - 1) / 2;
  const refs = useRef<Map<number, THREE.Mesh>>(new Map());
  useFrame(() => {
    for (const t of sim.allTrucks()) {
      const m = refs.current.get(t.id);
      const p = sim.pose(t);
      if (m) m.visible = !!p;
      if (!m || !p) continue;
      m.position.set((p.x - half) * cellSize, (groundAtGrid(map, p.x, p.z) + NET_LIFT + 0.06) * cellSize, (p.z - half) * cellSize);
    }
  });
  const colors = new Map(snap.lines.map((l) => [l.id, l.color]));
  return (
    <group>
      {sim.allTrucks().map((t) => (
        <mesh
          key={t.id}
          ref={(m) => {
            if (m) refs.current.set(t.id, m);
            else refs.current.delete(t.id);
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={13}
        >
          <circleGeometry args={[0.32 * cellSize, 16]} />
          <meshBasicMaterial color={colors.get(t.lineId) ?? '#888'} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}
