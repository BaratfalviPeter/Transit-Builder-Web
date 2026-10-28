/**
 * railDraw — drawing rail by dragging, tile by tile (Train Valley style).
 *
 * The cursor moves the track from cell to cell, only up / down / left /
 * right; a fast drag that skips cells is filled in as an L (straight on
 * first, then the turn), never as a staircase. Dragging back takes cells
 * off. An obstacle stops the track (and says why).
 *
 * What gets built is still an ordinary centre-line on the rail network
 * (railNet.ts), so trains, signals and stations work as before:
 *   - cells in a row → a straight through their centres;
 *   - where the drawn path turns → a quarter circle of radius 1, from the
 *     centre of the cell before the corner to the centre of the cell after
 *     (the cars are long: a half-cell curve would be too tight). So two
 *     turns need a straight cell between them.
 *
 * Starting on a dead end continues it (straight on first); starting on a
 * track elsewhere branches off it with a switch (the track curves away from
 * it); ending on a track the path meets square makes a switch onto it,
 * ending on a dead end joins it; drawn across a track it crosses it. Which
 * way a switch faces follows the cursor (and Q turns it).
 *
 * Pure TypeScript.
 */

import { EMPTY_NET, LineWalker, snapToNet, SWITCH_CLEAR, type NetSnap, type RailNet } from './railNet';
import { canRailCell } from './railNet';
import { headingOf, validate, type RailPlan } from './railRoute';
import type { TerrainMap } from './terrain';

type Cell = [number, number];

/** How the drawing starts: on bare ground, a dead end (continued), or a track (a switch). */
type Start =
  | { kind: 'free' }
  | { kind: 'end'; dir: Cell; snap: NetSnap }
  | { kind: 'mid'; h: Cell };

export interface RailDraw {
  start: Start;
  /** The drawn cells, the start cell first. */
  cells: Cell[];
  /** Which way along the track a switch at the start / end runs (+1 / −1 along it). */
  startSide: 1 | -1;
  endSide: 1 | -1;
  /** Q flips the switch side (start while just begun, else the end). */
  flip: boolean;
  /** Why the track stopped growing (shown to the player), or null. */
  note: string | null;
}

