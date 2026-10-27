/**
 * TrainModel — a diesel locomotive and the freight wagons (low-poly, after
 * the reference renders):
 *
 *   - Locomotive: a road-switcher — tall long hood with door panels, a big
 *     louvred grille and roof radiators, a full-width cab with an overhanging
 *     roof, a low short nose with two wrap-round yellow bands and twin
 *     headlights, yellow walkway stripe, handrails and end steps, big
 *     bogies and a rounded fuel tank, some rust. Body colour per train; the
 *     line's colour as a band under the cab windows;
 *   - wagons by cargo: hopper (ore), tank (oil), boxcar (goods), stake flat
 *     car (logs / planks). Loaded or empty: the load is its own mesh.
 *
 * Units: cells, sized to the trucks. Origin: the car's centre at RAIL-TOP
 * height, +X forward. Every car is CAR_LEN long (the loco LOCO_LEN), its
 * bogies CAR_BOGIE / LOCO_BOGIE from the centre — a renderer places each car
 * by putting its two bogies on the track.
 */

import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';
import { ball, box, buildParts, cyl, FIXED_MAT, paintMat, profile, type Part } from './lowPoly';
import type { Item } from '../sim';

// Car lengths live in the simulation (it spaces the cars); re-exported here.
export { CAR_GAP, CAR_LEN, LOCO_LEN } from '../sim/rail';
import { CAR_GAP, CAR_LEN, LOCO_LEN } from '../sim/rail';
/** Bogie centres from a car's centre (loco / wagon). */
export const LOCO_BOGIE = 0.47;
export const CAR_BOGIE = 0.4;
/** Track half-gauge (the wheels sit on the rails; see Rails.tsx). */
export const HALF_GAUGE = 0.075;

export type WagonKind = 'hopper' | 'tank' | 'box' | 'flat';

/** Which wagon carries what. */
export const WAGON_FOR: Record<Item, WagonKind> = {
  ore: 'hopper',
  crushed: 'hopper',
  oil: 'tank',
  goods: 'box',
  log: 'flat',
  plank: 'flat',
};

/** Locomotive body colours (a train's pick depends on its id). */
export const LOCO_COLORS = ['#3b5664', '#5e2a24', '#2f4532', '#3b404b', '#5b4a28', '#223a5a'];

const DARK = '#25272b';
const FRAME = '#2e3135';
const STEEL = '#4a4f55';
const WHEEL = '#34373b';
const YELLOW = '#e3b52b';
const GLASS = '#1c252d';
const LAMP = '#ffe9a0';
const RED = '#c8261e';
const RUST = '#7a4f33';
const RUST_L = '#8d5d3c';
const GRILLE = '#1f2226';

// ---------------------------------------------------------------- running gear

/** Two-axle bogie centred at x: side frames with springs, wheels on the rails. */
function bogie(x: number, big = false): Part[] {
  const r = big ? 0.04 : 0.034;
  const span = big ? 0.075 : 0.065;
  const out: Part[] = [box(DARK, [x, 0.06, 0], [big ? 0.26 : 0.22, 0.03, 0.17])];
  for (const z of [-0.105, 0.105]) {
    out.push(box(FRAME, [x, 0.045, z], [big ? 0.28 : 0.24, 0.04, 0.014]));
    out.push(box(STEEL, [x, 0.05, z * 1.06], [0.05, 0.035, 0.01])); // spring nest
    for (const dx of [-span, span]) out.push(cyl(DARK, 'z', [x + dx, r, z * 1.08], 0.016, 0.01, 8)); // axle boxes
  }
  for (const dx of [-span, span])
    for (const z of [-HALF_GAUGE, HALF_GAUGE]) out.push(cyl(WHEEL, 'z', [x + dx, r, z], r, 0.016, 12));
  return out;
}

/** Knuckle coupler + small end beam at a car end (sign = +1 front / −1 back). */
function coupler(halfLen: number, sign: number, y = 0.1): Part[] {
  const x = sign * halfLen;
  return [
    box(DARK, [x - sign * 0.01, y, 0], [0.03, 0.04, 0.24]),
    box(STEEL, [x + sign * 0.025, y - 0.005, 0], [0.05, 0.02, 0.025]),
    box(STEEL, [x + sign * 0.05, y - 0.005, 0], [0.015, 0.03, 0.035]),
  ];
}

