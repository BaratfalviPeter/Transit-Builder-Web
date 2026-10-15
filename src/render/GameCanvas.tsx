/**
 * GameCanvas — the root R3F scene.
 *
 * Composes the camera rig, lighting, terrain (flat tiles + ramp-like hills),
 * roads, auto-generated industry, the auto-growing city, and the tool-driven
 * click interaction.
 *
 * Clicking the floor resolves the world point to a grid cell and dispatches on
 * the active tool (from GameState): build a road (deducting its cost if
 * affordable) or bulldoze a road. The terrain and game state live in shared
 * stores so the canvas, toolbar, and HUD all stay in sync.
 */

import { Canvas } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useCallback } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { Hills } from './Hills';
import { Roads } from './Roads';
import { Industries } from './Industries';
import { CityBuildings } from './CityBuildings';
import {
  TOOLS,
  useCityDevelopment,
  useGame,
  useTerrainMap,
  useTerrainStore,
} from '../sim';

/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene() {
  const { cellSize, gridHalfExtent } = DEFAULT_CONFIG;

  const terrain = useTerrainStore();
  const game = useGame();
  const map = useTerrainMap();
  const half = (map.size - 1) / 2;

  // Auto-spawning / growing city buildings, driven by the game-loop timer.
  const { buildings } = useCityDevelopment(map, TICK_MS);

  const handleFloorClick = useCallback(
    (worldX: number, worldZ: number) => {
      // World point -> terrain cell index (grid is centered on origin).
      const x = Math.round(worldX / cellSize + half);
      const z = Math.round(worldZ / cellSize + half);

      const tool = TOOLS[game.getActiveTool()];

      switch (tool.id) {
        case 'select':
          return; // no-op for now
        case 'bulldoze':
          terrain.bulldoze(x, z);
          return;
        case 'road': {
          // Only charge if the build actually succeeds and we can afford it.
          if (!terrain.inBounds(x, z)) return;
          if (!game.canAfford(tool.cost)) return;
          if (terrain.buildRoad(x, z)) game.spend(tool.cost);
          return;
        }
      }
    },
    [terrain, game, cellSize, half],
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

      {/* Flat terrain tiles (hills, roads, industry drawn separately). */}
      <MapGrid map={map} cellSize={cellSize} />
      {/* Continuous low-poly hill surface (gapless ramps). */}
      <Hills map={map} cellSize={cellSize} />
      {/* Auto-generated industry buildings (lumber mills + mines). */}
      <Industries map={map} cellSize={cellSize} />
      {/* Roads: flat on ground, raised onto hills. */}
      <Roads map={map} cellSize={cellSize} />

      {/* Auto-spawned city buildings that grow taller as they level up. */}
      <CityBuildings buildings={buildings} map={map} cellSize={cellSize} />

      {/* Click/pick plane for the active build tool. */}
      <GridFloor
        cellSize={cellSize}
        gridHalfExtent={gridHalfExtent}
        onFloorClick={handleFloorClick}
      />
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
