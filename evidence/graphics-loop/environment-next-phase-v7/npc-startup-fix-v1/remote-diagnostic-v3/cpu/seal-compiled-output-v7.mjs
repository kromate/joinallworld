// Fresh Node process: join split compiler receipts, recheck consumed inputs/outputs, and prove runtime closure.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { here, hashFile, loadPins, outDir, root, sha } from './phase-common-v7.mjs'

const { bytes: pinsBytes, digest: sourcePinsSha256, pins } = await loadPins()
const vendor = JSON.parse(await readFile(path.join(here, 'vendor-v7-record.json'), 'utf8'))
const addons = JSON.parse(await readFile(path.join(here, 'addons-v7-record.json'), 'utf8'))
const app = JSON.parse(await readFile(path.join(here, 'app-v7-record.json'), 'utf8'))
if (vendor.status !== 'VENDOR_COMPILED' || addons.status !== 'ADDONS_COMPILED' || app.status !== 'APPLICATION_COMPILED') throw new Error('One or more isolated compiler receipts are missing')
for (const record of [vendor, addons, app]) if (record.sourcePinsSha256 !== sourcePinsSha256) throw new Error('Compiler phase source-pin hashes disagree')
if (app.importClosureVerified !== true) throw new Error('Application phase did not verify import closure')
const consumed = new Map()
for (const item of [...vendor.inputs.map((row) => row.input), ...addons.consumedInputs, ...app.consumedInputs]) consumed.set(item.path, item.sha256)
const expectedPrerequisites = [...vendor.inputs.map((item) => item.output), ...addons.entries.map((item) => item.output)]
if (JSON.stringify(app.verifiedDependencyOutputs) !== JSON.stringify(expectedPrerequisites)) throw new Error('Application closure does not match the sealed vendor/addon phase outputs')
const pinsByPath = new Map(pins.files.map((item) => [item.path, item.sha256]))
for (const [file, expected] of consumed) {
  if (pinsByPath.get(file) !== expected) throw new Error(`Consumed input does not match full source pin: ${file}`)
  if (await hashFile(path.join(root, file)) !== expected) throw new Error(`Consumed input changed before output seal: ${file}`)
}
const toOutput = (row) => ({ path: row.path, bytes: row.bytes, sha256: row.sha256, kind: row.path.startsWith('vendor/') ? 'three-vendor-or-addon' : 'esbuild-application' })
const outputMap = new Map()
for (const row of [...vendor.inputs.map((item) => item.output), ...addons.entries.map((item) => item.output), ...app.outputs]) {
  if (outputMap.has(row.path)) throw new Error(`Duplicate compiled output path: ${row.path}`)
  const actual = await hashFile(path.join(outDir, ...row.path.split('/')))
  if (actual !== row.sha256) throw new Error(`Compiled output changed before seal: ${row.path}`)
  outputMap.set(row.path, toOutput(row))
}
const outputs = [...outputMap.values()].sort((a, b) => a.path.localeCompare(b.path))
const outputNames = new Set(outputs.map((item) => item.path))
const importMap = app.importMap
if (importMap.imports.three !== './vendor/three.module.js' || !outputNames.has('vendor/three.core.js')) throw new Error('Shared Three core/module pair missing')
for (const [specifier, target] of Object.entries(importMap.imports)) if (!target.startsWith('./') || !outputNames.has(target.slice(2))) throw new Error(`Import-map target missing: ${specifier} -> ${target}`)
const refs = []
const staticOrExport = /\b(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/g
const dynamicLiteral = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
for (const item of outputs.filter((row) => row.path.endsWith('.js'))) {
  const code = await readFile(path.join(outDir, ...item.path.split('/')), 'utf8')
  for (const expression of [staticOrExport, dynamicLiteral]) {
    expression.lastIndex = 0
    for (let match; (match = expression.exec(code));) refs.push({ from: item.path, specifier: match[1] })
  }
}
for (const { from, specifier } of refs) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    if (specifier.startsWith('/')) throw new Error(`Absolute runtime import: ${from} -> ${specifier}`)
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    if (!outputNames.has(target)) throw new Error(`Unresolved runtime sibling: ${from} -> ${specifier}`)
  } else {
    const target = importMap.imports[specifier]
    if (!target || !outputNames.has(target.slice(2))) throw new Error(`Unmapped runtime import: ${from} -> ${specifier}`)
  }
}
const cityMapCount = pins.files.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
if (app.schema !== 'environment-next-phase-v7-app-record/2' || typeof app.entryOutput !== 'string' || app.htmlEntry !== `./${app.entryOutput}`) throw new Error('Application HTML entry/output contract is missing')
const appEntryRecord = app.outputs.find((item) => item.path === app.entryOutput)
if (!appEntryRecord || !Number.isSafeInteger(appEntryRecord.bytes) || appEntryRecord.bytes < 1 || !/^[a-f0-9]{64}$/.test(appEntryRecord.sha256)) throw new Error('Application entry is absent from its hashed output record')
if (cityMapCount !== 40 || app.cityMapSourceCount !== 40 || app.cityMapChunkCount !== 40) throw new Error('Full 40-city map graph is not present')
const compiled = {
  schema: 'environment-next-phase-v7-compiled-record/3', status: 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY',
  createdAt: new Date().toISOString(), node: process.version, threeVersion: pins.threeVersion,
  sourcePinsSha256, sourcePinsFile: 'source-pins-npc-v2.json', method: 'Separate fresh Node processes compile shared Three core/module, actual addons, and full split production host graph; full source inventory is verified in independent pre/post phases; consumed source hashes are checked on load and rechecked here. Public files are copied once by finalizer.',
  importedThreeSpecifiers: Object.keys(importMap.imports), importMap, entryOutput: app.entryOutput, htmlEntry: app.htmlEntry, consumedInputs: [...consumed].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })),
  importClosureVerified: true, importReferenceCount: refs.length, cssReferenceCount: app.cssReferenceCount, importClosureRule: 'Every compiled JavaScript static import, export-from, and literal dynamic import resolves to an emitted relative output or an explicit exact import-map entry; emitted stylesheet URLs/imports are separately checked by app compile.',
  cityMapSourceCount: cityMapCount, cityMapChunkCount: app.cityMapChunkCount,
  outputFileCount: outputs.length, outputRawBytes: outputs.reduce((sum, item) => sum + item.bytes, 0), outputs,
  applicationMetafileInputCount: app.applicationMetafileInputCount, applicationMetafileOutputCount: app.applicationMetafileOutputCount,
  phaseRecords: { vendor: 'vendor-v7-record.json', addons: 'addons-v7-record.json', app: 'app-v7-record.json' },
}
const bytes = Buffer.from(`${JSON.stringify(compiled, null, 2)}\n`)
await writeFile(path.join(here, 'compile-v7-record.json'), bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: compiled.status, outputs: outputs.length, bytes: compiled.outputRawBytes, importReferences: refs.length, recordSha256: sha(bytes) }) + '\n')