/** Wagon underframe: centre sill, side sills, bogies, couplers. */
function underframe(len: number, deckY = 0.12): Part[] {
  return [
    box(DARK, [0, deckY - 0.025, 0], [len - 0.08, 0.035, 0.07]),
    box(FRAME, [0, deckY - 0.01, 0.12], [len - 0.06, 0.03, 0.015]),
    box(FRAME, [0, deckY - 0.01, -0.12], [len - 0.06, 0.03, 0.015]),
    ...bogie(-CAR_BOGIE),
    ...bogie(CAR_BOGIE),
    ...coupler(len / 2, 1),
    ...coupler(len / 2, -1),
  ];
}

/** Rust streaks / patches on a vertical face at z (flat, slightly proud). */
function rust(spots: Array<[number, number, number, number]>, z: number): Part[] {
  return spots.map(([x, y, w, h], i) => box(i % 2 ? RUST : RUST_L, [x, y, z], [w, h, 0.002]));
}

// ---------------------------------------------------------------- locomotive

const LOCO: Part[] = (() => {
  const L = LOCO_LEN;
  const h = L / 2;
  const deck = 0.145; // walkway top
  const hood = { x0: -h + 0.04, x1: 0.24, w: 0.19, top: 0.42 };
  const cab = { x0: 0.24, x1: 0.5, w: 0.27, top: 0.5 };
  const nose = { x0: 0.5, x1: h - 0.05, w: 0.19, top: 0.33 };
  const hx = (hood.x0 + hood.x1) / 2, hl = hood.x1 - hood.x0;
  const p: Part[] = [
    // Frame / walkway, yellow stripe on its edge
    box(FRAME, [0, deck - 0.02, 0], [L - 0.04, 0.04, 0.29]),
    box(YELLOW, [0, deck - 0.015, 0.1455], [L - 0.06, 0.022, 0.002]),
    box(YELLOW, [0, deck - 0.015, -0.1455], [L - 0.06, 0.022, 0.002]),
    // Long hood, with a slightly narrower cap (soft top edges)
    box('paint', [hx, (deck + hood.top) / 2 - 0.008, 0], [hl, hood.top - deck - 0.016, hood.w]),
    box('paint', [hx, hood.top - 0.008, 0], [hl - 0.01, 0.016, hood.w - 0.02]),
    // Cab with an overhanging roof
    box('paint', [(cab.x0 + cab.x1) / 2, (deck + cab.top) / 2, 0], [cab.x1 - cab.x0, cab.top - deck, cab.w]),
    box('paintDark', [(cab.x0 + cab.x1) / 2, cab.top + 0.01, 0], [cab.x1 - cab.x0 + 0.03, 0.02, cab.w + 0.02]),
    // Short nose with a bevelled front top
    box('paint', [(nose.x0 + nose.x1) / 2 - 0.01, (deck + nose.top) / 2, 0], [nose.x1 - nose.x0 - 0.02, nose.top - deck, nose.w]),
    box('paint', [nose.x1 - 0.03, nose.top - 0.03, 0], [0.06, 0.06, nose.w], [0, 0, 0.6]),
    box('paint', [nose.x1 - 0.02, (deck + nose.top - 0.05) / 2, 0], [0.04, nose.top - deck - 0.05, nose.w]),
  ];
  // Two yellow bands round the nose (sides + front)
  for (const y of [0.2, 0.245]) {
    p.push(box(YELLOW, [(nose.x0 + nose.x1) / 2, y, nose.w / 2 + 0.001], [nose.x1 - nose.x0, 0.016, 0.002]));
    p.push(box(YELLOW, [(nose.x0 + nose.x1) / 2, y, -nose.w / 2 - 0.001], [nose.x1 - nose.x0, 0.016, 0.002]));
    p.push(box(YELLOW, [nose.x1 + 0.001, y, 0], [0.002, 0.016, nose.w]));
  }
  // Twin headlights + number board on the nose, a light on the cab and the hood end
  p.push(cyl(LAMP, 'x', [nose.x1 - 0.004, 0.29, 0.026], 0.017, 0.012, 12));
  p.push(cyl(LAMP, 'x', [nose.x1 - 0.004, 0.29, -0.026], 0.017, 0.012, 12));
  p.push(box(DARK, [nose.x1 - 0.03, 0.315, 0], [0.03, 0.02, 0.07]));
  p.push(cyl(LAMP, 'x', [hood.x0 - 0.003, 0.39, 0.025], 0.012, 0.008, 10));
  p.push(cyl(LAMP, 'x', [hood.x0 - 0.003, 0.39, -0.025], 0.012, 0.008, 10));
  p.push(box(RED, [hood.x0 - 0.002, 0.3, 0.07], [0.004, 0.014, 0.014]));
  p.push(box(RED, [hood.x0 - 0.002, 0.3, -0.07], [0.004, 0.014, 0.014]));
  // Cab: front windows, side windows, doors, line-colour band, horn
  for (const z of [-0.065, 0.065]) p.push(box(GLASS, [cab.x1 + 0.001, 0.43, z], [0.002, 0.06, 0.09]));
  for (const z of [-0.065, 0.065]) p.push(box(GLASS, [cab.x0 - 0.001, 0.43, z], [0.002, 0.05, 0.07]));
  for (const s of [-1, 1]) {
    p.push(box(GLASS, [cab.x0 + 0.07, 0.43, s * (cab.w / 2 + 0.001)], [0.08, 0.06, 0.002]));
    p.push(box(DARK, [cab.x0 + 0.07, 0.43, s * (cab.w / 2 + 0.002)], [0.09, 0.006, 0.002])); // window bar
    p.push(box('paintDark', [cab.x1 - 0.06, 0.29, s * (cab.w / 2 + 0.001)], [0.07, 0.17, 0.002])); // door
    p.push(box('stripe', [cab.x0 + 0.07, 0.38, s * (cab.w / 2 + 0.002)], [0.12, 0.018, 0.002]));
  }
  p.push(cyl(DARK, 'x', [cab.x0 + 0.06, cab.top + 0.035, 0.05], 0.008, 0.06, 6)); // horn
  p.push(box(DARK, [cab.x0 + 0.05, cab.top + 0.025, 0.05], [0.01, 0.02, 0.01]));
  // Long hood: door panels (seams), big louvred grille at the rear top,
  // roof radiators with fans, exhaust stacks, dynamic-brake grille.
  for (const s of [-1, 1]) {
    const z = s * (hood.w / 2 + 0.001);
    for (let x = hood.x0 + 0.1; x < hood.x1 - 0.02; x += 0.085) p.push(box('paintDark', [x, 0.28, z], [0.004, 0.24, 0.002]));
    p.push(box(GRILLE, [hood.x0 + 0.17, 0.355, z], [0.24, 0.07, 0.003]));
    for (let k = 0; k < 6; k++) p.push(box(STEEL, [hood.x0 + 0.17, 0.33 + k * 0.01, z * 1.005], [0.23, 0.003, 0.002]));
    p.push(box(GRILLE, [hood.x0 + 0.62, 0.37, z], [0.14, 0.04, 0.003]));
  }
  for (const x of [hood.x0 + 0.13, hood.x0 + 0.3]) {
    p.push(box(GRILLE, [x, hood.top + 0.004, 0], [0.15, 0.008, 0.15]));
    p.push(cyl(DARK, 'y', [x, hood.top + 0.01, 0], 0.05, 0.008, 14));
    for (let k = -2; k <= 2; k++) p.push(box(STEEL, [x + k * 0.025, hood.top + 0.009, 0], [0.004, 0.004, 0.14]));
  }
  p.push(cyl(DARK, 'y', [hood.x0 + 0.5, hood.top + 0.025, 0.025], 0.017, 0.05, 8));
  p.push(cyl(DARK, 'y', [hood.x0 + 0.55, hood.top + 0.025, -0.02], 0.017, 0.05, 8));
  p.push(box('paintDark', [hood.x0 + 0.66, hood.top + 0.01, 0], [0.16, 0.02, 0.15])); // brake housing
  // Wear: a few dull streaks under the grilles
  p.push(box('paintDark', [hood.x0 + 0.17, 0.3, hood.w / 2 + 0.0015], [0.2, 0.012, 0.002]));
  p.push(box('paintDark', [hood.x0 + 0.17, 0.3, -hood.w / 2 - 0.0015], [0.2, 0.012, 0.002]));
  // Handrails (yellow) on stanchions along both walkways, end railings and
  // diagonal step rails, yellow steps at the four corners.
  for (const s of [-1, 1]) {
    const z = s * 0.135;
    p.push(box(YELLOW, [hx, 0.3, z], [hl - 0.04, 0.008, 0.008]));
    for (let x = hood.x0 + 0.02; x <= hood.x1; x += 0.155) p.push(box(YELLOW, [x, 0.225, z], [0.008, 0.15, 0.008]));
    p.push(box(YELLOW, [nose.x0 + 0.08, 0.26, z], [0.15, 0.008, 0.008]));
    p.push(box(YELLOW, [nose.x1 - 0.005, 0.22, z], [0.008, 0.15, 0.008]));
    for (const e of [-1, 1]) {
      const ex = e * (h - 0.035);
      p.push(box(YELLOW, [ex, 0.2, z], [0.008, 0.11, 0.008]));
      p.push(box(YELLOW, [ex - e * 0.04, 0.1, z * 1.05], [0.07, 0.006, 0.006], [0, 0, e * -0.9])); // step rail
      for (let k = 0; k < 3; k++) p.push(box(YELLOW, [ex + e * 0.005, 0.04 + k * 0.035, z * 1.02], [0.04, 0.006, 0.05])); // steps
    }
  }
  for (const e of [-1, 1]) p.push(box(YELLOW, [e * (h - 0.035), 0.255, 0], [0.008, 0.008, 0.27]));
  // Fuel tank (rounded), air tanks, pilots, bogies, couplers
  p.push(cyl(DARK, 'x', [0.0, 0.075, 0], 0.055, 0.46, 12));
  p.push(ball(DARK, [0.23, 0.075, 0], [0.025, 0.055, 0.055], 10));
  p.push(ball(DARK, [-0.23, 0.075, 0], [0.025, 0.055, 0.055], 10));
  p.push(cyl(STEEL, 'x', [0.0, 0.11, 0.115], 0.018, 0.3, 8));
  p.push(cyl(STEEL, 'x', [0.0, 0.11, -0.115], 0.018, 0.3, 8));
  for (const e of [-1, 1]) {
    p.push(box(DARK, [e * (h - 0.02), 0.06, 0], [0.03, 0.06, 0.24]));
    p.push(box(YELLOW, [e * (h - 0.005), 0.045, 0], [0.004, 0.012, 0.2]));
  }
  p.push(...bogie(-LOCO_BOGIE, true), ...bogie(LOCO_BOGIE, true));
  p.push(...coupler(h, 1, 0.1), ...coupler(h, -1, 0.1));
  return p;
})();

