/**
 * LumberMillModel — a detailed, animated low-poly sawmill on a 3×3-cell lot,
 * after the reference art.
 *
 * Built in CELL UNITS: the base slab is exactly [3, 0.1, 3] centered on the
 * origin, resting on Y=0; the caller scales the group by `cellSize`.
 *
 * Layout (−Z = back, +Z = front, +X = right):
 *   - back-left: brown plank barn (gabled, dark roof, white-framed windows,
 *     brick chimney with smoke), a lower side wing, and an open saw shed with a
 *     warm light inside;
 *   - in front of the shed: a big spinning circular saw fed by a roller
 *     conveyor; logs travel into the blade, sawdust sprays out;
 *   - back-right: a yellow lattice tower crane that swings between the log pile
 *     and the conveyor, lowers its grabber, picks a log and drops it off;
 *   - right / front: paved log yard with many log stacks and plank stacks
 *     between posts, scattered offcuts;
 *   - left / front: sawdust pile, crates & barrels, a short cart track with two
 *     carts, an asphalt access road with two little trucks.
 *
 * Performance: every log of every stack is ONE InstancedMesh (bark side + cut
 * ends via a material array), planks/offcuts another; shared module materials;
 * no lights (glow is emissive). Animations (useFrame): saw
 * blade, conveyor logs, sawdust, crane cycle (slew + trolley + hoist + claws),
 * chimney smoke. `phase` desyncs multiple mills.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, Box, Pipe, Steam } from './PowerPlantModel';
import { patchCloudShadows } from './cloudShadows';

type V3 = [number, number, number];

export interface LumberMillModelProps {
  position?: V3;
  scale?: number;
  rotationY?: number;
  phase?: number;
}

// --- Shared materials --------------------------------------------------------

const std = (
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

const M = {
  paving: std('#e2d6b8', { roughness: 0.95 }),
  joint: std('#c9bb98', { roughness: 1 }),
  grass: std('#7f8a48', { roughness: 1 }),
  soil: std('#8a6a4a', { roughness: 1 }),
  asphalt: std('#7a736b', { roughness: 1 }),
  plank: std('#7a4a2e'),
  plankDark: std('#5e3721'),
  roof: std('#5a5350'),
  roofDark: std('#46403d'),
  frame: std('#e8e2d6'),
  glass: std('#45525c', { roughness: 0.4 }),
  bayDark: new THREE.MeshBasicMaterial({ color: '#1d140d' }),
  brick: std('#8f4a36'),
  pipe: std('#9aa0a7', { roughness: 0.5, metalness: 0.35 }),
  steel: std('#7d828b', { roughness: 0.5, metalness: 0.5 }),
  dark: std('#2c2f35', { roughness: 0.7 }),
  yellow: std('#e8b82e', { roughness: 0.5 }),
  blade: std('#c9ced4', { roughness: 0.3, metalness: 0.8 }),
  bark: std('#6a4428', { flatShading: true }),
  logEnd: std('#d9a86c', { roughness: 0.9 }),
  board: std('#ffffff', { roughness: 0.85 }),
  sawdust: std('#c98a4b', { roughness: 1, flatShading: true }),
  crate: std('#9a6a3e'),
  barrel: std('#5d6b78', { roughness: 0.6 }),
  truckRed: std('#a8452f', { roughness: 0.6 }),
  truckBlue: std('#4f6f8f', { roughness: 0.6 }),
  tire: std('#1f2125', { roughness: 0.9 }),
  post: std('#4e3420'),
  cable: std('#1d1f23'),
};
Object.values(M).forEach((m) => patchCloudShadows(m));
/** Logs: [side, top cap, bottom cap] (CylinderGeometry groups). */
const LOG_MATS = [M.bark, M.logEnd, M.logEnd];

/** Unit log: axis along X, length 1, radius 1, low-poly. */
const LOG_GEOM = new THREE.CylinderGeometry(1, 1, 1, 8);
LOG_GEOM.rotateZ(Math.PI / 2);

/** Triangular gable prism: width w (x), height h (y), depth d (z), base y=0. */
function prismGeom(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/** A thin rod between two points (shared unit box, oriented). */
function Rod({ from, to, w = 0.015, m }: { from: V3; to: V3; w?: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const d = b.clone().sub(a);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.join(','), to.join(',')]);
  return <mesh geometry={BOX} material={m} position={pos} quaternion={quat} scale={[w, len, w]} castShadow />;
}

// --- Model ------------------------------------------------------------------------

