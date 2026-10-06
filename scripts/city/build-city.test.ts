import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SAGAMU_LEGACY_RECIPE } from '../../src/game/cities/sagamu/recipe.ts'
import { buildFormulaContent } from '../../src/game/cities/formula/content.ts'
import { buildFormulaRules } from '../../src/game/cities/formula/rules.ts'
import { buildFormulaScenes } from '../../src/game/cities/formula/scenes.ts'
import { defineCitySpec, validateCitySpec } from '../../src/game/cities/spec.ts'
import type { CitySpec, RealPlaceFact, RealPlaceKind } from '../../src/game/cities/spec.ts'
import type { BoundaryFeatureCollection } from '../geo/nigeria-boundaries.ts'
import {
  formulaContentText,
  formulaIndexText,
  formulaRulesText,
  formulaScenesText,
  generatedTextIsCurrent,
  legacyGeneratedFiles,
  wikidataCoordinate,
} from './build-city.ts'
import { buildSelectedStateTopology } from './geometry.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const invalidSpec: CitySpec<'test-city'> = {
  schemaVersion: 1,
  id: 'test-city',
  name: 'Test City',
  state: { id: 'test-state', name: 'Test State', sourceName: 'Test', unit: 'local government', sourceIds: ['one-source'] },
  country: { id: 'ng', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 3,
    lat: 7,
    teaser: 'Invalid fixture.',
    preview: [],
    coordinateSourceId: 'one-source',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 1 },
  },
  population: { tier: 'town', sourceIds: ['one-source'] },
  localUnits: [],
  places: [],
  identity: { foods: [], crafts: [], industries: [] },
  transport: {
    airports: [],
    rail: [],
    ports: [],
    absent: [
      { mode: 'airport', sourceIds: ['one-source'], note: 'Fixture.' },
      { mode: 'rail', sourceIds: ['one-source'], note: 'Fixture.' },
      { mode: 'port', sourceIds: ['one-source'], note: 'Fixture.' },
    ],
  },
  climate: {
    profile: 'southern-wet-dry',
    rainyMonths: [4],
    dryMonths: [12],
    description: 'Fixture.',
    clearLabel: 'Clear',
    sourceIds: ['one-source'],
  },
  homePalette: { back: '#ffffff', left: '#eeeeee', floor: ['#dddddd', '#cccccc'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/test-city-surface.geojson', bytes: 1, sha256: '0'.repeat(64) } },
  sourceGroups: [{
    id: 'one-source',
    title: 'Fixture source',
    url: 'https://www.openstreetmap.org/node/1',
    checkedOn: '2026-10-06',
    supports: ['coordinate', 'identity', 'population', 'climate', 'transport', 'geography'],
    cache: { path: 'scripts/geo/sources/formula/fixture.json', bytes: 1, sha256: '0'.repeat(64) },
  }],
}

const placeSeeds: readonly { readonly id: string; readonly kind: RealPlaceKind; readonly unit: 'test-centre' | 'test-north' }[] = [
  { id: 'test-road-hub', kind: 'road-hub', unit: 'test-centre' },
  { id: 'test-centre-market', kind: 'market', unit: 'test-centre' },
  { id: 'test-heritage', kind: 'heritage', unit: 'test-north' },
  { id: 'test-eatery', kind: 'eatery', unit: 'test-centre' },
  { id: 'test-hospital', kind: 'hospital', unit: 'test-centre' },
  { id: 'test-garden', kind: 'garden', unit: 'test-centre' },
  { id: 'test-government', kind: 'government', unit: 'test-centre' },
  { id: 'test-polling', kind: 'polling', unit: 'test-centre' },
  { id: 'test-salon', kind: 'salon', unit: 'test-centre' },
  { id: 'test-savings', kind: 'savings', unit: 'test-centre' },
  { id: 'test-landmark', kind: 'civic-landmark', unit: 'test-centre' },
  { id: 'test-stadium', kind: 'stadium', unit: 'test-centre' },
  { id: 'test-university', kind: 'university', unit: 'test-north' },
  { id: 'test-church', kind: 'church', unit: 'test-north' },
  { id: 'test-park', kind: 'park', unit: 'test-north' },
  { id: 'test-craft-centre', kind: 'craft-centre', unit: 'test-north' },
  { id: 'test-mosque', kind: 'mosque', unit: 'test-north' },
  { id: 'test-museum', kind: 'museum', unit: 'test-north' },
  { id: 'test-airport', kind: 'airport', unit: 'test-north' },
  { id: 'test-rail-station', kind: 'rail-station', unit: 'test-north' },
]

const fixturePlace = (seed: (typeof placeSeeds)[number], index: number): RealPlaceFact => ({
  id: seed.id,
  name: `Synthetic ${seed.kind} ${index + 1}`,
  kind: seed.kind,
  lon: 3 + index * 0.001,
  lat: 7 + index * 0.001,
  localUnitId: seed.unit,
  description: `Synthetic test-only ${seed.kind}.`,
  coordinateSourceId: 'test-source',
  coordinateRef: { provider: 'openstreetmap', element: 'node', id: index + 1 },
  accuracy: 'mapped-feature',
  sourceIds: ['test-source'],
  scene: { roof: index % 3 === 0 ? 'flat' : index % 3 === 1 ? 'gable' : 'hipped', sign: index % 2 ? 'facade' : 'roadside', props: ['tree'] },
  ...(seed.kind === 'eatery' ? { featuredIdentityId: 'test-food' } : {}),
  ...(seed.kind === 'market' ? { specialtyIds: ['test-food', 'test-craft'] } : {}),
})

const formulaSpec = defineCitySpec({
  schemaVersion: 1,
  id: 'test-formula',
  name: 'Synthetic Formula City',
  state: { id: 'test-state', name: 'Test State', sourceName: 'Test State', unit: 'local government', sourceIds: ['test-source'] },
  country: { id: 'ng', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  atlas: {
    lon: 3,
    lat: 7,
    teaser: 'Synthetic formula fixture.',
    preview: ['Synthetic venues'],
    coordinateSourceId: 'test-source',
    coordinateRef: { provider: 'openstreetmap', element: 'node', id: 999 },
  },
  population: { tier: 'small-city', sourceIds: ['test-source'] },
  localUnits: [
    { id: 'test-centre', name: 'Test Centre', sourceName: 'Test Centre', populationTier: 'small-city', description: 'Synthetic centre.', sourceIds: ['test-source'] },
    { id: 'test-north', name: 'Test North', sourceName: 'Test North', populationTier: 'town', description: 'Synthetic north.', sourceIds: ['test-source'] },
  ],
  places: placeSeeds.map(fixturePlace),
  identity: {
    foods: [{ id: 'test-food', name: 'test plate', description: 'Synthetic food.', localProductId: 'local-plate', sourceIds: ['test-source'] }],
    crafts: [{ id: 'test-craft', name: 'test basket', description: 'Synthetic craft.', localProductId: 'basket', sourceIds: ['test-source'] }],
    industries: [{ id: 'test-industry-fact', name: 'test production', description: 'Synthetic industry.', sourceIds: ['test-source'] }],
  },
  transport: {
    airports: [{ placeId: 'test-airport', status: 'operational', sourceIds: ['test-source'] }],
    rail: [{ placeId: 'test-rail-station', status: 'operational', lineName: 'Test Line', sourceIds: ['test-source'] }],
    ports: [],
  },
  climate: {
    profile: 'southern-wet-dry',
    rainyMonths: [4, 5, 6, 7, 9, 10],
    dryMonths: [12, 1, 2],
    description: 'Synthetic climate.',
    clearLabel: 'Clear',
    sourceIds: ['test-source'],
  },
  homePalette: { back: '#e2c99f', left: '#755044', floor: ['#6e8a55', '#d98336'] },
  geometry: { surface: { path: 'scripts/geo/sources/formula/test-formula-surface.geojson', bytes: 1, sha256: '0'.repeat(64) } },
  sourceGroups: [{
    id: 'test-source',
    title: 'Synthetic test source',
    url: 'https://www.openstreetmap.org/node/999',
    checkedOn: '2026-10-06',
    supports: ['coordinate', 'identity', 'population', 'climate', 'transport', 'geography'],
    cache: { path: 'scripts/geo/sources/formula/test-fixture.json', bytes: 1, sha256: '0'.repeat(64) },
  }],
})

test('invalid new-city specs fail the minimum real-place and local-government gates', () => {
  const errors = validateCitySpec(invalidSpec)
  assert.ok(errors.includes('at least one local unit is required'))
  assert.ok(errors.includes('a new city needs 20 to 30 real places'))
  assert.ok(errors.some(error => error === 'city needs a sourced market place'))
})

test('Wikidata EntityData P625 coordinates use longitude and latitude fields', () => {
  const reference = { provider: 'wikidata' as const, entity: 'Q42' as const }
  const entityData = {
    entities: {
      Q42: {
        claims: {
          P625: [{ mainsnak: { datavalue: { value: { latitude: 51.7577, longitude: -1.2553, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2' } } } }],
        },
      },
    },
  }
  assert.deepEqual(wikidataCoordinate(entityData, reference), { lon: -1.2553, lat: 51.7577 })
  assert.equal(wikidataCoordinate({ entities: { Q42: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: Infinity, longitude: -1.2553 } } } }] } } } }, reference), null)
  assert.equal(wikidataCoordinate({ entities: { Q42: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 91, longitude: -1.2553 } } } }] } } } }, reference), null)
})

