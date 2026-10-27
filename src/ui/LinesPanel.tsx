/**
 * LinesPanel — the side panel's "Járatok" tab: start a new truck or rail
 * line by clicking stops on the network view, and manage the lines
 * (vehicles ±, delete). Opening this tab opens the network view on the map.
 */

import {
  stopKind,
  stopLabel,
  DEFAULT_WAGONS,
  MAX_WAGONS,
  MIN_WAGONS,
  trainPrice,
  TRUCK_PRICE,
  useGame,
  useGameSnapshot,
  useTerrainMap,
  useTransport,
  useTransportSnapshot,
  type Line,
  type LineKind,
  WAGON_CAPACITY,
  WAGON_PRICE,
} from '../sim';
import './linesPanel.css';

/** Price of one vehicle of a line (a train: loco + its wagons); of a new line's first one. */
const priceOf = (l: Line): number => (l.kind === 'rail' ? trainPrice(l.wagons ?? DEFAULT_WAGONS) : TRUCK_PRICE);
const PRICE: Record<LineKind, number> = { truck: TRUCK_PRICE, rail: trainPrice(DEFAULT_WAGONS) };
const ICON: Record<LineKind, string> = { truck: '🚚', rail: '🚆' };
const VEHICLE: Record<LineKind, string> = { truck: 'kamion', rail: 'vonat' };

