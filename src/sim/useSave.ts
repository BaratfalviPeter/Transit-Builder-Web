/**
 * SaveProvider — saving / loading the game (save.ts) in the browser:
 *   - on start: continue the stored game, if there is one;
 *   - autosave every AUTOSAVE_MS, and when the tab is hidden / closed;
 *   - `useSave()`: save now, start a new game, when it was last saved.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearSave, mapOf, readSave, writeSave } from './save';
import { useCity } from './useCityDevelopment';
import { useGame } from './useGameState';
import { selection } from './selection';
import { useInteriorStore } from './useInterior';
import { useTerrainStore } from './useTerrain';
import { useTransport } from './useTransport';

/** Real ms between autosaves. */
const AUTOSAVE_MS = 60_000;

export interface SaveApi {
  /** Save right now; false if the browser refused. */
  saveNow(): boolean;
  /** Throw the current game away: a new map, empty network, starting money. */
  newGame(): void;
  /** Real time of the last save / load (ms), or null. */
  lastSaved: number | null;
}

const Ctx = createContext<SaveApi | null>(null);

export function SaveProvider({ children }: { children: ReactNode }) {
  const terrain = useTerrainStore();
  const game = useGame();
  const transport = useTransport();
  const city = useCity();
  const interiors = useInteriorStore();
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const saveNow = useCallback(() => {
    const ok = writeSave({
      map: terrain.getMap(),
      lines: transport.getSnapshot().lines,
      game: game.exportState(),
      city: city.exportState(),
      production: interiors.production.exportState(),
    });
    if (ok) setLastSaved(Date.now());
    return ok;
  }, [terrain, transport, game, city, interiors]);

  const newGame = useCallback(() => {
    clearSave();
    terrain.regenerate({ size: terrain.getMap().size });
    city.reset(terrain.getMap());
    transport.reset([]);
    game.importState(null);
    interiors.production.importState(null);
    selection.set(null);
    setLastSaved(null);
  }, [terrain, transport, game, city, interiors]);

  // Continue the stored game (once, on start).
  useEffect(() => {
    const s = readSave();
    if (!s) return;
    try {
      terrain.load(mapOf(s));
      city.importState(s.city, terrain.getMap());
      transport.reset(s.lines);
      game.importState(s.game);
      interiors.production.importState(s.production);
      setLastSaved(s.savedAt);
    } catch (e) {
      // A broken save: drop it and start fresh rather than not starting at all.
      console.error('Hibás mentés, új játék indul', e);
      newGame();
    }
  }, [terrain, transport, game, city, interiors, newGame]);

  // Autosave: on a timer, and when the tab goes away.
  useEffect(() => {
    const id = setInterval(saveNow, AUTOSAVE_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveNow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveNow);
    };
  }, [saveNow]);

  const api = useMemo(() => ({ saveNow, newGame, lastSaved }), [saveNow, newGame, lastSaved]);
  return createElement(Ctx.Provider, { value: api }, children);
}

export function useSave(): SaveApi {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSave must be used within a <SaveProvider>');
  return s;
}
