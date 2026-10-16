/**
 * railPieces — OpenTTD-style rail track pieces.
 *
 * Every cell stores WHICH track pieces it holds, as a 6-bit mask in
 * `TerrainMap.rails`. A piece connects the mid-points of two of the cell's
 * four sides:
 *
 *     straight:  NS ║   EW ═
 *     curve:     NE ╚   SE ╔   SW ╗   NW ╝     (a half-cell 45° piece)
 *
 * Two cells are connected only where both have a piece touching their shared
 * side, so parallel tracks no longer stick together. Any combination of pieces
 * may share a flat cell, which gives every layout for free:
 *   - NS + EW            → diamond crossing (no switch),
 *   - straight + curve   → turnout (switch) where they share a side,
 *   - two curves (NE+NW) → Y / two-way split,
 *   - NE + SW            → two parallel diagonal tracks,
 *   - a straight on a Road cell → level crossing.
 *
 * Diagonal track is a run of alternating curve pieces (e.g. NE heading:
 * W→N then S→E then W→N ...), and big curves are straight → diagonal run →
 * straight; the renderer smooths the joints into sweeping arcs.
 *
 * Sides: 0 = N (−z), 1 = E (+x), 2 = S (+z), 3 = W (−x).
 * Headings (8 directions, 45° steps): 0 = E, 1 = NE, 2 = N, 3 = NW, 4 = W,
 * 5 = SW, 6 = S, 7 = SE.
 */

import {
  CellType,
  cellCornerHeights,
  cellRiseWithinOneStep,
  getSlopeKind,
  type TerrainMap,
} from './terrain';

export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;
export type Side = 0 | 1 | 2 | 3;

export const SIDE_DX = [0, 1, 0, -1] as const;
export const SIDE_DZ = [-1, 0, 1, 0] as const;
export const opposite = (s: number): Side => ((s + 2) & 3) as Side;

/** Piece index → its two sides. Bit of piece i is `1 << i`. */
export const PIECE_SIDES: ReadonlyArray<readonly [Side, Side]> = [
  [N, S], // 0 NS
  [E, W], // 1 EW
  [N, E], // 2 NE
  [S, E], // 3 SE
  [S, W], // 4 SW
  [N, W], // 5 NW
];
export const PIECE_COUNT = 6;
export const STRAIGHT_NS = 0;
export const STRAIGHT_EW = 1;

/** Piece index connecting sides a and b (a ≠ b). */
export function pieceBetween(a: number, b: number): number {
  for (let i = 0; i < PIECE_COUNT; i++) {
    const [p, q] = PIECE_SIDES[i];
    if ((p === a && q === b) || (p === b && q === a)) return i;
  }
  return -1;
}

export const isStraight = (piece: number) => piece < 2;

/** Pieces (indices) in `bits` touching side `s`. */
export function piecesAtSide(bits: number, s: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    if (bits & (1 << i) && (PIECE_SIDES[i][0] === s || PIECE_SIDES[i][1] === s)) out.push(i);
  }
  return out;
}

/** The other side of piece `piece` from side `s`. */
export function otherSide(piece: number, s: number): Side {
  const [a, b] = PIECE_SIDES[piece];
  return a === s ? b : a;
}

/** Cardinal heading of travel when ENTERING a cell through side `s`. */
export function entryHeading(s: number): number {
  // Enter via N → moving S (6); E → W (4); S → N (2); W → E (0).
  return [6, 4, 2, 0][s];
}

/** Heading of travel along `piece` entering through side `from`. */
export function pieceHeading(piece: number, from: number): number {
  const to = otherSide(piece, from);
  const c = entryHeading(from);
  if (to === opposite(from)) return c;
  // Turning to a side: heading is the diagonal between straight-on and that side.
  // Exit side → its outward cardinal heading.
  const out = [2, 0, 6, 4][to];
  // The diagonal between c and out (they're 90° apart).
  const d = (out - c + 8) % 8; // 2 or 6
  return d === 2 ? (c + 1) % 8 : (c + 7) % 8;
}

