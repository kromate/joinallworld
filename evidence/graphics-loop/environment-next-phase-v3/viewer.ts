import { loadCityContent } from '../../../src/game/cities/registry.ts'
import { packStyle, unpackStyle } from '../../../src/game/content/world.ts'
import { loadCityScenes } from '../../../src/scene/city-scenes.ts'
import { createLife } from '../../../src/life.ts'
import { normalizeLook } from '../../../src/scene/avatar-look.ts'
import { buildNeighbourhoodScene } from '../../../src/scene/neighbourhood-scene.ts'
import { buildNeighbourhoodScene as candidateNeighbourhood } from './candidate-neighbourhood-scene.ts'
import { heldActionFor, shortcutFor } from '../../../src/ui/keys.ts'
import type { WorldStreetResponse } from '../../../src/types/world.ts'
import { createVenueWorld, type VenueWorld } from '../../../src/venue-world.ts'
import { createVenueWorld as candidateWorld } from './candidate-world.ts'
import { buildHomeScene as candidateHome } from './candidate-home-scene.ts'

const CITY = 'lagos'
const SEED = 'graphics-playable-host-v1'
const LOOK = normalizeLook({
  body: 'woman', hair: 'afro', outfit: 'casual', fabric: 'plain', skin: 'skin-4',
  hairColor: 'black', outfitColor: 'teal', bottomsColor: 'navy', accessories: [], face: 'oval', expression: 'smile',
}, SEED)
const crowdSeeds = Array.from({ length: 12 }, (_, index) => {
  const id = `graphics-host-crowd-${String(index + 1).padStart(2, '0')}`
  const body = index % 2 ? 'man' : 'woman'
  const angle = index * Math.PI * 2 / 12
  const look = normalizeLook({
    body,
    hair: body === 'woman' ? ['afro', 'braids', 'bun', 'locs', 'ponytail', 'twists'][index % 6] : ['lowcut', 'afro', 'bald', 'fade', 'locs', 'curls'][index % 6],
    outfit: body === 'woman' ? ['casual', 'office', 'owambe', 'jersey', 'kaftan', 'gown'][index % 6] : ['casual', 'hoodie', 'office', 'chill', 'jersey', 'kaftan'][index % 6],
    fabric: ['plain', 'ankara', 'adire', 'asooke'][index % 4],
    skin: `skin-${(index % 7) + 1}`,
    hairColor: ['black', 'softblack', 'darkbrown', 'brown', 'auburn', 'purple'][index % 6],
    outfitColor: ['teal', 'navy', 'gold', 'red', 'green', 'violet', 'cream', 'orange', 'blue', 'pink'][index % 10],
    bottomsColor: ['navy', 'cream', 'blue', 'green', 'red', 'gold'][index % 6],
    accessories: [], face: ['oval', 'round', 'long'][index % 3], expression: ['smile', 'neutral', 'grin'][index % 3],
  }, id)
  return Object.freeze({ id, seed: id, name: `Guest ${index + 1}`, kind: index % 3 === 0 ? 'player' as const : 'npc' as const,
    x: Number((Math.cos(angle) * 3.15).toFixed(3)), z: Number((Math.sin(angle) * 3.15).toFixed(3)), pose: 'stand' as const, look })
})
const HOME_ITEMS = Object.freeze([
  { id: 'host-sofa', itemId: 'family-sofa', x: 2, y: 1, rot: 0 },
  { id: 'host-chair', itemId: 'plastic-chair', x: 5, y: 3, rot: 0 },
  { id: 'host-bed', itemId: 'spring-bed', x: 0, y: 4, rot: 0 },
  { id: 'host-plant', itemId: 'potted-plant', x: 4, y: 4, rot: 0 },
])
const STREET_FIXTURE: WorldStreetResponse = {
  city: 'lagos',
  anchor: { lga: 'kosofe', estate: 0, plot: 32 },
  street: { city: 'lagos', lga: 'kosofe', estate: 0, row: 2 },
  houses: [
    { plot: 29, style: packStyle({ shape: 0, wall: 2, roof: 0, door: 0, windows: 0, fence: 1, yard: 0, sign: 0 }, 'starter'), upgradeAt: 0, owner: { id: 'audit-neighbour-1', name: 'Tolu', friend: false, online: true } },
    { plot: 31, style: packStyle({ shape: 1, wall: 0, roof: 2, door: 1, windows: 1, fence: 1, yard: 0, sign: 0 }, 'duplex'), upgradeAt: 0, land: [30], owner: { id: 'audit-neighbour-2', name: 'Sade', friend: false, online: false } },
    { plot: 32, style: packStyle({ shape: 2, wall: 3, roof: 3, door: 2, windows: 2, fence: 1, yard: 0, sign: 0 }, 'villa'), upgradeAt: 0, you: true },
    { plot: 34, style: packStyle({ shape: 3, wall: 4, roof: 1, door: 3, windows: 3, fence: 1, yard: 0, sign: 0 }, 'duplex'), upgradeAt: 0, land: [35], owner: { id: 'audit-neighbour-3', name: 'Kunle', friend: true, online: true } },
    { plot: 36, style: packStyle({ shape: 0, wall: 2, roof: 0, door: 0, windows: 1, fence: 1, yard: 0, sign: 0 }, 'starter'), upgradeAt: 0, owner: { id: 'audit-neighbour-4', name: 'Bisi', friend: false, online: false } },
  ],
  land: [30, 35],
}
const OWN_STREET_HOUSE = STREET_FIXTURE.houses.find((house) => house.you)!
const OWN_HOME = unpackStyle(OWN_STREET_HOUSE.style)
const PLACES = ['home', 'neighbourhood', 'office', 'market', 'beach'] as const
const HOURS = { day: 10, dusk: 17, night: 20 } as const
type Place = typeof PLACES[number]
type TimeOfDay = keyof typeof HOURS

