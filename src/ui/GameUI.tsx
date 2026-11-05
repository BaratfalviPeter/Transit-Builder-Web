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
  BANKRUPT_MONTHS,
  GOAL_POPULATION,
  TOOLS,
  useCitySnapshot,
  useGame,
  useSave,
  selection,
  useSelection,
  useGameSnapshot,
  useRoadCount,
  useTransport,
  useTransportSnapshot,
  type GameSpeed,
  type ToolId,
} from '../sim';
import { getDev } from '../dev/modelEditorStore';
import { DevTab } from './DevTab';
import { LinesPanel } from './LinesPanel';
import { FinancePanel } from './FinancePanel';
import { Feedback, GamePanel } from './GamePanel';
import { Checklist, Intro, resetTutorial, useTutorial } from './Tutorial';
import { IndustryPanel } from './IndustryPanel';
import { StatsWindow } from './StatsWindow';
import './financePanel.css';
import './gameUI.css';

type Panel = 'lines' | 'economy' | 'game' | 'dev';

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
  oildepot: '🛢️',
  pipe: '〰️',
  signal: '🚥',
  yield: '🔻',
  stop: '🛑',
  light: '🚦',
  roundabout: '🔄',
  bridge: '🌉',
  tunnel: '🚇',
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
  { code: 'KeyN', label: 'N', tool: 'bridge' },
  { code: 'KeyU', label: 'U', tool: 'tunnel' },
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

/**
 * `key`: also match by the typed character — on a Hungarian keyboard the "0"
 * is left of the "1" (code 'Backquote'), not where `Digit0` is.
 */
const PANEL_KEYS: Array<{ code: string; key?: string; label: string; panel: Panel; title: string; icon: string }> = [
  { code: 'KeyJ', label: 'J', panel: 'lines', title: 'Járatok', icon: '🗺️' },
  { code: 'KeyP', label: 'P', panel: 'economy', title: 'Pénzügyek', icon: '💰' },
  { code: 'KeyM', label: 'M', panel: 'game', title: 'Játék', icon: '⚙️' },
  { code: 'Digit0', key: '0', label: '0', panel: 'dev', title: 'Dev', icon: '🛠️' },
];

const GROUPS: Array<{ title: string; tools: ToolId[] }> = [
  { title: '', tools: ['select'] },
  { title: 'Terep', tools: ['raise', 'lower', 'bulldoze'] },
  { title: 'Építés', tools: ['road', 'rail', 'bridge', 'tunnel', 'signal', 'station', 'truckstop', 'depot'] },
  { title: 'Olaj', tools: ['pipe', 'oildepot'] },
  { title: 'Forgalom', tools: ['yield', 'stop', 'light', 'roundabout'] },
];

