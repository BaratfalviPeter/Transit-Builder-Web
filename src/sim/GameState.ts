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

/**
 * Money categories of the books. `income`: deliveries; the rest are costs:
 * building (incl. terraforming), vehicles bought, monthly upkeep of the
 * infrastructure, vehicles' running costs, loan interest.
 */
export type FinCat = 'income' | 'build' | 'vehicles' | 'upkeep' | 'running' | 'interest';

/** One month's books: total per category (costs positive) + per line. */
export interface MonthBooks {
  cat: Record<FinCat, number>;
  /** Per line id: delivery income / running cost. */
  lineIncome: Record<number, number>;
  lineCost: Record<number, number>;
}

const emptyBooks = (): MonthBooks => ({
  cat: { income: 0, build: 0, vehicles: 0, upkeep: 0, running: 0, interest: 0 },
  lineIncome: {},
  lineCost: {},
});

/** The saved part of the game state. */
export interface GameSave {
  money: number;
  totalIncome: number;
  totalSpent: number;
  dateMs: number;
  month: MonthBooks;
  lastMonth: MonthBooks | null;
  loan: number;
  negMonths?: number;
  history?: MonthRecord[];
  /** Date (ms) the goal population was first reached, if it was. */
  goalAt?: number | null;
}

/** One closed month for the statistics window (kept HISTORY_MONTHS back). */
export interface MonthRecord {
  /** Calendar month index (year × 12 + month) of the closed month. */
  month: number;
  cat: Record<FinCat, number>;
  /** Balance after the month was closed. */
  money: number;
  /** Per line id. */
  lines: Record<number, { income: number; cost: number; units: number; speed: number | null; held: number | null }>;
  population: number;
  powerSupply: number;
  powerDemand: number;
  /** Supply shares (0…1) of the city, smoothed (null before known). */
  sat: { goods: number | null; plank: number | null; power: number | null };
}
export const HISTORY_MONTHS = 24;

/** Months in a row ending below zero after which the company goes bankrupt. */
export const BANKRUPT_MONTHS = 6;

/** Loan: borrowed / paid back in LOAN_STEP steps, up to MAX_LOAN, LOAN_RATE a year. */
export const LOAN_STEP = 10_000;
export const MAX_LOAN = 200_000;
export const LOAN_RATE = 0.06;

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
  /** Books of the running month and of the last closed one (null before the first). */
  month: MonthBooks;
  lastMonth: MonthBooks | null;
  loan: number;
  /** Months in a row that ended below zero (BANKRUPT_MONTHS: bankrupt). */
  negMonths: number;
  /** Bankrupt: the game is over (stopped; only a new game / load goes on). */
  bankrupt: boolean;
  /** Closed months, oldest first (≤ HISTORY_MONTHS). */
  history: readonly MonthRecord[];
  /** Date (ms) the goal population was reached, or null. */
  goalAt: number | null;
}

/** Game starts on 1 January 1970. */
const START_DATE_MS = Date.UTC(1970, 0, 1);
/** Real seconds per in-game day at normal (1×) speed. */
const SECONDS_PER_DAY = 1;
/** Longest real time one clock tick may advance (s). */
const MAX_FRAME_S = 0.25;

export class GameState {
  private activeTool: ToolId = 'select';
  private money: number;
  private totalIncome = 0;
  private totalSpent = 0;
  private month = emptyBooks();
  private lastMonth: MonthBooks | null = null;
  private loan = 0;
  private negMonths = 0;
  private history: MonthRecord[] = [];
  private goalAt: number | null = null;

  // Clock
  private dateMs = START_DATE_MS;
  private speed: GameSpeed = 1;
  private dayAccumulator = 0; // real seconds accumulated toward the next day

  private readonly listeners = new Set<Listener>();
  private snapshot: GameSnapshot;

  /** Money a new game starts with. */
  readonly startingMoney: number;

