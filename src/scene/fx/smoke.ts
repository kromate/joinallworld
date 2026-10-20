/**
 * OWNER: scenes
 * Smoke, drawn: ONE instanced mesh of camera-facing soft discs, one draw call, for every source in the scene (grills, a running generator). The
 * vertex shader evaluates smoke-plan.ts's puffAt() for `gl_InstanceID`; nothing is stored or stepped per puff. Normal blending, no depth write.
 * BATTERY RULE: `step(dt)` only moves the seconds, inside the scene's wake window; `settle()` is the still frame for reduced motion.
 */
import type * as THREE from 'three'
import type { ThreeModule } from '../types.ts'
import { MAX_SOURCES, PUFFS, SMOKE } from './smoke-plan.ts'
import type { SmokeSource } from './smoke-plan.ts'
import type { RainTier } from './rain-plan.ts'

export const STILL_SMOKE_SECONDS = 2.1
/** A kind's number for the grill and for the generator, as the pair the shader mixes by the source's kind. */
const both = (field: 'life' | 'rise' | 'alpha' | 'grey'): [number, number] => [SMOKE.grill[field], SMOKE.generator[field]]

const VERTEX = /* glsl */ `
uniform float uTime, uPer, uLevel;
uniform vec2 uWind;
uniform vec4 uSrc[${MAX_SOURCES}];
uniform vec2 uLife, uRise, uAlpha, uGrey, uSize0, uSize1;
varying float vA;
varying vec2 vUv;
varying float vGrey;
float hash(float n, float seed) { return fract(sin(n * 12.9898 + seed * 78.233) * 43758.5453); }
void main() {
  float id = float(gl_InstanceID);
  float e = floor(id / uPer), n = id - e * uPer;
  vec4 s = uSrc[int(e)];
  float m = s.w;
  float life = mix(uLife.x, uLife.y, m);
  float t = uTime / life + n / uPer, age = fract(t), cycle = floor(t);
  vec2 j = vec2(hash(n + cycle * 7.0, e + 3.0), hash(n + cycle * 7.0, e + 5.0)) - 0.5;
  float spread = 0.5 * (1.0 - age * 0.5), lean = age * life * 0.35;
  vec3 p = vec3(s.x + j.x * spread + uWind.x * lean + sin(t * 2.1 + n) * 0.25 * age, s.y + age * mix(uRise.x, uRise.y, m), s.z + j.y * spread + uWind.y * lean);
  float size = mix(mix(uSize0.x, uSize0.y, m), mix(uSize1.x, uSize1.y, m), age);
  float rise = smoothstep(0.0, 0.08, age);
  vA = (1.0 - age) * (1.0 - age) * rise * mix(uAlpha.x, uAlpha.y, m);
  vGrey = mix(uGrey.x, uGrey.y, m) * uLevel;
  vUv = position.xy + 0.5;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 pos = p + (right * position.x + up * position.y) * size;
  gl_Position = vA <= 0.003 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`
const FRAGMENT = /* glsl */ `
varying float vA;
varying vec2 vUv;
varying float vGrey;
void main() { gl_FragColor = vec4(vec3(vGrey), vA * smoothstep(0.5, 0.1, length(vUv - 0.5))); }
`

export interface Smoke {
  readonly mesh: THREE.Mesh
  readonly drawCalls: 1
  readonly sources: number
  readonly seconds: number
  /** Brightness of the day: 1 by day, less at dusk and night. */
  setLevel(level: number): void
  step(dt: number): void
  settle(): void
  dispose(): void
}

/** Smoke from `sources` (at most four) at the tier's puff count. Returns null when there is nothing to smoke. */
export function createSmoke({ THREE, parent, tier, sources, wind = [3.3, 1.35] }: { THREE: ThreeModule; parent: THREE.Object3D; tier: RainTier; sources: readonly SmokeSource[]; wind?: readonly [number, number] }): Smoke | null {
  const list = sources.slice(0, MAX_SOURCES)
  if (!list.length) return null
  const per = PUFFS[tier] ?? PUFFS.wide
  const quad = new THREE.BufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = quad.index
  geometry.setAttribute('position', quad.getAttribute('position'))
  geometry.instanceCount = list.length * per
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9)
  const pair = (values: [number, number]) => ({ value: new THREE.Vector2(values[0], values[1]) })
  const src = Array.from({ length: MAX_SOURCES }, (_, i) => new THREE.Vector4(list[i]?.x ?? 0, list[i]?.y ?? 0, list[i]?.z ?? 0, list[i]?.kind === 'generator' ? 1 : 0))
  const uniforms = {
    uTime: { value: STILL_SMOKE_SECONDS }, uPer: { value: per }, uLevel: { value: 1 }, uWind: { value: new THREE.Vector2(wind[0], wind[1]) }, uSrc: { value: src },
    uLife: pair(both('life')), uRise: pair(both('rise')), uAlpha: pair(both('alpha')), uGrey: pair(both('grey')),
    uSize0: pair([SMOKE.grill.size[0], SMOKE.generator.size[0]]), uSize1: pair([SMOKE.grill.size[1], SMOKE.generator.size[1]]),
  }
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'smoke'; mesh.frustumCulled = false; mesh.renderOrder = 6
  parent.add(mesh)
  let seconds = STILL_SMOKE_SECONDS, gone = false
  return {
    mesh, drawCalls: 1, sources: list.length,
    get seconds() { return seconds },
    setLevel(level) { uniforms.uLevel.value = level },
    step(dt) { if (gone || !(dt > 0)) return; seconds += dt; uniforms.uTime.value = seconds },
    settle() { seconds = STILL_SMOKE_SECONDS; uniforms.uTime.value = seconds },
    dispose() { if (gone) return; gone = true; mesh.parent?.remove(mesh); geometry.dispose(); quad.dispose(); material.dispose() },
  }
}
