/**
 * React bindings for the InteriorStore: one instance shared by the map (which
 * opens an interior on click) and the micro view.
 */

import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { InteriorStore, type InteriorSnapshot } from './InteriorStore';

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

export function useInteriorSnapshot(): InteriorSnapshot {
  const s = useInteriorStore();
  return useSyncExternalStore(
    (l) => s.subscribe(l),
    () => s.getSnapshot(),
  );
}
