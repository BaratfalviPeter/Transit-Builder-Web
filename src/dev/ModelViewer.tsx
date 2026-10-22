/**
 * ModelViewer — a stand-alone page that shows ONE building model up close
 * (open the game with `?model=MineModel`).
 *
 * The model sits at the origin in its own design units (a 3×3-cell lot, base
 * slab on Y = 0) on a plain lawn with the lot grid, lit with the "Látvány"
 * settings at a fixed time of day. A model that reaches below ground (the
 * mine's pit) gets its lot cut out of the lawn, as in the game. Fixed camera views make shots repeatable;
 * the dev model editor works here too.
 *
 * URL parameters:
 *   model = MineModel | LumberMillModel | PowerPlantModel | FactoryModel
 *   view  = iso | front | side | back | top   (starting camera view)
 *   ui=0  → no panel (clean screenshots)
 * Once the first frames are drawn, <body> gets `data-viewer-ready`.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { sunPosition, useVisual } from '../render/visualSettings';
import { MineModel } from '../render/MineModel';
import { LumberMillModel } from '../render/LumberMillModel';
import { PowerPlantModel } from '../render/PowerPlantModel';
import { FactoryModel } from '../render/FactoryModel';
import { EditorGizmo, EditorPick } from './ModelEditor';
import { DevTab } from '../ui/DevTab';
import { VisualTuner } from '../ui/VisualTuner';
import '../ui/sidePanel.css';
import './modelViewer.css';

type V3 = [number, number, number];

export const VIEWER_MODELS: Array<{ id: string; label: string; Comp: ComponentType<{ phase?: number }> }> = [
  { id: 'MineModel', label: 'Bánya', Comp: MineModel },
  { id: 'LumberMillModel', label: 'Fatelep', Comp: LumberMillModel },
  { id: 'PowerPlantModel', label: 'Erőmű', Comp: PowerPlantModel },
  { id: 'FactoryModel', label: 'Gyár', Comp: FactoryModel },
];

/** Camera position per view (the camera always looks at TARGET). */
const VIEWS: Array<{ id: string; label: string; pos: V3 }> = [
  { id: 'iso', label: 'Átlós', pos: [3.6, 3.2, 3.6] },
  { id: 'front', label: 'Elöl', pos: [0, 1.4, 5.2] },
  { id: 'side', label: 'Oldalt', pos: [5.2, 1.4, 0] },
  { id: 'back', label: 'Hátul', pos: [0, 1.4, -5.2] },
  { id: 'top', label: 'Felül', pos: [0, 6.2, 0.001] },
];
const TARGET: V3 = [0, 0.35, 0];

/** Lights from the visual settings, at a fixed daytime; tight shadows. */
function ViewerLights() {
  const v = useVisual();
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = v.exposure;
  }, [gl, v.exposure]);
  const sun = sunPosition(v.sunAzimuth, v.sunElevation, 12);
  return (
    <>
      <color attach="background" args={[v.background]} />
      <ambientLight intensity={v.ambientIntensity} color={v.ambientColor} />
      <hemisphereLight args={[v.hemiSky, v.hemiGround, v.hemiIntensity]} />
      <directionalLight
        position={sun}
        color={v.sunColor}
        intensity={v.sunIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={v.shadowBias}
        shadow-normalBias={v.shadowNormalBias * 0.1}
      />
    </>
  );
}

/** Half the lot size (the models are designed on a 3×3-cell lot). */
const LOT = 1.5;
/** Lawn / grid extent (half-width). */
const LAWN = 7;
const GRID = 4.5;

