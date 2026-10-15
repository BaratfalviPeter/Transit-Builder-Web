/**
 * GameState — player-facing game state: the active build tool and money.
 * Pure TypeScript (no React/Three), observable like the other stores.
 */

import { TOOLS, type ToolId } from './tools';

type Listener = () => void;

export interface GameSnapshot {
  activeTool: ToolId;
  money: number;
}

export class GameState {
  private activeTool: ToolId = 'road'; // Road is selected by default.
  private money: number;
  private readonly listeners = new Set<Listener>();
  private snapshot: GameSnapshot;

  constructor(startingMoney = 1000) {
    this.money = startingMoney;
    this.snapshot = { activeTool: this.activeTool, money: this.money };
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  getActiveTool(): ToolId {
    return this.activeTool;
  }

  getMoney(): number {
    return this.money;
  }

  setActiveTool(tool: ToolId): void {
    if (this.activeTool === tool) return;
    this.activeTool = tool;
    this.publish();
  }

  /** True if the player can afford `cost`. */
  canAfford(cost: number): boolean {
    return this.money >= cost;
  }

  /**
   * Attempt to spend `cost`. Returns true and deducts if affordable, else
   * returns false and leaves money unchanged.
   */
  spend(cost: number): boolean {
    if (cost <= 0) return true;
    if (this.money < cost) return false;
    this.money -= cost;
    this.publish();
    return true;
  }

  /** Add money (e.g. future income). */
  earn(amount: number): void {
    if (amount <= 0) return;
    this.money += amount;
    this.publish();
  }

  /** Cost of the currently active tool. */
  activeToolCost(): number {
    return TOOLS[this.activeTool].cost;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.snapshot = { activeTool: this.activeTool, money: this.money };
    for (const l of this.listeners) l();
  }
}
