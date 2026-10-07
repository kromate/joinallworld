// The companion model: rendering budget, every pose animates without NaN, and it frees what it made. No WebGL or DOM needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { buildCompanion } from './model.ts'
import type { CompanionPose } from './model.ts'
import { COMPANION_COLOURS, COMPANION_NAME } from './identity.ts'

const POSES: CompanionPose[] = ['idle', 'wave', 'point', 'nod', 'celebrate', 'think', 'sleepy']

function allFinite(root: THREE.Object3D): boolean {
  let ok = true
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const v = [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z, ...o.matrixWorld.elements]
    if (v.some((n) => !Number.isFinite(n))) ok = false
    if (o.scale.x === 0 || o.scale.y === 0 || o.scale.z === 0) ok = false
  })
  return ok
}

test('companion stays inside the rendering budget', () => {
  const rig = buildCompanion(THREE)
  assert.ok(rig.triangles > 300 && rig.triangles <= 1500, `triangles ${rig.triangles}`)
  assert.ok(rig.drawCalls >= 1 && rig.drawCalls <= 2)
  let meshes = 0
  rig.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++ })
  assert.equal(meshes, rig.drawCalls)
  rig.dispose()
})

test('every pose animates without producing NaN, for both motion settings', () => {
  for (const reduced of [false, true]) {
    const rig = buildCompanion(THREE, { reduced })
    rig.lookAt(0.7, -0.4); rig.pointAt(-0.8, 0.6); rig.setTalking(true)
    let t = 0
    for (const pose of POSES) {
      rig.play(pose, 900)
      for (let i = 0; i < 90; i++) {
        t += 1 / 60
        rig.update(1 / 60, t)
        assert.ok(allFinite(rig.object), `${pose} reduced=${reduced} frame ${i}`)
      }
    }
    for (const base of ['think', 'sleepy', 'idle'] as const) { rig.setBase(base); rig.update(10, t += 10); rig.update(NaN, t); assert.ok(allFinite(rig.object)) }
    rig.lookAt(NaN, 9); rig.pointAt(5, -5); rig.update(0.016, t)
    assert.ok(allFinite(rig.object))
    rig.dispose()
  }
})

test('a timed pose returns to the held pose; reduced motion keeps the body still', () => {
  const rig = buildCompanion(THREE)
  rig.setBase('sleepy'); rig.play('wave', 500)
  for (let i = 0; i < 60; i++) rig.update(1 / 60, i / 60)
  const arm = rig.object.getObjectByProperty('isBone', true)
  assert.ok(arm)
  const still = buildCompanion(THREE, { reduced: true })
  still.update(0.016, 0.5); const a = still.object.getObjectByProperty('isBone', true)!.position.y
  still.update(0.016, 1.3); const b = still.object.getObjectByProperty('isBone', true)!.position.y
  assert.equal(a, b)
  rig.dispose(); still.dispose()
})

test('update allocates (almost) nothing', () => {
  // Collect before each reading, so garbage made by earlier tests does not count as this one's growth.
  setFlagsFromString('--expose-gc')
  const collect = runInNewContext('gc') as () => void
  const rig = buildCompanion(THREE)
  rig.setTalking(true); rig.play('celebrate', 100000)
  for (let i = 0; i < 2000; i++) rig.update(1 / 60, i / 60)
  collect()
  const before = process.memoryUsage().heapUsed
  for (let i = 0; i < 20000; i++) rig.update(1 / 60, i / 60)
  collect()
  const grown = process.memoryUsage().heapUsed - before
  assert.ok(grown < 1_000_000, `heap kept ${grown} bytes after 20000 updates`)
  rig.dispose()
})

test('dispose frees the geometry and the identity is exported', () => {
  const rig = buildCompanion(THREE)
  const meshes: THREE.Mesh[] = []
  rig.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
  let disposed = 0
  for (const m of meshes) m.geometry.addEventListener('dispose', () => { disposed++ })
  rig.dispose()
  assert.equal(disposed, meshes.length)
  assert.equal(COMPANION_NAME, 'Lumo')
  assert.match(COMPANION_COLOURS.accent, /^#[0-9a-f]{6}$/)
})
