import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  compileCountryDirectories,
  openCountryDirectoryPrototype,
  parseReservedCities,
  resolveReceiptPacketPin,
  writePrototype,
} from './country-directory-prototype.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const inventorySha256 = 'a'.repeat(64)
const acceptedRows = [
  ['lagos', 'Lagos', 'lagos', 'Lagos State', 3.38, 6.52, 1],
  ['ibadan', 'Ibadan', 'oyo', 'Oyo State', 3.95, 7.38, 1],
  ['abuja', 'Abuja', 'fct', 'Federal Capital Territory', 7.49, 9.06, 1],
  ['port-harcourt', 'Port Harcourt', 'rivers', 'Rivers State', 7.03, 4.82, 1],
  ['abeokuta', 'Abeokuta', 'ogun', 'Ogun State', 3.35, 7.15, 0],
  ['accra', 'Accra', 'gh-starter', 'Starter district', -0.218662, 5.55198, 1, 'gh', 'Ghana'],
]
const accraFacts = {
  id: 'accra', name: 'Accra', country: { idISOlower: 'gh', name: 'Ghana' },
  state: { idunique: 'gh-starter', name: 'Starter district' }, timezone: 'Africa/Accra',
  centre: { lon: -0.218662, lat: 5.55198 },
  airport: { id: 'accra-airport', name: 'Airport dataset point', lon: -0.171, lat: 5.605, sourceUrl: 'https://example.invalid/airport' },
  bounds: [-0.3, 5.4, -0.1, 5.7],
}
const conakryFacts = {
  id: 'conakry', name: 'Conakry', country: { idISOlower: 'gn', name: 'Guinea' },
  state: { idunique: 'gn-starter', name: 'Starter zone' }, timezone: 'Africa/Conakry',
  centre: { lon: -13.682181, lat: 9.533469 },
  airport: { id: 'conakry-airport', name: 'Airport dataset point', lon: -13.612, lat: 9.57689, sourceUrl: 'https://example.invalid/conakry' },
  sourceUrl: 'https://example.invalid/osm',
  bounds: [-13.7, 9.5, -13.6, 9.6],
}
const asFactsSource = (facts) => `export const FACTS = ${JSON.stringify(facts)} satisfies DestinationFacts\n`
const conakryFactsText = asFactsSource(conakryFacts)
const conakryReceipt = {
  cityId: 'conakry', countryIso2: 'GN', generationIdentity: { cityId: 'conakry', stateId: 'gn-starter', stateName: 'Starter zone' },
  selectedPlace: { name: 'Conakry', coordinatesWgs84: [-13.682181, 9.533469], timezoneFromPlaceRecord: 'Africa/Conakry' },
  airportCandidate: { name: 'Airport dataset point', coordinatesWgs84: [-13.612, 9.57689], sourceRecordUrl: 'https://example.invalid/conakry' },
  sources: { osm: { url: 'https://example.invalid/osm' } }, bounds: conakryFacts.bounds,
  assets: { 'facts.ts': { bytes: Buffer.byteLength(conakryFactsText), sha256: sha(conakryFactsText) } },
}

