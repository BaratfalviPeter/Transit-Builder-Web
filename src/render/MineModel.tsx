/**
 * MineModel — a modernised 1970s open-pit mine on a 3×3-cell lot, styled to
 * match PowerPlantModel (concrete, slate-blue steel halls, rust/blue/grey
 * pipes, yellow safety rails).
 *
 * Built in CELL UNITS: the base slab is exactly [3, 0.1, 3] centered on the
 * origin, resting on Y=0; the caller scales the group by `cellSize`.
 *
 * Because the model sits ON the terrain (nothing can go below Y=0), the yard is
 * a raised concrete deck (top at DECK) walled by segmented concrete blocks, and
 * the quarry pit is cut into that deck as stepped terraces down to the slab.
 *
 * Layout (−Z = back, +Z = front):
 *   - front/centre: stepped quarry pit, dark tunnel portal + warm lamp at the
 *     bottom, yellow railings around the rim;
 *   - back-left: slate-blue processing hall with glowing windows, rust sliding
 *     door, roof vents/stacks, two steel silos beside it;
 *   - back-middle: a steel headframe with a spinning sheave;
 *   - back-right: heavy crusher with a pounding hammer, two counter-rotating
 *     gears and a smoking chimney;
 *   - rust/blue/grey pipes between hall and crusher; a cart track across the
 *     yard with two shuttling ore carts;
 *   - two steel conveyors climbing from the pit floor to the hall and crusher.
 *
 * Animations (useFrame): hammer lift-and-slam, gears, stones on both belts
 * (loop bottom→top), crusher smoke, sheave, ore carts. `phase` desyncs
 * multiple mines.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Elbow, Pipe, Steam } from './PowerPlantModel';

type V3 = [number, number, number];

export interface MineModelProps {
  /** World position of the lot center (the model rests on this Y). */
  position?: V3;
  /** World units per cell — the model is built in cell units. */
  scale?: number;
  /** Rotation around Y (radians), e.g. a multiple of π/2. */
  rotationY?: number;
  /** Animation time offset (seconds). */
  phase?: number;
}

// --- Shared materials (same palette as the power plant) ---------------------

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  slab: std('#b9b2a3', { roughness: 0.95 }),
  deck: std('#cfc6b4', { roughness: 0.95 }),
  block: std('#d9d6cf', { roughness: 0.95 }),
  blockAlt: std('#c3bfb6', { roughness: 0.95 }),
  terraceA: std('#4b4d52', { roughness: 1, flatShading: true }),
  terraceB: std('#6b6259', { roughness: 1, flatShading: true }),
  pitFloor: std('#3a3734', { roughness: 1 }),
  hall: std('#4a5262'),
  hallDark: std('#363c48'),
  roof: std('#3d4452'),
  window: new THREE.MeshBasicMaterial({ color: '#ffd36b', toneMapped: false }),
  lampGlow: new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false }),
  tunnel: new THREE.MeshBasicMaterial({ color: '#120d08' }),
  door: std('#8a3f26'),
  rust: std('#8f4a2f', { roughness: 0.6, metalness: 0.2 }),
  rustDark: std('#6a3420', { roughness: 0.7, metalness: 0.3 }),
  pipeGrey: std('#9aa0a7', { roughness: 0.5, metalness: 0.35 }),
  pipeBlue: std('#4f7fae', { roughness: 0.5, metalness: 0.2 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  steelBlue: std('#566273', { roughness: 0.6, metalness: 0.4 }),
  gear: std('#8b9097', { roughness: 0.45, metalness: 0.6 }),
  frame: std('#2f333a', { roughness: 0.6, metalness: 0.4 }),
  belt: std('#2a2c30'),
  black: std('#1f2227', { roughness: 0.7 }),
  yellow: std('#e8c13a', { roughness: 0.5 }),
  wood: std('#6e4a2a'),
  stone: std('#8a8a88', { roughness: 1, flatShading: true }),
  ore: std('#6d6a66', { roughness: 1, flatShading: true }),
};

const STONE_GEOM = new THREE.IcosahedronGeometry(1, 0);

// --- Layout constants (lot units) ------------------------------------------------

/** Slab top / pit floor height. */
const FLOOR = 0.1;
/** Top of the raised concrete deck. */
const DECK = 0.45;
/** Inner edge of the perimeter block wall. */
const WALL_IN = 1.4;

/** Pit: centre and half-extents of the opening in the deck. */
const PIT_CX = 0;
const PIT_CZ = 0.55;
const PIT_HX = 0.85;
const PIT_HZ = 0.7;
/** Terrace count, inset per step and drop per step. */
const STEPS = 3;
const STEP_IN = 0.14;
const STEP_H = (DECK - FLOOR) / (STEPS + 1);

/** Ground height (top surface) at a lot point — used for trestle feet. */
function groundY(x: number, z: number): number {
  const dx = PIT_HX - Math.abs(x - PIT_CX);
  const dz = PIT_HZ - Math.abs(z - PIT_CZ);
  if (dx <= 0 || dz <= 0) return DECK;
  const k = Math.floor(Math.min(dx, dz) / STEP_IN);
  return k >= STEPS ? FLOOR : DECK - (k + 1) * STEP_H;
}

/** Processing hall (back-left). */
const HALL = { x: -0.85, z: -1.0, w: 1.0, d: 0.75, h: 0.7 };
/** Crusher body (back-right), centre + size. */
const CR = { x: 0.95, z: -0.95, w: 0.6, d: 0.5, h: 0.45 };
/** Cart track depth. */
const TRACK_Z = -0.4;

// --- Helpers ----------------------------------------------------------------------------

/** A thin rod between two arbitrary points (shared unit box, oriented). */
function Rod({ from, to, w = 0.015, m }: { from: V3; to: V3; w?: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const d = b.clone().sub(a);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      d.normalize(),
    );
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);
  return (
    <mesh geometry={BOX} material={m} position={pos} quaternion={quat} scale={[w, len, w]} castShadow />
  );
}