const hostNode = document.querySelector<HTMLElement>('#host')!
const placeControl = document.querySelector<HTMLSelectElement>('#place')!
const timeControl = document.querySelector<HTMLSelectElement>('#time')!
const crowdControl = document.querySelector<HTMLSelectElement>('#crowd')!
const statusNode = document.querySelector<HTMLElement>('#status')!
const diagnosticNode = document.querySelector<HTMLElement>('#diagnostics')!
const telemetryNode = document.querySelector<HTMLElement>('#telemetry')!
let world: VenueWorld | null = null
// Production startHome forwards asynchronous Home-ready events to a demand redraw.
let homeReadyEvents = 0
let homeReadyBaseline = 0
window.addEventListener('jaw:home-frame', () => { homeReadyEvents += 1; world?.update() })
const fixturePanel = document.querySelector<HTMLDetailsElement>('#fixture-panel')!
if (window.matchMedia('(max-width: 600px)').matches) fixturePanel.open = false
let currentPlace: Place = 'market'
let currentTime: TimeOfDay = 'day'
let crowdCount = Number(crowdControl.value)
let mountGeneration = 0
let mounting = false
let readyTicket: { context: string; signature: string; observedAt: number } | null = null
let motionSampleGeneration = 0
let cancelMotionSample: (() => void) | null = null
let activeMotionObserver: { avatarMoveCallbacks: number; pointerMoveEvents: number } | null = null
const variantControl = document.querySelector<HTMLSelectElement>('#variant')!
const controls = [...document.querySelectorAll<HTMLButtonElement>('button'), placeControl, timeControl, crowdControl, variantControl]
variantControl.addEventListener('change', () => {
  readyTicket = null
  cancelMotionSample?.()
  const generation = ++mountGeneration
  world?.dispose(); world = null; hostNode.replaceChildren(); void mount(generation)
})
document.querySelector<HTMLButtonElement>('#dispose')!.addEventListener('click', () => {
  readyTicket = null
  cancelMotionSample?.()
  ++mountGeneration; releaseHeldActions(); const before = world?.diagnostics(); world?.dispose();
  const after = world?.diagnostics(); world = null; hostNode.replaceChildren();
  diagnosticNode.textContent = JSON.stringify({ disposed: true, before, after, scope: 'actual host counters; physical device/memory bytes unverified' }, null, 2)
  setMounting(true); statusNode.textContent = 'Host disposed.'
})

function setMounting(value: boolean) {
  mounting = value
  for (const control of controls) control.disabled = value
  if (!value) document.querySelector<HTMLButtonElement>('#cancel-motion')!.disabled = !cancelMotionSample
}

