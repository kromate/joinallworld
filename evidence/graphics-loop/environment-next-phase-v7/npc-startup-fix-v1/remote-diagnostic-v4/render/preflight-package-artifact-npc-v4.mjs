import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readSync } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PINNED_CPU_COMMIT, PINNED_CPU_RUN_ID, PINNED_CPU_SOURCE_PINS_SHA, validatePackageSelection } from './package-selection-npc-v4.mjs'
import { validateStartupAttestation } from './startup-attestation-npc-v4.mjs'

const packageRoot = path.resolve(process.env.PACKAGE_ROOT ?? '')
const sourceRoot = path.resolve(process.env.CPU_SOURCE_ROOT ?? '')
if (!process.env.PACKAGE_ROOT || !process.env.CPU_SOURCE_ROOT) throw new Error('PACKAGE_ROOT and CPU_SOURCE_ROOT are required')

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error(`Unsafe relative path: ${relative}`)
  const target = path.resolve(root, relative)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escaped root: ${relative}`)
  return target
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
// Reuse one bounded buffer across the serial pin inventory. Per-file streams allocate
// external buffers repeatedly and can exceed the small preflight RSS cap before GC.
const hashBuffer = Buffer.allocUnsafe(64 * 1024)
async function hashFile(file) {
  const hash = createHash('sha256')
  const descriptor = openSync(file, 'r')
  try {
    for (;;) {
      const count = readSync(descriptor, hashBuffer, 0, hashBuffer.length, null)
      if (count === 0) return hash.digest('hex')
      hash.update(hashBuffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
}
async function fileHash(root, relative) {
  const target = inside(root, relative)
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected regular file: ${relative}`)
  return { bytes: info.size, sha256: await hashFile(target) }
}
async function walk(dir, rel = '') {
  const result = []
  for (const item of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.posix.join(rel.split(path.sep).join('/'), item.name)
    if (item.isDirectory()) result.push(...await walk(dir, next))
    else if (item.isFile()) result.push(next)
    else throw new Error(`Unexpected package output entry: ${next}`)
  }
  return result
}

const sourcePinsRel = 'source-pins-npc-v1.json'
const sourcePinsBytes = await readFile(inside(packageRoot, sourcePinsRel))
if (sha(sourcePinsBytes) !== PINNED_CPU_SOURCE_PINS_SHA) throw new Error('CPU source-pin manifest differs from the root-verified digest')
const pins = JSON.parse(sourcePinsBytes)
if (pins.schema !== 'environment-next-phase-v7-npc-startup-source-pins/1' || pins.status !== 'PREBUILD_SEALED' || pins.gitCommit !== PINNED_CPU_COMMIT) throw new Error('CPU source pins do not match the pinned full-source commit')
if (pins.files.length !== 7567 || pins.cityMapSourceCount !== 40) throw new Error('CPU source pin inventory differs from the independently verified full source snapshot')
validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, pinsCommit: pins.gitCommit,
  artifact: `environment-npc-startup-fix-v1-package-v1-${PINNED_CPU_RUN_ID}` })

const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', timeout: 5000 }).trim()
if (checkedOut !== PINNED_CPU_COMMIT) throw new Error(`CPU source checkout mismatch: ${checkedOut}`)
const seenSource = new Set()
for (let i = 0; i < pins.files.length; i++) {
  const item = pins.files[i]
  if (seenSource.has(item.path)) throw new Error(`Duplicate source pin: ${item.path}`)
  seenSource.add(item.path)
  const actual = await fileHash(sourceRoot, item.path)
  if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw new Error(`CPU source checkout differs from package pin: ${item.path}`)
}
const sourceHashByPath = new Map(pins.files.map(item => [item.path, item.sha256]))
for (const rel of [
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-local-integration.json',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.json',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.log',
]) {
  if (!sourceHashByPath.has(rel)) throw new Error(`Root startup attestation is absent from source pins: ${rel}`)
}
const integrationPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-local-integration.json'
const testsPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.json'
const testLogPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.log'
const integration = JSON.parse(await readFile(inside(sourceRoot, integrationPath), 'utf8'))
const testReceipt = JSON.parse(await readFile(inside(sourceRoot, testsPath), 'utf8'))
const testLog = await readFile(inside(sourceRoot, testLogPath), 'utf8')
const startupAttestationHashes = new Map(await Promise.all([integrationPath, testsPath, testLogPath].map(async relative => [relative, (await fileHash(sourceRoot, relative)).sha256])))