/** Yellow safety railing along a straight line on a surface at height y. */
function Railing({ from, to, y }: { from: [number, number]; to: [number, number]; y: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const posts = Math.max(2, Math.round(len / 0.22) + 1);
  return (
    <group>
      <Rod from={[from[0], y + 0.12, from[1]]} to={[to[0], y + 0.12, to[1]]} w={0.014} m={M.yellow} />
      <Rod from={[from[0], y + 0.065, from[1]]} to={[to[0], y + 0.065, to[1]]} w={0.01} m={M.yellow} />
      {Array.from({ length: posts }).map((_, i) => {
        const f = i / (posts - 1);
        const x = from[0] + (to[0] - from[0]) * f;
        const z = from[1] + (to[1] - from[1]) * f;
        return <Box key={i} p={[x, y + 0.06, z]} s={[0.014, 0.12, 0.014]} m={M.yellow} />;
      })}
    </group>
  );
}

// --- Model ----------------------------------------------------------------------------------

export function MineModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: MineModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <BaseAndDeck />
      <QuarryPit />
      <ProcessingHall />
      <Silos />
      <Headframe phase={phase} />
      <Crusher phase={phase} />
      <Piping />
      <CartTrack phase={phase} />
      {/* Conveyors: pit floor → hall front, pit floor → crusher front */}
      <Conveyor
        a={[-0.18, FLOOR + 0.04, 0.48]}
        b={[-0.62, DECK + 0.5, HALL.z + HALL.d / 2 + 0.02]}
        legs={[0.3, 0.66]}
        stones={8}
        speed={0.13}
        phase={phase}
      />
      <Conveyor
        a={[0.18, FLOOR + 0.04, 0.48]}
        b={[0.82, DECK + 0.42, CR.z + CR.d / 2 + 0.02]}
        legs={[0.3, 0.66]}
        stones={8}
        speed={0.15}
        phase={phase + 0.9}
      />
      {/* Warm work-area light between the hall and the crusher */}
      <pointLight position={[0.1, DECK + 0.6, -0.45]} color="#ffaa00" intensity={2} distance={5} decay={1} />
      {/* Crusher chimney smoke */}
      <Steam origin={[1.15, DECK + 1.12, -1.1]} count={5} rise={0.9} spread={0.18} size={0.07} color="#7d8087" phase={phase} />
    </group>
  );
}

// --- 1. Base, deck + perimeter --------------------------------------------------------------

