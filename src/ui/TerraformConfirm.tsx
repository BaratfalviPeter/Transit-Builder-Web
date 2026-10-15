/**
 * TerraformConfirm — the Build / Cancel panel for batched terraforming.
 *
 * Appears (bottom-center) whenever the player has selected cells with the
 * raise/lower tool. Shows the cell count and total cost, and:
 *   - Cancel (✗): clears the selection (red grid disappears).
 *   - Build  (✓): charges the cost, flips the selection to the yellow
 *     "under construction" grid, waits a SHORT REAL-TIME delay (wall-clock, not
 *     in-game time — deliberately quick so it feels instant), then applies the
 *     whole batch to the terrain in one commit and clears the plan.
 */

import { useEffect, useRef } from 'react';
import {
  TOOLS,
  useGame,
  useTerraformPlan,
  useTerraformSnapshot,
  useTerrainStore,
} from '../sim';
import './terraformConfirm.css';

/** Real-time build delay in ms (short — feels instant, but visible). */
const BUILD_MS = 450;
/** Cost per terraformed cell (matches the raise/lower tool cost). */
const COST_PER_CELL = TOOLS.raise.cost;

export function TerraformConfirm() {
  const plan = useTerraformPlan();
  const terrain = useTerrainStore();
  const game = useGame();
  const snap = useTerraformSnapshot();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up a pending timer if the component unmounts mid-build.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (snap.phase === 'idle' || snap.cells.length === 0) return null;

  const count = snap.cells.length;
  const cost = count * COST_PER_CELL;
  const building = snap.phase === 'building';
  const affordable = game.canAfford(cost);

  const onCancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    plan.clear();
  };

  const onBuild = () => {
    if (building) return;
    if (!affordable) return;
    // Charge up-front, flip to the yellow "under construction" grid.
    game.spend(cost);
    const edits = plan.startBuilding().map(({ x, z }) => ({
      x,
      z,
      delta: snap.dir === 'raise' ? terrain.terraformStep() : -terrain.terraformStep(),
    }));
    // Apply the whole batch after a short real-time delay (not in-game time).
    timerRef.current = setTimeout(() => {
      terrain.terraformBatch(edits);
      plan.clear();
      timerRef.current = null;
    }, BUILD_MS);
  };

  const label = snap.dir === 'raise' ? 'Emelés' : 'Süllyesztés';

  return (
    <div className="tfc">
      <div className="tfc__info">
        <span className="tfc__title">
          {label}: {count} cella
        </span>
        <span className={`tfc__cost${affordable ? '' : ' tfc__cost--no'}`}>
          ${cost}
        </span>
      </div>
      {building ? (
        <div className="tfc__building">Építés folyamatban…</div>
      ) : (
        <div className="tfc__actions">
          <button
            type="button"
            className="tfc__btn tfc__btn--cancel"
            onClick={onCancel}
          >
            ✗ Mégsem
          </button>
          <button
            type="button"
            className="tfc__btn tfc__btn--build"
            onClick={onBuild}
            disabled={!affordable}
          >
            ✓ Építés
          </button>
        </div>
      )}
    </div>
  );
}
