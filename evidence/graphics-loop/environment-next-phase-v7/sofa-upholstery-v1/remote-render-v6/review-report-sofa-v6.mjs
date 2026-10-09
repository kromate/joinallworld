/** Pure report assembly kept outside the browser controller's try block. */
export function matchedSofaPairs(expectedCaptures, captures) {
  return expectedCaptures.filter(row => row.variant === 'baseline').map(base => {
    const candidate = captures.find(item => item.label === `sofa-candidate-${base.time}-${base.camera}-${base.pose}`)
    const baseline = captures.find(item => item.label === base.label)
    const sameAvatarAnchor = Boolean(baseline && candidate && ['x', 'y', 'z'].every(key => baseline.host?.avatar?.[key] === candidate.host?.avatar?.[key]))
    const sameSeatTarget = Boolean(baseline && candidate && JSON.stringify(baseline.fixture?.sofaSeatTarget) === JSON.stringify(candidate.fixture?.sofaSeatTarget))
    return { time: base.time, camera: base.camera, pose: base.pose, baseline: baseline?.file ?? null, candidate: candidate?.file ?? null,
      sameAvatarAnchor, sameSeatTarget,
      baselineCounters: baseline?.host ? { drawCalls: baseline.host.drawCalls, triangles: baseline.host.triangles, geometries: baseline.host.geometries, geometryStorage: baseline.geometryStorage } : null,
      candidateCounters: candidate?.host ? { drawCalls: candidate.host.drawCalls, triangles: candidate.host.triangles, geometries: candidate.host.geometries, geometryStorage: candidate.geometryStorage } : null,
      counterDelta: baseline?.host && candidate?.host ? { drawCalls: candidate.host.drawCalls - baseline.host.drawCalls,
        triangles: candidate.host.triangles - baseline.host.triangles, geometries: candidate.host.geometries - baseline.host.geometries,
        cpuGeometryBytes: (candidate.geometryStorage?.cpuAttributeAndIndexBytes ?? null) - (baseline.geometryStorage?.cpuAttributeAndIndexBytes ?? null) } : null }
  })
}

export function assembleSofaReviewSummary({ expectedCaptures, captures, emittedEntryComparison = null }) {
  return { matchedPairs: matchedSofaPairs(expectedCaptures, captures), emittedEntryComparison }
}
