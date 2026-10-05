import assert from 'node:assert/strict'
import test from 'node:test'
import { ABUJA_CONTENT } from './content.ts'
import { ABUJA_RULES } from './rules.ts'
import { ABUJA_LANDMARKS } from './landmarks.ts'

test('Abuja uses area councils, a fictional community office and Kubwa first arrival', () => {
  assert.equal(ABUJA_RULES.unit, 'area council')
  assert.equal(ABUJA_RULES.civicTitle, 'Community Chair')
  assert.match(ABUJA_CONTENT.civicExplanation, /no governor.*FCT Minister.*area council.*not a real public office/)
  assert.equal(ABUJA_RULES.defaultRentedHome, 'fct-kubwa-home')
  const district = ABUJA_RULES.districts.find(district => district.id === 'kubwa')
  assert.equal(district?.localUnitId, 'bwari')
  assert.equal(ABUJA_CONTENT.venues.find(venue => venue.kind === 'park')?.id, 'kubwa-garden')
  assert.match(ABUJA_CONTENT.starterGoals.find(goal => goal.id === 'settle-in')?.hint ?? '', /area council/)
  assert.ok(ABUJA_CONTENT.localModes?.every(mode => mode.id !== 'okada'))
  assert.deepEqual(ABUJA_CONTENT.localModeZones.map(zone => zone.ownedHomeUnitIds[0]), ['bwari', 'gwagwalada'])
  for (const id of ['presidential-villa', 'national-assembly', 'supreme-court', 'three-arms-zone', 'zuma-rock', 'aso-rock']) {
    assert.ok(ABUJA_LANDMARKS.some(marker => marker.id === id))
    assert.ok(ABUJA_CONTENT.venues.every(venue => venue.id !== id), `${id} is an exterior context marker`)
  }
  assert.match(ABUJA_LANDMARKS.find(marker => marker.id === 'zuma-rock')?.name ?? '', /Niger State/)
})

test('Abuja prose, regulars and wishes belong to its own catalogue', () => {
  const publicVenues = ABUJA_CONTENT.venues.filter(venue => venue.id !== 'home')
  assert.equal(ABUJA_CONTENT.regulars.length, publicVenues.length * 2)
  assert.equal(new Set(ABUJA_CONTENT.regulars.map(person => person.definition.name)).size, ABUJA_CONTENT.regulars.length)
  for (const venue of publicVenues) {
    const regulars = ABUJA_CONTENT.regulars.filter(person => person.venueId === venue.id)
    assert.equal(regulars.length, 2)
    assert.notEqual(regulars[0]?.definition.role, regulars[1]?.definition.role)
    assert.ok(regulars.every(person => person.definition.quotes.every(quote => quote.length > 15)))
  }
  const prose = [ABUJA_CONTENT.culture, publicVenues.map(venue => [venue.name, venue.whatYouCanDo]), ABUJA_CONTENT.regulars, Object.values(ABUJA_CONTENT.dreamWording ?? {}), Object.values(ABUJA_CONTENT.lotteryWording ?? {})]
  assert.doesNotMatch(JSON.stringify(prose), /\b(?:Lagos|Port Harcourt|Ogun|Mushin|CcHub|Lekki|Yaba)\b/)
  assert.ok(ABUJA_CONTENT.wishes.every(wish => !wish.id.startsWith('ph-') && !wish.id.startsWith('ogun-')))
  assert.ok(ABUJA_CONTENT.wishes.some(wish => wish.id === 'fct-visit-0'))
  for (const wording of Object.values(ABUJA_CONTENT.lotteryWording ?? {})) assert.match(wording.bullets.join(' '), /area council.*free starter house/)
})
