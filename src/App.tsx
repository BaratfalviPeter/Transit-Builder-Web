import { WorldProvider } from './sim/useWorld';
import { TerrainProvider } from './sim/useTerrain';
import { GameCanvas } from './render/GameCanvas';
import { Hud } from './ui/Hud';

/**
 * App root. Providers own the single simulation instances; both the 3D canvas
 * and the DOM HUD read from them. The TerrainProvider generates the 21×21 map
 * once and is shared so the HUD can show the road count. The canvas fills the
 * viewport and the HUD overlays on top.
 */
export default function App() {
  return (
    <TerrainProvider options={{ size: 21 }}>
      <WorldProvider>
        <GameCanvas />
        <Hud />
      </WorldProvider>
    </TerrainProvider>
  );
}
