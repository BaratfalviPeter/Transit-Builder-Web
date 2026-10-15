/**
 * Toolbar — the bottom-center build menu (classic RTS style).
 *
 * Reads the active tool from GameState and lets the player switch tools. Each
 * button shows an icon, a label, and (where relevant) a price. The active tool
 * is highlighted; tools the player can't currently afford are dimmed.
 */

import { TOOLS, TOOL_ORDER, useGame, useGameSnapshot, type ToolId } from '../sim';
import './toolbar.css';

const ICON: Record<ToolId, string> = {
  select: '🖱️',
  road: '🛣️',
  bulldoze: '🚜',
};

export function Toolbar() {
  const game = useGame();
  const { activeTool, money } = useGameSnapshot();

  return (
    <div className="toolbar">
      {TOOL_ORDER.map((id) => {
        const tool = TOOLS[id];
        const active = id === activeTool;
        const unaffordable = tool.cost > 0 && money < tool.cost;
        return (
          <button
            key={id}
            type="button"
            className={
              'toolbar__btn' +
              (active ? ' toolbar__btn--active' : '') +
              (unaffordable ? ' toolbar__btn--disabled' : '')
            }
            onClick={() => game.setActiveTool(id)}
            title={tool.cost > 0 ? `${tool.label} ($${tool.cost})` : tool.label}
          >
            <span className="toolbar__icon" aria-hidden>
              {ICON[id]}
            </span>
            <span className="toolbar__label">
              {tool.label}
              {tool.cost > 0 ? ` ($${tool.cost})` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
