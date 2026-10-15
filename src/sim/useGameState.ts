/**
 * React bindings for the pure `GameState` (active tool + money).
 *
 * `GameProvider` creates one GameState and shares it so the toolbar, the HUD,
 * and the canvas click handler all read/mutate the same state.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { GameState, type GameSnapshot } from './GameState';

const GameContext = createContext<GameState | null>(null);

export function GameProvider({
  children,
  startingMoney = 1000,
}: {
  children: ReactNode;
  startingMoney?: number;
}) {
  const game = useMemo(() => new GameState(startingMoney), [startingMoney]);
  return createElement(GameContext.Provider, { value: game }, children);
}

export function useGame(): GameState {
  const game = useContext(GameContext);
  if (!game) {
    throw new Error('useGame must be used within a <GameProvider>');
  }
  return game;
}

/** Subscribe to the game snapshot (active tool + money). */
export function useGameSnapshot(): GameSnapshot {
  const game = useGame();
  return useSyncExternalStore(
    (onChange) => game.subscribe(onChange),
    () => game.getSnapshot(),
  );
}