// ---------------------------------------------------------------- wagons

/** Open hopper: tapering ends, ribbed X-braced side panels, a top rim. */
const HOPPER: Part[] = (() => {
  const L = CAR_LEN;
  const t = L / 2 - 0.03; // top half-length
  const b = 0.36; // bottom half-length
  const top = 0.4;
  const p: Part[] = [
    ...underframe(L),
    profile('paint', [[-t, top], [t, top], [t, 0.27], [b, 0.15], [-b, 0.15], [-t, 0.27]], 0.26),
    box(DARK, [0, top - 0.004, 0], [2 * t - 0.03, 0.006, 0.24]), // the open top (inside)
    // Discharge gates under the body
    box(DARK, [-0.17, 0.13, 0], [0.12, 0.05, 0.16]),
    box(DARK, [0.17, 0.13, 0], [0.12, 0.05, 0.16]),
  ];
  // Rim round the top
  for (const z of [-0.132, 0.132]) p.push(box(FRAME, [0, top + 0.005, z], [2 * t + 0.01, 0.014, 0.012]));
  for (const x of [-t, t]) p.push(box(FRAME, [x, top + 0.005, 0], [0.012, 0.014, 0.27]));
  // Side posts and X braces in each panel, end corner posts
  const posts = [-t, -0.27, 0, 0.27, t];
  for (const z of [-0.1315, 0.1315]) {
    for (const x of posts) p.push(box(FRAME, [x, 0.33, z], [0.016, 0.14, 0.005]));
    for (let k = 0; k < posts.length - 1; k++) {
      const cx = (posts[k] + posts[k + 1]) / 2;
      const w = posts[k + 1] - posts[k];
      const ang = Math.atan2(0.12, w);
      const len = Math.hypot(w, 0.12);
      p.push(box(FRAME, [cx, 0.33, z], [len, 0.01, 0.004], [0, 0, ang]));
      p.push(box(FRAME, [cx, 0.33, z], [len, 0.01, 0.004], [0, 0, -ang]));
    }
    p.push(box(FRAME, [0, 0.265, z], [2 * t, 0.012, 0.005])); // belt rail
  }
  p.push(...rust([[-0.3, 0.3, 0.06, 0.05], [0.2, 0.36, 0.05, 0.03]], 0.134));
  // Tail lights
  p.push(box(RED, [-(L / 2 - 0.035), 0.3, 0.1], [0.004, 0.02, 0.02]));
  p.push(box(RED, [-(L / 2 - 0.035), 0.3, -0.1], [0.004, 0.02, 0.02]));
  return p;
})();

