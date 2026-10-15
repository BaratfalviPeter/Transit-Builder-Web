/**
 * React bindings for the pure `CityDevelopment` simulation.
 *
 * `useCityDevelopment(map, tickMs)`:
 *   - Creates one CityDevelopment bound to the given terrain map.
 *   - Runs the game loop with setInterval at `tickMs`, calling `tick()` each
 *     time (spawn a level-1 building or level up an existing one).
 *   - Returns the current buildings snapshot (via useSyncExternalStore), so
 *     only discrete growth events re-render consumers.
 *
 * The timer is the one place React drives time here; all growth rules stay in
 * the pure sim. Per-frame animation (if we later animate growth) would move to
 * useFrame, not through this snapshot.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CityDevelopment, type Building } from './CityDevelopment';
import type { TerrainMap } from './terrain';

export function useCityDevelopment(
  map: TerrainMap,
  tickMs = 2500,
): { buildings: Building[]; sim: CityDevelopment } {
  // One sim per map instance.
  const sim = useMemo(() => new CityDevelopment(map), [map]);

  useEffect(() => {
    const id = setInterval(() => sim.tick(), tickMs);
    return () => clearInterval(id);
  }, [sim, tickMs]);

  const buildings = useSyncExternalStore(
    (onChange) => sim.subscribe(onChange),
    () => sim.getBuildings(),
  );

  return { buildings, sim };
}
