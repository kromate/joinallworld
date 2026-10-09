import assert from 'node:assert/strict'
import { createReadinessEpoch, observeCurrentHomeBody, homeReadiness, walkRequestRecord } from './readiness-protocol-v6.mjs'

const epoch = createReadinessEpoch()
const oldWait = epoch.begin()
assert.equal(epoch.owns(oldWait), true)
epoch.cancel()
const currentWait = epoch.begin()
assert.equal(epoch.owns(oldWait), false, 'a cancelled readiness waiter cannot write into the next selection')
assert.equal(epoch.finish(oldWait), false)
assert.equal(epoch.owns(currentWait), true)
assert.equal(epoch.finish(currentWait), true)

const host = { location: 'home', avatarRendering: 'canonical', canonicalBodyEligible: true, renderCount: 12 }
const identityKey = 'seed:stable-look'
const observation = { currentPlace: 'home', currentHostGeneration: 4, entry: { id: 9, hostGeneration: 4, renderCount: 11 },
  currentEntryId: 9, identityKey, expectedIdentityKey: identityKey, host }
assert.equal(observeCurrentHomeBody(observation).accepted, true)
assert.equal(observeCurrentHomeBody({ ...observation, currentEntryId: 10 }).accepted, false, 'a late global event cannot witness another Home entry')
assert.equal(observeCurrentHomeBody({ ...observation, currentHostGeneration: 3 }).accepted, false, 'a late event cannot witness a replaced host')
assert.equal(observeCurrentHomeBody({ ...observation, host: { ...host, avatarRendering: 'procedural' } }).accepted, false)
assert.equal(observeCurrentHomeBody({ ...observation, host: { ...host, renderCount: 11 } }).accepted, false, 'readiness requires a real post-entry render')

const body = { hostGeneration: 4, bodyGeneration: 2, identityKey }
const entry = { id: 10, hostGeneration: 4, renderCount: 12 }
const cachedBodyTimeChange = homeReadiness({ validatedBody: body, currentBodyGeneration: 2, hostGeneration: 4,
  entry, currentEntryId: 10, currentPlace: 'home', identityKey, host: { ...host, renderCount: 13 } })
assert.equal(cachedBodyTimeChange.ready, true, 'a cached body is valid only with a fresh canonical render after the new entry')
assert.equal(homeReadiness({ validatedBody: body, currentBodyGeneration: 3, hostGeneration: 4,
  entry, currentEntryId: 10, currentPlace: 'home', identityKey, host: { ...host, renderCount: 13 } }).ready, false, 'a replaced player body invalidates its old witness')
assert.equal(homeReadiness({ validatedBody: body, currentBodyGeneration: 2, hostGeneration: 5,
  entry, currentEntryId: 10, currentPlace: 'home', identityKey, host: { ...host, renderCount: 13 } }).ready, false, 'rebuilds cannot reuse the prior host body witness')
assert.equal(homeReadiness({ validatedBody: body, currentBodyGeneration: 2, hostGeneration: 4,
  entry, currentEntryId: 11, currentPlace: 'home', identityKey, host: { ...host, renderCount: 13 } }).ready, false)
assert.equal(homeReadiness({ validatedBody: body, currentBodyGeneration: 2, hostGeneration: 4,
  entry, currentEntryId: 10, currentPlace: 'home', identityKey, host: { ...host, renderCount: 12 } }).ready, false, 'the current entry needs a new frame')
assert.equal(homeReadiness({ validatedBody: null, currentBodyGeneration: 0, hostGeneration: 4,
  entry, currentEntryId: 10, currentPlace: 'home', identityKey, host: { ...host, renderCount: 13 } }).ready, false,
  'a canonical-looking snapshot without a current body witness cannot unlock the scene')

const request = walkRequestRecord(7, true, 0, -0.7, 1234, { x: 1, z: 2 }, { place: 'market', hostGeneration: 2 })
const laterMotion = { x: 1, z: 1.3, blocked: false }
assert.equal(request.accepted, true)
assert.equal(request.id, 7)
assert.deepEqual(request.before, { x: 1, z: 2 })
assert.deepEqual(request.context, { place: 'market', hostGeneration: 2 })
assert.equal(laterMotion.blocked, false)
assert.equal(request.dz, -0.7, 'movement callbacks do not overwrite the durable request record')
assert.throws(() => { request.context.place = 'home' }, TypeError, 'movement evidence context is immutable')
console.log('readiness protocol generation and request tests: PASS')