function BaseAndDeck() {
  const deckH = DECK - FLOOR;
  const deckY = FLOOR + deckH / 2;
  const x0 = PIT_CX - PIT_HX;
  const x1 = PIT_CX + PIT_HX;
  const z0 = PIT_CZ - PIT_HZ;
  const z1 = PIT_CZ + PIT_HZ;

  // Segmented concrete blocks around the outer edge (the deck's side wall).
  const blocks = useMemo(() => {
    const out: Array<{ p: V3; s: V3; alt: boolean }> = [];
    const n = 10;
    const seg = 3 / n;
    const h = DECK - FLOOR + 0.05;
    for (let i = 0; i < n; i++) {
      const c = -1.5 + seg * (i + 0.5);
      const alt = i % 2 === 1;
      out.push({ p: [c, FLOOR + h / 2, 1.45], s: [seg - 0.015, h, 0.1], alt });
      out.push({ p: [c, FLOOR + h / 2, -1.45], s: [seg - 0.015, h, 0.1], alt: !alt });
    }
    // Side walls fill between the front and back rows (z −1.4..1.4).
    const ns = 9;
    const sseg = (WALL_IN * 2) / ns;
    for (let i = 0; i < ns; i++) {
      const c = -WALL_IN + sseg * (i + 0.5);
      const alt = i % 2 === 0;
      out.push({ p: [1.45, FLOOR + h / 2, c], s: [0.1, h, sseg - 0.015], alt });
      out.push({ p: [-1.45, FLOOR + h / 2, c], s: [0.1, h, sseg - 0.015], alt: !alt });
    }
    return out;
  }, []);

  return (
    <group>
      {/* The 3×3 slab: exactly [3, 0.1, 3], bottom on Y=0. */}
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.slab} />
      {/* Deck pieces around the pit opening */}
      <Box p={[0, deckY, (-WALL_IN + z0) / 2]} s={[WALL_IN * 2, deckH, z0 + WALL_IN]} m={M.deck} cast />
      <Box p={[0, deckY, (z1 + WALL_IN) / 2]} s={[WALL_IN * 2, deckH, WALL_IN - z1]} m={M.deck} cast />
      <Box p={[(-WALL_IN + x0) / 2, deckY, PIT_CZ]} s={[x0 + WALL_IN, deckH, z1 - z0]} m={M.deck} cast />
      <Box p={[(x1 + WALL_IN) / 2, deckY, PIT_CZ]} s={[WALL_IN - x1, deckH, z1 - z0]} m={M.deck} cast />
      {blocks.map((b, i) => (
        <Box key={i} p={b.p} s={b.s} m={b.alt ? M.blockAlt : M.block} cast />
      ))}
      {/* Rock + ore heaps on the free front corners */}
      <mesh material={M.ore} position={[1.13, DECK + 0.09, 1.0]} castShadow>
        <coneGeometry args={[0.18, 0.18, 6]} />
      </mesh>
      <mesh material={M.stone} position={[1.05, DECK + 0.06, 0.62]} castShadow>
        <coneGeometry args={[0.12, 0.12, 5]} />
      </mesh>
      <mesh material={M.ore} position={[-1.12, DECK + 0.07, 1.05]} castShadow>
        <coneGeometry args={[0.14, 0.14, 6]} />
      </mesh>
      {/* Front railing on top of the block wall */}
      <Railing from={[-1.38, 1.45]} to={[1.38, 1.45]} y={DECK + 0.05} />
    </group>
  );
}

// --- 2. Stepped quarry pit -------------------------------------------------------------------------