export function LumberMillModel({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
  phase = 0,
}: LumberMillModelProps) {
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      <Ground />
      {/* Main barn (ridge front-back), side wing, open saw shed */}
      <Barn x={-0.7} z={-0.75} w={0.9} d={1.15} h={0.62} rise={0.34} frontDoor upperWindows={2} sideWindows />
      <Barn x={-1.3} z={-0.72} w={0.3} d={0.75} h={0.36} rise={0.15} sideWindows={false} frontWindow />
      <Barn x={0.1} z={-0.6} w={0.6} d={0.85} h={0.44} rise={0.2} openBay />
      <Chimney phase={phase} />
      <Piping />
      <Saw phase={phase} />
      <Crane phase={phase} />
      <Stacks />
      <SawdustPile />
      <CartTrack />
      <Trucks />
    </group>
  );
}

// --- Ground ----------------------------------------------------------------------

function Ground() {
  const joints = [-1, -0.5, 0, 0.5, 1];
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[3, 0.1, 3]} m={M.paving} />
      {/* Paving joints */}
      {joints.map((j) => (
        <Box key={`jx${j}`} p={[j, 0.101, 0]} s={[0.012, 0.004, 3]} m={M.joint} />
      ))}
      {joints.map((j) => (
        <Box key={`jz${j}`} p={[0, 0.101, j]} s={[3, 0.004, 0.012]} m={M.joint} />
      ))}
      {/* Grass behind/under the buildings and a strip across the yard */}
      <Box p={[-0.6, 0.104, -1.0]} s={[1.8, 0.01, 1.0]} m={M.grass} />
      <Box p={[0.95, 0.104, 0.1]} s={[1.1, 0.01, 0.12]} m={M.grass} />
      <Box p={[-1.1, 0.104, 0.55]} s={[0.8, 0.01, 0.6]} m={M.grass} />
      {/* Packed soil under the saw + crane */}
      <Box p={[0.55, 0.106, -0.4]} s={[1.0, 0.01, 0.9]} m={M.soil} />
      {/* Asphalt apron in front of the barns + access road to the lot edge */}
      <Box p={[-0.5, 0.108, 0.04]} s={[1.2, 0.012, 0.42]} m={M.asphalt} />
      <Box p={[-0.29, 0.108, 0.87]} s={[0.32, 0.012, 1.25]} m={M.asphalt} />
      {/* Edge trim */}
      <Box p={[0, 0.1, -1.49]} s={[3, 0.02, 0.02]} m={M.joint} />
      <Box p={[0, 0.1, 1.49]} s={[3, 0.02, 0.02]} m={M.joint} />
    </group>
  );
}

// --- Buildings ------------------------------------------------------------------------

/**
 * A plank barn with its ridge along Z: walls, two gable prisms, two roof
 * panels with battens, white-framed windows, optional door / open bay.
 */
function Barn({
  x,
  z,
  w,
  d,
  h,
  rise,
  frontDoor = false,
  openBay = false,
  upperWindows = 0,
  sideWindows = false,
  frontWindow = false,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rise: number;
  frontDoor?: boolean;
  openBay?: boolean;
  upperWindows?: number;
  sideWindows?: boolean;
  frontWindow?: boolean;
}) {
  const gable = useMemo(() => prismGeom(w, rise, 0.02), [w, rise]);
  const slope = Math.atan2(rise, w / 2);
  const panelW = Math.hypot(w / 2, rise) + 0.05;
  const fz = d / 2 + 0.006;
  const battens = Math.max(3, Math.round(d / 0.12));
  return (
    <group position={[x, 0.1, z]}>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} m={M.plank} cast />
      {/* Vertical board seams on the front + plinth */}
      {Array.from({ length: Math.max(2, Math.round(w / 0.1)) }).map((_, i, a) => {
        const px = -w / 2 + ((i + 0.5) * w) / a.length;
        return <Box key={i} p={[px, h / 2, fz]} s={[0.008, h, 0.006]} m={M.plankDark} />;
      })}
      <Box p={[0, 0.025, 0]} s={[w + 0.02, 0.05, d + 0.02]} m={M.plankDark} />
      {/* Gables */}
      {[d / 2 - 0.01, -d / 2 + 0.01].map((gz) => (
        <mesh key={gz} geometry={gable} material={M.plank} position={[0, h, gz]} castShadow />
      ))}
      {/* Roof panels + battens */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[(side * w) / 4, h + rise / 2 + 0.012, 0]}
          rotation={[0, 0, -side * slope]}
        >
          <Box p={[0, 0, 0]} s={[panelW, 0.025, d + 0.08]} m={M.roof} cast />
          {Array.from({ length: battens }).map((_, i) => (
            <Box
              key={i}
              p={[0, 0.016, -d / 2 + ((i + 0.5) * d) / battens]}
              s={[panelW, 0.008, 0.012]}
              m={M.roofDark}
            />
          ))}
        </group>
      ))}
      <Box p={[0, h + rise + 0.012, 0]} s={[0.035, 0.03, d + 0.08]} m={M.roofDark} />
      {/* Front: door / open bay / windows */}
      {frontDoor && (
        <group>
          <Box p={[0, 0.19, fz + 0.002]} s={[0.3, 0.38, 0.01]} m={M.bayDark} />
          <Box p={[-0.17, 0.2, fz + 0.004]} s={[0.025, 0.4, 0.012]} m={M.frame} />
          <Box p={[0.17, 0.2, fz + 0.004]} s={[0.025, 0.4, 0.012]} m={M.frame} />
          <Box p={[0, 0.405, fz + 0.004]} s={[0.36, 0.025, 0.012]} m={M.frame} />
        </group>
      )}
      {openBay && <Box p={[0, h * 0.42, fz - 0.03]} s={[w - 0.08, h * 0.84, 0.07]} m={M.bayDark} />}
      {upperWindows > 0 &&
        Array.from({ length: upperWindows }).map((_, i) => {
          const px = (i - (upperWindows - 1) / 2) * 0.24;
          return <Window key={i} p={[px, h * 0.82, fz]} />;
        })}
      {frontWindow && <Window p={[0, h * 0.55, fz]} />}
      {upperWindows > 0 && <Window p={[0, h + rise * 0.4, fz + 0.01]} small />}
      {sideWindows &&
        [-0.3, 0, 0.3].map((pz) => (
          <Window key={pz} p={[w / 2 + 0.006, h * 0.55, pz]} side />
        ))}
    </group>
  );
}

