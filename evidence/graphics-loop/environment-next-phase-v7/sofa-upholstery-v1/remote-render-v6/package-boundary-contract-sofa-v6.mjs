export function validateCandidatePackageHeaders({ sourcePins, sourcePinsSha, manifest, compile, compileSha, finalizerPins, finalizerPinsSha, finalization, manifestSha }) {
  const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
  requireValue(sourcePins?.schema === 'sofa-upholstery-v1-source-pins/3' && sourcePins.status === 'PREBUILD_SEALED', 'Candidate source pin schema/status is invalid')
  requireValue(manifest?.schema === 'sofa-upholstery-v1-diagnostic-manifest/3' && manifest.status === 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE', 'Candidate manifest schema/status is invalid')
  requireValue(compile?.schema === 'sofa-upholstery-v1-compiled-record/2' && compile.status === 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY', 'Candidate compile schema/status is invalid')
  requireValue(finalizerPins?.schema === 'sofa-upholstery-v1-finalizer-pins/3' && finalizerPins.status === 'PRE_FINALIZATION_SEALED', 'Candidate finalizer schema/status is invalid')
  requireValue(finalization?.status === 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW', 'Candidate finalization status is invalid')
  requireValue(manifest.sourcePinsSha256 === sourcePinsSha && compile.sourcePinsSha256 === sourcePinsSha && finalization.sourcePinsSha256 === sourcePinsSha, 'Candidate receipts do not bind the exact source-pin manifest')
  requireValue(manifest.compileRecordSha256 === compileSha && finalization.compileRecordSha256 === compileSha, 'Candidate receipts do not bind the exact compile record')
  requireValue(finalization.finalizerPinsSha256 === finalizerPinsSha && finalization.manifestSha256 === manifestSha, 'Candidate finalization does not bind finalizer pins and manifest')
  return true
}

export function finalizerOutputPinPath(prefix, outputPath) {
  if (typeof prefix !== 'string' || !prefix || prefix.startsWith('/') || prefix.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe finalizer output prefix')
  if (typeof outputPath !== 'string' || !outputPath || outputPath.startsWith('/') || outputPath.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe compiled output path')
  return `${prefix}/${outputPath.split('\\').join('/')}`
}

export function assertFinalizerOutputPin(files, prefix, outputPath, expectedSha256, expectedBytes) {
  const pinnedPath = finalizerOutputPinPath(prefix, outputPath)
  const row = files.find(item => item.path === pinnedPath)
  if (!row || row.sha256 !== expectedSha256 || row.bytes !== expectedBytes) throw new Error(`Finalizer output pin does not match: ${pinnedPath}`)
  return row
}
