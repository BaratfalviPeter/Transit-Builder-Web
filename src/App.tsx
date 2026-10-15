import { TerrainProvider } from './sim/useTerrain';
import { GameProvider } from './sim/useGameState';
import { GameCanvas } from './render/GameCanvas';
import { Hud } from './ui/Hud';
import { Toolbar } from './ui/Toolbar';

/**
 * App root. Providers own the single simulation instances, shared between the
 * 3D canvas and the DOM overlays:
 *   - TerrainProvider: the 61×61 map + roads/industries.
 *   - GameProvider: the active build tool and the player's money.
 * The canvas fills the viewport; the HUD and toolbar overlay on top.
 */
export default function App() {
  return (
    <TerrainProvider options={{ size: 61 }}>
      <GameProvider startingMoney={1000}>
        <GameCanvas />
        <Hud />
        <Toolbar />
      </GameProvider>
    </TerrainProvider>
  );
}
