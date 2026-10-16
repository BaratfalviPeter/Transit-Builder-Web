/**
 * Clouds — slowly drifting low-poly clouds high above the map.
 *
 * Each cloud is 3–5 overlapping white icosahedrons (detail 0/1) for a chunky,
 * faceted look. They drift along +X; once a cloud leaves the map area it wraps
 * around to the other side. Clouds cast shadows onto the map (they sit inside
 * the sun's shadow frustum) but don't receive any, and have no pointer
 * handlers, so they never block clicks on the terrain.
 *
 * Layout is deterministic (seeded hash), so clouds don't jump on re-render.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface CloudsProps {
  /** Half-width of the area the clouds wrap within (world units). */
  extent: number;
  /** Number of clouds (5–10 looks good). */
  count?: number;
  /** Drift speed in world units per second. */
  speed?: number;
  seed?: number;
}

const PUFF_GEOMS = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1)];
const CLOUD_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  flatShading: true,
  emissive: '#ffffff',
  emissiveIntensity: 0.25, // keep the shadowed undersides bright & fluffy
});

function rand(seed: number, i: number): number {
  let h = (seed * 2246822519 + i * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface CloudDef {
  x: number;
  y: number;
  z: number;
  speed: number;
  puffs: Array<{ p: [number, number, number]; r: number; g: number }>;
}

export function Clouds({ extent, count = 8, speed = 0.8, seed = 7 }: CloudsProps) {
  const clouds = useMemo<CloudDef[]>(() => {
    const out: CloudDef[] = [];
    let k = 0;
    const r = () => rand(seed, k++);
    for (let i = 0; i < count; i++) {
      const n = 3 + Math.floor(r() * 3); // 3–5 puffs
      const size = 1.6 + r() * 1.6;
      const puffs: CloudDef['puffs'] = [];
      for (let j = 0; j < n; j++) {
        // Puffs along a line, biggest in the middle, overlapping.
        const t = n === 1 ? 0 : j / (n - 1) - 0.5;
        const pr = size * (1 - Math.abs(t) * 0.9) * (0.8 + r() * 0.35);
        puffs.push({
          p: [t * size * 2.6, (r() - 0.3) * size * 0.4, (r() - 0.5) * size * 0.9],
          r: pr,
          g: r() < 0.5 ? 0 : 1,
        });
      }
      out.push({
        // Spread evenly along the drift axis, randomly across it.
        x: -extent + ((i + r() * 0.6) / count) * extent * 2,
        y: 15 + r() * 5,
        z: (r() * 2 - 1) * extent * 0.85,
        speed: speed * (0.75 + r() * 0.5),
        puffs,
      });
    }
    return out;
  }, [extent, count, speed, seed]);

  const refs = useRef<Array<THREE.Group | null>>([]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1); // no big jumps after a tab switch
    for (let i = 0; i < clouds.length; i++) {
      const g = refs.current[i];
      if (!g) continue;
      g.position.x += clouds[i].speed * dt;
      if (g.position.x > extent) g.position.x -= extent * 2;
    }
  });

  return (
    <group>
      {clouds.map((c, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[c.x, c.y, c.z]}
        >
          {c.puffs.map((p, j) => (
            <mesh
              key={j}
              geometry={PUFF_GEOMS[p.g]}
              material={CLOUD_MAT}
              position={p.p}
              scale={[p.r, p.r * 0.8, p.r]}
              rotation={[j * 0.7, j * 1.3, 0]}
              castShadow
            />
          ))}
        </group>
      ))}
    </group>
  );
}
