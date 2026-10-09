import { openSync, closeSync, writeSync, fsyncSync } from 'node:fs'
import path from 'node:path'

export const LIMITS = Object.freeze({ ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3, screenshotTimeoutMs: 7000 })
export const CAPTURE_METHODS = Object.freeze({
  'surface-true': Object.freeze({ fromSurface: true, clip: null }),
  'surface-false': Object.freeze({ fromSurface: false, clip: null }),
  'canvas-clip': Object.freeze({ fromSurface: true, clip: 'canvas-rect' }),
})
export const REVIEW_SCOPES = Object.freeze(Object.fromEntries(
  ['market', 'beach'].flatMap(place => Object.keys(CAPTURE_METHODS).map(method => {
    const id = `${place}-${method}`
    return [id, Object.freeze({ place, method, control: Object.freeze({ place: 'home', time: 'day' }), target: Object.freeze({ place, time: 'day' }), peer: place === 'market' ? 'beach' : 'market' })]
  })),
))

export function capturesForScope(scopeId) {
  const scope = REVIEW_SCOPES[scopeId]
  if (!scope) throw new Error(`Unknown NPC startup diagnostic scope: ${scopeId}`)
  return Object.freeze([
    Object.freeze({ role: 'home-control', ...scope.control, method: scope.method }),
    Object.freeze({ role: 'target', ...scope.target, method: scope.method }),
  ])
}

export function validateCanonicalSnapshot(snapshot, expected, { requireCrowd = false } = {}) {
  const reasons = []
  const host = snapshot?.host
  if (snapshot?.fixture?.place !== expected.place) reasons.push('fixture place mismatch')
  if (snapshot?.fixture?.time !== expected.time) reasons.push('fixture time mismatch')
  if (host?.location !== expected.place) reasons.push('host location mismatch')
  if (!snapshot?.readiness?.status?.startsWith('READY_')) reasons.push('readiness is not READY')
  if (snapshot?.capture?.validForSceneReview !== true) reasons.push('stable scene ticket missing')
  if (snapshot?.capture?.validForCanonicalVisualReview !== true) reasons.push('canonical visual ticket missing')
  if (host?.avatarRendering !== 'canonical' || host?.canonicalBodyEligible !== true) reasons.push('host avatar is not canonical/eligible')
  if (requireCrowd) {
    const crowd = host?.crowdRendering
    if (!crowd || crowd.desired !== 12 || crowd.canonical !== 12 || crowd.procedural !== 0 || crowd.loading !== 0) reasons.push('public crowd is not 12/12 canonical with no fallback/loading')
    if (snapshot?.fixture?.requestedPublicCrowd !== 12) reasons.push('fixture did not request twelve public actors')
    const authored = host?.authoredPeople
    if (authored && (authored.desired !== authored.captured || authored.canonical !== authored.desired || authored.procedural !== 0 || authored.loading !== 0)) reasons.push('authored people are not fully canonical')
  }
  if (![host?.drawCalls, host?.triangles, host?.geometries].every(Number.isFinite)) reasons.push('host draw/triangle/geometry counters unavailable')
  return Object.freeze({ valid: reasons.length === 0, reasons: Object.freeze(reasons) })
}

// Preserve the durable image receipt helper's general scene validation. The controller separately
// applies validateCanonicalSnapshot before a CDP screenshot request.
export function validateCaptureSnapshot(snapshot, expected) {
  const reasons = []
  if (snapshot?.fixture?.place !== expected.place) reasons.push('fixture place mismatch')
  if (snapshot?.fixture?.time !== expected.time) reasons.push('fixture time mismatch')
  if (snapshot?.host?.location !== expected.place) reasons.push('host location mismatch')
  if (!snapshot?.readiness?.status?.startsWith('READY_')) reasons.push('readiness is not READY')
  if (snapshot?.capture?.validForSceneReview !== true) reasons.push('stable scene ticket missing')
  return Object.freeze({ valid: reasons.length === 0, reasons: Object.freeze(reasons) })
}
export function persistCaptureProgress(resultDir, record) {
  const fd = openSync(path.join(resultDir, 'captures-progress.jsonl'), 'a', 0o600)
  try { writeSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
}
