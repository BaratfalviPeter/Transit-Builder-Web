/**
 * Structures — bridges and tunnels (sim/structures.ts), and the placement
 * preview of the Híd / Alagút tools.
 *
 * Bridge: a concrete deck at the abutments' height from one abutment's edge
 * to the other's, a pillar under every spanned cell (down to the ground or
 * the river bed), railings; a road surface with a centre line when it
 * carries a road (a rail is drawn by Rails.tsx at the deck height).
 * Tunnel: a stone portal at each end (where the span begins), opening into
 * the hill / under the road; what runs inside is not drawn.
 *
 * Built in world units from the cell grid ((x − half)·cellSize); one small
 * group of boxes per structure — there are only a handful.
 */

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { axisOf, CellType, floorOf, interiorOf, isUnderpass, type Structure, type StructureKind, type TerrainMap } from '../sim';
import { CELL_STYLE } from './terrainStyle';
import { patchCloudShadows } from './cloudShadows';
import { groundAtGrid } from './railGeometry';
import { WATER_LEVEL } from './TerrainSurface';
import './stations.css';

const FLAT_TOP = CELL_STYLE[CellType.Empty].scaleY;
/** Deck top above the abutments' ground (the road / rail surface sits here). */
export const DECK_LIFT = 0.03;
const DECK_T = 0.11;

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  patchCloudShadows(m);
  return m;
};
const M = {
  concrete: std('#b9b3a6'),
  concreteDark: std('#9a9488'),
  rail: std('#5f656d', { roughness: 0.5, metalness: 0.4 }),
  asphalt: std('#3a3d42', { roughness: 1 }),
  line: new THREE.MeshBasicMaterial({ color: '#e8e4d6' }),
  stone: std('#8d877c'),
  stoneDark: std('#6f6a61'),
  hole: new THREE.MeshBasicMaterial({ color: '#141518', side: THREE.DoubleSide }),
  steel: std('#4f5d63', { roughness: 0.55, metalness: 0.35 }),
  // Two-sided: the ramp solids are built by hand (winding not guaranteed).
  bank: std('#9a9488', { side: THREE.DoubleSide }),
  ramp: std('#3a3d42', { roughness: 1, side: THREE.DoubleSide }),
  lamp: new THREE.MeshBasicMaterial({ color: '#ffe3a1', toneMapped: false }),
};

/**
 * See-through ("x-ray") materials: the tunnel tube and the vehicles inside it
 * show through the hill (no depth test, drawn last).
 */
export const GHOST = {
  tube: new THREE.MeshBasicMaterial({ color: '#bcd8ff', transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  lines: new THREE.LineBasicMaterial({ color: '#dcebff', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
  vehicle: new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
};
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** The plan the Híd / Alagút tool shows while dragging. */
export interface StructPlan {
  kind: StructureKind;
  a: [number, number];
  b: [number, number];
  problem: string | null;
  cost: number;
}

type V3 = [number, number, number];
function Box({ p, s, m, rotY = 0 }: { p: V3; s: V3; m: THREE.Material; rotY?: number }) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} rotation-y={rotY} castShadow receiveShadow />;
}

export function Structures({ map, cellSize }: { map: TerrainMap; cellSize: number }) {
  const list = map.structures ?? [];
  if (!list.length) return null;
  return (
    <group>
      {list.map((s) => (s.kind === 'bridge' ? <Bridge key={s.id} map={map} cellSize={cellSize} s={s} /> : <Tunnel key={s.id} map={map} cellSize={cellSize} s={s} />))}
    </group>
  );
}

/** Local frame of a span: centre, length, yaw (+x of the group runs a → b). */
function frameOf(map: TerrainMap, s: Pick<Structure, 'a' | 'b'>, cellSize: number) {
  const half = (map.size - 1) / 2;
  const [dx, dz] = axisOf(s);
  const cx = (s.a[0] + s.b[0]) / 2, cz = (s.a[1] + s.b[1]) / 2;
  const len = Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]) - 1; // spanned cells
  return { pos: [(cx - half) * cellSize, 0, (cz - half) * cellSize] as V3, len, yaw: Math.atan2(-dz, dx) };
}

/**
 * The deck's side profile (x along the span, y up), extruded across its
 * width: flat on top; underneath, an arch over each bay between the piers.
 */
