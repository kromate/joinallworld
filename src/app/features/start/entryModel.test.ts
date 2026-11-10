import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENTRY_VARIANTS, VARIANT_PATHS, variantOf, withFigures, withPlace } from '../../../entry-variants.ts'
import { AGENT_CHOICES, SETUP_NEEDS, SETUP_STEPS, entryShown, isPathAddress, liveLine, worldFigures } from './entryModel.ts'
import { ENTRY_WORDS, entryVariantId, isEntryAddress } from './pathAddress.ts'

const calm = { problem: false, pathAddress: false, editing: false, sending: false }

test('a first visit sees the entry page; a refusal, a short address, an edited character or a Play on its way go to the creator', () => {
  assert.equal(entryShown(calm), true)
  for (const key of Object.keys(calm) as (keyof typeof calm)[]) assert.equal(entryShown({ ...calm, [key]: true }), false, key)
})

test('invite and share addresses keep the entry page; short addresses, /unilag and /signup do not', () => {
  for (const path of ['/', '', '/index.html', '/v/abc123', '/s/ABCDEF']) assert.equal(isPathAddress(path), false, path)
  for (const path of ['/abuja', '/games/chess', '/unilag', '/signup', '/lagos/games']) assert.equal(isPathAddress(path), true, path)
})

test('the figures come from the catalogue: only open cities, each country once', () => {
  const figures = worldFigures([{ open: true }, { open: true, countryISO: 'GH' }, { open: true, countryISO: 'GH' }, { open: false, countryISO: 'KE' }])
  assert.deepEqual(figures, { cities: 3, countries: 2 })
})

test('the live line never says 0, and drops the count until there is one', () => {
  const f = { cities: 60, countries: 21 }
  assert.equal(liveLine(128, f), '128 in Allworld now · 60 cities, 21 countries and territories')
  assert.equal(liveLine(1234, f), '1,234 in Allworld now · 60 cities, 21 countries and territories')
  assert.equal(liveLine(0, f), '60 cities, 21 countries and territories')
  assert.equal(liveLine(null, f), '60 cities, 21 countries and territories')
  assert.equal(liveLine(1, { cities: 1, countries: 1 }), '1 city, 1 country or territory')
  assert.equal(liveLine(4, f), '60 cities, 21 countries and territories')
  assert.equal(liveLine(5, { cities: 1, countries: 1 }), '5 in Allworld now · 1 city, 1 country or territory')
})

test('the agent choices and the checklist use the approved words', () => {
  assert.deepEqual(AGENT_CHOICES.map((choice) => choice.title), ['Let an agent play my character', 'Give an agent its own character'])
  assert.deepEqual(SETUP_STEPS, ['Set up now', 'Sign up to save it', 'Goes live once checked'])
  assert.ok(SETUP_NEEDS.some((line) => /18 or older/.test(line)) && SETUP_NEEDS.some((line) => /Three photos/.test(line)) && SETUP_NEEDS.some((line) => /approval/.test(line)))
})

test('the variant table: every address resolves to its row, aliases included, and the first download knows the same words', () => {
  assert.equal(variantOf('/')?.id, 'home')
  assert.equal(variantOf('/shops/')?.id, 'shops')
  assert.equal(variantOf('/sell')?.id, 'shops')
  assert.equal(variantOf('/SERVICES?utm_source=x')?.id, 'services')
  assert.equal(variantOf('/world')?.id, 'cities')
  assert.equal(variantOf('/ai')?.id, 'agents')
  for (const page of ['/agents/league', '/agents/robo-ada', '/agents/claim/awc_x']) { assert.equal(variantOf(page), null, `${page} is a public page, not the entry variant`); assert.equal(entryVariantId(page), null) }
  assert.equal(variantOf('/games/chess'), null)
  assert.equal(variantOf('/abuja'), null)
  assert.deepEqual([...ENTRY_WORDS].sort(), VARIANT_PATHS.map((path) => path.slice(1)).sort())
  for (const path of VARIANT_PATHS) { assert.equal(isEntryAddress(path), true, path); assert.equal(isPathAddress(path), false, path) }
  assert.equal(isEntryAddress('/games/chess'), false)
})

