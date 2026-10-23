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
import { applyNight, setSkyClock, setSunDir, skyAt, type Sky } from './dayNight';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { MapGrid } from './MapGrid';
import { Clouds } from './CloudLayer';
import { Birds } from './Birds';
import { Life } from './Life';
import { Plinth } from './Plinth';
import { TerrainSurface } from './TerrainSurface';
import { Roads } from './Roads';
import { Rails } from './Rails';
import { Industries } from './Industries';
import { EditorGizmo, EditorPick } from '../dev/ModelEditor';
import { StationPreview, Stations, type StationHover } from './Stations';
import { BuildingIcons } from './BuildingIcons';
import { CityBuildings } from './CityBuildings';
import { usePointerBuild } from './usePointerBuild';
import { TerraformSelection } from './TerraformSelection';
import { PathPreview } from './PathPreview';
import {
  CellType,
  canStartRoute,
  industryAnchorOf,
  sideAt,
  stationProblem,
  TOOLS,
  usePathPlan,
  usePathPlanSnapshot,
  useCityDevelopment,
  useGame,
  useGameSnapshot,
  useTerraformPlan,
  useTerraformSnapshot,
  useTerrainMap,
  useTerrainStore,
  useInteriorSnapshot,
  useInteriorStore,
  type TerrainMap,
} from '../sim';
import { getDev } from '../dev/modelEditorStore';

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
const StationsM = memo(Stations, sameCells);
const BuildingIconsM = memo(BuildingIcons, sameCells);
const RoadsM = memo(Roads, sameCells);
const RailsM = memo(Rails, sameCells);
const BirdsM = memo(Birds, sameCells);
const LifeM = memo(Life, sameCells);

/**
 * Half-extent of the orthographic shadow frustum. The map is 121 cells × 1 =
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

  const amb = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  // Time of day (0 = midnight, 0.5 = noon). Starts at the slider value and
  // runs forward while the cycle is on.
  const tod = useRef(v.timeOfDay);
  const sky = useRef<Sky | undefined>(undefined);
  const lastStep = useRef<number | null>(null);
  const vRef = useRef(v);
  vRef.current = v;
  useEffect(() => {
    tod.current = v.timeOfDay;
  }, [v.timeOfDay]);
  // A tuned sun/light value changed: force a re-light (+ shadow refresh).
  useEffect(() => {
    lastStep.current = null;
  }, [v.sunAzimuth, v.sunElevation]);

  useFrame((_, delta) => {
    const vv = vRef.current;
    if (vv.dayCycle) tod.current = (tod.current + Math.min(delta, 0.1) / Math.max(10, vv.dayLength)) % 1;
    const sk = (sky.current = skyAt(vv.dayCycle ? tod.current : vv.timeOfDay, vv, sky.current));
    setSkyClock(vv.dayCycle ? tod.current : vv.timeOfDay);
    const sun = sunRef.current;
    if (sun) {
      sun.color.copy(sk.lightColor);
      sun.intensity = sk.lightIntensity;
      const stepKey = sk.sun ? sk.step : -1;
      if (stepKey !== lastStep.current) {
        lastStep.current = stepKey;
        sun.position.set(...sk.pos);
        sun.updateMatrixWorld();
        setSunDir(sun.position);
        gl.shadowMap.needsUpdate = true; // sun moved one step → re-bake shadows
      }
    }
    if (amb.current) {
      amb.current.color.copy(sk.ambientColor);
      amb.current.intensity = sk.ambientIntensity;
    }
    if (hemi.current) {
      hemi.current.color.copy(sk.hemiSky);
      hemi.current.groundColor.copy(sk.hemiGround);
      hemi.current.intensity = sk.hemiIntensity;
    }
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();
    (scene.background as THREE.Color).copy(sk.background);
    applyNight(sk.night);
  });

  const sunPos = sunPosition(v.sunAzimuth, v.sunElevation);
  return (
    <>
      <ambientLight ref={amb} intensity={v.ambientIntensity} color={v.ambientColor} />
      <hemisphereLight ref={hemi} args={[v.hemiSky, v.hemiGround, v.hemiIntensity]} />
      <directionalLight
        ref={sunRef}
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

/** Track type a tool plans with the two-click planner (null = not a track tool). */
function trackOf(id: string): CellType.Road | CellType.Rail | null {
  return id === 'road' ? CellType.Road : id === 'rail' ? CellType.Rail : null;
}

/** Game tick interval in ms (auto-spawn / growth cadence). */
const TICK_MS = 2500;

