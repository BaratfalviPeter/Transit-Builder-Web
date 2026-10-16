/**
 * VisualTuner — in-game "Látvány" panel with sliders / colour pickers for every
 * light and colour value (see render/visualSettings.ts).
 *
 * Changes apply live. Values persist in localStorage. "Másolás" copies all
 * values as JSON (paste it back to the developer to bake in as defaults);
 * "Beillesztés" loads a JSON; "Alapértékek" resets everything.
 */

import { useState } from 'react';
import {
  VISUAL_DEFAULTS,
  resetVisual,
  setVisual,
  setVisualAll,
  useVisual,
  type VisualKey,
  type VisualSettings,
} from '../render/visualSettings';
import './visualTuner.css';

type Ctl =
  | { k: VisualKey; label: string; type: 'range'; min: number; max: number; step: number }
  | { k: VisualKey; label: string; type: 'color' }
  | { k: VisualKey; label: string; type: 'bool' };

const r = (k: VisualKey, label: string, min: number, max: number, step: number): Ctl => ({
  k,
  label,
  type: 'range',
  min,
  max,
  step,
});
const c = (k: VisualKey, label: string): Ctl => ({ k, label, type: 'color' });
const b = (k: VisualKey, label: string): Ctl => ({ k, label, type: 'bool' });

const SECTIONS: Array<{ title: string; ctls: Ctl[] }> = [
  {
    title: 'Nap',
    ctls: [
      r('sunIntensity', 'Erősség', 0, 6, 0.05),
      c('sunColor', 'Szín'),
      r('sunAzimuth', 'Irány (°)', 0, 360, 1),
      r('sunElevation', 'Magasság (°)', 5, 90, 1),
      r('shadowBias', 'Árnyék bias', -0.005, 0.005, 0.0001),
      r('shadowNormalBias', 'Árnyék normal bias', 0, 0.3, 0.005),
      b('liveShadows', 'Élő árnyék (felhő/madár)'),
    ],
  },
  {
    title: 'Környezeti fény',
    ctls: [
      r('ambientIntensity', 'Ambient erősség', 0, 2, 0.01),
      c('ambientColor', 'Ambient szín'),
      r('hemiIntensity', 'Ég/föld erősség', 0, 2, 0.01),
      c('hemiSky', 'Ég szín'),
      c('hemiGround', 'Föld szín'),
      r('exposure', 'Expozíció', 0.2, 2.5, 0.01),
      c('background', 'Háttér (ég)'),
    ],
  },
  {
    title: 'Terep',
    ctls: [
      c('grass1', 'Fű 1'),
      c('grass2', 'Fű 2'),
      c('grass3', 'Fű 3'),
      c('grass4', 'Fű 4'),
      r('grassWobble', 'Lapok fényerő-szórása', 0, 0.4, 0.005),
      c('hill1', 'Domb 1'),
      c('hill2', 'Domb 2'),
      c('hill3', 'Domb 3'),
      c('forestFloor', 'Erdő talaj'),
      c('water', 'Víz'),
      c('cliff', 'Oldalfal (föld)'),
      c('city', 'Város alap'),
      r('terrainRoughness', 'Matt ↔ fényes', 0, 1, 0.01),
    ],
  },
  {
    title: 'Rács',
    ctls: [b('gridVisible', 'Rács látszik'), c('gridCell', 'Cella vonal'), c('gridSection', 'Szekció vonal')],
  },
  {
    title: 'Utak',
    ctls: [r('roadCornerAngle', 'Kanyarvonal szöge (°)', 20, 140, 1)],
  },
  {
    title: 'Fák és sziklák',
    ctls: [
      c('tree1', 'Fa 1'),
      c('tree2', 'Fa 2'),
      c('tree3', 'Fa 3'),
      c('tree4', 'Fa 4'),
      c('tree5', 'Fa 5'),
      r('treeTipLight', 'Fa csúcs világosítás', 0, 0.4, 0.01),
      c('trunk', 'Törzs'),
      c('rock1', 'Szikla 1'),
      c('rock2', 'Szikla 2'),
      c('rock3', 'Szikla 3'),
      c('rock4', 'Szikla 4'),
    ],
  },
  {
    title: 'Felhők',
    ctls: [
      b('cloudsVisible', 'Felhők látszanak'),
      b('cloudShadows', 'Felhő árnyék'),
      r('cloudShadowStrength', 'Felhő árnyék erősség', 0, 1, 0.01),
      c('cloudColor', 'Szín'),
      r('cloudGlow', 'Világítás', 0, 1, 0.01),
      r('cloudCount', 'Darabszám', 0, 20, 1),
      r('cloudSpeed', 'Sebesség', 0, 5, 0.05),
    ],
  },
  {
    title: 'Madarak',
    ctls: [
      b('birdsVisible', 'Madarak látszanak'),
      r('birdFlocks', 'Csapatok száma', 0, 20, 1),
      c('birdColor', 'Szín'),
      r('birdSpeed', 'Sebesség', 0, 3, 0.05),
    ],
  },
];

