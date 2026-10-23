import { TerrainProvider } from './sim/useTerrain';
import { DEFAULT_MAP_SIZE } from './sim/terrain';
import { GameProvider } from './sim/useGameState';
import { TerraformPlanProvider } from './sim/useTerraformPlan';
import { PathPlanProvider } from './sim/usePathPlan';
import { PathPlanInfo } from './ui/PathPlanInfo';
import { GameCanvas } from './render/GameCanvas';
import { Hud } from './ui/Hud';
import { SidePanel } from './ui/SidePanel';
import { TerraformConfirm } from './ui/TerraformConfirm';
import { VisualTuner } from './ui/VisualTuner';
import { InteriorProvider, ProductionDriver } from './sim/useInterior';
import { InteriorView } from './interior/InteriorView';

/**
 * App root. Providers own the single simulation instances, shared between the
 * 3D canvas and the DOM overlays:
 *   - TerrainProvider: the 121×121 map (finer 2× subdivided grid) + roads/rail/industries + terraforming.
 *   - GameProvider: active tool, money/economy, and the in-game clock.
 *   - TerraformPlanProvider: the pending (select -> confirm -> build) terraform
 *     selection shared by the canvas grids and the confirm panel.
 *   - PathPlanProvider: the two-click (A → B) road/rail route planner shared
 *     by the canvas (input + hologram) and the cost/hint overlay.
 *   - InteriorProvider: industry interiors (micro view) — opened from the map,
 *     shown by <InteriorView>.
 * The canvas fills the viewport; the HUD, SidePanel and confirm panel overlay.
 */
export default function App() {
  return (
    <TerrainProvider options={{ size: DEFAULT_MAP_SIZE }}>
      <GameProvider startingMoney={100000}>
        <TerraformPlanProvider>
          <PathPlanProvider>
            <InteriorProvider>
            <ProductionDriver />
            <GameCanvas />
            <Hud />
            <SidePanel />
            <TerraformConfirm />
            <PathPlanInfo />
            <VisualTuner />
            {/* Micro view: an industry's interior (opened by clicking it). */}
            <InteriorView />
            </InteriorProvider>
          </PathPlanProvider>
        </TerraformPlanProvider>
      </GameProvider>
    </TerrainProvider>
  );
}
