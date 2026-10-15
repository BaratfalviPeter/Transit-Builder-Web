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
import { useCallback, useEffect, useRef } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { Hills } from './Hills';
import { Roads } from './Roads';
import { Industries } from './Industries';
import { BuildingIcons } from './BuildingIcons';
import { CityBuildings } from './CityBuildings';
import { usePointerBuild } from './usePointerBuild';
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

  // Remember the last cell acted on during a drag so we don't re-process the
  // same cell many times as the pointer wiggles within it.
  const lastCell = useRef<string | null>(null);

  const handlePaint = useCallback(
    (worldX: number, worldZ: number) => {
      // World point -> terrain cell index (grid is centered on origin).
      const x = Math.round(worldX / cellSize + half);
      const z = Math.round(worldZ / cellSize + half);
      const key = `${x},${z}`;
      if (key === lastCell.current) return; // same cell as last event
      lastCell.current = key;

      const tool = TOOLS[game.getActiveTool()];
      switch (tool.id) {
        case 'select':
          return; // no-op
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

  // Reset the dedupe key whenever a drag starts/ends so the first cell of the
  // next gesture is always processed.
  const handleDragChange = useCallback(() => {
    lastCell.current = null;
  }, []);

  // Shared click + drag handlers, attached to BOTH the flat pick-plane and the
  // raised hill mesh so each hit lands on the real geometry under the cursor.
  const buildHandlers = usePointerBuild(handlePaint, handleDragChange);

  // Safety net: if the pointer is released anywhere (even off the pick plane),
  // clear the dedupe key so a stuck drag can't keep painting.
  useEffect(() => {
    const onUp = () => {
      lastCell.current = null;
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

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
      {/* Continuous low-poly hill surface. Carries the build handlers so clicks
          hit the actual slope geometry (correct cell), not the plane below. */}
      <Hills map={map} cellSize={cellSize} handlers={buildHandlers} />
      {/* Auto-generated special buildings (mills, mines, power plant, factory). */}
      <Industries map={map} cellSize={cellSize} />
      {/* Floating UI icons above special buildings (for easy identification). */}
      <BuildingIcons map={map} cellSize={cellSize} />
      {/* Roads: flat on ground, raised onto hills. */}
      <Roads map={map} cellSize={cellSize} />

      {/* Auto-spawned city buildings that grow taller as they level up. */}
      <CityBuildings buildings={buildings} map={map} cellSize={cellSize} />

      {/* Flat-ground pick plane + reference grid (shares the build handlers). */}
      <GridFloor
        cellSize={cellSize}
        gridHalfExtent={gridHalfExtent}
        handlers={buildHandlers}
      />
    </>
  );
}

export function GameCanvas() {
  return (
    <Canvas
      shadows
      camera={{ position: [90, 90, 90], fov: 50, near: 0.1, far: 2000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#adc8e6']} />
      <Scene />
    </Canvas>
  );
}