/** Signed smallest difference between two headings, in 45° steps (−4..4). */
export function headingDiff(a: number, b: number): number {
  let d = (b - a) % 8;
  if (d > 4) d -= 8;
  if (d < -4) d += 8;
  return d;
}

/** Rail piece mask of a cell (0 if none / out of bounds). */
export function railBitsAt(map: TerrainMap, x: number, z: number): number {
  if (!map.rails || x < 0 || z < 0 || x >= map.size || z >= map.size) return 0;
  return map.rails[x * map.size + z];
}

function isFlatCell(map: TerrainMap, x: number, z: number): boolean {
  const [a, b, c, d] = cellCornerHeights(map, x, z);
  return a === b && b === c && c === d;
}

const cellIs = (map: TerrainMap, x: number, z: number, t: CellType) =>
  x >= 0 && z >= 0 && x < map.size && z < map.size && map.cells[x][z] === t;

/**
 * Can a road run through this rail cell as a level crossing? The cell must be
 * flat, hold exactly one straight piece, and no road may touch it along the
 * rail's own axis. Returns the axis the ROAD must travel ('x' | 'z'), or null.
 */
export function roadCrossingAxis(map: TerrainMap, x: number, z: number): 'x' | 'z' | null {
  const bits = railBitsAt(map, x, z);
  if (bits !== 1 << STRAIGHT_NS && bits !== 1 << STRAIGHT_EW) return null;
  const t = map.cells[x][z];
  if (t !== CellType.Rail && t !== CellType.Road) return null;
  if (!isFlatCell(map, x, z)) return null;
  // Rail NS → the road crosses along x; rail EW → along z.
  if (bits === 1 << STRAIGHT_NS) {
    if (cellIs(map, x, z - 1, CellType.Road) || cellIs(map, x, z + 1, CellType.Road)) return null;
    return 'x';
  }
  if (cellIs(map, x - 1, z, CellType.Road) || cellIs(map, x + 1, z, CellType.Road)) return null;
  return 'z';
}

/**
 * May `piece` be added to cell (x, z)? (True if it is already there.)
 *   - Empty / Hill: buildable terrain (flat, or a straight one-step ramp);
 *     on a ramp only the straight along the slope.
 *   - Rail: on flat ground any further piece (crossings, switches, splits);
 *     on a ramp nothing else.
 *   - Road: a level crossing — flat, straight road, the rail straight across.
 */
export function canAddRailPiece(map: TerrainMap, x: number, z: number, piece: number): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  const bits = railBitsAt(map, x, z);
  const bit = 1 << piece;
  if (bits & bit) return true;
  const t = map.cells[x][z];
  if (t === CellType.Empty || t === CellType.Hill) {
    const kind = getSlopeKind(map, x, z);
    if (kind === 'invalid' || !cellRiseWithinOneStep(map, x, z)) return false;
    if (kind === 'slopeX') return piece === STRAIGHT_EW;
    if (kind === 'slopeZ') return piece === STRAIGHT_NS;
    return true;
  }
  if (t === CellType.Rail) return isFlatCell(map, x, z);
  if (t === CellType.Road) {
    if (bits !== 0 || !isStraight(piece) || !isFlatCell(map, x, z)) return false;
    // The road must run straight across the rail, and nothing else touch it.
    const railAlongZ = piece === STRAIGHT_NS;
    const roadNeighbourOnRailAxis = railAlongZ
      ? cellIs(map, x, z - 1, CellType.Road) || cellIs(map, x, z + 1, CellType.Road)
      : cellIs(map, x - 1, z, CellType.Road) || cellIs(map, x + 1, z, CellType.Road);
    return !roadNeighbourOnRailAxis;
  }
  return false;
}

/** Can a rail route start / end on this cell at all? */
export function canHostRail(map: TerrainMap, x: number, z: number): boolean {
  if (railBitsAt(map, x, z)) return true;
  for (let i = 0; i < PIECE_COUNT; i++) if (canAddRailPiece(map, x, z, i)) return true;
  return false;
}
