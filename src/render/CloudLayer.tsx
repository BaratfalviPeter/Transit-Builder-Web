/**
 * Clouds — slowly drifting low-poly clouds high above the map.
 *
 * Each cloud is 3–5 overlapping white icosahedrons (detail 0/1) for a chunky,
 * faceted look. Clouds never pop in/out or hit an invisible wall:
 *   - Life cycle: every cloud slowly GROWS from nothing, lives a while, then
 *     SHRINKS away; when it has vanished it respawns somewhere else.
 *   - Edges: near the edge of the drift area clouds smoothly shrink to zero,
 *     so wrapping around to the other side is invisible.
 *   - Puffs individually "breathe" (slow ±scale), so shapes keep morphing.
 * Clouds cast shadows (toggle in the tuner) but receive none, and have no
 * pointer handlers, so they never block clicks on the terrain.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVisualKeys } from './visualSettings';

export interface CloudsProps {
  /** Half-width of the area the clouds drift within (world units). */
  extent: number;
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

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

interface Puff {
  p: [number, number, number];
  r: number;
  g: number;
  breathe: number;
  breathePhase: number;
}
interface CloudDef {
  y: number;
  speed: number;
  /** Life cycle length (s) and start offset (0..1). */
  life: number;
  life0: number;
  puffs: Puff[];
}
/** Mutable per-cloud runtime state (position + respawn counter). */
interface CloudRun {
  x: number;
  z: number;
  lastCycle: number;
  spawns: number;
}

export function Clouds({ extent, seed = 7 }: CloudsProps) {
  const vis = useVisualKeys([
    'cloudsVisible',
    'cloudColor',
    'cloudGlow',
    'cloudCount',
    'cloudSpeed',
    'cloudShadows',
  ] as const);
  CLOUD_MAT.color.set(vis.cloudColor);
  CLOUD_MAT.emissive.set(vis.cloudColor);
  CLOUD_MAT.emissiveIntensity = vis.cloudGlow;
  const count = Math.round(vis.cloudCount);

  const clouds = useMemo<CloudDef[]>(() => {
    const out: CloudDef[] = [];
    let k = 0;
    const r = () => rand(seed, k++);
    for (let i = 0; i < count; i++) {
      const n = 3 + Math.floor(r() * 3); // 3–5 puffs
      const size = 1.6 + r() * 1.6;
      const puffs: Puff[] = [];
      for (let j = 0; j < n; j++) {
        const t = j / (n - 1) - 0.5;
        puffs.push({
          p: [t * size * 2.6, (r() - 0.3) * size * 0.4, (r() - 0.5) * size * 0.9],
          r: size * (1 - Math.abs(t) * 0.9) * (0.8 + r() * 0.35),
          g: r() < 0.5 ? 0 : 1,
          breathe: 0.25 + r() * 0.35,
          breathePhase: r() * Math.PI * 2,
        });
      }
      out.push({
        y: 15 + r() * 5,
        speed: 0.75 + r() * 0.5,
        life: 45 + r() * 50,
        life0: r(),
        puffs,
      });
    }
    return out;
  }, [count, seed]);

  // Runtime positions (kept across re-renders of the same cloud set).
  const run = useMemo<CloudRun[]>(
    () =>
      clouds.map((_, i) => ({
        x: -extent + ((i + rand(seed + 1, i) * 0.6) / Math.max(1, clouds.length)) * extent * 2,
        z: (rand(seed + 2, i) * 2 - 1) * extent * 0.85,
        lastCycle: -1,
        spawns: 0,
      })),
    [clouds, extent, seed],
  );

  const groups = useRef<Array<THREE.Group | null>>([]);
  const puffRefs = useRef<Array<Array<THREE.Mesh | null>>>([]);
  const speedRef = useRef(vis.cloudSpeed);
  speedRef.current = vis.cloudSpeed;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1); // no big jumps after a tab switch
    const t = state.clock.getElapsedTime();
    for (let i = 0; i < clouds.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const c = clouds[i];
      const s = run[i];

      // Life cycle: 0 → grow → live → shrink → 0, then respawn elsewhere.
      const lt = t / c.life + c.life0;
      const cycle = Math.floor(lt);
      const u = lt - cycle;
      if (s.lastCycle !== -1 && cycle !== s.lastCycle) {
        s.spawns++;
        s.x = (rand(seed + 3 + i, s.spawns) * 2 - 1) * extent * 0.8;
        s.z = (rand(seed + 4 + i, s.spawns) * 2 - 1) * extent * 0.85;
      }
      s.lastCycle = cycle;
      const life = smooth(u / 0.25) * smooth((1 - u) / 0.25);

      // Drift + smooth shrink near the drift-area edges (invisible wrap).
      s.x += c.speed * speedRef.current * dt;
      if (s.x > extent) s.x -= extent * 2;
      const edge = smooth((extent - Math.abs(s.x)) / (extent * 0.25));

      const k = life * edge;
      g.position.set(s.x, c.y, s.z);
      g.scale.setScalar(Math.max(k, 0.0001));
      g.visible = k > 0.002;

      // Puffs slowly breathe so the silhouette keeps morphing.
      const pr = puffRefs.current[i];
      if (pr) {
        for (let j = 0; j < c.puffs.length; j++) {
          const m = pr[j];
          if (!m) continue;
          const p = c.puffs[j];
          const b = 1 + 0.15 * Math.sin(t * p.breathe + p.breathePhase);
          m.scale.set(p.r * b, p.r * 0.8 * b, p.r * b);
        }
      }
    }
  });

  if (!vis.cloudsVisible) return null;
  return (
    <group>
      {clouds.map((c, i) => (
        <group
          key={i}
          ref={(el) => {
            groups.current[i] = el;
          }}
          scale={0.0001}
        >
          {c.puffs.map((p, j) => (
            <mesh
              key={j}
              ref={(el) => {
                (puffRefs.current[i] ??= [])[j] = el;
              }}
              geometry={PUFF_GEOMS[p.g]}
              material={CLOUD_MAT}
              position={p.p}
              scale={[p.r, p.r * 0.8, p.r]}
              rotation={[j * 0.7, j * 1.3, 0]}
              castShadow={vis.cloudShadows}
            />
          ))}
        </group>
      ))}
    </group>
  );
}
