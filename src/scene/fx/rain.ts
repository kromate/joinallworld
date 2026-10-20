/**
 * OWNER: scenes
 * Rain, drawn. Two meshes and two draw calls: every raindrop in one instanced mesh of quads, every splash in another. Nothing is stored per drop and
 * nothing is stepped on the CPU: the vertex shader evaluates rain-plan.ts for `gl_InstanceID` and the seconds (a world-anchored lattice that falls
 * with the wind and is wrapped into a box round where the camera looks), stretches the quad along its velocity relative to the camera as if exposed
 * for a 30th of a second, never lets it be thinner than about a pixel (the brightness is kept), fades it near, far and at the cloud base, and does
 * not draw it at all under a roof or awning (the cover grid of cover.ts, uploaded once as a small texture). Splashes crown on open ground.
 *
 * The streets' lights tint the streaks from an optional `lightmap` texture (phase 2 supplies it; until then they are white-grey).
 *
 * BATTERY RULE. This file never asks for a frame. `step(dt)` only moves the seconds, and the host calls it inside the scene's wake window
 * (src/scene/ambient/layer.ts); outside the window the rain stands where it was. `settle()` is the still frame for reduced motion.
 */
import type * as THREE from 'three'
import type { ThreeModule } from '../types.ts'
import { RAIN_COUNT, RAIN_LOOK, SPLASH_COUNT, fieldFor } from './rain-plan.ts'
import type { RainField, RainLight, RainTier } from './rain-plan.ts'
import type { Cover } from './cover.ts'

/** The seconds of the still frame (reduced motion): any time will do; this one has drops all through the box. */
export const STILL_SECONDS = 3.7
/** A splash crown lives this long, and the box they land in is this wide. */
const SPLASH_PERIOD = 0.55, SPLASH_BOX = 36
/** The most the focus is put ahead of the camera, so the camera itself is always inside the box. */
const REACH = 17

const HASH = /* glsl */ `
float hash(float n, float seed) { return fract(sin(n * 12.9898 + seed * 78.233) * 43758.5453); }
`
const COVER = /* glsl */ `
uniform sampler2D uCover;
uniform vec4 uCoverRect;   // x0, z0, 1 / width, 1 / depth
uniform float uCoverCap;
uniform float uHasCover;
float roofAt(vec2 xz) {
  vec2 uv = (xz - uCoverRect.xy) * uCoverRect.zw;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture2D(uCover, uv).r * uCoverCap * inside * uHasCover;
}
`
const LIGHT = /* glsl */ `
uniform sampler2D uLight;
uniform vec4 uLightRect;
uniform float uHasLight;
vec3 lightAt(vec2 xz) { return texture2D(uLight, (xz - uLightRect.xy) * uLightRect.zw).rgb * uHasLight; }
`

