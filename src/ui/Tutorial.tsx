/**
 * Tutorial — the first-run help for (beta) players:
 *
 *   - `Intro`: a bigger window, page by page, explaining how the game works
 *     (industries → stops → lines → the city; money; power; the goal). It
 *     pauses the game while open. Shown once on the first visit; "Kihagyás"
 *     skips it.
 *   - `Checklist`: a small list at the screen's edge with the first tasks,
 *     ticking itself off from the game state. It can be closed.
 *
 * Both can be brought back from the help (H). What was seen / done is kept
 * per browser (localStorage, read / written defensively).
 */

import { useEffect, useRef, useState } from 'react';
import {
  CellType,
  GOAL_POPULATION,
  useCitySnapshot,
  useGame,
  useGameSnapshot,
  useInteriorStore,
  useProductionVersion,
  useRoadCount,
  useTerrainMap,
  useTransportSnapshot,
  type GameSpeed,
} from '../sim';
import './tutorial.css';

const KEY = 'transit-builder:tutorial';

interface TutorialState {
  /** The intro was seen (finished or skipped). */
  introSeen: boolean;
  /** The checklist is shown. */
  listOn: boolean;
  /** Tasks ticked off once (some can't be read back later, e.g. the first income). */
  done: string[];
}

function load(): TutorialState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TutorialState> | null;
    if (s) return { introSeen: !!s.introSeen, listOn: s.listOn !== false, done: Array.isArray(s.done) ? s.done : [] };
  } catch {
    /* blocked / broken storage: start fresh */
  }
  return { introSeen: false, listOn: true, done: [] };
}

function store(s: TutorialState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* blocked storage: it just won't be remembered */
  }
}

/** The tutorial's state, shared by GameUI (intro, checklist, the help's buttons). */
export function useTutorial() {
  const [st, setSt] = useState<TutorialState>(load);
  const update = (patch: Partial<TutorialState>) =>
    setSt((cur) => {
      const next = { ...cur, ...patch };
      store(next);
      return next;
    });
  return {
    introOpen: !st.introSeen,
    listOn: st.listOn,
    done: st.done,
    closeIntro: (showList: boolean) => update({ introSeen: true, listOn: showList }),
    openIntro: () => update({ introSeen: false }),
    openList: () => update({ listOn: true, done: [] }),
    closeList: () => update({ listOn: false }),
    markDone: (ids: string[]) => update({ done: [...new Set([...st.done, ...ids])] }),
  };
}

// ------------------------------------------------------------------- intro

interface Page {
  title: string;
  body: JSX.Element;
}

