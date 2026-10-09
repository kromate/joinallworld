export function expectedPackageArtifact(runId) {
  if (typeof runId !== 'string' || !/^[1-9][0-9]*$/.test(runId)) throw new Error('Package run ID must be a positive numeric workflow run ID')
  return `environment-sofa-upholstery-cpu-v1-${runId}`
}

export function validatePackageSelection({ runId, commit, artifact }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Exact 40-character package source commit is required')
  if (artifact !== expectedPackageArtifact(runId)) throw new Error('Downloaded candidate package artifact name does not match its run ID')
  return Object.freeze({ runId, commit, artifact })
}