function stateFor(place: Place, time: TimeOfDay) {
  const state = createLife({
    location: place,
    home: { custom: true, items: HOME_ITEMS },
    name: 'Ada Graphics',
  }, {
    cityId: CITY,
    now: Date.UTC(2026, 0, 5, HOURS[time]),
  })
  state.estate.lga = STREET_FIXTURE.anchor.lga
  state.estate.plot = { ...STREET_FIXTURE.anchor }
  state.estate.living = 'own'
  state.estate.tier = OWN_HOME.tier
  state.estate.style = { ...OWN_HOME.style }
  return state
}

function setCrowdCount() {
  if (!world) return
  crowdCount = Number(crowdControl.value)
  world.setCrowd(crowdSeeds.slice(0, crowdCount))
  statusNode.textContent = `${crowdCount} fixture crowd member${crowdCount === 1 ? '' : 's'} requested plus the host; rendering readiness is unconfirmed.`
}

function selectLocation(place: Place) {
  readyTicket = null
  cancelMotionSample?.()
  currentPlace = place
  if (place === 'home') homeReadyBaseline = homeReadyEvents
  placeControl.value = place
  if (!world) return
  const state = stateFor(place, currentTime)
  world.setState(state)
  world.setLocation(place)
  if (place === 'neighbourhood') world.setStreet(STREET_FIXTURE)
  world.recentre()
  statusNode.textContent = `Scene changed · Lagos · ${place} · ${currentTime} · actor readiness pending; use Wait for readiness.`
}

placeControl.addEventListener('change', () => {
  selectLocation(placeControl.value as Place)
})
timeControl.addEventListener('change', () => {
  readyTicket = null
  currentTime = timeControl.value as TimeOfDay
  selectLocation(currentPlace)
})
crowdControl.addEventListener('change', () => { readyTicket = null; cancelMotionSample?.(); setCrowdCount() })

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-walk]')) {
  button.addEventListener('click', () => {
    const [dx, dz] = button.dataset.walk!.split(',').map(Number)
    if (!world || !Number.isFinite(dx) || !Number.isFinite(dz) || dx === undefined || dz === undefined) return
    const accepted = world.walkBy(dx, dz)
    const snapshot = world.diagnostics()
    statusNode.textContent = `Path request ${accepted ? 'accepted' : 'rejected'} (${dx}, ${dz}); current avatar x ${snapshot.avatar.x.toFixed(2)}, z ${snapshot.avatar.z.toFixed(2)}, blocked ${snapshot.avatar.blocked}. Acceptance is not arrival.`
  })
}

type HostSnapshot = ReturnType<VenueWorld['diagnostics']>
type Readiness = {
  status: 'READY_CANONICAL' | 'READY_FALLBACK' | 'READY_PARTIAL' | 'PENDING' | 'INCONSISTENT'
  pending: string[]
  inconsistent: string[]
  unsupported: string[]
  actorVerification: 'canonical' | 'fallback' | 'partial' | 'pending'
  requestedPublicCrowd: number
  reportedPublicCrowd: unknown
  authoredPeople: unknown
  validForSceneReview: boolean
  validForCanonicalVisualReview: boolean
  signature: string
}

function contextKey() {
  return JSON.stringify({ generation: mountGeneration, variant: variantControl.value, place: currentPlace, time: currentTime, crowdCount })
}

