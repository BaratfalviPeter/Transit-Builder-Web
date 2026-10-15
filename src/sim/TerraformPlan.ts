/**
 * TerraformPlan — the pending (not-yet-applied) terraforming selection.
 *
 * Pure TypeScript, observable. Terraforming is now a two-step, batched flow:
 *   1. SELECTING  — the player paints cells with the raise/lower tool; they are
 *      collected here and shown as a RED selection grid (nothing changes yet).
 *   2. BUILDING   — the player confirms; the cells show a YELLOW "under
 *      construction" grid for a short REAL-TIME delay, then the whole batch is
 *      applied to the terrain in ONE commit. (The delay is wall-clock, not tied
 *      to the in-game clock, and is deliberately short so it feels instant.)
 *
 * This store only tracks the plan; the actual terrain mutation and the timer
 * live in the React layer (useTerraformPlan + the canvas), which calls back
 * into the TerrainStore's batch API.
 */

export type TerraformDir = 'raise' | 'lower';
export type TerraformPhase = 'idle' | 'selecting' | 'building';

export interface PlanCell {
  x: number;
  z: number;
}

export interface TerraformSnapshot {
  phase: TerraformPhase;
  dir: TerraformDir;
  /** Selected (or under-construction) cells. */
  cells: PlanCell[];
}

type Listener = () => void;

export class TerraformPlan {
  private phase: TerraformPhase = 'idle';
  private dir: TerraformDir = 'raise';
  private readonly set = new Map<string, PlanCell>();
  private readonly listeners = new Set<Listener>();
  private snapshot: TerraformSnapshot = { phase: 'idle', dir: 'raise', cells: [] };

  getSnapshot(): TerraformSnapshot {
    return this.snapshot;
  }

  getPhase(): TerraformPhase {
    return this.phase;
  }

  getDir(): TerraformDir {
    return this.dir;
  }

  get count(): number {
    return this.set.size;
  }

  /**
   * Add a cell to the selection with the given direction. If the direction
   * changed (switched raise<->lower) or we were idle/building, start a fresh
   * selection so a plan is always single-direction.
   */
  addCell(x: number, z: number, dir: TerraformDir): void {
    if (this.phase === 'building') return; // locked while constructing
    if (this.phase === 'idle' || this.dir !== dir) {
      this.set.clear();
      this.dir = dir;
      this.phase = 'selecting';
    }
    const key = `${x},${z}`;
    if (!this.set.has(key)) {
      this.set.set(key, { x, z });
      this.publish();
    }
  }

  /** Clear the plan back to idle (Cancel). */
  clear(): void {
    if (this.phase === 'idle' && this.set.size === 0) return;
    this.set.clear();
    this.phase = 'idle';
    this.publish();
  }

  /**
   * Move from SELECTING to BUILDING (after the player confirms). The cells stay
   * the same but render as "under construction". Returns the edits to apply
   * (the caller applies them to the terrain after the build delay).
   */
  startBuilding(): PlanCell[] {
    if (this.phase !== 'selecting' || this.set.size === 0) return [];
    this.phase = 'building';
    this.publish();
    return Array.from(this.set.values());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.snapshot = {
      phase: this.phase,
      dir: this.dir,
      cells: Array.from(this.set.values()),
    };
    for (const l of this.listeners) l();
  }
}
