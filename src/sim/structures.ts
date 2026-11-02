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
/** Longest tunnel (cells spanned): through big hills. */
export const MAX_TUNNEL = 40;
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
  const max = kind === 'tunnel' ? MAX_TUNNEL : MAX_SPAN;
  if (span > max) return `Legfeljebb ${max} cella hosszú lehet`;
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
  let hill = 0, flat = 0, crossed = false, top = -Infinity;
  const inner = interiorOf({ a, b });
  for (const [x, z] of inner) {
    if (structureAt(map, x, z)) return 'Másik hidat / alagutat keresztezne';
    const t = map.cells[x][z];
    if (kind === 'bridge') {
      if (!UNDER_BRIDGE_OK.has(t)) return 'A híd alatt csak víz, föld, út vagy sín lehet';
      if (t !== CellType.Water && maxCorner(map, x, z) > L - HILL_STEP + EPS) return 'Túl alacsony: a hídfők legyenek egy szinttel magasabban annál, ami alatta van (Emelés)';
    } else {
      if (!OVER_TUNNEL_OK.has(t)) return 'Az alagút nem vezethet itt át';
      if (minCorner(map, x, z) < L - EPS) return 'Az alagút nem mehet a szájánál mélyebbre (Emelés a szájaknál / Süllyesztés)';
      // Part of the hill (its slope or top), or flat ground at the portals' level.
      top = Math.max(top, maxCorner(map, x, z));
      if (maxCorner(map, x, z) >= L + HILL_STEP - EPS) hill++;
      else flat++;
      if (t === CellType.Road || t === CellType.Rail || hasRailAt(map, x, z)) crossed = true;
    }
  }
  if (kind === 'tunnel') {
    // Through a hill: from its foot to the other side — every cell is hill.
    if (hill > 0 && flat > 0) return 'Hegyi alagút csak a hegy lábától a túloldaláig vezethet';
    // A real hill: at least two steps above the portals somewhere (the tube is that tall).
    if (hill > 0 && top < L + 2 * HILL_STEP - EPS) return 'Ez a domb túl alacsony az alagúthoz (legalább 2 szint magas kell legyen)';
    // An underpass: short, and under a road / rail.
    if (hill === 0) {
      if (!crossed) return 'Az alagútnak hegy, út vagy sín alatt kell átmennie';
      if (inner.length > UNDERPASS_MAX) return `Az aluljáró legfeljebb ${UNDERPASS_MAX} cella hosszú lehet`;
      // Its ramps start a cell before each end: those cells must be free and flat too.
      for (const [x, z] of approachOf({ a, b })) {
        if (!inside([x, z]) || structureAt(map, x, z) || !ABUTMENT_OK.has(map.cells[x][z]) || flatAt(map, x, z) === null || Math.abs(flatAt(map, x, z)! - L) > EPS)
          return 'Az aluljáró rámpájához mindkét vége előtt kell még egy szabad, sík cella';
      }
    }
  }
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

// ------------------------------------------------------------- underpasses

/**
 * An underpass (a tunnel on flat ground, under a road / rail) is CUT INTO the
 * ground, open along its whole length (a concrete-walled trench): two-cell
 * ramps (the cell before each end + the end itself) lead down to
 * UNDERPASS_DEPTH; over the span what crosses it stays at ground level, on a
 * slab. At most UNDERPASS_MAX cells long.
 */
export const UNDERPASS_DEPTH = 0.8;
export const UNDERPASS_MAX = 3;
/** Cells a ramp takes (the approach + the end). */
export const RAMP_CELLS = 2;

const underCache = new WeakMap<Structure, boolean>();
/** Is this tunnel an underpass (its whole span flat at the portals' level)? */
export function isUnderpass(map: TerrainMap, s: Structure): boolean {
  if (s.kind !== 'tunnel') return false;
  let u = underCache.get(s);
  if (u === undefined) {
    u = interiorOf(s).every(([x, z]) => maxCorner(map, x, z) < s.level + HILL_STEP - EPS);
    underCache.set(s, u);
  }
  return u;
}

/** The cells just before each end of a span (an underpass's ramps start there): [before a, after b]. */
export function approachOf(s: Pick<Structure, 'a' | 'b'>): Array<[number, number]> {
  const [dx, dz] = axisOf(s);
  return [
    [s.a[0] - dx, s.a[1] - dz],
    [s.b[0] + dx, s.b[1] + dz],
  ];
}