function deckGeometry(len: number, top: number, bays: number, rise: number, width: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const x0 = -len / 2, x1 = len / 2, under = top - DECK_T;
  sh.moveTo(x0, top);
  sh.lineTo(x1, top);
  sh.lineTo(x1, under - rise);
  const bay = len / bays;
  for (let k = bays - 1; k >= 0; k--) {
    const a = x0 + bay * (k + 1), b = x0 + bay * k;
    // From pier a back to pier b: up to the crown and down again (half an ellipse).
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      sh.lineTo(a + (b - a) * t, under - rise + Math.sin(Math.PI * t) * rise);
    }
  }
  sh.lineTo(x0, top);
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  return g;
}

function Bridge({ map, cellSize, s }: { map: TerrainMap; cellSize: number; s: Structure }) {
  const parts = useMemo(() => {
    const { pos, len, yaw } = frameOf(map, s, cellSize);
    const top = FLAT_TOP + s.level + DECK_LIFT;
    const rail = s.carries === 'rail';
    const W = rail ? 0.78 : 1;
    const cells = interiorOf(s);
    const bottomAt = (x: number, z: number) => (map.cells[x][z] === CellType.Water ? WATER_LEVEL - 0.3 : groundAtGrid(map, x, z) - 0.05);
    // The lowest ground under the span: how deep the arches may reach.
    const low = Math.min(...cells.map(([x, z]) => bottomAt(x, z)));
    const bays = Math.max(1, Math.round(len / 2.4));
    const rise = Math.max(0, Math.min(0.22, len / bays / 4, top - DECK_T - low - 0.12));
    const deck = deckGeometry(len, top, bays, rise, W);
    // Piers between the bays, down to the ground / river bed under them.
    const piers: Array<{ t: number; g: number }> = [];
    for (let k = 1; k < bays; k++) {
      const t = -len / 2 + (len * k) / bays;
      const ci = Math.min(cells.length - 1, Math.max(0, Math.round(t + (cells.length - 1) / 2)));
      piers.push({ t, g: bottomAt(cells[ci][0], cells[ci][1]) });
    }
    return { pos, len, yaw, top, W, rail, deck, piers, spring: top - DECK_T - rise, ends: [s.a, s.b].map(([x, z]) => bottomAt(x, z)) };
  }, [map, s, cellSize]);
  const { pos, len, yaw, top, W, rail, deck, piers, spring, ends } = parts;
  return (
    <group position={pos} rotation-y={yaw} scale={cellSize}>
      <mesh geometry={deck} material={M.concrete} castShadow receiveShadow />
      {/* piers with a cap */}
      {piers.map(({ t, g }) => {
        const h = spring - g;
        if (h <= 0.02) return null;
        return (
          <group key={t}>
            <Box p={[t, g + h / 2, 0]} s={[0.2, h, W * 0.8]} m={M.concreteDark} />
            <Box p={[t, spring - 0.02, 0]} s={[0.28, 0.05, W + 0.04]} m={M.concrete} />
          </group>
        );
      })}
      {/* bridge heads at both ends */}
      {[-1, 1].map((sd, i) => {
        const h = top - ends[i];
        return h > 0.02 ? <Box key={sd} p={[(sd * len) / 2, ends[i] + h / 2, 0]} s={[0.14, h, W + 0.12]} m={M.concreteDark} /> : null;
      })}
      {rail ? <Truss len={len} top={top} W={W} /> : <Parapets len={len} top={top} W={W} />}
      {/* road surface + centre dashes */}
      {s.carries === 'road' && (
        <>
          <Box p={[0, top + 0.004, 0]} s={[len, 0.008, 0.84]} m={M.asphalt} />
          {Array.from({ length: Math.max(1, Math.floor(len / 0.26)) }, (_, k) => (
            <Box key={k} p={[-len / 2 + 0.13 + k * 0.26, top + 0.01, 0]} s={[0.14, 0.004, 0.032]} m={M.line} />
          ))}
        </>
      )}
    </group>
  );
}

