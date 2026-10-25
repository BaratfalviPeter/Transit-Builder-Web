/**
 * React bindings for the TransportSim (lines + trucks): one instance shared by
 * the side panel (lines list), the map (network view, trucks) and the driver
 * that advances it with the game clock.
 */

import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { TransportSim, type TransportSnapshot } from './transport';
import { useGame } from './useGameState';
import { useTerrainStore } from './useTerrain';
import { useInteriorStore } from './useInterior';

const Ctx = createContext<TransportSim | null>(null);

export function TransportProvider({ children }: { children: ReactNode }) {
  const sim = useMemo(() => new TransportSim(), []);
  return createElement(Ctx.Provider, { value: sim }, children);
}

export function useTransport(): TransportSim {
  const s = useContext(Ctx);
  if (!s) throw new Error('useTransport must be used within a <TransportProvider>');
  return s;
}

export function useTransportSnapshot(): TransportSnapshot {
  const s = useTransport();
  return useSyncExternalStore(
    (l) => s.subscribe(l),
    () => s.getSnapshot(),
  );
}

/** Real milliseconds between transport ticks. */
const TICK_MS = 50;

/** Advances the trucks with the game clock; deliveries pay into GameState. */
export function TransportDriver(): null {
  const sim = useTransport();
  const game = useGame();
  const terrain = useTerrainStore();
  const interiors = useInteriorStore();
  useEffect(() => {
    const id = setInterval(() => {
      const dt = (TICK_MS / 1000) * game.getSpeed();
      sim.tick(dt, terrain.getMap(), interiors.production, (amount) => game.earn(amount));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [sim, game, terrain, interiors]);
  return null;
}