const PAGES: Page[] = [
  {
    title: '👋 Üdv a Transit Builderben!',
    body: (
      <>
        <p>
          Szállítási vállalatot vezetsz: utakat és síneket építesz, kamion- és vonatjáratokat indítasz az iparágak és a város
          között, és ebből keresel.
        </p>
        <p className="tut__goal">
          🎯 A cél: nőjön a város <b>{GOAL_POPULATION.toLocaleString('hu-HU')} lakosra</b>. Ez egy bétateszt — ha elérted, vége a
          tesztnek (utána játszhatsz tovább).
        </p>
        <p>Pár oldalon elmondjuk, hogyan működik. Bármikor kihagyhatod, és később a Súgóból (H) újra előhozhatod.</p>
      </>
    ),
  },
  {
    title: '🏭 Termelés → megálló → járat',
    body: (
      <>
        <ol>
          <li>
            Az <b>iparágak</b> termelnek, de csak akkor, ha van mellettük <b>megálló</b>: kamionrakodó (4) vagy vasútállomás (3) az
            épület valamelyik oldalán.
          </li>
          <li>
            A megállókat <b>úttal</b> (1, húzással) vagy <b>sínnel</b> (2) kötöd össze.
          </li>
          <li>
            A <b>Járatok</b> panelen (J) indítasz járatot: kattints sorban a megállókra. A jármű felrakja, amit egy későbbi megálló
            átvesz, és ott leadja.
          </li>
          <li>
            A leszállításért <b>fizetnek</b>: minél messzebbre és minél gyorsabban viszed, annál többet.
          </li>
          <li>
            Egy épületre <b>kattintva</b> látod a megállóit: beállíthatod, melyik a <b>be</b> (alapanyag) és melyik a <b>ki</b>{' '}
            (termék), és több kimenő megállónál az arányt.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: '🔗 Ellátási láncok',
    body: (
      <>
        <ul className="tut__chains">
          <li>🪓 Fatelep → 🟫 deszka → ⚙️ gyár → 📦 áru → 🏙️ város</li>
          <li>🪓 Fatelep → 🟫 deszka → 🏙️ város</li>
          <li>⛏️ Bánya → 🪨 szén → ⚡ erőmű → áram → 🏙️ város (az áram magától eljut a városba)</li>
        </ul>
        <p>
          Az iparágak <b>fejlődnek</b> (●●○○○): ha elviszed, amit termelnek, havonta nő a termelésük; ha nem, visszaesnek.
        </p>
        <p>
          Tipp: a Járatok panelen a <b>„Csak tele induljon”</b> beállítással a jármű megvárja, amíg megtelik.
        </p>
      </>
    ),
  },
  {
    title: '🏙️ A város',
    body: (
      <>
        <p>
          A város eleinte <b>magától nő</b>. Kb. 1600 lakos fölött viszont csak akkor nő tovább, ha kapja, amire szüksége van:
        </p>
        <ul>
          <li>
            📦 <b>áru</b> és 🟫 <b>deszka</b> — megállót a város (a szürke négyzet) bármelyik szélére rakhatsz;
          </li>
          <li>
            ⚡ <b>áram</b> — legalább 80%-ban. Egy bánya kb. 3700 lakosig elég; nagyobb városhoz több bánya kell.
          </li>
        </ul>
        <p>A város fölötti kártyán látod, mennyit kér és mennyit kapott ebben a hónapban.</p>
      </>
    ),
  },
  {
    title: '💰 Pénz',
    body: (
      <>
        <ul>
          <li>Az építés és a járművek pénzbe kerülnek.</li>
          <li>
            Minden hónap végén levonják a <b>fenntartást</b> (utak, sínek, megállók) és a járművek <b>üzemeltetését</b>.
          </li>
          <li>
            A <b>Pénzügyek</b> panelen (P) látod a könyvelést, és ott vehetsz fel <b>hitelt</b>.
          </li>
          <li className="tut__warn">
            Ha <b>6 egymást követő hónap</b> végén mínuszban vagy, csődbe mész — vége a játéknak.
          </li>
        </ul>
        <p>Járatonként a Járatok panel mutatja a bevételt, költséget és nyereséget.</p>
      </>
    ),
  },
  {
    title: '🎮 Irányítás',
    body: (
      <div className="tut__keys">
        <div>
          <kbd>W A S D</kbd> kamera mozgatása
        </div>
        <div>
          <kbd>Jobb húzás</kbd> forgatás · <kbd>Görgő</kbd> közelítés
        </div>
        <div>
          <kbd>1–9</kbd> építőeszközök (lent) · <kbd>Esc</kbd> mégse
        </div>
        <div>
          <kbd>Szóköz</kbd> szünet · <kbd>T</kbd> gyorsítás (vagy a ⏸ ▶ ⏩ gombok bal fent)
        </div>
        <div>
          <kbd>J</kbd> Járatok · <kbd>P</kbd> Pénzügyek · <kbd>K</kbd> statisztika · <kbd>M</kbd> mentés, új játék, beállítások
        </div>
        <div>
          <kbd>H</kbd> súgó (innen a bemutató és a feladatlista is újra elérhető)
        </div>
        <p>
          ⚙️ <b>Beállítások</b> (M): <b>grafika</b> — ha akad a játék, válaszd az „Energiatakarékos” fokozatot; <b>kamera</b> sebessége; a
          görgő az <b>egér felé zoomoljon</b>-e.
        </p>
        <p>
          💬 Hibát találtál vagy ötleted van? A jobb felső <b>Visszajelzés</b> gombbal írd meg (GitHub-fiók kell). A játék percenként
          magától ment. Jó szállítást!
        </p>
      </div>
    ),
  },
];

/** The intro window: pages, back / next / skip. Pauses the game while open. */
export function Intro({ onClose }: { onClose: (showList: boolean) => void }) {
  const game = useGame();
  const [page, setPage] = useState(0);
  const resume = useRef<GameSpeed>(1);
  useEffect(() => {
    resume.current = game.getSpeed() || 1;
    game.setSpeed(0);
    return () => game.setSpeed(resume.current);
  }, [game]);
  const last = page === PAGES.length - 1;
  const p = PAGES[page];
  return (
    <div className="tut-intro">
      <div className="tut-intro__card ui-help__card">
        <div className="tut-intro__head">
          <span>{p.title}</span>
          <span className="tut-intro__count">
            {page + 1} / {PAGES.length}
          </span>
        </div>
        <div className="tut-intro__body">{p.body}</div>
        <div className="tut-intro__dots">
          {PAGES.map((_, i) => (
            <button key={i} type="button" className={i === page ? 'is-on' : ''} onClick={() => setPage(i)} aria-label={`${i + 1}. oldal`} />
          ))}
        </div>
        <div className="tut-intro__foot">
          <button type="button" className="tut-btn tut-btn--ghost" onClick={() => onClose(false)} title="Bemutató és feladatlista nélkül">
            Kihagyás
          </button>
          <span className="tut-intro__spacer" />
          {page > 0 && (
            <button type="button" className="tut-btn" onClick={() => setPage(page - 1)}>
              ← Vissza
            </button>
          )}
          <button type="button" className="tut-btn tut-btn--main" onClick={() => (last ? onClose(true) : setPage(page + 1))}>
            {last ? 'Kezdjük! →' : 'Tovább →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- checklist

interface Task {
  id: string;
  text: string;
  hint?: string;
  /** Sticky: once true it stays ticked (kept in `done`). */
  sticky?: boolean;
}

const TASKS: Task[] = [
  { id: 'stop', text: 'Rakj le egy rakodót egy iparág mellé', hint: '4 Rakodó — pl. a fatelep vagy a bánya oldalára' },
  { id: 'stop2', text: 'Rakj le egy második megállót oda, ahová viszed', hint: 'pl. a gyár, az erőmű vagy a város széle' },
  { id: 'road', text: 'Köss össze két megállót úttal', hint: '1 Út — húzd az egyiktől a másikig' },
  { id: 'line', text: 'Indíts kamionjáratot', hint: 'J Járatok → Új kamionjárat → kattints a megállókra' },
  { id: 'income', text: 'Az első bevétel', hint: 'a kamion leszállítja a rakományt', sticky: true },
  { id: 'power', text: 'Áram: szén a bányából az erőműbe', hint: 'az erőmű magától ellátja a várost' },
  { id: 'city', text: 'Szállíts árut vagy deszkát a városba', hint: 'megálló a város szélére', sticky: true },
  { id: 'grow', text: 'A város elérje a 2000 lakost', hint: 'áru, deszka és áram kell neki' },
  { id: 'goal', text: `Cél: ${GOAL_POPULATION.toLocaleString('hu-HU')} lakos`, hint: 'ez a teszt vége' },
];

/** The small task list at the screen's edge; ticks itself off from the game. */
export function Checklist({ done, onDone, onClose }: { done: string[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const map = useTerrainMap();
  const roads = useRoadCount();
  const tr = useTransportSnapshot();
  const { totalIncome } = useGameSnapshot();
  const city = useCitySnapshot();
  const prod = useInteriorStore().production;
  useProductionVersion();
  const [open, setOpen] = useState(true);

  const stops = (map.stations ?? []).length;
  const industryStop = (map.stations ?? []).some((s) => map.cells[s.anchor[0]][s.anchor[1]] !== CellType.CityCenter);
  const delivered = Object.values(city.delivered).some((v) => (v ?? 0) > 0) || Object.values(city.satisfaction ?? {}).some((v) => (v ?? 0) > 0);
  const live: Record<string, boolean> = {
    stop: industryStop,
    stop2: stops >= 2,
    road: roads > 0,
    line: tr.lines.some((l) => !tr.noRoute.includes(l.id)),
    income: totalIncome > 0,
    power: prod.powerSupply() > 1,
    city: delivered,
    grow: city.population >= 2000,
    goal: city.population >= GOAL_POPULATION,
  };
  const isDone = (t: Task) => done.includes(t.id) || live[t.id];

  // Keep the sticky ones once reached.
  const newly = TASKS.filter((t) => t.sticky && live[t.id] && !done.includes(t.id)).map((t) => t.id);
  useEffect(() => {
    if (newly.length) onDone(newly);
  }, [newly.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = TASKS.filter(isDone).length;
  const next = TASKS.find((t) => !isDone(t));
  return (
    <div className="tut-list ui-help__card">
      <div className="tut-list__head">
        <button type="button" className="tut-list__toggle" onClick={() => setOpen(!open)} title={open ? 'Összecsukás' : 'Kinyitás'}>
          {open ? '▾' : '▸'} Feladatok
        </button>
        <span className="tut-list__count">
          {count}/{TASKS.length}
        </span>
        <button type="button" className="tut-list__close" onClick={onClose} title="Feladatlista bezárása (a Súgóból újra elérhető)">
          ✕
        </button>
      </div>
      <div className="tut-list__bar">
        <span style={{ width: `${(count / TASKS.length) * 100}%` }} />
      </div>
      {open && (
        <ul className="tut-list__items">
          {TASKS.map((t) => {
            const ok = isDone(t);
            const cur = t === next;
            return (
              <li key={t.id} className={(ok ? 'is-done' : '') + (cur ? ' is-next' : '')}>
                <span className="tut-list__mark">{ok ? '✔' : cur ? '▶' : '○'}</span>
                <span>
                  {t.text}
                  {t.id === 'grow' || t.id === 'goal' ? (
                    <span className="tut-list__pop"> ({city.population.toLocaleString('hu-HU')})</span>
                  ) : null}
                  {cur && t.hint && <span className="tut-list__hint">{t.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
