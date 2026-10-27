/**
 * Rail signals (vasúti jelzők) — they cut the track into BLOCKS.
 *
 * A signal stands at a point of a track; placing it splits the track's edge
 * there (railNet.splitAtPoint), so every block is made of whole edges. A
 * signal is ONE-WAY: it stands on the right of the track for the trains it
 * governs (going one way); the others pass it freely:
 *
 *   - a train reserves its way only up to the next signal facing it (or to
 *     its stop: the safe places to wait), and halts at a red one until the
 *     block beyond is free —
 *     so trains can follow each other on a line, and wait in a passing loop;
 *   - at a red signal the train may pick another free way on (a passing
 *     loop's other track), see transport.ts.
 *
 * Signals are stored on the map with their position and the track's
 * direction there; they are checked on read (one whose track is gone, or no
 * longer splits it, is ignored).
 *
 * Pure TypeScript.
 */

import { EMPTY_NET, LineWalker, railIndex, snapToNet, TRACK_HALF, type RailNet } from './railNet';
import type { TerrainMap } from './terrain';
import { stationAt } from './stations';

/** 'fwd': for trains going along (tx, tz); 'back': against it. */
export type SignalMode = 'fwd' | 'back';

export interface RailSignal {
  readonly x: number;
  readonly z: number;
  /** Track direction at the signal (unit). */
  readonly tx: number;
  readonly tz: number;
  readonly mode: SignalMode;
}

export const SIGNAL_PRICE = 400;
/** A signal stays this far (cells, along the track) from switches and other signals. */
const SIGNAL_CLEAR = 1.6;
/** A train halts this far before a red signal (its front, cells). */
export const SIGNAL_STOP = 0.4;

/** Does a signal stop a train heading (dx, dz)? */
export function signalFaces(s: RailSignal, dx: number, dz: number): boolean {
  const d = s.tx * dx + s.tz * dz;
  return s.mode === 'fwd' ? d > 0 : d < 0;
}

/** Edge end points meeting at (x, z). */
function degreeAt(net: RailNet, x: number, z: number): number {
  let d = 0;
  for (const e of net.edges) {
    const p = e.pts, L = p.length;
    if (Math.hypot(p[0] - x, p[1] - z) < 0.05) d++;
    if (Math.hypot(p[L - 2] - x, p[L - 1] - z) < 0.05) d++;
  }
  return d;
}

const cache = new WeakMap<TerrainMap, readonly RailSignal[]>();

/** The map's signals that still stand on a joint of the track (2 edges meeting there). */
export function signalsOf(map: TerrainMap): readonly RailSignal[] {
  const all = map.signals;
  if (!all?.length) return [];
  let v = cache.get(map);
  if (v) return v;
  const net = map.railNet ?? EMPTY_NET;
  v = all.filter((s) => degreeAt(net, s.x, s.z) === 2);
  cache.set(map, v);
  return v;
}

/** The signal at (x, z) (within `r` cells), its index in map.signals, or -1. */
export function signalIndexNear(map: TerrainMap, x: number, z: number, r = 0.6): number {
  const all = map.signals ?? [];
  let best = -1, bd = r;
  all.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export interface SignalSpot {
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** An existing signal there (index in map.signals), or -1 for a new one. */
  existing: number;
  /** Which way a new one faces: the trains that have it on their right (the cursor's side). */
  mode: SignalMode;
  problem: string | null;
}

/**
 * Where a signal would go for the cursor at grid point (x, z): snapped onto
 * the nearest track (a whole cell centre along it when possible), or an
 * existing signal to switch. Null when no track is near.
 */
export function signalSpot(map: TerrainMap, x: number, z: number): SignalSpot | null {
  const ex = signalIndexNear(map, x, z);
  if (ex >= 0) {
    const s = map.signals![ex];
    return { x: s.x, z: s.z, tx: s.tx, tz: s.tz, existing: ex, mode: s.mode, problem: null };
  }
  const net = map.railNet ?? EMPTY_NET;
  const snap = snapToNet(net, x, z, 0.8);
  if (!snap) return null;
  const e = net.edges.find((q) => q.id === snap.edge)!;
  const w = new LineWalker(e.pts);
  // Prefer a round spot: the nearest point within 0.5 of the snap that is a cell centre.
  let along = snap.along;
  for (let d = -0.5; d <= 0.5; d += 0.05) {
    const o = w.at(snap.along + d);
    if (Math.hypot(o[0] - Math.round(o[0]), o[1] - Math.round(o[1])) < 0.03) {
      along = snap.along + d;
      break;
    }
  }
  const o = w.at(along);
  // Right of heading (tx, tz) is (−tz, tx): the cursor on that side → for trains going along it.
  const mode: SignalMode = (x - o[0]) * -o[3] + (z - o[1]) * o[2] >= 0 ? 'fwd' : 'back';
  const spot: SignalSpot = { x: o[0], z: o[1], tx: o[2], tz: o[3], existing: -1, mode, problem: null };
  // Rules: off platforms, clear of switches and of other signals.
  if (stationAt(map, Math.round(o[0]), Math.round(o[1]))) spot.problem = 'Peronra nem tehető';
  else if (snap.kind === 'end' || along < 0.6 || along > w.total - 0.6) spot.problem = 'A sín végére nem tehető';
  else {
    for (const atEnd of [false, true]) {
      // Walk to each end of this edge: a switch there must be far enough.
      const dist = atEnd ? w.total - along : along;
      const p = w.at(atEnd ? w.total : 0);
      if (dist < SIGNAL_CLEAR && degreeAt(net, p[0], p[1]) >= 3) spot.problem = 'Túl közel a váltóhoz';
    }
    // A train halted at it must stand clear of switch throats and crossings
    // (cells another track shares), else it would block the other way past.
    const idx = railIndex(map);
    for (let d = -1.4; d <= 1.4 && !spot.problem; d += 0.1) {
      const q = w.at(along + d);
      for (const off of [-TRACK_HALF, 0, TRACK_HALF]) {
        const cx = Math.round(q[0] - q[3] * off), cz = Math.round(q[1] + q[2] * off);
        if ((idx.get(cx * map.size + cz) ?? []).some((c) => c.edge !== e.id)) spot.problem = 'Túl közel a váltóhoz vagy keresztezéshez';
      }
    }
    for (const s of map.signals ?? []) if (Math.hypot(s.x - o[0], s.z - o[1]) < SIGNAL_CLEAR) spot.problem = 'Túl közel egy másik jelzőhöz';
  }
  return spot;
}

/** A clicked signal turns round. */
export function nextSignalMode(m: SignalMode): SignalMode {
  return m === 'fwd' ? 'back' : 'fwd';
}
