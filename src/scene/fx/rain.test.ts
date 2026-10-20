// Rain drawn (rain.ts) and the weather door (weather.ts), against the real three.js under Node (no GL context is made): one mesh for the drops and
// one for the splashes, the tier's counts, additive and depth-free, moved only by step(), still under settle(), and freed by dispose().
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createRain, STILL_SECONDS } from './rain.ts'
import { createSmoke } from './smoke.ts'
import { createWeather, WINDOW_S } from './weather.ts'
import { RAIN_COUNT, SPLASH_COUNT } from './rain-plan.ts'
import { coverFromBoxes } from './cover.ts'
import { PUFFS } from './smoke-plan.ts'

const parent = () => new THREE.Group()

test('rain is one mesh of drops and one of splashes, additive, depth-free and never culled', () => {
  const root = parent(), rain = createRain({ THREE, parent: root, tier: 'phone' })
  const meshes = rain.group.children as THREE.Mesh[]
  assert.equal(meshes.length, 2)
  assert.equal(meshes.filter((m) => m.name === 'rain-drops').length, 1)
  assert.equal(meshes.filter((m) => m.name === 'rain-splashes').length, 1)
  assert.equal(rain.drawCalls, 1, 'at rest only the streaks are drawn')
  rain.step(0.1)
  assert.equal(rain.drawCalls, 2, 'moving: the streaks and the splashes')
  for (const mesh of meshes) {
    const material = mesh.material as THREE.ShaderMaterial
    assert.equal(material.blending, THREE.AdditiveBlending)
    assert.equal(material.depthWrite, false)
    assert.equal(material.transparent, true)
    assert.equal(mesh.frustumCulled, false)
    assert.equal(mesh.castShadow, false)
  }
  assert.ok(rain.drops.renderOrder > 0 && rain.splashes.renderOrder > 0, 'after the opaque scene')
  assert.equal(root.children.length, 1)
  rain.dispose()
})

test('the instance counts are the tier\'s', () => {
  for (const tier of ['phone', 'wide', 'high'] as const) {
    const rain = createRain({ THREE, parent: parent(), tier })
    assert.equal((rain.drops.geometry as THREE.InstancedBufferGeometry).instanceCount, RAIN_COUNT[tier])
    assert.equal((rain.splashes.geometry as THREE.InstancedBufferGeometry).instanceCount, SPLASH_COUNT[tier])
    assert.equal(rain.dropCount, RAIN_COUNT[tier])
    rain.dispose()
  }
})

test('the seconds move only when stepped, and the still frame is fixed', () => {
  const rain = createRain({ THREE, parent: parent(), tier: 'wide' })
  assert.equal(rain.seconds, STILL_SECONDS)
  rain.step(0.5); rain.step(0.25)
  assert.equal(rain.seconds, STILL_SECONDS + 0.75)
  rain.step(-1); rain.step(Number.NaN)
  assert.equal(rain.seconds, STILL_SECONDS + 0.75, 'bad steps are ignored')
  rain.settle()
  assert.equal(rain.seconds, STILL_SECONDS)
  rain.dispose()
})

test('the cover grid goes to the shader as a texture; without cover the sky is open', () => {
  const cover = coverFromBoxes([[-6, 5.9, -6, 6, 6.4, 6]], [-30, -30, 30, 30])
  const covered = createRain({ THREE, parent: parent(), tier: 'phone', cover })
  const material = covered.drops.material as THREE.ShaderMaterial
  assert.equal(material.uniforms.uHasCover!.value, 1)
  assert.equal((material.uniforms.uCover!.value as THREE.DataTexture).image.width, cover.cols)
  assert.equal((covered.splashes.material as THREE.ShaderMaterial).uniforms.uCover, material.uniforms.uCover, 'drops and splashes share one texture')
  covered.dispose()
  const open = createRain({ THREE, parent: parent(), tier: 'phone' })
  assert.equal((open.drops.material as THREE.ShaderMaterial).uniforms.uHasCover!.value, 0)
  open.dispose()
})