test('a valid synthetic CitySpec builds the playable formula skeleton without registration', () => {
  const origin = { x: 0, z: 0 }
  const rules = buildFormulaRules(formulaSpec, origin)
  const scenes = buildFormulaScenes(formulaSpec)
  const content = buildFormulaContent({
    spec: formulaSpec,
    origin,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    localUnitAnchors: {
      'test-centre': { lon: 3.01, lat: 7.01 },
      'test-north': { lon: 3.02, lat: 7.02 },
    },
    scenes,
  })

  assert.equal(rules.id, 'test-formula')
  assert.equal(rules.units.length, 2)
  assert.equal(rules.hubs.filter(hub => hub.mode === 'road' || hub.mode === 'air' || hub.mode === 'rail').length, 3)
  assert.equal(rules.climate?.rainChanceByMonth.length, 12)
  assert.equal(content.venues.length, placeSeeds.length + 1)
  assert.equal(content.housing.length, 2)
  assert.equal(content.tablePlaces.length, 1)
  assert.equal(content.workplaces.length, rules.careerIds.length)
  assert.deepEqual(content.business?.markets['test-centre-market']?.known, ['food', 'crafts'])
  assert.deepEqual(content.business?.localProductIds, ['local-plate', 'basket'])
  assert.equal(content.business?.plate, 'test plate')
  assert.equal(scenes['test-garden']?.kind, 'park')
  assert.equal(scenes['test-university']?.kind, 'office')
  assert.equal(scenes['test-stadium']?.kind, 'viewing')
  assert.equal(content.venues[1]?.id, 'test-park', 'the real park is the first public arrival venue')
  assert.ok(content.venues[1]?.definition.spots.visit, 'the arrival park has a spot for shared relief activities')
  const evening = content.venues.find(venue => venue.id === 'test-garden')?.definition.spots.visit?.activities[0]
  assert.ok(evening?.tags?.includes('nightlife'), 'the garden supplies evening gameplay without a nightclub venue')
  assert.equal(content.venues.some(venue => venue.kind === 'club'), false)
  const meal = content.venues.find(venue => venue.id === 'test-eatery')?.definition.spots.counter?.activities[0]
  assert.equal(meal?.label, 'Eat test plate')
})