function compileFixture(overrides = {}) {
  return compileCountryDirectories({
    acceptedRows,
    acceptedFacts: { accra: { path: 'src/game/cities/accra/facts.ts', text: asFactsSource(accraFacts) } },
    reservedCities: [{ id: 'kaduna', name: 'Kaduna', state: { id: 'kaduna', name: 'Kaduna State' }, lon: 7.4359863, lat: 10.5182899, open: false, airport: false, teaser: 'Reserved Nigeria city.' }],
    candidateCountries: [
      { iso2: 'GN', country: 'Guinea', cityTimezone: { ianaTimezone: 'Africa/Conakry', source: 'system zone.tab' }, chosenCity: { name: 'Conakry', naturalEarthPlaceId: 'place:conakry', coordinatesWgs84: [-13.682181, 9.533469], timezoneFromPlaceRecord: 'Africa/Conakry' }, airportCandidate: { id: 'candidate-airport', name: 'Airport dataset point', type: 'large_airport', scheduledService: true, coordinatesWgs84: [-13.612, 9.57689], sourceRecordUrl: 'https://example.invalid/conakry' } },
      { iso2: 'SS', country: 'South Sudan', chosenCity: null, airportCandidate: null },
    ],
    queuedReceipts: [{ receipt: conakryReceipt, receiptText: JSON.stringify(conakryReceipt), receiptPath: 'world/playable-africa-rollout/receipts/conakry.json', factsText: conakryFactsText, factsPath: 'src/game/cities/conakry/facts.ts' }],
    inventorySha256,
    ...overrides,
  })
}

async function withOutput(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'country-directory-prototype-'))
  try {
    const output = path.join(root, '.cache', 'world-build', 'country-directory-output', 'prototype')
    const compiled = compileFixture()
    await writePrototype(output, compiled, root)
    await run({ root, output, compiled })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('compiler preserves legacy Nigeria metadata and emits source-status-separated country shards', () => {
  const compiled = compileFixture()
  const nigeria = compiled.directories.find((entry) => entry.iso2 === 'NG')
  assert.ok(nigeria)
  assert.deepEqual(nigeria.body.cities.map(({ id, name, state, lon, lat, airport, open }) => ({ id, name, state, lon, lat, airport, open })), [
    { id: 'lagos', name: 'Lagos', state: { id: 'lagos', name: 'Lagos State' }, lon: 3.38, lat: 6.52, airport: true, open: true },
    { id: 'ibadan', name: 'Ibadan', state: { id: 'oyo', name: 'Oyo State' }, lon: 3.95, lat: 7.38, airport: true, open: true },
    { id: 'abuja', name: 'Abuja', state: { id: 'fct', name: 'Federal Capital Territory' }, lon: 7.49, lat: 9.06, airport: true, open: true },
    { id: 'port-harcourt', name: 'Port Harcourt', state: { id: 'rivers', name: 'Rivers State' }, lon: 7.03, lat: 4.82, airport: true, open: true },
    { id: 'kaduna', name: 'Kaduna', state: { id: 'kaduna', name: 'Kaduna State' }, lon: 7.4359863, lat: 10.5182899, airport: false, open: false },
    { id: 'abeokuta', name: 'Abeokuta', state: { id: 'ogun', name: 'Ogun State' }, lon: 3.35, lat: 7.15, airport: false, open: true },
  ])
  assert.equal(Object.hasOwn(nigeria.body.cities[0], 'countryISO'), false)
  const accra = compiled.directories.find((entry) => entry.iso2 === 'GH')?.body.cities[0]
  assert.equal(accra?.admissionStatus, 'accepted-foreign')
  assert.equal(accra?.airportPoint?.name, 'Airport dataset point')
  const conakry = compiled.directories.find((entry) => entry.iso2 === 'GN')?.body.cities[0]
  assert.equal(conakry?.admissionStatus, 'queued-source-not-registered')
  assert.equal(conakry?.open, false)
  const southSudan = compiled.directories.find((entry) => entry.iso2 === 'SS')
  assert.equal(southSudan?.status, 'no-place')
  assert.deepEqual(southSudan?.body.cities, [])
  assert.equal(compiled.index.countries.length, 4)
  assert.equal(compiled.index.legacy.directoryPreservesAllCatalogueRows, true)
  assert.equal(compiled.sizeReport.totalExportRawBytes, compiled.sizeReport.indexRawBytes + compiled.sizeReport.allCountryDirectoriesRawBytes)
  assert.equal(nigeria.body.cities.find((city) => city.id === 'kaduna')?.open, false)
})

test('generated open Kaduna wins over same-ID closed reserved entry, while generated row order is preserved', () => {
  const generatedKaduna = ['kaduna', 'Kaduna', 'kaduna', 'Kaduna State', 7.4359863, 10.5182899, 0]
  const generatedRows = [...acceptedRows.slice(0, 4), generatedKaduna, ...acceptedRows.slice(4)]
  const compiled = compileFixture({ acceptedRows: generatedRows })
  const nigeria = compiled.directories.find((entry) => entry.iso2 === 'NG')
  assert.ok(nigeria)
  assert.deepEqual(nigeria.body.cities.map(({ id }) => id), ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'kaduna', 'abeokuta'])
  assert.deepEqual(nigeria.body.cities[4], {
    id: 'kaduna', name: 'Kaduna', state: { id: 'kaduna', name: 'Kaduna State' }, lon: 7.4359863, lat: 10.5182899,
    airport: false, open: true, admissionStatus: 'legacy-open', modulePath: 'src/game/cities/kaduna/index.ts',
    sourcePin: { kind: 'c1-catalogue', path: 'src/game/cities/catalogue.generated.ts' },
  })
})

