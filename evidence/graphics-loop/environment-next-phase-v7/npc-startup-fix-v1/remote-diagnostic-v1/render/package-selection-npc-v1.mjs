export function validatePackageSelection({ runId, commit, artifact, pinsCommit = commit }) {
  if (!/^\d{8,}$/.test(runId ?? '')) throw new Error('Pinned CPU package run ID is missing')
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || pinsCommit !== commit) throw new Error('CPU package commit differs from source pin manifest')
  if (artifact !== `environment-npc-startup-fix-v1-package-v1-${runId}`) throw new Error('CPU package artifact name is not derived from pinned run ID')
  return Object.freeze({ runId, commit, artifact })
}