function Window({ p, side = false, small = false }: { p: V3; side?: boolean; small?: boolean }) {
  const s = small ? 0.07 : 0.1;
  return (
    <group position={p} rotation={[0, side ? Math.PI / 2 : 0, 0]}>
      <Box p={[0, 0, 0.002]} s={[s + 0.03, s * 1.2 + 0.03, 0.008]} m={M.frame} />
      <Box p={[0, 0, 0.007]} s={[s, s * 1.2, 0.006]} m={M.glass} />
      <Box p={[0, 0, 0.011]} s={[0.008, s * 1.2, 0.004]} m={M.frame} />
    </group>
  );
}

function Chimney({ phase }: { phase: number }) {
  // On the main barn's ridge, toward the back.
  return (
    <group>
      <Box p={[-0.62, 0.98, -1.05]} s={[0.1, 0.36, 0.1]} m={M.brick} cast />
      <Box p={[-0.62, 1.17, -1.05]} s={[0.13, 0.03, 0.13]} m={M.dark} />
      <Steam origin={[-0.62, 1.2, -1.05]} count={5} rise={0.9} spread={0.15} size={0.07} color="#cfcfcf" phase={phase} />
    </group>
  );
}

function Piping() {
  return (
    <group>
      {/* Dust extraction pipe: from the saw shed roof over to the main barn */}
      <Pipe from={[0.43, 0.1, -0.4]} to={[0.43, 0.82, -0.4]} r={0.025} m={M.pipe} />
      <Pipe from={[0.43, 0.82, -0.4]} to={[-0.2, 0.82, -0.4]} r={0.025} m={M.pipe} />
      <Pipe from={[-0.2, 0.6, -0.4]} to={[-0.2, 0.82, -0.4]} r={0.025} m={M.pipe} />
      {/* Side drop pipe on the main barn */}
      <Pipe from={[-0.24, 0.1, -1.2]} to={[-0.24, 0.55, -1.2]} r={0.02} m={M.pipe} />
    </group>
  );
}

// --- Saw + conveyor -----------------------------------------------------------------------

const SAW = { x: 0.25, y: 0.33, z: -0.05, r: 0.2 };
const BELT = { x0: 0.42, x1: 1.3, z: -0.05, y: 0.22 };
const FEED_LOGS = 3;
const DUST = 10;

