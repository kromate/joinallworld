import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const C1_SOURCE_SHA = 'c1f7c1f7369139ce559292318ba9842c23a28267'
export const ROLLOUT_INVENTORY_SHA256 = '90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b'
export const DIRECTORY_LIMITS = Object.freeze({
  catalogueBytes: 256 * 1024,
  factsBytes: 64 * 1024,
  receiptBytes: 256 * 1024,
  inventoryBytes: 512 * 1024,
  indexBytes: 128 * 1024,
  countryBytes: 128 * 1024,
  countryCount: 64,
  allCountryBytes: 2 * 1024 * 1024,
  residentBytes: 512 * 1024,
  receiptCount: 64,
  concurrentCountryReads: 2,
})

const EXTENT_REVISION_CITIES = Object.freeze({
  mogadishu: Object.freeze({ countryIso2: 'SO', country: 'Somalia' }),
  dar: Object.freeze({ countryIso2: 'TZ', country: 'Tanzania' }),
  gaborone: Object.freeze({ countryIso2: 'BW', country: 'Botswana' }),
})

const SHA256 = /^[a-f0-9]{64}$/
const ISO2 = /^[a-z]{2}$/
const ISO2_UPPER = /^[A-Z]{2}$/
const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const codePointCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('directory values must use finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('directory contains an unsupported value')
  const record = value
  return `{${Object.keys(record).sort(codePointCompare).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

const stableJson = (value) => Buffer.from(`${canonical(value)}\n`, 'utf8')
const assertRecord = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}
const assertText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`)
  return value
}
const assertFinite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
  return value
}

function parseCatalogueRows(source) {
  const rows = []
  for (const line of source.split(/\r?\n/u)) {
    const match = /^  (\[.*\]),$/u.exec(line)
    if (!match) continue
    let row
    try { row = JSON.parse(match[1]) } catch { throw new TypeError('generated catalogue contains an invalid JSON row') }
    if (!Array.isArray(row) || ![7, 9].includes(row.length)) throw new TypeError('generated catalogue row has an unsupported shape')
    const [id, name, stateId, stateName, lon, lat, airport, countryISO, countryName] = row
    assertText(id, 'catalogue city id'); assertText(name, 'catalogue city name')
    assertText(stateId, 'catalogue state id'); assertText(stateName, 'catalogue state name')
    assertFinite(lon, `${id}.lon`); assertFinite(lat, `${id}.lat`)
    if (airport !== 0 && airport !== 1) throw new TypeError(`${id}.airport must be the catalogue bit`)
    if (row.length === 9) {
      if (typeof countryISO !== 'string' || !ISO2.test(countryISO) || !assertText(countryName, `${id}.countryName`)) throw new TypeError(`${id} foreign country metadata is invalid`)
    }
    rows.push(row)
  }
  if (!rows.length) throw new Error('no generated catalogue rows found')
  return rows
}

function parseSingleQuoted(raw) {
  return raw.replace(/\\'/gu, "'").replace(/\\\\/gu, '\\')
}

/** Parse only the deliberately small RESERVED_CITIES literal; unfamiliar syntax fails closed. */
export function parseReservedCities(source) {
  const section = /const RESERVED_CITIES:[\s\S]*?Object\.freeze\(\[([\s\S]*?)\n\]\)/u.exec(source)?.[1]
  if (section === undefined) throw new Error('C1 reserved-city catalogue was not found')
  const matches = [...section.matchAll(/Object\.freeze\(\{([\s\S]*?)\n  \}\),?/gu)]
  if (!matches.length) throw new Error('C1 reserved-city catalogue is empty')
  return matches.map(([_, body]) => {
    const stringField = (field) => {
      const raw = new RegExp(`\\b${field}: '((?:\\\\.|[^'])*)'`, 'u').exec(body)?.[1]
      if (raw === undefined) throw new Error(`unsupported reserved-city ${field} literal`)
      return parseSingleQuoted(raw)
    }
    const numberField = (field) => {
      const raw = new RegExp(`\\b${field}: (-?(?:\\d+\\.?\\d*|\\.\\d+))`, 'u').exec(body)?.[1]
      if (raw === undefined) throw new Error(`unsupported reserved-city ${field} literal`)
      return Number(raw)
    }
    const state = /state: Object\.freeze\(\{\s*id: '((?:\\.|[^'])*)', name: '((?:\\.|[^'])*)'\s*\}\)/u.exec(body)
    if (!state) throw new Error('unsupported reserved-city state literal')
    const bool = (field) => {
      const raw = new RegExp(`\\b${field}: (true|false)`, 'u').exec(body)?.[1]
      if (raw === undefined) throw new Error(`unsupported reserved-city ${field} literal`)
      return raw === 'true'
    }
    const previewMatch = /preview: Object\.freeze\(\[([^\]]*)\]\)/u.exec(body)
    const preview = previewMatch ? [...previewMatch[1].matchAll(/'((?:\\.|[^'])*)'/gu)].map((match) => parseSingleQuoted(match[1])) : undefined
    const row = {
      id: stringField('id'), name: stringField('name'), state: { id: parseSingleQuoted(state[1]), name: parseSingleQuoted(state[2]) },
      lon: numberField('lon'), lat: numberField('lat'), open: bool('open'), airport: bool('airport'),
    }
    const teaser = /\bteaser: '((?:\\.|[^'])*)'/u.exec(body)?.[1]
    if (teaser !== undefined) row.teaser = parseSingleQuoted(teaser)
    if (preview) row.preview = preview
    if (!CITY_ID.test(row.id)) throw new TypeError('reserved city id is invalid')
    return row
  })
}

