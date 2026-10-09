import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  actorEvidenceStatus, beginHostFrame, buildObservedFallback, captureObservedActor, createTrackedKit, isMaterialGroupLayoutRenderable,
  disposeObservedActor, disposeTrackedKit, loadObservedBody, mountObservedActor, setObservedPose,
  validateObservedActorSnapshot,
} from './actual-host-adapter.ts'
import type { ObservedActor, TrackedKit } from './actual-host-adapter.ts'

const loader = GLTFLoader.prototype as unknown as { loadAsync(url: string, progress?: (event: ProgressEvent) => void): Promise<any>; parseAsync(data: ArrayBuffer, path: string): Promise<any> }
const originalLoadAsync = loader.loadAsync
const originalFetch = globalThis.fetch
const here = dirname(fileURLToPath(import.meta.url))
function imageFree(bytes: Uint8Array): ArrayBuffer {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(data.getUint32(0, true), 0x46546c67); assert.equal(data.getUint32(4, true), 2)
  let offset = 12, json: any, bin: Uint8Array | undefined
  while (offset < bytes.length) {
    const length = data.getUint32(offset, true), kind = data.getUint32(offset + 4, true)
    assert.ok(offset + 8 + length <= bytes.length)
    const chunk = bytes.slice(offset + 8, offset + 8 + length)
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
    else if (kind === 0x004e4942) bin = chunk
    offset += 8 + length
  }
  assert.ok(json && bin)
  delete json.images; delete json.textures; delete json.samplers
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture; delete material.normalTexture
    delete material.occlusionTexture; delete material.emissiveTexture
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json)), jsonLength = (encoded.length + 3) & ~3, binLength = (bin.length + 3) & ~3
  const glb = new Uint8Array(28 + jsonLength + binLength), out = new DataView(glb.buffer)
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, glb.length, true)
  out.setUint32(12, jsonLength, true); out.setUint32(16, 0x4e4f534a, true); glb.fill(0x20, 20, 20 + jsonLength); glb.set(encoded, 20)
  out.setUint32(20 + jsonLength, binLength, true); out.setUint32(24 + jsonLength, 0x004e4942, true); glb.set(bin, 28 + jsonLength)
  return glb.buffer
}
async function installAssetFetch() {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); const path = fileURLToPath(new URL(`${url.protocol}//${url.host}${url.pathname}`))
    return new Response(await readFile(path), { status: 200, headers: { 'content-type': 'model/gltf-binary' } })
  }
  loader.loadAsync = async function(url, progress) {
    const match = url.match(/base-body-(male|female)\.glb/i)
    if (!match) return originalLoadAsync.call(this, url, progress)
    const response = await fetch(url)
    const gltf = await this.parseAsync(imageFree(new Uint8Array(await response.arrayBuffer())), '')
    let mesh: THREE.SkinnedMesh | null = null
    gltf.scene.traverse((node: THREE.Object3D) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = node as THREE.SkinnedMesh })
    assert.ok(mesh)
    const material = (mesh as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial
    const map = new THREE.DataTexture(new Uint8Array([200, 150, 120, 255]), 1, 1, THREE.RGBAFormat)
    map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; material.map = map
    return gltf
  }
}
function forgedActor(): ObservedActor { return Object.freeze({ token: Object.freeze({}) }) }
const look = Object.freeze({ body: 'man', outfit: 'kaftan', fabric: 'plain', face: 'oval', expression: 'neutral', accessories: [] })

test('Three single-material rendering ignores per-face materialIndex while arrays use it', () => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  assert.ok(box.geometry.groups.some(group => group.materialIndex > 0), 'the stock BoxGeometry carries six face material indices')
  assert.equal(isMaterialGroupLayoutRenderable(box), true, 'single material draws the full geometry; groups do not select material slots')
  assert.equal(isMaterialGroupLayoutRenderable(new THREE.Mesh(box.geometry, [box.material as THREE.Material])), false,
    'the same six groups are invalid with a one-entry material array')
  const sixMaterials = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial())
  assert.equal(isMaterialGroupLayoutRenderable(new THREE.Mesh(box.geometry, sixMaterials)), true,
    'the six-group material array has valid slots')
  box.geometry.dispose(); (box.material as THREE.Material).dispose(); sixMaterials.forEach(material => material.dispose())
})

