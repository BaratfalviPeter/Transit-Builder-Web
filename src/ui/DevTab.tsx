/**
 * DevTab — the side panel's developer tab: opens the "Látvány" tuner and runs
 * the model editor (pick a part of an industry model, move / rotate / scale
 * it, the change is written into the model's .tsx source — see
 * src/dev/ModelEditor.tsx and dev/modelEditorPlugin.ts).
 */

import { useGame } from '../sim';
import { nudge } from '../dev/ModelEditor';
import {
  EDITOR_AVAILABLE,
  MOVE_STEPS,
  setEditorOn,
  setIndex,
  setMode,
  setStep,
  setVisualOpen,
  undoEdit,
  useDev,
  type GizmoMode,
} from '../dev/modelEditorStore';
import './devTab.css';

const MODES: Array<{ id: GizmoMode; label: string; key: string }> = [
  { id: 'translate', label: 'Mozgatás', key: '1' },
  { id: 'rotate', label: 'Forgatás', key: '2' },
  { id: 'scale', label: 'Méretezés', key: '3' },
];

export function DevTab() {
  const dev = useDev();
  const game = useGame();
  const info = dev.chain[dev.index];

  const toggleEditor = () => {
    const on = !dev.editorOn;
    // Clicks on the map must not build anything while picking models.
    if (on) game.setActiveTool('select');
    setEditorOn(on);
  };

  const axes =
    !info
      ? [false, false, false]
      : dev.mode === 'translate'
        ? [!!info.canMove, !!info.canMove, !!info.canMove]
        : dev.mode === 'scale'
          ? (info.scaleAxes ?? [false, false, false])
          : (info.rotateAxes ?? [false, false, false]);

  return (
    <>
      <button
        type="button"
        className={'panel__tool' + (dev.visualOpen ? ' is-active' : '')}
        onClick={() => setVisualOpen(!dev.visualOpen)}
      >
        <span className="panel__tool-icon" aria-hidden>
          🎨
        </span>
        <span className="panel__tool-label">Látvány beállítás</span>
      </button>

      <button
        type="button"
        className={'panel__tool' + (dev.editorOn ? ' is-active' : '') + (EDITOR_AVAILABLE ? '' : ' is-disabled')}
        onClick={EDITOR_AVAILABLE ? toggleEditor : undefined}
      >
        <span className="panel__tool-icon" aria-hidden>
          🛠️
        </span>
        <span className="panel__tool-label">Modellszerkesztő</span>
      </button>

      {!EDITOR_AVAILABLE && (
        <div className="panel__hint">A modellszerkesztő csak fejlesztői módban (npm run dev) működik, mert a forrásfájlokba ír.</div>
      )}

      {dev.editorOn && (
        <div className="dev">
          {!info && <div className="panel__hint">Kattints egy ipari épület egy elemére a kijelöléshez.</div>}

          {info && (
            <>
              <div className="dev__crumbs">
                <button type="button" disabled={dev.index >= dev.chain.length - 1} onClick={() => setIndex(dev.index + 1)} title="Szülő elem (PageUp)">
                  ▲ Szülő
                </button>
                <span>
                  {dev.index + 1} / {dev.chain.length}
                </span>
                <button type="button" disabled={dev.index <= 0} onClick={() => setIndex(dev.index - 1)} title="Gyerek elem (PageDown)">
                  ▼ Gyerek
                </button>
              </div>

              {info.error ? (
                <div className="dev__warn">{info.error}</div>
              ) : (
                <>
                  <div className="dev__where">
                    <b>&lt;{info.tag}&gt;</b> {info.file?.replace(/^src\/render\//, '')}:{info.line}
                  </div>
                  <code className="dev__code">{info.code}</code>
                  {info.repeated && <div className="dev__warn">Ciklusban generált elem: minden példánya együtt változik.</div>}
                  {!!info.owner && (info.ownerUses ?? 0) > 1 && (
                    <div className="dev__warn">
                      A(z) &lt;{info.owner}&gt; belsejében van, ami {info.ownerUses} helyen szerepel: mindegyikben változik.
                    </div>
                  )}
                </>
              )}

              <div className="dev__modes">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={dev.mode === m.id ? 'is-active' : ''}
                    onClick={() => setMode(m.id)}
                    title={`Gyorsbillentyű: ${m.key}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {dev.mode === 'translate' && (
                <label className="dev__step">
                  Lépés
                  <select value={dev.step} onChange={(e) => setStep(Number(e.target.value))}>
                    {MOVE_STEPS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {axes.some(Boolean) ? (
                <div className="dev__nudge">
                  {(['X', 'Y', 'Z'] as const).map((a, i) => (
                    <div key={a} className={'dev__axis dev__axis--' + a.toLowerCase()}>
                      <button type="button" disabled={!axes[i] || dev.busy} onClick={() => nudge(i as 0 | 1 | 2, -1)}>
                        −
                      </button>
                      <span>{a}</span>
                      <button type="button" disabled={!axes[i] || dev.busy} onClick={() => nudge(i as 0 | 1 | 2, 1)}>
                        +
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dev__warn">Ezt az elemet így nem lehet állítani — próbáld a szülő vagy a gyerek elemét.</div>
              )}
            </>
          )}

          <div className="dev__row">
            <button type="button" onClick={() => void undoEdit()} title="Ctrl+Z">
              ↶ Visszavonás
            </button>
          </div>
          {dev.status && <div className="dev__status">{dev.status}</div>}
          <div className="panel__hint">
            Húzd a fogantyút, elengedéskor a változás a .tsx fájlba íródik. 1/2/3: mód · PageUp/PageDown: szülő/gyerek · Esc: kijelölés törlése
          </div>
        </div>
      )}
    </>
  );
}
