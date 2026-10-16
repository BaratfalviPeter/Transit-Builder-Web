/**
 * railGeometry — turns rail track pieces (railPieces.ts) into 3D geometry.
 *
 * Each piece runs between two cell-side mid-points. To make diagonals and big
 * curves read as smooth sweeping track (not a zig-zag of 45° kinks), every
 * piece is a cubic Bézier whose end tangents are shared with the piece across
 * the joint: at a plain joint the two chords are averaged, and at a switch the
 * single "trunk" piece's direction is used, so the diverging pieces leave the
 * trunk tangentially like a real turnout. Straight → diagonal → straight thus
 * becomes one continuous arc spread over several cells.
 *
 * The same centre-lines feed the real track (ballast, sleepers, steel rails,
 * switch levers, level-crossing barriers) and the planner's hologram.
 */

import * as THREE from 'three';
import {
  CellType,
  cellCornerHeights,
  opposite,
  otherSide,
  PIECE_COUNT,
  PIECE_SIDES,
  piecesAtSide,
  SIDE_DX,
  SIDE_DZ,
  type TerrainMap,
} from '../sim';
import { CELL_STYLE } from './terrainStyle';

/** 2D point / vector in cell-local (u, v) ∈ [-0.5, 0.5]. */
export type P2 = [number, number];
export type BitsAt = (x: number, z: number) => number;

const MID: ReadonlyArray<P2> = [
  [0, -0.5], // N
  [0.5, 0], // E
  [0, 0.5], // S
  [-0.5, 0], // W
];

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
const SURFACE_LIFT = 0.02;
/** Road surface top above the cell's ground (level crossings sit on it). */
const ROAD_TOP = CELL_STYLE[CellType.Road].scaleY + SURFACE_LIFT;
/** Bézier handle length as a fraction of the piece's chord. */
const HANDLE = 0.4;

const norm = (p: P2): P2 => {
  const l = Math.hypot(p[0], p[1]) || 1;
  return [p[0] / l, p[1] / l];
};
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];

/** Unit direction of `piece` at side `s`, pointing OUT of the cell through s. */
function outward(piece: number, s: number): P2 {
  const o = MID[otherSide(piece, s)];
  const m = MID[s];
  return norm([m[0] - o[0], m[1] - o[1]]);
}

/** Connected (≤ 60° apart) — pieces meeting at a joint that a train can pass. */
const COMPAT = 0.5;

/**
 * Shared tangent at side `s` of cell (x, z) for `piece`, pointing OUT through
 * s. Symmetric for the pieces on both sides of the joint (no kinks).
 */
export function jointTangent(bitsAt: BitsAt, x: number, z: number, piece: number, s: number): P2 {
  const own = outward(piece, s);
  const os = opposite(s);
  const A = piecesAtSide(bitsAt(x, z), s);
  const B = piecesAtSide(bitsAt(x + SIDE_DX[s], z + SIDE_DZ[s]), os);
  if (B.length === 0) return own;
  // Directions out of OUR cell: ours = outward(a, s); theirs continue into the
  // neighbour = −outward(b, os).
  const dirA = A.map((a) => outward(a, s));
  const dirB = B.map((b) => {
    const d = outward(b, os);
    return [-d[0], -d[1]] as P2;
  });
  const Ac = A.filter((_, i) => dirB.some((d) => dot(dirA[i], d) > COMPAT));
  const Bc = dirB.filter((d) => dirA.some((a) => dot(a, d) > COMPAT));
  if (!Ac.includes(piece)) return own;
  if (Ac.length === 1 && Bc.length === 1) return norm([own[0] + Bc[0][0], own[1] + Bc[0][1]]);
  if (Ac.length > 1 && Bc.length === 1) return Bc[0]; // neighbour is the trunk
  return own;
}

