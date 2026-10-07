import assert from 'node:assert/strict'
import test from 'node:test'
import { lagosDayStart, lagosTime } from './clock.ts'
import { TIME_BANDS, WET_RAIN_CHANCE, bandSpan, citySeason, daySeed, timeBand } from './world-time.ts'
import type { CityClimate } from '../types/content.ts'

/** A server time for a Lagos wall-clock moment on a given day (months are 1-based). */
const lagos = (year: number, month: number, day: number, hour = 0, minute = 0): number => Date.UTC(year, month - 1, day, hour - 1, minute)

test('timeBand follows Lagos wall-clock time, not UTC, on every boundary', () => {
  const cases: [number, number, string][] = [
    [0, 0, 'night'], [4, 59, 'night'], [5, 0, 'dawn'], [6, 59, 'dawn'], [7, 0, 'morning'], [11, 59, 'morning'],
    [12, 0, 'afternoon'], [16, 59, 'afternoon'], [17, 0, 'evening'], [20, 59, 'evening'], [21, 0, 'night'], [23, 59, 'night'],
  ]
  for (const [hour, minute, band] of cases) assert.equal(timeBand(lagos(2026, 10, 6, hour, minute)), band, `${hour}:${minute}`)
  // 23:30 UTC is 00:30 the next day in Lagos: night. 04:30 UTC is 05:30 in Lagos: dawn.
  assert.equal(timeBand(Date.UTC(2026, 9, 6, 23, 30)), 'night')
  assert.equal(timeBand(Date.UTC(2026, 9, 6, 4, 30)), 'dawn')
})

test('every minute of a day has exactly one band, in order, and all five appear', () => {
  const seen: string[] = []
  for (let minute = 0; minute < 1440; minute++) {
    const band = timeBand(lagos(2026, 3, 1, 0, minute))
    if (seen[seen.length - 1] !== band) seen.push(band)
  }
  assert.deepEqual(seen, ['night', 'dawn', 'morning', 'afternoon', 'evening', 'night'])
  assert.deepEqual([...TIME_BANDS].sort(), [...new Set(seen)].sort())
})

test('timeBand is total: bad input falls back to the epoch rather than throwing', () => {
  for (const bad of [NaN, Infinity, -Infinity]) assert.ok(TIME_BANDS.includes(timeBand(bad)))
  assert.equal(timeBand(NaN), timeBand(0))
})

test('bandSpan covers the band the moment is in, joins the next band and carries the night across midnight', () => {
  const morning = lagos(2026, 10, 6, 9, 15)
  assert.deepEqual(bandSpan(morning), { band: 'morning', from: lagos(2026, 10, 6, 7), to: lagos(2026, 10, 6, 12) })
  const late = lagos(2026, 10, 6, 23, 0)
  assert.deepEqual(bandSpan(late), { band: 'night', from: lagos(2026, 10, 6, 21), to: lagos(2026, 10, 7, 5) })
  const small = lagos(2026, 10, 7, 2, 0)
  assert.deepEqual(bandSpan(small), { band: 'night', from: lagos(2026, 10, 6, 21), to: lagos(2026, 10, 7, 5) }, 'the same night before and after midnight')
  for (let minute = 0; minute < 1440; minute += 7) {
    const now = lagos(2026, 10, 6, 0, minute), span = bandSpan(now)
    assert.ok(span.from <= now && now < span.to)
    assert.equal(timeBand(span.from), span.band)
    assert.equal(timeBand(span.to - 1), span.band)
    assert.notEqual(timeBand(span.to), span.band)
  }
})

test('daySeed is a stable unsigned 32-bit integer that varies by city and by day', () => {
  const seed = daySeed('kano', 20_000)
  assert.equal(seed, daySeed('kano', 20_000))
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32)
  assert.notEqual(seed, daySeed('kano', 20_001))
  assert.notEqual(seed, daySeed('lagos', 20_000))
  const seeds = new Set(Array.from({ length: 200 }, (_, day) => daySeed('lagos', 20_000 + day)))
  assert.equal(seeds.size, 200, 'no collisions across 200 days')
  assert.equal(daySeed('lagos', Number.NaN), daySeed('lagos', 0))
})

