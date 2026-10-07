import { cachedCityContent, loadCityContent as preloadCityContent } from '../game/cities/registry.ts'
await preloadCityContent('lagos')
// What the venue card is told about the city's conditions: the moment pool is fed them, and a notice line says what matters here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { lagosTime } from '../game/clock.ts'
import { matchOn, powerCutsOn } from '../game/conditions/conditions.ts'
import { momentConditions, momentLine, noticeAt } from './live.ts'

const venues = cachedCityContent('lagos')!.venues
const firstDay = lagosTime(Date.UTC(2026, 0, 1)).day
const find = <T>(pick: (day: number) => T | null): T => { for (let day = firstDay; day < firstDay + 400; day++) { const found = pick(day); if (found) return found } throw new Error('none found') }

test('a power cut in a venue\'s district is a condition at that venue, shown as a line, and lifted with a restored window after', () => {
  const venue = venues.find((item) => item.definition.district === 'Yaba' && item.id !== 'cchub') ?? venues[0]!
  const district = venue.definition.district
  const cut = find((day) => powerCutsOn('lagos', district, day)[0] ?? null)
  const during = cut.from + 60_000
  assert.ok(momentConditions('lagos', venue.id, during).includes('power-cut'))
  assert.match(noticeAt('lagos', venue.id, during), /^Light is off around .+ until /)
  const after = cut.to + 60_000
  assert.ok(!momentConditions('lagos', venue.id, after).includes('power-cut'))
  assert.ok(momentConditions('lagos', venue.id, after).includes('power-restored'))
  assert.ok(!momentConditions('lagos', venue.id, cut.to + 11 * 60_000).includes('power-restored'), 'the cheering is over after ten minutes')
  assert.equal(noticeAt('lagos', venue.id, cut.to + 11 * 60_000).startsWith('Light is off'), false)
})

test('home and unknown places have no district, so no cut and no notice; the match belongs to the viewing centre', () => {
  assert.deepEqual(momentConditions('lagos', 'home', Date.UTC(2026, 9, 7, 12)).filter((kind) => kind === 'power-cut' || kind === 'power-restored'), [])
  assert.equal(noticeAt('lagos', 'home', Date.UTC(2026, 9, 7, 12)), '')
  assert.equal(noticeAt('lagos', 'nowhere', Date.UTC(2026, 9, 7, 12)), '')
  const match = find((day) => matchOn('lagos', day))
  const during = match.from + 60_000
  assert.ok(momentConditions('lagos', 'viewing-centre', during).includes('match-night'))
  assert.ok(!momentConditions('lagos', 'rooftop', during).includes('match-night'))
})

test('the moment line takes the conditions: during a cut, a power-cut line can be drawn at the venue', () => {
  const venue = venues.find((item) => item.definition.district === 'Yaba') ?? venues[0]!
  const cut = find((day) => powerCutsOn('lagos', venue.definition.district, day)[0] ?? null)
  const lines = new Set<string>()
  for (let at = cut.from + 60_000; at < cut.to; at += 60_000) lines.add(momentLine('lagos', venue.id, at))
  assert.ok([...lines].some((text) => /light|NEPA|torch|generator/i.test(text)), [...lines].join(' | '))
})
