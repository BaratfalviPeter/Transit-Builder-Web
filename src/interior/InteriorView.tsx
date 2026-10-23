/**
 * InteriorView — the micro view overlay: a full-screen close-up of one
 * industry's interior (own Canvas) with a top bar (name, money, close) and a
 * build bar (this industry's machines, rotate, remove).
 *
 * Keys: 1…9 pick a machine, R rotates, Del/X = remove mode, Esc drops the
 * tool or (with no tool) closes the view. A conveyor can be laid by
 * dragging: each new tile turns the previous belt towards it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  CATALOGUE,
  INDUSTRY_NAME,
  InteriorStore,
  MACHINES,
  gatesOf,
  machineAt,
  placementProblem,
  useGame,
  useGameSnapshot,
  useInteriorSnapshot,
  useInteriorStore,
  useTerrainMap,
  type MachineKind,
  type Rot,
} from '../sim';
import { InteriorScene, type Ghost } from './InteriorScene';
import { useVisual, sunPosition } from '../render/visualSettings';
import './interior.css';

type Tool = MachineKind | 'remove' | null;

const ROT_LABEL = ['→ K', '↓ D', '← Ny', '↑ É'];

function Lights() {
  const v = useVisual();
  const sun = sunPosition(v.sunAzimuth, v.sunElevation, 20);
  return (
    <>
      <color attach="background" args={['#2a2e36']} />
      <ambientLight intensity={v.ambientIntensity} color={v.ambientColor} />
      <hemisphereLight args={[v.hemiSky, v.hemiGround, v.hemiIntensity]} />
      <directionalLight
        position={sun}
        intensity={v.sunIntensity}
        color={v.sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0005}
      />
    </>
  );
}

export function InteriorView() {
  const store = useInteriorStore();
  const { open: interior } = useInteriorSnapshot();
  const map = useTerrainMap();
  const game = useGame();
  const { money } = useGameSnapshot();
  const [tool, setTool] = useState<Tool>(null);
  const [rot, setRot] = useState<Rot>(0);
  const [hover, setHover] = useState<[number, number] | null>(null);
  /** Belt being drag-laid: the last tile and its conveyor. */
  const drag = useRef<{ x: number; z: number; id: number } | null>(null);

  const catalogue = interior ? (CATALOGUE[interior.type] ?? ['conveyor']) : [];
  const gates = useMemo(() => (interior ? gatesOf(map, interior.anchor) : []), [map, interior]);

  // Reset the tool whenever another interior opens.
  useEffect(() => {
    setTool(null);
    setRot(0);
    setHover(null);
  }, [interior?.anchor[0], interior?.anchor[1]]);

  /** Why the current tool can't go at (x, z) right now, or null. */
  const problemAt = (kind: MachineKind, x: number, z: number): string | null => {
    const it = store.getSnapshot().open;
    if (!it) return 'Nincs nyitva';
    return placementProblem(map, it, kind, x, z) ?? (game.canAfford(MACHINES[kind].cost) ? null : 'Nincs elég pénz');
  };

  const place = (kind: MachineKind, x: number, z: number, r: Rot) => {
    if (problemAt(kind, x, z)) return null;
    const m = store.place(kind, x, z, r);
    if (m) game.spend(MACHINES[kind].cost);
    return m;
  };

  const input = {
    onHover: (x: number, z: number) => {
      setHover((h) => (h && h[0] === x && h[1] === z ? h : [x, z]));
      const d = drag.current;
      if (!d || tool !== 'conveyor') return;
      // Step tile by tile from the last belt towards the cursor.
      while (d.x !== x || d.z !== z) {
        const dx = Math.sign(x - d.x);
        const dz = Math.sign(z - d.z);
        const step: [number, number] = Math.abs(x - d.x) >= Math.abs(z - d.z) ? [dx, 0] : [0, dz];
        const r: Rot = step[0] === 1 ? 0 : step[1] === 1 ? 1 : step[0] === -1 ? 2 : 3;
        store.setRot(d.id, r);
        const m = place('conveyor', d.x + step[0], d.z + step[1], r);
        if (!m) {
          drag.current = null;
          return;
        }
        d.x += step[0];
        d.z += step[1];
        d.id = m.id;
        setRot(r);
      }
    },
    onLeave: () => setHover(null),
    onDown: (x: number, z: number) => {
      const it = store.getSnapshot().open;
      if (!it || !tool) return;
      if (tool === 'remove') {
        const m = machineAt(it, x, z);
        if (m && store.remove(m.id)) game.refund(InteriorStore.refundOf(m));
        return;
      }
      const m = place(tool, x, z, rot);
      if (m && tool === 'conveyor') drag.current = { x, z, id: m.id };
    },
    onUp: () => {
      drag.current = null;
    },
  };

  // Releasing anywhere ends a belt drag.
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // Keyboard shortcuts while the view is open.
  useEffect(() => {
    if (!interior) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyR') setRot((r) => (((r + 1) % 4) as Rot));
      else if (e.code === 'Escape') {
        if (tool) setTool(null);
        else store.close();
      } else if (e.code === 'Delete' || e.code === 'KeyX') setTool('remove');
      else if (/^Digit[1-9]$/.test(e.code)) {
        const k = catalogue[Number(e.code.slice(5)) - 1];
        if (k) setTool(k);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [interior, tool, catalogue, store]);

  if (!interior) return null;

  let ghost: Ghost | null = null;
  if (tool && hover) {
    ghost =
      tool === 'remove'
        ? { kind: 'remove', x: hover[0], z: hover[1], rot, problem: null }
        : { kind: tool, x: hover[0], z: hover[1], rot, problem: problemAt(tool, hover[0], hover[1]) };
  }
  const removeTarget = tool === 'remove' && hover ? machineAt(interior, hover[0], hover[1]) : null;
  const name = INDUSTRY_NAME[interior.type] ?? 'Ipar';
  const hint =
    tool === 'remove'
      ? 'Bontás: kattints egy gépre (az ár felét visszakapod).'
      : tool
        ? `${MACHINES[tool].hint} · Forgatás: R (${ROT_LABEL[rot]})`
        : gates.length
          ? 'Válassz egy gépet az alsó sávból. A kék mezők a kapuk: ide vezesd a futószalagot.'
          : 'Válassz egy gépet az alsó sávból. Kapu még nincs: építs vasútállomást az ipar oldalára.';

  return (
    <div className="iv" onContextMenu={(e) => e.preventDefault()}>
      <Canvas shadows="soft" camera={{ position: [0, 13, 12.5], fov: 45, near: 0.1, far: 200 }} style={{ position: 'absolute', inset: 0 }}>
        <Lights />
        <InteriorScene interior={interior} gates={gates} ghost={ghost} removeTarget={removeTarget} input={input} />
        <OrbitControls
          makeDefault
          target={[0, 0, 1.8]}
          maxPolarAngle={Math.PI / 2.3}
          minDistance={6}
          maxDistance={30}
          // Left button builds; right drag orbits, wheel / middle zooms.
          mouseButtons={{ LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        />
      </Canvas>

      <div className="iv__top">
        <span className="iv__title">🏭 {name} — belső nézet</span>
        <span className="iv__money">${money}</span>
        <button type="button" className="iv__close" onClick={() => store.close()} title="Vissza a térképre (Esc)">
          ✕ Térkép
        </button>
      </div>

      <div className="iv__bar">
        <div className="iv__tools">
          {catalogue.map((k, i) => {
            const d = MACHINES[k];
            return (
              <button
                key={k}
                type="button"
                className={'iv__tool' + (tool === k ? ' is-active' : '') + (money < d.cost ? ' is-poor' : '')}
                onClick={() => setTool(tool === k ? null : k)}
                title={`${d.hint} (${i + 1})`}
              >
                <span className="iv__icon">{d.icon}</span>
                <span className="iv__label">{d.label}</span>
                <span className="iv__cost">${d.cost}</span>
              </button>
            );
          })}
          <button type="button" className="iv__tool" onClick={() => setRot(((rot + 1) % 4) as Rot)} title="Forgatás (R)">
            <span className="iv__icon">🔄</span>
            <span className="iv__label">Forgatás</span>
            <span className="iv__cost">{ROT_LABEL[rot]}</span>
          </button>
          <button
            type="button"
            className={'iv__tool' + (tool === 'remove' ? ' is-active is-danger' : '')}
            onClick={() => setTool(tool === 'remove' ? null : 'remove')}
            title="Bontás (Del / X)"
          >
            <span className="iv__icon">🚜</span>
            <span className="iv__label">Bontás</span>
            <span className="iv__cost">½ vissza</span>
          </button>
        </div>
        <div className="iv__hint">{hint}</div>
      </div>
    </div>
  );
}