function parseLoaderIds(source) {
  return [...source.matchAll(/import\("\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\/index\.ts"\)/gu)].map((match) => match[1])
}

function parseFacts(source, label) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > DIRECTORY_LIMITS.factsBytes) throw new RangeError(`${label} exceeds the facts source limit`)
  const raw = /export const FACTS = (\{[\s\S]*?\}) satisfies DestinationFacts/u.exec(source)?.[1]
  if (!raw) throw new Error(`${label} has no supported FACTS JSON literal`)
  let facts
  try { facts = JSON.parse(raw) } catch { throw new TypeError(`${label} FACTS literal is not JSON`) }
  return assertRecord(facts, `${label} FACTS`)
}

function acceptedCity(row, modulePath, factsPin) {
  const [id, name, stateId, stateName, lon, lat, airport, countryISO, countryName] = row
  const city = {
    id, name, state: { id: stateId, name: stateName }, lon, lat, airport: airport === 1,
    open: true, admissionStatus: countryISO ? 'accepted-foreign' : 'legacy-open', modulePath,
    ...(countryISO ? { countryISO, countryName } : {}), sourcePin: factsPin,
  }
  return city
}

function validateFactsAgainstCatalogue(facts, row, label) {
  const [id, name, stateId, stateName, lon, lat, airport, countryISO, countryName] = row
  if (facts.id !== id || facts.name !== name || facts.state?.idunique !== stateId || facts.state?.name !== stateName || facts.centre?.lon !== lon || facts.centre?.lat !== lat) throw new Error(`${label} does not match its generated C1 catalogue row`)
  if (facts.country?.idISOlower !== (countryISO ?? 'ng') || (countryISO && facts.country?.name !== countryName)) throw new Error(`${label} country identity differs from the generated C1 row`)
  if (Boolean(facts.airport) !== (airport === 1)) throw new Error(`${label} airport presence differs from the generated C1 row`)
}

function validatedAirport(facts, label) {
  const airport = assertRecord(facts.airport, `${label}.airport`)
  return Object.freeze({
    id: assertText(airport.id, `${label}.airport.id`), name: assertText(airport.name, `${label}.airport.name`),
    lon: assertFinite(airport.lon, `${label}.airport.lon`), lat: assertFinite(airport.lat, `${label}.airport.lat`),
    sourceUrl: assertText(airport.sourceUrl, `${label}.airport.sourceUrl`),
  })
}

function cityFromFacts(facts, iso2, countryName, status, sourcePin, modulePath) {
  const id = assertText(facts.id, 'facts.id')
  if (!CITY_ID.test(id)) throw new TypeError(`invalid destination city id ${id}`)
  const country = assertRecord(facts.country, `${id}.country`), state = assertRecord(facts.state, `${id}.state`), centre = assertRecord(facts.centre, `${id}.centre`)
  if (country.idISOlower !== iso2.toLowerCase() || country.name !== countryName) throw new Error(`${id} facts country differs from queued source identity`)
  const city = {
    id, name: assertText(facts.name, `${id}.name`), state: { id: assertText(state.idunique, `${id}.state.id`), name: assertText(state.name, `${id}.state.name`) },
    countryISO: iso2.toLowerCase(), countryName, lon: assertFinite(centre.lon, `${id}.centre.lon`), lat: assertFinite(centre.lat, `${id}.centre.lat`),
    airport: true, airportPoint: validatedAirport(facts, id), open: false, admissionStatus: status, modulePath,
    timezone: assertText(facts.timezone, `${id}.timezone`), sourcePin,
  }
  if (Array.isArray(facts.bounds)) city.bounds = facts.bounds.map((value, index) => assertFinite(value, `${id}.bounds[${index}]`))
  for (const field of ['sourceLabel', 'sourceUrl', 'licence', 'coverageNote']) if (typeof facts[field] === 'string') city[field] = facts[field]
  return city
}

function cityFromInventory(candidate, inventorySha) {
  const chosen = candidate.chosenCity
  if (!chosen) return null
  const airport = candidate.airportCandidate ?? null
  const city = {
    id: null, name: assertText(chosen.name, `${candidate.iso2}.chosenCity.name`), state: null,
    countryISO: candidate.iso2.toLowerCase(), countryName: assertText(candidate.country, `${candidate.iso2}.country`),
    lon: assertFinite(chosen.coordinatesWgs84?.[0], `${candidate.iso2}.chosenCity.lon`),
    lat: assertFinite(chosen.coordinatesWgs84?.[1], `${candidate.iso2}.chosenCity.lat`),
    airport: Boolean(airport), airportPoint: airport ? Object.freeze({
      id: assertText(String(airport.id), `${candidate.iso2}.airport.id`), name: assertText(airport.name, `${candidate.iso2}.airport.name`),
      lon: assertFinite(airport.coordinatesWgs84?.[0], `${candidate.iso2}.airport.lon`), lat: assertFinite(airport.coordinatesWgs84?.[1], `${candidate.iso2}.airport.lat`),
      sourceUrl: assertText(airport.sourceRecordUrl, `${candidate.iso2}.airport.sourceUrl`), datasetType: airport.type,
      scheduledServiceInDataset: airport.scheduledService === true, isoCountry: airport.isoCountry ?? null, isoRegion: airport.isoRegion ?? null,
      iata: airport.iata ?? null, icao: airport.icao ?? null, coordinateEvidence: airport.coordinateEvidence ?? null,
    }) : null,
    open: false, admissionStatus: 'selected-place-candidate', modulePath: null,
    timezone: candidate.cityTimezone?.ianaTimezone ?? null,
    timezoneEvidence: candidate.cityTimezone ?? null,
    settlementEvidence: Object.freeze({
      sourceClass: chosen.sourceClass ?? null, naturalEarthPlaceId: chosen.naturalEarthPlaceId ?? null,
      timezone: chosen.timezoneFromPlaceRecord ?? null, admin0A3: chosen.admin0A3 ?? null,
      matchesCountryAdmin0: chosen.admin0A3MatchesAdmin0Country ?? null,
      capitalClassificationMayBeStale: chosen.capitalClassificationMayBeStale ?? null,
    }),
    sourcePin: Object.freeze({ kind: 'rollout-inventory', sha256: inventorySha, selectedPlaceId: chosen.naturalEarthPlaceId ?? null }),
  }
  return city
}