test('reserved catalogue parser preserves the real C1 closed-city row shape and fails closed on syntax drift', () => {
  const source = `const RESERVED_CITIES: readonly CityCatalogueEntry[] = Object.freeze([\n  Object.freeze({\n    id: 'kaduna', name: 'Kaduna', state: Object.freeze({ id: 'kaduna', name: 'Kaduna State' }),\n    lon: 7.4359863, lat: 10.5182899, open: false, airport: false,\n    teaser: 'Coming soon.', preview: Object.freeze(['First', 'Second']),\n  }),\n])`
  assert.deepEqual(parseReservedCities(source), [{ id: 'kaduna', name: 'Kaduna', state: { id: 'kaduna', name: 'Kaduna State' }, lon: 7.4359863, lat: 10.5182899, open: false, airport: false, teaser: 'Coming soon.', preview: ['First', 'Second'] }])
  assert.throws(() => parseReservedCities('const RESERVED_CITIES = []'), /not found/)
})

test('availability listing reads only the index; one country shard is content-verified, cached, and disposed', async () => withOutput(async ({ output, compiled }) => {
  const reader = await openCountryDirectoryPrototype(output, compiled.indexSha256)
  assert.equal(reader.countries().length, 4)
  assert.deepEqual([...reader.loadCounts], [])
  const first = await reader.getCountryDirectory('gh')
  assert.equal(first.country.name, 'Ghana')
  assert.equal(first.cities[0].id, 'accra')
  const second = await reader.getCountryDirectory('gh')
  assert.equal(first, second)
  assert.deepEqual([...reader.loadCounts], [['gh', 1]])
  assert.ok(reader.residentBytes > 0)
  await assert.rejects(reader.getCountryDirectory('zz'), /unknown country/)
  reader.dispose()
  assert.equal(reader.residentBytes, 0)
  await assert.rejects(reader.getCountryDirectory('gh'), /disposed/)
}))

test('content-hash mismatch and undersized cache fail closed', async () => withOutput(async ({ output, compiled }) => {
  const entry = compiled.index.countries.find((row) => row.iso2 === 'GH')
  assert.ok(entry)
  await writeFile(path.join(output, entry.path), Buffer.from('{}\n'))
  const reader = await openCountryDirectoryPrototype(output, compiled.indexSha256)
  await assert.rejects(reader.getCountryDirectory('gh'), /content hash mismatch/)
  reader.dispose()
  const smallCache = await openCountryDirectoryPrototype(output, compiled.indexSha256, { maxResidentBytes: compiled.indexContent.byteLength + 1 })
  await assert.rejects(smallCache.getCountryDirectory('gh'), /resident cache/)
  smallCache.dispose()
}))