const DROP_VERTEX = /* glsl */ `
uniform float uTime, uBox, uHeight, uFall, uSeed, uWidth, uAlpha, uFade;
uniform vec2 uWind;
uniform vec3 uFocus, uCamVel, uTint;
varying float vA;
varying vec3 vC;
varying float vX;
${HASH}${COVER}${LIGHT}
void main() {
  float id = float(gl_InstanceID);
  vec3 h = vec3(hash(id, uSeed), hash(id + 17.1, uSeed), hash(id * 1.37, uSeed + 3.0));
  float speed = 0.85 + 0.3 * hash(id, 9.3);
  vec3 vel = vec3(uWind.x, -uFall, uWind.y) * speed;
  vec3 a = vec3(h.x * uBox, h.y * uHeight, h.z * uBox) + vel * uTime;
  vec3 size = vec3(uBox, uHeight, uBox);
  vec3 half3 = vec3(uBox * 0.5, 0.0, uBox * 0.5);
  vec3 rel = vec3(a.x - uFocus.x, a.y, a.z - uFocus.z);
  vec3 w = fract((rel + half3) / size) * size - half3;
  vec3 p = vec3(uFocus.x + w.x, w.y, uFocus.z + w.z);
  float roof = roofAt(p.xz);
  float covered = step(p.y, roof);
  vec3 relV = vel - uCamVel * 0.85;
  vec3 axis = normalize(relV);
  float len = clamp(length(relV) / 30.0, 0.4, 5.2);
  vec3 toCam = p - cameraPosition;
  float dist = max(length(toCam), 0.001);
  vec3 side = normalize(cross(axis, toCam / dist));
  float width = max(uWidth, dist * 0.0011);
  vec3 pos = p + axis * (position.y * len) + side * (position.x * width);
  float edge = length(p.xz - uFocus.xz);
  float a2 = uAlpha * smoothstep(0.9, 3.75, dist) * smoothstep(uBox * 0.5, uBox * 0.28, edge) * smoothstep(uHeight, uHeight * 0.85, p.y)
    * (uWidth / width) * (1.0 - covered) * uFade;
  float lowness = exp(-(p.y - roof) / 39.0);
  vA = a2;
  vC = uTint + lightAt(p.xz) * (lowness * 2.4 + 0.25);
  vX = position.x;
  gl_Position = a2 <= 0.003 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`
const DROP_FRAGMENT = /* glsl */ `
varying float vA;
varying vec3 vC;
varying float vX;
void main() {
  float across = max(1.0 - abs(vX) * 2.0, 0.0);
  gl_FragColor = vec4(vC, vA * across * across);
}
`
const SPLASH_VERTEX = /* glsl */ `
uniform float uTime, uFade, uSplashBox, uPeriod;
uniform vec3 uFocus, uTint;
varying float vA;
varying vec3 vC;
varying vec2 vUv;
${HASH}${COVER}${LIGHT}
void main() {
  float id = float(gl_InstanceID);
  float t = uTime / uPeriod + hash(id, 5.3);
  float cycle = floor(t), life = fract(t);
  vec2 r = (vec2(hash(id, cycle), hash(cycle, id + 3.3)) - 0.5) * uSplashBox;
  vec2 xz = uFocus.xz + r;
  float open = 1.0 - step(0.001, roofAt(xz));
  vec3 p = vec3(xz.x, 0.03, xz.y);
  vec3 toCam = cameraPosition - p;
  float dist = max(length(toCam), 0.001);
  float grow = smoothstep(0.0, 0.18, life) * 0.3 + 0.05;
  float s = grow * max(1.0, dist * 0.06);
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(0.0001, 0.0, 0.0));
  vec3 pos = p + right * (position.x * s) + vec3(0.0, (position.y + 0.5) * s * 0.7, 0.0);
  float show = step(life, 0.3) * smoothstep(0.3, 0.05, life) * smoothstep(uSplashBox * 0.5, uSplashBox * 0.2, length(r)) * open;
  vA = show * uFade;
  vC = uTint + lightAt(xz) * 2.2;
  vUv = position.xy + 0.5;
  gl_Position = vA <= 0.003 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`
const SPLASH_FRAGMENT = /* glsl */ `
varying float vA;
varying vec3 vC;
varying vec2 vUv;
void main() {
  vec2 q = vUv - vec2(0.5, 0.0);
  float ring = smoothstep(0.2, 0.0, abs(length(q * vec2(1.0, 1.6)) - 0.4));
  float dots = step(0.5, fract(q.x * 9.0 + 0.25));
  gl_FragColor = vec4(vC, vA * ring * (dots * 0.6 + 0.4));
}
`

export interface RainOptions {
  THREE: ThreeModule
  parent: THREE.Object3D
  tier: RainTier
  /** What is over the scene's head; null or empty: open sky everywhere. */
  cover?: Cover | null
  /** The street-light map and the ground rectangle [minX, minZ, maxX, maxZ] it covers (phase 2). */
  lightmap?: { texture: THREE.Texture; rect: readonly [number, number, number, number] } | null
  field?: RainField
  light?: RainLight
}

