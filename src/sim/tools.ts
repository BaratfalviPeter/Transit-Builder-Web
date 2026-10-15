/**
 * Build tools and their definitions. Pure data — no React, no Three.
 *
 * The toolbar UI, the click handler, and the economy all read from this single
 * source of truth so costs/labels stay consistent.
 */

import { CellType } from './terrain';

export type ToolId = 'select' | 'road' | 'lumberjack' | 'mine' | 'bulldoze';

export interface ToolDef {
  id: ToolId;
  /** Short display label (without price). */
  label: string;
  /** Cost in money; 0 for free tools (select/bulldoze). */
  cost: number;
  /**
   * The cell type this tool paints onto a buildable cell, or null for tools
   * that don't paint a build type (select, bulldoze).
   */
  builds: CellType | null;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  select: { id: 'select', label: 'Kijelölés', cost: 0, builds: null },
  road: { id: 'road', label: 'Út', cost: 10, builds: CellType.Road },
  lumberjack: {
    id: 'lumberjack',
    label: 'Favágó',
    cost: 150,
    builds: CellType.Lumberjack,
  },
  mine: { id: 'mine', label: 'Bánya', cost: 200, builds: CellType.MineBuilding },
  bulldoze: { id: 'bulldoze', label: 'Törlés', cost: 0, builds: null },
};

/** Toolbar display order. */
export const TOOL_ORDER: ToolId[] = [
  'select',
  'road',
  'lumberjack',
  'mine',
  'bulldoze',
];
