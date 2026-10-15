/**
 * GameCanvas — the root R3F scene.
 *
 * Composes the camera rig, lighting, procedurally generated terrain, the
 * auto-growing city, and the click-to-build-roads interaction.
 *
 * The terrain lives in a shared `TerrainStore` (via TerrainProvider), so both
 * this canvas and the DOM HUD read the same grid. Clicking the floor converts
 * the hit point to a grid cell and asks the store to build a road there; the
 * store enforces the rule that roads may only replace Empty ground.
 */

import { Canvas } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useCallback } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { CityBuildings } from './CityBuildings';
import { Buildings } from './Buildings';
import { useCityDevelopment, useTerrainMap, useTerrainStore } from '../sim';

/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene() {
  const { cellSize, gridHalfExtent } = DEFAULT_CONFIG;

  const terrain = useTerrainStore();
  const map = useTerrainMap();
  const half = (map.size - 1) / 2;

  // Auto-spawning / growing city buildings, driven by the game-loop timer.
  const { buildings } = useCityDevelopment(map, TICK_MS);

  const handleFloorClick = useCallback(
    (worldX: number, worldZ: number) => {
      // World point -> terrain cell index. Terrain is centered on origin, so
      // cell [x][z] sits at ((x-half)*cellSize, _, (z-half)*cellSize); invert
      // that and round to the nearest cell.
      const x = Math.round(worldX / cellSize + half);
      const z = Math.round(worldZ / cellSize + half);
      terrain.buildRoad(x, z);
    },
    [terrain, cellSize, half],
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

      {/* Procedurally generated terrain + player-built roads. */}
      <MapGrid map={map} cellSize={cellSize} />

      {/* Auto-spawned city buildings that grow taller as they level up. */}
      <CityBuildings buildings={buildings} map={map} cellSize={cellSize} />

      {/* Faint reference grid + click/pick plane (click = build road). */}
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
  return (
    <Canvas
      shadows
      camera={{ position: [40, 40, 40], fov: 50, near: 0.1, far: 1000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#adc8e6']} />
      <Scene />
    </Canvas>
  );
}
