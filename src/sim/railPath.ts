/**
 * railPath — A* route finder for RAIL, over track pieces (see railPieces.ts).
 *
 * The search moves like a train: a state is "entered cell C through side S,
 * travelling with heading H (8 directions), having held H for R pieces". From
 * there it may lay one of three pieces (straight on, or a 45° curve piece to
 * either side), under Voxel-Tycoon-ish rules that give big, smooth curves:
 *   - the heading may change by at most 45° per piece,
 *   - after a heading change the route must hold the new heading for at least
 *     MIN_RUN pieces before turning again — so a 90° turn is spread over
 *     straight → ≥2 diagonal pieces → straight (no tight in-cell corners),
 *   - one height level max between consecutive cells; ramps only head-on,
 *   - existing pieces are re-used (cheap) — that's how a route JOINS a line;
 *     a new piece in an occupied cell makes a switch / crossing (allowed on
 *     flat ground, slightly penalised so it isn't done by accident),
 *   - a straight piece across a straight road makes a level crossing.
 *
 * Joining is decided by the cursor: starting on an existing line, the route
 * branches off whichever way leads to the cursor; ending on one, it curves in
 * and merges in the direction it is travelling.
 */

import {
  canAddRailPiece,
  canHostRail,
  entryHeading,
  headingDiff,
  isStraight,
  opposite,
  pieceBetween,
  pieceHeading,
  PIECE_COUNT,
  PIECE_SIDES,
  railBitsAt,
  SIDE_DX,
  SIDE_DZ,
} from './railPieces';
import { CellType, HILL_STEP, type TerrainMap } from './terrain';
import type { GridCell } from './pathfind';

/** One piece of a planned rail route. */
export interface RailStep extends GridCell {
  piece: number;
  /** Not yet on the map (costs money). */
  isNew: boolean;
}

export interface RailPathResult {
  steps: RailStep[];
  blocked: boolean;
}

/** Pieces a heading must be held for after a turn (bigger = wider curves). */
export const MIN_RUN = 3;
const R = MIN_RUN + 1;
const DIAG_LEN = Math.SQRT1_2;
/** Existing track is only a bit cheaper, so routes don't wander along it. */
const REUSE = 0.85;
/** Per 45° heading change: favours long straights/diagonals over wiggles. */
const TURN_COST = 1.6;
const CLIMB_COST = 0.4;
/** A new piece sharing a side with existing ones (creates a switch). */
const JUNCTION_COST = 2;
/** Straight across a perpendicular straight (diamond crossing). */
const DIAMOND_COST = 0.6;
const LEVEL_CROSSING_COST = 1;
/**
 * Heuristic weight. ≥ the true min cost per cell of fresh track (1), so the
 * search is a slightly greedy (weighted) A*: much faster on a 121² map, and
 * routes stay near-optimal; re-use of existing track is still preferred
 * locally via its lower step cost.
 */
const H_FACTOR = 1.15;
const MAX_EXPANSIONS = 40_000;

let buf: {
  g: Float32Array;
  from: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  /** Per cell: allowed-piece mask + 64 (0 = not computed yet). */
  allowed: Uint8Array;
  gen: number;
} | null = null;
function buffers(states: number, cells: number) {
  if (!buf || buf.g.length !== states) {
    buf = {
      g: new Float32Array(states),
      from: new Int32Array(states),
      seen: new Uint32Array(states),
      closed: new Uint32Array(states),
      allowed: new Uint8Array(cells),
      gen: 0,
    };
  }
  buf.gen++;
  buf.allowed.fill(0);
  return buf;
}

