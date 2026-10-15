/**
 * React bindings for the pending `TerraformPlan`.
 *
 * `TerraformPlanProvider` creates one plan instance and shares it so the canvas
 * (selection painting + grids), the confirm panel, and the apply logic all use
 * the same state.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { TerraformPlan, type TerraformSnapshot } from './TerraformPlan';

const Ctx = createContext<TerraformPlan | null>(null);

export function TerraformPlanProvider({ children }: { children: ReactNode }) {
  const plan = useMemo(() => new TerraformPlan(), []);
  return createElement(Ctx.Provider, { value: plan }, children);
}

export function useTerraformPlan(): TerraformPlan {
  const plan = useContext(Ctx);
  if (!plan) {
    throw new Error(
      'useTerraformPlan must be used within a <TerraformPlanProvider>',
    );
  }
  return plan;
}

export function useTerraformSnapshot(): TerraformSnapshot {
  const plan = useTerraformPlan();
  return useSyncExternalStore(
    (onChange) => plan.subscribe(onChange),
    () => plan.getSnapshot(),
  );
}