test('every variant has a head that fits, tiles, and a primary button; setup variants name a kind of shop', () => {
  const ids = new Set<string>()
  for (const variant of ENTRY_VARIANTS) {
    assert.ok(!ids.has(variant.id)); ids.add(variant.id)
    assert.ok(variant.title.length > 8 && withFigures(variant.description, { cities: 60, countries: 21 }).length <= 155, variant.id)
    assert.equal(variant.tiles.length, 4, variant.id)
    assert.ok(variant.primary.label)
    assert.equal(variant.primary.kind === 'setup', variant.category !== undefined, variant.id)
    assert.ok(variant.og.startsWith('/og/') && (variant.image === null || variant.image.startsWith('/icons/')))
    assert.ok(!/[<>"]/.test(variant.title + variant.description), 'nothing a player typed and nothing to escape')
  }
  assert.equal(withFigures('{cities} real cities in {countries} countries', { cities: 60, countries: 21 }), '60 real cities in 21 countries')
  assert.deepEqual(ENTRY_VARIANTS.find((variant) => variant.id === 'home')?.tiles.map((tile) => tile.label), ['Live in a real city', 'Work and earn', 'Open a shop for your real business', 'Friends, voice and games'])
  assert.equal(ENTRY_VARIANTS.find((variant) => variant.id === 'home')?.pitch, '{cities} real-world places to explore. Free, in your browser, no download.')
})

test('a street, a visit and politics are addresses of the entry page: their own rows, their own campaign content, never the creator', () => {
  for (const [path, id] of [['/street/lagos/yaba', 'street'], ['/street/lagos', 'street'], ['/Street/Lagos/Yaba/', 'street'], ['/visit/lagos', 'visit'], ['/visit', 'visit'], ['/street', 'street'], ['/politics', 'politics']] as const) {
    assert.equal(variantOf(path)?.id, id, path)
    assert.equal(entryVariantId(path), id, path)
    assert.equal(isEntryAddress(path), true, path)
    assert.equal(isPathAddress(path), false, path)
  }
  for (const path of ['/street/a/b/c', '/visit/a/b', '/streets', '/street/ya ba']) { assert.equal(entryVariantId(path), null, path); assert.equal(variantOf(path), null, path) }
  assert.equal(isPathAddress('/records'), true, 'the Hall of Records is still a short address')
})

test('the words of a street and a visit: the place and the city from the rules, and every head fits', () => {
  const street = ENTRY_VARIANTS.find((variant) => variant.id === 'street'), visit = ENTRY_VARIANTS.find((variant) => variant.id === 'visit')
  assert.ok(street?.place && visit?.place)
  assert.equal(withPlace(street.place.title, { city: 'Lagos', name: 'Yaba' }), 'Walk Yaba, Lagos on Allworld')
  assert.equal(withPlace(street.place.headline, { city: 'Lagos', name: null }), 'Walk Lagos')
  assert.equal(withPlace(visit.place.title, { city: 'Lagos', name: null }), 'Visit Lagos on Allworld')
  assert.equal(visit.headline, 'Visit home from London')
  // The longest names a description could carry still fit a search result.
  const long = { city: 'Port Harcourt', name: 'Ajeromi-Ifelodun' }
  for (const variant of [street, visit]) assert.ok(withPlace(variant.place!.description, long).length <= 155, variant.id)
  assert.ok(ENTRY_VARIANTS.filter((variant) => variant.secondary.some((action) => action.kind === 'find' && action.label === 'Find my street')).map((variant) => variant.id).join() === 'home,street,visit')
  const politics = ENTRY_VARIANTS.find((variant) => variant.id === 'politics')
  assert.deepEqual([politics?.headline, politics?.og], ['Become governor of Lagos this week', '/og/card-election.png'])
  assert.match(politics?.pitch ?? '', /One-week terms\. Real elections/)
})

test('the campaign content is the variant name, for the addresses of the entry page only', () => {
  assert.deepEqual(['/shops', '/sell', '/services/', '/games', '/world', '/cities', '/ai', '/agents'].map(entryVariantId), ['shops', 'shops', 'services', 'games', 'cities', 'cities', 'agents', 'agents'])
  for (const path of ['/', '/games/chess', '/abuja', '/v/abc', '/constructor', '/__proto__']) assert.equal(entryVariantId(path), null, path)
  for (const variant of ENTRY_VARIANTS) if (variant.id !== 'home') assert.equal(entryVariantId(variant.paths[0] ?? ''), variant.id)
})
