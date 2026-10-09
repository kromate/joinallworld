export const LIMITS = Object.freeze({ ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 1 })
export const REVIEW_SCOPES = Object.freeze({
  'sofa-home': Object.freeze({ kind: 'sofa-home', variants: Object.freeze(['baseline', 'candidate']), times: Object.freeze(['day', 'night']), cameras: Object.freeze(['normal', 'close']), pose: 'sit' }),
})
export function capturesForScope(scopeId) {
  const scope = REVIEW_SCOPES[scopeId]
  if (!scope) throw new Error(`Unknown review scope: ${scopeId}`)
  return Object.freeze(scope.variants.flatMap(variant => scope.times.flatMap(time => scope.cameras.map(camera => Object.freeze({
    variant, time, camera, pose: scope.pose, place: 'home', label: `sofa-${variant}-${time}-${camera}-${scope.pose}`
  })))))
}
export function validateCaptureSnapshot(snapshot, expected) {
  const reasons = []
  if (!snapshot || snapshot.fixture?.place !== 'home') reasons.push('fixture is not Home')
  if (!snapshot || snapshot.fixture?.time !== expected.time) reasons.push('time mismatch')
  if (!snapshot || snapshot.fixture?.variant !== expected.variant) reasons.push('variant mismatch')
  if (!snapshot || snapshot.fixture?.cameraPreset !== expected.camera) reasons.push('camera preset mismatch')
  if (!snapshot || snapshot.fixture?.homePose !== 'sit' || snapshot.fixture?.sofaSeatActivity !== 'home-sit-down') reasons.push('sofa seated activity not requested')
  if (!snapshot?.host || snapshot.host.location !== 'home') reasons.push('host is not in Home')
  if (!snapshot?.readiness?.status?.startsWith('READY_')) reasons.push('readiness is not stable')
  if (snapshot?.capture?.validForCanonicalVisualReview !== true) reasons.push('Home canonical visual proof is invalid')
  if (!snapshot?.host?.avatar || !snapshot.canvas?.drawingBuffer?.width) reasons.push('host render/canvas counters missing')
  return Object.freeze({ valid: reasons.length === 0, reasons: Object.freeze(reasons) })
}