test('actual Kit/loadBody/fallback provenance rejects forged initial state and stale ownership', async () => {
  const pins = JSON.parse(await readFile(resolve(here, 'source-pins.json'), 'utf8')) as { files: Record<string, string>; threeDefaultOnBeforeCompileSha256: string }
  assert.equal(createHash('sha256').update(THREE.Material.prototype.onBeforeCompile.toString()).digest('hex'), pins.threeDefaultOnBeforeCompileSha256,
    'runtime Three stock callback matches the package-pinned implementation')
  for (const [path, expected] of Object.entries(pins.files)) {
    const actual = createHash('sha256').update(await readFile(resolve(here, '../../../..', path))).digest('hex')
    assert.equal(actual, expected, `source/asset pin changed: ${path}`)
  }
  await installAssetFetch()
  try {
    const fakeKit = Object.freeze({ token: Object.freeze({}) }) as TrackedKit
    assert.equal(await loadObservedBody(fakeKit, look, 'v7-forgery', 1), null, 'caller-forged Kit lease never enters private registry')
    const kit = createTrackedKit()
    const parent = new THREE.Group()
    const actor = await loadObservedBody(kit, look, 'v7-production-load', 1)
    assert.ok(actor, 'production loadBody returned a pinned skinned actor')
    assert.equal(actorEvidenceStatus(actor).templateCacheOwned, true, 'real loadBody registered its Kit disposal callback')
    assert.equal(mountObservedActor(actor, parent, { x: 0, y: 0, z: 0, yaw: 0 }), true)
    assert.equal(setObservedPose(actor, 'idle'), true)
    // The actor handle exposes no root, but the renderer's scene parent can reach its mounted child.
    // Replacing the material before the first sample with a callback that forges production labels
    // must fail: this is an initial registration attack, not only a stale-snapshot mutation.
    const root = parent.children[0]!
    let bodyMesh: THREE.Mesh | null = null
    root.traverse(node => {
      const mesh = node as THREE.Mesh
      const materials = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
      if (materials.some(material => !!(material as THREE.MeshStandardMaterial).map) && !bodyMesh) bodyMesh = mesh
    })
    assert.ok(bodyMesh)
    const mesh = bodyMesh as THREE.Mesh, original = mesh.material
    const forged = new THREE.MeshStandardMaterial()
    forged.onBeforeCompile = (() => undefined) as typeof forged.onBeforeCompile
    forged.customProgramCacheKey = () => 'allworld-body-sleep-socket-eyes-2'
    mesh.material = forged
    const forgedFrame = beginHostFrame(1)!
    assert.equal(captureObservedActor(actor, forgedFrame).state, 'unknown', 'forged initial callback/material instance is not source-registered')
    mesh.material = original
    forged.dispose()

    const frame = beginHostFrame(2)!; assert.ok(frame)
    const valid = captureObservedActor(actor, frame)
    assert.equal(valid.state, 'ready')
    if (valid.state !== 'ready') throw new Error(valid.reason)
    assert.equal(validateObservedActorSnapshot(valid.snapshot, actor, frame).state, 'current')
    let bone: THREE.Bone | null = null
    parent.children[0]!.traverse(node => { if ((node as THREE.Bone).isBone && !bone) bone = node as THREE.Bone })
    assert.ok(bone, 'actual loaded GLB exposes its authored bone hierarchy')
    const actualBone = bone as THREE.Bone, oldX = actualBone.position.x
    actualBone.position.x = oldX + 0.01; parent.updateWorldMatrix(true, true)
    assert.equal(validateObservedActorSnapshot(valid.snapshot, actor, frame).state, 'refused', 'actual bone matrix change invalidates the actor proof')
    actualBone.position.x = oldX; parent.updateWorldMatrix(true, true)
    assert.equal(validateObservedActorSnapshot(valid.snapshot, actor, frame).state, 'current', 'restoring the exact evaluated skeleton restores the still-live same-turn sample')
    await Promise.resolve()
    assert.equal(validateObservedActorSnapshot(valid.snapshot, actor, frame).state, 'refused', 'same-turn proof expires before an async continuation')

    const treeFrame = beginHostFrame(3)!
    const injected = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(injected)
    assert.equal(captureObservedActor(actor, treeFrame).state, 'unknown', 'complete live traversal rejects an unregistered descendant')
    injected.geometry.dispose(); (injected.material as THREE.Material).dispose(); root.remove(injected)

    const sharedMap = (original as THREE.MeshStandardMaterial).map
    assert.ok(sharedMap, 'actual body material retains its Kit-cache texture map')
    sharedMap.dispose()
    assert.equal(captureObservedActor(actor, beginHostFrame(4)!).state, 'unknown', 'disposing the Kit-owned shared map invalidates the actor lease')
    assert.equal(actorEvidenceStatus(actor).alive, false)

    assert.equal(disposeObservedActor(actor), true)
    assert.equal(captureObservedActor(actor, beginHostFrame(5)!).state, 'unknown', 'disposed actor is not observable')
    assert.equal(disposeTrackedKit(kit), true)
    assert.equal(actorEvidenceStatus(actor).alive, false)

    const stockCallback = THREE.Material.prototype.onBeforeCompile
    const forgedKit = createTrackedKit()
    try {
      THREE.Material.prototype.onBeforeCompile = function forgedInitialCallback() { /* not the pinned Three callback */ }
      assert.equal(buildObservedFallback(forgedKit, look, 'v7-forged-stock-callback'), null,
        'an initial global prototype callback is rejected even when Kit materials inherit it')
    } finally {
      THREE.Material.prototype.onBeforeCompile = stockCallback
      disposeTrackedKit(forgedKit)
    }

    const fallbackKit = createTrackedKit()
    const fallback = buildObservedFallback(fallbackKit, look, 'v7-fallback-source')
    assert.ok(fallback, 'real buildAvatar fallback is registered through Kit materials')
    const fallbackParent = new THREE.Group()
    assert.equal(mountObservedActor(fallback, fallbackParent, { x: 0, y: 0, z: 0, yaw: 0 }), true)
    const fallbackFrame = beginHostFrame(6)!
    assert.equal(captureObservedActor(fallback, fallbackFrame).state, 'ready')
    disposeObservedActor(fallback); disposeTrackedKit(fallbackKit)
    assert.equal(captureObservedActor(forgedActor(), beginHostFrame(7)!).state, 'unknown', 'forged actor lease is refused at initial registration boundary')
  } finally {
    loader.loadAsync = originalLoadAsync
    globalThis.fetch = originalFetch
  }
})
