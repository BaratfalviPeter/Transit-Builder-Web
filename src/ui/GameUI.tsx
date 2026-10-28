/**
 * GameUI — the game's overlay UI (replaces the old side panel + HUD):
 *
 *   - top-left bar:   money, date, game speed, counters;
 *   - top-right:      buttons for the side panels (Járatok, Pénzügyek, Dev)
 *                     and the help;
 *   - bottom dock:    the build tools in groups (Terep / Építés / Forgalom),
 *                     each with its price and keyboard shortcut, and a hint
 *                     line for the active tool above it;
 *   - side panel:     Járatok (opens the network view), Pénzügyek, Dev;
 *   - help:           all keyboard shortcuts (H / ?).
 *
 * Keyboard shortcuts live here too (see KEYS / PANEL_KEYS). They are ignored
 * while typing in a field and while the dev model editor is on.
 */

import { useEffect, useRef, useState } from 'react';
import {
  TOOLS,
  useGame,
  useGameSnapshot,
  useIndustryCount,
  useRoadCount,
  useTransport,
  type GameSpeed,
  type ToolId,
} from '../sim';
import { getDev } from '../dev/modelEditorStore';
import { DevTab } from './DevTab';
import { LinesPanel } from './LinesPanel';
import './gameUI.css';

type Panel = 'lines' | 'economy' | 'dev';

const ICON: Record<ToolId, string> = {
  select: '🖱️',
  raise: '⛰️',
  lower: '🕳️',
  bulldoze: '🚜',
  road: '🛣️',
  rail: '🚆',
  station: '🚉',
  truckstop: '🚚',
  depot: '🏬',
  signal: '🚥',
  yield: '🔻',
  stop: '🛑',
  light: '🚦',
  roundabout: '🔄',
};

/** Tool shortcuts: KeyboardEvent.code → tool, and the label shown. */
const KEYS: Array<{ code: string; label: string; tool: ToolId }> = [
  { code: 'KeyV', label: 'V', tool: 'select' },
  { code: 'KeyR', label: 'R', tool: 'raise' },
  { code: 'KeyF', label: 'F', tool: 'lower' },
  { code: 'KeyB', label: 'B', tool: 'bulldoze' },
  { code: 'Digit1', label: '1', tool: 'road' },
  { code: 'Digit2', label: '2', tool: 'rail' },
  { code: 'Digit3', label: '3', tool: 'station' },
  { code: 'Digit4', label: '4', tool: 'truckstop' },
  { code: 'Digit5', label: '5', tool: 'yield' },
  { code: 'Digit6', label: '6', tool: 'stop' },
  { code: 'Digit7', label: '7', tool: 'light' },
  { code: 'Digit8', label: '8', tool: 'roundabout' },
  { code: 'Digit9', label: '9', tool: 'depot' },
  { code: 'KeyG', label: 'G', tool: 'signal' },
];
/** Short names for the dock buttons (the full name is in the tooltip). */
const SHORT: Partial<Record<ToolId, string>> = {
  station: 'Állomás',
  signal: 'Jelző',
  truckstop: 'Rakodó',
  yield: 'Elsőbbség',
  stop: 'STOP',
  lower: 'Süllyesztés',
};

const KEY_OF = Object.fromEntries(KEYS.map((k) => [k.tool, k.label])) as Record<ToolId, string>;

const PANEL_KEYS: Array<{ code: string; label: string; panel: Panel; title: string; icon: string }> = [
  { code: 'KeyJ', label: 'J', panel: 'lines', title: 'Járatok', icon: '🗺️' },
  { code: 'KeyP', label: 'P', panel: 'economy', title: 'Pénzügyek', icon: '💰' },
  { code: 'Digit0', label: '0', panel: 'dev', title: 'Dev', icon: '🛠️' },
];

const GROUPS: Array<{ title: string; tools: ToolId[] }> = [
  { title: '', tools: ['select'] },
  { title: 'Terep', tools: ['raise', 'lower', 'bulldoze'] },
  { title: 'Építés', tools: ['road', 'rail', 'signal', 'station', 'truckstop', 'depot'] },
  { title: 'Forgalom', tools: ['yield', 'stop', 'light', 'roundabout'] },
];

