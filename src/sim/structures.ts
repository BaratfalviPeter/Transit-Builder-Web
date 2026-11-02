/**
 * Structures — bridges and tunnels: a SECOND LEVEL over / under the cells.
 *
 * A structure is a straight span along an axis between two ABUTMENT cells
 * (`a`, `b`: ordinary ground cells, its ends) over the INTERIOR cells between
 * them. The interior cells keep what they are (water, a road, a hill…): the
 * structure is built first, empty; then a road or a rail is laid on it
 * (`carries`). What it carries runs at the abutments' height (`level`) and
 * never meets what is on the cells below it:
 *   - a road: the road network links the two abutments directly (`roadLink`);
 *     a truck's route JUMPS from one to the other (the lane knows the span —
 *     `deckBoxes`), so junctions / level crossings / trucks under it don't
 *     concern it;
 *   - a rail: one rail-network edge from abutment to abutment, flagged with
 *     the structure (its footprint skips the interior cells: no crossing with
 *     the tracks / roads below).
 *
 * Rules (`structureProblem`): the abutments are flat, level with each other.
 *   - BRIDGE: every interior cell is water, or at least a step (HILL_STEP)
 *     below the deck.
 *   - TUNNEL: no interior cell is lower than the portals or water, and it
 *     goes under SOMETHING: a hill (a step higher), or a road / rail on the
 *     ground (an underpass).
 * Ground roads / rails may cross under a bridge (or over a tunnel), but not
 * run along it.
 *
 * Pure TypeScript.
 */

import { hasRailAt } from './railNet';
import { CellType, cornerHeightAt, HILL_STEP, type TerrainMap } from './terrain';

export type StructureKind = 'bridge' | 'tunnel';

export interface Structure {
  readonly id: number;
  readonly kind: StructureKind;
  /** The abutment cells (the span's ends), along one axis. */
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  /** Height of the deck / tunnel floor: the abutments' ground (cell units, without FLAT_TOP). */
  readonly level: number;
  /** What runs on it (nothing yet = undefined). */
  readonly carries?: 'road' | 'rail';
}

/** Longest span (interior cells). */
export const MAX_SPAN = 14;
/** Price per interior cell. */
export const STRUCTURE_PRICE: Record<StructureKind, number> = { bridge: 250, tunnel: 400 };

const EPS = 1e-6;

/** Unit step from `a` towards `b`. */
export function axisOf(s: Pick<Structure, 'a' | 'b'>): [number, number] {
  return [Math.sign(s.b[0] - s.a[0]), Math.sign(s.b[1] - s.a[1])];
}

/** The interior cells, from `a`'s side to `b`'s. */
export function interiorOf(s: Pick<Structure, 'a' | 'b'>): Array<[number, number]> {
  const [dx, dz] = axisOf(s);
  const out: Array<[number, number]> = [];
  for (let x = s.a[0] + dx, z = s.a[1] + dz; x !== s.b[0] || z !== s.b[1]; x += dx, z += dz) out.push([x, z]);
  return out;
}

interface CellRef {
  s: Structure;
  role: 'interior' | 'abutment';
}
const indexCache = new WeakMap<readonly Structure[], Map<number, CellRef>>();

/** Cell index (x·size + z) → the structure there (interior or abutment). Cached per list. */
function index(map: TerrainMap): Map<number, CellRef> {
  const list = map.structures ?? [];
  let idx = indexCache.get(list);
  if (idx) return idx;
  idx = new Map();
  const n = map.size;
  for (const s of list) {
    idx.set(s.a[0] * n + s.a[1], { s, role: 'abutment' });
    idx.set(s.b[0] * n + s.b[1], { s, role: 'abutment' });
    for (const [x, z] of interiorOf(s)) idx.set(x * n + z, { s, role: 'interior' });
  }
  indexCache.set(list, idx);
  return idx;
}

/** The structure whose span covers (x, z), and the cell's role in it, or null. */
export function structureAt(map: TerrainMap, x: number, z: number): CellRef | null {
  if (!map.structures?.length || x < 0 || z < 0 || x >= map.size || z >= map.size) return null;
  return index(map).get(x * map.size + z) ?? null;
}