test('generated eager rules and content cannot statically reach the lazy map or topology data', () => {
  const modules: Readonly<Record<string, string>> = {
    './index.ts': formulaIndexText(),
    './rules.ts': formulaRulesText(),
    './content.ts': formulaContentText(),
    './scenes.ts': formulaScenesText(),
    './geography.ts': '// generated scalar metadata has no imports\n',
  }
  const staticImports = (text: string): readonly string[] => [...text.matchAll(/^import(?: type)? .* from ['"]([^'"]+)['"]$/gm)].flatMap(match => match[1] ? [match[1]] : [])
  const localModule = (specifier: string): string => specifier.startsWith('./') && !specifier.endsWith('.ts') ? `${specifier}.ts` : specifier
  const closure = (entry: string): ReadonlySet<string> => {
    const visited = new Set<string>()
    const pending = [entry]
    while (pending.length) {
      const file = pending.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      for (const specifier of staticImports(modules[file] ?? '')) {
        const local = localModule(specifier)
        if (modules[local] && !visited.has(local)) pending.push(local)
      }
    }
    return visited
  }

  for (const entry of ['./index.ts', './content.ts']) {
    const reached = closure(entry)
    assert.equal(reached.has('./map.ts'), false, `${entry} eager closure must not contain map.ts`)
    for (const file of reached) assert.doesNotMatch(modules[file] ?? '', /map3d\/geo\/data|createFormulaCityGeometry/)
  }
  assert.match(formulaIndexText(), /import\('\.\/map\.ts'\)/, 'map remains available only through the lazy module loader')
  assert.match(formulaContentText(), /from '\.\/geography\.ts'/)
  assert.match(formulaRulesText(), /from '\.\/geography\.ts'/)
})

