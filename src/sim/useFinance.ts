/**
 * FinanceDriver — closes the books at the end of every game month: charges
 * the infrastructure upkeep and the vehicles' running costs (economy.ts) and
 * the loan interest into GameState (`closeMonth`).
 */

import { useEffect } from 'react';
import { runningOf, upkeepOf } from './economy';
import { useGame } from './useGameState';
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
  useEffect(() => {
    let month = monthOf(game.getSnapshot().dateMs);
    return game.subscribe(() => {
      const m = monthOf(game.getSnapshot().dateMs);
      if (m === month) return;
      month = m;
      const upkeep = upkeepOf(terrain.getMap()).reduce((a, i) => a + i.cost, 0);
      const lineCost: Record<number, number> = {};
      let running = 0;
      for (const l of transport.getSnapshot().lines) {
        const c = runningOf(l);
        lineCost[l.id] = c;
        running += c;
      }
      game.closeMonth({ upkeep, running, lineCost });
    });
  }, [game, terrain, transport]);
  return null;
}