function assessReadiness(host: HostSnapshot | null): Readiness {
  const pending: string[] = [], inconsistent: string[] = [], unsupported: string[] = []
  let authoredPeople: unknown = 'not-reported by this scene'
  let reportedPublicCrowd: unknown = 'not-reported by this scene'
  let actorVerification: Readiness['actorVerification'] = 'partial'
  let allObservedActorsCanonical = true
  let allActorCountersAvailable = true
  if (!world || mounting || !host) pending.push('host has not finished mounting')
  else {
    if (host.location !== currentPlace) pending.push(`host location is ${host.location}; waiting for ${currentPlace}`)
    if (host.loop.running || host.easing || host.avatar.moving) pending.push('host movement/camera/scene easing is still active')
    if (currentPlace === 'home' && homeReadyEvents <= homeReadyBaseline) pending.push('waiting for the production Home-ready frame event for this Home entry')

    if (host.avatarRendering === 'canonical' && host.canonicalBodyEligible) {
      // The host avatar is canonical, subject to any actor counters below.
    } else if (host.avatarRendering === 'procedural') {
      allObservedActorsCanonical = false
      unsupported.push(`host avatar is using the renderer fallback (canonical eligibility: ${host.canonicalBodyEligible}); scene review may be valid, canonical appearance review is not`)
    } else if (!host.canonicalBodyEligible) {
      pending.push(`host avatar renderer is ${host.avatarRendering}; waiting for stable fallback or canonical status`)
      allObservedActorsCanonical = false
    } else {
      pending.push(`host avatar renderer is ${host.avatarRendering}; waiting for canonical body`)
    }

    const crowd = host.crowdRendering
    if (crowd) {
      reportedPublicCrowd = crowd
      const values = [crowd.desired, crowd.canonical, crowd.procedural, crowd.loading]
      if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        inconsistent.push('public-crowd diagnostics contain invalid counts')
      } else {
        if (crowd.canonical + crowd.procedural !== crowd.desired) pending.push(`public-crowd counts reconcile ${crowd.canonical}+${crowd.procedural}/${crowd.desired}`)
        if (crowd.loading > 0) pending.push(`public crowd has ${crowd.loading} actor load(s) pending`)
        if (crowd.procedural > 0) allObservedActorsCanonical = false
      }
    } else {
      allActorCountersAvailable = false
      unsupported.push(`${currentPlace} does not expose per-public-actor canonical/loading counts`)
    }

    const authored = host.authoredPeople
    if (authored) {
      authoredPeople = authored
      const values = [authored.desired, authored.captured, authored.canonical, authored.procedural, authored.loading]
      if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        inconsistent.push('authored-person diagnostics contain invalid counts')
      } else {
        if (authored.captured !== authored.desired) pending.push(`authored calls captured ${authored.captured}/${authored.desired}`)
        if (authored.canonical + authored.procedural !== authored.desired) pending.push(`authored-person counts reconcile ${authored.canonical}+${authored.procedural}/${authored.desired}`)
        if (authored.loading > 0) pending.push(`authored people has ${authored.loading} actor load(s) pending`)
        if (authored.procedural > 0) allObservedActorsCanonical = false
      }
    } else if (currentPlace !== 'home' && currentPlace !== 'neighbourhood') {
      allActorCountersAvailable = false
      unsupported.push(`${currentPlace} does not expose authored-person counts`)
    }

    actorVerification = pending.some((item) => item.includes('actor load') || item.includes('counts reconcile') || item.includes('captured'))
      ? 'pending'
      : allObservedActorsCanonical ? (allActorCountersAvailable ? 'canonical' : 'partial') : 'fallback'
  }
  const validSceneBase = Boolean(world && !mounting && host && !pending.length && !inconsistent.length)
  const canonicalAvatar = host?.avatarRendering === 'canonical' && host.canonicalBodyEligible
  const validForSceneReview = validSceneBase
  const validForCanonicalVisualReview = validSceneBase && canonicalAvatar && allObservedActorsCanonical && allActorCountersAvailable
  const status: Readiness['status'] = pending.length ? 'PENDING' : inconsistent.length ? 'INCONSISTENT'
    : validForCanonicalVisualReview ? 'READY_CANONICAL'
      : !allObservedActorsCanonical ? 'READY_FALLBACK' : 'READY_PARTIAL'
  const signature = JSON.stringify({ status, location: host?.location, avatarRendering: host?.avatarRendering,
    canonicalBodyEligible: host?.canonicalBodyEligible, crowd: host?.crowd, crowdRendering: host?.crowdRendering,
    authoredPeople: host?.authoredPeople, renderLoop: host?.loop.running, easing: host?.easing, avatarMoving: host?.avatar.moving,
    homeReadyEvents: currentPlace === 'home' ? homeReadyEvents - homeReadyBaseline : 0,
    avatarPose: host ? { x: host.avatar.x, z: host.avatar.z, facing: host.avatar.facing, blocked: host.avatar.blocked } : null,
    cameraPose: host ? { yaw: host.camera.yaw, pitch: host.camera.pitch, zoom: host.camera.zoom } : null,
    place: currentPlace, time: currentTime, variant: variantControl.value, crowdCount })
  return { status, pending, inconsistent, unsupported, actorVerification, requestedPublicCrowd: crowdCount,
    reportedPublicCrowd, authoredPeople, validForSceneReview, validForCanonicalVisualReview, signature }
}