/** The structure (if any) whose INTERIOR covers (x, z). */
export function interiorAt(map: TerrainMap, x: number, z: number): Structure | null {
  const r = structureAt(map, x, z);
  return r && r.role === 'interior' ? r.s : null;
}

/** All four corners of (x, z) at `h`? */
function flatAt(map: TerrainMap, x: number, z: number): number | null {
  const h = cornerHeightAt(map, x, z);
  if (cornerHeightAt(map, x + 1, z) !== h || cornerHeightAt(map, x, z + 1) !== h || cornerHeightAt(map, x + 1, z + 1) !== h) return null;
  return h;
}
const minCorner = (map: TerrainMap, x: number, z: number) =>
  Math.min(cornerHeightAt(map, x, z), cornerHeightAt(map, x + 1, z), cornerHeightAt(map, x, z + 1), cornerHeightAt(map, x + 1, z + 1));
const maxCorner = (map: TerrainMap, x: number, z: number) =>
  Math.max(cornerHeightAt(map, x, z), cornerHeightAt(map, x + 1, z), cornerHeightAt(map, x, z + 1), cornerHeightAt(map, x + 1, z + 1));

const ABUTMENT_OK = new Set<CellType>([CellType.Empty, CellType.Hill, CellType.Road, CellType.Rail]);
const UNDER_BRIDGE_OK = new Set<CellType>([CellType.Water, CellType.Empty, CellType.Hill, CellType.Road, CellType.Rail]);
const OVER_TUNNEL_OK = new Set<CellType>([CellType.Empty, CellType.Hill, CellType.Forest, CellType.Road, CellType.Rail]);

/** Why a `kind` can't span from `a` to `b` — Hungarian, for the UI — or null. */
export function structureProblem(map: TerrainMap, kind: StructureKind, a: readonly [number, number], b: readonly [number, number]): string | null {
  const n = map.size;
  const inside = ([x, z]: readonly [number, number]) => x >= 0 && z >= 0 && x < n && z < n;
  if (!inside(a) || !inside(b)) return 'Kilógna a térképről';
  if (a[0] !== b[0] && a[1] !== b[1]) return 'Csak egyenesen (sor vagy oszlop mentén)';
  const span = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) - 1;
  if (span < 1) return kind === 'bridge' ? 'A hídnak legalább egy cellát át kell ívelnie' : 'Az alagútnak legalább egy cella hosszú kell legyen';
  if (span > MAX_SPAN) return `Legfeljebb ${MAX_SPAN} cella hosszú lehet`;
  // Abutments: free, flat, level with each other.
  let level: number | null = null;
  for (const [x, z] of [a, b]) {
    if (structureAt(map, x, z)) return 'Itt már van híd / alagút';
    if (!ABUTMENT_OK.has(map.cells[x][z])) return kind === 'bridge' ? 'A hídfő csak szabad, sík talajra kerülhet' : 'Az alagút szája csak szabad, sík talajra kerülhet';
    const h = flatAt(map, x, z);
    if (h === null) return kind === 'bridge' ? 'A hídfő nem lehet lejtőn' : 'Az alagút szája nem lehet lejtőn';
    if (level !== null && Math.abs(h - level) > EPS) return 'A két végének egy magasságban kell lennie';
    level = h;
  }
  const L = level!;
  let under = false;
  for (const [x, z] of interiorOf({ a, b })) {
    if (structureAt(map, x, z)) return 'Másik hidat / alagutat keresztezne';
    const t = map.cells[x][z];
    if (kind === 'bridge') {
      if (!UNDER_BRIDGE_OK.has(t)) return 'A híd alatt csak víz, föld, út vagy sín lehet';
      if (t !== CellType.Water && maxCorner(map, x, z) > L - HILL_STEP + EPS) return 'Túl alacsony: a hídfők legyenek egy szinttel magasabban annál, ami alatta van (Emelés)';
    } else {
      if (!OVER_TUNNEL_OK.has(t)) return 'Az alagút nem vezethet itt át';
      if (minCorner(map, x, z) < L - EPS) return 'Az alagút nem mehet a szájánál mélyebbre (Emelés a szájaknál / Süllyesztés)';
      if (minCorner(map, x, z) >= L + HILL_STEP - EPS || t === CellType.Road || t === CellType.Rail || hasRailAt(map, x, z)) under = true;
    }
  }
  if (kind === 'tunnel' && !under) return 'Az alagútnak hegy, út vagy sín alatt kell átmennie';
  return null;
}