/** What to do with the active tool (the hint line above the dock). */
const HINT: Record<ToolId, string> = {
  select: 'Kijelölés — WASD / nyilak: mozgás · jobb húzás: forgatás · görgő: zoom (az egér felé) · H: gyorsbillentyűk',
  raise: 'Emelés — húzd végig a cellákon (piros), majd Építés',
  lower: 'Süllyesztés — húzd végig a cellákon (piros), majd Építés',
  bulldoze: 'Bontás — út, sín, megálló, tábla, fa; húzva is',
  road: 'Út — húzd az egeret: követi a kurzort, visszahúzva törlődik, elengedve megépül · vagy kattints a kezdő-, majd a célpontra · Esc: mégse',
  rail: 'Sín — max. 5 mező a kurzor felé, oldalra húzva kanyarodik · kattintás: lerakja és folytatod · húzva magától folytatja · Esc: vége · végállomáson hurok kell',
  signal: 'Vasúti jelző — kattints a sínre: arra az oldalra kerül, ahol a kurzor van, és az ott (jobb kéz felől) haladó vonatoknak szól · újra kattintva megfordul · Bontás (B): leszedi · váltótól legyen 1–2 cella távolságra',
  station: 'Vasútállomás — egy ipar telkének oldalára kattints · Q: peronhossz (6 / 8 / 10 / 12 cella; a hosszú vonatnak) · a vágány mindkét végét bekötheted (pl. hurokba)',
  truckstop: 'Kamionrakodó — egy ipar telkének oldalára kattints (úthoz csatlakozik)',
  depot: 'Raktár — 6×6 sík terület · Q: forgatás · a behajtóhoz ÉS a kihajtóhoz is kell út · amit egy járat lerak, egy másik továbbviszi',
  yield: 'Elsőbbségadás — a kereszteződés előtti útcellára: innen elengedik a többieket',
  stop: 'STOP — a kereszteződés előtti útcellára: itt mindig megállnak',
  light: 'Lámpa — kereszteződésre (3–4 irányú): a két irány felváltva kap zöldet',
  roundabout: 'Körforgalom — kereszteződésre: a kamionok a sziget körül mennek',
};

