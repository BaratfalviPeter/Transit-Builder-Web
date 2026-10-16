/**
 * dayNight — the sky model for the day/night cycle.
 *
 * `skyAt(t, v)` turns a time of day t ∈ [0, 1) (0 = midnight, 0.5 = noon) plus
 * the player's tuned visual settings (which define the NOON look) into the
 * sun/moon direction, light colours and intensities, and the background. Noon
 * reproduces the tuned values exactly; dawn/dusk add a warm golden hour, and
 * night swaps the sun for a soft blue moonlight with a dark-blue sky. The day
 * is biased longer than the night.
 *
 * Window-like materials register with `registerNightGlow` and get their
 * emissive intensity driven by how dark it is (`applyNight`).
 */

import * as THREE from 'three';
import { sunPosition, type VisualSettings } from './visualSettings';

type Glowy = THREE.Material & { emissiveIntensity: number };
const glowing: Array<{ m: Glowy; day: number; night: number }> = [];

/** Make a material's emissive intensity follow the night factor. */
export function registerNightGlow(m: THREE.Material, day: number, night: number): void {
  if ('emissiveIntensity' in m) glowing.push({ m: m as Glowy, day, night });
}

/** 0 = full day … 1 = full night. Updated by the scene each frame. */
let currentNight = 0;
export function nightFactor(): number {
  return currentNight;
}

/** Current light direction (normalised, toward the sun/moon). */
const sunDir = new THREE.Vector3(0.5, 0.75, 0.3).normalize();
export function getSunDir(): THREE.Vector3 {
  return sunDir;
}
export function setSunDir(p: THREE.Vector3): void {
  sunDir.copy(p).normalize();
}

/** Current time of day 0..1 (for UI read-outs). */
let skyClock = 0.5;
export function getSkyClock(): number {
  return skyClock;
}
export function setSkyClock(t: number): void {
  skyClock = t;
}

export function applyNight(n: number): void {
  currentNight = n;
  for (const g of glowing) g.m.emissiveIntensity = g.day + (g.night - g.day) * n;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Day/night length bias: >0 makes the day part of the cycle longer. */
const DAY_BIAS = 0.4;

const DUSK = new THREE.Color('#ffa968');
const MOON = new THREE.Color('#a9bcff');
const NIGHT_AMB = new THREE.Color('#40507e');
const NIGHT_SKY = new THREE.Color('#1a2440');
const DUSK_SKY = new THREE.Color('#e7b38d');
const NIGHT_GROUND = new THREE.Color('#2a3326');

export interface Sky {
  /** Light direction source: true = sun, false = moon. */
  sun: boolean;
  /** Quantised sky position parameter (changes ⇒ shadow map refresh). */
  step: number;
  pos: [number, number, number];
  lightColor: THREE.Color;
  lightIntensity: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  background: THREE.Color;
  night: number;
}

/** Sun-path steps per cycle (the shadow map refreshes once per step). */
const STEPS = 120;

export function skyAt(t: number, v: VisualSettings, out?: Sky): Sky {
  const theta = (t - 0.25) * Math.PI * 2;
  const sinE = (Math.sin(theta) + DAY_BIAS) / (1 + DAY_BIAS); // 1 at noon
  const day = smooth(-0.02, 0.3, sinE);
  const golden = sinE > -0.1 ? 1 - smooth(0.05, 0.45, sinE) : 0;
  const night = 1 - smooth(-0.08, 0.1, sinE);

  const o: Sky =
    out ??
    ({
      lightColor: new THREE.Color(),
      ambientColor: new THREE.Color(),
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      background: new THREE.Color(),
    } as Sky);

  const step = Math.round(t * STEPS) / STEPS;
  if (sinE > 0) {
    // Sun: rises east of the tuned azimuth, sets west of it, peaks at noon.
    const qT = step;
    const qSin = (Math.sin((qT - 0.25) * Math.PI * 2) + DAY_BIAS) / (1 + DAY_BIAS);
    const elev = Math.max(4, v.sunElevation * Math.max(0, qSin));
    const az = v.sunAzimuth + (qT - 0.5) * 220;
    o.sun = true;
    o.pos = sunPosition(az, elev);
    o.lightColor.set(v.sunColor).lerp(DUSK, golden * 0.85);
    o.lightIntensity = v.sunIntensity * smooth(0, 0.22, sinE);
  } else {
    o.sun = false;
    o.pos = sunPosition(v.sunAzimuth + 180, 55);
    o.lightColor.copy(MOON);
    o.lightIntensity = 0.55 * smooth(0, 0.25, -sinE);
  }
  o.step = o.sun ? step : -1;

  o.ambientColor.set(v.ambientColor).lerp(NIGHT_AMB, night).lerp(DUSK, golden * 0.25);
  o.ambientIntensity = v.ambientIntensity * (0.55 + 0.45 * day);
  o.hemiSky.set(v.hemiSky).lerp(NIGHT_SKY, night);
  o.hemiGround.set(v.hemiGround).lerp(NIGHT_GROUND, night);
  o.hemiIntensity = v.hemiIntensity * (0.6 + 0.4 * day);
  o.background.set(v.background).lerp(DUSK_SKY, golden * 0.7).lerp(NIGHT_SKY, night);
  o.night = night;
  return o;
}