/** Height of the abutments (cell units) for a span from `a` (its ground). */
export function levelAt(map: TerrainMap, a: readonly [number, number]): number {
  return cornerHeightAt(map, a[0], a[1]);
}

/** Price of a span from `a` to `b`. */
export function structurePrice(kind: StructureKind, a: readonly [number, number], b: readonly [number, number]): number {
  return Math.max(0, Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) - 1) * STRUCTURE_PRICE[kind];
}

// ------------------------------------------------------------- road links

/** The far abutment a road at abutment (x, z) continues to over a road-carrying structure, or null. */
export function roadLinkFrom(map: TerrainMap, x: number, z: number): { to: [number, number]; s: Structure } | null {
  const r = structureAt(map, x, z);
  if (!r || r.role !== 'abutment' || r.s.carries !== 'road') return null;
  const s = r.s;
  const atA = s.a[0] === x && s.a[1] === z;
  return { to: atA ? [s.b[0], s.b[1]] : [s.a[0], s.a[1]], s };
}

/** Does the road at (x, z) continue over a structure one step towards (dx, dz)? */
export function roadLinkDir(map: TerrainMap, x: number, z: number, dx: number, dz: number): boolean {
  const l = roadLinkFrom(map, x, z);
  if (!l) return false;
  return Math.sign(l.to[0] - x) === dx && Math.sign(l.to[1] - z) === dz;
}

/** May a ground road / rail step from cell p to the neighbouring cell q? (Not along under / over a span.) */
export function groundStepOk(map: TerrainMap, p: { x: number; z: number }, q: { x: number; z: number }): boolean {
  const s = interiorAt(map, p.x, p.z);
  return !s || s !== interiorAt(map, q.x, q.z);
}

/**
 * The world boxes of the spans a cell route jumps over (consecutive cells two
 * or more apart: abutment → abutment), for its lane — see `onDeck`.
 */
export function deckBoxes(path: ReadonlyArray<readonly [number, number]>): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    if (Math.abs(bx - ax) + Math.abs(bz - az) < 2) continue;
    out.push([Math.min(ax, bx) + 0.5, Math.max(ax, bx) - 0.5, Math.min(az, bz) + 0.5, Math.max(az, bz) - 0.5]);
  }
  return out;
}

/** Is world point (x, z) inside one of these deck boxes (i.e. up on / down in a structure)? */
export function inBoxes(boxes: ReadonlyArray<[number, number, number, number]> | undefined, x: number, z: number): boolean {
  if (!boxes) return false;
  for (const [x0, x1, z0, z1] of boxes) {
    // Along the span: between the abutment edges; across it: within the cell row.
    const alongX = x1 - x0 > z1 - z0;
    if (alongX ? x > x0 && x < x1 && Math.abs(z - (z0 + z1) / 2) < 0.6 : z > z0 && z < z1 && Math.abs(x - (x0 + x1) / 2) < 0.6) return true;
  }
  return false;
}

/** The structure a vehicle at (x, z) heading (hx, hz) is on / in, or null (on the ground). */
export function spanUnder(map: TerrainMap, x: number, z: number, hx: number, hz: number, carries: 'road' | 'rail'): Structure | null {
  const s = interiorAt(map, Math.round(x), Math.round(z));
  if (!s || s.carries !== carries) return null;
  const [dx, dz] = axisOf(s);
  return Math.abs(hx * dx + hz * dz) > 0.7 ? s : null;
}
