/**
 * Cloud shadows WITHOUT re-rendering the shadow map.
 *
 * The sun's shadow map is computed once (static, see ShadowController) for
 * FPS. Moving clouds therefore can't use it — they'd be frozen into it. Instead
 * every cloud puff is projected along the sun direction onto the ground (CPU,
 * once per frame, a few dozen puffs) and passed to the shaders as uniforms.
 * Patched materials darken ONLY their direct sunlight inside those soft
 * ellipses, so ambient/sky light stays — it reads like a real cloud shadow but
 * costs a couple of ALU ops per pixel and zero extra render passes.
 *
 * Usage: `patchCloudShadows(material)` once per material (idempotent).
 */

import * as THREE from 'three';

export const MAX_CLOUD_PUFFS = 64;

/** Shared uniforms (one set for every patched material). */
export const CLOUD_SHADOW_UNIFORMS = {
  /** xy = ground-projected puff centre (world x, z), z = radius, w = unused. */
  uCloudPuffs: { value: Array.from({ length: MAX_CLOUD_PUFFS }, () => new THREE.Vector4()) },
  uCloudCount: { value: 0 },
  /** 0 = no shadow, 1 = full direct-light blockout. */
  uCloudStrength: { value: 0.45 },
};

const PATCHED = new WeakSet<THREE.Material>();

export function patchCloudShadows<T extends THREE.Material>(mat: T): T {
  if (PATCHED.has(mat)) return mat;
  PATCHED.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, CLOUD_SHADOW_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vCloudXZ;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          cw = modelMatrix * cw;
          vCloudXZ = cw.xz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vCloudXZ;
        uniform vec4 uCloudPuffs[${MAX_CLOUD_PUFFS}];
        uniform int uCloudCount;
        uniform float uCloudStrength;
        float cloudShade() {
          // Soft UNION of the puffs: sum each puff's gentle falloff, then
          // saturate with 1-exp(-f). This merges a cloud's puffs into one soft
          // blob (no hard per-puff cores or visible rings), reading like a real
          // drifting cloud shadow instead of separate dark circles.
          float f = 0.0;
          for (int i = 0; i < ${MAX_CLOUD_PUFFS}; i++) {
            if (i >= uCloudCount) break;
            vec4 p = uCloudPuffs[i];
            float d = length(vCloudXZ - p.xy);
            f += 1.0 - smoothstep(p.z * 0.2, p.z * 1.25, d);
          }
          float cover = 1.0 - exp(-f * 1.3);
          return 1.0 - uCloudStrength * cover;
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          float cs = cloudShade();
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
        }`,
      );
  };
  // Different program from unpatched materials with the same params.
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|cloudShadow';
  mat.needsUpdate = true;
  return mat;
}

/** Ref callback for JSX materials: `<meshStandardMaterial ref={patchRef} />`. */
export function patchRef(m: THREE.Material | null): void {
  if (m) patchCloudShadows(m);
}