/** Ore heap: a mound of lumpy rocks above the rim. */
const ORE_LOAD: Part[] = (() => {
  const p: Part[] = [box('load', [0, 0.405, 0], [CAR_LEN - 0.1, 0.02, 0.24])];
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) {
    const x = (rnd() - 0.5) * (CAR_LEN - 0.18);
    const z = (rnd() - 0.5) * 0.19;
    const mound = 1 - Math.abs(x) / (CAR_LEN / 2); // higher in the middle
    const r = 0.03 + rnd() * 0.028;
    p.push({ mat: 'load', shape: 'rock', pos: [x, 0.41 + mound * 0.035 + rnd() * 0.012, z], size: [r * 1.2, r * 0.9, r], rot: [rnd() * 3, rnd() * 3, rnd() * 3] });
  }
  return p;
})();

/** Tank car: rounded barrel on saddles, bands, top platform with railing. */
const TANK: Part[] = (() => {
  const L = CAR_LEN;
  const half = L / 2 - 0.12;
  const y = 0.255;
  const r = 0.12;
  const p: Part[] = [
    ...underframe(L),
    box(STEEL, [0, 0.122, 0], [L - 0.06, 0.008, 0.25]), // running board
    cyl('paint', 'x', [0, y, 0], r, 2 * half, 16),
    ball('paint', [half, y, 0], [0.07, r, r], 16),
    ball('paint', [-half, y, 0], [0.07, r, r], 16),
    // Saddles
    box(DARK, [-0.34, 0.15, 0], [0.05, 0.06, 0.2]),
    box(DARK, [0.34, 0.15, 0], [0.05, 0.06, 0.2]),
    // Dome, hatch and the top platform with railing
    cyl(DARK, 'y', [0, y + r + 0.012, 0], 0.04, 0.03, 12),
    box(STEEL, [0, y + r + 0.004, 0], [0.24, 0.008, 0.16]),
    // Discharge pipe + valve underneath
    cyl(DARK, 'z', [0, 0.14, 0], 0.012, 0.22, 8),
    cyl(RED, 'y', [0, 0.15, 0.09], 0.012, 0.012, 8),
  ];
  for (const x of [-0.42, -0.14, 0.14, 0.42]) p.push(cyl(DARK, 'x', [x, y, 0], r + 0.003, 0.012, 16)); // bands
  for (const s of [-1, 1]) {
    p.push(box(STEEL, [0, y + r + 0.05, s * 0.08], [0.24, 0.006, 0.006]));
    for (const x of [-0.115, 0, 0.115]) p.push(box(STEEL, [x, y + r + 0.027, s * 0.08], [0.006, 0.045, 0.006]));
    // Ladders down both sides
    for (const dz of [0.0, 0.035]) p.push(box(STEEL, [0.04 + dz, 0.25, s * (r + 0.008)], [0.004, 0.22, 0.004]));
    for (let k = 0; k < 6; k++) p.push(box(STEEL, [0.058, 0.16 + k * 0.035, s * (r + 0.008)], [0.035, 0.004, 0.004]));
    // Hazard plates + stencil panels
    p.push(box(RED, [half - 0.06, y + 0.02, s * (r - 0.004)], [0.035, 0.025, 0.004], [s * 0.2, 0, 0]));
    p.push(box('#e8e4d8', [-0.25, y - 0.03, s * (r - 0.003)], [0.08, 0.035, 0.004], [s * 0.25, 0, 0]));
  }
  // Hazard stripes on the end beams
  for (const e of [-1, 1])
    for (let k = -2; k <= 2; k++) p.push(box(k % 2 ? YELLOW : DARK, [e * (L / 2 - 0.035), 0.1, k * 0.045], [0.004, 0.035, 0.045]));
  return p;
})();