/** What to do with the active tool (the hint line above the dock). */
const HINT: Record<ToolId, string> = {
  select: 'Kijelölés — kattints egy épületre: megállói (be / ki) · WASD / nyilak: mozgás · jobb húzás: forgatás · görgő: zoom (az egér felé) · H: gyorsbillentyűk',
  raise: 'Emelés — húzd végig a cellákon (piros), majd Építés',
  lower: 'Süllyesztés — húzd végig a cellákon (piros), majd Építés',
  bulldoze: 'Bontás — út, sín, megálló, tábla, fa; húzva is',
  road: 'Út — húzd az egeret: követi a kurzort, visszahúzva törlődik, elengedve megépül · vagy kattints a kezdő-, majd a célpontra · Esc: mégse',
  rail: 'Sín — a legrövidebb sín a kurzorig (bármilyen hosszú), oldalra húzva kanyarodik · Shift: csak egyenesen · kattintás: lerakja és folytatod · Esc: vége · végállomáson hurok kell',
  signal: 'Vasúti jelző — kattints a sínre: arra az oldalra kerül, ahol a kurzor van, és az ott (jobb kéz felől) haladó vonatoknak szól · újra kattintva megfordul · Bontás (B): leszedi · váltótól legyen 1–2 cella távolságra',
  station: 'Vasútállomás — egy ipar telkének oldalára kattints · Q: peronhossz (6 / 8 / 10 / 12 cella; a hosszú vonatnak) · a vágány mindkét végét bekötheted (pl. hurokba)',
  truckstop: 'Kamionrakodó — egy ipar telkének oldalára kattints (úthoz csatlakozik)',
  oildepot: 'Olajdepó — 7×6 sík terület · Q: forgatás · hátul egy kétirányú bejárati út (a narancs mező) — oda kösd az utat · csővel kösd össze az olajfúróval',
  pipe: 'Olajvezeték — húzd a fúrótól az olajdepóig (víz alatt is) · a fizetés a legközelebbi parttól számít · Bontás (B): leszedi',
  depot: 'Raktár — 6×6 sík terület · Q: forgatás · a behajtóhoz ÉS a kihajtóhoz is kell út · amit egy járat lerak, egy másik továbbviszi',
  yield: 'Elsőbbségadás — a kereszteződés előtti útcellára: innen elengedik a többieket',
  stop: 'STOP — a kereszteződés előtti útcellára: itt mindig megállnak',
  light: 'Lámpa — kereszteződésre (3–4 irányú): a két irány felváltva kap zöldet',
  roundabout: 'Körforgalom — kereszteződésre: a kamionok a sziget körül mennek',
  bridge: 'Híd — húzd az egyik hídfőtől a másikig (egyenesen) · a hídfők legyenek egy szinttel magasabban annál, ami alatta van (vagy víz) · utána Út / Sín eszközzel kattints rá · Esc: mégse',
  tunnel: 'Alagút — húzd az egyik szájától a másikig (egyenesen) · hegyen át, vagy egy út / sín alatt · utána Út / Sín eszközzel kattints rá · Esc: mégse',
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

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('hu-HU')}`;

export function GameUI() {
  const game = useGame();
  const snap = useGameSnapshot();
  const transport = useTransport();
  const roads = useRoadCount();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [help, setHelp] = useState(false);
  const tut = useTutorial();
  const picked = useSelection();
  const [stats, setStats] = useState(false);
  const city = useCitySnapshot();
  // The goal (beta test's end): noted once, the window shown when it happens.
  const [goalWin, setGoalWin] = useState(false);
  useEffect(() => {
    if (city.population >= GOAL_POPULATION && snap.goalAt === null) {
      game.reachGoal();
      setGoalWin(true);
    }
  }, [city.population, snap.goalAt, game]);
  // Picking an industry closes the other panels; opening one drops the pick.
  useEffect(() => {
    if (picked) setPanel(null);
  }, [picked]);
  useEffect(() => {
    if (panel) selection.set(null);
  }, [panel]);

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
        setStats(false);
        selection.set(null);
        return;
      }
      if (e.code === 'KeyK') {
        setStats((v) => !v);
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
      const pk = PANEL_KEYS.find((k) => k.code === e.code || (k.key !== undefined && e.key === k.key));
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
      {snap.bankrupt && <Bankrupt />}
      {stats && <StatsWindow onClose={() => setStats(false)} />}
      {goalWin && <GoalReached onClose={() => setGoalWin(false)} />}
      {tut.introOpen && !snap.bankrupt && <Intro onClose={tut.closeIntro} />}
      {tut.listOn && !tut.introOpen && <Checklist done={tut.done} onDone={tut.markDone} onClose={tut.closeList} />}
      {/* Top-left: money, date, speed, counters */}
      <div className="ui-bar">
        <div className={'ui-bar__money' + (snap.money < 0 ? ' is-minus' : '')} title={snap.loan > 0 ? `Egyenleg (hitel: ${money(snap.loan)})` : 'Egyenleg'}>
          {money(snap.money)}
        </div>
        {(snap.money < 0 || snap.negMonths > 0) && !snap.bankrupt && (
          <div
            className="ui-bar__warn"
            title={`Ha ${BANKRUPT_MONTHS} egymást követő hónap végén mínuszban vagy, csődbe mész. Vegyél fel hitelt (Pénzügyek, P), vagy csökkentsd a költségeket.`}
          >
            ⚠ mínusz {snap.negMonths}/{BANKRUPT_MONTHS} hó
          </div>
        )}
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
        <div
          className={'ui-bar__stat ui-bar__goal' + (city.population >= GOAL_POPULATION ? ' is-done' : '')}
          title={`A teszt célja: ${GOAL_POPULATION.toLocaleString('hu-HU')} lakos a városban`}
        >
          🎯 {city.population.toLocaleString('hu-HU')} / {GOAL_POPULATION.toLocaleString('hu-HU')}
        </div>

        <div className="ui-bar__stat" title="Lerakott utak (cella)">
          🛣️ {roads}
        </div>
      </div>

      {/* Top-right: panel buttons + help */}
      <div className="ui-menu">
        <Feedback compact />
        <button type="button" className={'ui-menu__btn' + (stats ? ' is-active' : '')} onClick={() => setStats((v) => !v)} title="Statisztika (K)">
          <span aria-hidden>📊</span>
          <span className="ui-menu__label">Statisztika</span>
          <kbd>K</kbd>
        </button>
        {/* The Dev tab has no button (beta): its key (0) still opens it. */}
        {PANEL_KEYS.filter((k) => k.panel !== 'dev').map((k) => (
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
            {panel === 'economy' && <FinancePanel />}
            {panel === 'game' && <GamePanel />}
          </div>
        </div>
      )}

      {/* Industry panel: the picked industry's stops */}
      {picked && !panel && (
        <div className="ui-panel">
          <div className="ui-panel__head">
            <span>Épület</span>
            <button type="button" className="ui-panel__close" onClick={() => selection.set(null)} title="Bezárás (Esc)">
              ✕
            </button>
          </div>
          <div className="ui-panel__body">
            <IndustryPanel anchor={picked} />
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
            <div className="ui-help__tut">
              <button
                type="button"
                onClick={() => {
                  setHelp(false);
                  tut.openIntro();
                }}
              >
                📖 Bemutató (hogyan működik a játék)
              </button>
              <button
                type="button"
                onClick={() => {
                  setHelp(false);
                  tut.openList();
                }}
              >
                ✅ Feladatlista
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
                  <kbd>K</kbd>
                  <span>📊 Statisztika</span>
                </div>
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

/** Game over: bankrupt (BANKRUPT_MONTHS month-ends in a row below zero). */
function Bankrupt() {
  const save = useSave();
  return (
    <div className="ui-over">
      <div className="ui-over__box">
        <div className="ui-over__title">💸 Csőd</div>
        <p>
          A cég {BANKRUPT_MONTHS} egymást követő hónap végén mínuszban volt, ezért csődbe ment. A játéknak vége.
        </p>
        <button
          type="button"
          onClick={() => {
            save.newGame();
            resetTutorial();
          }}
        >
          Új játék
        </button>
      </div>
    </div>
  );
}

/** The goal reached: the beta test's end (it goes on after). */
function GoalReached({ onClose }: { onClose: () => void }) {
  const snap = useGameSnapshot();
  const { lines } = useTransportSnapshot();
  const start = Date.UTC(1970, 0, 1);
  const d = new Date(snap.goalAt ?? snap.dateMs);
  const months = (d.getUTCFullYear() - new Date(start).getUTCFullYear()) * 12 + d.getUTCMonth();
  const vehicles = lines.reduce((a, l) => a + l.vehicles, 0);
  return (
    <div className="ui-over">
      <div className="ui-over__box ui-over__box--goal">
        <div className="ui-over__title">🎉 Gratulálunk!</div>
        <p>
          A város elérte a <b>{GOAL_POPULATION.toLocaleString('hu-HU')} lakost</b> — ez volt a bétateszt vége. Köszönjük, hogy kipróbáltad!
        </p>
        <div className="ui-over__figs">
          <span>📅 {formatDate(snap.goalAt ?? snap.dateMs)} ({Math.floor(months / 12)} év {months % 12} hónap)</span>
          <span>💰 Összes bevétel: {money(snap.totalIncome)}</span>
          <span>🏦 Egyenleg: {money(snap.money)}</span>
          <span>
            🚚 {lines.length} járat, {vehicles} jármű
          </span>
        </div>
        <p className="ui-over__note">Írd meg, mi tetszett és mi nem! Ha szeretnéd, játszhatsz tovább.</p>
        <button type="button" onClick={onClose}>
          Tovább játszom
        </button>
      </div>
    </div>
  );
}
