export const PINNED_CPU_RUN_ID = '37911271949'
export const PINNED_CPU_COMMIT = '0da02ca0f0e0c4350f2754615f58b2dcd6eaed37'
export const PINNED_CPU_ARTIFACT = `environment-npc-startup-fix-v1-package-v1-${PINNED_CPU_RUN_ID}`

export function validatePackageSelection({ runId, commit, artifact, pinsCommit = commit }) {
  if (runId !== PINNED_CPU_RUN_ID) throw new Error('CPU package run does not match the root-verified diagnostic run')
  if (commit !== PINNED_CPU_COMMIT || pinsCommit !== PINNED_CPU_COMMIT) throw new Error('CPU package commit does not match the root-verified diagnostic commit')
  if (artifact !== PINNED_CPU_ARTIFACT) throw new Error('CPU package artifact does not match the root-verified diagnostic artifact')
  return Object.freeze({ runId, commit, artifact })
}