function QuarryPit() {
  // Ring k: band between the opening inset k*STEP_IN and (k+1)*STEP_IN, its top
  // dropping one STEP_H per ring.
  const rings = useMemo(() => {
    const out: Array<{ p: V3; s: V3; m: THREE.Material }> = [];
    for (let k = 0; k < STEPS; k++) {
      const top = DECK - (k + 1) * STEP_H;
      const h = top - FLOOR;
      const y = FLOOR + h / 2;
      const ox = PIT_HX - k * STEP_IN;
      const oz = PIT_HZ - k * STEP_IN;
      const ix = ox - STEP_IN;
      const iz = oz - STEP_IN;
      const m = k % 2 === 0 ? M.terraceA : M.terraceB;
      // back + front bands (full outer width), left + right bands (inner depth)
      out.push({ p: [PIT_CX, y, PIT_CZ - (oz + iz) / 2], s: [ox * 2, h, STEP_IN], m });
      out.push({ p: [PIT_CX, y, PIT_CZ + (oz + iz) / 2], s: [ox * 2, h, STEP_IN], m });
      out.push({ p: [PIT_CX - (ox + ix) / 2, y, PIT_CZ], s: [STEP_IN, h, iz * 2], m });
      out.push({ p: [PIT_CX + (ox + ix) / 2, y, PIT_CZ], s: [STEP_IN, h, iz * 2], m });
    }
    return out;
  }, []);

  // A few loose boulders on the terraces.
  const boulders: Array<[number, number, number]> = [
    [-0.62, 0.62, 0.05],
    [0.6, 0.85, 0.04],
    [-0.3, 1.0, 0.035],
    [0.42, 0.18, 0.04],
  ];

  const floorX = PIT_HX - STEPS * STEP_IN;
  const floorZ = PIT_HZ - STEPS * STEP_IN;
  const backFace = PIT_CZ - floorZ; // z of the innermost back wall face
  const portalH = 0.2;

  return (
    <group>
      {rings.map((r, i) => (
        <Box key={i} p={r.p} s={r.s} m={r.m} cast />
      ))}
      {/* Dark pit floor */}
      <Box p={[PIT_CX, FLOOR + 0.004, PIT_CZ]} s={[floorX * 2, 0.008, floorZ * 2]} m={M.pitFloor} />
      {boulders.map(([x, z, r]) => (
        <mesh
          key={`${x}${z}`}
          geometry={STONE_GEOM}
          material={M.stone}
          position={[x, groundY(x, z) + r * 0.6, z]}
          scale={r}
          rotation={[x * 3, z * 5, 0]}
          castShadow
        />
      ))}

      {/* Tunnel portal in the back wall of the pit floor */}
      <group position={[PIT_CX, FLOOR, backFace]}>
        {/* Rock headwall the portal is cut into */}
        <Box p={[0, 0.15, -0.07]} s={[0.36, 0.3, 0.14]} m={M.terraceB} cast />
        {/* Dark opening + timber frame */}
        <Box p={[0, portalH / 2, 0.003]} s={[0.16, portalH, 0.006]} m={M.tunnel} />
        <Box p={[-0.095, portalH / 2, 0.005]} s={[0.03, portalH + 0.02, 0.03]} m={M.wood} cast />
        <Box p={[0.095, portalH / 2, 0.005]} s={[0.03, portalH + 0.02, 0.03]} m={M.wood} cast />
        <Box p={[0, portalH + 0.02, 0.005]} s={[0.24, 0.035, 0.04]} m={M.wood} cast />
        {/* Glow inside + lamp above the portal */}
        <Box p={[0, 0.05, 0.007]} s={[0.1, 0.06, 0.004]} m={M.lampGlow} />
        <mesh material={M.lampGlow} position={[0, portalH + 0.06, 0.03]}>
          <sphereGeometry args={[0.022, 8, 6]} />
        </mesh>
        <pointLight position={[0, portalH * 0.7, 0.12]} color="#ffb347" intensity={1.2} distance={2} decay={1} />
        {/* Mine-cart rails out of the tunnel */}
        <Box p={[-0.035, 0.012, 0.12]} s={[0.01, 0.01, 0.24]} m={M.steel} />
        <Box p={[0.035, 0.012, 0.12]} s={[0.01, 0.01, 0.24]} m={M.steel} />
      </group>

      {/* Yellow safety railings around the pit rim (on the deck) */}
      <Railing from={[PIT_CX - PIT_HX - 0.04, PIT_CZ - PIT_HZ - 0.04]} to={[PIT_CX + PIT_HX + 0.04, PIT_CZ - PIT_HZ - 0.04]} y={DECK} />
      <Railing from={[PIT_CX - PIT_HX - 0.04, PIT_CZ + PIT_HZ + 0.04]} to={[PIT_CX + PIT_HX + 0.04, PIT_CZ + PIT_HZ + 0.04]} y={DECK} />
      <Railing from={[PIT_CX - PIT_HX - 0.04, PIT_CZ - PIT_HZ - 0.04]} to={[PIT_CX - PIT_HX - 0.04, PIT_CZ + PIT_HZ + 0.04]} y={DECK} />
      <Railing from={[PIT_CX + PIT_HX + 0.04, PIT_CZ - PIT_HZ - 0.04]} to={[PIT_CX + PIT_HX + 0.04, PIT_CZ + PIT_HZ + 0.04]} y={DECK} />
    </group>
  );
}

// --- 3. Processing hall + silos -----------------------------------------------------------------------