test('the camera tells the rain where to fall: the focus is ahead of it on the ground, near enough to keep the camera in the box', () => {
  const rain = createRain({ THREE, parent: parent(), tier: 'wide' })
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500)
  camera.position.set(15, 19.8, 25.4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
  ;(rain.drops.onBeforeRender as unknown as (r: unknown, s: unknown, c: THREE.Camera) => void)(null, null, camera)
  const focus = (rain.drops.material as THREE.ShaderMaterial).uniforms.uFocus!.value as THREE.Vector3
  assert.equal(focus.y, 0)
  assert.ok(Math.hypot(focus.x - 15, focus.z - 25.4) <= 17.01, 'within reach of the camera')
  assert.ok(focus.x < 15 && focus.z < 25.4, 'toward the scene')
  rain.dispose()
})

test('dispose frees the geometries, the materials and the textures, and takes the rain out of the scene', () => {
  const root = parent(), rain = createRain({ THREE, parent: root, tier: 'phone', cover: coverFromBoxes([[-6, 5.9, -6, 6, 6.4, 6]], [-30, -30, 30, 30]) })
  let disposed = 0
  const count = () => { disposed++ }
  for (const mesh of [rain.drops, rain.splashes]) { mesh.geometry.addEventListener('dispose', count); (mesh.material as THREE.Material).addEventListener('dispose', count) }
  const texture = (rain.drops.material as THREE.ShaderMaterial).uniforms.uCover!.value as THREE.Texture
  texture.addEventListener('dispose', count)
  rain.dispose(); rain.dispose()
  assert.equal(disposed, 5)
  assert.equal(root.children.length, 0)
  rain.step(1)
  assert.equal(rain.seconds, STILL_SECONDS, 'a disposed rain does not move')
})