/** Sampled centre-line of `piece` in cell (x, z), from side a to side b, in (u, v). */
export function pieceCenterline(bitsAt: BitsAt, x: number, z: number, piece: number): P2[] {
  const [a, b] = PIECE_SIDES[piece];
  const e0 = MID[a];
  const e1 = MID[b];
  const tA = jointTangent(bitsAt, x, z, piece, a); // out through a
  const tIn: P2 = [-tA[0], -tA[1]]; // into the cell at a
  const tOut = jointTangent(bitsAt, x, z, piece, b);
  const chord: P2 = [e1[0] - e0[0], e1[1] - e0[1]];
  const L = Math.hypot(chord[0], chord[1]);
  const c = norm(chord);
  if (dot(tIn, c) > 0.9999 && dot(tOut, c) > 0.9999) return [e0, e1];
  const h = L * HANDLE;
  const c1: P2 = [e0[0] + tIn[0] * h, e0[1] + tIn[1] * h];
  const c2: P2 = [e1[0] - tOut[0] * h, e1[1] - tOut[1] * h];
  const out: P2[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    out.push([
      k0 * e0[0] + k1 * c1[0] + k2 * c2[0] + k3 * e1[0],
      k0 * e0[1] + k1 * c1[1] + k2 * c2[1] + k3 * e1[1],
    ]);
  }
  return out;
}

/** Ground height (cell units, incl. FLAT_TOP) at local (u, v) of cell (x, z). */
export function groundAt(map: TerrainMap, x: number, z: number, u: number, v: number): number {
  const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
  const s = Math.min(1, Math.max(0, u + 0.5));
  const t = Math.min(1, Math.max(0, v + 0.5));
  return FLAT_TOP + (h00 * (1 - s) + h10 * s) * (1 - t) + (h01 * (1 - s) + h11 * s) * t;
}

/**
 * Sweep a solid bar (top + two side walls) along `pts` (world x/z) with a
 * per-point base height `ys`. Width tapers from hwBot (at y0) to hwTop (at y1).
 * Winding is counter-clockwise seen from outside (front faces).
 */
export function sweepBar(
  out: number[],
  pts: P2[],
  ys: number[],
  hwTop: number,
  hwBot: number,
  y0: number,
  y1: number,
): void {
  const L = pts.length;
  if (L < 2) return;
  const nrm: P2[] = [];
  for (let i = 0; i < L; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(L - 1, i + 1)];
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    nrm.push([-d[1], d[0]]);
  }
  const P = (i: number, side: number, hw: number, y: number): number[] => [
    pts[i][0] + nrm[i][0] * hw * side,
    ys[i] + y,
    pts[i][1] + nrm[i][1] * hw * side,
  ];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < L - 1; i++) {
    const j = i + 1;
    quad(P(i, 1, hwTop, y1), P(j, 1, hwTop, y1), P(j, -1, hwTop, y1), P(i, -1, hwTop, y1));
    quad(P(i, 1, hwBot, y0), P(j, 1, hwBot, y0), P(j, 1, hwTop, y1), P(i, 1, hwTop, y1));
    quad(P(j, -1, hwBot, y0), P(i, -1, hwBot, y0), P(i, -1, hwTop, y1), P(j, -1, hwTop, y1));
  }
}

/** Offset a local polyline sideways by `d` (cell units). */
function offsetLine(pts: P2[], d: number): P2[] {
  const L = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(L - 1, i + 1)];
    const t = norm([b[0] - a[0], b[1] - a[1]]);
    return [p[0] - t[1] * d, p[1] + t[0] * d];
  });
}

export interface TrackGeometry {
  ballast: number[];
  sleepers: number[];
  rails: number[];
  /** World positions of switch-stand levers. */
  levers: Array<[number, number, number]>;
  /** Level-crossing barrier posts: world position + yaw. */
  barriers: Array<[number, number, number, number]>;
}

/** Track dimensions (cell units). */
const GAUGE = 0.2; // half-distance between the rails
const RAIL_HW = 0.026;
const BALLAST_TOP_HW = 0.27;
const BALLAST_BOT_HW = 0.36;
const SLEEPER_HALF = 0.31;
const SLEEPER_HW = 0.045;
const SLEEPER_PITCH = 0.2;

