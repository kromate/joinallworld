export function expectedPackageArtifact(runId) {
  if (runId !== '37914543927') throw new Error('Only the sealed successful sofa CPU package run is accepted')
  return 'environment-sofa-upholstery-cpu-v5-37914543927'
}

export function validatePackageSelection({ runId, commit, artifact }) {
  if (runId !== '37914543927' || commit !== '10b383754b68c758ba002bb9fbe1e5f5fe668511') throw new Error('CPU package must match the exact frozen successful run and source commit')
  if (artifact !== expectedPackageArtifact(runId)) throw new Error('Downloaded candidate package artifact name does not match its run ID')
  return Object.freeze({ runId, commit, artifact })
}
