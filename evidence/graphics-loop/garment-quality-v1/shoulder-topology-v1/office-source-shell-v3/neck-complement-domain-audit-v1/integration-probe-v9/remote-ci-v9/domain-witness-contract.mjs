/** Validate the small display-state summary and, when requested, its full pose-witness audit. */
export function assertDomainWitness(summary, details, requireDetails = false) {
  if (summary?.domainMatchesActualCandidate !== true || !Number.isInteger(summary.excludedResidualFaces) || summary.excludedResidualFaces < 0) {
    throw new Error(`Independent neck-domain summary is missing or inconsistent: ${JSON.stringify(summary ?? null)}`);
  }
  if (details === undefined || details === null) {
    if (requireDetails) throw new Error('Full independent neck-domain witness is required for pose validation');
    return true;
  }
  const excluded = details.excludedFullNeckResidualFaceIds;
  if (details.domainMatchesActualCandidate !== true || !Array.isArray(excluded) || excluded.some(face => !Number.isInteger(face)) || summary.excludedResidualFaces !== excluded.length) {
    throw new Error(`Full independent neck-domain witness disagrees with its summary: ${JSON.stringify({ summary, details })}`);
  }
  return true;
}
