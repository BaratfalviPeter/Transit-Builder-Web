/**
 * React bindings for the mutable `TerrainStore`.
 *
 * `TerrainProvider` creates one store (generating the map once) and shares it
 * via context, so both the 3D canvas and the DOM HUD read the same terrain.
 *
 * - `useTerrainStore()` returns the raw store for imperative calls (buildRoad).
 * - `useTerrainMap()` subscribes and returns the current immutable map; it
 *   re-renders consumers only when the map actually changes (e.g. a road is
 *   built).
 * - `useRoadCount()` subscribes to just the road tally for the HUD.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { TerrainStore } from './TerrainStore';
import type { GenerateOptions, TerrainMap } from './terrain';

const TerrainContext = createContext<TerrainStore | null>(null);

export function TerrainProvider({
  children,
  options,
}: {
  children: ReactNode;
  options?: GenerateOptions;
}) {
  // Generate once; `options` is read only on first mount.
  const store = useMemo(() => new TerrainStore(options), []); // eslint-disable-line react-hooks/exhaustive-deps
  return createElement(TerrainContext.Provider, { value: store }, children);
}

export function useTerrainStore(): TerrainStore {
  const store = useContext(TerrainContext);
  if (!store) {
    throw new Error('useTerrainStore must be used within a <TerrainProvider>');
  }
  return store;
}

export function useTerrainMap(): TerrainMap {
  const store = useTerrainStore();
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getMap(),
  );
}

export function useRoadCount(): number {
  const store = useTerrainStore();
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getRoadCount(),
  );
}

export function useIndustryCount(): number {
  const store = useTerrainStore();
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getIndustryCount(),
  );
}
