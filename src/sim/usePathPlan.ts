/**
 * React bindings for the two-click road/rail `PathPlan`, shared by the canvas
 * (input + hologram) and the DOM overlay (cost / hint).
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PathPlan, type PathPlanSnapshot } from './PathPlan';

const Ctx = createContext<PathPlan | null>(null);

export function PathPlanProvider({ children }: { children: ReactNode }) {
  const plan = useMemo(() => new PathPlan(), []);
  return createElement(Ctx.Provider, { value: plan }, children);
}

export function usePathPlan(): PathPlan {
  const plan = useContext(Ctx);
  if (!plan) throw new Error('usePathPlan must be used within a <PathPlanProvider>');
  return plan;
}

export function usePathPlanSnapshot(): PathPlanSnapshot {
  const plan = usePathPlan();
  return useSyncExternalStore(
    (onChange) => plan.subscribe(onChange),
    () => plan.getSnapshot(),
  );
}