export function LinesPanel() {
  const sim = useTransport();
  const snap = useTransportSnapshot();
  const game = useGame();
  const { money } = useGameSnapshot();
  const map = useTerrainMap();

  const stopName = (id: number) => {
    const st = map.stations?.find((s) => s.id === id);
    return st ? stopLabel(map, st) : '— (elbontva)';
  };
  const stations = map.stations ?? [];
  const truckStops = stations.filter((s) => s.kind === 'truck' || s.kind === 'depot').length;
  const railStops = stations.filter((s) => stopKind(s) === 'rail' || s.kind === 'depot').length;

  const draft = snap.draft;
  const kind = snap.draftKind;
  const finish = () => {
    if (!game.canAfford(PRICE[kind])) return;
    if (sim.finishDraft()) game.spend(PRICE[kind]);
  };
  const addVehicle = (l: Line) => {
    if (game.spend(priceOf(l))) sim.setVehicles(l.id, l.vehicles + 1);
  };
  const removeVehicle = (l: Line) => {
    if (l.vehicles <= 0) return;
    sim.setVehicles(l.id, l.vehicles - 1);
    game.refund(Math.floor(priceOf(l) / 2));
  };
  const removeLine = (l: Line) => {
    game.refund(Math.floor((priceOf(l) * l.vehicles) / 2));
    sim.removeLine(l.id);
  };
  // Train length: every train of the line gets (or sells) a wagon.
  const addWagon = (l: Line) => {
    const w = l.wagons ?? DEFAULT_WAGONS;
    if (w >= MAX_WAGONS || !game.spend(WAGON_PRICE * l.vehicles)) return;
    sim.setWagons(l.id, w + 1);
  };
  const removeWagon = (l: Line) => {
    const w = l.wagons ?? DEFAULT_WAGONS;
    if (w <= MIN_WAGONS) return;
    sim.setWagons(l.id, w - 1);
    game.refund(Math.floor((WAGON_PRICE * l.vehicles) / 2));
  };

  const newButton = (k: LineKind, enough: boolean, why: string) => (
    <button
      type="button"
      className="panel__tool"
      onClick={() => sim.startDraft(k)}
      disabled={!enough}
      title={enough ? '' : why}
    >
      <span className="panel__tool-icon" aria-hidden>
        {ICON[k]}
      </span>
      <span className="panel__tool-label">{k === 'truck' ? 'Új kamionjárat' : 'Új vonatjárat'}</span>
      <span className="panel__tool-cost">${PRICE[k]}</span>
    </button>
  );

  return (
    <div className="lines">
      {!draft && (
        <>
          {newButton('truck', truckStops >= 2, 'Előbb építs legalább két kamionrakodót vagy raktárt')}
          {newButton('rail', railStops >= 2, 'Előbb építs legalább két vasútállomást vagy raktárt')}
          {truckStops < 2 && railStops < 2 && (
            <div className="panel__hint">Járathoz legalább két megálló kell (rakodó / vasútállomás / raktár), és út vagy sín köztük.</div>
          )}
        </>
      )}

      {draft && (
        <div className="lines__draft">
          <div className="lines__draft-title">
            {kind === 'truck' ? 'Új kamionjárat — kattints a rakodókra / raktárakra sorban' : 'Új vonatjárat — kattints a vasútállomásokra / raktárakra sorban'}
          </div>
          <ol className="lines__stops">
            {draft.map((id, i) => (
              <li key={i}>{stopName(id)}</li>
            ))}
          </ol>
          {draft.length < 2 && <div className="panel__hint">Legalább két megálló kell. A járat a végén visszafordul az elsőhöz.</div>}
          {kind === 'rail' && (
            <div className="panel__hint">
              A vonat nem tolat: a végállomásokon <b>fordítóhurok</b> kell (vagy körpálya). Több vonathoz kitérő vagy második vágány kell.
            </div>
          )}
          <div className="lines__row">
            <button type="button" disabled={draft.length < 2 || money < PRICE[kind]} onClick={finish}>
              ✔ Kész (1 {VEHICLE[kind]}, ${PRICE[kind]})
            </button>
            <button type="button" onClick={() => sim.cancelDraft()}>
              ✕ Mégse
            </button>
          </div>
        </div>
      )}

      {snap.lines.length > 0 && <div className="lines__head">Járatok</div>}
      {snap.lines.map((l) => (
        <div key={l.id} className="lines__item">
          <div className="lines__name">
            <span className="lines__dot" style={{ background: l.color }} />
            {ICON[l.kind]} {l.name}
            {snap.noRoute.includes(l.id) && (
              <span className="lines__warn" title={l.kind === 'rail' ? 'Nincs sín, vagy hiányzik a fordítóhurok' : ''}>
                nincs út!
              </span>
            )}
            {snap.stalled.includes(l.id) && (
              <span className="lines__warn" title="A vonatok egymásra várnak: építs kitérőt vagy második vágányt">
                foglalt pálya
              </span>
            )}
          </div>
          <div className="lines__route">{l.stops.map(stopName).join(' → ')} ↺</div>
          <div className="lines__row">
            <span>
              {ICON[l.kind]} {l.vehicles}
            </span>
            <button type="button" onClick={() => removeVehicle(l)} disabled={l.vehicles <= 0} title={`Egy ${VEHICLE[l.kind]} eladása (½ ár vissza)`}>
              −
            </button>
            <button type="button" onClick={() => addVehicle(l)} disabled={money < priceOf(l)} title={`Új ${VEHICLE[l.kind]} ($${priceOf(l)})`}>
              +
            </button>
            <button type="button" className="lines__del" onClick={() => removeLine(l)} title={`Járat törlése (a járművek ½ árát visszakapod)`}>
              🗑
            </button>
          </div>
          {l.kind === 'rail' && (
            <div className="lines__row" title="Vonathossz: kocsik száma vonatonként (a vonatok a következő megállójukban veszik fel / adják le)">
              <span>
                🚃 {l.wagons ?? DEFAULT_WAGONS} kocsi · {(l.wagons ?? DEFAULT_WAGONS) * WAGON_CAPACITY} egység
              </span>
              <button type="button" onClick={() => removeWagon(l)} disabled={(l.wagons ?? DEFAULT_WAGONS) <= MIN_WAGONS} title="Egy kocsival rövidebb (½ ár vissza)">
                −
              </button>
              <button
                type="button"
                onClick={() => addWagon(l)}
                disabled={(l.wagons ?? DEFAULT_WAGONS) >= MAX_WAGONS || money < WAGON_PRICE * l.vehicles}
                title={`Egy kocsival hosszabb ($${WAGON_PRICE} vonatonként)`}
              >
                +
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="panel__hint">
        A járművek felrakják, amit egy későbbi megálló átvesz, és ott leadják. Fizetés leszállításkor: minél messzebbre és minél
        értékesebb árut viszel, annál több. A vonat drága (mozdony + kocsik), de sokat visz (kocsinként {WAGON_CAPACITY} egység) és gyors; a hossza
        járatonként állítható ({MIN_WAGONS}–{MAX_WAGONS} kocsi). A peronnál hosszabb vonat hátul kilóg.
      </div>
    </div>
  );
}