function validateReceiptFacts(receipt, facts, candidate, label) {
  if (receipt.cityId !== facts.id || receipt.countryIso2 !== facts.country.idISOlower.toUpperCase()) throw new Error(`${label} facts identity does not match its receipt`)
  if (receipt.generationIdentity?.stateId !== facts.state.idunique || receipt.generationIdentity?.stateName !== facts.state.name) throw new Error(`${label} facts state differs from receipt identity`)
  const place = receipt.selectedPlace
  if (facts.name !== place?.name || facts.centre?.lon !== place?.coordinatesWgs84?.[0] || facts.centre?.lat !== place?.coordinatesWgs84?.[1]) throw new Error(`${label} facts differ from the pinned settlement selection`)
  const selectedTimezone = assertText(candidate?.cityTimezone?.ianaTimezone, `${label}.inventory IANA timezone`)
  if (facts.timezone !== selectedTimezone) throw new Error(`${label} facts differ from the pinned inventory IANA timezone`)
  const airport = receipt.airportCandidate
  if (!airport || facts.airport?.name !== airport.name || facts.airport?.lon !== airport.coordinatesWgs84?.[0] || facts.airport?.lat !== airport.coordinatesWgs84?.[1] || facts.airport?.sourceUrl !== airport.sourceRecordUrl) throw new Error(`${label} facts differ from the pinned airport dataset point`)
  if (facts.sourceUrl !== receipt.sources?.osm?.url || JSON.stringify(facts.bounds) !== JSON.stringify(receipt.bounds)) throw new Error(`${label} facts differ from the receipt's bounded source area`)
  if (candidate && (candidate.country !== facts.country.name || candidate.chosenCity?.name !== facts.name || candidate.chosenCity?.coordinatesWgs84?.[0] !== facts.centre.lon || candidate.chosenCity?.coordinatesWgs84?.[1] !== facts.centre.lat)) throw new Error(`${label} facts differ from the rollout inventory candidate`)
}

