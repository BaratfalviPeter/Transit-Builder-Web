/**
 * StatsWindow — the big statistics window (K): the last HISTORY_MONTHS
 * closed months (GameState.history), on three tabs:
 *   - Pénz: income vs costs per month (bars), the balance (line), a table;
 *   - Járatok: per line, profit per month (bars) and last month's figures;
 *   - Város: population (line), supply of goods / planks / power (lines).
 *
 * Plain SVG charts: one y-axis each, thin marks, a hover band per month
 * with a tooltip (SVG <title>), legends for ≥ 2 series, a table beside.
 */

import { useState } from 'react';
import { useGameSnapshot, useTransportSnapshot, type MonthRecord } from '../sim';
import { formatPower } from '../render/CityLabel';
import './statsWindow.css';

/** Categorical slots of the reference palette, dark-surface steps (blue, orange, aqua). */
const C1 = '#3987e5';
const C2 = '#d95926';
const C3 = '#199e70';

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('hu-HU')}`;
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
const monthLabel = (m: number) => `${Math.floor(m / 12)}. ${String((m % 12) + 1).padStart(2, '0')}.`;
const shortMonth = (m: number) => String((m % 12) + 1).padStart(2, '0');
const costsOf = (r: MonthRecord) => r.cat.build + r.cat.vehicles + r.cat.upkeep + r.cat.running + r.cat.interest;

const W = 640;
const H = 170;
const PAD = { l: 64, r: 10, t: 10, b: 22 };

/** Nice round top for an axis. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

interface Series {
  name: string;
  color: string;
  values: Array<number | null>;
}

/** A chart frame: y grid + labels (one axis), month labels, hover bands with tooltips. */
function Frame({
  months,
  lo,
  hi,
  fmt,
  tip,
  children,
}: {
  months: number[];
  lo: number;
  hi: number;
  fmt: (v: number) => string;
  tip: (i: number) => string;
  children: (x: (i: number) => number, y: (v: number) => number, band: number) => React.ReactNode;
}) {
  const n = Math.max(1, months.length);
  const band = (W - PAD.l - PAD.r) / n;
  const x = (i: number) => PAD.l + band * (i + 0.5);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  return (
    <svg className="stats__svg" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'stats__zero' : 'stats__grid'} />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="stats__tick">
            {fmt(t)}
          </text>
        </g>
      ))}
      {lo < 0 && hi > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stats__zero" />}
      {months.map((m, i) => (
        <text key={m} x={x(i)} y={H - 6} textAnchor="middle" className="stats__tick">
          {shortMonth(m)}
        </text>
      ))}
      {children(x, y, band)}
      {/* Hover bands: bigger than the marks, a tooltip per month. */}
      {months.map((m, i) => (
        <rect key={m} x={x(i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} className="stats__hover">
          <title>{tip(i)}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Bars per month (one or two series side by side), from the zero line. */
function Bars({ months, series, fmt, tip }: { months: number[]; series: Series[]; fmt: (v: number) => string; tip: (i: number) => string }) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const hi = niceMax(Math.max(0, ...all));
  const lo = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(0, ...all)) : 0;
  return (
    <Frame months={months} lo={lo} hi={hi} fmt={fmt} tip={tip}>
      {(x, y, band) => {
        const bw = Math.max(3, Math.min(16, (band - 6) / series.length - 2));
        return series.map((s, k) =>
          s.values.map((v, i) => {
            if (v === null || v === 0) return null;
            const cx = x(i) + (k - (series.length - 1) / 2) * (bw + 2);
            const top = Math.min(y(v), y(0));
            const h = Math.abs(y(v) - y(0));
            return <rect key={`${k}-${i}`} x={cx - bw / 2} y={top} width={bw} height={Math.max(1, h)} rx={2} fill={s.color} />;
          }),
        );
      }}
    </Frame>
  );
}

/** Lines per series (2px), small markers, gaps where a value is missing. */
function Lines({
  months,
  series,
  fmt,
  tip,
  lo = 0,
  hi,
}: {
  months: number[];
  series: Series[];
  fmt: (v: number) => string;
  tip: (i: number) => string;
  lo?: number;
  hi?: number;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = hi ?? niceMax(Math.max(0, ...all));
  const bottom = Math.min(lo, ...all) < 0 ? -niceMax(-Math.min(0, ...all)) : lo;
  return (
    <Frame months={months} lo={bottom} hi={top} fmt={fmt} tip={tip}>
      {(x, y) =>
        series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
          const runs: string[][] = [[]];
          for (const p of pts) if (p) runs[runs.length - 1].push(p);
          else runs.push([]);
          return (
            <g key={s.name}>
              {runs.filter((r) => r.length > 1).map((r, j) => (
                <polyline key={j} points={r.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {s.values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} className="stats__dot" />))}
            </g>
          );
        })
      }
    </Frame>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="stats__legend">
      {series.map((s) => (
        <span key={s.name}>
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

type Tab = 'money' | 'lines' | 'city';

export function StatsWindow({ onClose }: { onClose: () => void }) {
  const { history } = useGameSnapshot();
  const { lines } = useTransportSnapshot();
  const [tab, setTab] = useState<Tab>('money');
  const h = history.slice(-12);
  const months = h.map((r) => r.month);

  return (
    <div className="stats" onClick={onClose}>
      <div className="stats__card ui-help__card" onClick={(e) => e.stopPropagation()}>
        <div className="ui-panel__head">
          <span>📊 Statisztika — utolsó {h.length || 0} hónap</span>
          <button type="button" className="ui-panel__close" onClick={onClose} title="Bezárás (K / Esc)">
            ✕
          </button>
        </div>
        <div className="stats__tabs">
          {(
            [
              ['money', '💰 Pénz'],
              ['lines', '🚚 Járatok'],
              ['city', '🏙️ Város'],
            ] as Array<[Tab, string]>
          ).map(([t, label]) => (
            <button key={t} type="button" className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <div className="stats__body">
          {h.length === 0 && <div className="panel__hint">Még nem zárult le egy hónap sem — a statisztika minden hónap végén bővül.</div>}

          {h.length > 0 && tab === 'money' && (
            <>
              <h4>Bevétel és költségek havonta</h4>
              <Legend
                series={[
                  { name: 'Bevétel', color: C1, values: [] },
                  { name: 'Költségek (építés, járművek, fenntartás, üzemeltetés, kamat)', color: C2, values: [] },
                ]}
              />
              <Bars
                months={months}
                series={[
                  { name: 'Bevétel', color: C1, values: h.map((r) => r.cat.income) },
                  { name: 'Költségek', color: C2, values: h.map(costsOf) },
                ]}
                fmt={usd}
                tip={(i) => `${monthLabel(h[i].month)}\nBevétel: ${usd(h[i].cat.income)}\nKöltségek: ${usd(costsOf(h[i]))}\nEredmény: ${usd(h[i].cat.income - costsOf(h[i]))}`}
              />
              <h4>Egyenleg a hónap végén</h4>
              <Lines
                months={months}
                series={[{ name: 'Egyenleg', color: C1, values: h.map((r) => r.money) }]}
                fmt={usd}
                tip={(i) => `${monthLabel(h[i].month)}\nEgyenleg: ${usd(h[i].money)}`}
              />
              <table className="stats__table">
                <thead>
                  <tr>
                    <th>Hónap</th>
                    <th>Bevétel</th>
                    <th>Építés</th>
                    <th>Járművek</th>
                    <th>Fenntartás</th>
                    <th>Üzemeltetés</th>
                    <th>Kamat</th>
                    <th>Eredmény</th>
                    <th>Egyenleg</th>
                  </tr>
                </thead>
                <tbody>
                  {[...h].reverse().map((r) => {
                    const res = r.cat.income - costsOf(r);
                    return (
                      <tr key={r.month}>
                        <td>{monthLabel(r.month)}</td>
                        <td>{usd(r.cat.income)}</td>
                        <td>{usd(r.cat.build)}</td>
                        <td>{usd(r.cat.vehicles)}</td>
                        <td>{usd(r.cat.upkeep)}</td>
                        <td>{usd(r.cat.running)}</td>
                        <td>{usd(r.cat.interest)}</td>
                        <td className={res < 0 ? 'is-minus' : 'is-plus'}>{usd(res)}</td>
                        <td>{usd(r.money)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {h.length > 0 && tab === 'lines' && (
            <>
              {lines.length === 0 && <div className="panel__hint">Még nincs járat.</div>}
              {lines.map((l) => {
                const profit = h.map((r) => (r.lines[l.id] ? r.lines[l.id].income - r.lines[l.id].cost : null));
                const last = h[h.length - 1].lines[l.id];
                return (
                  <div key={l.id} className="stats__line">
                    <div className="stats__line-head">
                      <span className="stats__swatch" style={{ background: l.color }} />
                      {l.kind === 'rail' ? '🚆' : '🚚'} {l.name}
                      {last && (
                        <span className="stats__line-figs">
                          múlt hónap: <b className={last.income - last.cost < 0 ? 'is-minus' : 'is-plus'}>{usd(last.income - last.cost)}</b> · 📦{' '}
                          {Math.round(last.units)} · ⏱ {pct(last.speed)} · 🚦 állt {pct(last.held)}
                        </span>
                      )}
                    </div>
                    <Bars
                      months={months}
                      series={[{ name: 'Nyereség', color: C1, values: profit }]}
                      fmt={usd}
                      tip={(i) => {
                        const r = h[i].lines[l.id];
                        return r
                          ? `${monthLabel(h[i].month)}\nBevétel: ${usd(r.income)}\nKöltség: ${usd(r.cost)}\nNyereség: ${usd(r.income - r.cost)}\nSzállított: ${Math.round(r.units)}\nMenetidő: ${pct(r.speed)} · állt: ${pct(r.held)}`
                          : `${monthLabel(h[i].month)}\n(még nem létezett)`;
                      }}
                    />
                  </div>
                );
              })}
            </>
          )}

          {h.length > 0 && tab === 'city' && (
            <>
              <h4>Lakosság</h4>
              <Lines
                months={months}
                series={[{ name: 'Lakosság', color: C1, values: h.map((r) => r.population) }]}
                fmt={(v) => Math.round(v).toLocaleString('hu-HU')}
                tip={(i) => `${monthLabel(h[i].month)}\nLakosság: ${h[i].population.toLocaleString('hu-HU')}`}
              />
              <h4>Ellátottság</h4>
              <Legend
                series={[
                  { name: '📦 Áru', color: C1, values: [] },
                  { name: '🟫 Deszka', color: C2, values: [] },
                  { name: '⚡ Áram', color: C3, values: [] },
                ]}
              />
              <Lines
                months={months}
                hi={1}
                series={[
                  { name: 'Áru', color: C1, values: h.map((r) => r.sat.goods) },
                  { name: 'Deszka', color: C2, values: h.map((r) => r.sat.plank) },
                  { name: 'Áram', color: C3, values: h.map((r) => r.sat.power) },
                ]}
                fmt={(v) => `${Math.round(v * 100)}%`}
                tip={(i) =>
                  `${monthLabel(h[i].month)}\nÁru: ${pct(h[i].sat.goods)}\nDeszka: ${pct(h[i].sat.plank)}\nÁram: ${pct(h[i].sat.power)} (${formatPower(h[i].powerSupply)} / ${formatPower(h[i].powerDemand)})`
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