export type TrenchRole = 'approach' | 'abutment' | 'interior';
interface TrenchCell {
  s: Structure;
  role: TrenchRole;
  /** The end (a or b) this ramp cell belongs to. */
  atA: boolean;
}
const trenchCache = new WeakMap<readonly Structure[], Map<number, TrenchCell>>();
function trenchIndex(map: TerrainMap): Map<number, TrenchCell> {
  const list = map.structures!;
  let m = trenchCache.get(list);
  if (!m) {
    m = new Map();
    for (const s of list) {
      if (!isUnderpass(map, s)) continue;
      const [pa, pb] = approachOf(s);
      m.set(pa[0] * map.size + pa[1], { s, role: 'approach', atA: true });
      m.set(pb[0] * map.size + pb[1], { s, role: 'approach', atA: false });
      m.set(s.a[0] * map.size + s.a[1], { s, role: 'abutment', atA: true });
      m.set(s.b[0] * map.size + s.b[1], { s, role: 'abutment', atA: false });
      for (const [x, z] of interiorOf(s)) m.set(x * map.size + z, { s, role: 'interior', atA: true });
    }
    trenchCache.set(list, m);
  }
  return m;
}

/** Cell (x, z) of an underpass's trench (its ramps and its span), or null. */
export function trenchAt(map: TerrainMap, x: number, z: number): TrenchCell | null {
  if (!map.structures?.length || x < 0 || z < 0 || x >= map.size || z >= map.size) return null;
  return trenchIndex(map).get(x * map.size + z) ?? null;
}

/** The underpass whose RAMP (an approach or end cell) is cell (x, z), or null. */
export function cutAt(map: TerrainMap, x: number, z: number): Structure | null {
  const t = trenchAt(map, x, z);
  return t && t.role !== 'interior' ? t.s : null;
}

/** How deep the ground at world point (x, z) is cut away (an underpass ramp), 0 elsewhere. */
export function cutDepth(map: TerrainMap, x: number, z: number): number {
  if (!map.structures?.length) return 0;
  const cx = Math.round(x), cz = Math.round(z);
  const t = trenchAt(map, cx, cz);
  if (!t || t.role === 'interior') return 0;
  const s = t.s;
  const [dx, dz] = axisOf(s);
  // The portal's plane: half a cell past the end, towards the span.
  const end = t.atA ? s.a : s.b, sg = t.atA ? 1 : -1;
  const u = ((end[0] + 0.5 * dx * sg - x) * dx + (end[1] + 0.5 * dz * sg - z) * dz) * sg; // 0 at the portal … RAMP_CELLS outside
  return UNDERPASS_DEPTH * Math.max(0, Math.min(1, 1 - u / RAMP_CELLS));
}

/** Floor of a structure's track / road (cell units, without FLAT_TOP): an underpass runs deeper. */
export function floorOf(map: TerrainMap, s: Structure): number {
  return isUnderpass(map, s) ? s.level - UNDERPASS_DEPTH : s.level;
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

/**
 * Is p → q (neighbouring cells) a step ALONG a bridge / tunnel that can take
 * `what` (empty, or already carrying it)? — from an abutment into its span,
 * through it, or out onto the other abutment. Such a step goes on the
 * structure, whatever the cells below are.
 */
export function structureStep(map: TerrainMap, p: { x: number; z: number }, q: { x: number; z: number }, what: 'road' | 'rail'): Structure | null {
  const rp = structureAt(map, p.x, p.z), rq = structureAt(map, q.x, q.z);
  if (!rp || !rq || rp.s !== rq.s) return null;
  if (rp.role !== 'interior' && rq.role !== 'interior') return null;
  const s = rp.s;
  if (s.carries && s.carries !== what) return null;
  const [dx, dz] = axisOf(s);
  const sx = q.x - p.x, sz = q.z - p.z;
  return Math.abs(sx) === Math.abs(dx) && Math.abs(sz) === Math.abs(dz) ? s : null;
}

/** May a ground road / rail step from cell p to the neighbouring cell q? (Not along under / over a span.) */
export function groundStepOk(map: TerrainMap, p: { x: number; z: number }, q: { x: number; z: number }): boolean {
  const rp = structureAt(map, p.x, p.z), rq = structureAt(map, q.x, q.z);
  if (!rp || !rq || rp.s !== rq.s) return true;
  if (rp.role !== 'interior' && rq.role !== 'interior') return true;
  // Along the span (abutment → span, or through it): that's the structure's way, not the ground's.
  const [dx, dz] = axisOf(rp.s);
  return !(Math.abs(q.x - p.x) === Math.abs(dx) && Math.abs(q.z - p.z) === Math.abs(dz));
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