function Saw({ phase }: { phase: number }) {
  const blade = useRef<THREE.Group>(null);
  const logs = useRef<Array<THREE.Mesh | null>>([]);
  const dust = useRef<Array<THREE.Mesh | null>>([]);
  const dustSeeds = useMemo(
    () =>
      Array.from({ length: DUST }).map((_, i) => ({
        off: i / DUST,
        vx: -0.15 - ((i * 37) % 10) * 0.025,
        vy: 0.25 + ((i * 53) % 10) * 0.03,
        vz: (((i * 71) % 10) - 5) * 0.03,
      })),
    [],
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + phase;
    if (blade.current) blade.current.rotation.z = -t * 9;
    // Logs roll toward the blade along −X, then loop back to the far end.
    const len = BELT.x1 - BELT.x0 + 0.2;
    for (let i = 0; i < FEED_LOGS; i++) {
      const m = logs.current[i];
      if (!m) continue;
      const k = (t * 0.07 + i / FEED_LOGS) % 1;
      const x = BELT.x1 - k * len;
      m.position.x = x;
      // Fade/scale out as it is consumed by the blade.
      const into = Math.min(1, Math.max(0, (x - (SAW.x - 0.05)) / 0.2));
      m.scale.set(0.34 * into + 0.0001, 0.05, 0.05);
      m.position.x = x + 0.17 * (1 - into);
    }
    // Sawdust: little chips arcing out of the blade bottom.
    for (let i = 0; i < DUST; i++) {
      const m = dust.current[i];
      if (!m) continue;
      const s = dustSeeds[i];
      const k = (t * 1.6 + s.off) % 1;
      m.position.set(SAW.x + s.vx * k, SAW.y - SAW.r * 0.5 + s.vy * k - 0.6 * k * k, SAW.z + s.vz * k);
      m.scale.setScalar(0.018 * (1 - k * 0.6));
    }
  });

  return (
    <group>
      {/* Roller conveyor */}
      <Box p={[(BELT.x0 + BELT.x1) / 2, BELT.y - 0.02, BELT.z]} s={[BELT.x1 - BELT.x0, 0.03, 0.14]} m={M.dark} cast />
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh
          key={i}
          material={M.steel}
          position={[BELT.x0 + 0.05 + i * ((BELT.x1 - BELT.x0 - 0.1) / 8), BELT.y + 0.003, BELT.z]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.014, 0.014, 0.13, 6]} />
        </mesh>
      ))}
      {[BELT.x0 + 0.05, (BELT.x0 + BELT.x1) / 2, BELT.x1 - 0.05].map((lx) =>
        [-0.06, 0.06].map((dz) => (
          <Box key={`${lx}${dz}`} p={[lx, (0.1 + BELT.y - 0.035) / 2, BELT.z + dz]} s={[0.025, BELT.y - 0.135, 0.025]} m={M.dark} />
        )),
      )}
      {/* Logs on the conveyor */}
      {Array.from({ length: FEED_LOGS }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            logs.current[i] = el;
          }}
          geometry={LOG_GEOM}
          material={LOG_MATS}
          position={[BELT.x1, BELT.y + 0.05, BELT.z]}
          scale={[0.34, 0.05, 0.05]}
          castShadow
        />
      ))}
      {/* Saw table + guard */}
      <Box p={[SAW.x, 0.17, SAW.z]} s={[0.3, 0.14, 0.2]} m={M.steel} cast />
      <Box p={[SAW.x, 0.245, SAW.z]} s={[0.34, 0.02, 0.24]} m={M.dark} />
      <Box p={[SAW.x - 0.02, SAW.y + SAW.r + 0.03, SAW.z]} s={[0.26, 0.04, 0.05]} m={M.yellow} cast />
      {/* Spinning blade (in the XY plane, spins around Z) */}
      <group ref={blade} position={[SAW.x, SAW.y, SAW.z]}>
        <mesh material={M.blade} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[SAW.r, SAW.r, 0.012, 24]} />
        </mesh>
        {Array.from({ length: 16 }).map((_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return (
            <Box
              key={i}
              p={[Math.cos(a) * (SAW.r + 0.012), Math.sin(a) * (SAW.r + 0.012), 0]}
              s={[0.03, 0.03, 0.01]}
              m={M.blade}
            />
          );
        })}
        <mesh material={M.dark} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.03, 10]} />
        </mesh>
      </group>
      {/* Sawdust chips */}
      {dustSeeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            dust.current[i] = el;
          }}
          geometry={BOX}
          material={M.sawdust}
        />
      ))}
      {/* Little sawdust heap under the blade */}
      <mesh material={M.sawdust} position={[SAW.x - 0.18, 0.13, SAW.z + 0.02]}>
        <coneGeometry args={[0.1, 0.06, 6]} />
      </mesh>
    </group>
  );
}

// --- Crane ---------------------------------------------------------------------------------

const CRANE = { x: 1.1, z: -1.05, h: 0.95 };
/** Pick-up (log pile) and drop-off (conveyor end), relative to the tower. */
const PICK = { x: 0.72 - CRANE.x, z: -0.72 - CRANE.z };
const DROP = { x: 1.2 - CRANE.x, z: BELT.z - CRANE.z };
const CYCLE = 12; // seconds per pick-and-drop