function ProcessingHall() {
  const { w: W, d: D, h: H } = HALL;
  const front = D / 2 + 0.011;
  const side = W / 2 + 0.011;
  return (
    <group position={[HALL.x, DECK, HALL.z]}>
      <Box p={[0, H / 2, 0]} s={[W, H, D]} m={M.hall} cast />
      {/* Mansard roof: flat top + sloped front/back panels */}
      <Box p={[0, H + 0.1, 0]} s={[W - 0.02, 0.04, D - 0.3]} m={M.roof} cast />
      <group position={[0, H + 0.04, D / 2 - 0.08]} rotation={[0.9, 0, 0]}>
        <Box p={[0, 0, 0]} s={[W, 0.03, 0.2]} m={M.roof} cast />
      </group>
      <group position={[0, H + 0.04, -D / 2 + 0.08]} rotation={[-0.9, 0, 0]}>
        <Box p={[0, 0, 0]} s={[W, 0.03, 0.2]} m={M.roof} cast />
      </group>
      <Box p={[-W / 2 + 0.01, H + 0.06, 0]} s={[0.02, 0.12, D - 0.04]} m={M.hallDark} />
      <Box p={[W / 2 - 0.01, H + 0.06, 0]} s={[0.02, 0.12, D - 0.04]} m={M.hallDark} />
      {/* Steel pilasters on the front + side */}
      {[-0.48, -0.24, 0, 0.24, 0.48].map((px) => (
        <Box key={`f${px}`} p={[px, H / 2, D / 2 + 0.01]} s={[0.035, H, 0.02]} m={M.hallDark} />
      ))}
      {[-0.3, 0, 0.3].map((pz) => (
        <Box key={`s${pz}`} p={[-W / 2 - 0.01, H / 2, pz]} s={[0.02, H, 0.035]} m={M.hallDark} />
      ))}
      {/* Glowing square windows: upper row across the front, lower on the left */}
      {[-0.36, -0.12, 0.12, 0.36].map((px) => (
        <Box key={`u${px}`} p={[px, 0.52, front]} s={[0.09, 0.09, 0.02]} m={M.window} />
      ))}
      {[-0.36, -0.12].map((px) => (
        <Box key={`l${px}`} p={[px, 0.28, front]} s={[0.09, 0.09, 0.02]} m={M.window} />
      ))}
      {[-0.2, 0.2].flatMap((pz) =>
        [0.3, 0.52].map((py) => (
          <Box key={`sw${pz}${py}`} p={[-side, py, pz]} s={[0.02, 0.09, 0.09]} m={M.window} />
        )),
      )}
      {/* Rust sliding door + its rail */}
      <Box p={[0.3, 0.19, front]} s={[0.24, 0.38, 0.02]} m={M.door} />
      {[0.22, 0.3, 0.38].map((px) => (
        <Box key={`dr${px}`} p={[px, 0.19, front + 0.008]} s={[0.008, 0.36, 0.01]} m={M.rustDark} />
      ))}
      <Box p={[0.3, 0.4, front + 0.01]} s={[0.4, 0.02, 0.02]} m={M.frame} />
      {/* Roof vent box + two small stacks + a rust pipe loop */}
      <Box p={[-0.15, H + 0.16, 0]} s={[0.2, 0.08, 0.14]} m={M.steel} cast />
      {[-0.2, -0.13, -0.06].map((px) => (
        <Box key={`v${px}`} p={[px, H + 0.205, 0]} s={[0.04, 0.01, 0.12]} m={M.frame} />
      ))}
      {[-0.4, -0.32].map((px) => (
        <mesh key={`st${px}`} material={M.steel} position={[px, H + 0.22, -0.05]} castShadow>
          <cylinderGeometry args={[0.025, 0.028, 0.2, 10]} />
        </mesh>
      ))}
      <Pipe from={[0.1, H + 0.2, 0.05]} to={[0.4, H + 0.2, 0.05]} r={0.025} m={M.rust} />
      <Pipe from={[0.1, H + 0.12, 0.05]} to={[0.1, H + 0.2, 0.05]} r={0.025} m={M.rust} />
      <Pipe from={[0.4, H + 0.12, 0.05]} to={[0.4, H + 0.2, 0.05]} r={0.025} m={M.rust} />
      {/* Downpipe on the front-left corner */}
      <Pipe from={[-W / 2 + 0.04, 0.02, D / 2 + 0.04]} to={[-W / 2 + 0.04, H, D / 2 + 0.04]} r={0.02} m={M.pipeGrey} />
    </group>
  );
}

