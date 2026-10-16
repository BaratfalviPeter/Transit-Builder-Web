/**
 * PathPreview — the translucent "hologram" of the planned road/rail route.
 *
 * Draws one glowing slab per cell of `previewPath`, laid onto the terrain (a
 * ramp cell gets a tilted slab), plus a thin bright centre strip showing the
 * route's direction and a beacon pillar on the start (A) and end (B) cells.
 *   - GREEN: the route reaches the cursor and is affordable → click to build.
 *   - RED:   blocked (only the possible part is shown) or not enough money.
 *
 * Everything is instanced (3 draw calls regardless of length), translucent and
 * `depthWrite=false`, and has no pointer handlers, so it never steals clicks
 * from the terrain underneath. A gentle opacity pulse makes it read as a
 * hologram; it only touches two material uniforms per frame.
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cellCornerHeights, CellType, type GridCell, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';

export const HOLO_GREEN = '#3ccf6a';
export const HOLO_RED = '#e5483b';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
/** Hover height of the slab above the ground, in cellSize units. */
const LIFT = 0.07;
const SLAB_H = 0.1;
/** Instance capacity (grown on demand). */
const MIN_CAP = 256;

export interface PathPreviewProps {
  path: GridCell[];
  red: boolean;
  map: TerrainMap;
  cellSize: number;
}

export function PathPreview({ path, red, map, cellSize }: PathPreviewProps) {
  const half = (map.size - 1) / 2;
  const cap = Math.max(MIN_CAP, 1 << Math.ceil(Math.log2(Math.max(1, path.length))));

  const slabGeo = useMemo(() => new THREE.BoxGeometry(0.96, SLAB_H, 0.96), []);
  const stripGeo = useMemo(() => new THREE.BoxGeometry(1, SLAB_H * 0.5, 0.18), []);
  const beaconGeo = useMemo(() => new THREE.CylinderGeometry(0.16, 0.16, 1.4, 10), []);

  const color = red ? HOLO_RED : HOLO_GREEN;
  const slabMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  slabMat.color.set(color);
  glowMat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.35);

  const slabs = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const beacons = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const s = slabs.current;
    const t = strips.current;
    const b = beacons.current;
    if (!s || !t || !b) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(cellSize, cellSize, cellSize);
    const scl = new THREE.Vector3();

    const tops: number[] = [];
    path.forEach(({ x, z }, i) => {
      const [h00, h10, h11, h01] = cellCornerHeights(map, x, z);
      const mean = (h00 + h10 + h11 + h01) / 4;
      // Tilt onto a ramp: slopeX rises along +x, slopeZ along +z.
      const riseX = (h10 + h11 - h00 - h01) / 2;
      const riseZ = (h01 + h11 - h00 - h10) / 2;
      // +Z rotation tips +x upward; −X rotation tips +z upward. A valid ramp
      // only rises along one axis, so the order doesn't matter.
      e.set(-Math.atan(riseZ), 0, Math.atan(riseX));
      q.setFromEuler(e);
      const top = (FLAT_TOP + mean + LIFT) * cellSize;
      tops.push(top);
      pos.set((x - half) * cellSize, top, (z - half) * cellSize);
      m.compose(pos, q, one);
      s.setMatrixAt(i, m);

      // Direction strip: along the segment to the next (or from the previous)
      // cell, so turns read as an L.
      const nb = path[i + 1] ?? path[i - 1];
      const alongX = nb ? nb.x !== x : true;
      const qs = q.clone().multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2),
      );
      pos.y = top + SLAB_H * 0.6 * cellSize;
      m.compose(pos, qs, one);
      t.setMatrixAt(i, m);
    });
    s.count = path.length;
    t.count = path.length;

    // Beacons on A and B.
    const ends = path.length > 1 ? [0, path.length - 1] : path.length === 1 ? [0] : [];
    ends.forEach((idx, k) => {
      const c = path[idx];
      scl.set(cellSize, cellSize, cellSize);
      pos.set((c.x - half) * cellSize, tops[idx] + 0.7 * cellSize, (c.z - half) * cellSize);
      m.compose(pos, new THREE.Quaternion(), scl);
      b.setMatrixAt(k, m);
    });
    b.count = ends.length;

    for (const im of [s, t, b]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }, [path, map, cellSize, half, cap]);

  // Hologram pulse.
  useFrame(({ clock }) => {
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
    slabMat.opacity = 0.3 + 0.14 * k;
    glowMat.opacity = 0.7 + 0.25 * k;
  });

  if (path.length === 0) return null;
  return (
    <group renderOrder={10}>
      <instancedMesh
        key={`s${cap}`}
        ref={slabs}
        args={[slabGeo, slabMat, cap]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={10}
      />
      <instancedMesh
        key={`t${cap}`}
        ref={strips}
        args={[stripGeo, glowMat, cap]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={11}
      />
      <instancedMesh
        ref={beacons}
        args={[beaconGeo, glowMat, 2]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={11}
      />
    </group>
  );
}
