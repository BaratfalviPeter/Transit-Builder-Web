/**
 * GameState — player-facing game state: active build tool, money, simple
 * economy stats, and the in-game clock (date + speed).
 *
 * Pure TypeScript (no React/Three), observable like the other stores. The
 * clock is advanced imperatively from a useFrame loop (see GameClock); only
 * whole-day changes publish a new snapshot, so per-frame work never triggers
 * React re-renders.
 */

import { TOOLS, type ToolId } from './tools';

type Listener = () => void;

/** Clock speed. 0 = paused, 1 = normal, >1 = fast-forward. */
export type GameSpeed = 0 | 1 | 3;

export interface GameSnapshot {
  activeTool: ToolId;
  money: number;
  /** Total income earned so far. */
  totalIncome: number;
  /** Total money spent so far. */
  totalSpent: number;
  /** Current in-game date as epoch-ms (serializable, build a Date from it). */
  dateMs: number;
  speed: GameSpeed;
}

/** Game starts on 1 January 1970. */
const START_DATE_MS = Date.UTC(1970, 0, 1);
/** Real seconds per in-game day at normal (1×) speed. */
const SECONDS_PER_DAY = 1;

export class GameState {
  private activeTool: ToolId = 'select';
  private money: number;
  private totalIncome = 0;
  private totalSpent = 0;

  // Clock
  private dateMs = START_DATE_MS;
  private speed: GameSpeed = 1;
  private dayAccumulator = 0; // real seconds accumulated toward the next day

  private readonly listeners = new Set<Listener>();
  private snapshot: GameSnapshot;

  constructor(startingMoney = 1000) {
    this.money = startingMoney;
    this.snapshot = this.buildSnapshot();
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
    this.totalSpent += cost;
    this.publish();
    return true;
  }

  /** Give back part of a purchase (e.g. a demolished machine): lowers the spending total. */
  refund(amount: number): void {
    if (amount <= 0) return;
    this.money += amount;
    this.totalSpent = Math.max(0, this.totalSpent - amount);
    this.publish();
  }

  /** Add money (e.g. income). */
  earn(amount: number): void {
    if (amount <= 0) return;
    this.money += amount;
    this.totalIncome += amount;
    this.publish();
  }

  /** Cost of the currently active tool. */
  activeToolCost(): number {
    return TOOLS[this.activeTool].cost;
  }

  // --- Clock ---------------------------------------------------------------

  getSpeed(): GameSpeed {
    return this.speed;
  }

  setSpeed(speed: GameSpeed): void {
    if (this.speed === speed) return;
    this.speed = speed;
    this.publish();
  }

  /**
   * Advance the clock by `deltaSeconds` of real time, scaled by the current
   * speed. Accumulates fractional days and only publishes when one or more
   * whole in-game days have elapsed (so per-frame calls are cheap).
   */
  tickClock(deltaSeconds: number): void {
    if (this.speed === 0) return;
    this.dayAccumulator += (deltaSeconds * this.speed) / SECONDS_PER_DAY;
    if (this.dayAccumulator < 1) return;
    const wholeDays = Math.floor(this.dayAccumulator);
    this.dayAccumulator -= wholeDays;
    this.dateMs += wholeDays * 86_400_000; // ms per day
    this.publish();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private buildSnapshot(): GameSnapshot {
    return {
      activeTool: this.activeTool,
      money: this.money,
      totalIncome: this.totalIncome,
      totalSpent: this.totalSpent,
      dateMs: this.dateMs,
      speed: this.speed,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }
}
