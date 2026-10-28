/**
 * railGeometry — shared helpers for drawing rail centre-lines (real track and
 * the planner hologram).
 *
 * A line is sampled at a FIXED short pitch (UNIT = 1/10 cell). Each sample
 * gets a terrain height, smoothed along the line so the track runs as an even
 * grade over hills instead of copying every bump of the ground mesh.
 */

import * as THREE from 'three';
import { CellType, cellCornerHeights, LineWalker, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

/** Length of one track unit (cells). The track is this short piece, repeated. */
export const UNIT = 0.1;

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;

/** Ground height (cell units, incl. the flat tile top) at grid point (x, z). */
export function groundAtGrid(map: TerrainMap, x: number, z: number): number {
  const cx = Math.min(map.size - 1, Math.max(0, Math.round(x)));
  const cz = Math.min(map.size - 1, Math.max(0, Math.round(z)));
  const [h00, h10, h11, h01] = cellCornerHeights(map, cx, cz);
  const s = Math.min(1, Math.max(0, x - cx + 0.5));
  const t = Math.min(1, Math.max(0, z - cz + 0.5));
  return FLAT_TOP + (h00 * (1 - s) + h10 * s) * (1 - t) + (h01 * (1 - s) + h11 * s) * t;
}

export interface TrackSamples {
  n: number;
  /** Unit length actually used (total / n). */
  step: number;
  x: Float32Array;
  z: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  /** Smoothed ground height (cell units). */
  h: Float32Array;
}

/** Length (cells) over which a track end eases onto its node's ground height. */
const END_BLEND = 1.5;
const ease = (t: number) => (t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Sample a centre-line at unit CENTRES, ≈ every `pitch` cells. */
export function sampleTrack(map: TerrainMap, pts: readonly number[], pitch = UNIT): TrackSamples {
  const w = new LineWalker(pts);
  const n = Math.max(1, Math.round(w.total / pitch));
  const step = w.total / n;
  const s: TrackSamples = {
    n,
    step,
    x: new Float32Array(n),
    z: new Float32Array(n),
    tx: new Float32Array(n),
    tz: new Float32Array(n),
    h: new Float32Array(n),
  };
  const o = [0, 0, 0, 0];
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w.at((i + 0.5) * step, o);
    s.x[i] = o[0];
    s.z[i] = o[1];
    s.tx[i] = o[2];
    s.tz[i] = o[3];
    raw[i] = groundAtGrid(map, o[0], o[1]);
  }
  // Even grade: moving average over ±1.5 cells (no bumps at every terrain
  // ramp), but never BELOW the ground (track would sink in on crests) —
  // lift to the ground there, then soften those lifts with a short pass.
  const avg = (src: Float32Array, k: number, dst: Float32Array) => {
    const pref = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + src[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - k), b = Math.min(n, i + k + 1);
      dst[i] = (pref[b] - pref[a]) / (b - a);
    }
  };
  const tmp = new Float32Array(n);
  avg(raw, Math.max(1, Math.round(1.5 / step)), tmp);
  for (let i = 0; i < n; i++) tmp[i] = Math.max(tmp[i], raw[i]);
  avg(tmp, Math.max(1, Math.round(1 / step)), s.h);
  // Ends: ease onto the ground at the end node, so every track meeting there
  // (smoothed on its own) arrives at the same height — no steps at joints.
  const h0 = groundAtGrid(map, pts[0], pts[1]);
  const h1 = groundAtGrid(map, pts[pts.length - 2], pts[pts.length - 1]);
  for (let i = 0; i < n; i++) {
    const d0 = (i + 0.5) * step, d1 = w.total - d0;
    const e0 = ease(d0 / END_BLEND), e1 = ease(d1 / END_BLEND);
    let h = s.h[i];
    if (e0 < 1) h = h0 + (h - h0) * e0;
    if (e1 < 1) h = h1 + (h - h1) * e1;
    s.h[i] = Math.max(h, raw[i] - 0.01);
  }
  return s;
}

/**
 * Sweep a solid bar (top + two side walls) along `pts` (world x/z) with a
 * per-point base height `ys`. Width tapers from hwBot (at y0) to hwTop (at y1).
 * Wound counter-clockwise seen from outside (front faces).
 */
export function sweepBar(
  out: number[],
  pts: Array<[number, number]>,
  ys: number[],
  hwTop: number,
  hwBot: number,
  y0: number,
  y1: number,
): void {
  const L = pts.length;
  if (L < 2) return;
  const nrm: Array<[number, number]> = [];
  for (let i = 0; i < L; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(L - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    nrm.push([-dz / l, dx / l]);
  }
  const P = (i: number, side: number, hw: number, y: number): number[] => [
    pts[i][0] + nrm[i][0] * hw * side,
    ys[i] + y,
    pts[i][1] + nrm[i][1] * hw * side,
  ];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < L - 1; i++) {
    const j = i + 1;
    quad(P(i, 1, hwTop, y1), P(j, 1, hwTop, y1), P(j, -1, hwTop, y1), P(i, -1, hwTop, y1));
    quad(P(i, 1, hwBot, y0), P(j, 1, hwBot, y0), P(j, 1, hwTop, y1), P(i, 1, hwTop, y1));
    quad(P(j, -1, hwBot, y0), P(i, -1, hwBot, y0), P(i, -1, hwTop, y1), P(j, -1, hwTop, y1));
  }
}

export function toGeometry(arr: number[]): THREE.BufferGeometry | null {
  if (!arr.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  geom.computeVertexNormals();
  return geom;
}
