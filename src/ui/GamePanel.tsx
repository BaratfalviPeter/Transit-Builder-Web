/**
 * GamePanel — the side panel's "Játék" tab: save now, when it was last
 * saved (autosave), and starting a new game (with a confirmation step).
 */

import { useState } from 'react';
import { useSave } from '../sim';

const timeOf = (ms: number) =>
  new Date(ms).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function GamePanel() {
  const { saveNow, newGame, lastSaved } = useSave();
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);

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