const ORTHO: Cell[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const eq = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const sub = (a: Cell, b: Cell): Cell => [a[0] - b[0], a[1] - b[1]];
const add = (a: Cell, b: Cell): Cell => [a[0] + b[0], a[1] + b[1]];

/** The straight, axis-aligned track running through cell centre c, or null. */
function trackThrough(net: RailNet, c: Cell): { snap: NetSnap; h: Cell } | null {
  const s = snapToNet(net, c[0], c[1], 0.05);
  if (!s) return null;
  const hd = headingOf(s.tx, s.tz);
  if (hd < 0 || hd % 2) return null; // diagonal or curved there
  return { snap: s, h: ORTHO[hd / 2] };
}

/** A switch node on straight track at cell c (clear of the edge's ends), as a 'mid' snap. */
function switchAt(net: RailNet, c: Cell): NetSnap | null {
  const t = trackThrough(net, c);
  if (!t) return null;
  const e = net.edges.find((q) => q.id === t.snap.edge);
  if (!e) return null;
  // Exact along at the cell centre.
  const w = new LineWalker(e.pts);
  let along = -1;
  for (let s = 0; s <= w.total + 1e-6; s += 0.01) {
    const o = w.at(s);
    if (Math.hypot(o[0] - c[0], o[1] - c[1]) < 0.006) {
      along = s;
      break;
    }
  }
  if (along < SWITCH_CLEAR - 1e-6 || along > w.total - SWITCH_CLEAR + 1e-6) return null;
  return { edge: e.id, along, x: c[0], z: c[1], tx: t.h[0], tz: t.h[1], kind: 'mid' };
}

/** Start drawing at grid point `a`, or why it can't start there. */
export function railDrawBegin(map: TerrainMap, a: { x: number; z: number }): RailDraw | string {
  const net = map.railNet ?? EMPTY_NET;
  const c: Cell = [Math.round(a.x), Math.round(a.z)];
  if (c[0] < 0 || c[1] < 0 || c[0] >= map.size || c[1] >= map.size) return 'Ide nem építhető sín';
  const base = { startSide: 1 as const, endSide: 1 as const, flip: false, note: null };
  const near = snapToNet(net, a.x, a.z, 0.7);
  if (near?.kind === 'end') {
    const hd = headingOf(near.tx, near.tz);
    const at: Cell = [Math.round(near.x), Math.round(near.z)];
    if (hd < 0 || hd % 2 || Math.hypot(near.x - at[0], near.z - at[1]) > 1e-3) return 'Ferde sínvég: innen kattintással építs';
    return { ...base, start: { kind: 'end', dir: ORTHO[hd / 2], snap: { ...near, x: at[0], z: at[1] } }, cells: [at] };
  }
  const t = trackThrough(net, c);
  if (t) return { ...base, start: { kind: 'mid', h: t.h }, cells: [c] };
  if (near) return 'Itt nem ágazhat le a sín (egyenes szakaszon indíts)';
  if (!canRailCell(map, c[0], c[1])) return 'Ide nem építhető sín';
  return { ...base, start: { kind: 'free' }, cells: [c] };
}

/**
 * The drawn path as cells with the virtual ends around it: the cell before
 * the start on the track it branches from, the cell after the end along the
 * track it switches onto. Plus the snaps at both ends.
 */
function layout(map: TerrainMap, d: RailDraw): { path: Cell[]; start: NetSnap | null; end: NetSnap | null; reason: string | null } {
  const net = map.railNet ?? EMPTY_NET;
  const path = d.cells.slice();
  let start: NetSnap | null = null, end: NetSnap | null = null;
  let reason: string | null = null;
  if (d.start.kind === 'end') start = d.start.snap;
  if (d.start.kind === 'mid' && path.length >= 2) {
    // The branch leaves the track one cell back (along it), curving away.
    const prev = sub(path[0], [d.start.h[0] * d.startSide, d.start.h[1] * d.startSide]);
    start = switchAt(net, prev);
    if (!start) reason = 'Itt nem ágazhat le a sín (túl közel a sín végéhez vagy egy váltóhoz)';
    path.unshift(prev);
    if (start) start = { ...start, tx: d.start.h[0] * d.startSide, tz: d.start.h[1] * d.startSide };
  }
  // The end: on a dead end (arriving into it) joins it; square onto a track makes a switch.
  const last = path[path.length - 1];
  if (path.length >= 2 && !(d.start.kind !== 'free' && d.cells.length === 1)) {
    const inDir = sub(last, path[path.length - 2]);
    const near = snapToNet(net, last[0], last[1], 0.05);
    if (near?.kind === 'end') {
      const hd = headingOf(near.tx, near.tz);
      if (hd >= 0 && hd % 2 === 0 && eq(ORTHO[hd / 2], [-inDir[0], -inDir[1]])) end = { ...near, x: last[0], z: last[1] };
      else reason = 'Sínvéghez csak szemből lehet csatlakozni (a sín folytatásaként)';
    } else if (near) {
      const t = trackThrough(net, last);
      if (t && t.h[0] * inDir[0] + t.h[1] * inDir[1] === 0) {
        const next = add(last, [t.h[0] * d.endSide, t.h[1] * d.endSide]);
        end = switchAt(net, next);
        if (!end) reason = 'Itt nem csatlakozhat a sín (túl közel a sín végéhez vagy egy váltóhoz)';
        path.push(next);
      } else reason = 'Itt nem csatlakozhat a sín';
    }
  }
  return { path, start, end, reason };
}

/** Indices of the turns of a cell path (where its direction changes). */
function corners(path: Cell[]): number[] {
  const out: number[] = [];
  for (let i = 1; i + 1 < path.length; i++) if (!eq(sub(path[i], path[i - 1]), sub(path[i + 1], path[i]))) out.push(i);
  return out;
}

/** Centre-line of a cell path: straights through the centres, radius-1 quarter circles at the turns. */
function centreLine(path: Cell[]): number[] {
  const turn = new Set(corners(path));
  const pts: number[] = [path[0][0], path[0][1]];
  const push = (x: number, z: number) => {
    const L = pts.length;
    if (Math.hypot(pts[L - 2] - x, pts[L - 1] - z) < 1e-9) return;
    // Merge straight runs (a straight = its two ends).
    if (L >= 4) {
      const ux = pts[L - 2] - pts[L - 4], uz = pts[L - 1] - pts[L - 3];
      const vx = x - pts[L - 2], vz = z - pts[L - 1];
      if (Math.abs(ux * vz - uz * vx) < 1e-9 && ux * vx + uz * vz > 0 && Math.hypot(ux, uz) > 0.99 && Math.hypot(vx, vz) > 0.99) {
        pts[L - 2] = x;
        pts[L - 1] = z;
        return;
      }
    }
    pts.push(x, z);
  };
  for (let i = 1; i < path.length; i++) {
    if (turn.has(i)) {
      // Quarter circle from path[i−1] to path[i+1], centred at path[i−1] + (path[i+1] − path[i]).
      const a = path[i - 1], b = path[i + 1];
      const o = add(a, sub(b, path[i]));
      const a0 = Math.atan2(a[1] - o[1], a[0] - o[0]);
      let a1 = Math.atan2(b[1] - o[1], b[0] - o[0]);
      if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
      if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
      for (let k = 1; k <= 14; k++) {
        const f = a0 + ((a1 - a0) * k) / 14;
        push(o[0] + Math.cos(f), o[1] + Math.sin(f));
      }
      // Exact lattice end.
      pts[pts.length - 2] = b[0];
      pts[pts.length - 1] = b[1];
      i++; // path[i+1] is reached
    } else push(path[i][0], path[i][1]);
  }
  return pts;
}

/** The drawing as a buildable plan (centre-line, end joins, why not if blocked). */
export function railDrawPlan(map: TerrainMap, d: RailDraw): RailPlan {
  const { path, start, end, reason } = layout(map, d);
  const empty: RailPlan = { pts: [], blocked: false, reason: d.note, length: 0, start, end: null };
  if (path.length < 2 || (d.start.kind === 'mid' && path.length < 3)) return empty;
  const cs = corners(path);
  for (let k = 1; k < cs.length; k++)
    if (cs[k] - cs[k - 1] < 2) return { ...empty, blocked: true, reason: 'Két kanyar között egy egyenes mező kell' };
  const pts = centreLine(path);
  const why = reason ?? validate(map, pts, start, end);
  return { pts, blocked: why !== null, reason: why ?? d.note, length: new LineWalker(pts).total, start, end };
}

/** Q: turn the switch the drawing makes round (the start's while nothing is drawn on, else the end's). */
export function railDrawFlip(d: RailDraw): RailDraw {
  if (d.start.kind === 'mid' && d.cells.length <= 2) return { ...d, flip: true, startSide: d.startSide > 0 ? -1 : 1 };
  return { ...d, flip: true, endSide: d.endSide > 0 ? -1 : 1 };
}

/** Follow the cursor at grid point `p`: take cells off / add cells, cell by cell. */
export function railDrawTo(map: TerrainMap, d0: RailDraw, p: { x: number; z: number }): RailDraw {
  const target: Cell = [Math.round(p.x), Math.round(p.z)];
  let d: RailDraw = { ...d0, cells: d0.cells.slice(), note: null };
  // Back over the drawn track: cut it at the cell under the cursor.
  const back = d.cells.findIndex((c) => eq(c, target));
  if (back >= 0) {
    d.cells = d.cells.slice(0, back + 1);
    return sideFromCursor(map, d, p);
  }
  for (let guard = 0; guard < 200; guard++) {
    const last = d.cells[d.cells.length - 1];
    if (eq(last, target)) break;
    const dx = target[0] - last[0], dz = target[1] - last[1];
    // The way it's heading (a dead end: its direction; first step off a track: square to it).
    const heading: Cell | null =
      d.cells.length >= 2 ? sub(last, d.cells[d.cells.length - 2]) : d.start.kind === 'end' ? d.start.dir : null;
    const along = (h: Cell) => h[0] * dx + h[1] * dz;
    let step: Cell;
    if (d.start.kind === 'end' && d.cells.length === 1) {
      step = d.start.dir; // a dead end goes on straight first
      if (along(step) <= 0) {
        d.note = 'A sínvégről egyenesen tovább';
        break;
      }
    } else if (d.start.kind === 'mid' && d.cells.length === 1) {
      const h = d.start.h;
      const side: Cell = [-h[1], h[0]];
      step = along(side) >= 0 ? side : [-side[0], -side[1]];
      if (along(step) === 0) {
        d.note = 'A sínből oldalra húzd ki';
        break;
      }
    } else if (heading && along(heading) > 0) step = heading; // straight on while it helps
    else step = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
    if (heading && step[0] === -heading[0] && step[1] === -heading[1]) {
      d.note = 'Visszafordulni nem lehet';
      break;
    }
    const next = add(last, step);
    if (d.cells.some((c) => eq(c, next))) {
      d.note = 'Önmagát nem keresztezheti';
      break;
    }
    const trial: RailDraw = { ...d, cells: d.cells.concat([next]) };
    const plan = railDrawPlan(map, trial);
    // Ending on a track is fine while it's a crossing in the making: judge it one cell on.
    const onTrack = !!snapToNet(map.railNet ?? EMPTY_NET, next[0], next[1], 0.45);
    if (plan.blocked && !onTrack) {
      d.note = plan.reason;
      break;
    }
    d = trial;
  }
  return sideFromCursor(map, d, p);
}

/** Which way the switches face: towards the cursor along the track (unless Q flipped it). */
function sideFromCursor(map: TerrainMap, d: RailDraw, p: { x: number; z: number }): RailDraw {
  if (d.flip) return d;
  const out = { ...d };
  if (d.start.kind === 'mid' && d.cells.length === 2) {
    const c = d.cells[0], h = d.start.h;
    const comp = (p.x - c[0]) * h[0] + (p.z - c[1]) * h[1];
    if (Math.abs(comp) > 0.3) out.startSide = comp > 0 ? 1 : -1;
  }
  // Ending square onto a track: the switch turns the way the cursor leans along it.
  const last = d.cells[d.cells.length - 1];
  const t = d.cells.length >= 2 ? trackThrough(map.railNet ?? EMPTY_NET, last) : null;
  if (t) {
    const comp = (p.x - last[0]) * t.h[0] + (p.z - last[1]) * t.h[1];
    if (Math.abs(comp) > 0.2) out.endSide = comp > 0 ? 1 : -1;
  }
  return out;
}