test('smoke is one mesh and one draw call for every source, nothing without a source', () => {
  assert.equal(createSmoke({ THREE, parent: parent(), tier: 'phone', sources: [] }), null)
  const root = parent()
  const smoke = createSmoke({ THREE, parent: root, tier: 'wide', sources: [{ kind: 'grill', x: 1, y: 1.7, z: 2 }, { kind: 'generator', x: -3, y: 1.4, z: -9 }] })!
  assert.equal(smoke.drawCalls, 1)
  assert.equal((smoke.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount, 2 * PUFFS.wide)
  assert.equal(root.children.length, 1)
  smoke.step(1)
  assert.ok(smoke.seconds > 0)
  smoke.dispose()
  assert.equal(root.children.length, 0)
})

test('weather: dry and nothing to smoke draws nothing and wakes nothing', () => {
  const root = parent(), weather = createWeather({ THREE, parent: root, tier: 'phone' })
  weather.update({ wet: false, outage: false, generator: false })
  assert.equal(weather.drawCalls, 0)
  assert.equal(root.children.length, 0, 'not even built')
  assert.equal(weather.wake(), false)
  assert.equal(weather.step(0.1), false)
})

test('weather: a roof the host knows about reaches the rain as a cover texture; the street\'s houses count from the roof down', () => {
  const venue = createWeather({ THREE, parent: parent(), tier: 'phone', roofs: { boxes: [[-6, 5.9, -6, 6, 6.3, 6]], bounds: [-30, -30, 30, 30] } })
  venue.update({ wet: true, outage: false, generator: false })
  assert.equal((venue.rain!.drops.material as THREE.ShaderMaterial).uniforms.uHasCover!.value, 1)
  const street = createWeather({ THREE, parent: parent(), tier: 'phone', roofs: { boxes: [[10, 0, -5, 20, 7, 3]], bounds: [0, -19, 40, 14], buildings: true } })
  street.update({ wet: true, outage: false, generator: false })
  assert.equal((street.rain!.drops.material as THREE.ShaderMaterial).uniforms.uHasCover!.value, 1)
  const bare = createWeather({ THREE, parent: parent(), tier: 'phone' })
  bare.update({ wet: true, outage: false, generator: false })
  assert.equal((bare.rain!.drops.material as THREE.ShaderMaterial).uniforms.uHasCover!.value, 0)
  for (const w of [venue, street, bare]) w.dispose()
})

test('weather: wet builds the rain once, the window opens and closes, settle is a still frame, dry hides it again', () => {
  const root = parent(), weather = createWeather({ THREE, parent: root, tier: 'phone' })
  weather.update({ wet: true, outage: false, generator: false })
  const rain = weather.rain!
  assert.ok(rain)
  weather.update({ wet: true, outage: false, generator: false })
  assert.equal(weather.rain, rain, 'built once')
  assert.equal(weather.drawCalls, 1, 'streaks only until it moves')
  assert.equal(weather.awake, false, 'nothing asks for frames on its own')
  assert.equal(weather.wake(), true)
  assert.equal(weather.awake, true)
  weather.step(1 / 30)
  assert.equal(weather.drawCalls, 2, 'moving')
  let frames = 0
  while (weather.step(1 / 30)) frames++
  assert.equal(rain.splashes.visible, false, 'the window closed: no crown hangs in the air')
  assert.equal(rain.drops.visible, true, 'the streaks stay')
  assert.ok(Math.abs(frames - WINDOW_S * 30) <= 2, `the window is ${WINDOW_S} s of frames, ${frames}`)
  assert.equal(weather.awake, false)
  const stopped = rain.seconds
  assert.equal(weather.step(1 / 30), false)
  assert.equal(rain.seconds, stopped, 'outside the window the rain stands still')
  weather.wake(); weather.step(0.5); weather.settle()
  assert.equal(rain.seconds, STILL_SECONDS)
  assert.equal(rain.splashes.visible, false)
  assert.equal(weather.awake, false)
  weather.update({ wet: false, outage: false, generator: false })
  assert.equal(rain.active, false)
  assert.equal(weather.drawCalls, 0)
  weather.dispose()
  assert.equal(root.children.length, 0)
})

test('weather: a room with a ceiling draws no rain, only its smoke; a changed source list rebuilds the smoke', () => {
  const root = parent(), weather = createWeather({ THREE, parent: root, tier: 'phone', open: false })
  const grill = { landmarks: [{ key: 'grill', x: 0, z: 0 }] }
  weather.update({ wet: true, outage: false, generator: false }, grill)
  assert.equal(weather.rain, null)
  assert.equal(weather.drawCalls, 1)
  const first = weather.smoke
  weather.update({ wet: true, outage: false, generator: false }, grill)
  assert.equal(weather.smoke, first, 'the same sources keep the same smoke')
  weather.update({ wet: true, outage: true, generator: true }, { ...grill, behind: { x: 1, z: -11 } })
  assert.equal(weather.drawCalls, 1, 'a running generator adds a source to the same one draw call')
  assert.equal(weather.smoke!.sources, 2)
  weather.update({ wet: true, outage: false, generator: false }, {})
  assert.equal(weather.smoke, null)
  assert.equal(weather.wake(), false)
  weather.dispose()
})

test('the address can force the rain: ?wet=1 wet, ?wet=0 dry, anything else leaves the weather alone', async () => {
  const { wetFromQuery, withWetQuery } = await import('./weather.ts')
  assert.equal(wetFromQuery('?quality=high&wet=1'), true)
  assert.equal(wetFromQuery('?wet=0&x=1'), false)
  assert.equal(wetFromQuery('?wet=2'), null)
  assert.equal(wetFromQuery('?wetter=1'), null)
  assert.equal(wetFromQuery(''), null)
  const dry = { wet: false, harmattan: true }
  assert.deepEqual(withWetQuery(dry, '?wet=1'), { wet: true, harmattan: true })
  assert.equal(withWetQuery(dry, '?wet=0'), dry, 'the same object when nothing changes')
  assert.equal(withWetQuery(dry, ''), dry)
  assert.equal(dry.wet, false, 'the input is never changed')
})
