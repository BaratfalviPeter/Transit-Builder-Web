/**
 * GamePanel — the side panel's "Játék" tab: save now, when it was last
 * saved (autosave), starting a new game (with a confirmation step), the
 * settings (graphics, camera, zoom towards the mouse) and feedback.
 */

import { useState } from 'react';
import { useCitySnapshot, useGameSnapshot, useSave, useTransportSnapshot } from '../sim';
import { QUALITY_LABEL, setQuality, useQuality, type QualityPreset } from '../render/quality';
import { CAMERA_SENS_MAX, CAMERA_SENS_MIN, setCameraSens, setZoomToCursor, useCameraSens, useZoomToCursor } from '../render/cameraSettings';
import { feedbackUrl } from './feedback';
import { resetTutorial } from './Tutorial';

const timeOf = (ms: number) =>
  new Date(ms).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function GamePanel() {
  const { saveNow, newGame, lastSaved } = useSave();
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);
  const quality = useQuality();
  const camSens = useCameraSens();
  const zoomCursor = useZoomToCursor();

  return (
    <div className="fin">
      <div className="ui-stat">
        <span>Utolsó mentés</span>
        <b>{lastSaved ? timeOf(lastSaved) : '—'}</b>
      </div>
      <button type="button" onClick={() => setFailed(!saveNow())}>
        💾 Mentés most
      </button>
      {failed && <div className="fin__warn">A böngésző nem engedte a mentést (megtelt vagy le van tiltva a tárhely).</div>}
      <div className="ui-note">
        A játék magától is ment percenként és a lap bezárásakor, ebbe a böngészőbe. Legközelebb innen folytatod. A járművek a betöltés
        után a megállóikból indulnak újra.
      </div>

      <div className="fin__head">⚙️ Beállítások</div>
      <div className="set__row set__row--stack" title="Alacsonyabb fokozat = gyorsabb, kevésbé melegszik a gép (érdemes, ha akad a játék)">
        <span>Grafika</span>
        <div className="set__modes">
          {(Object.keys(QUALITY_LABEL) as QualityPreset[]).map((id) => (
            <button key={id} type="button" className={quality.preset === id ? 'is-on' : ''} onClick={() => setQuality(id)}>
              {QUALITY_LABEL[id]}
            </button>
          ))}
        </div>
      </div>
      <label className="set__row" title="Kamera sebessége: WASD mozgatás, forgatás, zoom">
        <span>Kamera</span>
        <input type="range" min={CAMERA_SENS_MIN} max={CAMERA_SENS_MAX} step={0.05} value={camSens} onChange={(e) => setCameraSens(Number(e.target.value))} />
        <b>{Math.round(camSens * 100)}%</b>
      </label>
      <label className="set__check">
        <input type="checkbox" checked={zoomCursor} onChange={(e) => setZoomToCursor(e.target.checked)} />
        Görgővel az egér felé zoomol
      </label>
      <div className="ui-note">A játék sebessége a bal felső sávban állítható (⏸ ▶ ⏩), vagy Szóköz (szünet) és T (gyorsítás).</div>

      <div className="fin__head">💬 Visszajelzés</div>
      <Feedback />

      <div className="fin__head">Új játék</div>
      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)}>
          🗺️ Új játék (új térkép)
        </button>
      ) : (
        <>
          <div className="fin__warn">Biztos? Az eddigi játék (és a mentése) elvész.</div>
          <div className="fin__loanrow">
            <button
              type="button"
              onClick={() => {
                newGame();
                resetTutorial();
                setConfirm(false);
              }}
            >
              Igen, új játék
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Mégse
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The feedback link (a GitHub issue, pre-filled with the game's state). */
export function Feedback({ compact }: { compact?: boolean }) {
  const g = useGameSnapshot();
  const city = useCitySnapshot();
  const { lines } = useTransportSnapshot();
  const href = feedbackUrl({
    date: new Date(g.dateMs).toISOString().slice(0, 10),
    population: city.population,
    money: g.money,
    lines: lines.length,
    vehicles: lines.reduce((a, l) => a + l.vehicles, 0),
  });
  if (compact)
    return (
      <a className="ui-menu__btn ui-menu__btn--feedback" href={href} target="_blank" rel="noreferrer" title="Hiba vagy ötlet? Írd meg! (GitHub-fiók kell)">
        <span aria-hidden>💬</span>
        <span className="ui-menu__label">Visszajelzés</span>
      </a>
    );
  return (
    <>
      <a className="set__feedback" href={href} target="_blank" rel="noreferrer">
        💬 Hiba vagy ötlet? Írd meg!
      </a>
      <div className="ui-note">Új lapon megnyílik egy GitHub-bejelentés, benne a játék állapotával — csak írd le, mi történt. GitHub-fiók kell hozzá.</div>
    </>
  );
}
