/**
 * Thin React bindings for the pure `World` simulation.
 *
 * `WorldProvider` creates a single long-lived World instance and shares it via
 * context. `useWorld()` returns the raw instance for imperative calls (place,
 * remove) — these do NOT cause React re-renders on their own.
 *
 * `useWorldSnapshot()` subscribes to World changes and re-renders only when
 * the discrete set of placements changes (e.g. a building is placed/removed).
 * High-frequency, per-frame state (vehicles) will deliberately NOT flow
 * through React — it will be driven directly in the Three.js render loop.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { World } from './World';
import type { Placement } from './types';

const WorldContext = createContext<World | null>(null);

export function WorldProvider({ children }: { children: ReactNode }) {
  const world = useMemo(() => new World(), []);
  return createElement(WorldContext.Provider, { value: world }, children);
}

export function useWorld(): World {
  const world = useContext(WorldContext);
  if (!world) {
    throw new Error('useWorld must be used within a <WorldProvider>');
  }
  return world;
}

/**
 * Subscribe to the current list of placements. Re-renders the calling
 * component whenever placements are added or removed.
 */
export function useWorldSnapshot(): Placement[] {
  const world = useWorld();
  return useSyncExternalStore(
    (onChange) => world.subscribe(onChange),
    () => world.getPlacements(),
  );
}
