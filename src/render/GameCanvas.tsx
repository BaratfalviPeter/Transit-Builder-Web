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

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sunPosition, useVisual, useVisualKeys } from './visualSettings';
import { memo, useCallback, useEffect, useRef } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { Clouds } from './CloudLayer';
import { Birds } from './Birds';
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
const BirdsM = memo(Birds, sameCells);

/**
 * Half-extent of the orthographic shadow frustum. The map is 61 cells × 2 =
 * 122 units; its half-diagonal (~86) plus margin covers it from any angle.
 */
const SHADOW_EXTENT = 92;

/**
 * Lights + exposure + background, all driven live by the "Látvány" tuner
 * (visualSettings). The sun aims at the origin (map centre) from the chosen
 * azimuth/elevation, far enough out that the whole map is in front of the
 * shadow camera's near plane.
 */
function Lights() {
  const v = useVisual();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.toneMappingExposure = v.exposure;
  }, [gl, v.exposure]);
  useEffect(() => {
    scene.background = new THREE.Color(v.background);
  }, [scene, v.background]);
  const sunPos = sunPosition(v.sunAzimuth, v.sunElevation);
  return (
    <>
      <ambientLight intensity={v.ambientIntensity} color={v.ambientColor} />
      <hemisphereLight args={[v.hemiSky, v.hemiGround, v.hemiIntensity]} />
      <directionalLight
        position={sunPos}
        color={v.sunColor}
        intensity={v.sunIntensity}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={1}
        shadow-camera-far={320}
        shadow-bias={v.shadowBias}
        shadow-normalBias={v.shadowNormalBias}
      />
    </>
  );
}

/**
 * ShadowController — the key FPS fix.
 *
 * The scene's static shadow casters (≈1700 trees, rocks, terrain, buildings)
 * never move, so re-rendering the shadow map 60×/s is pure waste. We turn OFF
 * the renderer's automatic shadow updates and only recompute the shadow map
 * when something actually changed:
 *   - once on mount and whenever the map (cellsVersion/seed/size) changes,
 *   - whenever a sun/shadow setting in the tuner changes,
 *   - every frame ONLY while the user opted into moving cloud/bird shadows.
 *
 * This is the same idea as drei's <BakeShadows> (freeze the shadow map), but
 * driven so that moving shadow-casters (clouds/birds) still work when enabled,
 * instead of being frozen forever.
 */
