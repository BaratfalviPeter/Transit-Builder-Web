/**
 * IndustryPanel — opened by clicking an industry (or one of its stops) with
 * the select tool: its level / output, and its stops — each set to take
 * deliveries in, give the products out, or both; with several output stops,
 * how the output is split between them (shares).
 */

import {
  FIXED_PRODUCTION,
  INDUSTRY_ICON,
  INDUSTRY_NAME,
  ITEMS,
  LEVEL_RATE,
  MAX_INDUSTRY_LEVEL,
  ACCEPTS,
  stopGivesOut,
  stopKind,
  stopRole,
  stopShare,
  useInteriorStore,
  useProductionVersion,
  useTerrainMap,
  useTerrainStore,
  type Item,
  type Side,
  type Station,
  type StopRole,
} from '../sim';
import { formatPower } from '../render/CityLabel';
import './industryPanel.css';

const SIDE: Record<Side, string> = { N: 'északi', S: 'déli', W: 'nyugati', E: 'keleti' };
const ROLES: Array<{ role: StopRole; label: string; title: string }> = [
  { role: 'in', label: '⬇ Be', title: 'Csak ide hozzák az alapanyagot (nem visznek el innen semmit)' },
  { role: 'out', label: '⬆ Ki', title: 'Csak innen viszik el a terméket (ide nem rakodnak le)' },
  { role: 'both', label: '⇅ Mindkettő', title: 'Be és ki is' },
];

const stockText = (stock: Partial<Record<Item, number>>) =>
  (Object.keys(stock) as Item[])
    .filter((k) => (stock[k] ?? 0) >= 1)
    .map((k) => `${ITEMS[k].icon} ${Math.floor(stock[k] ?? 0)}`)
    .join('  ');

export function IndustryPanel({ anchor }: { anchor: readonly [number, number] }) {
  const map = useTerrainMap();
  const terrain = useTerrainStore();
  const prod = useInteriorStore().production;
  useProductionVersion();
  const type = map.cells[anchor[0]][anchor[1]];
  const fixed = FIXED_PRODUCTION[type];
  const makes = fixed?.makes ?? fixed?.turns?.to;
  const takes = ACCEPTS[type] ?? [];
  const stops = (map.stations ?? []).filter((s) => s.anchor[0] === anchor[0] && s.anchor[1] === anchor[1]);
  const outs = stops.filter(stopGivesOut);
  const shareSum = outs.reduce((a, s) => a + stopShare(s), 0);
  const st = prod.industry(anchor);
  const perMonth = fixed ? Math.round(fixed.rate * LEVEL_RATE[st.level - 1] * 30) : 0;

  const setRole = (s: Station, role: StopRole) => terrain.setStopRole(s.id, { role });
  const setShare = (s: Station, share: number) => terrain.setStopRole(s.id, { share });

  return (
    <div className="ind">
      <div className="ind__title">
        {INDUSTRY_ICON[type]} {INDUSTRY_NAME[type] ?? 'Épület'}
      </div>
      {makes && (
        <div className="ind__row">
          <span>
            Termel: {ITEMS[makes].icon} {ITEMS[makes].label}
            {fixed?.turns && <> (ebből: {ITEMS[fixed.turns.from].icon} {ITEMS[fixed.turns.from].label})</>}
          </span>
          <span className="ind__dim">{fixed?.turns ? `max. ${perMonth}` : perMonth} / hó</span>
        </div>
      )}
      {makes && (
        <div className="ind__row" title="Nő, ha a termelés ≥ 70%-át elviszed; visszaesik, ha < 30%-át">
          <span>
            Szint: <span className="ind__dots">{'●'.repeat(st.level)}</span>
            <span className="ind__dots ind__dots--off">{'●'.repeat(MAX_INDUSTRY_LEVEL - st.level)}</span>
          </span>
          <span className="ind__dim">{st.served !== null ? `elviszel ${Math.round(st.served * 100)}%` : 'még nincs adat'}</span>
        </div>
      )}
      {fixed?.burns && (
        <div className="ind__row">
          <span>⚡ Áramot termel a leszállított szénből</span>
          <span className="ind__dim">{formatPower(prod.plantPower(anchor))}</span>
        </div>
      )}
      {takes.length > 0 && (
        <div className="ind__row">
          <span>
            Átvesz: {takes.filter((i) => i !== 'crushed').map((i) => `${ITEMS[i].icon} ${ITEMS[i].label}`).join(', ')}
          </span>
        </div>
      )}

      <div className="ind__head">Megállók</div>
      {stops.length === 0 && <div className="panel__hint">Még nincs megállója: rakj le kamionrakodót (4) vagy vasútállomást (3) az épület valamelyik oldalára.</div>}
      {stops.map((s) => {
        const role = stopRole(s);
        const out = prod.stationStock(s.id);
        const inb = prod.inboundStock(s.id);
        const pct = shareSum > 0 ? Math.round((stopShare(s) / shareSum) * 100) : 0;
        return (
          <div key={s.id} className="ind__stop">
            <div className="ind__stop-name">
              {stopKind(s) === 'truck' ? '🚚 Kamionrakodó' : '🚉 Vasútállomás'} <span className="ind__dim">· {SIDE[s.side]} oldal</span>
            </div>
            <div className="ind__roles">
              {ROLES.map((r) => (
                <button key={r.role} type="button" title={r.title} className={role === r.role ? 'is-on' : ''} onClick={() => setRole(s, r.role)}>
                  {r.label}
                </button>
              ))}
            </div>
            {makes && stopGivesOut(s) && outs.length > 1 && (
              <div className="ind__share" title="A termék ekkora része kerül ebbe a megállóba">
                <input type="range" min={0} max={100} step={5} value={stopShare(s)} onChange={(e) => setShare(s, Number(e.target.value))} />
                <span>{pct}%</span>
              </div>
            )}
            <div className="ind__stock">
              {stockText(out) && <span title="Elszállításra vár">⬆ {stockText(out)}</span>}
              {stockText(inb) && <span title="Leszállítva, felhasználásra vár">⬇ {stockText(inb)}</span>}
            </div>
          </div>
        );
      })}
      {stops.length > 0 && (
        <div className="panel__hint">
          <b>Be</b>: ide hozzák az alapanyagot · <b>Ki</b>: innen viszik el a terméket. Ha több megálló ad ki terméket, a csúszkával állíthatod, melyik
          mennyit kapjon.
        </div>
      )}
    </div>
  );
}
