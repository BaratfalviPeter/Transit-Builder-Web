/**
 * economy — the monthly running costs (the economic pressure).
 *
 *   - UPKEEP of the infrastructure, per month: road / rail per cell, stops,
 *     depots, signals, traffic controls, bridges / tunnels per spanned cell (UPKEEP);
 *   - RUNNING cost of the vehicles, per month: a truck, a locomotive and each
 *     wagon (RUNNING), booked to their line.
 *
 * Pure TypeScript. FinanceDriver (useFinance.ts) charges
 * them into GameState at every month's end (`closeMonth`).
 */

import { isDepot } from './depot';
import { OIL_START_BAYS, OIL_START_TRACKS, isOilLot, isRefinery } from './oilDepot';
import { LineWalker } from './railNet';
import { stopKind } from './stations';
import { CellType, type TerrainMap } from './terrain';
import { DEFAULT_WAGONS, type Line } from './transport';

/** Monthly upkeep ($). */
export const UPKEEP = {
  roadCell: 1,
  railCell: 2,
  railStation: 50,
  truckStop: 25,
  depot: 300,
  oilDepot: 350,
  refinery: 500,
  /** Each distillation column beyond the first. */
  refineryUnit: 150,
  /** Each truck bay / rail track beyond what a new depot has. */
  oilBay: 40,
  oilTrack: 60,
  pipeCell: 1,
  signal: 8,
  light: 15,
  roundabout: 15,
  sign: 3,
  bridgeCell: 6,
  tunnelCell: 10,
} as const;

/** Monthly running cost of a vehicle ($). */
export const RUNNING = { truck: 250, loco: 900, wagon: 90 } as const;

export interface UpkeepItem {
  label: string;
  count: number;
  /** Unit: 'cella' or 'db'. */
  unit: string;
  cost: number;
}

/** Itemised monthly upkeep of everything built on `map`. */
export function upkeepOf(map: TerrainMap): UpkeepItem[] {
  let road = 0;
  for (let x = 0; x < map.size; x++) for (let z = 0; z < map.size; z++) if (map.cells[x][z] === CellType.Road) road++;
  let rail = 0;
  for (const e of map.railNet?.edges ?? []) rail += new LineWalker(e.pts).total;
  let stations = 0, stops = 0, depots = 0, oil = 0, oilExtra = 0, refineries = 0, refExtra = 0;
  for (const s of map.stations ?? []) {
    if (isDepot(s)) depots++;
    else if (isOilLot(s)) {
      // The lot's extra bays / tracks, and a refinery's extra columns.
      const extra =
        Math.max(0, (s.bays ?? OIL_START_BAYS) - OIL_START_BAYS) * UPKEEP.oilBay +
        Math.max(0, (s.tracks ?? OIL_START_TRACKS) - OIL_START_TRACKS) * UPKEEP.oilTrack;
      if (isRefinery(s)) {
        refineries++;
        refExtra += extra + Math.max(0, (s.units ?? 1) - 1) * UPKEEP.refineryUnit;
      } else {
        oil++;
        oilExtra += extra;
      }
    }
    else if (stopKind(s) === 'truck') stops++;
    else stations++;
  }
  let lights = 0, rounds = 0, signs = 0;
  for (const k of map.controls?.values() ?? []) {
    if (k === 'light') lights++;
    else if (k === 'roundabout') rounds++;
    else signs++;
  }
  const signals = map.signals?.length ?? 0;
  let bridge = 0, tunnel = 0;
  for (const s of map.structures ?? []) {
    const len = Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]) - 1;
    if (s.kind === 'bridge') bridge += len;
    else tunnel += len;
  }
  const items: UpkeepItem[] = [
    { label: 'Út', count: road, unit: 'cella', cost: road * UPKEEP.roadCell },
    { label: 'Sín', count: Math.round(rail), unit: 'cella', cost: rail * UPKEEP.railCell },
    { label: 'Vasútállomás', count: stations, unit: 'db', cost: stations * UPKEEP.railStation },
    { label: 'Kamionrakodó', count: stops, unit: 'db', cost: stops * UPKEEP.truckStop },
    { label: 'Raktár', count: depots, unit: 'db', cost: depots * UPKEEP.depot },
    { label: 'Olajdepó', count: oil, unit: 'db', cost: oil * UPKEEP.oilDepot + oilExtra },
    { label: 'Finomító', count: refineries, unit: 'db', cost: refineries * UPKEEP.refinery + refExtra },
    { label: 'Olajvezeték', count: map.pipes?.length ?? 0, unit: 'cella', cost: (map.pipes?.length ?? 0) * UPKEEP.pipeCell },
    { label: 'Jelző', count: signals, unit: 'db', cost: signals * UPKEEP.signal },
    { label: 'Lámpa / körforgalom', count: lights + rounds, unit: 'db', cost: lights * UPKEEP.light + rounds * UPKEEP.roundabout },
    { label: 'Tábla', count: signs, unit: 'db', cost: signs * UPKEEP.sign },
    { label: 'Híd', count: bridge, unit: 'cella', cost: bridge * UPKEEP.bridgeCell },
    { label: 'Alagút', count: tunnel, unit: 'cella', cost: tunnel * UPKEEP.tunnelCell },
  ];
  return items.filter((i) => i.count > 0).map((i) => ({ ...i, cost: Math.round(i.cost) }));
}

/** Monthly running cost of one line's vehicles. */
export function runningOf(line: Line): number {
  if (line.kind === 'truck') return line.vehicles * RUNNING.truck;
  return line.vehicles * (RUNNING.loco + (line.wagons ?? DEFAULT_WAGONS) * RUNNING.wagon);
}
