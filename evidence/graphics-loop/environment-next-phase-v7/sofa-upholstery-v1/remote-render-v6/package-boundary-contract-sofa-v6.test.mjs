import assert from 'node:assert/strict'
import test from 'node:test'
import { assertFinalizerOutputPin, finalizerOutputPinPath, validateCandidatePackageHeaders } from './package-boundary-contract-sofa-v6.mjs'

const valid = () => ({
  sourcePins: { schema: 'sofa-upholstery-v1-source-pins/3', status: 'PREBUILD_SEALED' }, sourcePinsSha: 'source',
  manifest: { schema: 'sofa-upholstery-v1-diagnostic-manifest/3', status: 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE', sourcePinsSha256: 'source', compileRecordSha256: 'compile' },
  compile: { schema: 'sofa-upholstery-v1-compiled-record/2', status: 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY', sourcePinsSha256: 'source' }, compileSha: 'compile',
  finalizerPins: { schema: 'sofa-upholstery-v1-finalizer-pins/3', status: 'PRE_FINALIZATION_SEALED' }, finalizerPinsSha: 'finalizer',
  finalization: { status: 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW', sourcePinsSha256: 'source', compileRecordSha256: 'compile', finalizerPinsSha256: 'finalizer', manifestSha256: 'manifest' }, manifestSha: 'manifest',
})

test('accepts reconciled successful v1 package headers used by render v6', () => {
  assert.equal(validateCandidatePackageHeaders(valid()), true)
})

test('rejects a stale v5 render-recipe schema expectation', () => {
  const input = valid()
  input.manifest = { ...input.manifest, schema: 'sofa-upholstery-v1-diagnostic-manifest/2' }
  assert.throws(() => validateCandidatePackageHeaders(input), /manifest schema\/status/)
})

test('rejects a detached manifest or compile receipt', () => {
  const input = valid()
  input.compileSha = 'different'
  assert.throws(() => validateCandidatePackageHeaders(input), /compile record/)
})

test('maps candidate outputs to the exact repository-relative finalizer path', () => {
  assert.equal(finalizerOutputPinPath('evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1', 'app/viewer-sofa-compare.js'),
    'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1/app/viewer-sofa-compare.js')
})

test('rejects traversal in a finalizer path mapping', () => {
  assert.throws(() => finalizerOutputPinPath('evidence/static-sofa-v1', '../outside.js'), /Unsafe compiled output path/)
})

test('accepts the actual frozen CPU artifact candidate-viewer pin row', () => {
  const actualPinnedRow = { path: 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1/app/viewer-sofa-compare.js', sha256: 'cd1ec7171d2f523e0b796b2dfb904900c0fd3162ccc91b8ba026efa2f252a9da', bytes: 1536327 }
  assert.equal(assertFinalizerOutputPin([actualPinnedRow], 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1', 'app/viewer-sofa-compare.js', actualPinnedRow.sha256, actualPinnedRow.bytes), actualPinnedRow)
})

test('rejects the real viewer pin when its digest is detached', () => {
  const actualPinnedRow = { path: 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1/app/viewer-sofa-compare.js', sha256: 'cd1ec7171d2f523e0b796b2dfb904900c0fd3162ccc91b8ba026efa2f252a9da', bytes: 1536327 }
  assert.throws(() => assertFinalizerOutputPin([actualPinnedRow], 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1', 'app/viewer-sofa-compare.js', '0'.repeat(64), actualPinnedRow.bytes), /does not match/)
})