/** Permit only the exact historical packet pin -> independently audited current receipt transition. */
export function resolveReceiptPacketPin({ receiptPath, receiptSha256, receiptBytes, receipt, packetPins, acceptance }) {
  if (!Array.isArray(packetPins)) throw new TypeError('receipt packet pins must be an array')
  if (!Number.isSafeInteger(receiptBytes) || receiptBytes < 0) throw new TypeError('current receipt byte length is required')
  if (!packetPins.length) return null
  const uniquePins = new Map()
  for (const pin of packetPins) {
    if (!pin || pin.path !== receiptPath || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || !SHA256.test(pin.sha256 ?? '')) throw new Error(`invalid or contradictory packet pin for ${receiptPath}`)
    const identity = `${pin.bytes}:${pin.sha256}`
    uniquePins.set(identity, pin)
  }
  if (uniquePins.size !== 1) throw new Error(`contradictory duplicate packet pins for ${receiptPath}`)
  const historicalPin = [...uniquePins.values()][0]
  if (historicalPin.sha256 === receiptSha256) {
    if (historicalPin.bytes !== receiptBytes) throw new Error(`receipt packet byte count differs from current file: ${receiptPath}`)
    return Object.freeze({ packet: historicalPin.packet, bytes: historicalPin.bytes, sha256: historicalPin.sha256 })
  }

  const cityId = receipt?.cityId
  const expected = EXTENT_REVISION_CITIES[cityId]
  if (!expected || receiptPath !== `world/playable-africa-rollout/receipts/${cityId}.json` || receipt?.countryIso2 !== expected.countryIso2) throw new Error(`receipt differs from its packet pin: ${receiptPath}`)
  if (!acceptance || acceptance.status !== 'passed' || acceptance.importsCompilerOrRevisionPublisher !== false || acceptance.registeredInProduction !== false || !Array.isArray(acceptance.cities) || !Array.isArray(acceptance.limitations) || !acceptance.limitations.some((item) => typeof item === 'string' && /topology/iu.test(item))) throw new Error('extent correction acceptance is absent or unqualified')
  const matches = acceptance.cities.filter((row) => row?.city === cityId)
  if (matches.length !== 1) throw new Error(`extent correction audit is missing or duplicated for ${cityId}`)
  const audit = matches[0]
  if (audit.country !== expected.countryIso2 || audit.beforeReceiptSha256 !== historicalPin.sha256 || audit.afterReceiptSha256 !== receiptSha256 || !SHA256.test(audit.beforeReceiptSha256 ?? '') || !SHA256.test(audit.afterReceiptSha256 ?? '') || !SHA256.test(audit.revisionId ?? '') || !(audit.beforeOutsideVertices > 0) || audit.afterOutsideVertices !== 0 || audit.completeRoadAndBuildingCoordinatesUnchanged !== true || audit.sourceAndRequestLedgerUnchanged !== true) throw new Error(`extent correction audit does not bind the historical and current ${cityId} receipts`)
  return Object.freeze({
    packet: historicalPin.packet, bytes: historicalPin.bytes, sha256: historicalPin.sha256,
    correction: Object.freeze({ path: 'world/starter-extent-revisions-acceptance.json', city: cityId, countryIso2: expected.countryIso2, currentReceiptBytes: receiptBytes, currentReceiptSha256: receiptSha256, revisionId: audit.revisionId }),
  })
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Compile normalized metadata only. It never imports city modules, geometry, rules, content, or routes. */
export function compileCountryDirectories({ acceptedRows, reservedCities = [], acceptedFacts = {}, candidateCountries = [], queuedReceipts = [], inventorySha256, acceptedSourcePins = {} }) {
  if (!SHA256.test(inventorySha256)) throw new TypeError('a pinned rollout inventory SHA-256 is required')
  if (acceptedRows.length > DIRECTORY_LIMITS.countryCount || reservedCities.length > DIRECTORY_LIMITS.countryCount || candidateCountries.length > DIRECTORY_LIMITS.countryCount || queuedReceipts.length > DIRECTORY_LIMITS.receiptCount) throw new RangeError('country directory compiler input count exceeds limits')
  const rows = [...acceptedRows]
  const rowById = new Map()
  for (const row of rows) {
    if (!Array.isArray(row) || !CITY_ID.test(row[0]) || rowById.has(row[0])) throw new Error('generated catalogue contains invalid or duplicate city IDs')
    rowById.set(row[0], row)
  }
  const candidatesByIso = new Map()
  for (const candidateValue of candidateCountries) {
    const candidate = assertRecord(candidateValue, 'candidate country')
    const iso2 = assertText(candidate.iso2, 'candidate ISO-2')
    if (!/^[A-Z]{2}$/u.test(iso2) || candidatesByIso.has(iso2)) throw new Error('candidate ISO-2 is invalid or duplicated')
    candidatesByIso.set(iso2, candidate)
  }

  const countries = new Map()
  const getCountry = (iso2, name, status) => {
    if (countries.has(iso2)) {
      const found = countries.get(iso2)
      if (found.name !== name) throw new Error(`country name conflict for ${iso2}`)
      if (found.status !== status && !(found.status === 'candidate' && status === 'source-ready')) throw new Error(`country status conflict for ${iso2}`)
      if (status === 'source-ready') found.status = status
      return found
    }
    const entry = { iso2, name, status, cities: [] }
    countries.set(iso2, entry)
    return entry
  }

  const nigeria = getCountry('NG', 'Nigeria', 'legacy')
  for (const row of rows) {
    const iso2 = row.length === 9 ? row[7].toUpperCase() : 'NG'
    const countryName = row.length === 9 ? row[8] : 'Nigeria'
    if (iso2 === 'NG' && row.length !== 7) throw new Error('legacy Nigeria rows must retain their original no-country-metadata shape')
    const entry = getCountry(iso2, countryName, iso2 === 'NG' ? 'legacy' : 'accepted')
    const modulePath = `src/game/cities/${row[0]}/index.ts`
    const factSource = acceptedFacts[row[0]]
    let city
    if (iso2 !== 'NG' && !factSource) throw new Error(`accepted foreign city ${row[0]} has no pinned facts source`)
    if (factSource) {
      const facts = parseFacts(factSource.text, `C1 facts ${row[0]}`)
      validateFactsAgainstCatalogue(facts, row, row[0])
      const factsPin = Object.freeze({ kind: 'c1-facts', path: factSource.path, bytes: Buffer.byteLength(factSource.text), sha256: sha256(Buffer.from(factSource.text)) })
      city = acceptedCity(row, modulePath, factsPin)
      city.airportPoint = validatedAirport(facts, row[0])
      city.timezone = assertText(facts.timezone, `${row[0]}.timezone`)
    } else {
      city = acceptedCity(row, modulePath, Object.freeze({ kind: 'c1-catalogue', path: 'src/game/cities/catalogue.generated.ts' }))
    }
    entry.cities.push(city)
  }
  let reservedOffset = 0
  // Match pinned C1 catalogue.ts: generated open rows shadow same-ID reserved rows.
  const filteredReservedCities = reservedCities.filter((row) => !rowById.has(row.id))
  for (const row of filteredReservedCities) {
    if (rowById.has(row.id) || nigeria.cities.some((city) => city.id === row.id)) throw new Error(`reserved city duplicates generated city ${row.id}`)
    nigeria.cities.splice(Math.min(4 + reservedOffset, nigeria.cities.length), 0, deepFreeze({ ...row, admissionStatus: row.open ? 'legacy-open' : 'legacy-reserved', modulePath: row.open ? `src/game/cities/${row.id}/index.ts` : null, sourcePin: Object.freeze({ kind: 'c1-catalogue', path: 'src/game/cities/catalogue.ts' }) }))
    reservedOffset += 1
  }

  for (const [iso2, candidate] of candidatesByIso) {
    if (countries.has(iso2)) throw new Error(`candidate country ${iso2} duplicates an accepted/legacy country`)
    const city = cityFromInventory(candidate, inventorySha256)
    const country = getCountry(iso2, assertText(candidate.country, `${iso2}.country`), city ? 'candidate' : 'no-place')
    country.sourceEvidence = Object.freeze({
      countryId: candidate.countryId ?? null, admin0A3: candidate.admin0A3 ?? null,
      naturalEarthContinentOriginal: candidate.naturalEarthContinentOriginal ?? null,
      regionMembership: candidate.regionMembership ?? null, naturalEarthType: candidate.naturalEarthType ?? null,
      isoIdentityStatus: candidate.isoIdentityStatus ?? null,
    })
    if (city) country.cities.push(city)
  }

  const receiptCities = new Set()
  for (const receiptInputValue of queuedReceipts) {
    const receiptInput = assertRecord(receiptInputValue, 'queued receipt input')
    const receipt = assertRecord(receiptInput.receipt, 'queued receipt')
    const iso2 = assertText(receipt.countryIso2, 'receipt countryIso2')
    if (!/^[A-Z]{2}$/u.test(iso2)) throw new TypeError('receipt ISO-2 is invalid')
    const candidate = candidatesByIso.get(iso2)
    if (!candidate) throw new Error(`receipt country ${iso2} is absent from the pinned candidate inventory`)
    if (receiptCities.has(receipt.cityId)) throw new Error(`duplicate queued receipt city ${receipt.cityId}`)
    receiptCities.add(receipt.cityId)
    const factAsset = receipt.assets?.['facts.ts']
    if (!factAsset || factAsset.bytes !== Buffer.byteLength(receiptInput.factsText) || factAsset.sha256 !== sha256(Buffer.from(receiptInput.factsText))) throw new Error(`${receipt.cityId} facts bytes or SHA-256 differ from receipt`)
    const facts = parseFacts(receiptInput.factsText, `queued facts ${receipt.cityId}`)
    validateReceiptFacts(receipt, facts, candidate, receipt.cityId)
    const country = getCountry(iso2, candidate.country, 'source-ready')
    const receiptBytes = Buffer.byteLength(receiptInput.receiptText)
    const sourcePin = Object.freeze({
      kind: 'queued-source', receiptPath: receiptInput.receiptPath, receiptBytes, receiptSha256: sha256(Buffer.from(receiptInput.receiptText)),
      factsPath: receiptInput.factsPath, factsBytes: factAsset.bytes, factsSha256: factAsset.sha256,
      receiptPinStatus: receiptInput.batchPin?.correctionPath ? 'historical-packet-pin-and-extent-correction-verified' : receiptInput.batchPin ? 'batch-packet-pin-verified' : 'receipt-and-facts-crosschecked',
      ...(receiptInput.batchPin ? { batchPin: receiptInput.batchPin } : {}),
    })
    country.cities = country.cities.filter((city) => city.admissionStatus !== 'selected-place-candidate')
    country.cities.push(cityFromFacts(facts, iso2, candidate.country, 'queued-source-not-registered', sourcePin, `src/game/cities/${facts.id}/index.ts`))
  }

  for (const country of countries.values()) {
    const seen = new Set()
    for (const city of country.cities) {
      const identity = city.id ?? `candidate:${city.name}`
      if (seen.has(identity)) throw new Error(`${country.iso2} repeats city identity ${identity}`)
      seen.add(identity)
    }
  }

  const directories = []
  for (const country of [...countries.values()].sort((a, b) => codePointCompare(a.iso2, b.iso2))) {
    const body = {
      schemaVersion: 1,
      country: { iso2: country.iso2, name: country.name, status: country.status, ...(country.sourceEvidence ? { sourceEvidence: country.sourceEvidence } : {}) },
      cities: country.cities,
      containsGeometry: false,
      containsRules: false,
      containsContent: false,
      containsTravelEdges: false,
    }
    const bytes = stableJson(body)
    if (bytes.byteLength > DIRECTORY_LIMITS.countryBytes) throw new RangeError(`${country.iso2} directory exceeds raw-byte limit`)
    const hash = sha256(bytes)
    directories.push(Object.freeze({ iso2: country.iso2, name: country.name, status: country.status, path: `countries/${country.iso2.toLowerCase()}-${hash}.json`, sha256: hash, bytes: bytes.byteLength, cityCount: country.cities.length, body, content: bytes }))
  }
  const index = {
    schemaVersion: 1,
    source: { c1Commit: C1_SOURCE_SHA, inventorySha256, ...acceptedSourcePins },
    legacy: { countryISO: 'ng', countryName: 'Nigeria', directoryPreservesAllCatalogueRows: true },
    countries: directories.map(({ iso2, name, status, path: directoryPath, sha256: hash, bytes, cityCount }) => ({ iso2, name, status, path: directoryPath, sha256: hash, bytes, cityCount })),
  }
  const indexContent = stableJson(index)
  if (indexContent.byteLength > DIRECTORY_LIMITS.indexBytes) throw new RangeError('country availability index exceeds raw-byte limit')
  if (directories.length > DIRECTORY_LIMITS.countryCount) throw new RangeError('country availability index exceeds country count limit')
  const indexSha256 = sha256(indexContent)
  const countryBytes = directories.reduce((sum, row) => sum + row.bytes, 0)
  if (countryBytes > DIRECTORY_LIMITS.allCountryBytes) throw new RangeError('all country directories exceed the total raw-byte limit')
  return Object.freeze({
    index, indexContent, indexSha256, indexPath: `index-${indexSha256}.json`, directories: Object.freeze(directories),
    sizeReport: Object.freeze({ indexRawBytes: indexContent.byteLength, allCountryDirectoriesRawBytes: countryBytes, totalExportRawBytes: indexContent.byteLength + countryBytes, initialIndexOnlyRawBytes: indexContent.byteLength }),
  })
}

function parseCli(args) {
  const result = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!key.startsWith('--')) throw new TypeError(`unexpected argument ${key}`)
    if (key === '--help') return { help: true }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new TypeError(`${key} requires a value`)
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function gitShow(repo, pathInRepo) {
  return execFileSync('git', ['-C', repo, 'show', `${C1_SOURCE_SHA}:${pathInRepo}`], { encoding: 'utf8', maxBuffer: DIRECTORY_LIMITS.catalogueBytes * 2, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] })
}