const receiptNames = ['source-precompile-v7.json', 'source-postcompile-v7.json', 'vendor-v7-record.json', 'addons-v7-record.json', 'app-v7-record.json', 'compile-v7-record.json', 'finalizer-pins-v7.json', 'finalization-v7-observed.json', 'remote-diagnostic-v1/cpu/remote-results/npc-startup-v1.receipt.json']
const receipts = new Map()
for (const name of receiptNames) receipts.set(name, JSON.parse(await readFile(inside(packageRoot, name), 'utf8')))
const manifestBytes = await readFile(inside(packageRoot, 'static-npc-v1/build-manifest.json'))
const manifest = JSON.parse(manifestBytes)
const compile = receipts.get('compile-v7-record.json')
const cpuReceipt = receipts.get('remote-diagnostic-v1/cpu/remote-results/npc-startup-v1.receipt.json')
const finalizerPins = receipts.get('finalizer-pins-v7.json')
const finalization = receipts.get('finalization-v7-observed.json')
const sourcePinsSha = sha(sourcePinsBytes)
const compileBytes = await readFile(inside(packageRoot, 'compile-v7-record.json'))
const finalizerBytes = await readFile(inside(packageRoot, 'finalizer-pins-v7.json'))
validateStartupAttestation({ sourcePinsByPath: sourceHashByPath, attestationHashes: startupAttestationHashes, integration, testReceipt, testLog, compileConsumedInputs: compile.consumedInputs })
if (manifest.sourcePinsSha256 !== sourcePinsSha || compile.sourcePinsSha256 !== sourcePinsSha || finalization.sourcePinsSha256 !== sourcePinsSha) throw new Error('Package manifests do not bind the exact CPU source pins')
if (manifest.compileRecordSha256 !== sha(compileBytes) || finalization.compileRecordSha256 !== sha(compileBytes)) throw new Error('Build/finalization manifests do not bind the compile record')
if (finalization.finalizerPinsSha256 !== sha(finalizerBytes)) throw new Error('Finalization receipt does not bind finalizer pins')
if (finalization.status !== 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW' || finalization.manifestSha256 !== sha(manifestBytes)) throw new Error('Package finalization receipt is invalid')
if (manifest.schema !== 'environment-next-phase-v7-diagnostic-manifest/3' || manifest.status !== 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE'
  || compile.schema !== 'environment-next-phase-v7-compiled-record/2' || compile.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY'
  || finalizerPins.schema !== 'environment-next-phase-v7-finalizer-pins/3' || finalizerPins.status !== 'PRE_FINALIZATION_SEALED') throw new Error('Package schemas/statuses do not match the root-verified v7 CPU build')
if (cpuReceipt.status !== 'completed' || cpuReceipt.commitSha !== PINNED_CPU_COMMIT || cpuReceipt.workflowRef !== 'refs/heads/codex/graphics-environment-npc-startup-fix-v1-package-v1'
  || cpuReceipt.sourcePinsSha256 !== sourcePinsSha || cpuReceipt.cleanupVerified !== true || cpuReceipt.peakOwnedGroupRssBytes > 384 * 1024 * 1024 || cpuReceipt.elapsedSeconds > 25) throw new Error('Pinned CPU runner receipt failed its source/resource gates')
for (const name of ['source-precompile-v7.json', 'source-postcompile-v7.json']) {
  const row = receipts.get(name)
  if (row.status !== 'VERIFIED' || row.sourcePinsSha256 !== sourcePinsSha || row.fileCount !== pins.files.length) throw new Error(`Full source-verification receipt failed: ${name}`)
}
if (compile.importClosureVerified !== true || manifest.importClosureVerified !== true) throw new Error('Compiled import closure is not verified')
const outputRows = Array.isArray(manifest.outputs) ? manifest.outputs : []
const outputMap = new Map()
for (const row of outputRows) {
  if (!row || typeof row.path !== 'string' || outputMap.has(row.path)) throw new Error('Malformed or duplicate output manifest route')
  outputMap.set(row.path, row)
}
const actualOutputPaths = (await walk(inside(packageRoot, 'static-npc-v1'))).filter(rel => rel !== 'build-manifest.json').sort()
const declaredOutputPaths = [...outputMap.keys()].sort()
assert.deepEqual(actualOutputPaths, declaredOutputPaths, 'Static output tree must exactly match the signed manifest')
for (const [relative, row] of outputMap) {
  const actual = await fileHash(inside(packageRoot, 'static-npc-v1'), relative)
  if (actual.bytes !== row.bytes || actual.sha256 !== row.sha256) throw new Error(`Static output hash mismatch: ${relative}`)
}
const publicPins = new Map(pins.files.filter(item => item.path.startsWith('public/')).map(item => [item.path, item]))
if (manifest.publicFileCount !== publicPins.size || manifest.publicFiles?.length !== publicPins.size) throw new Error('Public output manifest does not cover the entire pinned public tree')
for (const row of manifest.publicFiles) {
  const source = publicPins.get(row.source)
  if (!source || source.sha256 !== row.sha256 || source.bytes !== row.bytes || row.output !== row.source.slice('public/'.length)) throw new Error(`Public manifest/source pin mismatch: ${row.source}`)
  const output = outputMap.get(row.output)
  if (!output || output.kind !== 'copied-public' || output.sha256 !== row.sha256 || output.bytes !== row.bytes) throw new Error(`Public output route is not signed by the output manifest: ${row.output}`)
}
const sourceForOutput = new Map(finalizerPins.files.map(item => [item.path, item.sha256]))
if (sourceForOutput.get('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/source-pins-npc-v1.json') !== sourcePinsSha) throw new Error('Finalizer pins do not bind source manifest')
const compiledRows = outputRows.filter(row => row.kind !== 'copied-public')
if (compiledRows.length !== compile.outputs.length) throw new Error('Compiled output count differs from the signed compile record')
for (const row of compiledRows) {
  const rel = `evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/${row.path}`
  if (sourceForOutput.get(rel) !== row.sha256) throw new Error(`Finalizer pins do not bind output: ${row.path}`)
}
const sourceHash = sourceHashByPath.get('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v1/viewer-npc-v1.ts')
if (!sourceHash || !compile.consumedInputs.some(item => item.path.endsWith('/viewer-npc-v1.ts') && item.sha256 === sourceHash)) throw new Error('Compiled viewer is not the sealed production-host fixture')

process.stdout.write(`${JSON.stringify({ status: 'CPU_SOURCE_AND_PACKAGE_ARTIFACT_PREFLIGHT_OK_BEFORE_CHROME', commit: checkedOut,
  sourceFileCount: pins.files.length, staticOutputFileCount: outputMap.size, sourcePinsSha256: sourcePinsSha,
  outputBytes: outputRows.reduce((sum, row) => sum + row.bytes, 0) })}\n`)