function Silos() {
  const tanks: Array<[number, number]> = [
    [-0.15, -1.28],
    [-0.15, -1.0],
  ];
  return (
    <group>
      {tanks.map(([x, z]) => (
        <group key={z} position={[x, DECK, z]}>
          {[
            [-0.06, -0.06],
            [0.06, -0.06],
            [0.06, 0.06],
            [-0.06, 0.06],
          ].map(([lx, lz]) => (
            <Box key={`${lx}${lz}`} p={[lx, 0.06, lz]} s={[0.018, 0.12, 0.018]} m={M.frame} />
          ))}
          <mesh material={M.steel} position={[0, 0.07, 0]} castShadow>
            <coneGeometry args={[0.1, 0.06, 12]} />
          </mesh>
          <mesh material={M.steel} position={[0, 0.25, 0]} rotation={[Math.PI, 0, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.26, 14]} />
          </mesh>
          <mesh material={M.frame} position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.102, 0.008, 6, 18]} />
          </mesh>
          <mesh material={M.steel} position={[0, 0.41, 0]} castShadow>
            <coneGeometry args={[0.1, 0.07, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// --- 4. Headframe ---------------------------------------------------------------------------------------

const HF = { x: 0.25, z: -1.15, h: 0.95 };

function Headframe({ phase }: { phase: number }) {
  const sheave = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    if (sheave.current) sheave.current.rotation.z = t * 1.5;
  });
  const legs: Array<[number, number]> = [
    [-0.13, -0.11],
    [0.13, -0.11],
    [0.13, 0.11],
    [-0.13, 0.11],
  ];
  const k = 0.45; // top taper
  return (
    <group position={[HF.x, DECK, HF.z]}>
      <Box p={[0, 0.015, 0]} s={[0.32, 0.03, 0.28]} m={M.black} />
      {legs.map(([lx, lz]) => (
        <Rod key={`${lx}${lz}`} from={[lx, 0, lz]} to={[lx * k, HF.h, lz * k]} w={0.022} m={M.frame} />
      ))}
      {/* Lattice cross-bracing on front and back */}
      {[0, 0.25, 0.5, 0.75].map((f) => {
        const f2 = f + 0.25;
        const s1 = 1 - (1 - k) * f;
        const s2 = 1 - (1 - k) * f2;
        return [-0.11, 0.11].map((lz) => (
          <group key={`${f}${lz}`}>
            <Rod from={[-0.13 * s1, HF.h * f, lz * s1]} to={[0.13 * s2, HF.h * f2, lz * s2]} w={0.01} m={M.frame} />
            <Rod from={[0.13 * s1, HF.h * f, lz * s1]} to={[-0.13 * s2, HF.h * f2, lz * s2]} w={0.01} m={M.frame} />
          </group>
        ));
      })}
      <Box p={[0, HF.h, 0]} s={[0.16, 0.025, 0.14]} m={M.steel} />
      <group ref={sheave} position={[0, HF.h + 0.08, 0]}>
        <mesh material={M.black}>
          <torusGeometry args={[0.07, 0.01, 6, 18]} />
        </mesh>
        <Box p={[0, 0, 0]} s={[0.14, 0.01, 0.01]} m={M.black} />
        <Box p={[0, 0, 0]} s={[0.01, 0.14, 0.01]} m={M.black} />
      </group>
      {/* Cables down into the shaft */}
      <Rod from={[-0.07, HF.h + 0.08, 0]} to={[-0.07, 0.03, 0]} w={0.005} m={M.black} />
      <Rod from={[0.07, HF.h + 0.08, 0]} to={[0.07, 0.03, 0]} w={0.005} m={M.black} />
    </group>
  );
}

// --- 5. Crusher ------------------------------------------------------------------------------------------

/** Flat toothed gear facing ±X (rotates around its local X axis). */
function Gear({ r, teeth }: { r: number; teeth: number }) {
  return (
    <group>
      <mesh material={M.gear} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, 0.035, 18]} />
      </mesh>
      <mesh material={M.frame} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.28, r * 0.28, 0.05, 10]} />
      </mesh>
      {Array.from({ length: teeth }).map((_, i) => {
        const a = (i / teeth) * Math.PI * 2;
        return (
          <Box
            key={i}
            p={[0, Math.cos(a) * r, Math.sin(a) * r]}
            s={[0.035, r * 0.3, r * 0.3]}
            m={M.gear}
          />
        );
      })}
    </group>
  );
}

const G1_R = 0.17;
const G2_R = 0.11;

function Crusher({ phase }: { phase: number }) {
  const hammer = useRef<THREE.Group>(null);
  const g1 = useRef<THREE.Group>(null);
  const g2 = useRef<THREE.Group>(null);
  const HAM_LOW = CR.h + 0.06;
  const HAM_HIGH = CR.h + 0.32;

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    // Hammer: slow lift (70% of the cycle), then a hard accelerating slam.
    if (hammer.current) {
      const u = (t / 0.9) % 1;
      const y =
        u < 0.7
          ? HAM_LOW + (HAM_HIGH - HAM_LOW) * Math.sin(((u / 0.7) * Math.PI) / 2)
          : HAM_HIGH - (HAM_HIGH - HAM_LOW) * ((u - 0.7) / 0.3) ** 2;
      hammer.current.position.y = y;
    }
    // Meshing gears: opposite directions, speed ∝ 1/radius.
    if (g1.current) g1.current.rotation.x = t * 0.9;
    if (g2.current) g2.current.rotation.x = -t * 0.9 * (G1_R / G2_R) + 0.15;
  });

  const { w: W, d: D, h: H } = CR;
  const guide = 0.12;
  return (
    <group position={[CR.x, DECK, CR.z]}>
      {/* Plinth + steel-blue body with rust bands */}
      <Box p={[0, 0.03, 0]} s={[W + 0.08, 0.06, D + 0.06]} m={M.rustDark} cast />
      <Box p={[0, H / 2 + 0.03, 0]} s={[W, H - 0.06, D]} m={M.steelBlue} cast />
      {[0.14, 0.34].map((y) => (
        <Box key={y} p={[0, y, 0]} s={[W + 0.02, 0.03, D + 0.02]} m={M.rust} />
      ))}
      {/* Intake chute on the front, where the conveyor lands */}
      <mesh material={M.rust} position={[-0.13, H - 0.02, D / 2 + 0.02]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.06, 0.1, 4]} />
      </mesh>
      <Box p={[0.12, 0.12, D / 2 + 0.01]} s={[0.14, 0.18, 0.02]} m={M.black} />

      {/* Hammer tower: four guide posts, cap + piston */}
      {[
        [-guide, -guide],
        [guide, -guide],
        [guide, guide],
        [-guide, guide],
      ].map(([gx, gz]) => (
        <Box key={`${gx}${gz}`} p={[gx, H + 0.22, gz]} s={[0.03, 0.44, 0.03]} m={M.frame} />
      ))}
      <Box p={[0, H + 0.46, 0]} s={[0.3, 0.06, 0.3]} m={M.steelBlue} cast />
      <Box p={[0, H + 0.53, 0]} s={[0.12, 0.08, 0.12]} m={M.rust} cast />
      <Box p={[0, H + 0.01, 0]} s={[0.22, 0.03, 0.22]} m={M.black} />
      <group ref={hammer} position={[0, HAM_HIGH, 0]}>
        {/* Head */}
        <Box p={[0, 0.05, 0]} s={[0.18, 0.1, 0.18]} m={M.steel} cast />
        <Box p={[0, 0.005, 0]} s={[0.14, 0.02, 0.14]} m={M.frame} />
        {/* Piston rod reaching up into the cap (long enough at the low stop) */}
        <Box p={[0, 0.22, 0]} s={[0.035, 0.34, 0.035]} m={M.gear} />
      </group>

      {/* Two big counter-rotating gears on the +X side */}
      <group ref={g1} position={[W / 2 + 0.03, 0.24, -0.08]}>
        <Gear r={G1_R} teeth={12} />
      </group>
      <group ref={g2} position={[W / 2 + 0.03, 0.31, -0.08 + 0.27]}>
        <Gear r={G2_R} teeth={8} />
      </group>

      {/* Grey smoking chimney at the back */}
      <mesh material={M.pipeGrey} position={[0.2, H + 0.32, -0.15]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 0.64, 12]} />
      </mesh>
      <mesh material={M.black} position={[0.2, H + 0.64, -0.15]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.042, 0.012, 6, 14]} />
      </mesh>
    </group>
  );
}