/** Boxcar: ribbed sides, arched roof, sliding door, end ladders. */
const BOX_CAR: Part[] = (() => {
  const L = CAR_LEN;
  const top = 0.42;
  const base = 0.13;
  const p: Part[] = [
    ...underframe(L),
    box('paint', [0, (top + base) / 2, 0], [L - 0.06, top - base, 0.27]),
    // Arched roof: a flattened cylinder along the car, roof walk boards
    { mat: 'paint', shape: 'cylX', pos: [0, top, 0], size: [0.04, L - 0.05, 0.14], seg: 16 },
    box(DARK, [-0.25, top + 0.04, 0], [0.18, 0.006, 0.03]),
    box(DARK, [0.25, top + 0.04, 0], [0.18, 0.006, 0.03]),
  ];
  for (const s of [-1, 1]) {
    const z = s * 0.136;
    // Vertical ribs and a belt rail
    for (let x = -L / 2 + 0.07; x < L / 2 - 0.04; x += 0.085) {
      if (Math.abs(x - 0.05) < 0.14) continue; // the door
      p.push(box('paintDark', [x, (top + base) / 2, z], [0.014, top - base, 0.005]));
    }
    p.push(box('paintDark', [0, 0.27, z], [L - 0.07, 0.01, 0.005]));
    // Sliding door with frame and track
    p.push(box('paintDark', [0.05, 0.265, s * 0.1375], [0.26, 0.25, 0.004]));
    for (const dx of [-0.13, 0.13]) p.push(box(FRAME, [0.05 + dx, 0.265, s * 0.139], [0.012, 0.26, 0.005]));
    p.push(box(FRAME, [0.05, top - 0.01, s * 0.139], [0.3, 0.012, 0.006]));
    p.push(box(FRAME, [0.05, base + 0.01, s * 0.139], [0.3, 0.012, 0.006]));
    // Corner ladders
    for (const e of [-1, 1]) {
      const lx = e * (L / 2 - 0.07);
      for (let k = 0; k < 5; k++) p.push(box(STEEL, [lx, 0.17 + k * 0.05, s * 0.14], [0.04, 0.005, 0.005]));
      p.push(box(YELLOW, [e * (L / 2 - 0.03), 0.3, s * 0.125], [0.004, 0.06, 0.005])); // grab iron
    }
  }
  // End posts, tail lights
  for (const e of [-1, 1]) for (const z of [-0.09, 0, 0.09]) p.push(box('paintDark', [e * (L / 2 - 0.028), (top + base) / 2, z], [0.006, top - base, 0.014]));
  p.push(box(RED, [-(L / 2 - 0.025), 0.17, 0.1], [0.006, 0.022, 0.02]));
  p.push(box(RED, [-(L / 2 - 0.025), 0.17, -0.1], [0.006, 0.022, 0.02]));
  return p;
})();

