/**
 * CameraRig — RTS-style camera controls built on drei's <MapControls>.
 *
 * MapControls gives the classic strategy-game feel:
 *   - Left drag  => pan across the ground plane
 *   - Right drag => rotate / orbit
 *   - Wheel      => zoom
 *
 * On top of that we add smooth, continuous WASD / arrow-key panning. A useFrame
 * loop reads the current keyboard state each frame and slides BOTH the camera
 * position and the controls' target along the X/Z plane, so the view pans
 * without changing zoom or angle. Panning is aligned to the camera's facing
 * direction (projected onto the ground), so "W" always moves "forward" on
 * screen regardless of how the camera is rotated.
 */

import { MapControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';

/** Pan speed in world units per second (at 60fps baseline). */
const PAN_SPEED = 70;

export function CameraRig() {
  const controlsRef = useRef<MapControlsImpl | null>(null);
  const camera = useThree((s) => s.camera);

  // Track which movement keys are currently held.
  const keys = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const map = (code: string): keyof typeof keys.current | null => {
      switch (code) {
        case 'KeyW':
        case 'ArrowUp':
          return 'forward';
        case 'KeyS':
        case 'ArrowDown':
          return 'back';
        case 'KeyA':
        case 'ArrowLeft':
          return 'left';
        case 'KeyD':
        case 'ArrowRight':
          return 'right';
        default:
          return null;
      }
    };
    const down = (e: KeyboardEvent) => {
      // Don't steal keys while typing in a UI field (e.g. the visual tuner).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = map(e.code);
      if (k) {
        keys.current[k] = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map(e.code);
      if (k) keys.current[k] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Reused scratch vectors (avoid per-frame allocation).
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const { forward: f, back: b, left: l, right: r } = keys.current;
    const dz = (f ? 1 : 0) - (b ? 1 : 0);
    const dx = (r ? 1 : 0) - (l ? 1 : 0);
    if (dx === 0 && dz === 0) return;

    // Camera forward projected onto the ground plane (ignore Y).
    forward.current
      .set(0, 0, 0)
      .subVectors(controls.target, camera.position);
    forward.current.y = 0;
    if (forward.current.lengthSq() < 1e-6) forward.current.set(0, 0, -1);
    forward.current.normalize();
    // Right = forward × up.
    right.current.crossVectors(forward.current, new THREE.Vector3(0, 1, 0));

    move.current
      .set(0, 0, 0)
      .addScaledVector(forward.current, dz)
      .addScaledVector(right.current, dx);
    if (move.current.lengthSq() > 1e-6) {
      move.current.normalize().multiplyScalar(PAN_SPEED * delta);
      camera.position.add(move.current);
      controls.target.add(move.current);
      controls.update();
    }
  });

  // Free the LEFT mouse button for building (no camera grab on left-drag).
  // MIDDLE zooms (dolly), RIGHT rotates/orbits. Panning is done with WASD.
  const mouseButtons = useMemo(
    () => ({
      LEFT: null as unknown as THREE.MOUSE, // disabled; left = build/drag
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    }),
    [],
  );

  return (
    <MapControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      mouseButtons={mouseButtons}
      // Keep the camera above the horizon so you always look down onto the map.
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={2.5}
      maxDistance={260}
      // Pan in the screen plane feels more natural for a top-down builder.
      screenSpacePanning={false}
    />
  );
}
