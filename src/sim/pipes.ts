/**
 * Oil pipelines: cells (`map.pipes`, index x·size + z) the player lays from the
 * oil rig to an oil depot (oilDepot.ts). A pipe runs on the lake bed / under
 * the ground, so it may cross water, bare land, forest, roads and rails; not
 * industries, stations, depots or the city. A depot whose lot touches a pipe
 * network that also touches the rig's lot gets the rig's oil (production.ts).
 *
 * Pay: oil carried away from a depot counts its distance from the shore point
 * nearest the rig (`rigShore`), not from the rig or the depot — the pipe is not
 * a way to earn more by carrying it farther.
 * Pure TypeScript.
 */

import { CellType, industryFootprint, type TerrainMap } from './terrain';
import { isOilDepot, oilCells } from './oilDepot';

/** Price per pipe cell: on land / under water. */
export const PIPE_PRICE = { land: 40, water: 80 } as const;

const OK = new Set<CellType>([CellType.Empty, CellType.Forest, CellType.Water, CellType.Road, CellType.Rail, CellType.Hill]);

/** May a pipe go on (x, z)? */
export function pipeCellOk(map: TerrainMap, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return false;
  return OK.has(map.cells[x][z]);
}

/** Price of laying pipe on `path` (cells that can't take one / have one cost nothing). */
export function pipeCost(map: TerrainMap, path: Array<[number, number]>): number {
  const have = new Set(map.pipes ?? []);
  let c = 0;
  for (const [x, z] of path) {
    if (have.has(x * map.size + z) || !pipeCellOk(map, x, z)) continue;
    c += map.cells[x][z] === CellType.Water ? PIPE_PRICE.water : PIPE_PRICE.land;
  }
  return c;
}

/**
 * The pipe path from a to b: straight along the longer axis first, then the
 * other (an L). Cells that can't take a pipe are left in (the preview marks them).
 */
export function pipePath(a: [number, number], b: [number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const [ax, az] = a;
  const [bx, bz] = b;
  const xFirst = Math.abs(bx - ax) >= Math.abs(bz - az);
  const sx = Math.sign(bx - ax), sz = Math.sign(bz - az);
  let x = ax, z = az;
  out.push([x, z]);
  if (xFirst) {
    while (x !== bx) out.push([(x += sx), z]);
    while (z !== bz) out.push([x, (z += sz)]);
  } else {
    while (z !== bz) out.push([x, (z += sz)]);
    while (x !== bx) out.push([(x += sx), z]);
  }
  return out;
}

/** The oil rig's anchor, or null. */
export function rigAnchor(map: TerrainMap): [number, number] | null {
  for (let x = 0; x < map.size; x++) for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.OilRig) return [x, z];
  return null;
}

/** The rig's lot cells. */
function rigCells(a: [number, number]): Array<[number, number]> {
  const { lo, hi } = industryFootprint(CellType.OilRig);
  const out: Array<[number, number]> = [];
  for (let dx = lo; dx <= hi; dx++) for (let dz = lo; dz <= hi; dz++) out.push([a[0] + dx, a[1] + dz]);
  return out;
}

/** The land cell nearest the rig (the pay distance for its oil starts there). */
export function rigShore(map: TerrainMap): [number, number] | null {
  const a = rigAnchor(map);
  if (!a) return null;
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let x = 0; x < map.size; x++)
    for (let z = 0; z < map.size; z++) {
      const t = map.cells[x][z];
      if (t === CellType.Water || t === CellType.IndustryLot || t === CellType.OilRig) continue;
      const d = (x - a[0] - 0.5) ** 2 + (z - a[1] - 0.5) ** 2;
      if (d < bd) {
        bd = d;
        best = [x, z];
      }
    }
  return best;
}

/** Ids of the oil depots joined to the rig by pipe (in the order found). */
export function pipedDepots(map: TerrainMap): number[] {
  const pipes = map.pipes;
  const a = rigAnchor(map);
  if (!pipes?.length || !a) return [];
  const n = map.size;
  const set = new Set(pipes);
  const seen = new Set<number>();
  const queue: number[] = [];
  const near = (x: number, z: number) => [
    [x + 1, z],
    [x - 1, z],
    [x, z + 1],
    [x, z - 1],
  ];
  // Touching (also diagonally) the rig's / a depot's lot joins it.
  const around = (x: number, z: number) => {
    const out: number[][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) out.push([x + dx, z + dz]);
    return out;
  };
  // Pipe cells touching the rig's lot start the search.
  for (const [x, z] of rigCells(a))
    for (const [nx, nz] of around(x, z)) {
      const k = nx * n + nz;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  while (queue.length) {
    const k = queue.pop()!;
    const x = Math.floor(k / n), z = k % n;
    for (const [nx, nz] of near(x, z)) {
      const j = nx * n + nz;
      if (set.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  const out: number[] = [];
  for (const st of map.stations ?? []) {
    if (!isOilDepot(st)) continue;
    if (oilCells(st).some(({ x, z }) => around(x, z).some(([nx, nz]) => seen.has(nx * n + nz)))) out.push(st.id);
  }
  return out;
}
