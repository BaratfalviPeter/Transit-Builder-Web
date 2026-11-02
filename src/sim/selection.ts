/**
 * selection — the industry picked with the select tool (its anchor), for the
 * industry panel (its stops: in / out, output shares). Tiny observable store.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;
let current: readonly [number, number] | null = null;
const listeners = new Set<Listener>();

export const selection = {
  get: () => current,
  set(a: readonly [number, number] | null): void {
    if (a === current || (a && current && a[0] === current[0] && a[1] === current[1])) return;
    current = a;
    for (const l of listeners) l();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSelection(): readonly [number, number] | null {
  return useSyncExternalStore(selection.subscribe, selection.get);
}
