/**
 * Trains on the tracks: a locomotive and its wagons, each car placed every
 * frame by putting its two bogies on the train's path (so the cars follow
 * the curves and the grades of the track). A wagon's type shows what it
 * carries (WAGON_FOR); an empty one keeps its last type.
 */

import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CAR_GAP,
  CAR_LEN,
  laneAt,
  LOCO_LEN,
  pathAt,
  TRAIN_SCALE,
  useTransport,
  useTransportSnapshot,
  WAGON_CAPACITY,
  type Item,
  type TerrainMap,
  type Train,
} from '../sim';
import { sampleTrack, type TrackSamples } from './railGeometry';
import { CAR_BOGIE, LOCO_BOGIE, LOCO_COLORS, Locomotive, Wagon, WAGON_FOR, type WagonKind } from './TrainModel';

/** Rail top above the track's (smoothed) ground line — see Rails.tsx. */
const RAIL_TOP = 0.12;

/** Each car's centre behind the train's front, and its bogies' distance from it (cells, as drawn). */
function carsOf(wagons: number): Array<{ c: number; b: number }> {
  return [
    { c: LOCO_LEN / 2, b: LOCO_BOGIE * TRAIN_SCALE },
    ...Array.from({ length: wagons }, (_, j) => ({ c: LOCO_LEN + CAR_GAP + CAR_LEN / 2 + j * (CAR_LEN + CAR_GAP), b: CAR_BOGIE * TRAIN_SCALE })),
  ];
}

/** Track heights per edge, for the current map (the renderer's even grade). */
function useTrackHeights(map: TerrainMap) {
  return useMemo(() => {
    const cache = new Map<number, TrackSamples>();
    const edges = new Map((map.railNet?.edges ?? []).map((e) => [e.id, e.pts]));
    return (edge: number, along: number): number => {
      let s = cache.get(edge);
      if (!s) {
        const pts = edges.get(edge);
        if (!pts) return 0;
        cache.set(edge, (s = sampleTrack(map, pts)));
      }
      const f = Math.min(s.n - 1, Math.max(0, along / s.step - 0.5));
      const i = Math.min(s.n - 2, Math.floor(f));
      if (i < 0) return s.h[0];
      return s.h[i] + (s.h[i + 1] - s.h[i]) * (f - i);
    };
  }, [map]);
}

/** What each wagon shows: its type and whether it is loaded. */
function wagonLoads(t: Train, last: WagonKind[]): Array<{ kind: WagonKind; loaded: boolean }> {
  const items = (Object.keys(t.cargo) as Item[]).filter((i) => (t.cargo[i] ?? 0) > 0).sort((a, b) => (t.cargo[b] ?? 0) - (t.cargo[a] ?? 0));
  const out: Array<{ kind: WagonKind; loaded: boolean }> = [];
  for (const it of items) for (let k = Math.ceil((t.cargo[it] ?? 0) / WAGON_CAPACITY); k > 0 && out.length < t.wagons; k--) out.push({ kind: WAGON_FOR[it], loaded: true });
  while (out.length < t.wagons) out.push({ kind: last[out.length] ?? 'box', loaded: false });
  out.forEach((w, i) => (last[i] = w.kind));
  return out;
}

function TrainView({ id, color, stripe, map, height }: { id: number; color: string; stripe: string; map: TerrainMap; height: (edge: number, along: number) => number }) {
  const sim = useTransport();
  const root = useRef<THREE.Group>(null);
  const cars = useRef<Array<THREE.Group | null>>([]);
  const last = useRef<WagonKind[]>([]);
  const [loads, setLoads] = useState(() => wagonLoads({ cargo: {}, wagons: 0 } as unknown as Train, last.current));
  const sig = useRef('');
  const half = (map.size - 1) / 2;
  useFrame(() => {
    const t = sim.allTrains().find((q) => q.id === id);
    const g = root.current;
    if (!g) return;
    g.visible = !!t?.path;
    if (!t || !t.path) return;
    const p = t.path;
    const front = sim.trainDrawS(t);
    const at = (s: number): [number, number, number] => {
      const [x, z] = laneAt(p, s);
      const q = pathAt(p, s);
      return [x, height(q.edge, q.along) + RAIL_TOP, z];
    };
    carsOf(t.wagons).forEach(({ c, b }, k) => {
      const car = cars.current[k];
      if (!car) return;
      const f = at(front - c + b), r = at(front - c - b);
      car.position.set((f[0] + r[0]) / 2 - half, (f[1] + r[1]) / 2, (f[2] + r[2]) / 2 - half);
      const dx = f[0] - r[0], dz = f[2] - r[2];
      car.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(f[1] - r[1], Math.hypot(dx, dz)));
    });
    const s = t.wagons + ':' + (Object.keys(t.cargo) as Item[]).map((i) => `${i}${Math.ceil((t.cargo[i] ?? 0) / WAGON_CAPACITY)}`).join();
    if (s !== sig.current) {
      sig.current = s;
      setLoads(wagonLoads(t, last.current));
    }
  });
  return (
    <group ref={root} visible={false}>
      <group ref={(g) => (cars.current[0] = g)} scale={TRAIN_SCALE}>
        <Locomotive color={color} stripe={stripe} />
      </group>
      {loads.map((w, j) => (
        <group key={j} ref={(g) => (cars.current[j + 1] = g)} scale={TRAIN_SCALE}>
          <Wagon kind={w.kind} loaded={w.loaded} />
        </group>
      ))}
    </group>
  );
}

export function Trains({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const sim = useTransport();
  const snap = useTransportSnapshot(); // re-render on fleet / line changes
  const height = useTrackHeights(map);
  const colors = new Map(snap.lines.map((l) => [l.id, l.color]));
  return (
    <group scale={cellSize}>
      {sim.allTrains().map((t) => (
        <TrainView key={t.id} id={t.id} color={LOCO_COLORS[t.id % LOCO_COLORS.length]} stripe={colors.get(t.lineId) ?? '#888'} map={map} height={height} />
      ))}
    </group>
  );
}