function snapshotEnvelope() {
  const host = world?.diagnostics() ?? null
  const report = assessReadiness(host)
  const context = contextKey()
  const ticketMatches = readyTicket?.context === context && readyTicket.signature === report.signature
  const settled = report.status.startsWith('READY_')
  const label = settled && !ticketMatches ? 'UNSETTLED · use Wait for readiness' : report.status
  const now = performance.now()
  return {
    capture: { label, validForSceneReview: ticketMatches && report.validForSceneReview, validForCanonicalVisualReview: ticketMatches && report.validForCanonicalVisualReview, capturedAt: new Date(performance.timeOrigin + now).toISOString(), monotonicMs: Number(now.toFixed(2)), stableWaitObservation: ticketMatches },
    readiness: report,
    fixture: { synthetic: true, variant: variantControl.value, city: CITY, seed: SEED, resolvedLook: LOOK,
      actualAvatarCanonicalReported: host?.avatarRendering === 'canonical' && Boolean(host?.canonicalBodyEligible), requestedPublicCrowd: crowdCount, hostCrowdReported: host?.crowd ?? null, reportedPublicCrowd: host?.crowdRendering ?? null,
      crowd: crowdSeeds.slice(0, crowdCount).map(({ id, seed, name, kind, x, z, look }) => ({ id, seed, name, kind, x, z, look })),
      place: currentPlace, time: currentTime, now: stateFor(currentPlace, currentTime).t,
      street: currentPlace === 'neighbourhood' ? STREET_FIXTURE : null,
      note: 'The host reports canonical/procedural status but does not expose a rendered-look or body-mesh hash. Fallback can qualify for scene review only; it never qualifies for canonical appearance review.' },
    homeReadyEvents: { total: homeReadyEvents, sinceCurrentHomeEntry: currentPlace === 'home' ? homeReadyEvents - homeReadyBaseline : null },
    position: world?.position() ?? null,
    canvas: canvasMetadata(),
    host,
    network: resourceInventory(),
    motionSample: lastMotionSample,
  }
}

