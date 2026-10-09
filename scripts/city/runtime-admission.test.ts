import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCountryDirectory, C1_BASELINE_PINS, sha256, stableJson, validateRuntimeAdmission } from './runtime-admission.ts'
import type { C1BaselineKey, CatalogueRow, ForeignCityPin } from './runtime-admission.ts'

type TestAdmissionRow = { id: string; countryISO: string | null; countryName?: string; sourcePacket?: { path: string; sha256: string } }
type TestManifest = { schemaVersion: 1; baseline: { c1Commit: string; files: Record<C1BaselineKey, { path: string; bytes: number; sha256: string }> }; inventorySha256: string; rows: TestAdmissionRow[]; foreignCities: ForeignCityPin[]; admissionSha256: string }

const baselineRows: CatalogueRow[] = [
  ...Array.from({ length: 40 }, (_, index): CatalogueRow => [`nigeria-${index}`, `Nigeria ${index}`, 'starter', 'Starter', 3 + index / 100, 6, 0]),
  ...Array.from({ length: 10 }, (_, index): CatalogueRow => [`foreign-${index}`, `Foreign ${index}`, 'gh-starter', 'Starter district', -1 - index / 100, 5, 1, `a${String.fromCharCode(97 + index)}`, `Country ${index}`]),
]

function manifestFor(rows: readonly CatalogueRow[] = baselineRows): TestManifest {
  const rowPins: TestAdmissionRow[] = rows.map((row) => row.length === 7
    ? { id: row[0], countryISO: null }
    : { id: row[0], countryISO: row[7], countryName: row[8] })
  const foreignCities: ForeignCityPin[] = rows.filter((row) => row.length === 9).map((row) => ({ id: row[0], countryISO: row[7] }))
  return {
    schemaVersion: 1,
    baseline: { c1Commit: 'c1f7c1f7369139ce559292318ba9842c23a28267', files: {
      catalogue: { ...C1_BASELINE_PINS.catalogue },
      loaders: { ...C1_BASELINE_PINS.loaders },
      routes: { ...C1_BASELINE_PINS.routes },
      catalogueSource: { ...C1_BASELINE_PINS.catalogueSource },
    } },
    inventorySha256: '90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b',
    rows: rowPins,
    foreignCities,
    admissionSha256: sha256(stableJson(foreignCities)),
  }
}

function catalogueCities(rows: readonly CatalogueRow[] = baselineRows) {
  return rows.map((row) => ({
    id: row[0], name: row[1], state: { id: row[2], name: row[3] },
    ...(row.length === 9 ? { countryISO: row[7], countryName: row[8] } : {}),
    lon: row[4], lat: row[5], open: true, airport: row[6] === 1,
  }))
}

test('validates the 40-row Nigeria prefix and exact ordered foreign allowlist', () => {
  const manifest = manifestFor()
  const validated = validateRuntimeAdmission(manifest, baselineRows)
  assert.equal(validated.foreignCities.length, 10)
  assert.equal(validated.admissionSha256, manifest.admissionSha256)
})

test('rejects a changed historical baseline pin', () => {
  const manifest = manifestFor()
  manifest.baseline.files.catalogue.bytes += 1
  assert.throws(() => validateRuntimeAdmission(manifest, baselineRows), /immutable C1 identity/u)
})

test('rejects C1 reordering, country mutation, and unreviewed extensions', () => {
  const reordered = manifestFor()
  const first = reordered.rows[0]
  const second = reordered.rows[1]
  assert.ok(first && second)
  reordered.rows.splice(0, 2, second, first)
  assert.throws(() => validateRuntimeAdmission(reordered, baselineRows), /C1 order/u)

  const wrongCountry = manifestFor()
  const foreignRow = wrongCountry.rows[40]
  assert.ok(foreignRow)
  foreignRow.countryISO = 'zz'
  assert.throws(() => validateRuntimeAdmission(wrongCountry, baselineRows), /country identity/u)

  const extraRow: CatalogueRow = ['extra-city', 'Extra', 'x-starter', 'Starter', 1, 2, 1, 'xx', 'Example']
  const unreviewed = manifestFor([...baselineRows, extraRow])
  const unreviewedExtension = unreviewed.rows.at(-1)
  assert.ok(unreviewedExtension)
  delete unreviewedExtension.sourcePacket
  assert.throws(() => validateRuntimeAdmission(unreviewed, baselineRows), /source-packet/u)
})

test('accepts only a declared, source-pinned extension after the unchanged C1 prefix', () => {
  const extraRow: CatalogueRow = ['extra-city', 'Extra', 'xx-starter', 'Starter', 1, 2, 1, 'xx', 'Example']
  const rows = [...baselineRows, extraRow]
  const manifest = manifestFor(rows)
  const extensionPin = manifest.rows.at(-1)
  assert.ok(extensionPin)
  extensionPin.sourcePacket = { path: 'world/playable-africa-rollout/batches/approved.json', sha256: 'a'.repeat(64) }
  manifest.admissionSha256 = sha256(stableJson(manifest.foreignCities))
  assert.equal(validateRuntimeAdmission(manifest, baselineRows).foreignCities.length, 11)

  const cities = catalogueCities(rows)
  const built = buildCountryDirectory({ cities, admissionSha256: manifest.admissionSha256 })
  assert.equal(built.directories.length, 12)
  assert.deepEqual(built.index.source, {
    c1Commit: manifest.baseline.c1Commit,
    inventorySha256: manifest.inventorySha256,
    admissionSha256: manifest.admissionSha256,
  })
  assert.equal(built.directories.every((entry) => entry.content.toString('utf8').includes('containsGeometry":false')), true)
})

test('country shards reject non-catalogue metadata and preserve all 40 Nigeria rows', () => {
  const cities = catalogueCities()
  const built = buildCountryDirectory({ cities, admissionSha256: manifestFor().admissionSha256 })
  const nigeria = built.directories.find((entry) => entry.iso2 === 'NG')
  assert.equal(nigeria?.cityCount, 40)
  assert.equal(built.directories.length, 11)
  const firstCity = cities[0]
  assert.ok(firstCity)
  const malformedCities = [Object.assign({}, firstCity, { modulePath: 'unadmitted/index.ts' }), ...cities.slice(1)]
  assert.throws(() => buildCountryDirectory({
    cities: malformedCities,
    admissionSha256: manifestFor().admissionSha256,
  }), /exact CityCatalogueEntry/u)
})