/** Stake flat car: a deck with tall stakes. */
const FLAT: Part[] = (() => {
  const L = CAR_LEN;
  const p: Part[] = [...underframe(L, 0.13), box(FRAME, [0, 0.137, 0], [L - 0.04, 0.02, 0.28])];
  // Side sills (slightly deeper in the middle)
  for (const z of [-0.138, 0.138]) p.push(profile(FRAME, [[-L / 2 + 0.03, 0.15], [L / 2 - 0.03, 0.15], [L / 2 - 0.03, 0.125], [0.3, 0.1], [-0.3, 0.1], [-L / 2 + 0.03, 0.125]], 0.012, [0, 0, z]));
  // Tall stakes
  for (const z of [-0.132, 0.132]) for (let k = -3; k <= 3; k++) p.push(box(DARK, [k * 0.16, 0.24, z], [0.016, 0.2, 0.016]));
  return p;
})();

/** Logs (rear half, a pyramid with chains) + plank bundles (front half, strapped). */
const LOGS_LOAD: Part[] = (() => {
  const p: Part[] = [];
  const rows: Array<[number, number]> = [
    [0.175, 4],
    [0.228, 4],
    [0.281, 3],
  ];
  for (const [y, n] of rows)
    for (let k = 0; k < n; k++) {
      const z = (k - (n - 1) / 2) * 0.056;
      const len = 0.5 + ((k * 7 + y * 100) % 3) * 0.015;
      p.push(cyl('load', 'x', [-0.26, y, z], 0.028, len, 9));
      p.push(cyl('#dcbf8f', 'x', [-0.26 + len / 2 + 0.001, y, z], 0.024, 0.003, 9));
      p.push(cyl('#dcbf8f', 'x', [-0.26 - len / 2 - 0.001, y, z], 0.024, 0.003, 9));
    }
  // Chains over the logs
  for (const x of [-0.4, -0.12]) p.push(box(DARK, [x, 0.23, 0], [0.006, 0.16, 0.24]));
  return p;
})();
const PLANK_LOAD: Part[] = (() => {
  const p: Part[] = [];
  for (const x of [0.15, 0.39])
    for (const z of [-0.06, 0.06])
      for (const y of [0.195, 0.29]) {
        p.push(box('#e3b46c', [x, y, z], [0.22, 0.09, 0.105]));
        // Plank seams on the bundle's end and the straps
        for (let k = -2; k <= 2; k++) p.push(box('#c9964f', [x + 0.111, y + k * 0.018, z], [0.002, 0.003, 0.1]));
        p.push(box(DARK, [x - 0.06, y, z], [0.008, 0.092, 0.107]));
        p.push(box(DARK, [x + 0.06, y, z], [0.008, 0.092, 0.107]));
      }
  return p;
})();

