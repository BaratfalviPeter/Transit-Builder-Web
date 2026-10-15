/**
 * GameCanvas — the root R3F scene.
 *
 * Composes the camera rig, lighting, procedurally generated terrain, grid
 * floor, and placed buildings.
 *
 * The terrain map is generated once (pure-TS `generateTerrain`) and held in
 * React state here, so gameplay systems (pathfinding, traffic, economy) can
 * read the same 21×21 grid later. Floor clicks are snapped to the nearest grid
 * cell and forwarded to the simulation (World.place); the World enforces one
 * object per cell.
 */

import { Canvas } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useCallback, useState } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { CityBuildings } from './CityBuildings';
import { Buildings } from './Buildings';
import {
  generateTerrain,
  useCityDevelopment,
  useWorld,
  worldToCell,
  type TerrainMap,
} from '../sim';

const MAP_SIZE = 21;
/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene({ map }: { map: TerrainMap }) {
  const world = useWorld();
  const { cellSize, gridHalfExtent } = DEFAULT_CONFIG;

  // Auto-spawning / growing city buildings, driven by the game-loop timer.
  const { buildings } = useCityDevelopment(map, TICK_MS);

  const handleFloorClick = useCallback(
    (x: number, z: number) => {
      const coord = worldToCell(x, z, cellSize);
      // Clamp to the grid bounds so you can't place beyond the visible floor.
      if (
        Math.abs(coord.cx) > gridHalfExtent ||
        Math.abs(coord.cz) > gridHalfExtent
      ) {
        return;
      }
      world.place('house', coord);
    },
    [world, cellSize, gridHalfExtent],
  );

  return (
    <>
      <CameraRig />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Sky sunPosition={[30, 50, 20]} />

      {/* Procedurally generated terrain (centered on origin). */}
      <MapGrid map={map} cellSize={cellSize} />

      {/* Auto-spawned city buildings that grow taller as they level up. */}
      <CityBuildings buildings={buildings} map={map} cellSize={cellSize} />

      {/* Faint reference grid + click/pick plane for building placement. */}
      <GridFloor
        cellSize={cellSize}
        gridHalfExtent={gridHalfExtent}
        onFloorClick={handleFloorClick}
      />

      <Buildings cellSize={cellSize} />
    </>
  );
}

export function GameCanvas() {
  // Generate the map once and keep it in React state. Regenerating would be a
  // matter of calling setMap(generateTerrain(...)) with a new seed.
  const [map] = useState<TerrainMap>(() => generateTerrain({ size: MAP_SIZE }));

  return (
    <Canvas
      shadows
      camera={{ position: [40, 40, 40], fov: 50, near: 0.1, far: 1000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#adc8e6']} />
      <Scene map={map} />
    </Canvas>
  );
}