class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, f: number) {
    const a = this.ids, b = this.fs;
    a.push(id);
    b.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (b[p] <= b[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [b[p], b[i]] = [b[i], b[p]];
      i = p;
    }
  }
  peekF() {
    return this.fs[0];
  }
  pop(): number {
    const a = this.ids, b = this.fs;
    const top = a[0];
    const la = a.pop()!, lb = b.pop()!;
    if (a.length) {
      a[0] = la;
      b[0] = lb;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Heading variant of `h` relative to entering through side `s`: 0 straight, 1 = +45°, 2 = −45°. */
function variantOf(s: number, h: number): number {
  const d = headingDiff(entryHeading(s), h);
  return d === 0 ? 0 : d === 1 ? 1 : 2;
}
function headingOf(s: number, hv: number): number {
  const c = entryHeading(s);
  return hv === 0 ? c : hv === 1 ? (c + 1) % 8 : (c + 7) % 8;
}

/** Nearest cell to `goal` that can take rail (the goal itself if it can). */
function reachableGoal(map: TerrainMap, start: GridCell, goal: GridCell): { cell: GridCell; exact: boolean } {
  if (canHostRail(map, goal.x, goal.z)) return { cell: goal, exact: true };
  let best: GridCell | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= 10 && !best; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = goal.x + dx, z = goal.z + dz;
        if (!canHostRail(map, x, z)) continue;
        // Prefer near the goal, then toward the start.
        const d = Math.hypot(dx, dz) + 0.01 * Math.hypot(x - start.x, z - start.z);
        if (d < bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    }
  }
  return { cell: best ?? goal, exact: false };
}

/**
 * Cheap cell-level flood (4-neighbour, rail-capable cells, ≤ 1 level steps)
 * from `start`. If `goal` is not in the same region the full A* would scan the
 * whole region in vain, so we aim at the region's cell closest to the goal
 * instead (the route is then shown red, as blocked).
 */
let regionBuf: Uint8Array | null = null;
let queueBuf: Int32Array | null = null;
function retargetToRegion(map: TerrainMap, start: GridCell, goal: GridCell): { cell: GridCell; reachable: boolean } {
  const n = map.size;
  if (!regionBuf || regionBuf.length !== n * n) {
    regionBuf = new Uint8Array(n * n);
    queueBuf = new Int32Array(n * n);
  }
  const seenR = regionBuf;
  const q = queueBuf!;
  seenR.fill(0);
  const goalIdx = goal.x * n + goal.z;
  let head = 0, tail = 0;
  q[tail++] = start.x * n + start.z;
  seenR[start.x * n + start.z] = 1;
  let best = start.x * n + start.z;
  let bestD = Infinity;
  while (head < tail) {
    const c = q[head++];
    if (c === goalIdx) return { cell: goal, reachable: true };
    const x = (c / n) | 0, z = c - x * n;
    const d = (x - goal.x) ** 2 + (z - goal.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + SIDE_DX[k], nz = z + SIDE_DZ[k];
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const ni = nx * n + nz;
      if (seenR[ni]) continue;
      seenR[ni] = 1;
      if (Math.abs(map.heights[nx][nz] - map.heights[x][z]) > HILL_STEP + 1e-6) continue;
      if (!canHostRail(map, nx, nz)) continue;
      q[tail++] = ni;
    }
  }
  const bx = (best / n) | 0;
  return { cell: { x: bx, z: best - bx * n }, reachable: false };
}

/**
 * @param startHeading optional forced direction (0..7, see railPieces) the
 *   route must LEAVE point A in — set by the player with R. null = automatic.
 */
export function findRailPath(
  map: TerrainMap,
  start: GridCell,
  goalIn: GridCell,
  startHeading: number | null = null,
): RailPathResult {
  const n = map.size;
  if (!canHostRail(map, start.x, start.z)) return { steps: [], blocked: true };
  if (start.x === goalIn.x && start.z === goalIn.z) {
    // Just A with a chosen direction: lay the one piece pointing that way.
    if (startHeading === null) return { steps: [], blocked: false };
    const bits = railBitsAt(map, start.x, start.z);
    for (let s = 0; s < 4; s++) {
      for (let to = 0; to < 4; to++) {
        if (to === s) continue;
        const piece = pieceBetween(s, to);
        if (pieceHeading(piece, s) !== startHeading || !canAddRailPiece(map, start.x, start.z, piece)) continue;
        return { steps: [{ ...start, piece, isNew: (bits & (1 << piece)) === 0 }], blocked: false };
      }
    }
    return { steps: [], blocked: true };
  }
  const near = reachableGoal(map, start, goalIn);
  const region = retargetToRegion(map, start, near.cell);
  const goal = region.cell;
  const exact = near.exact && region.reachable;
  if (goal.x === start.x && goal.z === start.z) return { steps: [], blocked: true };

  const states = n * n * 4 * 3 * R;
  const B = buffers(states, n * n);
  const { g, from, seen, closed, gen, allowed } = B;
  /** Mask of pieces that may be laid (or already lie) in a cell — cached. */
  const allowedAt = (x: number, z: number): number => {
    const c = x * n + z;
    if (allowed[c] === 0) {
      let m = 64;
      for (let p = 0; p < PIECE_COUNT; p++) if (canAddRailPiece(map, x, z, p)) m |= 1 << p;
      allowed[c] = m;
    }
    return allowed[c];
  };
  const heap = new Heap();
  const sid = (cell: number, s: number, hv: number, r: number) => ((cell * 4 + s) * 3 + hv) * R + r;
  const hcost = (x: number, z: number) => Math.hypot(x - goal.x, z - goal.z) * H_FACTOR;

  const push = (id: number, ng: number, prev: number, x: number, z: number) => {
    if (closed[id] === gen) return;
    if (seen[id] === gen && g[id] <= ng) return;
    seen[id] = gen;
    g[id] = ng;
    from[id] = prev;
    heap.push(id, ng + hcost(x, z));
  };

  // Start states: virtual "arrivals" into A.
  const startCell = start.x * n + start.z;
  const startBits = railBitsAt(map, start.x, start.z);
  if (startBits) {
    // On an existing line: arrive along any of its pieces, from either end —
    // the route then continues on it or branches off (a switch).
    for (let p = 0; p < PIECE_COUNT; p++) {
      if (!(startBits & (1 << p))) continue;
      for (const a of PIECE_SIDES[p]) {
        push(sid(startCell, a, variantOf(a, pieceHeading(p, a)), MIN_RUN), 0, -1, start.x, start.z);
      }
    }
  } else if (startHeading !== null) {
    // Forced direction: every (entry side, variant) whose heading is it.
    for (let s = 0; s < 4; s++)
      for (let hv = 0; hv < 3; hv++)
        if (headingOf(s, hv) === startHeading) push(sid(startCell, s, hv, MIN_RUN), 0, -1, start.x, start.z);
  } else {
    for (let s = 0; s < 4; s++) push(sid(startCell, s, 0, MIN_RUN), 0, -1, start.x, start.z);
  }

  let final = -1;
  let finalPiece = -1;
  let finalG = Infinity;
  let best = -1;
  let bestD = Infinity;
  let expansions = 0;
  const goalBits = railBitsAt(map, goal.x, goal.z);

  while (heap.size > 0) {
    if (heap.peekF() >= finalG) break; // nothing left can beat the found route
    const id = heap.pop();
    if (closed[id] === gen) continue;
    closed[id] = gen;
    const r = id % R;
    const hv = ((id - r) / R) % 3;
    const s = (((id - r) / R - hv) / 3) % 4;
    const cell = ((((id - r) / R - hv) / 3) - s) / 4;
    const x = (cell / n) | 0;
    const z = cell - x * n;
    const h = headingOf(s, hv);
    const gHere = g[id];

    const dist = Math.hypot(x - goal.x, z - goal.z);
    if (from[id] >= 0 && dist < bestD) {
      bestD = dist;
      best = id;
    }
    if (++expansions > MAX_EXPANSIONS) break;

    const bits = railBitsAt(map, x, z);
    const type = map.cells[x][z];
    const hHere = map.heights[x][z];
    for (let to = 0; to < 4; to++) {
      if (to === s) continue;
      const piece = pieceBetween(s, to);
      const nh = pieceHeading(piece, s);
      const dh = headingDiff(h, nh);
      if (dh > 1 || dh < -1) continue;
      if (dh !== 0 && r < MIN_RUN) continue;
      // The first piece out of A follows the player's chosen direction.
      if (startHeading !== null && from[id] === -1 && nh !== startHeading) continue;
      const exists = (bits & (1 << piece)) !== 0;
      if (!exists && !(allowedAt(x, z) & (1 << piece))) continue;
      // Level crossing: straight in, straight out.
      if (type === CellType.Road && dh !== 0) continue;

      let cost = (isStraight(piece) ? 1 : DIAG_LEN) * (exists ? REUSE : 1);
      if (dh !== 0) cost += TURN_COST;
      if (!exists && bits) {
        const diamond = isStraight(piece) && (bits === 1 || bits === 2) && bits !== 1 << piece;
        cost += diamond ? DIAMOND_COST : JUNCTION_COST;
      }
      if (!exists && type === CellType.Road) cost += LEVEL_CROSSING_COST;
      const ng = gHere + cost;

      // Reached the goal cell with a valid last piece: on an existing line the
      // route must arrive ONTO it (merge), otherwise any piece ends it.
      if (x === goal.x && z === goal.z && (goalBits === 0 || exists)) {
        if (ng < finalG) {
          finalG = ng;
          final = id;
          finalPiece = piece;
        }
        continue;
      }

      const nx = x + SIDE_DX[to];
      const nz = z + SIDE_DZ[to];
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const dHeight = Math.abs(map.heights[nx][nz] - hHere);
      if (dHeight > HILL_STEP + 1e-6) continue;
      const ns = opposite(to);
      const nr = dh === 0 ? Math.min(r + 1, MIN_RUN) : 1;
      push(sid(nx * n + nz, ns, variantOf(ns, nh), nr), ng + (dHeight > 1e-6 ? CLIMB_COST : 0), id, nx, nz);
    }
  }

  // Rebuild the piece list: each state's piece runs from its entry side to
  // the side the next state entered through.
  const chain: number[] = [];
  const tail = final >= 0 ? final : best;
  for (let id = tail; id >= 0; id = from[id]) chain.push(id);
  chain.reverse();
  const steps: RailStep[] = [];
  const decode = (id: number) => {
    const r = id % R;
    const hv = ((id - r) / R) % 3;
    const s = (((id - r) / R - hv) / 3) % 4;
    const cell = ((((id - r) / R - hv) / 3) - s) / 4;
    const x = (cell / n) | 0;
    return { x, z: cell - x * n, s };
  };
  const add = (x: number, z: number, piece: number) =>
    steps.push({ x, z, piece, isNew: (railBitsAt(map, x, z) & (1 << piece)) === 0 });
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = decode(chain[i]);
    const b = decode(chain[i + 1]);
    add(a.x, a.z, pieceBetween(a.s, opposite(b.s)));
  }
  if (final >= 0) {
    const a = decode(final);
    add(a.x, a.z, finalPiece);
  }
  return { steps, blocked: final < 0 || !exact };
}
