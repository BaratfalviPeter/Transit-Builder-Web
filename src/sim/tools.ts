/**
 * Build tools and their definitions. Pure data — no React, no Three.
 *
 * The side panel UI, the click handler, and the economy all read from this
 * single source of truth so costs/labels stay consistent.
 *
 * Tools are grouped into panel tabs: Terraforming (raise/lower/bulldoze),
 * Infrastructure (road/rail/station). "Select" is the neutral default.
 */

import { CellType } from './terrain';

export type ToolId =
  | 'select'
  | 'raise'
  | 'lower'
  | 'bulldoze'
  | 'road'
  | 'rail'
  | 'station';

export interface ToolDef {
  id: ToolId;
  /** Short display label (without price). */
  label: string;
  /** Cost in money per cell; 0 for free tools (select). */
  cost: number;
  /**
   * The cell type this tool paints onto a buildable cell, or null for tools
   * that don't paint a build type (select, bulldoze, raise, lower).
   */
  builds: CellType | null;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  // Neutral tool; a click on an industry opens its interior (micro view).
  select: { id: 'select', label: 'Kijelölés / belépés', cost: 0, builds: null },
  // Terraforming
  raise: { id: 'raise', label: 'Emelés', cost: 50, builds: null },
  lower: { id: 'lower', label: 'Süllyesztés', cost: 50, builds: null },
  bulldoze: { id: 'bulldoze', label: 'Bontás', cost: 0, builds: null },
  // Infrastructure
  road: { id: 'road', label: 'Út', cost: 10, builds: CellType.Road },
  rail: { id: 'rail', label: 'Sín', cost: 20, builds: CellType.Rail },
  // Rail station on an industry's side (flat price per station).
  station: { id: 'station', label: 'Vasútállomás', cost: 500, builds: null },
};

/** Terraforming tab tools. */
export const TERRAFORM_TOOLS: ToolId[] = ['select', 'raise', 'lower', 'bulldoze'];
/** Infrastructure tab tools. */
export const TRANSPORT_TOOLS: ToolId[] = ['select', 'road', 'rail', 'station'];
