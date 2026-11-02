/**
 * React bindings for the pure `CityDevelopment` simulation (the city: growing
 * buildings + its demand at the market).
 *
 *   - `CityProvider`: one city shared by the map (buildings, label), the
 *     transport driver (market deliveries) and the UI.
 *   - `CityDriver`: advances it with the GAME clock (whole days — follows the
 *     game speed and pause) and restarts it when a new map is generated.
 *   - `useCity` / `useCitySnapshot`: access + subscribe.
 */

import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { CityDevelopment, type CitySnapshot } from './CityDevelopment';
import { useGame } from './useGameState';
import { useTerrainMap, useTerrainStore } from './useTerrain';

const Ctx = createContext<CityDevelopment | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const terrain = useTerrainStore();
  const city = useMemo(() => new CityDevelopment(terrain.getMap()), [terrain]);
  return createElement(Ctx.Provider, { value: city }, children);
}

export function useCity(): CityDevelopment {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCity must be used within a <CityProvider>');
  return c;
}

export function useCitySnapshot(): CitySnapshot {
  const c = useCity();
  return useSyncExternalStore(
    (l) => c.subscribe(l),
    () => c.getSnapshot(),
  );
}

const DAY_MS = 86_400_000;
/** More days than this at once is a jump (load / new game), not the clock running. */
const MAX_STEP_DAYS = 5;

/** Steps the city day by day with the game clock; a new map restarts it. */
export function CityDriver(): null {
  const city = useCity();
  const game = useGame();
  const map = useTerrainMap();
  useEffect(() => city.reset(map), [city, map]);
  useEffect(() => {
    let last = game.getSnapshot().dateMs;
    return game.subscribe(() => {
      const now = game.getSnapshot().dateMs;
      // The date jumped (a new game, a save loaded): count from there — going
      // back it would stand still until the clock caught up again, going far
      // ahead it would grow years at once.
      const days = Math.round((now - last) / DAY_MS);
      if (now < last || days > MAX_STEP_DAYS) {
        last = now;
        return;
      }
      if (days <= 0) return;
      last = now;
      city.advance(days, now);
    });
  }, [city, game]);
  return null;
}