function fmt(v: number, step: number): string {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(d);
}

export function VisualTuner() {
  const [open, setOpen] = useState(false);
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ Nap: true });
  const [msg, setMsg] = useState('');
  const v = useVisual();

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 1800);
  };

  const copy = async () => {
    const json = JSON.stringify(v, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      flash('Kimásolva ✓');
    } catch {
      window.prompt('Másold ki:', json);
    }
  };
  const paste = () => {
    const txt = window.prompt('Illeszd be a JSON-t:');
    if (!txt) return;
    try {
      setVisualAll(JSON.parse(txt) as Partial<VisualSettings>);
      flash('Betöltve ✓');
    } catch {
      flash('Hibás JSON');
    }
  };

  if (!open) {
    return (
      <button className="vt__toggle" onClick={() => setOpen(true)}>
        🎨 Látvány
      </button>
    );
  }

  return (
    <div className="vt" onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="vt__head">
        <span>🎨 Látvány beállítás</span>
        <button className="vt__x" onClick={() => setOpen(false)} title="Bezárás">
          ✕
        </button>
      </div>
      <div className="vt__actions">
        <button onClick={copy}>Másolás</button>
        <button onClick={paste}>Beillesztés</button>
        <button onClick={() => resetVisual()}>Alapértékek</button>
        {msg && <span className="vt__msg">{msg}</span>}
      </div>
      <div className="vt__body">
        {SECTIONS.map((sec) => {
          const isOpen = !!openSec[sec.title];
          return (
            <div key={sec.title} className="vt__sec">
              <button
                className="vt__sechead"
                onClick={() => setOpenSec((o) => ({ ...o, [sec.title]: !isOpen }))}
              >
                {isOpen ? '▾' : '▸'} {sec.title}
              </button>
              {isOpen &&
                sec.ctls.map((ctl) => {
                  const val = v[ctl.k];
                  const changed = val !== VISUAL_DEFAULTS[ctl.k];
                  return (
                    <label key={ctl.k} className={`vt__row${changed ? ' vt__row--changed' : ''}`}>
                      <span className="vt__label">{ctl.label}</span>
                      {ctl.type === 'range' && (
                        <>
                          <input
                            type="range"
                            min={ctl.min}
                            max={ctl.max}
                            step={ctl.step}
                            value={val as number}
                            onChange={(e) => setVisual(ctl.k, Number(e.target.value) as never)}
                          />
                          <input
                            key={String(val)}
                            className="vt__num"
                            type="number"
                            step={ctl.step}
                            defaultValue={fmt(val as number, ctl.step)}
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n)) setVisual(ctl.k, n as never);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </>
                      )}
                      {ctl.type === 'color' && (
                        <>
                          <input
                            type="color"
                            value={val as string}
                            onChange={(e) => setVisual(ctl.k, e.target.value as never)}
                          />
                          <input
                            key={String(val)}
                            className="vt__hex"
                            type="text"
                            defaultValue={val as string}
                            onChange={(e) => {
                              const t = e.target.value.trim();
                              if (/^#[0-9a-fA-F]{6}$/.test(t)) setVisual(ctl.k, t.toLowerCase() as never);
                            }}
                          />
                        </>
                      )}
                      {ctl.type === 'bool' && (
                        <input
                          type="checkbox"
                          checked={val as boolean}
                          onChange={(e) => setVisual(ctl.k, e.target.checked as never)}
                        />
                      )}
                    </label>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
