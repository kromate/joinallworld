import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { C1_SOURCE_SHA, openCountryDirectoryPrototype } from './country-directory-prototype.mjs'

// This checks exported bytes and the reader against the actual pinned catalogue.
// It does not call the compiler or import game maps, content, rules or routes.
const [worldRoot, releaseRoot, output, indexHash] = process.argv.slice(2)
for (const root of [worldRoot, releaseRoot, output]) assert.ok(path.isAbsolute(root), 'absolute roots required')
assert.match(indexHash, /^[a-f0-9]{64}$/u)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const indexBytes = await readFile(path.join(output, `index-${indexHash}.json`))
assert.equal(digest(indexBytes), indexHash)
const index = JSON.parse(indexBytes)
assert.equal(index.source.c1Commit, C1_SOURCE_SHA)
assert.equal(index.countries.length, 54)
assert.equal(new Set(index.countries.map((row) => row.iso2)).size, 54)
const catalogueText = execFileSync('git', ['-C', releaseRoot, 'show', `${C1_SOURCE_SHA}:src/game/cities/catalogue.generated.ts`], { encoding: 'utf8' })
assert.equal(digest(Buffer.from(catalogueText)), index.source.catalogueSha256)
const rows = catalogueText.split('\n').flatMap((line) => {
  const match = /^  (\[.*\]),$/u.exec(line)
  return match ? [JSON.parse(match[1])] : []
})
assert.equal(rows.length, 50)
const nigeriaRows = rows.filter((row) => row.length === 7)
assert.equal(nigeriaRows.length, 40)
const shards = new Map()
let allShardBytes = 0, queuedCities = 0, selectedCities = 0
const openCountries = []
for (const entry of index.countries) {
  assert.equal(entry.path, `countries/${entry.iso2.toLowerCase()}-${entry.sha256}.json`)
  const bytes = await readFile(path.join(output, entry.path))
  assert.equal(bytes.length, entry.bytes)
  assert.equal(digest(bytes), entry.sha256)
  const shard = JSON.parse(bytes)
  assert.equal(shard.country.iso2, entry.iso2)
  assert.equal(shard.country.status, entry.status)
  assert.equal(shard.cities.length, entry.cityCount)
  for (const field of ['containsGeometry', 'containsRules', 'containsContent', 'containsTravelEdges']) assert.equal(shard[field], false)
  shards.set(entry.iso2, shard)
  allShardBytes += bytes.length
  if (shard.cities.some((city) => city.open)) openCountries.push(entry.iso2)
  for (const city of shard.cities) {
    if (city.admissionStatus === 'queued-source-not-registered') {
      queuedCities++
      assert.equal(city.open, false)
      const receiptBytes = await readFile(path.join(worldRoot, city.sourcePin.receiptPath))
      assert.equal(digest(receiptBytes), city.sourcePin.receiptSha256)
      assert.equal(receiptBytes.length, city.sourcePin.receiptBytes)
      const factsBytes = await readFile(path.join(worldRoot, city.sourcePin.factsPath))
      assert.equal(digest(factsBytes), city.sourcePin.factsSha256)
      assert.equal(factsBytes.length, city.sourcePin.factsBytes)
    } else if (city.admissionStatus === 'selected-place-candidate') {
      selectedCities++
      assert.equal(city.open, false)
      assert.equal(city.modulePath, null)
    }
  }
}
assert.equal(queuedCities, 26)
assert.equal(selectedCities, 17)
assert.deepEqual(openCountries, ['BJ', 'CI', 'CM', 'DZ', 'ET', 'GH', 'KE', 'NG', 'SN', 'TG', 'ZA'])
const nigeria = shards.get('NG')
assert.deepEqual(nigeria.cities.map(({ id, name, state, lon, lat, airport, open, countryISO, countryName }) => ({ id, name, state, lon, lat, airport, open, countryISO, countryName })), nigeriaRows.map(([id, name, stateId, stateName, lon, lat, airport]) => ({ id, name, state: { id: stateId, name: stateName }, lon, lat, airport: airport === 1, open: true, countryISO: undefined, countryName: undefined })))
assert.equal(nigeria.cities.filter((city) => city.id === 'kaduna').length, 1)
assert.equal(nigeria.cities.find((city) => city.id === 'kaduna').open, true)
execFileSync('git', ['-C', worldRoot, 'diff', '--exit-code', C1_SOURCE_SHA, '--', ...nigeriaRows.map(([id]) => `src/game/cities/${id}`)], { stdio: 'pipe' })
for (const iso of ['TZ', 'BW']) {
  const city = shards.get(iso).cities[0]
  assert.equal(city.sourcePin.receiptPinStatus, 'historical-packet-pin-and-extent-correction-verified')
  assert.equal(city.sourcePin.batchPin.currentReceiptSha256, city.sourcePin.receiptSha256)
}
const extentAudit = JSON.parse(await readFile(path.join(worldRoot, 'world/starter-extent-revisions-acceptance.json')))
assert.equal(extentAudit.status, 'passed')
const mogadishu = shards.get('SO').cities[0]
assert.equal(mogadishu.sourcePin.receiptPinStatus, 'batch-packet-pin-verified')
assert.equal(mogadishu.sourcePin.batchPin.sha256, mogadishu.sourcePin.receiptSha256)
assert.equal(extentAudit.cities.find((city) => city.city === 'mogadishu').afterReceiptSha256, mogadishu.sourcePin.receiptSha256)
const reader = await openCountryDirectoryPrototype(output, indexHash)
assert.equal(reader.countries().length, 54)
assert.equal(reader.residentBytes, indexBytes.length)
assert.deepEqual([...reader.loadCounts], [])
const selected = await reader.getCountryDirectory('ly')
assert.equal(selected.cities[0].timezone, 'Africa/Tripoli')
assert.equal(selected.cities[0].open, false)
assert.equal(await reader.getCountryDirectory('ly'), selected)
assert.deepEqual([...reader.loadCounts], [['ly', 1]])
const selectedResidentBytes = reader.residentBytes
assert.equal(selectedResidentBytes, indexBytes.length + index.countries.find((row) => row.iso2 === 'LY').bytes)
await assert.rejects(reader.getCountryDirectory('zz'), /unknown country/u)
reader.dispose()
assert.equal(reader.residentBytes, 0)
await assert.rejects(reader.getCountryDirectory('ly'), /disposed/u)
process.stdout.write(`${JSON.stringify({
  status: 'passed', checkedAtUtc: new Date().toISOString(), c1SourceSha: C1_SOURCE_SHA,
  indexSha256: indexHash, countryCount: 54, openCountryCount: openCountries.length, openCountries,
  queuedCitiesClosed: queuedCities, selectedCandidatesClosed: selectedCities,
  originalNigeriaRowsPreserved: 40, protectedNigeriaSourceTreesUnchangedFromC1: true,
  historicalToCurrentReceiptTransitionsVerified: ['TZ', 'BW'],
  mogadishuCurrentPacketAndCorrectionAuditAgree: true,
  rawBytes: { index: indexBytes.length, allCountryShards: allShardBytes, total: indexBytes.length + allShardBytes, indexPlusSelectedLibya: selectedResidentBytes },
  reader: { initialCountryReads: 0, selectedCountryReads: 1, repeatedSelectionUsesCache: true, unknownCountryRejected: true, disposedRejectsReads: true },
  limitations: ['Offline Node metadata prototype; no runtime admission or measured startup savings.', 'Raw JSON accounting is not JavaScript heap or device-memory measurement.', 'No production travel or physical-device claim.'],
}, null, 2)}\n`)
