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

import { Canvas, useFrame } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { memo, useCallback, useEffect, useRef } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { TerrainSurface } from './TerrainSurface';
import { Roads } from './Roads';
import { Rails } from './Rails';
import { Industries } from './Industries';
import { BuildingIcons } from './BuildingIcons';
import { CityBuildings } from './CityBuildings';
import { usePointerBuild } from './usePointerBuild';
import { TerraformSelection } from './TerraformSelection';
import {
  TOOLS,
  useCityDevelopment,
  useGame,
  useGameSnapshot,
  useTerraformPlan,
  useTerraformSnapshot,
  useTerrainMap,
  useTerrainStore,
  type TerrainMap,
} from '../sim';

/**
 * GameClock — advances the in-game date from the render loop, scaled by the
 * current game speed (pause/normal/fast). Lives inside the Canvas so it can use
 * useFrame; it mutates GameState imperatively and only publishes on whole-day
 * changes (no per-frame React re-renders).
 */
function GameClock() {
  const game = useGame();
  useFrame((_, delta) => {
    game.tickClock(delta);
  });
  return null;
}

/**
 * Overlay renderers (roads, rails, industry, forest, icons) depend on cell
 * TYPES and (for slope conforming) heights, but NOT on ordinary terraforming.
 * The terrain surface patches itself in place on height edits; to keep those
 * edits snappy we stop the overlays from re-rendering/rebuilding their geometry
 * unless `cellsVersion` (type changes) or `cellSize` actually changed.
 *
 * `map` identity changes on every edit (incl. pure height edits), so a default
 * React.memo wouldn't help — this comparator keys on the content signature.
 */
function sameCells(
  a: { map: TerrainMap; cellSize: number },
  b: { map: TerrainMap; cellSize: number },
): boolean {
  return (
    a.cellSize === b.cellSize &&
    a.map.cellsVersion === b.map.cellsVersion &&
    a.map.seed === b.map.seed &&
    a.map.size === b.map.size
  );
}

const MapGridM = memo(MapGrid, sameCells);
const IndustriesM = memo(Industries, sameCells);
const BuildingIconsM = memo(BuildingIcons, sameCells);
const RoadsM = memo(Roads, sameCells);
const RailsM = memo(Rails, sameCells);

/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene() {
  const { cellSize, gridHalfExtent } = DEFAULT_CONFIG;

  const terrain = useTerrainStore();
  const game = useGame();
  const { activeTool } = useGameSnapshot();
  const plan = useTerraformPlan();
  const planSnap = useTerraformSnapshot();
  const map = useTerrainMap();
  const half = (map.size - 1) / 2;

  // Leaving the raise/lower tools cancels an in-progress selection (but not a
  // batch that's already building).
  useEffect(() => {
    if (activeTool !== 'raise' && activeTool !== 'lower') {
      if (plan.getPhase() === 'selecting') plan.clear();
    }
  }, [activeTool, plan]);

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
        case 'rail': {
          if (!terrain.inBounds(x, z)) return;
          if (!game.canAfford(tool.cost)) return;
          if (terrain.buildRail(x, z)) game.spend(tool.cost);
          return;
        }
        case 'raise':
        case 'lower': {
          // Terraforming is now batched: clicks/drag only SELECT cells (shown
          // as a red grid). The actual edit happens on confirm (see SidePanel),
          // in one batch — so painting is instant and the terrain only updates
          // once. Only sculptable cells can be selected.
          if (!terrain.canTerraform(x, z)) return;
          plan.addCell(x, z, tool.id);
          return;
        }
      }
    },
    [terrain, game, plan, cellSize, half],
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
      <GameClock />

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

      {/* ONE unified heightmap terrain mesh (grass + hills + ramps + water +
          city). Carries the build handlers, so every click hits the real
          surface under the cursor — exact picking on flat ground and slopes. */}
      <TerrainSurface map={map} cellSize={cellSize} handlers={buildHandlers} />
      {/* Overlays below are memoized on cellsVersion, so a pure terraform
          (height) edit doesn't rebuild their geometry — only the terrain
          surface patches itself. They refresh when a cell TYPE changes. */}
      {/* Forest decoration blocks on top of the surface. */}
      <MapGridM map={map} cellSize={cellSize} />
      {/* Auto-generated special buildings (mills, mines, power plant, factory). */}
      <IndustriesM map={map} cellSize={cellSize} />
      {/* Floating UI icons above special buildings (for easy identification). */}
      <BuildingIconsM map={map} cellSize={cellSize} />
      {/* Roads: flat on ground, raised onto hills. */}
      <RoadsM map={map} cellSize={cellSize} />
      {/* Rails: gravel bed + sleepers + metal rails, slope-aware. */}
      <RailsM map={map} cellSize={cellSize} />

      {/* Auto-spawned city buildings that grow taller as they level up. */}
      <CityBuildings buildings={buildings} map={map} cellSize={cellSize} />

      {/* Pending terraform selection: red while selecting, yellow while the
          short build timer runs. */}
      <TerraformSelection plan={planSnap} map={map} cellSize={cellSize} />

      {/* Visual reference grid lines (picking is on the terrain surface). */}
      <GridFloor cellSize={cellSize} gridHalfExtent={gridHalfExtent} />
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
