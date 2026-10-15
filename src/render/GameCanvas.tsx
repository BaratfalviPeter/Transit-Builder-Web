/**
 * GameCanvas — the root R3F scene.
 *
 * Composes the camera rig, lighting, grid floor, and placed buildings.
 * Floor clicks are snapped to the nearest grid cell and forwarded to the
 * simulation (World.place). The World is the authority on occupancy — one
 * object per cell — so clicking an occupied cell is a no-op there.
 */

import { Canvas } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useCallback } from 'react';
import { DEFAULT_CONFIG } from './config';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { Buildings } from './Buildings';
import { useWorld, worldToCell } from '../sim';

function Scene() {
  const world = useWorld();
  const { cellSize, gridHalfExtent } = DEFAULT_CONFIG;

  const handleFloorClick = useCallback(
    (x: number, z: number) => {
      const coord = worldToCell(x, z, cellSize);
      // Clamp to the grid bounds so you can't place beyond the visible floor.
      if (
        Math.abs(coord.cx) > gridHalfExtent ||
        Math.abs(coord.cz) > gridHalfExtent
      ) {
        return;
      }
      world.place('house', coord);
    },
    [world, cellSize, gridHalfExtent],
  );

  return (
    <>
      <CameraRig />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Sky sunPosition={[30, 50, 20]} />

      <GridFloor
        cellSize={cellSize}
        gridHalfExtent={gridHalfExtent}
        onFloorClick={handleFloorClick}
      />

      <Buildings cellSize={cellSize} />
    </>
  );
}

export function GameCanvas() {
  return (
    <Canvas
      shadows
      camera={{ position: [40, 40, 40], fov: 50, near: 0.1, far: 1000 }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#adc8e6']} />
      <Scene />
    </Canvas>
  );
}
