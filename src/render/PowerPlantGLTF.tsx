/**
 * PowerPlantGLTF — loads the uploaded power-plant model from
 * `public/models/Untitled.glb` and places it on a cell.
 *
 * The raw model is ~60×60 units across, so we auto-fit it: measure its bounding
 * box once, scale it to a target footprint (a few cells wide), and lift it so
 * its base rests exactly on the given surface Y. Each placement clones the
 * loaded scene so multiple plants don't share/transform the same object.
 *
 * This is the swappable model loader the project planned for: to change the
 * asset, drop a new file in public/models and update MODEL_URL.
 */

import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Served from the public/ root at runtime. */
const MODEL_URL = '/models/Untitled.glb';

/** Target footprint of the plant, in world units (~ a few cells wide). */
const TARGET_FOOTPRINT = 4.5;

export interface PowerPlantGLTFProps {
  /** Cell surface position [x, surfaceTopY, z]. */
  position: [number, number, number];
  rotation?: [number, number, number];
}

export function PowerPlantGLTF({ position, rotation = [0, 0, 0] }: PowerPlantGLTFProps) {
  const { scene } = useGLTF(MODEL_URL);

  // Clone the scene per instance and compute an auto-fit transform once.
  // SkeletonUtils.clone correctly handles skinned/animated models (a plain
  // Object3D.clone can break skeleton bindings on such a model).
  const { object, scale, yLift } = useMemo(() => {
    const obj = skeletonClone(scene);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Scale so the larger horizontal dimension matches the target footprint.
    const footprint = Math.max(size.x, size.z) || 1;
    const s = TARGET_FOOTPRINT / footprint;
    // After scaling, lift so the model's lowest point sits at y=0 (the cell
    // surface); box.min.y is in model units, so multiply by the scale.
    const lift = -box.min.y * s;
    return { object: obj, scale: s, yLift: lift };
  }, [scene]);

  const [x, y, z] = position;

  return (
    <group position={[x, y + yLift, z]} rotation={rotation} scale={scale}>
      <primitive object={object} />
    </group>
  );
}

// Preload so the model is ready before the first power plant renders.
useGLTF.preload(MODEL_URL);
