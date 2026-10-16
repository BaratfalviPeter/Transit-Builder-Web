/**
 * Rails — renders the player's rail network from its track PIECES
 * (see sim/railPieces.ts and railGeometry.ts).
 *
 * Every piece becomes a smooth centre-line (joint tangents shared with the
 * neighbouring pieces), along which we sweep:
 *   - a raised gravel ballast bed (tapered sides),
 *   - wooden sleepers at an even pitch,
 *   - two raised steel rails.
 * Heights follow the terrain bilinearly, so ramps need no special case.
 * Switches get a yellow lever stand, level crossings (rail across a road) get
 * their rails set into the asphalt plus red/white barrier posts.
 *
 * The whole network is a handful of merged meshes (few draw calls); it only
 * rebuilds when cell types / rails change (memoized on cellsVersion).
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CellType, railBitsAt, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchRef } from './cloudShadows';
import { buildTrack, toGeometry } from './railGeometry';

export interface RailsProps {
  map: TerrainMap;
  cellSize: number;
}

const GRAVEL_COLOR = CELL_STYLE[CellType.Rail].color;
const SLEEPER_COLOR = '#5a3f27';
const RAIL_COLOR = '#a3a9b0';

export function Rails({ map, cellSize }: RailsProps) {
  const geo = useMemo(() => {
    const t = buildTrack(map, cellSize, (x, z) => railBitsAt(map, x, z));
    return {
      ballast: toGeometry(t.ballast),
      sleepers: toGeometry(t.sleepers),
      rails: toGeometry(t.rails),
      levers: t.levers,
      barriers: t.barriers,
    };
  }, [map, cellSize]);

  // Free GPU buffers of the previous network on rebuild / unmount.
  useLayoutEffect(
    () => () => {
      geo.ballast?.dispose();
      geo.sleepers?.dispose();
      geo.rails?.dispose();
    },
    [geo],
  );

  if (!geo.rails) return null;
  return (
    <group>
      {geo.ballast && (
        <mesh geometry={geo.ballast} castShadow receiveShadow>
          <meshStandardMaterial ref={patchRef} color={GRAVEL_COLOR} roughness={1} />
        </mesh>
      )}
      {geo.sleepers && (
        <mesh geometry={geo.sleepers} castShadow receiveShadow>
          <meshStandardMaterial ref={patchRef} color={SLEEPER_COLOR} roughness={0.9} />
        </mesh>
      )}
      <mesh geometry={geo.rails} castShadow>
        <meshStandardMaterial ref={patchRef} color={RAIL_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      {geo.levers.length > 0 && <SwitchLevers positions={geo.levers} cellSize={cellSize} />}
      {geo.barriers.length > 0 && <Barriers posts={geo.barriers} cellSize={cellSize} />}
    </group>
  );
}

/** Small yellow switch-stand lever beside each turnout, instanced. */
function SwitchLevers({ positions, cellSize }: { positions: Array<[number, number, number]>; cellSize: number }) {
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const leverRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const set = (mesh: THREE.InstancedMesh | null, f: (i: number, p: [number, number, number]) => void) => {
      if (!mesh) return;
      positions.forEach((p, i) => {
        f(i, p);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    set(baseRef.current, (_, [x, y, z]) => {
      d.position.set(x, y + 0.03 * cellSize, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.08 * cellSize, 0.06 * cellSize, 0.08 * cellSize);
    });
    set(leverRef.current, (_, [x, y, z]) => {
      d.position.set(x, y + 0.13 * cellSize, z);
      d.rotation.set(0, 0, Math.PI / 5);
      d.scale.set(0.024 * cellSize, 0.16 * cellSize, 0.024 * cellSize);
    });
  }, [positions, cellSize]);
  return (
    <group>
      <instancedMesh key={`b${positions.length}`} ref={baseRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#2d2f34" roughness={0.6} metalness={0.3} />
      </instancedMesh>
      <instancedMesh key={`l${positions.length}`} ref={leverRef} args={[undefined, undefined, positions.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#e8b82e" roughness={0.5} />
      </instancedMesh>
    </group>
  );
}

/**
 * Level-crossing barriers: a white post with a raised red/white boom, two per
 * crossing (diagonally opposite corners), instanced.
 */
function Barriers({ posts, cellSize }: { posts: Array<[number, number, number, number]>; cellSize: number }) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const boomRef = useRef<THREE.InstancedMesh>(null);
  const tipRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const c = cellSize;
    const each = (mesh: THREE.InstancedMesh | null, f: (p: [number, number, number, number]) => void) => {
      if (!mesh) return;
      posts.forEach((p, i) => {
        f(p);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    each(postRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.14 * c, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.06 * c, 0.28 * c, 0.06 * c);
    });
    // Booms are raised (open): nearly upright, leaning slightly over the road.
    each(boomRef.current, ([x, y, z, yaw]) => {
      d.position.set(x, y + 0.52 * c, z);
      d.rotation.set(0, yaw, 0);
      d.rotateZ(-0.18);
      d.scale.set(0.03 * c, 0.5 * c, 0.03 * c);
    });
    each(tipRef.current, ([x, y, z]) => {
      d.position.set(x, y + 0.3 * c, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.09 * c, 0.05 * c, 0.09 * c);
    });
  }, [posts, cellSize]);
  const n = posts.length;
  return (
    <group>
      <instancedMesh key={`p${n}`} ref={postRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#f2f0ea" roughness={0.6} />
      </instancedMesh>
      <instancedMesh key={`b${n}`} ref={boomRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#d8342c" roughness={0.5} />
      </instancedMesh>
      <instancedMesh key={`t${n}`} ref={tipRef} args={[undefined, undefined, n]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={patchRef} color="#d8342c" roughness={0.5} emissive="#5a0b08" />
      </instancedMesh>
    </group>
  );
}