test('receipt facts cannot be substituted or mismatched with queued settlement metadata', () => {
  const tampered = `${conakryFactsText}\n`
  assert.throws(() => compileFixture({ queuedReceipts: [{ receipt: conakryReceipt, receiptText: JSON.stringify(conakryReceipt), receiptPath: 'receipt.json', factsText: tampered, factsPath: 'facts.ts' }] }), /facts bytes or SHA-256/)
  const wrongFacts = { ...conakryFacts, centre: { lon: -13.5, lat: 9.5 } }
  const wrongText = asFactsSource(wrongFacts)
  const receipt = { ...conakryReceipt, assets: { 'facts.ts': { bytes: Buffer.byteLength(wrongText), sha256: sha(wrongText) } } }
  assert.throws(() => compileFixture({ queuedReceipts: [{ receipt, receiptText: JSON.stringify(receipt), receiptPath: 'receipt.json', factsText: wrongText, factsPath: 'facts.ts' }] }), /differ from the pinned settlement selection/)
})

test('queued timezone uses the pinned IANA selection when Natural Earth has no timezone', () => {
  const receipt = { ...conakryReceipt, selectedPlace: { ...conakryReceipt.selectedPlace, timezoneFromPlaceRecord: null } }
  const candidate = { iso2: 'GN', country: 'Guinea', cityTimezone: { ianaTimezone: 'Africa/Conakry', source: 'system zone.tab' }, chosenCity: { ...receipt.selectedPlace } }
  const options = {
    candidateCountries: [candidate],
    queuedReceipts: [{ receipt, receiptText: JSON.stringify(receipt), receiptPath: 'receipt.json', factsText: conakryFactsText, factsPath: 'facts.ts' }],
  }
  const city = compileFixture(options).directories.find((entry) => entry.iso2 === 'GN').body.cities[0]
  assert.equal(city.timezone, 'Africa/Conakry')
  assert.equal(city.open, false)
  assert.throws(() => compileFixture({ ...options, candidateCountries: [{ ...candidate, cityTimezone: { ianaTimezone: 'Africa/Tripoli' } }] }), /pinned inventory IANA timezone/)
  assert.throws(() => compileFixture({ ...options, candidateCountries: [{ ...candidate, cityTimezone: undefined }] }), /inventory IANA timezone/)
})

test('extent correction binds only the exact historical packet and current audited receipt pins', () => {
  const receiptPath = 'world/playable-africa-rollout/receipts/dar.json'
  const oldSha = '1'.repeat(64), currentSha = '2'.repeat(64)
  const pin = { packet: 'world/playable-africa-rollout/batches/fifth-five.json', path: receiptPath, bytes: 3508, sha256: oldSha }
  const receipt = { cityId: 'dar', countryIso2: 'TZ' }
  const acceptance = {
    status: 'passed', importsCompilerOrRevisionPublisher: false, registeredInProduction: false,
    limitations: ['No independent GIS topology equivalence proof.'],
    cities: [{ city: 'dar', country: 'TZ', beforeReceiptSha256: oldSha, afterReceiptSha256: currentSha, beforeOutsideVertices: 64, afterOutsideVertices: 0, completeRoadAndBuildingCoordinatesUnchanged: true, sourceAndRequestLedgerUnchanged: true, revisionId: '3dc07d449f9cd84903aaf17ce69521f24abe38d3467a7e5aeee94b7428d3e668' }],
  }
  const result = resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [pin], acceptance })
  assert.equal(result.sha256, oldSha)
  assert.equal(result.correction.currentReceiptSha256, currentSha)
  assert.equal(result.correction.path, 'world/starter-extent-revisions-acceptance.json')
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [{ ...pin, sha256: '3'.repeat(64) }], acceptance }), /does not bind/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: '4'.repeat(64), receiptBytes: 3600, receipt, packetPins: [pin], acceptance }), /does not bind/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt: { ...receipt, countryIso2: 'BW' }, packetPins: [pin], acceptance }), /packet pin/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [pin], acceptance: { ...acceptance, importsCompilerOrRevisionPublisher: true } }), /unqualified/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [pin], acceptance: { ...acceptance, limitations: [] } }), /unqualified/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [pin, { ...pin, sha256: '3'.repeat(64) }], acceptance }), /contradictory/)
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [pin], acceptance: { ...acceptance, cities: [{ ...acceptance.cities[0], afterOutsideVertices: 1 }] } }), /does not bind/)
  const directPin = { ...pin, bytes: 3600, sha256: currentSha }
  assert.deepEqual(resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3600, receipt, packetPins: [directPin], acceptance }), { packet: directPin.packet, bytes: 3600, sha256: currentSha })
  assert.throws(() => resolveReceiptPacketPin({ receiptPath, receiptSha256: currentSha, receiptBytes: 3599, receipt, packetPins: [directPin], acceptance }), /byte count/)
})

