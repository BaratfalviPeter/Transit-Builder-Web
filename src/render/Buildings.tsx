/**
 * Buildings — renders all placed objects from the simulation.
 *
 * Subscribes to the World snapshot (via useWorldSnapshot) and renders one
 * BuildingModel per placement. This set changes only on discrete place/remove
 * events, so React re-rendering here is cheap and appropriate.
 *
 * NOTE: This is intentionally NOT how moving vehicles will be rendered. Those
 * will be driven in the Three.js render loop with instancing (useFrame +
 * InstancedMesh) and will not go through React re-renders.
 */

import { cellToWorld, useWorldSnapshot } from '../sim';
import { BuildingModel } from './BuildingModel';

export function Buildings({ cellSize }: { cellSize: number }) {
  const placements = useWorldSnapshot();

  return (
    <group>
      {placements.map((p) => (
        <BuildingModel
          key={p.id}
          kind={p.kind}
          cellSize={cellSize}
          position={cellToWorld(p.coord, cellSize)}
        />
      ))}
    </group>
  );
}
