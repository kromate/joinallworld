import { openSync, closeSync, writeSync, fsyncSync } from 'node:fs'
import path from 'node:path'

export const LIMITS = Object.freeze({ ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3 })
export const REVIEW_SCOPES = Object.freeze({
  'scene-pair-home-neighbourhood': Object.freeze({ kind: 'scene-pair', scenes: Object.freeze(['home', 'neighbourhood']), times: Object.freeze(['day', 'night']) }),
  'scene-pair-market-beach': Object.freeze({ kind: 'scene-pair', scenes: Object.freeze(['market', 'beach']), times: Object.freeze(['day', 'night']) }),
  'lifecycle-only': Object.freeze({ kind: 'lifecycle-only', anchor: Object.freeze({ place: 'market', time: 'day' }), actions: Object.freeze(['walk-request', 'dispose-rebuild', 'permanent-dispose']) }),
})

export function capturesForScope(scopeId) {
  const scope = REVIEW_SCOPES[scopeId]
  if (!scope) throw new Error(`Unknown review scope: ${scopeId}`)
  if (scope.kind === 'lifecycle-only') return Object.freeze([])
  return Object.freeze(scope.scenes.flatMap(place => scope.times.map(time => Object.freeze({ place, time, label: `${place}-${time}` }))))
}

export function validateCaptureSnapshot(snapshot, expected) {
  const reasons = []
  if (!snapshot || snapshot.fixture?.place !== expected.place) reasons.push('fixture place mismatch')
  if (!snapshot || snapshot.fixture?.time !== expected.time) reasons.push('fixture time mismatch')
  if (!snapshot?.host || snapshot.host.location !== expected.place) reasons.push('host location mismatch')
  if (!snapshot?.readiness?.status?.startsWith('READY_')) reasons.push('readiness is not in a stable READY state')
  if (snapshot?.capture?.validForSceneReview !== true) reasons.push('snapshot has no stable readiness ticket')
  if (expected.place === 'home' && snapshot?.capture?.validForCanonicalVisualReview !== true) reasons.push('Home current-body canonical proof is not valid')
  return Object.freeze({ valid: reasons.length === 0, reasons: Object.freeze(reasons) })
}

/** Durable per-capture append: one fsync'd JSONL receipt per image, independent of final report completion. */
export function persistCaptureProgress(resultDir, record) {
  return appendDurableRecord(resultDir, 'captures-progress.jsonl', record)
}

export function persistLifecycleProgress(resultDir, record) {
  return appendDurableRecord(resultDir, 'lifecycle-progress.jsonl', record)
}

function appendDurableRecord(resultDir, name, record) {
  const file = path.join(resultDir, name)
  const fd = openSync(file, 'a', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  return file
}