async function readBoundedFile(filename, limit) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new RangeError(`input is not a bounded regular file: ${filename}`)
    const buffer = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > limit || offset !== stat.size) throw new RangeError(`input changed or exceeds byte limit: ${filename}`)
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

async function inputsFromRoots(releaseRoot, worldRoot) {
  const catalogueText = gitShow(releaseRoot, 'src/game/cities/catalogue.generated.ts')
  const catalogueSourceText = gitShow(releaseRoot, 'src/game/cities/catalogue.ts')
  const loaderText = gitShow(releaseRoot, 'src/game/cities/loaders.generated.ts')
  const rows = parseCatalogueRows(catalogueText)
  if (rows.length !== 50 || rows.filter((row) => row.length === 7).length !== 40 || rows.filter((row) => row.length === 9).length !== 10) throw new Error('pinned C1 catalogue cardinality changed')
  const ids = rows.map((row) => row[0])
  const loaderIds = parseLoaderIds(loaderText)
  if (ids.length !== loaderIds.length || ids.some((id, index) => id !== loaderIds[index])) throw new Error('C1 catalogue and lazy loader rows are not aligned')
  const facts = Object.create(null)
  for (const row of rows) {
    if (row.length !== 9) continue
    const pathInRepo = `src/game/cities/${row[0]}/facts.ts`
    const text = gitShow(releaseRoot, pathInRepo)
    facts[row[0]] = { path: pathInRepo, text }
  }
  const inventoryPath = path.join(worldRoot, 'world/playable-africa-rollout/inventory.json')
  const inventoryBytes = await readBoundedFile(inventoryPath, DIRECTORY_LIMITS.inventoryBytes)
  const inventorySha = sha256(inventoryBytes)
  if (inventorySha !== ROLLOUT_INVENTORY_SHA256) throw new Error('rollout inventory does not match its pinned SHA-256')
  const inventory = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inventoryBytes))
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.countries)) throw new Error('rollout inventory schema is unsupported')
  const receiptsDir = path.join(worldRoot, 'world/playable-africa-rollout/receipts')
  const receiptNames = (await readdir(receiptsDir)).filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/u.test(name)).sort(codePointCompare)
  if (receiptNames.length > DIRECTORY_LIMITS.receiptCount) throw new RangeError('queued receipt count exceeds limit')
  const batchDirectory = path.join(worldRoot, 'world/playable-africa-rollout/batches')
  const batchPins = new Map()
  for (const batchName of (await readdir(batchDirectory)).filter((name) => /^.+\.json$/u.test(name)).sort(codePointCompare)) {
    const bytes = await readBoundedFile(path.join(batchDirectory, batchName), DIRECTORY_LIMITS.receiptBytes)
    const batch = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    for (const pin of batch.sourceFiles ?? []) if (typeof pin.path === 'string' && pin.path.startsWith('world/playable-africa-rollout/receipts/')) {
      const entry = Object.freeze({ packet: `world/playable-africa-rollout/batches/${batchName}`, path: pin.path, bytes: pin.bytes, sha256: pin.sha256 })
      const existing = batchPins.get(pin.path) ?? []
      existing.push(entry)
      batchPins.set(pin.path, existing)
    }
  }
  const correctionBytes = await readBoundedFile(path.join(worldRoot, 'world/starter-extent-revisions-acceptance.json'), DIRECTORY_LIMITS.receiptBytes)
  const correctionAcceptance = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(correctionBytes))
  const queuedReceipts = []
  for (const receiptName of receiptNames) {
    const cityId = receiptName.slice(0, -5)
    const receiptPath = `world/playable-africa-rollout/receipts/${receiptName}`
    const receiptBytes = await readBoundedFile(path.join(worldRoot, receiptPath), DIRECTORY_LIMITS.receiptBytes)
    const receiptText = new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes)
    const receipt = JSON.parse(receiptText)
    if (receipt.cityId !== cityId) throw new Error(`receipt filename/id mismatch: ${receiptName}`)
    const packetPin = resolveReceiptPacketPin({ receiptPath, receiptSha256: sha256(receiptBytes), receiptBytes: receiptBytes.byteLength, receipt, packetPins: batchPins.get(receiptPath) ?? [], acceptance: correctionAcceptance })
    const batchPin = packetPin ? Object.freeze({ ...packetPin, ...(packetPin.correction ? { correctionPath: packetPin.correction.path, correctionCity: packetPin.correction.city, correctionCountryIso2: packetPin.correction.countryIso2, currentReceiptBytes: packetPin.correction.currentReceiptBytes, currentReceiptSha256: packetPin.correction.currentReceiptSha256, revisionId: packetPin.correction.revisionId } : {}) }) : null
    const factsPath = `src/game/cities/${cityId}/facts.ts`
    const factsBytes = await readBoundedFile(path.join(worldRoot, factsPath), DIRECTORY_LIMITS.factsBytes)
    const factsText = new TextDecoder('utf-8', { fatal: true }).decode(factsBytes)
    queuedReceipts.push({ receipt, receiptText, receiptPath, factsText, factsPath, ...(batchPin ? { batchPin } : {}) })
  }
  if (inventory.countries.length !== 43) throw new Error('pinned rollout candidate denominator changed')
  return {
    acceptedRows: rows, reservedCities: parseReservedCities(catalogueSourceText), acceptedFacts: facts, candidateCountries: inventory.countries, queuedReceipts, inventorySha256: inventorySha,
    acceptedSourcePins: { catalogueSha256: sha256(Buffer.from(catalogueText)), loadersSha256: sha256(Buffer.from(loaderText)), legacyCatalogueSha256: sha256(Buffer.from(catalogueSourceText)) },
  }
}

