/**
 * Oil pipelines (see sim/pipes.ts): the pipe itself is under water / under
 * ground, so only its markers show — orange buoys on the water, short yellow
 * marker posts on land (every other cell), and a faint dark strip along the
 * route. Plus the pipe tool's preview (an L from the start to the cursor).
 */

import { Html } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CellType, pipeCellOk, pipeCost, pipePath, type TerrainMap } from '../sim';
import { groundAtGrid } from './railGeometry';
import { WATER_LEVEL } from './TerrainSurface';
import { patchCloudShadows } from './cloudShadows';
import './stations.css';

const BUOY = new THREE.MeshStandardMaterial({ color: '#e8762b', roughness: 0.6 });
const POST = new THREE.MeshStandardMaterial({ color: '#e8c21e', roughness: 0.6 });
const STRIP = new THREE.MeshBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.28, depthWrite: false });
patchCloudShadows(BUOY);
patchCloudShadows(POST);
const BUOY_GEO = new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8);
const POST_GEO = new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6);
const STRIP_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

interface Spot {
  x: number;
  z: number;
  y: number;
  water: boolean;
}

export function Pipes({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const half = (map.size - 1) / 2;
  const spots = useMemo<Spot[]>(() => {
    const n = map.size;
    return (map.pipes ?? []).map((k) => {
      const x = Math.floor(k / n), z = k % n;
      const water = map.cells[x][z] === CellType.Water;
      return { x, z, water, y: water ? WATER_LEVEL : groundAtGrid(map, x, z) };
    });
  }, [map]);
  const buoys = spots.filter((s) => s.water && (s.x + s.z) % 2 === 0);
  const posts = spots.filter((s) => !s.water && (s.x + s.z) % 2 === 0);
  const buoyRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const stripRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const put = (im: THREE.InstancedMesh | null, list: Spot[], lift: number, scale: [number, number, number]) => {
      if (!im) return;
      list.forEach((s, i) => {
        m.compose(
          new THREE.Vector3((s.x - half) * cellSize, (s.y + lift) * cellSize, (s.z - half) * cellSize),
          new THREE.Quaternion(),
          new THREE.Vector3(scale[0] * cellSize, scale[1] * cellSize, scale[2] * cellSize),
        );
        im.setMatrixAt(i, m);
      });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    };
    put(postRef.current, posts, 0.11, [1, 1, 1]);
    put(stripRef.current, spots, 0.015, [0.34, 1, 0.34]);
  }, [spots, posts, half, cellSize]);
  // Buoys bob gently on the water.
  useFrame((state) => {
    const im = buoyRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const t = state.clock.getElapsedTime();
    buoys.forEach((s, i) => {
      const bob = Math.sin(t * 1.6 + s.x * 0.7 + s.z * 1.3) * 0.015;
      m.makeTranslation((s.x - half) * cellSize, (s.y + 0.03 + bob) * cellSize, (s.z - half) * cellSize);
      m.scale(new THREE.Vector3(cellSize, cellSize, cellSize));
      im.setMatrixAt(i, m);
    });
    im.count = buoys.length;
    im.instanceMatrix.needsUpdate = true;
  });
  if (!spots.length) return null;
  return (
    <group>
      <instancedMesh ref={buoyRef} args={[BUOY_GEO, BUOY, Math.max(1, buoys.length)]} castShadow frustumCulled={false} />
      <instancedMesh ref={postRef} args={[POST_GEO, POST, Math.max(1, posts.length)]} castShadow />
      <instancedMesh ref={stripRef} args={[STRIP_GEO, STRIP, Math.max(1, spots.length)]} renderOrder={2} />
    </group>
  );
}

/** The pipe tool's preview: the start, and an L of cells from it to the cursor. */
export function PipePreview({
  map,
  cellSize,
  start,
  end,
  money,
}: {
  map: TerrainMap;
  cellSize: number;
  start: [number, number] | null;
  end: [number, number] | null;
  money: number;
}) {
  const half = (map.size - 1) / 2;
  if (!end) return null;
  const path = start ? pipePath(start, end) : [end];
  const cost = start ? pipeCost(map, path) : 0;
  const yOf = (x: number, z: number) => (map.cells[x]?.[z] === CellType.Water ? WATER_LEVEL : groundAtGrid(map, x, z));
  const [ex, ez] = end;
  const ok = cost <= money;
  return (
    <group>
      {path.map(([x, z]) => {
        if (x < 0 || z < 0 || x >= map.size || z >= map.size) return null;
        const good = pipeCellOk(map, x, z) && ok;
        return (
          <mesh key={`${x},${z}`} position={[(x - half) * cellSize, (yOf(x, z) + 0.05) * cellSize, (z - half) * cellSize]}>
            <boxGeometry args={[cellSize * 0.4, cellSize * 0.05, cellSize * 0.4]} />
            <meshBasicMaterial color={good ? '#e8762b' : '#f87171'} transparent opacity={0.75} depthWrite={false} />
          </mesh>
        );
      })}
      {ex >= 0 && ez >= 0 && ex < map.size && ez < map.size && (
        <Html zIndexRange={[10, 0]} position={[(ex - half) * cellSize, (yOf(ex, ez) + 0.8) * cellSize, (ez - half) * cellSize]} center style={{ pointerEvents: 'none' }}>
          <div className={'station-tip' + (ok ? '' : ' is-bad')}>
            {start ? `〰️ Olajvezeték · $${cost}${ok ? '' : ' — nincs elég pénz'} · Esc: vége` : '〰️ Kattints a kezdőpontra (a fúró mellett)'}
          </div>
        </Html>
      )}
    </group>
  );
}