  constructor(startingMoney = 1000) {
    this.startingMoney = startingMoney;
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
  spend(cost: number, cat: Exclude<FinCat, 'income'> = 'build'): boolean {
    if (cost <= 0) return true;
    if (this.money < cost) return false;
    this.money -= cost;
    this.totalSpent += cost;
    this.month.cat[cat] += cost;
    this.publish();
    return true;
  }

  /** Give back part of a purchase (e.g. a demolished machine): lowers the spending total. */
  refund(amount: number, cat: Exclude<FinCat, 'income'> = 'build'): void {
    if (amount <= 0) return;
    this.money += amount;
    this.totalSpent = Math.max(0, this.totalSpent - amount);
    this.month.cat[cat] -= amount;
    this.publish();
  }

  /** Add money (e.g. income), booked to `lineId` when it is a line's delivery. */
  earn(amount: number, lineId?: number): void {
    if (amount <= 0) return;
    this.money += amount;
    this.totalIncome += amount;
    this.month.cat.income += amount;
    if (lineId !== undefined) this.month.lineIncome[lineId] = (this.month.lineIncome[lineId] ?? 0) + amount;
    this.publish();
  }

  /**
   * Month over: charge its running costs (these may take the balance below
   * zero — then nothing can be bought until it's back), the loan interest,
   * and start new books.
   */
  closeMonth(costs: { upkeep: number; running: number; lineCost: Record<number, number> }): void {
    const interest = Math.round((this.loan * LOAN_RATE) / 12);
    const charge = (n: number, cat: FinCat) => {
      this.money -= n;
      this.totalSpent += n;
      this.month.cat[cat] += n;
    };
    charge(costs.upkeep, 'upkeep');
    charge(costs.running, 'running');
    charge(interest, 'interest');
    for (const [id, c] of Object.entries(costs.lineCost)) this.month.lineCost[Number(id)] = (this.month.lineCost[Number(id)] ?? 0) + c;
    // Below zero at the month's end: one step closer to bankruptcy (it stops the clock).
    this.negMonths = this.money < 0 ? this.negMonths + 1 : 0;
    if (this.isBankrupt()) this.speed = 0;
    this.lastMonth = this.month;
    this.month = emptyBooks();
    this.publish();
  }

  /** What a save keeps (see save.ts). */
  exportState(): GameSave {
    return {
      money: this.money,
      totalIncome: this.totalIncome,
      totalSpent: this.totalSpent,
      dateMs: this.dateMs,
      month: this.month,
      lastMonth: this.lastMonth,
      loan: this.loan,
      negMonths: this.negMonths,
      history: this.history,
      goalAt: this.goalAt,
    };
  }

  /** Add a closed month to the statistics (FinanceDriver, right after `closeMonth`). */
  pushHistory(r: MonthRecord): void {
    this.history = [...this.history, r].slice(-HISTORY_MONTHS);
    this.publish();
  }

  /** The goal was reached now (once). */
  reachGoal(): void {
    if (this.goalAt !== null) return;
    this.goalAt = this.dateMs;
    this.publish();
  }

  isBankrupt(): boolean {
    return this.negMonths >= BANKRUPT_MONTHS;
  }

  /** Continue a saved game, or (null) start a new one. */
  importState(s: GameSave | null): void {
    this.money = s ? s.money : this.startingMoney;
    this.totalIncome = s?.totalIncome ?? 0;
    this.totalSpent = s?.totalSpent ?? 0;
    this.dateMs = s?.dateMs ?? START_DATE_MS;
    this.dayAccumulator = 0;
    this.month = s ? { cat: { ...emptyBooks().cat, ...s.month.cat }, lineIncome: { ...s.month.lineIncome }, lineCost: { ...s.month.lineCost } } : emptyBooks();
    this.lastMonth = s?.lastMonth ?? null;
    this.loan = s?.loan ?? 0;
    this.negMonths = s?.negMonths ?? 0;
    this.history = s?.history ? [...s.history] : [];
    this.goalAt = s?.goalAt ?? null;
    if (this.isBankrupt()) this.speed = 0;
    else if (this.speed === 0 && !s) this.speed = 1;
    this.publish();
  }

  /** Take LOAN_STEP more loan (up to MAX_LOAN). */
  borrow(): boolean {
    if (this.loan + LOAN_STEP > MAX_LOAN) return false;
    this.loan += LOAN_STEP;
    this.money += LOAN_STEP;
    this.publish();
    return true;
  }

  /** Pay back LOAN_STEP of the loan (if there is that much money). */
  repay(): boolean {
    const n = Math.min(LOAN_STEP, this.loan);
    if (n <= 0 || this.money < n) return false;
    this.loan -= n;
    this.money -= n;
    this.publish();
    return true;
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
    if (this.speed === speed || (speed > 0 && this.isBankrupt())) return;
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
    // At most MAX_FRAME_S per call: the first frame after loading, or after
    // the tab was in the background, must not jump days (and month costs).
    this.dayAccumulator += (Math.min(deltaSeconds, MAX_FRAME_S) * this.speed) / SECONDS_PER_DAY;
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
      // Copies: the books keep changing in place.
      month: { cat: { ...this.month.cat }, lineIncome: { ...this.month.lineIncome }, lineCost: { ...this.month.lineCost } },
      lastMonth: this.lastMonth,
      loan: this.loan,
      negMonths: this.negMonths,
      bankrupt: this.isBankrupt(),
      history: this.history,
      goalAt: this.goalAt,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }
}