function ShadowController({
  mapSig,
  live,
  sunSig,
}: {
  mapSig: string;
  live: boolean;
  sunSig: string;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    gl.shadowMap.autoUpdate = live;
    gl.shadowMap.needsUpdate = true; // recompute once now
  }, [gl, live, mapSig, sunSig]);

  // While not live, nudge one extra update on the next frame so geometry that
  // streams in (instanced trees fill their matrices in a layout effect) is
  // captured even if it lands a tick after mount.
  const framesLeft = useRef(2);
  useEffect(() => {
    framesLeft.current = 2;
  }, [mapSig, sunSig, live]);
  useFrame(() => {
    if (live) return;
    if (framesLeft.current > 0) {
      framesLeft.current--;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene() {
  const { cellSize } = DEFAULT_CONFIG;

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
  // Anchor cell of a road/rail drag: the most recently BUILT line cell. New
  // cells only extend the line if they're its direct N/S/E/W neighbour, so the
  // road "snakes" one cell at a time (Mini-Motorways style) instead of jumping
  // across gaps when the pointer moves fast or diagonally.
  const lineAnchor = useRef<{ x: number; z: number } | null>(null);

  const handlePaint = useCallback(
    (worldX: number, worldZ: number) => {
      // World point -> terrain cell index (grid is centered on origin).
      const x = Math.round(worldX / cellSize + half);
      const z = Math.round(worldZ / cellSize + half);
      const key = `${x},${z}`;
      if (key === lastCell.current) return; // same cell as last event
      lastCell.current = key;

      const tool = TOOLS[game.getActiveTool()];

      // Shared snake logic for road + rail: the first cell of the gesture is
      // placed freely; after that, only a straight orthogonal step from the
      // last built cell is allowed (no diagonals, no gaps). The anchor only
      // advances to cells we actually built, so a blocked step (water, slope,
      // occupied) doesn't let the line skip ahead.
      const buildLine = (build: (x: number, z: number) => boolean): void => {
        if (!terrain.inBounds(x, z)) return;
        const a = lineAnchor.current;
        if (a) {
          const dist = Math.abs(a.x - x) + Math.abs(a.z - z);
          if (dist !== 1) return; // not a direct up/down/left/right neighbour
        }
        if (!game.canAfford(tool.cost)) return;
        if (build(x, z)) {
          game.spend(tool.cost);
          lineAnchor.current = { x, z };
        }
      };

      switch (tool.id) {
        case 'select':
          return; // no-op
        case 'bulldoze':
          terrain.bulldoze(x, z);
          return;
        case 'road':
          buildLine((cx, cz) => terrain.buildRoad(cx, cz));
          return;
        case 'rail':
          buildLine((cx, cz) => terrain.buildRail(cx, cz));
          return;
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

  // Reset the dedupe key + line anchor whenever a drag starts/ends so the first
  // cell of the next gesture is always processed and placed freely.
  const handleDragChange = useCallback(() => {
    lastCell.current = null;
    lineAnchor.current = null;
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

  // Shadow-map updates: static by default (compute once), live only when the
  // user turns on moving cloud/bird shadows. Sun settings trigger a recompute.
  const shadowVis = useVisualKeys([
    'cloudShadows',
    'cloudsVisible',
    'birdsVisible',
    'sunAzimuth',
    'sunElevation',
    'sunIntensity',
    'shadowBias',
    'shadowNormalBias',
  ] as const);
  const { liveShadows: liveOptIn } = useVisualKeys(['liveShadows'] as const);
  // Only pay for 60 fps shadow updates when the user opts in AND something that
  // moves actually casts a shadow. Otherwise the shadow map is computed once.
  const liveShadows =
    liveOptIn &&
    ((shadowVis.cloudShadows && shadowVis.cloudsVisible) || shadowVis.birdsVisible);
  // (Without live mode clouds still cast cheap shader-projected shadows.)
  const sunSig = [
    shadowVis.sunAzimuth,
    shadowVis.sunElevation,
    shadowVis.sunIntensity,
    shadowVis.shadowBias,
    shadowVis.shadowNormalBias,
  ].join('|');
  const mapSig = `${map.seed}:${map.size}:${map.cellsVersion}`;

  return (
    <>
      <CameraRig />
      <GameClock />
      <ShadowController mapSig={mapSig} live={liveShadows} sunSig={sunSig} />

      {/* Lighting — warm "diorama" look: soft warm ambient, a cool sky / green
          ground bounce, and one strong shadow-casting sun. */}
      <Lights />

      {/* ONE unified heightmap terrain mesh (grass + hills + ramps + water +
          city). Carries the build handlers, so every click hits the real
          surface under the cursor — exact picking on flat ground and slopes. */}
      <TerrainSurface map={map} cellSize={cellSize} handlers={buildHandlers} />
      {/* Overlays below are memoized on cellsVersion, so a pure terraform
          (height) edit doesn't rebuild their geometry — only the terrain
          surface patches itself. They refresh when a cell TYPE changes. */}
      {/* Instanced low-poly pine trees (forests + scattered) and rocks. */}
      <MapGridM map={map} cellSize={cellSize} />
      {/* Drifting low-poly clouds (cast soft shadows on the map). */}
      <Clouds extent={(map.size / 2) * cellSize + 14} seed={map.seed} />
      {/* Little flocks circling over the forests. */}
      <BirdsM map={map} cellSize={cellSize} />
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
      <GridFloor cellSize={cellSize} gridHalfExtent={map.size / 2} />
    </>
  );
}

export function GameCanvas() {
  return (
    <Canvas
      shadows="soft"
      camera={{ position: [90, 90, 90], fov: 50, near: 0.1, far: 2000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene />
    </Canvas>
  );
}
