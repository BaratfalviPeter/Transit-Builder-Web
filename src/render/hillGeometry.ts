/**
 * Builds a reusable low-poly "hill" geometry — a trapezoidal frustum like the
 * gentle slopes in OpenTTD. A wide square base sits on the ground; a smaller
 * square top is raised to the hill height; the four sides ramp outward/down so
 * the hill reads as a climbable slope rather than a vertical block.
 *
 * The geometry is built in a unit footprint: base spans [-0.5, 0.5] in X/Z,
 * top is inset by `topInset`, and the top sits at `height`. The renderer scales
 * X/Z by cellSize and Y is already in world units (height * cellSize passed in).
 *
 * Returns a non-indexed BufferGeometry with flat-shaded normals, so each facet
 * gets crisp low-poly lighting.
 */

import * as THREE from 'three';

export interface HillGeometryOptions {
  /** Hill top height in world units. */
  height: number;
  /** How far the top square is inset from the base edge (0..0.5). */
  topInset?: number;
  /** Full base width in world units (e.g. cellSize). */
  baseWidth: number;
}

export function createHillGeometry({
  height,
  topInset = 0.28,
  baseWidth,
}: HillGeometryOptions): THREE.BufferGeometry {
  const hb = baseWidth / 2; // half base
  const ht = hb - topInset * baseWidth; // half top (inset)

  // 8 corners: 4 base (y=0), 4 top (y=height).
  // Base corners (CCW seen from above): b0..b3
  const b0 = new THREE.Vector3(-hb, 0, -hb);
  const b1 = new THREE.Vector3(hb, 0, -hb);
  const b2 = new THREE.Vector3(hb, 0, hb);
  const b3 = new THREE.Vector3(-hb, 0, hb);
  // Top corners
  const t0 = new THREE.Vector3(-ht, height, -ht);
  const t1 = new THREE.Vector3(ht, height, -ht);
  const t2 = new THREE.Vector3(ht, height, ht);
  const t3 = new THREE.Vector3(-ht, height, ht);

  const positions: number[] = [];

  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    // Two triangles (a,b,c) and (a,c,d), CCW for outward-facing normals.
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };

  // Flat top (facing up).
  quad(t0, t1, t2, t3);
  // Four sloped sides (base edge -> top edge), wound so normals face outward.
  quad(b0, b1, t1, t0); // -Z side
  quad(b1, b2, t2, t1); // +X side
  quad(b2, b3, t3, t2); // +Z side
  quad(b3, b0, t0, t3); // -X side

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geom.computeVertexNormals();
  return geom;
}