function resourceInventory() {
  if (typeof performance.getEntriesByType !== 'function') return { status: 'unsupported', reason: 'Performance.getEntriesByType is unavailable' }
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  if (!entries.length) return { status: 'unsupported', reason: 'No Resource Timing entries are currently retained' }
  const resources = entries.map((entry) => {
    let name = entry.name
    try {
      const url = new URL(entry.name, location.href)
      name = url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`
    } catch { /* Keep the browser-provided name when URL parsing is unavailable. */ }
    return { name, initiatorType: entry.initiatorType, durationMs: Number(entry.duration.toFixed(2)),
      transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize }
  })
  const byteEntries = resources.filter((entry) => entry.transferSize > 0 || entry.encodedBodySize > 0 || entry.decodedBodySize > 0).length
  return { status: 'observed', retainedEntries: resources.length, byteSizeSupport: byteEntries ? 'some entries expose sizes' : 'unsupported-or-cached: all observed size fields are zero',
    completeness: 'only entries currently retained by the browser Resource Timing buffer; not a packet trace', resources }
}

let lastMotionSample: Record<string, unknown> | null = null
function percentile(sorted: number[], part: number) {
  if (!sorted.length) return null
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * part) - 1)]!.toFixed(2))
}

function startMotionSample() {
  if (!world || typeof requestAnimationFrame !== 'function') {
    lastMotionSample = { status: 'unsupported', reason: 'Host or requestAnimationFrame unavailable' }
    telemetryNode.textContent = JSON.stringify(lastMotionSample, null, 2)
    return
  }
  const startingContext = contextKey()
  const beforeHost = world.diagnostics()
  const initialReadiness = assessReadiness(beforeHost)
  const hasCurrentStableTicket = readyTicket?.context === startingContext && readyTicket.signature === initialReadiness.signature
  if (!initialReadiness.validForSceneReview || !hasCurrentStableTicket) {
    lastMotionSample = { status: 'not-started', reason: 'Run Wait for readiness and Capture snapshot for this exact scene, crowd, variant, and pose before sampling.', readiness: initialReadiness.status, stableTicketMatches: hasCurrentStableTicket }
    telemetryNode.textContent = JSON.stringify({ network: resourceInventory(), motionSample: lastMotionSample }, null, 2)
    return
  }
  cancelMotionSample?.()
  const sampleId = ++motionSampleGeneration
  const durationMs = 8000
  const began = performance.now()
  const visibleAtStart = document.visibilityState
  let previous = 0, frameId = 0, finished = false
  const intervals: number[] = []
  let wallTimeout = 0
  const beforeCanvas = canvasMetadata()
  const observer = { avatarMoveCallbacks: 0, pointerMoveEvents: 0 }
  activeMotionObserver = observer
  const onPointerMove = () => { observer.pointerMoveEvents += 1 }
  hostNode.addEventListener('pointermove', onPointerMove, { passive: true })
  const sampleButton = document.querySelector<HTMLButtonElement>('#motion-sample')!
  const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-motion')!
  sampleButton.disabled = true
  cancelButton.disabled = false
  sampleButton.blur()
  statusNode.textContent = 'rAF sample running · move the host with WASD/arrow keys or orbit by dragging now.'

  const finish = (state: 'complete' | 'cancelled' | 'timed-out') => {
    if (sampleId !== motionSampleGeneration || finished) return
    finished = true
    if (frameId) cancelAnimationFrame(frameId)
    if (wallTimeout) clearTimeout(wallTimeout)
    const after = world?.diagnostics() ?? null
    const sorted = intervals.slice().sort((a, b) => a - b)
    const afterCanvas = canvasMetadata()
    const canvasUnchanged = JSON.stringify(afterCanvas) === JSON.stringify(beforeCanvas)
    const contextUnchanged = contextKey() === startingContext
    const visibleAtEnd = document.visibilityState
    const duration = Math.max(0, performance.now() - began)
    hostNode.removeEventListener('pointermove', onPointerMove)
    if (activeMotionObserver === observer) activeMotionObserver = null
    const avatarPositionChanged = Boolean(after && (after.avatar.x !== beforeHost.avatar.x || after.avatar.z !== beforeHost.avatar.z || after.avatar.facing !== beforeHost.avatar.facing))
    const cameraPoseChanged = Boolean(after && (after.camera.yaw !== beforeHost.camera.yaw || after.camera.pitch !== beforeHost.camera.pitch || after.camera.zoom !== beforeHost.camera.zoom))
    lastMotionSample = { status: state, durationMs: Number(duration.toFixed(2)), callbackIntervals: intervals.length,
      rAFcallbackIntervalMs: { p50: percentile(sorted, 0.50), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: percentile(sorted, 1) },
      observedHostMotion: { avatarMoveCallbacks: observer.avatarMoveCallbacks, avatarPositionChanged, cameraPoseChanged,
        pointerMoveEvents: observer.pointerMoveEvents, anyConfirmed: observer.avatarMoveCallbacks > 0 || avatarPositionChanged || cameraPoseChanged },
      validForMovingHostTiming: state === 'complete' && contextUnchanged && canvasUnchanged && visibleAtStart === 'visible' && visibleAtEnd === 'visible' && (observer.avatarMoveCallbacks > 0 || avatarPositionChanged || cameraPoseChanged),
      hostRenderCountDelta: after ? after.renderCount - beforeHost.renderCount : null,
      sampleContext: { context: startingContext, unchanged: contextUnchanged },
      canvas: { before: beforeCanvas, after: afterCanvas, unchanged: canvasUnchanged },
      visibility: { start: visibleAtStart, end: visibleAtEnd },
      unsupported: ['rAF callback intervals are not GPU time or guaranteed presented/displayed-frame timing', 'Pointer movement is input evidence only, not proof of camera motion', 'No physical-phone timing claim'] }
    cancelMotionSample = null
    sampleButton.disabled = false
    cancelButton.disabled = true
    telemetryNode.textContent = JSON.stringify({ network: resourceInventory(), motionSample: lastMotionSample }, null, 2)
    statusNode.textContent = state === 'complete'
      ? (observer.avatarMoveCallbacks > 0 || avatarPositionChanged || cameraPoseChanged ? 'rAF sample complete · host motion was observed.' : 'rAF sample complete · no host motion was observed; intervals may reflect idle callback timing.')
      : state === 'timed-out' ? 'rAF sample timed out because callbacks were throttled; partial timing is not a valid comparison.' : 'rAF sample cancelled.'
  }
  cancelMotionSample = () => {
    if (sampleId !== motionSampleGeneration) return
    cancelAnimationFrame(frameId)
    finish('cancelled')
    ++motionSampleGeneration
  }
  const tick = (now: number) => {
    if (sampleId !== motionSampleGeneration || finished) return
    if (previous) intervals.push(now - previous)
    previous = now
    if (now - began >= durationMs) finish('complete')
    else frameId = requestAnimationFrame(tick)
  }
  wallTimeout = window.setTimeout(() => finish('timed-out'), durationMs + 4000)
  frameId = requestAnimationFrame(tick)
}

document.querySelector<HTMLButtonElement>('#motion-sample')!.addEventListener('click', startMotionSample)
document.querySelector<HTMLButtonElement>('#cancel-motion')!.addEventListener('click', () => cancelMotionSample?.())

document.querySelector<HTMLButtonElement>('#wait-ready')!.addEventListener('click', async (event) => {
  if (!world || mounting) return
  const button = event.currentTarget as HTMLButtonElement
  const startingContext = contextKey()
  const began = performance.now()
  const deadline = began + 15000
  let previousReadySignature = ''
  let stableObservations = 0
  let report = assessReadiness(world.diagnostics())
  button.disabled = true
  readyTicket = null
  try {
    while (performance.now() < deadline) {
      if (contextKey() !== startingContext || !world) {
        statusNode.textContent = 'Readiness wait cancelled because place, time, crowd, variant, or host changed.'
        break
      }
      report = assessReadiness(world.diagnostics())
      if (report.status.startsWith('READY_')) {
        stableObservations = report.signature === previousReadySignature ? stableObservations + 1 : 1
        previousReadySignature = report.signature
        if (stableObservations >= 2) {
          readyTicket = { context: startingContext, signature: report.signature, observedAt: performance.now() }
          statusNode.textContent = `${report.status} · stable for two observations (${Math.round(performance.now() - began)} ms). ${report.validForCanonicalVisualReview ? 'Canonical visual review is supported.' : 'Scene review only; canonical appearance is not verified.'}`
          break
        }
      } else {
        stableObservations = 0
        previousReadySignature = ''
        statusNode.textContent = `${report.status} · ${[...report.pending, ...report.inconsistent, ...report.unsupported].join('; ') || 'waiting for stable scene'}`
        if (!report.pending.length && report.inconsistent.length) break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } finally {
    button.disabled = false
  }
  const finishedAt = performance.now()
  report = assessReadiness(world?.diagnostics() ?? null)
  diagnosticNode.textContent = JSON.stringify({ wait: { startedAt: new Date(performance.timeOrigin + began).toISOString(), finishedAt: new Date(performance.timeOrigin + finishedAt).toISOString(), elapsedMs: Number((finishedAt - began).toFixed(2)), timeoutMs: 15000, timeout: finishedAt >= deadline, stableObservations }, readiness: report, readyTicket }, null, 2)
})

document.querySelector<HTMLButtonElement>('#snapshot')!.addEventListener('click', () => {
  const snapshot = snapshotEnvelope()
  diagnosticNode.textContent = JSON.stringify(snapshot, null, 2)
  telemetryNode.textContent = JSON.stringify({ network: snapshot.network, motionSample: lastMotionSample,
    unsupported: { presentedFrameOrGpuTiming: 'not exposed by browser rAF sampling', phonePerformance: 'not measured' } }, null, 2)
})

function canvasMetadata() {
  const canvas = hostNode.querySelector('canvas')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  return {
    css: { width: Math.round(rect.width), height: Math.round(rect.height) },
    drawingBuffer: { width: canvas.width, height: canvas.height },
    devicePixelRatio: window.devicePixelRatio,
  }
}

document.querySelector<HTMLButtonElement>('#rebuild')!.addEventListener('click', () => {
  if (mounting) return
  readyTicket = null
  cancelMotionSample?.()
  const generation = ++mountGeneration
  world?.dispose()
  world = null
  hostNode.replaceChildren()
  diagnosticNode.textContent = 'Host disposed; rebuilding from the same deterministic state…'
  void mount(generation)
})

addEventListener('resize', () => { cancelMotionSample?.(); readyTicket = null; world?.resize() })
window.addEventListener('blur', () => cancelMotionSample?.())
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') cancelMotionSample?.() })

// Mirror the shell's keyboard bridge from App.vue with the shared shortcut table. Key releases are
// tracked so a blur/tab switch cannot leave a walk, jog, or camera turn held in the host.
const heldActions = new Set<string>()
const isFocusedControl = (target: EventTarget | null) => target instanceof Element && (target.matches('input, textarea, select, button, a, summary, [contenteditable="true"]') || (target as HTMLElement).isContentEditable)
const sendHostKey = (action: string, jog = false) => window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action, mode: 'venue', jog } }))
const sendHostKeyUp = (action: string) => window.dispatchEvent(new CustomEvent('jaw:key-up', { detail: { action } }))

function onKeyDown(event: KeyboardEvent) {
  if (isFocusedControl(event.target)) return
  const shortcut = shortcutFor(event)
  if (!shortcut) return
  const [verb = '', arg = ''] = shortcut.run.split(':')
  if (verb === 'key') {
    if (arg.startsWith('move-')) event.preventDefault()
    sendHostKey(arg, event.shiftKey)
    if (arg.startsWith('move-')) heldActions.add(arg)
  } else if (verb === 'walk' || verb === 'look') {
    const action = `${verb}-${arg}`
    if (arg !== 'jog') event.preventDefault()
    sendHostKey(action, event.shiftKey)
    heldActions.add(action)
  }
}

function onKeyUp(event: KeyboardEvent) {
  const action = heldActionFor(event)
  if (!action) return
  heldActions.delete(action)
  sendHostKeyUp(action)
}

function releaseHeldActions() {
  for (const action of heldActions) sendHostKeyUp(action)
  heldActions.clear()
}

window.addEventListener('keydown', onKeyDown)
window.addEventListener('keyup', onKeyUp)
window.addEventListener('blur', releaseHeldActions)
window.addEventListener('pagehide', releaseHeldActions)
window.addEventListener('pagehide', () => cancelMotionSample?.())

function motionStatus(at: { x: number; z: number; location: string | null }) {
  if (activeMotionObserver) activeMotionObserver.avatarMoveCallbacks += 1
  if (!mounting) statusNode.textContent = `Host moved · ${at.location ?? currentPlace} · x ${at.x.toFixed(2)}, z ${at.z.toFixed(2)}`
}

async function mount(generation = ++mountGeneration) {
  setMounting(true)
  if (currentPlace === 'home') homeReadyBaseline = homeReadyEvents
  statusNode.textContent = 'Loading Lagos content and scene parts…'
  let candidate: VenueWorld | null = null
  try {
    await loadCityContent(CITY)
    await loadCityScenes(CITY)
    if (generation !== mountGeneration) return
    candidate = (variantControl.value === 'baseline' ? createVenueWorld : candidateWorld)(hostNode, {
      cityId: CITY,
      buildHome: variantControl.value === 'baseline' ? undefined : candidateHome,
      location: currentPlace,
      buildNeighbourhood: variantControl.value === 'baseline' ? buildNeighbourhoodScene : candidateNeighbourhood,
      onMove: motionStatus,
      onHomeDoor: (direction) => selectLocation(direction === 'outside' ? 'neighbourhood' : 'home'),
      onStreetGate: () => selectLocation('market'),
    })
    candidate.setPlayer({ look: LOOK, seed: SEED, name: 'Ada' })
    candidate.setCrowd(crowdSeeds.slice(0, crowdCount))
    candidate.setState(stateFor(currentPlace, currentTime))
    candidate.setLocation(currentPlace)
    if (currentPlace === 'neighbourhood') candidate.setStreet(STREET_FIXTURE)
    candidate.recentre()
    if (generation !== mountGeneration) {
      candidate.dispose()
      candidate = null
      return
    }
    world = candidate
    candidate = null
    statusNode.textContent = `Host mounted · Lagos · ${currentPlace} · ${currentTime} · ${crowdCount} fixture crowd requested · readiness not yet confirmed; use Wait.`
  } catch (error) {
    console.error(error)
    statusNode.textContent = `Fixture failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    candidate?.dispose()
    if (generation === mountGeneration) setMounting(false)
  }
}

void mount()