// --- 6. Pipes between hall and crusher -------------------------------------------------------------------

function Piping() {
  const xS = HALL.x + HALL.w / 2; // hall right wall
  const xC = CR.x - CR.w / 2; // crusher left wall
  const z = -0.8;
  const yR = DECK + 0.68; // rust run (high, drops into the crusher roof)
  const R = 0.07;
  const xE = 0.7;
  return (
    <group>
      {/* Thick rust run over the headframe yard, elbowing down into the crusher */}
      <Pipe from={[xS, yR, z]} to={[xE, yR, z]} r={0.045} m={M.rust} />
      <Elbow p={[xE, yR - R, z]} rot={[0, 0, 0]} R={R} r={0.045} m={M.rust} />
      <Pipe from={[xE + R, yR - R, z]} to={[xE + R, DECK + CR.h, z]} r={0.045} m={M.rust} />
      {/* Blue + grey runs straight into the crusher wall */}
      <Pipe from={[xS, DECK + 0.42, z + 0.02]} to={[xC, DECK + 0.42, z + 0.02]} r={0.035} m={M.pipeBlue} />
      <Pipe from={[xS, DECK + 0.28, z - 0.03]} to={[xC, DECK + 0.28, z - 0.03]} r={0.04} m={M.pipeGrey} />
      {/* Flanges + a valve */}
      {[0.0, 0.45].map((fx) => (
        <mesh key={fx} material={M.frame} position={[fx, yR, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.058, 0.058, 0.03, 12]} />
        </mesh>
      ))}
      <mesh material={M.yellow} position={[-0.05, DECK + 0.47, z + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.035, 0.009, 6, 12]} />
      </mesh>
      {/* Supports (portal frames) */}
      {[-0.05, 0.5].map((sx) => (
        <group key={sx}>
          <Box p={[sx, DECK + (yR - DECK) / 2, z - 0.07]} s={[0.025, yR - DECK, 0.025]} m={M.frame} />
          <Box p={[sx, DECK + (yR - DECK) / 2, z + 0.07]} s={[0.025, yR - DECK, 0.025]} m={M.frame} />
          <Box p={[sx, yR - 0.05, z]} s={[0.025, 0.02, 0.16]} m={M.frame} />
        </group>
      ))}
    </group>
  );
}

// --- 7. Cart track ------------------------------------------------------------------------------------------

