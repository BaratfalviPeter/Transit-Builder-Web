/**
 * Low-poly part lists → merged geometry, for the vehicle and building models
 * (trucks, trains, the depot). A model is a list of simple parts (boxes,
 * cylinders, rocks); `buildParts` merges them into ONE geometry per material
 * slot, so a whole vehicle is a handful of draw calls:
 *
 *   - parts with a fixed colour ('#rrggbb') all go into the vertex-coloured
 *     'fixed' slot (drawn with FIXED_MAT);
 *   - parts with a named slot ('paint', 'tarp', 'stripe', 'load', …) get
 *     their own merged geometry, so the caller can colour them per instance.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

export interface Part {
  /** A fixed colour ('#rrggbb') or a slot name the caller colours. */
  mat: string;
  /**
   * cylX / cylY / cylZ: a cylinder along that axis; rock: a lumpy ball;
   * ball: a sphere (size = radii); custom: `geo` (scaled by size).
   */
  shape: 'box' | 'cylX' | 'cylY' | 'cylZ' | 'rock' | 'ball' | 'custom';
  pos: V3;
  /** Box: full size; cylinder: [radius, length, radius] (before the axis turn); rock: radii. */
  size: V3;
  /** Extra rotation (radians, XYZ), applied before the position. */
  rot?: V3;
  /** Cylinder / ball segments (default 10). */
  seg?: number;
  /** The geometry of a 'custom' part (cloned). */
  geo?: THREE.BufferGeometry;
}

export const box = (mat: string, pos: V3, size: V3, rot?: V3): Part => ({ mat, shape: 'box', pos, size, rot });
export const ball = (mat: string, pos: V3, radii: V3, seg = 10): Part => ({ mat, shape: 'ball', pos, size: radii, seg });

/**
 * A prism from a 2-D profile in the XY plane (e.g. a car's side view),
 * `depth` deep along Z, centred on z = 0.
 */
export function profile(mat: string, pts: Array<[number, number]>, depth: number, pos: V3 = [0, 0, 0], rot?: V3): Part {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  return { mat, shape: 'custom', pos, size: [1, 1, 1], geo, rot };
}

export const cyl = (mat: string, axis: 'x' | 'y' | 'z', pos: V3, r: number, len: number, seg = 10, rot?: V3): Part => ({
  mat,
  shape: axis === 'x' ? 'cylX' : axis === 'y' ? 'cylY' : 'cylZ',
  pos,
  size: [r, len, r],
  seg,
  rot,
});

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLS = new Map<number, THREE.CylinderGeometry>();
const ROCK = new THREE.IcosahedronGeometry(1, 0);

function partGeometry(p: Part): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.shape === 'box') g = BOX.clone();
  else if (p.shape === 'rock') g = ROCK.clone();
  else if (p.shape === 'custom') g = p.geo!.clone();
  else if (p.shape === 'ball') g = new THREE.SphereGeometry(1, p.seg ?? 10, Math.max(4, Math.round((p.seg ?? 10) / 2)));
  else {
    const seg = p.seg ?? 10;
    let c = CYLS.get(seg);
    if (!c) CYLS.set(seg, (c = new THREE.CylinderGeometry(1, 1, 1, seg)));
    g = c.clone();
  }
  const [sx, sy, sz] = p.size;
  const m = new THREE.Matrix4().makeScale(sx, sy, sz);
  if (p.shape === 'cylZ') m.premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  else if (p.shape === 'cylX') m.premultiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  if (p.rot) m.premultiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rot)));
  m.premultiply(new THREE.Matrix4().makeTranslation(...p.pos));
  g.applyMatrix4(m);
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  out.computeVertexNormals();
  return out;
}

/** Merged geometry per material slot ('fixed' = the vertex-coloured parts). */
export function buildParts(parts: Part[]): Record<string, THREE.BufferGeometry> {
  const slots: Record<string, THREE.BufferGeometry[]> = {};
  const c = new THREE.Color();
  for (const p of parts) {
    const g = partGeometry(p);
    let slot = p.mat;
    if (p.mat.startsWith('#')) {
      slot = 'fixed';
      c.set(p.mat);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(col, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    (slots[slot] ??= []).push(g);
  }
  const out: Record<string, THREE.BufferGeometry> = {};
  for (const [k, gs] of Object.entries(slots)) {
    out[k] = mergeGeometries(gs, false)!;
    gs.forEach((g) => g.dispose());
  }
  return out;
}

/** Material of the fixed-colour parts. */
export const FIXED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.1 });

const paints = new Map<string, THREE.MeshStandardMaterial>();
/** A shared plain material per colour (+ roughness). */
export function paintMat(color: string, roughness = 0.55): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = paints.get(key);
  if (!m) paints.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness })));
  return m;
}
