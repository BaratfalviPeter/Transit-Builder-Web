import { WorldProvider } from './sim/useWorld';
import { GameCanvas } from './render/GameCanvas';
import { Hud } from './ui/Hud';

/**
 * App root. The WorldProvider owns the single simulation instance; both the
 * 3D canvas and the HUD read from it. The canvas fills the viewport and the
 * HUD overlays on top.
 */
export default function App() {
  return (
    <WorldProvider>
      <GameCanvas />
      <Hud />
    </WorldProvider>
  );
}