const angOf = (p: { x: number; z: number }) => Math.atan2(-p.z, p.x); // rotation.y
const distOf = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

function Crane({ phase }: { phase: number }) {
  const slew = useRef<THREE.Group>(null);
  const trolley = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  const hook = useRef<THREE.Group>(null);
  const claws = useRef<Array<THREE.Group | null>>([]);
  const carried = useRef<THREE.Mesh>(null);

  const a0 = angOf(PICK);
  let a1 = angOf(DROP);
  if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
  const d0 = distOf(PICK);
  const d1 = distOf(DROP);
  const jibY = CRANE.h + 0.06;
  const ease = (k: number) => k * k * (3 - 2 * k);

  useFrame((state) => {
    const t = (state.clock.getElapsedTime() + phase * 2.3) % CYCLE;
    const u = t / CYCLE;
    // Phases: 0–.15 lower at pile, .15–.25 grab+lift, .25–.5 swing to belt,
    // .5–.6 lower, .6–.7 release+lift, .7–1 swing back.
    let ang: number, dist: number, drop: number, closed: boolean, holding: boolean;
    const low = jibY - 0.58; // claws at the pile top
    const high = jibY - 0.22;
    if (u < 0.15) {
      ang = a0; dist = d0; drop = high + (low - high) * ease(u / 0.15); closed = false; holding = false;
    } else if (u < 0.25) {
      const k = (u - 0.15) / 0.1;
      ang = a0; dist = d0; drop = low + (high - low) * ease(Math.max(0, k * 1.4 - 0.4)); closed = true; holding = true;
    } else if (u < 0.5) {
      const k = ease((u - 0.25) / 0.25);
      ang = a0 + (a1 - a0) * k; dist = d0 + (d1 - d0) * k; drop = high; closed = true; holding = true;
    } else if (u < 0.6) {
      ang = a1; dist = d1; drop = high + (low + 0.1 - high) * ease((u - 0.5) / 0.1); closed = true; holding = true;
    } else if (u < 0.7) {
      const k = (u - 0.6) / 0.1;
      ang = a1; dist = d1; drop = low + 0.1 + (high - low - 0.1) * ease(Math.max(0, k * 1.4 - 0.4)); closed = false; holding = false;
    } else {
      const k = ease((u - 0.7) / 0.3);
      ang = a1 + (a0 - a1) * k; dist = d1 + (d0 - d1) * k; drop = high; closed = false; holding = false;
    }
    if (slew.current) slew.current.rotation.y = ang;
    if (trolley.current) trolley.current.position.x = dist;
    const hookY = drop; // hook top, in tower-local Y
    if (hook.current) hook.current.position.y = hookY - jibY;
    if (cable.current) {
      const len = jibY - 0.02 - hookY;
      cable.current.scale.y = Math.max(0.001, len);
      cable.current.position.y = -0.02 - len / 2;
    }
    const open = closed ? 0.15 : 0.7;
    claws.current.forEach((c, i) => {
      if (c) c.rotation.z = (i % 2 ? 1 : -1) * open;
    });
    if (carried.current) carried.current.visible = holding;
  });

  const legs: Array<[number, number]> = [
    [-0.13, -0.13],
    [0.13, -0.13],
    [0.13, 0.13],
    [-0.13, 0.13],
  ];
  const jibLen = 1.25;
  return (
    <group position={[CRANE.x, 0.1, CRANE.z]}>
      {/* Dark steel tower */}
      <Box p={[0, 0.02, 0]} s={[0.34, 0.04, 0.34]} m={M.dark} />
      {legs.map(([lx, lz]) => (
        <Rod key={`${lx}${lz}`} from={[lx, 0, lz]} to={[lx * 0.55, CRANE.h, lz * 0.55]} w={0.025} m={M.dark} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => {
        const k = 1 - 0.45 * f;
        const y = CRANE.h * f;
        return [-1, 1].map((sd) => (
          <group key={`${f}${sd}`}>
            <Rod from={[-0.13 * k, y, sd * 0.13 * k]} to={[0.13 * k, y + CRANE.h * 0.25, sd * 0.13 * (k - 0.11)]} w={0.012} m={M.dark} />
            <Rod from={[sd * 0.13 * k, y, -0.13 * k]} to={[sd * 0.13 * (k - 0.11), y + CRANE.h * 0.25, 0.13 * k]} w={0.012} m={M.dark} />
          </group>
        ));
      })}
      {/* Slewing top: cab, yellow lattice jib, counter-jib + weight */}
      <group ref={slew} position={[0, CRANE.h - 0.1, 0]}>
        <Box p={[0, 0.05, 0]} s={[0.2, 0.06, 0.2]} m={M.yellow} cast />
        <Box p={[-0.02, 0.15, 0.1]} s={[0.12, 0.12, 0.1]} m={M.dark} cast />
        <Box p={[0.04, 0.16, 0.152]} s={[0.05, 0.05, 0.004]} m={M.glass} />
        {/* Tower head (A-frame) */}
        <Rod from={[0, 0.08, -0.05]} to={[0, 0.42, 0]} w={0.02} m={M.yellow} />
        <Rod from={[0, 0.08, 0.05]} to={[0, 0.42, 0]} w={0.02} m={M.yellow} />
        {/* Jib: 3 chords + zig-zag lacing */}
        <group position={[0, 0.16, 0]}>
          <Box p={[jibLen / 2, 0, -0.035]} s={[jibLen, 0.018, 0.018]} m={M.yellow} cast />
          <Box p={[jibLen / 2, 0, 0.035]} s={[jibLen, 0.018, 0.018]} m={M.yellow} cast />
          <Box p={[jibLen / 2, 0.07, 0]} s={[jibLen, 0.018, 0.018]} m={M.yellow} cast />
          {Array.from({ length: 10 }).map((_, i) => {
            const x0 = (i * jibLen) / 10;
            const x1 = ((i + 1) * jibLen) / 10;
            return (
              <group key={i}>
                <Rod from={[x0, 0, -0.035]} to={[x1, 0.07, 0]} w={0.008} m={M.yellow} />
                <Rod from={[x0, 0, 0.035]} to={[x1, 0.07, 0]} w={0.008} m={M.yellow} />
              </group>
            );
          })}
          {/* Counter-jib + weight */}
          <Box p={[-0.2, 0.02, 0]} s={[0.4, 0.03, 0.08]} m={M.yellow} cast />
          <Box p={[-0.36, -0.03, 0]} s={[0.1, 0.1, 0.1]} m={M.dark} cast />
          {/* Pendant cables */}
          <Rod from={[0, 0.26, 0]} to={[jibLen * 0.8, 0.07, 0]} w={0.005} m={M.cable} />
          <Rod from={[0, 0.26, 0]} to={[-0.36, 0.02, 0]} w={0.005} m={M.cable} />
        </group>
        {/* Trolley + hoist cable + grabber (positions animated) */}
        <group ref={trolley} position={[d0, 0.16 - 0.02, 0]}>
          <Box p={[0, 0, 0]} s={[0.06, 0.025, 0.08]} m={M.dark} />
          <mesh ref={cable} geometry={BOX} material={M.cable} position={[0, -0.2, 0]} scale={[0.006, 0.3, 0.006]} />
          <group ref={hook} position={[0, -0.3, 0]}>
            <Box p={[0, -0.01, 0]} s={[0.06, 0.03, 0.05]} m={M.dark} />
            {[0, 1, 2, 3].map((i) => (
              <group
                key={i}
                position={[0, -0.025, 0]}
                rotation={[0, (i < 2 ? 0 : Math.PI / 2), 0]}
              >
                <group
                  ref={(el) => {
                    claws.current[i] = el;
                  }}
                >
                  <Box p={[(i % 2 ? 1 : -1) * 0.02, -0.035, 0]} s={[0.012, 0.07, 0.025]} m={M.dark} />
                </group>
              </group>
            ))}
            {/* The log being carried (crosswise in the claws) */}
            <mesh
              ref={carried}
              geometry={LOG_GEOM}
              material={LOG_MATS}
              position={[0, -0.075, 0]}
              rotation={[0, Math.PI / 2, 0]}
              scale={[0.3, 0.045, 0.045]}
              castShadow
            />
          </group>
        </group>
      </group>
    </group>
  );
}

// --- Stacks (instanced) ----------------------------------------------------------------------

interface LogSpec {
  p: V3;
  len: number;
  r: number;
  yaw: number;
}
interface BoardSpec {
  p: V3;
  s: V3;
  yaw: number;
  shade: number;
}

/** Pyramid log pile: `rows` bottom count, along X (yaw 0) or Z (yaw π/2). */
function logPile(out: LogSpec[], cx: number, cz: number, rows: number, len: number, r: number, alongZ: boolean): void {
  const yaw = alongZ ? Math.PI / 2 : 0;
  for (let row = 0; row < rows; row++) {
    const n = rows - row;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * r * 2.02;
      const y = 0.1 + r + row * r * 1.72;
      const jitter = ((i * 31 + row * 17) % 7) * 0.006 - 0.018;
      out.push({
        p: alongZ ? [cx + off, y, cz + jitter] : [cx + jitter, y, cz + off],
        len: len * (0.94 + ((i * 13 + row * 7) % 5) * 0.03),
        r: r * (0.92 + ((i * 11 + row) % 4) * 0.04),
        yaw,
      });
    }
  }
}

