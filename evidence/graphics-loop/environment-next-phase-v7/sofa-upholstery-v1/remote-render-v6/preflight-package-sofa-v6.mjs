import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { assertFinalizerOutputPin, finalizerOutputPinPath, validateCandidatePackageHeaders } from './package-boundary-contract-sofa-v6.mjs'

const candidateRoot = path.resolve(process.env.PACKAGE_ROOT ?? '')
const baselineRoot = path.resolve(process.env.BASELINE_PACKAGE_ROOT ?? '')
const sourceRoot = path.resolve(process.env.CPU_SOURCE_ROOT ?? '')
if (!process.env.PACKAGE_ROOT || !process.env.BASELINE_PACKAGE_ROOT || !process.env.CPU_SOURCE_ROOT) throw new Error('Candidate, baseline, and exact CPU source roots are required')
const CANDIDATE_COMMIT = '10b383754b68c758ba002bb9fbe1e5f5fe668511'
const BASELINE_COMMIT = 'c4d15a72f6df56b28535579380819bdaf2fad8a1'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error(`Unsafe relative path: ${relative}`)
  const target = path.resolve(root, relative)
  const rel = path.relative(path.resolve(root), target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escaped root: ${relative}`)
  return target
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyPinnedFiles(root, files, label) {
  const seen = new Set()
  for (const item of files) {
    if (!item || typeof item.path !== 'string' || !Number.isSafeInteger(item.bytes) || !/^[a-f0-9]{64}$/.test(item.sha256) || seen.has(item.path)) throw new Error(`${label} has malformed or duplicate file pins`)
    seen.add(item.path)
    const file = inside(root, item.path)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== item.bytes || await hashFile(file) !== item.sha256) throw new Error(`${label} file differs from its pin: ${item.path}`)
  }
  return seen
}

async function walk(root, relative = '') {
  const result = []
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.posix.join(relative.split(path.sep).join('/'), item.name)
    if (item.isDirectory()) result.push(...await walk(root, next))
    else if (item.isFile()) result.push(next)
    else throw new Error(`Unexpected non-file package path: ${next}`)
  }
  return result
}

async function verifyOutputTree(staticDir, manifest, finalizerPins, label, finalizerPrefix) {
  const rows = manifest.outputs
  if (!Array.isArray(rows)) throw new Error(`${label} output manifest has no output list`)
  const byPath = new Map()
  for (const row of rows) {
    if (!row || typeof row.path !== 'string' || !Number.isSafeInteger(row.bytes) || !/^[a-f0-9]{64}$/.test(row.sha256) || byPath.has(row.path)) throw new Error(`${label} output manifest has malformed or duplicate entries`)
    byPath.set(row.path, row)
  }
  const actual = (await walk(staticDir)).filter(file => file !== 'build-manifest.json').sort()
  assert.deepEqual(actual, [...byPath.keys()].sort(), `${label} output files must exactly match its manifest`)
  const finalizedByPath = new Map(finalizerPins.files.map(item => [item.path, item.sha256]))
  for (const [relative, row] of byPath) {
    const actualFile = inside(staticDir, relative)
    const info = await lstat(actualFile)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== row.bytes || await hashFile(actualFile) !== row.sha256) throw new Error(`${label} output differs from manifest: ${relative}`)
    if (row.kind !== 'copied-public') {
      const pinPath = finalizerOutputPinPath(finalizerPrefix, relative)
      if (finalizedByPath.get(pinPath) !== row.sha256) throw new Error(`${label} compiled output is absent from finalizer pins: ${relative}`)
      assertFinalizerOutputPin(finalizerPins.files, finalizerPrefix, relative, row.sha256, row.bytes)
    }
  }
  return byPath
}

const sourcePinsBytes = await readFile(inside(candidateRoot, 'source-pins-sofa-v1.json'))
const sourcePins = JSON.parse(sourcePinsBytes)
if (sourcePins.schema !== 'sofa-upholstery-v1-source-pins/3' || sourcePins.status !== 'PREBUILD_SEALED' || sourcePins.gitCommit !== CANDIDATE_COMMIT) throw new Error('Candidate source pin manifest is not the frozen v5 CPU source')
const reconstructedReviewPin = sourcePins.files.find(item => item.path === 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-render-v5/review-sources-sofa-v5.json')
if (!reconstructedReviewPin || reconstructedReviewPin.bytes !== 3844 || reconstructedReviewPin.sha256 !== '1b750169aca11db8c79347d84f23520d8787314f644f55236351b69be3d75eb5') throw new Error('Reconstructed v5 review manifest is absent from or differs from the frozen CPU source pins')
const sourceRootCommit = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', timeout: 3000 }).trim()
if (sourceRootCommit !== CANDIDATE_COMMIT) throw new Error(`CPU source checkout differs from candidate commit: ${sourceRootCommit}`)
const sourcePaths = await verifyPinnedFiles(sourceRoot, sourcePins.files, 'Candidate CPU source')
if (sourcePaths.size !== sourcePins.files.length) throw new Error('Candidate CPU source verification was incomplete')
const sourcePinsSha = sha(sourcePinsBytes)

const candidateStatic = inside(candidateRoot, 'static-sofa-v1')
const candidateManifestBytes = await readFile(inside(candidateStatic, 'build-manifest.json'))
const candidateManifest = JSON.parse(candidateManifestBytes)
const candidateCompileBytes = await readFile(inside(candidateRoot, 'compile-sofa-v1-record.json'))
const candidateCompile = JSON.parse(candidateCompileBytes)
const candidateFinalizerBytes = await readFile(inside(candidateRoot, 'finalizer-pins-sofa-v1.json'))
const candidateFinalizer = JSON.parse(candidateFinalizerBytes)
const candidateFinalization = JSON.parse(await readFile(inside(candidateRoot, 'finalization-sofa-v1-observed.json'), 'utf8'))
validateCandidatePackageHeaders({ sourcePins, sourcePinsSha, manifest: candidateManifest, compile: candidateCompile, compileSha: sha(candidateCompileBytes),
  finalizerPins: candidateFinalizer, finalizerPinsSha: sha(candidateFinalizerBytes), finalization: candidateFinalization, manifestSha: sha(candidateManifestBytes) })
const candidateFinalizerPrefix = 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1'
const candidateOutputs = await verifyOutputTree(candidateStatic, candidateManifest, candidateFinalizer, 'Candidate', candidateFinalizerPrefix)
if (candidateCompile.outputs.length !== [...candidateOutputs.values()].filter(row => row.kind !== 'copied-public').length) throw new Error('Candidate compile and manifest output counts differ')
for (const item of candidateCompile.consumedInputs) if (sourcePins.files.find(pin => pin.path === item.path)?.sha256 !== item.sha256) throw new Error(`Candidate compile input is not source-pinned: ${item.path}`)

const baselinePinsBytes = await readFile(inside(baselineRoot, 'source-pins-v7.json'))
const baselinePins = JSON.parse(baselinePinsBytes)
if (baselinePins.gitCommit !== BASELINE_COMMIT) throw new Error('Baseline package is not the frozen v7 whole-slice run')
const baselineStatic = inside(baselineRoot, 'static-v7')
const baselineManifestBytes = await readFile(inside(baselineStatic, 'build-manifest.json'))
const baselineManifest = JSON.parse(baselineManifestBytes)
const baselineFinalization = JSON.parse(await readFile(inside(baselineRoot, 'finalization-v7-observed.json'), 'utf8'))
if (baselineManifest.sourcePinsSha256 !== sha(baselinePinsBytes) || baselineManifest.status !== 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE'
  || baselineFinalization.manifestSha256 !== sha(baselineManifestBytes) || baselineFinalization.status !== 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW') throw new Error('Baseline package receipts do not reconcile')
const baselineHome = baselinePins.files.find(item => item.path === 'src/scene/home-scene.ts')
const candidateHome = sourcePins.files.find(item => item.path === 'src/scene/home-scene.ts')
if (!baselineHome || baselineHome.sha256 !== candidateHome?.sha256) throw new Error('Baseline and candidate do not share the pinned Home source')
const baselineEntry = baselineManifest.outputs.find(item => item.path === 'app/viewer.js')
const candidateEntry = candidateManifest.outputs.find(item => item.path === 'app/viewer-sofa-compare.js')
if (!baselineEntry || !candidateEntry || await hashFile(inside(baselineStatic, baselineEntry.path)) !== baselineEntry.sha256
  || await hashFile(inside(candidateStatic, candidateEntry.path)) !== candidateEntry.sha256) throw new Error('Actual baseline/candidate host entry is missing or differs from its output manifest')
assertFinalizerOutputPin(candidateFinalizer.files, candidateFinalizerPrefix, candidateEntry.path, candidateEntry.sha256, candidateEntry.bytes)

process.stdout.write(`${JSON.stringify({ status: 'CANDIDATE_AND_BASELINE_PACKAGE_PREFLIGHT_OK_BEFORE_CHROME', candidateCommit: sourceRootCommit,
  candidateSourceFiles: sourcePins.files.length, candidateOutputFiles: candidateOutputs.size, candidateSourcePinsSha256: sourcePinsSha,
  baselineCommit: baselinePins.gitCommit, baselineHomeSha256: baselineHome.sha256, candidateHomeSha256: candidateHome.sha256,
  entrypointPaths: [baselineEntry.path, candidateEntry.path] })}\n`)
