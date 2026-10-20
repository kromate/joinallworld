import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AO_SETTINGS, BLOOM_SETTINGS, MSAA_SAMPLES, buildPost, postAoEnabled, type PostLibs } from './post.ts'
import type { ThreeModule } from '../types.ts'

// The stack is checked through stand-ins for the libraries (postprocessing needs a real GL context): what is built, in which
// order, with which numbers, how it is sized and what dispose releases.
function fakes(log: string[]) {
  class Buffer { w = 0; h = 0; setSize(w: number, h: number) { this.w = w; this.h = h; log.push(`buffer ${w}x${h}`) } }
  class Pass {
    name: string; enabled = true; sized: [number, number] | null = null
    mainScene: unknown = null; mainCamera: unknown = null
    constructor(name: string) { this.name = name; log.push(`new ${name}`) }
    setSize(w: number, h: number) { this.sized = [w, h] }
  }
  class Composer {
    passes: Pass[] = []; inputBuffer = new Buffer(); outputBuffer = new Buffer(); disposed = false
    options: Record<string, unknown>
    constructor(_renderer: unknown, options: Record<string, unknown>) { this.options = options; log.push('composer') }
    addPass(pass: Pass) { this.passes.push(pass); log.push(`add ${pass.name}`) }
    render() { log.push('draw') }
    dispose() { this.disposed = true; log.push('composer disposed') }
  }
  const effect = (name: string) => class { args: unknown[]; constructor(...args: unknown[]) { this.args = args; log.push(`effect ${name}`) } }
  const libs = {
    EffectComposer: Composer,
    RenderPass: class extends Pass { scene: unknown; camera: unknown; constructor(scene: unknown, camera: unknown) { super('render'); this.scene = scene; this.camera = camera } },
    EffectPass: class extends Pass { camera: unknown; effects: unknown[]; constructor(camera: unknown, ...effects: unknown[]) { super('effects'); this.camera = camera; this.effects = effects } },
    BloomEffect: effect('bloom'), LUT3DEffect: effect('lut'), VignetteEffect: effect('vignette'), ToneMappingEffect: effect('tone'),
    ToneMappingMode: { NEUTRAL: 9, ACES_FILMIC: 7, AGX: 8 },
    N8AOPostPass: class extends Pass {
      configuration = { aoRadius: 0, distanceFalloff: 0, intensity: 0, halfRes: false, depthAwareUpsampling: false }; quality = ''
      scene: unknown; camera: unknown
      constructor(scene: unknown, camera: unknown) { super('ao'); this.scene = scene; this.camera = camera }
      setQualityMode(mode: string) { this.quality = mode }
    },
  }
  return libs as unknown as PostLibs
}
class Data3DTexture {
  image: { data: Uint8Array }; needsUpdate = false; disposed = false; width: number
  constructor(data: Uint8Array, width: number) { this.image = { data }; this.width = width }
  dispose() { this.disposed = true }
}
const THREE = {
  HalfFloatType: 1016, RGBAFormat: 1023, UnsignedByteType: 1009, LinearFilter: 1006, ClampToEdgeWrapping: 1001,
  ACESFilmicToneMapping: 4, AgXToneMapping: 6, NeutralToneMapping: 7, NoToneMapping: 0,
  Data3DTexture, PerspectiveCamera: class {}, Scene: class {},
} as unknown as ThreeModule
const renderer = (toneMapping = 7) => ({ toneMapping }) as never

test('the passes are added in order: render, ambient occlusion, then one grading pass', () => {
  const log: string[] = []
  buildPost(THREE, renderer(), fakes(log), 1280, 720, { ao: true })
  assert.deepEqual(log.filter((l) => l.startsWith('add ')), ['add render', 'add ao', 'add effects'])
  assert.deepEqual(log.filter((l) => l.startsWith('effect ')), ['effect bloom', 'effect tone', 'effect lut', 'effect vignette'])
})

test('the frame buffers are half float with 4x MSAA', () => {
  const log: string[] = [], libs = fakes(log)
  let made: { options: Record<string, unknown> } | null = null
  const Base = libs.EffectComposer as unknown as new (...a: unknown[]) => { options: Record<string, unknown> }
  libs.EffectComposer = class extends Base { constructor(...a: unknown[]) { super(...a); made = this } } as never
  buildPost(THREE, renderer(), libs, 800, 600)
  assert.deepEqual(made!.options, { frameBufferType: 1016, multisampling: MSAA_SAMPLES })
})

test('without ao the pass is not built, even if the library was handed in', () => {
  const log: string[] = []
  buildPost(THREE, renderer(), fakes(log), 1280, 720, { ao: false })
  assert.ok(!log.includes('new ao'))
  assert.deepEqual(log.filter((l) => l.startsWith('add ')), ['add render', 'add effects'])
})