const GEO = {
  loco: buildParts(LOCO),
  hopper: buildParts(HOPPER),
  tank: buildParts(TANK),
  box: buildParts(BOX_CAR),
  flat: buildParts(FLAT),
  ore: buildParts(ORE_LOAD),
  logs: buildParts([...LOGS_LOAD, ...PLANK_LOAD]),
};

const WAGON_PAINT: Record<WagonKind, string> = { hopper: '#6a5242', tank: '#5f6b74', box: '#6e655c', flat: FRAME };
const LOAD_COLOR = { ore: '#2a2622', logs: '#b88a54' };

/** `color` darkened (for seams, doors, the cab roof). */
function darker(color: string, k = 0.72): string {
  return '#' + new THREE.Color(color).multiplyScalar(k).getHexString();
}

function Meshes({ geo, mats }: { geo: Record<string, THREE.BufferGeometry>; mats: Record<string, THREE.Material> }) {
  return (
    <>
      {Object.entries(geo).map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k] ?? FIXED_MAT} castShadow={k !== 'stripe'} />
      ))}
    </>
  );
}

/** The locomotive (origin: centre at rail-top height, +X forward). */
export const Locomotive = forwardRef<THREE.Group, { color: string; stripe: string }>(function Locomotive({ color, stripe }, ref) {
  const mats = useMemo(
    () => ({ paint: paintMat(color, 0.7), paintDark: paintMat(darker(color), 0.7), stripe: paintMat(stripe, 0.5) }),
    [color, stripe],
  );
  return (
    <group ref={ref} rotation-order="YZX">
      <Meshes geo={GEO.loco} mats={mats} />
    </group>
  );
});

