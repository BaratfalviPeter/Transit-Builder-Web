/**
 * FinanceDriver — closes the books at the end of every game month: charges
 * the infrastructure upkeep and the vehicles' running costs (economy.ts) and
 * the loan interest into GameState (`closeMonth`); the industries' levels
 * (ProductionSim) and the lines' monthly figures (TransportSim) roll over too.
 */

import { useEffect } from 'react';
import { runningOf, upkeepOf } from './economy';
import { useGame } from './useGameState';
import { useInteriorStore } from './useInterior';
import { useCity } from './useCityDevelopment';
import { useTerrainStore } from './useTerrain';
import { useTransport } from './useTransport';

const monthOf = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

export function FinanceDriver(): null {
  const game = useGame();
  const terrain = useTerrainStore();
  const transport = useTransport();
  const production = useInteriorStore().production;
  const city = useCity();
  useEffect(() => {
    let month = monthOf(game.getSnapshot().dateMs);
    return game.subscribe(() => {
      const m = monthOf(game.getSnapshot().dateMs);
      if (m === month) return;
      // Only the clock running into the next month closes one — a jump
      // (a save loaded, a new game) just starts counting from there.
      const next = m === month + 1;
      month = m;
      if (!next) return;
      const upkeep = upkeepOf(terrain.getMap()).reduce((a, i) => a + i.cost, 0);
      const lineCost: Record<number, number> = {};
      let running = 0;
      for (const l of transport.getSnapshot().lines) {
        const c = runningOf(l, transport.dirtShare(l.id));
        lineCost[l.id] = c;
        running += c;
      }
      game.closeMonth({ upkeep, running, lineCost });
      // Industries grow / shrink by how well they were served; line figures roll over.
      production.closeMonth();
      transport.closeMonth();
      // The statistics window's record of the month just closed.
      const g = game.getSnapshot();
      const c = city.getSnapshot();
      const books = g.lastMonth!;
      const lines: Record<number, { income: number; cost: number; units: number; speed: number | null; held: number | null }> = {};
      for (const l of transport.getSnapshot().lines) {
        const f = transport.lineStats(l.id).last;
        lines[l.id] = {
          income: books.lineIncome[l.id] ?? 0,
          cost: books.lineCost[l.id] ?? 0,
          units: f?.units ?? 0,
          speed: f && f.units > 0 ? f.paidW / f.units : null,
          held: f && f.time > 0 ? f.held / f.time : null,
        };
      }
      game.pushHistory({
        month: m - 1,
        cat: { ...books.cat },
        money: g.money,
        lines,
        population: c.population,
        powerSupply: c.power.supply,
        powerDemand: c.power.demand,
        sat: { goods: c.satisfaction?.goods ?? null, plank: c.satisfaction?.plank ?? null, power: c.powerSat },
      });
    });
  }, [game, terrain, transport, production, city]);
  return null;
}