/** Grid lines every 0.5 cell, skipping the lot when it is a hole. */
function gridLines(hole: boolean): THREE.BufferGeometry {
  const v: number[] = [];
  const seg = (a: number, b: number, c: number, alongX: boolean) =>
    alongX ? v.push(a, 0, c, b, 0, c) : v.push(c, 0, a, c, 0, b);
  for (let i = -GRID; i <= GRID + 1e-6; i += 0.5) {
    for (const alongX of [true, false]) {
      if (hole && Math.abs(i) < LOT - 1e-6) {
        seg(-GRID, -LOT, i, alongX);
        seg(LOT, GRID, i, alongX);
      } else seg(-GRID, GRID, i, alongX);
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
}

/**
 * Lawn with a light 0.5-cell grid and the 3×3 lot outlined. `depth` > 0: the
 * model reaches below ground (the mine's pit), so — like in the game, where
 * such a lot is cut out of the terrain — the lot is a hole in the lawn, lined
 * with earth walls down to that depth.
 */
function Ground({ depth }: { depth: number }) {
  const v = useVisual();
  const hole = depth > 0;
  const lawn = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-LAWN, -LAWN).lineTo(LAWN, -LAWN).lineTo(LAWN, LAWN).lineTo(-LAWN, LAWN).closePath();
    if (hole) {
      const h = new THREE.Path();
      h.moveTo(-LOT, -LOT).lineTo(-LOT, LOT).lineTo(LOT, LOT).lineTo(LOT, -LOT).closePath();
      shape.holes.push(h);
    }
    return new THREE.ShapeGeometry(shape);
  }, [hole]);
  const grid = useMemo(() => gridLines(hole), [hole]);
  const lot = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(LOT * 2, 0, LOT * 2)), []);
  const T = 0.05; // wall thickness, just outside the lot
  return (
    <group>
      <mesh geometry={lawn} rotation-x={-Math.PI / 2} position={[0, -0.002, 0]} receiveShadow>
        <meshStandardMaterial color={v.grass1} roughness={1} />
      </mesh>
      <lineSegments geometry={grid} position={[0, 0.001, 0]}>
        <lineBasicMaterial color="#6e7840" />
      </lineSegments>
      <lineSegments geometry={lot} position={[0, 0.003, 0]}>
        <lineBasicMaterial color="#f2e6b8" />
      </lineSegments>
      {hole &&
        ([
          [0, LOT + T / 2, LOT * 2 + T * 2, T],
          [0, -LOT - T / 2, LOT * 2 + T * 2, T],
          [LOT + T / 2, 0, T, LOT * 2],
          [-LOT - T / 2, 0, T, LOT * 2],
        ] as const).map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, -depth / 2 - 0.002, z]} receiveShadow>
            <boxGeometry args={[w, depth, d]} />
            <meshStandardMaterial color="#6b5843" roughness={1} />
          </mesh>
        ))}
      {hole && (
        <mesh rotation-x={-Math.PI / 2} position={[0, -depth - 0.002, 0]} receiveShadow>
          <planeGeometry args={[LOT * 2, LOT * 2]} />
          <meshStandardMaterial color="#5a4a38" roughness={1} />
        </mesh>
      )}
    </group>
  );
}

/** Reports how far below ground (Y = 0) the model reaches (0 = it doesn't). */
function MeasureDepth({ target, sig, onDepth }: { target: RefObject<THREE.Group>; sig: string; onDepth: (d: number) => void }) {
  useEffect(() => {
    const g = target.current;
    if (!g) return;
    const minY = new THREE.Box3().setFromObject(g).min.y;
    onDepth(minY < -0.02 ? -minY + 0.08 : 0);
  }, [target, sig, onDepth]);
  return null;
}

/** Moves the camera to a preset view whenever `view` changes. */
function CameraViews({ view }: { view: string }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    const p = (VIEWS.find((x) => x.id === view) ?? VIEWS[0]).pos;
    camera.position.set(...p);
    camera.lookAt(...TARGET);
    controls?.target.set(...TARGET);
    controls?.update();
  }, [view, camera, controls]);
  return null;
}

/** Flags <body> once a few frames are on screen (for scripted screenshots). */
function ReadyFlag({ sig }: { sig: string }) {
  const frames = useRef(0);
  useEffect(() => {
    frames.current = 0;
    delete document.body.dataset.viewerReady;
  }, [sig]);
  useFrame(() => {
    if (++frames.current === 5) document.body.dataset.viewerReady = sig;
  });
  return null;
}

export function ModelViewer() {
  const params = new URLSearchParams(window.location.search);
  const [modelId, setModelId] = useState(params.get('model') ?? VIEWER_MODELS[0].id);
  const [view, setView] = useState(params.get('view') ?? 'iso');
  const ui = params.get('ui') !== '0';
  const entry = VIEWER_MODELS.find((m) => m.id === modelId) ?? VIEWER_MODELS[0];

  // Keep the URL in step, so a reload (or a shared link) shows the same thing.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('model', entry.id);
    p.set('view', view);
    window.history.replaceState(null, '', `?${p.toString()}`);
  }, [entry.id, view]);

  const [depth, setDepth] = useState(0);
  const modelRef = useRef<THREE.Group>(null);
  const { Comp } = entry;
  return (
    <>
      <Canvas shadows="soft" camera={{ fov: 40, near: 0.05, far: 200 }} style={{ position: 'absolute', inset: 0 }}>
        <ViewerLights />
        <Ground depth={depth} />
        <group ref={modelRef}>
          <EditorPick>
            <Comp key={entry.id} phase={0} />
          </EditorPick>
        </group>
        <MeasureDepth target={modelRef} sig={entry.id} onDepth={setDepth} />
        <EditorGizmo />
        <OrbitControls makeDefault target={TARGET} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={1} maxDistance={20} />
        <CameraViews view={view} />
        <ReadyFlag sig={`${entry.id}:${view}`} />
      </Canvas>

      {ui && (
        <div className="mv" onPointerDown={(e) => e.stopPropagation()}>
          <div className="mv__head">
            <span>🔍 Modellnéző</span>
            <a href={window.location.pathname} title="Vissza a játékhoz">
              ✕
            </a>
          </div>
          <div className="mv__body">
            <select value={entry.id} onChange={(e) => setModelId(e.target.value)}>
              {VIEWER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
            <div className="mv__views">
              {VIEWS.map((x) => (
                <button key={x.id} type="button" className={view === x.id ? 'is-active' : ''} onClick={() => setView(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
            <DevTab />
          </div>
        </div>
      )}
      <VisualTuner />
    </>
  );
}