/** A freight wagon; `loaded` shows its cargo. */
export const Wagon = forwardRef<THREE.Group, { kind: WagonKind; loaded?: boolean }>(function Wagon({ kind, loaded = true }, ref) {
  const mats = useMemo(() => ({ paint: paintMat(WAGON_PAINT[kind], 0.85), paintDark: paintMat(darker(WAGON_PAINT[kind], 0.82), 0.85) }), [kind]);
  const load = kind === 'hopper' ? GEO.ore : kind === 'flat' ? GEO.logs : null;
  const loadMats = useMemo(() => ({ load: paintMat(kind === 'hopper' ? LOAD_COLOR.ore : LOAD_COLOR.logs, 0.9) }), [kind]);
  return (
    <group ref={ref} rotation-order="YZX">
      <Meshes geo={GEO[kind]} mats={mats} />
      {loaded && load && <Meshes geo={load} mats={loadMats} />}
    </group>
  );
});

/** Model viewer close-ups: the loco + a hopper, and the other three wagons. */
export function LocoPreview() {
  return (
    <group scale={3.2} position={[0.3, 0.105 * 3.2, 0]}>
      <PreviewTrack len={2.8} />
      <group position={[0.3, 0, 0]}>
        <Locomotive color={LOCO_COLORS[0]} stripe="#e74c3c" />
      </group>
      <group position={[0.3 - (LOCO_LEN + CAR_LEN) / 2 - CAR_GAP, 0, 0]}>
        <Wagon kind="hopper" />
      </group>
    </group>
  );
}
export function WagonsPreview() {
  const step = CAR_LEN + CAR_GAP;
  return (
    <group scale={2.4} position={[0, 0.105 * 2.4, 0]}>
      <PreviewTrack len={3.7} />
      <group position={[step, 0, 0]}>
        <Wagon kind="tank" />
      </group>
      <Wagon kind="box" />
      <group position={[-step, 0, 0]}>
        <Wagon kind="flat" />
      </group>
    </group>
  );
}

/**
 * Model viewer: a loco + hopper on one track, a tank, boxcar and flat car on
 * the other (on short track pieces), scaled ×2 to the viewer's size.
 */
export function TrainPreview() {
  const step = CAR_LEN + CAR_GAP;
  return (
    <group scale={2}>
      {/* Lift the track bed onto the ground (rail top 0.105 above it). */}
      <group position={[0, 0.105, 0]}>
        <group position={[-0.55, 0, -0.32]}>
          <PreviewTrack len={3.0} />
          <group position={[0.62, 0, 0]}>
            <Locomotive color={LOCO_COLORS[0]} stripe="#e74c3c" />
          </group>
          <group position={[0.62 - (LOCO_LEN + CAR_LEN) / 2 - CAR_GAP, 0, 0]}>
            <Wagon kind="hopper" />
          </group>
        </group>
        <group position={[-0.55, 0, 0.32]}>
          <PreviewTrack len={3.8} />
          <group position={[step, 0, 0]}>
            <Wagon kind="tank" />
          </group>
          <Wagon kind="box" />
          <group position={[-step, 0, 0]}>
            <Wagon kind="flat" />
          </group>
        </group>
      </group>
    </group>
  );
}

const PT_MAT = {
  ballast: paintMat('#7d7468', 0.95),
  sleeper: paintMat('#5a3f27', 0.9),
  rail: paintMat('#a3a9b0', 0.4),
};
/** A short straight track for the preview (rail top at y = 0). */
function PreviewTrack({ len }: { len: number }) {
  const sleepers = useMemo(() => {
    const out: number[] = [];
    for (let x = -len / 2 + 0.06; x < len / 2; x += 0.13) out.push(x);
    return out;
  }, [len]);
  return (
    <group position={[0, -0.1, 0]}>
      <mesh material={PT_MAT.ballast} position={[0, 0.02, 0]} receiveShadow castShadow>
        <boxGeometry args={[len, 0.05, 0.42]} />
      </mesh>
      {sleepers.map((x) => (
        <mesh key={x} material={PT_MAT.sleeper} position={[x, 0.055, 0]} receiveShadow>
          <boxGeometry args={[0.06, 0.025, 0.3]} />
        </mesh>
      ))}
      {[-HALF_GAUGE, HALF_GAUGE].map((z) => (
        <mesh key={z} material={PT_MAT.rail} position={[0, 0.085, z]} receiveShadow>
          <boxGeometry args={[len, 0.03, 0.022]} />
        </mesh>
      ))}
    </group>
  );
}
