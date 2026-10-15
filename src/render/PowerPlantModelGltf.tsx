/*
 * PowerPlantModelGltf — static R3F component for the uploaded power-plant glb,
 * generated with gltfjsx (every mesh is an explicit <mesh geometry material>)
 * and then adapted:
 *   - loads from the correct public path (/models/Untitled.glb),
 *   - renders ONLY the power-plant itself (the model's own Terrain / Road /
 *     Trees are omitted — the game has its own ground),
 *   - plays the 22 "Puff" smoke animations via useAnimations,
 *   - auto-fits: measured once, scaled to a target footprint and lifted so its
 *     base rests on the cell surface.
 *
 * Using explicit nodes/materials (instead of cloning the scene graph) avoids
 * the runtime issue that was blanking the plant and triggering the fallback.
 */

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import type { GLTF } from 'three-stdlib';

const MODEL_URL = '/models/Untitled.glb';
/** Target footprint (world units) for the plant on the map. */
const TARGET_FOOTPRINT = 5;

type GLTFResult = GLTF & {
  nodes: Record<string, THREE.Mesh>;
  materials: Record<string, THREE.MeshStandardMaterial>;
};

export interface PowerPlantModelGltfProps {
  /** Cell surface position [x, surfaceTopY, z]. */
  position: [number, number, number];
  rotation?: [number, number, number];
}

export function PowerPlantModelGltf({
  position,
  rotation = [0, 0, 0],
}: PowerPlantModelGltfProps) {
  const group = useRef<THREE.Group>(null);
  const { nodes, materials, animations } = useGLTF(MODEL_URL) as GLTFResult;
  const { actions } = useAnimations(animations, group);

  // Play all smoke animations in a loop.
  useEffect(() => {
    Object.values(actions).forEach((a) => a?.reset().play());
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [actions]);

  // Auto-fit: measure the plant's own meshes (not the omitted terrain/road/
  // trees) to compute a uniform scale + base lift. Computed once.
  const { scale, yLift } = useMemo(() => {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const key of PLANT_MESHES) {
      const m = nodes[key];
      if (!m?.geometry) continue;
      m.geometry.computeBoundingBox();
      if (m.geometry.boundingBox) {
        tmp.copy(m.geometry.boundingBox);
        box.union(tmp);
      }
    }
    const size = new THREE.Vector3();
    box.getSize(size);
    const footprint = Math.max(size.x, size.z) || 1;
    const s = TARGET_FOOTPRINT / footprint;
    const lift = -box.min.y * s;
    return { scale: s, yLift: lift };
  }, [nodes]);

  const [x, y, z] = position;

  return (
    <group
      ref={group}
      position={[x, y + yLift, z]}
      rotation={rotation}
      scale={scale}
      dispose={null}
    >
      {/* Smoke puffs (animated). */}
      {SMOKE_MESHES.map((key) => {
        const m = nodes[key];
        if (!m) return null;
        return (
          <mesh
            key={key}
            name={key}
            geometry={m.geometry}
            material={materials.PP_smoke}
            position={m.position}
            rotation={m.rotation}
            scale={m.scale}
          />
        );
      })}

      {/* Static plant meshes (building, boiler, chimney, towers, pipes…). */}
      {PLANT_MESHES.map((key) => {
        const m = nodes[key];
        if (!m) return null;
        return (
          <mesh
            key={key}
            name={key}
            geometry={m.geometry}
            material={m.material as THREE.Material}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}

/** Animated smoke puff meshes. */
const SMOKE_MESHES = Array.from({ length: 22 }, (_, i) => `Puff_${i}`);

/** The static power-plant meshes (everything except smoke/terrain/road/trees). */
const PLANT_MESHES = [
  'Boiler_1', 'Boiler_2', 'Boiler_3', 'Boiler_4', 'Boiler_5', 'Boiler_6',
  'Building_1', 'Building_2', 'Building_3', 'Building_4', 'Building_5',
  'Building_6', 'Building_7', 'Building_8', 'Building_9',
  'Chimney_1', 'Chimney_2', 'Chimney_3',
  'CoolingTowers_1', 'CoolingTowers_2',
  'Pipe_A', 'Pipe_B', 'Pipe_C', 'Pipe_D', 'Pipe_U',
  'Platform_1', 'Platform_2',
  'Props_1', 'Props_2', 'Props_3', 'Props_4',
];

useGLTF.preload(MODEL_URL);
