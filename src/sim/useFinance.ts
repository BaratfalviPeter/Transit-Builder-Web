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
        const c = runningOf(l);
        lineCost[l.id] = c;
        running += c;
      }
      game.closeMonth({ upkeep, running, lineCost });
      // Industries grow / shrink by how well they were served; line figures roll over.
      production.closeMonth();
      transport.closeMonth();
    });
  }, [game, terrain, transport, production]);
  return null;
}