test('new prototype output is restricted to the dedicated world cache boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'country-directory-boundary-'))
  try {
    const compiled = compileFixture()
    await assert.rejects(writePrototype(path.join(root, 'out'), compiled, root), /dedicated world-root output boundary/)
    const output = path.join(root, '.cache', 'world-build', 'country-directory-output', 'prototype')
    await writePrototype(output, compiled, root)
    await assert.rejects(writePrototype(output, compiled, root), /existing output directory or file is refused/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('symlink output parent is refused before creating anything outside the boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'country-directory-symlink-'))
  try {
    const boundary = path.join(root, '.cache', 'world-build', 'country-directory-output')
    const outside = path.join(root, 'outside')
    await mkdir(boundary, { recursive: true })
    await mkdir(outside)
    await symlink(outside, path.join(boundary, 'escape'), 'dir')
    await assert.rejects(writePrototype(path.join(boundary, 'escape', 'prototype'), compileFixture(), root), /real directory/)
    await assert.rejects(lstat(path.join(outside, 'prototype')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('symlink world root is refused before creating the output boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'country-directory-root-link-'))
  try {
    const realRoot = path.join(root, 'real')
    const linkedRoot = path.join(root, 'linked')
    await mkdir(realRoot)
    await symlink(realRoot, linkedRoot, 'dir')
    const output = path.join(linkedRoot, '.cache', 'world-build', 'country-directory-output', 'prototype')
    await assert.rejects(writePrototype(output, compileFixture(), linkedRoot), /world root must be a real directory/)
    await assert.rejects(lstat(path.join(realRoot, '.cache')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('written index and shards are reproducible bytes under their content hashes', async () => withOutput(async ({ output, compiled }) => {
  const second = compileFixture()
  assert.equal(second.indexSha256, compiled.indexSha256)
  assert.deepEqual(second.directories.map((row) => [row.path, row.sha256, row.bytes]), compiled.directories.map((row) => [row.path, row.sha256, row.bytes]))
  const indexBytes = await readFile(path.join(output, compiled.indexPath))
  assert.equal(sha(indexBytes), compiled.indexSha256)
  for (const directory of compiled.directories) {
    const bytes = await readFile(path.join(output, directory.path))
    assert.equal(sha(bytes), directory.sha256)
    assert.equal(bytes.byteLength, directory.bytes)
  }
}))

test('reader counts index against residency and refuses more than two distinct reads in flight', async () => withOutput(async ({ output, compiled }) => {
  const reader = await openCountryDirectoryPrototype(output, compiled.indexSha256)
  assert.equal(reader.residentBytes, reader.indexBytes)
  const reads = [reader.getCountryDirectory('gh'), reader.getCountryDirectory('gn')]
  assert.equal(reader.pendingReads, 2)
  await assert.rejects(reader.getCountryDirectory('ss'), /concurrent country read limit/)
  await Promise.all(reads)
  assert.ok(reader.residentBytes <= 512 * 1024)
  reader.dispose()
}))
