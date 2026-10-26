/**
 * Performance readout for the Dev tab: frames per second, draw calls and
 * triangles of the map view. <PerfProbe> (inside the Canvas) samples the
 * renderer twice a second; usePerf() reads the latest sample.
 */

import { useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

export interface PerfSample {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
}

let sample: PerfSample = { fps: 0, calls: 0, triangles: 0, geometries: 0 };
const listeners = new Set<() => void>();

export function usePerf(): PerfSample {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sample,
  );
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ t: 0, frames: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt;
    a.frames++;
    if (a.t < 0.5) return;
    // gl.info.render holds the PREVIOUS frame's numbers here (reset per frame).
    sample = {
      fps: Math.round(a.frames / a.t),
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
    };
    a.t = 0;
    a.frames = 0;
    for (const l of listeners) l();
  });
  return null;
}
