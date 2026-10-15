/**
 * CameraRig — RTS-style camera controls built on drei's <MapControls>.
 *
 * MapControls gives us the classic strategy-game feel out of the box:
 *   - Left drag  => pan across the ground plane
 *   - Right drag => rotate / orbit
 *   - Wheel      => zoom
 *
 * We clamp the polar angle so the camera can't flip under the floor, and
 * constrain zoom distance to keep the scene usable.
 */

import { MapControls } from '@react-three/drei';

export function CameraRig() {
  return (
    <MapControls
      makeDefault
      enableDamping
      dampingFactor={0.1}
      // Keep the camera above the horizon so you always look down onto the map.
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={5}
      maxDistance={120}
      // Pan in the screen plane feels more natural for a top-down builder.
      screenSpacePanning={false}
    />
  );
}