test('selected state topology retains the neighbouring owner on a shared national arc', () => {
  const alpha: BoundaryFeatureCollection['features'][number] = {
    properties: { shapeName: 'Alpha' },
    polygons: [[[[0, 0], [1, 0], [1, 1], [0, 1]]]],
  }
  const beta: BoundaryFeatureCollection['features'][number] = {
    properties: { shapeName: 'Beta' },
    polygons: [[[[1, 0], [2, 0], [2, 1], [1, 1]]]],
  }
  const national: BoundaryFeatureCollection = { features: [alpha, beta] }
  const selected = buildSelectedStateTopology(national, 'Alpha', 'alpha-state')
  const shared = selected.arcs.filter(arc => arc.owners.has('alpha-state') && arc.owners.has('state:Beta'))
  assert.equal(shared.length, 1, 'the shared border is simplified once with both owners before subsetting')
  assert.ok(selected.refs.every(reference => reference.owner === 'alpha-state'), 'only the selected state remains a feature')

  const isolated = buildSelectedStateTopology({ features: [alpha] }, 'Alpha', 'alpha-state')
  assert.equal(isolated.arcs.some(arc => arc.owners.size > 1), false, 'an independently built state has no neighbouring owner proof')
})

test('legacy generation is deterministic and stale text is observable', () => {
  const first = legacyGeneratedFiles(SAGAMU_LEGACY_RECIPE)
  const second = legacyGeneratedFiles(SAGAMU_LEGACY_RECIPE)
  assert.deepEqual(first, second)
  const temporary = mkdtempSync(join(tmpdir(), 'allworld-city-generator-'))
  try {
    const path = join(temporary, 'rules.ts')
    assert.equal(generatedTextIsCurrent(path, first['rules.ts']), false)
    writeFileSync(path, 'stale\n')
    assert.equal(generatedTextIsCurrent(path, first['rules.ts']), false)
    writeFileSync(path, first['rules.ts'])
    assert.equal(generatedTextIsCurrent(path, first['rules.ts']), true)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('Sagamu generated runtime preserves the exact original baseline', async () => {
  const text = JSON.stringify(await SAGAMU_LEGACY_RECIPE.loadSnapshot())
  assert.equal(Buffer.byteLength(text), SAGAMU_LEGACY_RECIPE.baselineBytes)
  assert.equal(createHash('sha256').update(text).digest('hex'), SAGAMU_LEGACY_RECIPE.baselineSha256)
})

test('Sagamu offline generator check accepts current generated files', () => {
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/city/build-city.ts', 'sagamu', '--check'], { cwd: root, stdio: 'pipe' })
})