test('ao settings reach the pass', () => {
  const log: string[] = [], libs = fakes(log)
  let pass: { configuration: Record<string, unknown>; quality: string } | null = null
  const Ao = libs.N8AOPostPass as unknown as new (...a: unknown[]) => { configuration: Record<string, unknown>; quality: string }
  libs.N8AOPostPass = class extends Ao { constructor(...a: unknown[]) { super(...a); pass = this } } as never
  buildPost(THREE, renderer(), libs, 1280, 720, { ao: true })
  assert.equal(pass!.quality, 'Performance')
  assert.deepEqual(pass!.configuration, { aoRadius: AO_SETTINGS.radius, distanceFalloff: AO_SETTINGS.distanceFalloff, intensity: AO_SETTINGS.intensity, halfRes: true, depthAwareUpsampling: true })
})

test('bloom threshold is high so only emissive surfaces glow, and the tone mapper follows the renderer', () => {
  for (const [renderMode, expected] of [[7, 9], [4, 7], [6, 8]] as const) {
    const log: string[] = [], libs = fakes(log)
    const seen: Record<string, unknown>[] = []
    for (const name of ['BloomEffect', 'ToneMappingEffect'] as const) {
      const Base = libs[name] as unknown as new (...a: unknown[]) => object
      libs[name] = class extends Base { constructor(options: Record<string, unknown>) { super(options); seen.push({ [name]: options }) } } as never
    }
    buildPost(THREE, renderer(renderMode), libs, 640, 480, { threshold: 0.85 })
    assert.deepEqual(seen[0], { BloomEffect: { luminanceThreshold: 0.85, mipmapBlur: true, ...BLOOM_SETTINGS } })
    assert.deepEqual(seen[1], { ToneMappingEffect: { mode: expected } })
  }
})

test('buffers follow the capped pixel ratio and only resize when the size changes', () => {
  const log: string[] = []
  const post = buildPost(THREE, renderer(), fakes(log), 1280, 720, { maxRatio: 1.5 })
  post.setSize(1000, 500, 2.5)
  assert.ok(log.includes('buffer 1500x750'))
  const before = log.length
  post.setSize(1000, 500, 2)
  assert.equal(log.length, before, 'same capped size: nothing happens')
  post.setSize(1000, 500, 1)
  assert.ok(log.includes('buffer 1000x500'))
})

test('rendering points every pass at the scene and camera, then draws once', () => {
  const log: string[] = [], libs = fakes(log)
  const made: { mainScene: unknown; mainCamera: unknown; scene?: unknown; camera?: unknown; name: string }[] = []
  for (const name of ['RenderPass', 'EffectPass', 'N8AOPostPass'] as const) {
    const Base = libs[name] as unknown as new (...a: unknown[]) => (typeof made)[number]
    libs[name] = class extends Base { constructor(...a: unknown[]) { super(...a); made.push(this) } } as never
  }
  const post = buildPost(THREE, renderer(), libs, 1280, 720, { ao: true })
  const scene = { id: 's' }, camera = { id: 'c' }
  post.render(scene as never, camera as never)
  assert.equal(log.filter((l) => l === 'draw').length, 1)
  const by = (name: string) => made.filter((p) => p.name === name)
  assert.equal(by('render')[0]!.mainScene, scene); assert.equal(by('render')[0]!.mainCamera, camera)
  assert.equal(by('ao')[0]!.scene, scene); assert.equal(by('ao')[0]!.camera, camera)
  for (const pass of by('effects')) assert.equal(pass.mainCamera, camera)
})

test('setGrade rewrites the table in place and re-uploads it', () => {
  const log: string[] = []
  let texture: Data3DTexture | null = null
  const Texture = THREE.Data3DTexture as unknown as typeof Data3DTexture
  const T = { ...THREE, Data3DTexture: class extends Texture { constructor(data: Uint8Array, width: number) { super(data, width); texture = this } } } as unknown as ThreeModule
  const post = buildPost(T, renderer(), fakes(log), 640, 480, { grade: { kind: 'clear', band: 'day' } })
  assert.equal(texture!.width, 16); assert.equal(texture!.image.data.length, 16 ** 3 * 4)
  const day = texture!.image.data.slice()
  texture!.needsUpdate = false
  post.setGrade('harmattan', 'night')
  assert.equal(texture!.needsUpdate, true)
  assert.notDeepEqual([...texture!.image.data], [...day])
})

test('dispose releases the composer and the table', () => {
  const log: string[] = []
  let texture: Data3DTexture | null = null
  const Texture = THREE.Data3DTexture as unknown as typeof Data3DTexture
  const T = { ...THREE, Data3DTexture: class extends Texture { constructor(data: Uint8Array, width: number) { super(data, width); texture = this } } } as unknown as ThreeModule
  buildPost(T, renderer(), fakes(log), 640, 480).dispose()
  assert.ok(log.includes('composer disposed')); assert.equal(texture!.disposed, true)
})

test('post-process ambient occlusion is off unless ?ao=1 (the kerb smear in the phase 2b night pair)', () => {
  assert.equal(postAoEnabled({ location: { search: '' } }), false)
  assert.equal(postAoEnabled({ location: { search: '?ao=1' } }), true)
  assert.equal(postAoEnabled({ location: { search: '?ao=0' } }), false)
  assert.equal(postAoEnabled({}), false)
})