/** Build the track geometry for every rail piece on the map. */
export function buildTrack(map: TerrainMap, cellSize: number, bitsAt: BitsAt): TrackGeometry {
  const half = (map.size - 1) / 2;
  const g: TrackGeometry = { ballast: [], sleepers: [], rails: [], levers: [], barriers: [] };
  for (let x = 0; x < map.size; x++) {
    for (let z = 0; z < map.size; z++) {
      const bits = bitsAt(x, z);
      if (!bits) continue;
      const crossing = map.cells[x][z] === CellType.Road;
      const W = (p: P2): P2 => [(x - half + p[0]) * cellSize, (z - half + p[1]) * cellSize];
      for (let piece = 0; piece < PIECE_COUNT; piece++) {
        if (!(bits & (1 << piece))) continue;
        const line = pieceCenterline(bitsAt, x, z, piece);
        // Dense enough for the slope bilinear lift even on straights.
        const pts = line.length === 2 ? densify(line, 4) : line;
        const ys = pts.map((p) => (groundAt(map, x, z, p[0], p[1]) + SURFACE_LIFT) * cellSize);
        const world = pts.map(W);
        const cs = cellSize;
        if (crossing) {
          // Level crossing: rails set into the road surface, no ballast/sleepers.
          for (const sgn of [-1, 1]) {
            const rl = offsetLine(pts, GAUGE * sgn).map(W);
            sweepBar(g.rails, rl, ys, RAIL_HW * cs, RAIL_HW * cs, (ROAD_TOP - SURFACE_LIFT - 0.01) * cs, (ROAD_TOP - SURFACE_LIFT + 0.02) * cs);
          }
          continue;
        }
        sweepBar(g.ballast, world, ys, BALLAST_TOP_HW * cs, BALLAST_BOT_HW * cs, -0.02 * cs, 0.045 * cs);
        // Sleepers at an even arc-length pitch.
        let acc = SLEEPER_PITCH / 2;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
          while (acc <= seg) {
            const t = acc / seg;
            const m: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const d = norm([b[0] - a[0], b[1] - a[1]]);
            const pv: P2 = [-d[1] * SLEEPER_HALF, d[0] * SLEEPER_HALF];
            const sl: P2[] = [[m[0] - pv[0], m[1] - pv[1]], [m[0] + pv[0], m[1] + pv[1]]];
            const sy = sl.map((p) => (groundAt(map, x, z, p[0], p[1]) + SURFACE_LIFT) * cs);
            sweepBar(g.sleepers, sl.map(W), sy, SLEEPER_HW * cs, SLEEPER_HW * cs, 0.03 * cs, 0.065 * cs);
            acc += SLEEPER_PITCH;
          }
          acc -= seg;
        }
        for (const sgn of [-1, 1]) {
          const rl = offsetLine(pts, GAUGE * sgn).map(W);
          sweepBar(g.rails, rl, ys, RAIL_HW * cs, RAIL_HW * cs, 0.06 * cs, 0.1 * cs);
        }
      }

      // Switch levers: a side where 2+ pieces of THIS cell meet is a turnout.
      for (let s = 0; s < 4 && !crossing; s++) {
        const at = piecesAtSide(bits, s);
        if (at.length < 2) continue;
        // Lever beside the trunk, on the side away from where the branches go.
        const m = MID[s];
        const inward: P2 = [-m[0] * 2, -m[1] * 2];
        let spread = 0;
        const perp: P2 = [-inward[1], inward[0]];
        for (const p of at) {
          const o = MID[otherSide(p, s)];
          spread += dot([o[0] - m[0], o[1] - m[1]], perp);
        }
        const sideSign = spread >= 0 ? -1 : 1;
        const u = m[0] + inward[0] * 0.18 + perp[0] * 0.42 * sideSign;
        const v = m[1] + inward[1] * 0.18 + perp[1] * 0.42 * sideSign;
        const [wx, wz] = W([u, v]);
        g.levers.push([wx, (groundAt(map, x, z, u, v) + SURFACE_LIFT) * cellSize, wz]);
      }

      // Level-crossing barriers: two posts on opposite corners.
      if (crossing) {
        const alongZ = (bits & 1) !== 0; // rail N–S → road runs along x
        const y = (groundAt(map, x, z, 0, 0) + ROAD_TOP) * cellSize;
        for (const sgn of [-1, 1]) {
          const u = alongZ ? 0.36 * sgn : 0.44 * sgn;
          const v = alongZ ? -0.44 * sgn : 0.36 * sgn;
          const [wx, wz] = W([u, v]);
          g.barriers.push([wx, y, wz, alongZ ? 0 : Math.PI / 2]);
        }
      }
    }
  }
  return g;
}

function densify(line: P2[], n: number): P2[] {
  const [a, b] = line;
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

export function toGeometry(arr: number[]): THREE.BufferGeometry | null {
  if (!arr.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  geom.computeVertexNormals();
  return geom;
}
