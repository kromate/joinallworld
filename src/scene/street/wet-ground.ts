/**
 * OWNER: scenes
 * A wet street: when it rains, the road and the pavements admit it. One uniform (`uWet`, 0 or 1) on the material that draws the street's
 * flat ground, no new pass and no new draw call, on both tiers. Where the ground is (an upward face lower than 0.2 units, inside the
 * band of road and pavements) the shader:
 *   darkens the colour by 35%            wet stone is darker than dry
 *   lowers the roughness to 0.4          a glossier surface (the standard material only; a matte-scenery build has no roughness to lower)
 *   adds a sheen of the sky's colour     strongest where the ground is seen at a low angle, as a wet road is, so the road far down the
 *                                         street takes the sky and the lamps' pools shine
 * `setWet(false)` puts it all back. Pure strings and one small function: the scene owns the material and frees it.
 */
import type * as THREE from 'three';

/** The share the colour keeps when wet, the roughness a wet surface has, and how strong the sky's sheen is. */
export const WET_DARKEN = 0.35, WET_ROUGHNESS = 0.4, WET_SHEEN = 0.5;

const VERTEX_PARS = /* glsl */`
varying vec3 vWetPos;
varying float vWetUp;
`;
const VERTEX_BODY = /* glsl */`
#include <begin_vertex>
vWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWetUp = normalize(mat3(modelMatrix) * objectNormal).y;
`;
const FRAGMENT_PARS = /* glsl */`
uniform float uWet;
uniform vec3 uWetSky;
uniform vec2 uWetZ;
varying vec3 vWetPos;
varying float vWetUp;
float wetMask() {
  return uWet * step(0.9, vWetUp) * step(vWetPos.y, 0.2) * step(uWetZ.x, vWetPos.z) * (1.0 - step(uWetZ.y, vWetPos.z));
}
`;
const COLOUR = /* glsl */`
#include <color_fragment>
diffuseColor.rgb *= 1.0 - ${WET_DARKEN.toFixed(2)} * wetMask();
`;
const ROUGHNESS = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, ${WET_ROUGHNESS.toFixed(2)}, wetMask());
`;
const SHEEN = /* glsl */`
#include <emissivemap_fragment>
{
  float wetView = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uWetSky * (${WET_SHEEN.toFixed(2)} * pow(1.0 - wetView, 3.0) * wetMask());
}
`;

export interface WetGround {
  /** Wet or dry, with the colour of the sky's horizon the sheen takes. */
  setWet(wet: boolean, sky?: string): void
  readonly wet: boolean
}

/**
 * Add the wet look to `material` (a vertex-coloured street material). Chained after any patch already on it (the host's see-through
 * circle), so call it after `kit.adopt(material)`. `band` is the range of z the ground lies in: from the near pavement's edge to the far one's.
 */
export function makeWetGround(THREE: typeof import('three'), material: THREE.Material, band: readonly [number, number]): WetGround {
  const uniforms = { uWet: { value: 0 }, uWetSky: { value: new THREE.Color('#8d9db1') }, uWetZ: { value: new THREE.Vector2(band[0], band[1]) } };
  const before = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.uWet = uniforms.uWet; shader.uniforms.uWetSky = uniforms.uWetSky; shader.uniforms.uWetZ = uniforms.uWetZ;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', COLOUR).replace('#include <roughnessmap_fragment>', ROUGHNESS).replace('#include <emissivemap_fragment>', SHEEN);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|street-wet-ground-1`;
  material.needsUpdate = true;
  let wet = false;
  return {
    setWet(next, sky) {
      wet = next; uniforms.uWet.value = next ? 1 : 0;
      if (sky) uniforms.uWetSky.value.set(sky).multiplyScalar(0.55);
    },
    get wet() { return wet; },
  };
}