function CartTrack({ phase }: { phase: number }) {
  const carts = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    if (carts.current) carts.current.position.x = Math.sin(t * 0.35) * 0.8;
  });
  return (
    <group>
      <Box p={[0, DECK + 0.008, TRACK_Z - 0.04]} s={[2.7, 0.015, 0.01]} m={M.steel} />
      <Box p={[0, DECK + 0.008, TRACK_Z + 0.04]} s={[2.7, 0.015, 0.01]} m={M.steel} />
      {Array.from({ length: 18 }).map((_, i) => (
        <Box key={i} p={[-1.28 + i * 0.15, DECK + 0.003, TRACK_Z]} s={[0.025, 0.006, 0.12]} m={M.wood} />
      ))}
      <Box p={[-1.36, DECK + 0.035, TRACK_Z]} s={[0.035, 0.06, 0.12]} m={M.yellow} />
      <Box p={[1.36, DECK + 0.035, TRACK_Z]} s={[0.035, 0.06, 0.12]} m={M.yellow} />
      <group ref={carts} position={[0, DECK, TRACK_Z]}>
        {[-0.1, 0.1].map((cx) => (
          <group key={cx} position={[cx, 0, 0]}>
            <Box p={[0, 0.06, 0]} s={[0.15, 0.07, 0.11]} m={M.steelBlue} cast />
            <Box p={[0, 0.098, 0]} s={[0.155, 0.01, 0.115]} m={M.rust} />
            <mesh material={M.ore} position={[0, 0.11, 0]} castShadow>
              <coneGeometry args={[0.06, 0.045, 5]} />
            </mesh>
            {[-0.045, 0.045].map((wx) => (
              <mesh key={wx} material={M.black} position={[wx, 0.022, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
              </mesh>
            ))}
          </group>
        ))}
        <Box p={[0, 0.045, 0]} s={[0.05, 0.01, 0.01]} m={M.black} />
      </group>
    </group>
  );
}

// --- 8. Conveyors --------------------------------------------------------------------------------------------

function Conveyor({
  a,
  b,
  legs,
  stones,
  speed,
  phase,
}: {
  a: V3;
  b: V3;
  /** Fractions 0..1 along the belt where a trestle stands. */
  legs: number[];
  stones: number;
  speed: number;
  phase: number;
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const g = useMemo(() => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    return {
      len,
      yaw: Math.atan2(-dz, dx),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Irregular stones: fixed per-stone size/spin.
  const looks = useMemo(
    () =>
      Array.from({ length: stones }).map((_, i) => ({
        s: 0.018 + ((i * 7) % 3) * 0.006,
        rx: i * 1.3,
        ry: i * 2.1,
        side: ((i * 5) % 3) - 1,
      })),
    [stones],
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    for (let i = 0; i < stones; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const k = (t * speed + i / stones) % 1; // bottom → top, then loop
      m.position.x = -g.len / 2 + k * g.len;
    }
  });

  // Rollers along the frame.
  const rollers = Math.floor(g.len / 0.12);

  return (
    <group>
      <group position={g.mid} rotation={[0, g.yaw, 0]}>
        <group rotation={[0, 0, g.pitch]}>
          {/* Steel frame: belt + two side girders + rollers */}
          <Box p={[0, 0, 0]} s={[g.len, 0.018, 0.1]} m={M.belt} cast />
          <Box p={[0, 0.005, 0.058]} s={[g.len, 0.045, 0.014]} m={M.frame} />
          <Box p={[0, 0.005, -0.058]} s={[g.len, 0.045, 0.014]} m={M.frame} />
          {Array.from({ length: rollers }).map((_, i) => (
            <Box key={i} p={[-g.len / 2 + (i + 0.5) * (g.len / rollers), -0.022, 0]} s={[0.02, 0.012, 0.1]} m={M.steel} />
          ))}
          {/* Head + tail drums */}
          {[-g.len / 2, g.len / 2].map((x) => (
            <mesh key={x} material={M.steel} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.13, 10]} />
            </mesh>
          ))}
          {looks.map((l, i) => (
            <mesh
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              geometry={STONE_GEOM}
              material={i % 3 === 0 ? M.ore : M.stone}
              position={[0, 0.009 + l.s, l.side * 0.025]}
              rotation={[l.rx, l.ry, 0]}
              scale={l.s}
            />
          ))}
        </group>
      </group>
      {/* Steel trestles (A-frames) down to whatever ground is under them */}
      {legs.map((f) => {
        const x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f - 0.03;
        const z = a[2] + (b[2] - a[2]) * f;
        const base = groundY(x, z);
        // Spread the feet perpendicular to the belt's horizontal direction.
        const px = -(b[2] - a[2]);
        const pz = b[0] - a[0];
        const pl = Math.hypot(px, pz) || 1;
        const ox = (px / pl) * 0.075;
        const oz = (pz / pl) * 0.075;
        const mid = (base + y) / 2;
        return (
          <group key={f}>
            <Rod from={[x - ox, base, z - oz]} to={[x - ox * 0.7, y, z - oz * 0.7]} w={0.018} m={M.frame} />
            <Rod from={[x + ox, base, z + oz]} to={[x + ox * 0.7, y, z + oz * 0.7]} w={0.018} m={M.frame} />
            <Rod from={[x - ox * 0.85, mid, z - oz * 0.85]} to={[x + ox * 0.85, mid, z + oz * 0.85]} w={0.01} m={M.frame} />
            <Rod from={[x - ox, base, z - oz]} to={[x + ox * 0.85, mid, z + oz * 0.85]} w={0.008} m={M.frame} />
          </group>
        );
      })}
    </group>
  );
}
