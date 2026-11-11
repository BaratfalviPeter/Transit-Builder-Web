/**
 * FinancePanel — the side panel's "Pénzügyek" tab: balance + loan, the books
 * of this and last month by category, the expected monthly running costs
 * (itemised upkeep + vehicles) and each line's last-month result.
 */

import {
  LOAN_RATE,
  LOAN_STEP,
  MAX_LOAN,
  runningOf,
  upkeepOf,
  useGame,
  useGameSnapshot,
  useTerrainMap,
  useTransport,
  useTransportSnapshot,
  type FinCat,
  type MonthBooks,
} from '../sim';
import './financePanel.css';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('hu-HU')}`;

const COSTS: Array<[Exclude<FinCat, 'income'>, string]> = [
  ['build', 'Építés'],
  ['vehicles', 'Járművek vásárlása'],
  ['upkeep', 'Fenntartás'],
  ['running', 'Járművek üzemeltetése'],
  ['interest', 'Hitelkamat'],
];

const result = (b: MonthBooks) => b.cat.income - COSTS.reduce((a, [c]) => a + b.cat[c], 0);

export function FinancePanel() {
  const game = useGame();
  const snap = useGameSnapshot();
  const map = useTerrainMap();
  const { lines } = useTransportSnapshot();
  const upkeep = upkeepOf(map);
  const upkeepTotal = upkeep.reduce((a, i) => a + i.cost, 0);
  const transport = useTransport();
  const runningTotal = lines.reduce((a, l) => a + runningOf(l, transport.dirtShare(l.id)), 0);
  const interest = Math.round((snap.loan * LOAN_RATE) / 12);
  const last = snap.lastMonth;
  const cell = (b: MonthBooks | null, f: (b: MonthBooks) => number, sign: 1 | -1) => {
    if (!b) return <td className="fin__na">—</td>;
    const v = f(b) * sign;
    return <td className={v > 0 ? 'is-plus' : v < 0 ? 'is-minus' : ''}>{v === 0 ? '$0' : money(v)}</td>;
  };

  return (
    <div className="fin">
      <div className="ui-stat ui-stat--big">
        <span>Egyenleg</span>
        <b className={snap.money < 0 ? 'is-minus' : ''}>{money(snap.money)}</b>
      </div>
      {snap.money < 0 && (
        <div className="fin__warn">Mínuszban vagy: amíg nem jössz ki belőle, nem építhetsz és nem vehetsz járművet. Vegyél fel hitelt, vagy várd ki a bevételt.</div>
      )}

      <div className="fin__loan">
        <div className="ui-stat">
          <span>Hitel</span>
          <b>{money(snap.loan)}</b>
        </div>
        <div className="fin__loanrow">
          <button type="button" onClick={() => game.borrow()} disabled={snap.loan + LOAN_STEP > MAX_LOAN} title={`Max. ${money(MAX_LOAN)}`}>
            + {money(LOAN_STEP)} felvétel
          </button>
          <button type="button" onClick={() => game.repay()} disabled={snap.loan <= 0 || snap.money < Math.min(LOAN_STEP, snap.loan)}>
            − {money(Math.min(LOAN_STEP, snap.loan || LOAN_STEP))} törlesztés
          </button>
        </div>
        <div className="ui-note">
          Kamat évi {Math.round(LOAN_RATE * 100)}%, havonta vonódik le{snap.loan > 0 ? ` (most ${money(interest)} / hó)` : ''}. Legfeljebb {money(MAX_LOAN)}.
        </div>
      </div>

      <div className="fin__head">Könyvelés</div>
      <table className="fin__table">
        <thead>
          <tr>
            <th />
            <th>Ez a hónap</th>
            <th>Múlt hónap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Bevétel (szállítás)</th>
            {cell(snap.month, (b) => b.cat.income, 1)}
            {cell(last, (b) => b.cat.income, 1)}
          </tr>
          {COSTS.map(([c, label]) => (
            <tr key={c}>
              <th>{label}</th>
              {cell(snap.month, (b) => b.cat[c], -1)}
              {cell(last, (b) => b.cat[c], -1)}
            </tr>
          ))}
          <tr className="fin__sum">
            <th>Eredmény</th>
            {cell(snap.month, result, 1)}
            {cell(last, result, 1)}
          </tr>
        </tbody>
      </table>
      <div className="ui-note">A fenntartás, az üzemeltetés és a kamat a hónap végén vonódik le.</div>

      <div className="fin__head">Havi fix költség (várható)</div>
      <table className="fin__table fin__table--costs">
        <tbody>
          {upkeep.map((i) => (
            <tr key={i.label}>
              <th>
                {i.label} <span className="fin__dim">· {i.count} {i.unit}</span>
              </th>
              <td className="is-minus">{money(-i.cost)}</td>
            </tr>
          ))}
          {runningTotal > 0 && (
            <tr>
              <th>Járművek üzemeltetése</th>
              <td className="is-minus">{money(-runningTotal)}</td>
            </tr>
          )}
          {interest > 0 && (
            <tr>
              <th>Hitelkamat</th>
              <td className="is-minus">{money(-interest)}</td>
            </tr>
          )}
          <tr className="fin__sum">
            <th>Összesen / hó</th>
            <td className={upkeepTotal + runningTotal + interest > 0 ? 'is-minus' : ''}>{money(-(upkeepTotal + runningTotal + interest))}</td>
          </tr>
        </tbody>
      </table>

      {lines.length > 0 && (
        <>
          <div className="fin__head">Járatok (múlt hónap)</div>
          <table className="fin__table">
            <thead>
              <tr>
                <th />
                <th>Bevétel</th>
                <th>Költség</th>
                <th>Haszon</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const inc = last?.lineIncome[l.id] ?? 0;
                const cost = last?.lineCost[l.id] ?? runningOf(l, transport.dirtShare(l.id));
                const net = inc - cost;
                return (
                  <tr key={l.id}>
                    <th>
                      <span className="fin__dot" style={{ background: l.color }} />
                      {l.kind === 'rail' ? '🚆' : '🚚'} {l.name}
                    </th>
                    <td className="is-plus">{last ? money(inc) : '—'}</td>
                    <td className="is-minus">{money(-cost)}</td>
                    <td className={net >= 0 ? 'is-plus' : 'is-minus'}>{last ? money(net) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="ui-note">Költség: a járat járműveinek havi üzemeltetése (a vásárlás nélkül). Ez a hónap eddig: lásd a Könyvelést.</div>
        </>
      )}
    </div>
  );
}
