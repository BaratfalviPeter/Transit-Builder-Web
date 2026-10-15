/**
 * BuildingModel — the single, swappable visual representation of a placed
 * object. Today it renders a placeholder box; later it will load a real model
 * from `public/models/` (.obj / .glb).
 *
 * The rest of the app renders buildings exclusively through this component, so
 * swapping placeholders for real assets is a localized change here. When model
 * files are added, implement a loader (e.g. drei's `useGLTF` / `useLoader` with
 * OBJLoader) keyed by `PlaceableKind` and return the loaded geometry instead of
 * the <boxGeometry> below. Keep the same props and the same unit footprint
 * (roughly one cell wide) so no caller needs to change.
 *
 * Example of the intended future shape (left as a reference, not active):
 *
 *   const MODEL_URL: Record<PlaceableKind, string | null> = {
 *     house: '/models/house.glb',
 *   };
 *   // const gltf = useGLTF(MODEL_URL[kind]!);
 *   // return <primitive object={gltf.scene.clone()} ... />;
 */

import type { PlaceableKind } from '../sim';

export interface BuildingModelProps {
  kind: PlaceableKind;
  /** World-space position of the cell center [x, y, z]. */
  position: [number, number, number];
  /** Cell size in meters; used to scale the placeholder to the grid. */
  cellSize: number;
}

const KIND_COLOR: Record<PlaceableKind, string> = {
  house: '#d98a5f',
};

export function BuildingModel({ kind, position, cellSize }: BuildingModelProps) {
  // Placeholder footprint: ~80% of a cell, height a bit taller than wide.
  const w = cellSize * 0.8;
  const h = cellSize * 1.0;
  const [x, , z] = position;

  return (
    <mesh position={[x, h / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[w, h, w]} />
      <meshStandardMaterial color={KIND_COLOR[kind]} roughness={0.7} />
    </mesh>
  );
}