test('daySeed is pinned so that every host, including a future one, agrees', () => {
  // If this changes, every deterministic day (conditions, moments, routines) changes with it: do that on purpose, never by accident.
  assert.deepEqual([daySeed('lagos', 0), daySeed('kano', 20_000), daySeed('calabar', 20_732)], [990256957, 74745479, 1357482623])
  assert.equal(lagosTime(Date.UTC(2026, 9, 6)).day, 20_732)
})

const climate: CityClimate = {
  beta: true,
  rainChanceByMonth: [0.01, 0.01, 0.02, 0.06, 0.2, 0.4, 0.55, 0.65, 0.35, 0.08, 0.01, 0.01],
  clearLabel: 'Hot and dry',
  harmattan: { months: [11, 12, 1, 2], label: 'Harmattan haze' },
}

test('citySeason reads the wet months from the rain chance at WET_RAIN_CHANCE and the harmattan from its months', () => {
  assert.equal(WET_RAIN_CHANCE, 0.25)
  const january = citySeason(climate, lagos(2026, 1, 15, 12))
  assert.deepEqual(january, { wet: false, harmattan: true, label: 'Harmattan haze' })
  assert.deepEqual(citySeason(climate, lagos(2026, 5, 15, 12)), { wet: false, harmattan: false, label: 'Hot and dry' }, 'May at 0.2 is below the threshold')
  assert.deepEqual(citySeason(climate, lagos(2026, 6, 15, 12)), { wet: true, harmattan: false, label: 'Hot and dry' })
  assert.deepEqual(citySeason(climate, lagos(2026, 9, 15, 12)), { wet: true, harmattan: false, label: 'Hot and dry' })
  assert.equal(citySeason(climate, lagos(2026, 10, 15, 12)).wet, false)
  assert.deepEqual(citySeason(climate, lagos(2026, 12, 25, 12)), { wet: false, harmattan: true, label: 'Harmattan haze' })
  const months = Array.from({ length: 12 }, (_, month) => citySeason(climate, lagos(2026, month + 1, 15, 12)).wet)
  assert.deepEqual(months, climate.rainChanceByMonth.map((chance) => chance >= WET_RAIN_CHANCE))
})

test('citySeason changes month at Lagos midnight, as weatherAt does', () => {
  const lastMinute = Date.UTC(2026, 4, 31, 22, 59), firstMinute = Date.UTC(2026, 4, 31, 23, 0)
  assert.equal(citySeason(climate, lastMinute).wet, false, '23:59 on 31 May in Lagos')
  assert.equal(citySeason(climate, firstMinute).wet, true, 'midnight, 1 June in Lagos')
})

test('citySeason agrees with weatherAt’s dry-day label and a city with no climate has no season', () => {
  assert.deepEqual(citySeason(undefined, Date.UTC(2026, 0, 15)), { wet: false, harmattan: false, label: '' })
  assert.deepEqual(citySeason(null, Date.UTC(2026, 0, 15)), { wet: false, harmattan: false, label: '' })
  const noHarmattan = { ...climate, harmattan: undefined }
  assert.deepEqual(citySeason(noHarmattan, lagos(2026, 1, 15)), { wet: false, harmattan: false, label: 'Hot and dry' })
  assert.equal(lagosDayStart(lagosTime(lagos(2026, 1, 15)).day) <= lagos(2026, 1, 15), true)
})

test('citySeason reads the real Kano climate', async () => {
  const { CITY_RULES, loadCityRules } = await import('./cities/registry.ts')
  await loadCityRules('kano')
  const kano = CITY_RULES['kano']?.climate
  assert.ok(kano, 'Kano carries a climate')
  const harmattan = citySeason(kano, lagos(2026, 1, 15))
  const august = citySeason(kano, lagos(2026, 8, 15))
  assert.equal(harmattan.harmattan, true)
  assert.equal(harmattan.wet, false)
  assert.equal(august.wet, true)
  assert.equal(august.harmattan, false)
})