function Scene() {
  const { cellSize } = DEFAULT_CONFIG;

  const terrain = useTerrainStore();
  const game = useGame();
  const { activeTool, money } = useGameSnapshot();
  const plan = useTerraformPlan();
  const planSnap = useTerraformSnapshot();
  const pathPlan = usePathPlan();
  const pathSnap = usePathPlanSnapshot();
  const interiors = useInteriorStore();
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

  /** World point -> terrain cell index (grid is centered on origin). */
  const cellOf = useCallback(
    (worldX: number, worldZ: number) => ({
      x: Math.round(worldX / cellSize + half),
      z: Math.round(worldZ / cellSize + half),
    }),
    [cellSize, half],
  );

  /** World point -> continuous grid coords (cell centre = integer). */
  const gridOf = useCallback(
    (worldX: number, worldZ: number) => ({ x: worldX / cellSize + half, z: worldZ / cellSize + half }),
    [cellSize, half],
  );

  // Drag-painting tools (bulldoze, terraform selection). Road and rail use the
  // two-click A→B planner below instead.
  const handlePaint = useCallback(
    (worldX: number, worldZ: number) => {
      const { x, z } = cellOf(worldX, worldZ);
      const tool = TOOLS[game.getActiveTool()];
      const key = `${x},${z}`;
      if (key === lastCell.current) return;
      lastCell.current = key;

      switch (tool.id) {
        case 'bulldoze':
          terrain.bulldoze(x, z);
          return;
        case 'raise':
        case 'lower': {
          // Terraforming is batched: clicks/drag only SELECT cells (shown as a
          // red grid). The actual edit happens on confirm (see SidePanel), in
          // one batch. Only sculptable cells can be selected.
          if (!terrain.canTerraform(x, z)) return;
          plan.addCell(x, z, tool.id);
          return;
        }
        default:
          return; // select: no-op; road/rail: click mode
      }
    },
    [terrain, game, plan, cellOf],
  );

  const handleDragChange = useCallback(() => {
    lastCell.current = null;
  }, []);

  // ---- Station tool: hover an industry side, click to dock a station ------
  const [stationHover, setStationHover] = useState<StationHover | null>(null);
  const stationTarget = useCallback(
    (wx: number, wz: number): StationHover | null => {
      const { x, z } = cellOf(wx, wz);
      if (!terrain.inBounds(x, z)) return null;
      const m = terrain.getMap();
      const t = sideAt(m, x, z);
      return t ? { ...t, problem: stationProblem(m, t.anchor, t.side) } : null;
    },
    [terrain, cellOf],
  );
  useEffect(() => {
    if (activeTool !== 'station') setStationHover(null);
  }, [activeTool]);

  // ---- Two-click (Point A → Point B) road/rail planner -------------------
  //   idle          --click valid cell-->  selecting_end (A = startNode)
  //   selecting_end --hover-->             A* preview (green / red hologram)
  //   selecting_end --click-->             build previewPath, pay, -> idle
  //   selecting_end --right-click / Esc--> cancel, -> idle
  const clickMode = useMemo(
    () => ({
      // Select: a click (not a drag — that pans) on an industry opens its interior.
      active: () => {
        const t = game.getActiveTool();
        return trackOf(t) !== null || t === 'station' || (t === 'select' && !getDev().editorOn);
      },
      onHover: (wx: number, wz: number) => {
        if (game.getActiveTool() === 'station') {
          const h = stationTarget(wx, wz);
          setStationHover((cur) =>
            cur && h && cur.anchor[0] === h.anchor[0] && cur.anchor[1] === h.anchor[1] && cur.side === h.side && cur.problem === h.problem
              ? cur
              : h,
          );
          return;
        }
        if (pathPlan.getSnapshot().pathbuildingState !== 'selecting_end') return;
        const g = gridOf(wx, wz);
        if (!terrain.inBounds(Math.round(g.x), Math.round(g.z))) return;
        pathPlan.preview(terrain.getMap(), g);
      },
      onClick: (wx: number, wz: number) => {
        const tool = TOOLS[game.getActiveTool()];
        if (tool.id === 'select') {
          const { x, z } = cellOf(wx, wz);
          if (!terrain.inBounds(x, z)) return;
          const m = terrain.getMap();
          const a = industryAnchorOf(m, x, z);
          if (a) interiors.open(a, m.cells[a[0]][a[1]]);
          return;
        }
        if (tool.id === 'station') {
          const h = stationTarget(wx, wz);
          if (!h || h.problem || !game.canAfford(tool.cost)) return;
          if (terrain.buildStation(h.anchor, h.side)) game.spend(tool.cost);
          setStationHover(stationTarget(wx, wz));
          return;
        }
        const type = trackOf(tool.id);
        if (type === null) return;
        const g = gridOf(wx, wz);
        if (!terrain.inBounds(Math.round(g.x), Math.round(g.z))) return;
        const m = terrain.getMap();
        const snap = pathPlan.getSnapshot();

        if (snap.pathbuildingState === 'idle') {
          // Point A: must be a point the track can use.
          if (canStartRoute(m, g, type)) pathPlan.begin(m, g, type);
          return;
        }

        // Point B: make sure the route ends exactly at the clicked point.
        pathPlan.preview(m, g, true);
        const p = pathPlan.getSnapshot();
        const cost = p.newCells * tool.cost;
        // Red hologram = refuse (blocked route or not enough money).
        if (p.blocked || !game.canAfford(cost)) return;
        let placed = 0;
        if (type === CellType.Rail) {
          if (p.rail) placed = terrain.buildRail(p.rail);
        } else if (p.previewPath.length > 0) {
          placed = terrain.buildPath(p.previewPath);
        }
        if (placed === 0) return;
        game.spend(placed * tool.cost);
        pathPlan.clear();
      },
    }),
    [game, terrain, pathPlan, gridOf, stationTarget, cellOf, interiors],
  );

  // Switching tool (or road <-> rail) drops an unfinished plan.
  useEffect(() => {
    const s = pathPlan.getSnapshot();
    if (s.pathbuildingState !== 'idle' && trackOf(activeTool) !== s.type) pathPlan.clear();
  }, [activeTool, pathPlan]);

  // The map changed while planning (another build, city growth): re-route.
  useEffect(() => {
    pathPlan.refresh(terrain.getMap());
  }, [map.cellsVersion, map.version, terrain, pathPlan]);

  // Cancel: Escape, or a right CLICK (press + release without dragging — a
  // right DRAG still orbits the camera).
  useEffect(() => {
    let rightDown: { x: number; y: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pathPlan.clear();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2 || !rightDown) return;
      const moved = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y);
      rightDown = null;
      if (moved < 6) pathPlan.clear();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [pathPlan]);

  // Shared click + drag handlers, attached to the terrain surface so each hit
  // lands on the real geometry under the cursor.
  const buildHandlers = usePointerBuild(handlePaint, handleDragChange, clickMode);

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
      {/* Layered earth/rock base under the board (diorama look). */}
      <Plinth map={map} cellSize={cellSize} />
      {/* Sailboats on the lakes. */}
      <LifeM map={map} cellSize={cellSize} />
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
      <EditorPick>
        <IndustriesM map={map} cellSize={cellSize} />
        {/* Stations docked onto industry sides (their track is in Rails). */}
        <StationsM map={map} cellSize={cellSize} />
      </EditorPick>
      {stationHover && (
        <StationPreview
          map={map}
          cellSize={cellSize}
          hover={stationHover}
          cost={TOOLS.station.cost}
          canAfford={money >= TOOLS.station.cost}
        />
      )}
      {/* Dev model editor: selection outline + move / rotate / scale gizmo. */}
      <EditorGizmo />
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

      {/* Two-click road/rail planner: green hologram of the A* route, red if
          blocked or unaffordable. */}
      {pathSnap.pathbuildingState === 'selecting_end' && (
        <PathPreview
          path={pathSnap.previewPath}
          red={
            pathSnap.blocked ||
            money < pathSnap.newCells * TOOLS[pathSnap.type === CellType.Rail ? 'rail' : 'road'].cost
          }
          map={map}
          cellSize={cellSize}
          rail={pathSnap.type === CellType.Rail}
          railPts={pathSnap.rail?.pts}
          start={pathSnap.startNode}
        />
      )}

      {/* Visual reference grid lines (picking is on the terrain surface). */}
      <GridFloor cellSize={cellSize} gridHalfExtent={map.size / 2} />
    </>
  );
}

export function GameCanvas() {
  // While an interior (micro view) is open, the map isn't visible: stop
  // rendering it (this also pauses the in-game clock).
  const { open } = useInteriorSnapshot();
  return (
    <Canvas
      frameloop={open ? 'never' : 'always'}
      shadows="soft"
      camera={{ position: [90, 90, 90], fov: 50, near: 0.1, far: 2000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene />
    </Canvas>
  );
}
