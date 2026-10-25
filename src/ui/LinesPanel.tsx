/**
 * LinesPanel — the side panel's "Járatok" tab: start a new truck line by
 * clicking stops on the network view, and manage the lines (trucks ±,
 * delete). Opening this tab opens the network view on the map.
 */

import {
  INDUSTRY_ICON,
  INDUSTRY_NAME,
  TRUCK_PRICE,
  useGame,
  useGameSnapshot,
  useTerrainMap,
  useTransport,
  useTransportSnapshot,
  type Line,
} from '../sim';
import './linesPanel.css';

export function LinesPanel() {
  const sim = useTransport();
  const snap = useTransportSnapshot();
  const game = useGame();
  const { money } = useGameSnapshot();
  const map = useTerrainMap();

  const stopName = (id: number) => {
    const st = map.stations?.find((s) => s.id === id);
    const t = st ? map.cells[st.anchor[0]][st.anchor[1]] : null;
    return t ? `${INDUSTRY_ICON[t] ?? ''} ${INDUSTRY_NAME[t] ?? ''}` : '— (elbontva)';
  };
  const truckStops = (map.stations ?? []).filter((s) => (s.kind ?? 'rail') === 'truck').length;

  const finish = () => {
    if (!game.canAfford(TRUCK_PRICE)) return;
    if (sim.finishDraft()) game.spend(TRUCK_PRICE);
  };
  const addTruck = (l: Line) => {
    if (game.spend(TRUCK_PRICE)) sim.setVehicles(l.id, l.vehicles + 1);
  };
  const removeTruck = (l: Line) => {
    if (l.vehicles <= 0) return;
    sim.setVehicles(l.id, l.vehicles - 1);
    game.refund(Math.floor(TRUCK_PRICE / 2));
  };
  const removeLine = (l: Line) => {
    game.refund(Math.floor((TRUCK_PRICE * l.vehicles) / 2));
    sim.removeLine(l.id);
  };

  const draft = snap.draft;
  return (
    <div className="lines">
      {!draft && (
        <button
          type="button"
          className="panel__tool"
          onClick={() => sim.startDraft()}
          disabled={truckStops < 2}
          title={truckStops < 2 ? 'Előbb építs legalább két kamionrakodót' : ''}
        >
          <span className="panel__tool-icon" aria-hidden>
            ➕
          </span>
          <span className="panel__tool-label">Új kamionjárat</span>
          <span className="panel__tool-cost">${TRUCK_PRICE}</span>
        </button>
      )}
      {truckStops < 2 && !draft && (
        <div className="panel__hint">Járathoz legalább két kamionrakodó kell (Infrastruktúra fül), és út köztük.</div>
      )}

      {draft && (
        <div className="lines__draft">
          <div className="lines__draft-title">Új járat — kattints a rakodókra sorban</div>
          <ol className="lines__stops">
            {draft.map((id, i) => (
              <li key={i}>{stopName(id)}</li>
            ))}
          </ol>
          {draft.length < 2 && <div className="panel__hint">Legalább két megálló kell. A járat a végén visszafordul az elsőhöz.</div>}
          <div className="lines__row">
            <button type="button" disabled={draft.length < 2 || money < TRUCK_PRICE} onClick={finish}>
              ✔ Kész (1 kamion, ${TRUCK_PRICE})
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
            {l.name}
            {snap.noRoute.includes(l.id) && <span className="lines__warn">nincs út!</span>}
          </div>
          <div className="lines__route">{l.stops.map(stopName).join(' → ')} ↺</div>
          <div className="lines__row">
            <span>🚚 {l.vehicles}</span>
            <button type="button" onClick={() => removeTruck(l)} disabled={l.vehicles <= 0} title="Kamion eladása (½ ár vissza)">
              −
            </button>
            <button type="button" onClick={() => addTruck(l)} disabled={money < TRUCK_PRICE} title={`Új kamion ($${TRUCK_PRICE})`}>
              +
            </button>
            <button type="button" className="lines__del" onClick={() => removeLine(l)} title="Járat törlése (a kamionok ½ árát visszakapod)">
              🗑
            </button>
          </div>
        </div>
      ))}
      <div className="panel__hint">
        A kamion felrakja, amit egy későbbi megálló átvesz, és ott leadja. Fizetés leszállításkor: minél messzebbre és minél
        értékesebb árut viszel, annál több.
      </div>
    </div>
  );
}