const SPEEDS: Array<{ speed: GameSpeed; glyph: string; title: string }> = [
  { speed: 0, glyph: '⏸', title: 'Szünet (Szóköz)' },
  { speed: 1, glyph: '▶', title: 'Normál (T)' },
  { speed: 3, glyph: '⏩', title: 'Gyorsított (T)' },
];

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}. ${m}. ${day}.`;
}

const money = (n: number) => `$${n.toLocaleString('hu-HU')}`;

export function GameUI() {
  const game = useGame();
  const snap = useGameSnapshot();
  const transport = useTransport();
  const industries = useIndustryCount();
  const roads = useRoadCount();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [help, setHelp] = useState(false);

  // The Járatok panel IS the network view (and drops the build tool, so map
  // clicks don't build anything meanwhile).
  useEffect(() => {
    transport.setView(panel === 'lines');
    if (panel === 'lines') game.setActiveTool('select');
  }, [panel, transport, game]);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const pickTool = (id: ToolId) => {
    // Building from the network view makes no sense: back to the map.
    setPanel((cur) => (cur === 'lines' && id !== 'select' ? null : cur));
    game.setActiveTool(id);
  };

  // Keyboard shortcuts. One listener for the component's life (it reads the
  // latest handler through a ref): re-subscribing on every render would drop
  // a key whose own effect (e.g. Esc → select tool) re-renders mid-dispatch.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  {
    onKeyRef.current = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (getDev().editorOn) return; // the model editor has its own keys
      if (e.code === 'Escape') {
        setHelp(false); // (the canvas drops the tool / route on Esc)
        return;
      }
      if (e.code === 'KeyH' || e.key === '?') {
        setHelp((h) => !h);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        game.setSpeed(game.getSpeed() === 0 ? 1 : 0);
        return;
      }
      if (e.code === 'KeyT') {
        game.setSpeed(game.getSpeed() === 3 ? 1 : 3);
        return;
      }
      const pk = PANEL_KEYS.find((k) => k.code === e.code);
      if (pk) {
        toggle(pk.panel);
        return;
      }
      const tk = KEYS.find((k) => k.code === e.code);
      if (tk) pickTool(tk.tool);
    };
  }

  const active = snap.activeTool;

  return (
    <div className="ui">
      {/* Top-left: money, date, speed, counters */}
      <div className="ui-bar">
        <div className="ui-bar__money" title="Egyenleg">
          {money(snap.money)}
        </div>
        <div className="ui-bar__sep" />
        <div className="ui-bar__date">{formatDate(snap.dateMs)}</div>
        <div className="ui-speed">
          {SPEEDS.map(({ speed, glyph, title }) => (
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
        <div className="ui-bar__sep" />
        <div className="ui-bar__stat" title="Ipari épületek">
          🏭 {industries}
        </div>
        <div className="ui-bar__stat" title="Lerakott utak (cella)">
          🛣️ {roads}
        </div>
      </div>

      {/* Top-right: panel buttons + help */}
      <div className="ui-menu">
        {PANEL_KEYS.map((k) => (
          <button
            key={k.panel}
            type="button"
            className={'ui-menu__btn' + (panel === k.panel ? ' is-active' : '')}
            onClick={() => toggle(k.panel)}
            title={`${k.title} (${k.label})`}
          >
            <span aria-hidden>{k.icon}</span>
            <span className="ui-menu__label">{k.title}</span>
            <kbd>{k.label}</kbd>
          </button>
        ))}
        <button type="button" className={'ui-menu__btn' + (help ? ' is-active' : '')} onClick={() => setHelp((h) => !h)} title="Gyorsbillentyűk (H)">
          <span className="ui-menu__label">Súgó</span>
          <kbd>H</kbd>
        </button>
      </div>

      {/* Side panel */}
      {panel && (
        <div className={'ui-panel' + (panel === 'dev' ? ' ui-panel--dev' : '')}>
          <div className="ui-panel__head">
            <span>{PANEL_KEYS.find((k) => k.panel === panel)?.title}</span>
            <button type="button" className="ui-panel__close" onClick={() => setPanel(null)} title="Bezárás">
              ✕
            </button>
          </div>
          <div className="ui-panel__body">
            {panel === 'lines' && <LinesPanel />}
            {panel === 'dev' && <DevTab onEditorOn={() => game.setActiveTool('select')} />}
            {panel === 'economy' && (
              <>
                <div className="ui-stat ui-stat--big">
                  <span>Egyenleg</span>
                  <b>{money(snap.money)}</b>
                </div>
                <div className="ui-stat">
                  <span>Összes bevétel</span>
                  <b className="is-plus">+{money(snap.totalIncome)}</b>
                </div>
                <div className="ui-stat">
                  <span>Összes kiadás</span>
                  <b className="is-minus">−{money(snap.totalSpent)}</b>
                </div>
                <div className="ui-note">
                  Bevétel: a járatok leszállított rakománya (Járatok). Kiadás: építés, tereprendezés, járművek (kamion, vonat).
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom: hint + tool dock */}
      <div className="ui-bottom">
        <div className="ui-hint">{HINT[active]}</div>
        <div className="ui-dock">
          {GROUPS.map((g) => (
            <div key={g.title || 'main'} className="ui-dock__group">
              {g.title && <div className="ui-dock__title">{g.title}</div>}
              <div className="ui-dock__tools">
                {g.tools.map((id) => {
                  const t = TOOLS[id];
                  const poor = t.cost > 0 && snap.money < t.cost;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'ui-tool' + (active === id ? ' is-active' : '') + (poor ? ' is-poor' : '')}
                      onClick={() => pickTool(id)}
                      title={`${t.label}${t.cost ? ` · $${t.cost}${id === 'road' || id === 'rail' || id === 'raise' || id === 'lower' ? ' / cella' : ''}` : ''} (${KEY_OF[id]})`}
                    >
                      <kbd className="ui-tool__key">{KEY_OF[id]}</kbd>
                      <span className="ui-tool__icon" aria-hidden>
                        {ICON[id]}
                      </span>
                      <span className="ui-tool__label">{SHORT[id] ?? t.label}</span>
                      <span className="ui-tool__cost">{t.cost ? `$${t.cost}` : ' '}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Help: keyboard shortcuts */}
      {help && (
        <div className="ui-help" onClick={() => setHelp(false)}>
          <div className="ui-help__card" onClick={(e) => e.stopPropagation()}>
            <div className="ui-panel__head">
              <span>Gyorsbillentyűk</span>
              <button type="button" className="ui-panel__close" onClick={() => setHelp(false)}>
                ✕
              </button>
            </div>
            <div className="ui-help__cols">
              <div>
                <h4>Eszközök</h4>
                {KEYS.map((k) => (
                  <div key={k.code} className="ui-help__row">
                    <kbd>{k.label}</kbd>
                    <span>
                      {ICON[k.tool]} {TOOLS[k.tool].label}
                    </span>
                  </div>
                ))}
                <div className="ui-help__row">
                  <kbd>Q</kbd>
                  <span>Raktár forgatása</span>
                </div>
                <div className="ui-help__row">
                  <kbd>Esc</kbd>
                  <span>Mégse / vissza a kijelöléshez</span>
                </div>
              </div>
              <div>
                <h4>Játék</h4>
                <div className="ui-help__row">
                  <kbd>Szóköz</kbd>
                  <span>Szünet / folytatás</span>
                </div>
                <div className="ui-help__row">
                  <kbd>T</kbd>
                  <span>Gyorsítás be / ki</span>
                </div>
                {PANEL_KEYS.map((k) => (
                  <div key={k.code} className="ui-help__row">
                    <kbd>{k.label}</kbd>
                    <span>
                      {k.icon} {k.title}
                    </span>
                  </div>
                ))}
                <div className="ui-help__row">
                  <kbd>H</kbd>
                  <span>Ez a súgó</span>
                </div>
                <h4>Kamera</h4>
                <div className="ui-help__row">
                  <kbd>W A S D</kbd>
                  <span>Mozgás (nyilakkal is)</span>
                </div>
                <div className="ui-help__row">
                  <kbd>Jobb húzás</kbd>
                  <span>Forgatás</span>
                </div>
                <div className="ui-help__row">
                  <kbd>Görgő</kbd>
                  <span>Közelítés</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