export interface Rain {
  readonly group: THREE.Group
  readonly drops: THREE.Mesh
  readonly splashes: THREE.Mesh
  /** Draw calls this costs now: the drops, and the splashes while the rain is moving. */
  readonly drawCalls: number
  readonly dropCount: number
  readonly seconds: number
  readonly active: boolean
  /** Show or hide the rain (it is dry). */
  setActive(on: boolean): void
  /** Time of day: the colour and strength of the streaks. */
  setLight(light: RainLight): void
  /** The street-light map arrived (or went). */
  setLightmap(map: RainOptions['lightmap']): void
  /** Move the seconds on. Call only inside the wake window. */
  step(dt: number): void
  /** The still frame: the seconds fixed, the camera taken as still. The splashes are hidden (a crown would hang in the air). */
  settle(): void
  /** The wake window closed: hide the splashes; the streaks stay where they are. */
  rest(): void
  dispose(): void
}

function unit<T extends { value: unknown }>(value: T['value']): T { return { value } as T }

export function createRain({ THREE, parent, tier, cover = null, lightmap = null, field = fieldFor(tier), light = 'day' }: RainOptions): Rain {
  const count = RAIN_COUNT[tier] ?? RAIN_COUNT.wide, splashCount = SPLASH_COUNT[tier] ?? SPLASH_COUNT.wide
  // The cover grid as a one-byte texture (a 1 × 1 empty one when there is none), the light map as given (a 1 × 1 black one when none).
  const hasCover = Boolean(cover && !cover.empty)
  const coverTexture = hasCover
    ? new THREE.DataTexture(cover!.data, cover!.cols, cover!.rows, THREE.RedFormat, THREE.UnsignedByteType)
    : new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType)
  coverTexture.unpackAlignment = 1
  coverTexture.magFilter = coverTexture.minFilter = THREE.NearestFilter
  coverTexture.needsUpdate = true
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  blank.needsUpdate = true

  const look = RAIN_LOOK[light]
  const shared = {
    uTime: unit<THREE.IUniform<number>>(STILL_SECONDS),
    uFade: unit<THREE.IUniform<number>>(1),
    uFocus: unit<THREE.IUniform<THREE.Vector3>>(new THREE.Vector3()),
    uCamVel: unit<THREE.IUniform<THREE.Vector3>>(new THREE.Vector3()),
    uTint: unit<THREE.IUniform<THREE.Vector3>>(new THREE.Vector3(...look.tint).multiplyScalar(0.55)),
    uCover: unit<THREE.IUniform<THREE.Texture>>(coverTexture),
    uCoverRect: unit<THREE.IUniform<THREE.Vector4>>(hasCover
      ? new THREE.Vector4(cover!.x0, cover!.z0, 1 / (cover!.cols * cover!.cell), 1 / (cover!.rows * cover!.cell)) : new THREE.Vector4(0, 0, 1, 1)),
    uCoverCap: unit<THREE.IUniform<number>>(cover?.cap ?? 1),
    uHasCover: unit<THREE.IUniform<number>>(hasCover ? 1 : 0),
    uLight: unit<THREE.IUniform<THREE.Texture>>(lightmap?.texture ?? blank),
    uLightRect: unit<THREE.IUniform<THREE.Vector4>>(new THREE.Vector4(0, 0, 1, 1)),
    uHasLight: unit<THREE.IUniform<number>>(0),
  }
  const setLightmap = (map: RainOptions['lightmap']): void => {
    shared.uLight.value = map?.texture ?? blank
    shared.uHasLight.value = map ? 1 : 0
    if (map) shared.uLightRect.value.set(map.rect[0], map.rect[1], 1 / (map.rect[2] - map.rect[0]), 1 / (map.rect[3] - map.rect[1]))
  }
  setLightmap(lightmap)

  const quad = new THREE.BufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const instanced = (instances: number): THREE.InstancedBufferGeometry => {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute('position', quad.getAttribute('position'))
    geometry.instanceCount = instances
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9)
    return geometry
  }
  const material = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false })

  const dropMaterial = material(DROP_VERTEX, DROP_FRAGMENT, {
    ...shared,
    uBox: unit(field.box), uHeight: unit(field.height), uFall: unit(field.fall), uSeed: unit(field.seed), uWind: unit(new THREE.Vector2(field.wind[0], field.wind[1])),
    uWidth: unit(0.022), uAlpha: unit(look.alpha),
  })
  const splashMaterial = material(SPLASH_VERTEX, SPLASH_FRAGMENT, { ...shared, uSplashBox: unit(SPLASH_BOX), uPeriod: unit(SPLASH_PERIOD) })
  const dropGeometry = instanced(count), splashGeometry = instanced(splashCount)

  const drops = new THREE.Mesh(dropGeometry, dropMaterial), splashes = new THREE.Mesh(splashGeometry, splashMaterial)
  drops.name = 'rain-drops'; splashes.name = 'rain-splashes'
  for (const mesh of [drops, splashes]) { mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false }
  // After the scene's own transparent things, so the streaks add to the finished picture.
  drops.renderOrder = 5; splashes.renderOrder = 4
  const group = new THREE.Group()
  group.name = 'rain'
  splashes.visible = false // splashes are only drawn while the rain moves: a frozen crown would hang in the air
  group.add(splashes, drops)
  parent.add(group)

  // What the camera is doing, learned as it draws (the host owns the camera): where it looks, and how fast it moves between two moments of rain.
  const position = new THREE.Vector3(), direction = new THREE.Vector3(), last = new THREE.Vector3()
  let seconds = STILL_SECONDS, lastSeconds = -1, still = true, gone = false
  const aim = (camera: THREE.Camera): void => {
    camera.updateWorldMatrix(true, false)
    position.setFromMatrixPosition(camera.matrixWorld)
    camera.getWorldDirection(direction)
    const t = direction.y < -0.05 ? Math.min(REACH, -position.y / direction.y) : REACH
    shared.uFocus.value.set(position.x + direction.x * t, 0, position.z + direction.z * t)
    if (seconds !== lastSeconds) {
      const span = seconds - lastSeconds
      if (lastSeconds < 0 || still || span <= 0 || span > 0.25) shared.uCamVel.value.set(0, 0, 0)
      else shared.uCamVel.value.copy(position).sub(last).divideScalar(span)
      last.copy(position); lastSeconds = seconds
    }
  }
  const before = (_renderer: unknown, _scene: unknown, camera: THREE.Camera): void => aim(camera)
  drops.onBeforeRender = before as typeof drops.onBeforeRender
  splashes.onBeforeRender = before as typeof splashes.onBeforeRender

  return {
    group, drops, splashes,
    get drawCalls() { return group.visible ? 1 + (splashes.visible ? 1 : 0) : 0 },
    dropCount: count,
    get seconds() { return seconds },
    get active() { return group.visible },
    setActive(on) { group.visible = on },
    setLight(next) {
      const to = RAIN_LOOK[next]
      shared.uTint.value.set(to.tint[0], to.tint[1], to.tint[2]).multiplyScalar(0.55)
      dropMaterial.uniforms.uAlpha!.value = to.alpha
    },
    setLightmap,
    step(dt) {
      if (gone || !(dt > 0)) return
      still = false
      splashes.visible = true
      seconds += dt
      shared.uTime.value = seconds
    },
    rest() { splashes.visible = false },
    settle() { still = true; splashes.visible = false; seconds = STILL_SECONDS; shared.uTime.value = seconds; shared.uCamVel.value.set(0, 0, 0) },
    dispose() {
      if (gone) return
      gone = true
      group.parent?.remove(group)
      dropGeometry.dispose(); splashGeometry.dispose(); quad.dispose()
      dropMaterial.dispose(); splashMaterial.dispose()
      coverTexture.dispose(); blank.dispose()
    },
  }
}
