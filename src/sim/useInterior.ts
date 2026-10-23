/**
 * React bindings for the InteriorStore: one instance shared by the map (which
 * opens an interior on click) and the micro view.
 */

import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { InteriorStore, type InteriorSnapshot } from './InteriorStore';
import { useGame } from './useGameState';
import { useTerrainStore } from './useTerrain';

const Ctx = createContext<InteriorStore | null>(null);

export function InteriorProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new InteriorStore(), []);
  return createElement(Ctx.Provider, { value: store }, children);
}

export function useInteriorStore(): InteriorStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useInteriorStore must be used within an <InteriorProvider>');
  return s;
}

/**
 * Production version: bumps about twice a second while anything runs — for
 * UI that shows stock counts (station labels, gates).
 */
export function useProductionVersion(): number {
  const s = useInteriorStore();
  return useSyncExternalStore(
    (l) => s.production.subscribe(l),
    () => s.production.getVersion(),
  );
}

/** Real milliseconds between production ticks. */
const TICK_MS = 100;

/** Drives the production of all interiors, scaled by the game speed. */
export function ProductionDriver(): null {
  const store = useInteriorStore();
  const game = useGame();
  const terrain = useTerrainStore();
  useEffect(() => {
    const id = setInterval(() => {
      const dt = (TICK_MS / 1000) * game.getSpeed();
      store.production.tick(dt, store.all(), terrain.getMap());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [store, game, terrain]);
  return null;
}

export function useInteriorSnapshot(): InteriorSnapshot {
  const s = useInteriorStore();
  return useSyncExternalStore(
    (l) => s.subscribe(l),
    () => s.getSnapshot(),
  );
}