/** Road bridge: low concrete parapets with a coping and small lamp posts at the ends. */
function Parapets({ len, top, W }: { len: number; top: number; W: number }) {
  return (
    <group>
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <Box p={[0, top + 0.045, (sd * W) / 2]} s={[len, 0.09, 0.05]} m={M.concrete} />
          <Box p={[0, top + 0.095, (sd * W) / 2]} s={[len, 0.015, 0.07]} m={M.concreteDark} />
          {/* lamps at the span's ends, just outside the parapet (off the road) */}
          {[-1, 1].map((e) => (
            <group key={e} position={[(e * len) / 2 - e * 0.06, top, (sd * (W + 0.12)) / 2]}>
              <Box p={[0, 0.2, 0]} s={[0.025, 0.4, 0.025]} m={M.rail} />
              <Box p={[0, 0.41, 0]} s={[0.06, 0.04, 0.06]} m={M.lamp} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Rail bridge: a steel through truss on each side (chords, posts, diagonals) with cross bracing on top. */
function Truss({ len, top, W }: { len: number; top: number; W: number }) {
  const H = 0.85; // tall enough for the trains (they're ~0.6 high)
  const panels = Math.max(2, Math.round(len / 0.5));
  const pw = len / panels;
  const diag = Math.hypot(pw, H);
  const ang = Math.atan2(H, pw);
  return (
    <group>
      {[-1, 1].map((sd) => {
        const z = (sd * W) / 2;
        return (
          <group key={sd}>
            <Box p={[0, top + 0.02, z]} s={[len, 0.04, 0.045]} m={M.steel} />
            <Box p={[0, top + H, z]} s={[len - pw, 0.04, 0.045]} m={M.steel} />
            {Array.from({ length: panels + 1 }, (_, k) => {
              const x = -len / 2 + k * pw;
              const inner = k > 0 && k < panels;
              return inner ? <Box key={`v${k}`} p={[x, top + H / 2, z]} s={[0.03, H, 0.035]} m={M.steel} /> : null;
            })}
            {Array.from({ length: panels }, (_, k) => {
              const x = -len / 2 + (k + 0.5) * pw;
              // Diagonals lean towards the middle of the span (a Pratt / Howe-like look).
              const a = k < panels / 2 ? ang : -ang;
              return (
                <mesh key={`d${k}`} geometry={BOX} material={M.steel} position={[x, top + H / 2, z]} rotation-z={a} scale={[diag, 0.028, 0.03]} castShadow />
              );
            })}
          </group>
        );
      })}
      {/* top cross bracing */}
      {Array.from({ length: panels - 1 }, (_, k) => (
        <Box key={k} p={[-len / 2 + (k + 1) * pw, top + H, 0]} s={[0.025, 0.025, W]} m={M.steel} />
      ))}
    </group>
  );
}

/** An arched opening (x across, y up), for extruding portals and the tunnel tube. */
function archShape(w: number, spring: number, rise: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0);
  sh.lineTo(w / 2, 0);
  sh.lineTo(w / 2, spring);
  for (let i = 0; i <= 16; i++) {
    const a = (Math.PI * i) / 16;
    sh.lineTo((Math.cos(a) * w) / 2, spring + Math.sin(a) * rise);
  }
  sh.lineTo(-w / 2, 0);
  return sh;
}

const MOUTH = { w: 0.6, spring: 0.24, rise: 0.2 };

/** Stone portal facade: a wall with an arched hole, a keystone and a cornice (faces −x). */
const PORTAL_GEOM = (() => {
  const wall = new THREE.Shape();
  wall.moveTo(-0.52, 0);
  wall.lineTo(0.52, 0);
  wall.lineTo(0.52, 0.56);
  wall.lineTo(-0.52, 0.56);
  wall.lineTo(-0.52, 0);
  const hole = archShape(MOUTH.w, MOUTH.spring, MOUTH.rise);
  wall.holes.push(new THREE.Path(hole.getPoints()));
  const g = new THREE.ExtrudeGeometry(wall, { depth: 0.12, bevelEnabled: false });
  // Shape x → world z (across), extrusion z → world x (into the span).
  g.rotateY(-Math.PI / 2);
  g.translate(0.12, 0, 0);
  return g;
})();
/** The dark inside of the mouth (a short arched tube into the hill). */
/** The stone lining just inside the mouth (an arched ring, 0.3 deep), so the arch has walls. */
const LINING_GEOM = (() => {
  const ring = archShape(MOUTH.w + 0.1, MOUTH.spring, MOUTH.rise + 0.05);
  ring.holes.push(new THREE.Path(archShape(MOUTH.w, MOUTH.spring, MOUTH.rise).getPoints()));
  const g = new THREE.ExtrudeGeometry(ring, { depth: 0.3, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(0.42, 0, 0);
  return g;
})();
/** The voussoir ring round the opening, standing a little proud of the facade. */
const VOUSSOIR_GEOM = (() => {
  const ring = archShape(MOUTH.w + 0.16, MOUTH.spring, MOUTH.rise + 0.08);
  ring.holes.push(new THREE.Path(archShape(MOUTH.w, MOUTH.spring, MOUTH.rise).getPoints()));
  const g = new THREE.ExtrudeGeometry(ring, { depth: 0.03, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  return g;
})();
/** The dark inside of a hill tunnel, past the lining. */
const MOUTH_GEOM = (() => {
  const g = new THREE.ExtrudeGeometry(archShape(MOUTH.w, MOUTH.spring, MOUTH.rise), { depth: 0.1, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(0.52, 0, 0);
  return g;
})();

/** A solid with a flat bottom at y0 and its top corners at the given heights (x0..x1 × z0..z1). */
function wedgeGeometry(x0: number, x1: number, z0: number, z1: number, y0: number, top: [number, number, number, number]): THREE.BufferGeometry {
  // top: [x0z0, x1z0, x1z1, x0z1]
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, top[0], z0], [x1, top[1], z0], [x1, top[2], z1], [x0, top[3], z1],
  ];
  const f = [4, 7, 6, 4, 6, 5, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const pos: number[] = [];
  for (const i of f) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A tunnel portal; `low`: an underpass — squashed to the cutting's depth, flush with the ground (nothing on the road above). */
function Portal({ dark, low }: { dark: boolean; low?: number }) {
  if (low !== undefined) {
    return (
      <group scale={[1, low / 0.56, 1]}>
        <mesh geometry={PORTAL_GEOM} material={M.stone} castShadow receiveShadow />
        <mesh geometry={VOUSSOIR_GEOM} material={M.stoneDark} castShadow />
        <mesh geometry={LINING_GEOM} material={M.stoneDark} receiveShadow />
      </group>
    );
  }
  return (
    <group>
      <mesh geometry={PORTAL_GEOM} material={M.stone} castShadow receiveShadow />
      <mesh geometry={VOUSSOIR_GEOM} material={M.stoneDark} castShadow />
      <mesh geometry={LINING_GEOM} material={M.stoneDark} receiveShadow />
      {dark && <mesh geometry={MOUTH_GEOM} material={M.hole} />}
      {/* keystone + cornice */}
      <Box p={[-0.02, MOUTH.spring + MOUTH.rise + 0.06, 0]} s={[0.06, 0.12, 0.11]} m={M.stoneDark} />
      <Box p={[0.05, 0.585, 0]} s={[0.18, 0.05, 1.12]} m={M.stoneDark} />
      {/* wing walls, splayed out along the cutting */}
      {[-1, 1].map((w) => (
        <mesh key={w} geometry={BOX} material={M.stone} position={[-0.14, 0.13, w * 0.6]} rotation-y={w * 0.4} scale={[0.32, 0.26, 0.07]} castShadow receiveShadow />
      ))}
    </group>
  );
}

function Tunnel({ map, cellSize, s }: { map: TerrainMap; cellSize: number; s: Structure }) {
  const { pos, len, yaw } = frameOf(map, s, cellSize);
  const under = isUnderpass(map, s);
  // An underpass runs UNDERPASS_DEPTH below the ground, its abutments are cuttings down to it.
  const floor = FLAT_TOP + floorOf(map, s);
  const ground = FLAT_TOP + s.level;
  const tube = useMemo(() => {
    // The see-through tube: the arch section along the whole span.
    const g = new THREE.ExtrudeGeometry(archShape(MOUTH.w, MOUTH.spring, MOUTH.rise), { depth: len, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    return { g, edges: new THREE.EdgesGeometry(g, 30) };
  }, [len]);
  return (
    <group position={pos} rotation-y={yaw} scale={cellSize}>
      {/* the tunnel seen through the hill / the road above (x-ray) */}
      <group position={[0, floor, 0]}>
        <mesh geometry={tube.g} material={GHOST.tube} renderOrder={18} />
        <lineSegments geometry={tube.edges} material={GHOST.lines} renderOrder={19} />
      </group>
      {[-1, 1].map((sd) => (
        <group key={sd} position={[(sd * len) / 2, floor, 0]} rotation-y={sd > 0 ? Math.PI : 0}>
          <Portal dark={!under} low={under ? ground - floor : undefined} />
          {under && <Cutting floor={floor} ground={ground} road={s.carries === 'road'} />}
        </group>
      ))}
    </group>
  );
}

/**
 * An underpass's cutting in its abutment cell (local: the portal at x = 0,
 * the cell runs to x = −1): a ramp from the ground down to the floor, a
 * retaining wall either side, a road surface when it carries a road.
 */
function Cutting({ floor, ground, road }: { floor: number; ground: number; road: boolean }) {
  const geo = useMemo(() => {
    const d = ground - floor; // depth at the portal (y measured from the floor: 0)
    // Ramp solid: from the cell's outer edge (x = −1, top at d) to the portal (x = 0, top at 0).
    const ramp = wedgeGeometry(-1, 0, -0.5, 0.5, -1.2, [d, 0, 0, d]);
    const asphalt = wedgeGeometry(-1, 0, -0.42, 0.42, -0.02, [d + 0.012, 0.012, 0.012, d + 0.012]);
    // Retaining walls: their top flush with the ground, their foot on the ramp.
    const walls = [-1, 1].map((sd) => wedgeGeometry(-1, 0.06, sd * 0.5 - 0.05, sd * 0.5 + 0.05, -0.1, [d + 0.06, d + 0.06, d + 0.06, d + 0.06]));
    return { ramp, asphalt, walls };
  }, [floor, ground]);
  return (
    <group>
      <mesh geometry={geo.ramp} material={M.bank} receiveShadow />
      {road && <mesh geometry={geo.asphalt} material={M.ramp} receiveShadow />}
      {geo.walls.map((g, i) => (
        <mesh key={i} geometry={g} material={M.concrete} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** The Híd / Alagút tool's plan: the cells it spans (green / red) and a label. */
export function StructurePreview({ map, cellSize, plan, canAfford }: { map: TerrainMap; cellSize: number; plan: StructPlan; canAfford: boolean }) {
  const half = (map.size - 1) / 2;
  const ok = !plan.problem && canAfford;
  const color = ok ? '#46d36a' : '#e5484d';
  const span = interiorOf({ a: plan.a, b: plan.b });
  const ends = plan.a[0] === plan.b[0] && plan.a[1] === plan.b[1] ? [plan.a] : [plan.a, plan.b];
  const y = (x: number, z: number) => (groundAtGrid(map, x, z) + 0.06) * cellSize;
  const mid: V3 = [((plan.a[0] + plan.b[0]) / 2 - half) * cellSize, y(plan.a[0], plan.a[1]) + 1.2 * cellSize, ((plan.a[1] + plan.b[1]) / 2 - half) * cellSize];
  const icon = plan.kind === 'bridge' ? '🌉 Híd' : '🚇 Alagút';
  return (
    <group>
      {span.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[(x - half) * cellSize, y(x, z), (z - half) * cellSize]} rotation-x={-Math.PI / 2} renderOrder={12}>
          <planeGeometry args={[cellSize * 0.92, cellSize * 0.92]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} depthTest={false} />
        </mesh>
      ))}
      {ends.map(([x, z]) => (
        <mesh key={`e${x},${z}`} position={[(x - half) * cellSize, y(x, z), (z - half) * cellSize]} rotation-x={-Math.PI / 2} renderOrder={12}>
          <ringGeometry args={[cellSize * 0.28, cellSize * 0.42, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
        </mesh>
      ))}
      <Html position={mid} center style={{ pointerEvents: 'none' }}>
        <div className={'station-tip' + (ok ? '' : ' is-bad')}>
          {plan.problem ?? (canAfford ? `${icon} · ${span.length} cella · $${plan.cost.toLocaleString('hu-HU')}` : `${icon} · nincs elég pénz ($${plan.cost.toLocaleString('hu-HU')})`)}
        </div>
      </Html>
    </group>
  );
}