/** Plank stack: `layers` × `n` boards along X, with crosswise stickers. */
function plankStack(out: BoardSpec[], cx: number, cz: number, n: number, layers: number, len: number): void {
  const bw = 0.07;
  const bh = 0.025;
  for (let l = 0; l < layers; l++) {
    const y = 0.1 + 0.02 + l * (bh + 0.012) + bh / 2;
    for (let i = 0; i < n; i++) {
      out.push({
        p: [cx, y, cz + (i - (n - 1) / 2) * (bw + 0.006)],
        s: [len, bh, bw],
        yaw: 0,
        shade: 0.9 + ((i * 7 + l * 3) % 5) * 0.04,
      });
    }
    // Stickers between layers (darker)
    [-len * 0.35, 0, len * 0.35].forEach((sx) =>
      out.push({
        p: [cx + sx, y - bh / 2 - 0.006, cz],
        s: [0.02, 0.012, n * (bw + 0.006)],
        yaw: 0,
        shade: 0.62,
      }),
    );
  }
}

function Stacks() {
  const { logs, boards, posts } = useMemo(() => {
    const logs: LogSpec[] = [];
    const boards: BoardSpec[] = [];
    const posts: Array<[number, number, number]> = []; // x, z, height
    const pileWithPosts = (cx: number, cz: number, rows: number, len: number, r: number, alongZ: boolean) => {
      logPile(logs, cx, cz, rows, len, r, alongZ);
      const half = rows * r * 1.05 + 0.02;
      const h = 0.06 + rows * r * 1.7;
      if (alongZ) {
        posts.push([cx - half, cz - len * 0.3, h], [cx + half, cz - len * 0.3, h], [cx - half, cz + len * 0.3, h], [cx + half, cz + len * 0.3, h]);
      } else {
        posts.push([cx - len * 0.3, cz - half, h], [cx - len * 0.3, cz + half, h], [cx + len * 0.3, cz - half, h], [cx + len * 0.3, cz + half, h]);
      }
    };
    // Back-right pile under the crane (pick-up)
    pileWithPosts(0.72, -0.72, 4, 0.55, 0.045, false);
    pileWithPosts(0.62, -1.25, 3, 0.5, 0.045, false);
    // Right yard
    pileWithPosts(1.05, 0.45, 4, 0.5, 0.045, true);
    pileWithPosts(1.15, 1.05, 3, 0.5, 0.05, false);
    pileWithPosts(0.35, 0.45, 3, 0.5, 0.045, false);
    // Front
    pileWithPosts(0.55, 1.15, 4, 0.55, 0.045, false);
    pileWithPosts(-0.75, 1.15, 3, 0.45, 0.045, false);
    // Plank stacks
    plankStack(boards, 0.3, 0.85, 4, 3, 0.45);
    plankStack(boards, 0.85, 0.75, 3, 4, 0.4);
    plankStack(boards, -1.15, -0.05, 3, 3, 0.35);
    // Offcuts scattered around
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39;
      const rr = 0.3 + ((i * 37) % 10) * 0.1;
      const x = 0.55 + Math.cos(a) * rr * 0.75;
      const z = 0.35 + Math.sin(a) * rr * 0.75;
      if (Math.abs(x) > 1.4 || Math.abs(z) > 1.4) continue;
      boards.push({ p: [x, 0.112, z], s: [0.09, 0.012, 0.018], yaw: a, shade: 0.75 });
    }
    return { logs, boards, posts };
  }, []);

  const logRef = useRef<THREE.InstancedMesh>(null);
  const boardRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    const lm = logRef.current;
    if (lm) {
      logs.forEach((l, i) => {
        d.position.set(...l.p);
        d.rotation.set(0, l.yaw, 0);
        d.scale.set(l.len, l.r, l.r);
        d.updateMatrix();
        lm.setMatrixAt(i, d.matrix);
      });
      lm.instanceMatrix.needsUpdate = true;
      lm.computeBoundingSphere();
    }
    const bm = boardRef.current;
    if (bm) {
      const base = new THREE.Color('#d9a86c');
      const c = new THREE.Color();
      boards.forEach((b, i) => {
        d.position.set(...b.p);
        d.rotation.set(0, b.yaw, 0);
        d.scale.set(...b.s);
        d.updateMatrix();
        bm.setMatrixAt(i, d.matrix);
        bm.setColorAt(i, c.copy(base).multiplyScalar(b.shade));
      });
      bm.instanceMatrix.needsUpdate = true;
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
      bm.computeBoundingSphere();
    }
  }, [logs, boards]);

  return (
    <group>
      <instancedMesh ref={logRef} args={[LOG_GEOM, LOG_MATS, logs.length]} castShadow receiveShadow />
      <instancedMesh ref={boardRef} args={[BOX, M.board, boards.length]} castShadow receiveShadow />
      {posts.map(([x, z, h], i) => (
        <Box key={i} p={[x, 0.1 + h / 2, z]} s={[0.022, h, 0.022]} m={M.post} cast />
      ))}
    </group>
  );
}