export async function writePrototype(outputDirectory, compiled, worldRoot) {
  if (!path.isAbsolute(outputDirectory) || !path.isAbsolute(worldRoot)) throw new TypeError('absolute output and world roots are required')
  const rootStat = await lstat(worldRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('world root must be a real directory, not a symlink')
  const canonicalWorldRoot = await realpath(worldRoot)
  const outputRoot = path.join(canonicalWorldRoot, '.cache', 'world-build', 'country-directory-output')
  const lexicalOutputRoot = path.resolve(worldRoot, '.cache/world-build/country-directory-output')
  const relative = path.relative(lexicalOutputRoot, path.resolve(outputDirectory))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('new output directory must be beneath the dedicated world-root output boundary')
  const canonicalOutputDirectory = path.join(outputRoot, relative)

  const ensureDirectory = async (directoryPath) => {
    try {
      const info = await lstat(directoryPath)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`output path component must be a real directory: ${directoryPath}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await mkdir(directoryPath, { mode: 0o700 })
      const info = await lstat(directoryPath)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`output path component changed during creation: ${directoryPath}`)
    }
  }
  let cursor = canonicalWorldRoot
  for (const component of ['.cache', 'world-build', 'country-directory-output']) {
    cursor = path.join(cursor, component)
    await ensureDirectory(cursor)
  }
  const parentParts = relative.split(path.sep).slice(0, -1)
  for (const component of parentParts) {
    if (!component || component === '.' || component === '..') throw new Error('output parent is outside the dedicated boundary')
    cursor = path.join(cursor, component)
    await ensureDirectory(cursor)
  }
  const leafStat = await lstat(canonicalOutputDirectory).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (leafStat) throw new Error('existing output directory or file is refused')
  await mkdir(canonicalOutputDirectory, { mode: 0o700 })
  const countriesDir = path.join(canonicalOutputDirectory, 'countries')
  await mkdir(countriesDir, { mode: 0o700 })
  for (const directory of compiled.directories) await writeFile(path.join(canonicalOutputDirectory, directory.path), directory.content, { flag: 'wx', mode: 0o600 })
  await writeFile(path.join(canonicalOutputDirectory, compiled.indexPath), compiled.indexContent, { flag: 'wx', mode: 0o600 })
  return Object.freeze({ indexPath: compiled.indexPath, indexSha256: compiled.indexSha256, sizeReport: compiled.sizeReport })
}

async function readVerified(filename, limit, expectedHash) {
  const bytes = await readBoundedFile(filename, limit)
  if (!SHA256.test(expectedHash) || sha256(bytes) !== expectedHash) throw new Error('country directory content hash mismatch')
  let parsed
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new TypeError('country directory asset is not valid UTF-8 JSON') }
  return { bytes, value: parsed }
}

/** A bounded, read-only, no-network reader. Only getCountryDirectory reads a country shard. */
export async function openCountryDirectoryPrototype(root, indexHash, { maxResidentBytes = DIRECTORY_LIMITS.residentBytes } = {}) {
  if (!path.isAbsolute(root) || !SHA256.test(indexHash) || !Number.isSafeInteger(maxResidentBytes) || maxResidentBytes < 1 || maxResidentBytes > DIRECTORY_LIMITS.residentBytes) throw new TypeError('absolute root, index SHA-256, and cache limit within the resident cap are required')
  const indexPath = path.join(root, `index-${indexHash}.json`)
  const { bytes: indexBytes, value: indexValue } = await readVerified(indexPath, DIRECTORY_LIMITS.indexBytes, indexHash)
  const index = assertRecord(indexValue, 'country directory index')
  if (indexBytes.byteLength >= DIRECTORY_LIMITS.residentBytes || indexBytes.byteLength > maxResidentBytes) throw new RangeError('country directory index exceeds the raw resident-memory limit')
  if (index.schemaVersion !== 1 || !Array.isArray(index.countries)) throw new TypeError('country directory index schema is unsupported')
  if (index.countries.length > DIRECTORY_LIMITS.countryCount) throw new RangeError('country directory index exceeds country count limit')
  if (index.source?.c1Commit !== C1_SOURCE_SHA || !SHA256.test(index.source?.inventorySha256 ?? '') || index.legacy?.countryISO !== 'ng' || index.legacy?.countryName !== 'Nigeria') throw new Error('country directory index source or Nigeria compatibility identity is invalid')
  deepFreeze(index)
  const entries = new Map()
  for (const value of index.countries) {
    const entry = assertRecord(value, 'country index entry')
    const iso2 = assertText(entry.iso2, 'country index ISO-2')
    if (!ISO2_UPPER.test(iso2) || entries.has(iso2.toLowerCase()) || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > DIRECTORY_LIMITS.countryBytes || entry.path !== `countries/${iso2.toLowerCase()}-${entry.sha256}.json`) throw new Error('country index entry is invalid')
    entries.set(iso2.toLowerCase(), entry)
  }
  const nigeriaEntry = entries.get('ng')
  if (!nigeriaEntry || nigeriaEntry.status !== 'legacy') throw new Error('country directory index omits the protected Nigeria directory')
  const cache = new Map()
  const pending = new Map()
  let residentBytes = indexBytes.byteLength, disposed = false
  const loads = new Map()
  const ensureOpen = () => { if (disposed) throw new Error('country directory reader is disposed') }
  const countries = () => { ensureOpen(); return index.countries }
  const getCountryDirectory = async (iso2) => {
    ensureOpen()
    if (typeof iso2 !== 'string' || !ISO2.test(iso2)) throw new TypeError('country ISO-2 must be lowercase')
    const entry = entries.get(iso2)
    if (!entry) throw new RangeError(`unknown country: ${iso2}`)
    const cached = cache.get(iso2)
    if (cached) { cache.delete(iso2); cache.set(iso2, cached); return cached.value }
    const active = pending.get(iso2)
    if (active) return active
    if (pending.size >= DIRECTORY_LIMITS.concurrentCountryReads) throw new RangeError('concurrent country read limit exceeded')
    const work = (async () => {
      if (entry.bytes + indexBytes.byteLength > maxResidentBytes) throw new RangeError('country shard exceeds configured resident cache')
      const filename = path.join(root, entry.path)
      const { bytes, value } = await readVerified(filename, DIRECTORY_LIMITS.countryBytes, entry.sha256)
      ensureOpen()
      if (bytes.byteLength !== entry.bytes || value.schemaVersion !== 1 || value.country?.iso2 !== entry.iso2 || !Array.isArray(value.cities)) throw new Error('country shard disagrees with its index')
      const frozen = deepFreeze(value)
      while (residentBytes + bytes.byteLength > maxResidentBytes && cache.size) {
        const oldest = cache.keys().next().value
        const evicted = cache.get(oldest)
        residentBytes -= evicted.bytes
        cache.delete(oldest)
      }
      if (residentBytes + bytes.byteLength > maxResidentBytes) throw new RangeError('country shard exceeds configured resident cache')
      cache.set(iso2, { value: frozen, bytes: bytes.byteLength })
      residentBytes += bytes.byteLength
      loads.set(iso2, (loads.get(iso2) ?? 0) + 1)
      return frozen
    })().finally(() => { if (pending.get(iso2) === work) pending.delete(iso2) })
    pending.set(iso2, work)
    return work
  }
  const dispose = () => { disposed = true; cache.clear(); pending.clear(); residentBytes = 0 }
  return Object.freeze({ index, indexBytes: indexBytes.byteLength, countries, getCountryDirectory, dispose, get residentBytes() { return residentBytes }, get pendingReads() { return pending.size }, get loadCounts() { return new Map(loads) } })
}

function help() {
  return `Country-directory prototype (offline; source metadata only)\n\nUsage:\n  node world/tooling/country-directory-prototype.mjs --release-root ABS --world-root ABS --out ABS_DIR_UNDER_WORLD_ROOT/.cache/world-build/country-directory-output\n\nThe compiler reads accepted catalogue/facts from pinned C1 ${C1_SOURCE_SHA}, plus the pinned rollout inventory and local receipt/facts pairs. It writes content-hashed country JSON shards and one small availability index. It never loads game maps, rules, content, travel edges, network data, or modifies source/cache ledgers. Existing output directories are refused. Reported sizes are raw JSON bytes; measured game-bundle savings remain unverified. The read-only reader counts index bytes in its 512 KiB resident cap and permits at most two distinct country shard reads in flight.\n\nReader API: openCountryDirectoryPrototype(root, indexSha256), countries(), getCountryDirectory(lowercaseIso2), dispose().\n`
}

async function main(args) {
  const parsed = parseCli(args)
  if (parsed.help) { process.stdout.write(help()); return }
  for (const key of Object.keys(parsed)) if (!['release-root', 'world-root', 'out'].includes(key)) throw new TypeError(`unknown option --${key}`)
  for (const key of ['release-root', 'world-root', 'out']) if (typeof parsed[key] !== 'string' || !path.isAbsolute(parsed[key])) throw new TypeError(`--${key} must be an absolute path`)
  const inputs = await inputsFromRoots(parsed['release-root'], parsed['world-root'])
  const compiled = compileCountryDirectories(inputs)
  if (compiled.directories.length !== 54) throw new Error('compiled country denominator is not 54')
  const written = await writePrototype(parsed.out, compiled, parsed['world-root'])
  const cityCounts = Object.fromEntries(compiled.directories.map(({ iso2, cityCount }) => [iso2, cityCount]))
  process.stdout.write(`${JSON.stringify({ status: 'compiled-source-metadata-only', c1SourceSha: C1_SOURCE_SHA, inventorySha256: inputs.inventorySha256, countryCount: compiled.directories.length, cityCounts, ...written, gameBundleSavings: 'unmeasured' }, null, 2)}\n`)
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'country-directory compilation failed'}\n`)
    process.exitCode = 1
  })
}
