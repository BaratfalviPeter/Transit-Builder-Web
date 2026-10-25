/**
 * SidePanel — the main UI: a fixed side panel with a date/time bar and four
 * tabs (Terraforming / Infrastructure / Economy / Dev). Replaces the old bottom
 * toolbar.
 *
 * Reads the active tool, money, economy stats and the clock from GameState; all
 * mutations go back through GameState so the canvas stays in sync.
 */

import { useState } from 'react';
import {
  TERRAFORM_TOOLS,
  TRANSPORT_TOOLS,
  TOOLS,
  useGame,
  useGameSnapshot,
  type GameSpeed,
  type ToolId,
} from '../sim';
import { DevTab } from './DevTab';
import './sidePanel.css';

type Tab = 'terraform' | 'transport' | 'economy' | 'dev';

const ICON: Record<ToolId, string> = {
  select: '🖱️',
  raise: '⛰️',
  lower: '🕳️',
  bulldoze: '🚜',
  road: '🛣️',
  rail: '🚆',
  station: '🚉',
  truckstop: '🚚',
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'terraform', label: 'Földmunka' },
  { id: 'transport', label: 'Infrastruktúra' },
  { id: 'economy', label: 'Pénzügyek' },
  { id: 'dev', label: 'Dev' },
];

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}. ${m}. ${day}.`;
}

export function SidePanel() {
  const game = useGame();
  const snap = useGameSnapshot();
  const [tab, setTab] = useState<Tab>('transport');

  const speedButtons: Array<{ speed: GameSpeed; glyph: string; title: string }> = [
    { speed: 0, glyph: '⏸', title: 'Szünet' },
    { speed: 1, glyph: '▶', title: 'Normál' },
    { speed: 3, glyph: '⏩', title: 'Gyorsított' },
  ];

  return (
    <div className={'panel' + (tab === 'dev' ? ' panel--wide' : '')}>
      {/* Clock + speed controls */}
      <div className="panel__clock">
        <span className="panel__date">{formatDate(snap.dateMs)}</span>
        <div className="panel__speed">
          {speedButtons.map(({ speed, glyph, title }) => (
            <button
              key={speed}
              type="button"
              title={title}
              className={snap.speed === speed ? 'is-active' : ''}
              onClick={() => game.setSpeed(speed)}
            >
              {glyph}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="panel__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`panel__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="panel__body">
        {tab === 'terraform' && (
          <ToolList
            ids={TERRAFORM_TOOLS}
            activeTool={snap.activeTool}
            money={snap.money}
            onPick={(id) => game.setActiveTool(id)}
          />
        )}

        {tab === 'transport' && (
          <ToolList
            ids={TRANSPORT_TOOLS}
            activeTool={snap.activeTool}
            money={snap.money}
            onPick={(id) => game.setActiveTool(id)}
          />
        )}

        {tab === 'dev' && <DevTab onEditorOn={() => game.setActiveTool('select')} />}

        {tab === 'economy' && (
          <>
            <div className="panel__stat panel__stat--big">
              <span className="panel__stat-label">Egyenleg</span>
              <span className="panel__stat-value">${snap.money}</span>
            </div>
            <div className="panel__stat">
              <span className="panel__stat-label">Összes bevétel</span>
              <span className="panel__stat-value">+${snap.totalIncome}</span>
            </div>
            <div className="panel__stat">
              <span className="panel__stat-label">Összes kiadás</span>
              <span className="panel__stat-value">-${snap.totalSpent}</span>
            </div>
            <div className="panel__hint">
              A bevétel későbbi funkció (szállítás). Jelenleg az építés és a
              tereprendezés von le pénzt.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ToolList({
  ids,
  activeTool,
  money,
  onPick,
}: {
  ids: ToolId[];
  activeTool: ToolId;
  money: number;
  onPick: (id: ToolId) => void;
}) {
  return (
    <>
      {ids.map((id) => {
        const tool = TOOLS[id];
        const active = id === activeTool;
        const unaffordable = tool.cost > 0 && money < tool.cost;
        return (
          <button
            key={id}
            type="button"
            className={
              'panel__tool' +
              (active ? ' is-active' : '') +
              (unaffordable ? ' is-disabled' : '')
            }
            onClick={() => onPick(id)}
          >
            <span className="panel__tool-icon" aria-hidden>
              {ICON[id]}
            </span>
            <span className="panel__tool-label">{tool.label}</span>
            {tool.cost > 0 && (
              <span className="panel__tool-cost">${tool.cost}</span>
            )}
          </button>
        );
      })}
    </>
  );
}
