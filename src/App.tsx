import { TerrainProvider } from './sim/useTerrain';
import { GameProvider } from './sim/useGameState';
import { GameCanvas } from './render/GameCanvas';
import { Hud } from './ui/Hud';
import { SidePanel } from './ui/SidePanel';

/**
 * App root. Providers own the single simulation instances, shared between the
 * 3D canvas and the DOM overlays:
 *   - TerrainProvider: the 61×61 map + roads/rail/industries + terraforming.
 *   - GameProvider: active tool, money/economy, and the in-game clock.
 * The canvas fills the viewport; the HUD counters and the SidePanel overlay.
 */
export default function App() {
  return (
    <TerrainProvider options={{ size: 61 }}>
      <GameProvider startingMoney={1000}>
        <GameCanvas />
        <Hud />
        <SidePanel />
      </GameProvider>
    </TerrainProvider>
  );
}