// --- Sawdust, carts, crates, trucks -------------------------------------------------------------

function SawdustPile() {
  return (
    <group>
      <mesh material={M.sawdust} position={[-1.05, 0.2, 0.55]} castShadow receiveShadow>
        <coneGeometry args={[0.32, 0.2, 9]} />
      </mesh>
      <mesh material={M.sawdust} position={[-0.82, 0.15, 0.72]} castShadow receiveShadow>
        <coneGeometry args={[0.16, 0.1, 7]} />
      </mesh>
      {/* Crates + barrels */}
      <Box p={[-0.62, 0.15, 0.42]} s={[0.1, 0.1, 0.1]} m={M.crate} cast />
      <Box p={[-0.62, 0.24, 0.42]} s={[0.08, 0.08, 0.08]} m={M.crate} cast />
      <Box p={[-0.5, 0.15, 0.47]} s={[0.09, 0.09, 0.09]} m={M.crate} cast />
      {[
        [-0.66, 0.6],
        [-0.56, 0.64],
      ].map(([x, z]) => (
        <mesh key={x} material={M.barrel} position={[x, 0.16, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.1, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function CartTrack() {
  const z = 1.0;
  return (
    <group>
      <Box p={[-1.0, 0.113, z - 0.04]} s={[0.85, 0.012, 0.01]} m={M.steel} />
      <Box p={[-1.0, 0.113, z + 0.04]} s={[0.85, 0.012, 0.01]} m={M.steel} />
      {Array.from({ length: 7 }).map((_, i) => (
        <Box key={i} p={[-1.38 + i * 0.125, 0.106, z]} s={[0.025, 0.006, 0.12]} m={M.post} />
      ))}
      {[
        [-1.18, M.sawdust],
        [-0.92, M.logEnd],
      ].map(([x, load], i) => (
        <group key={i} position={[x as number, 0.1, z]}>
          <Box p={[0, 0.07, 0]} s={[0.17, 0.08, 0.11]} m={M.dark} cast />
          <Box p={[0, 0.11, 0]} s={[0.15, 0.015, 0.09]} m={load as THREE.Material} />
          {[-0.05, 0.05].map((wx) => (
            <mesh key={wx} material={M.tire} position={[wx, 0.022, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.02, 0.02, 0.12, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Truck({ p, yaw, body }: { p: V3; yaw: number; body: THREE.Material }) {
  return (
    <group position={p} rotation={[0, yaw, 0]}>
      {/* Cab at +X, flatbed with logs behind */}
      <Box p={[0.08, 0.08, 0]} s={[0.09, 0.08, 0.11]} m={body} cast />
      <Box p={[0.105, 0.1, 0]} s={[0.04, 0.035, 0.1]} m={M.glass} />
      <Box p={[-0.04, 0.055, 0]} s={[0.16, 0.025, 0.11]} m={M.dark} cast />
      <mesh geometry={LOG_GEOM} material={LOG_MATS} position={[-0.04, 0.09, -0.025]} scale={[0.15, 0.022, 0.022]} castShadow />
      <mesh geometry={LOG_GEOM} material={LOG_MATS} position={[-0.04, 0.09, 0.025]} scale={[0.15, 0.022, 0.022]} castShadow />
      {[-0.07, 0.08].map((wx) =>
        [-0.058, 0.058].map((wz) => (
          <mesh key={`${wx}${wz}`} material={M.tire} position={[wx, 0.022, wz]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.018, 8]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Trucks() {
  return (
    <group>
      <Truck p={[-0.29, 0.11, 0.95]} yaw={Math.PI / 2} body={M.truckRed} />
      <Truck p={[-0.75, 0.11, 0.05]} yaw={0} body={M.truckBlue} />
    </group>
  );
}
