import assert from 'node:assert/strict'
import test from 'node:test'
import { lagosDayStart, lagosTime } from '../clock.ts'
import { POWER_CUT_CHANCE, conditionsAt, gridAt, matchOn, noticeLine, outageSeconds, powerCutAt, powerCutsOn, slowFactorAt, venueHasGenerator } from './conditions.ts'
import { goSlowFactor, goSlowLine, rushAt, slowedSeconds } from './rush.ts'

/** A server time for a Lagos wall-clock moment (months are 1-based). */
const lagos = (year: number, month: number, day: number, hour = 0, minute = 0): number => Date.UTC(year, month - 1, day, hour - 1, minute)

const DISTRICTS = ['Ikeja', 'Yaba', 'Lagos Island', 'Surulere', 'Lekki']
const FIRST_DAY = lagosTime(lagos(2026, 1, 1)).day

test('the same city and the same minute give the same conditions, however they are asked', () => {
  for (let minute = 0; minute < 3 * 1440; minute += 37) {
    const now = lagos(2026, 10, 5, 0, minute)
    assert.deepEqual(conditionsAt('lagos', now, DISTRICTS), conditionsAt('lagos', now, [...DISTRICTS].reverse()))
    assert.deepEqual(conditionsAt('lagos', now, DISTRICTS), JSON.parse(JSON.stringify(conditionsAt('lagos', now, DISTRICTS))))
  }
})

test('power cuts differ by district and by day, and about half the district-days have one', () => {
  let withCut = 0
  let total = 0
  const shapes = new Set<string>()
  for (let day = FIRST_DAY; day < FIRST_DAY + 200; day++) {
    for (const district of DISTRICTS) {
      const cuts = powerCutsOn('lagos', district, day)
      total++
      if (cuts.length) withCut++
      shapes.add(cuts.map((c) => c.from - lagosDayStart(day)).join(','))
    }
  }
  const share = withCut / total
  assert.ok(Math.abs(share - POWER_CUT_CHANCE) < 0.08, `share ${share}`)
  assert.ok(shapes.size > 30, 'cuts do not repeat day after day')
})

test('a cut starts only in the evening or the morning window, lasts 1½ to 4 hours, and cuts never overlap', () => {
  for (let day = FIRST_DAY; day < FIRST_DAY + 120; day++) {
    for (const district of DISTRICTS) {
      const cuts = powerCutsOn('lagos', district, day)
      assert.ok(cuts.length <= 2)
      cuts.forEach((cut, i) => {
        const begin = (cut.from - lagosDayStart(day)) / 60000
        assert.ok((begin >= 960 && begin <= 1365) || (begin >= 300 && begin <= 840), `begins at minute ${begin}`)
        assert.ok(cut.to - cut.from >= 90 * 60000, 'at least 90 minutes')
        assert.ok(cut.to - cut.from <= 480 * 60000, 'two cuts that touch merge into at most 8 hours')
        if (i > 0) assert.ok(cut.from > cuts[i - 1]!.to, 'merged where they touch')
      })
    }
  }
})

test('powerCutAt agrees with the day lists, including a late cut that runs past midnight', () => {
  let crossed = 0
  for (let day = FIRST_DAY; day < FIRST_DAY + 300; day++) {
    for (const cut of powerCutsOn('lagos', 'Ikeja', day)) {
      assert.deepEqual(powerCutAt('lagos', 'Ikeja', cut.from), cut)
      assert.deepEqual(powerCutAt('lagos', 'Ikeja', cut.to - 1), cut)
      if (cut.to > lagosDayStart(day + 1)) {
        crossed++
        assert.deepEqual(powerCutAt('lagos', 'Ikeja', lagosDayStart(day + 1) + 1000), cut)
      }
    }
  }
  assert.ok(crossed > 0, 'at least one cut runs past midnight in 300 days')
})

test('outageSeconds is the sum of the minutes the grid was off, and is zero for an empty span', () => {
  const from = lagos(2026, 10, 1, 3)
  const to = lagos(2026, 10, 6, 21)
  let off = 0
  for (let t = from; t < to; t += 60000) if (powerCutAt('lagos', 'Yaba', t)) off += 60
  assert.equal(outageSeconds('lagos', 'Yaba', from, to), off)
  assert.ok(off > 0)
  assert.equal(outageSeconds('lagos', 'Yaba', to, from), 0)
  assert.equal(outageSeconds('lagos', 'Yaba', to, to), 0)
  // Splitting a span anywhere gives the same total, so settling at any polling rhythm adds up.
  const mid = lagos(2026, 10, 3, 17, 41)
  assert.equal(outageSeconds('lagos', 'Yaba', from, mid) + outageSeconds('lagos', 'Yaba', mid, to), off)
})

test('a long absence is bounded to two weeks', () => {
  const to = lagos(2026, 10, 6, 12)
  const long = outageSeconds('lagos', 'Yaba', to - 400 * 86400000, to)
  const fortnight = outageSeconds('lagos', 'Yaba', to - 14 * 86400000, to)
  assert.equal(long, fortnight)
  assert.ok(long > 0 && long < 14 * 86400)
})

test('the go-slow windows by weekday', () => {
  const monday = lagos(2026, 10, 5)
  assert.equal(rushAt(lagos(2026, 10, 5, 6, 59)), null)
  assert.deepEqual(rushAt(lagos(2026, 10, 5, 7)), { from: monday + 7 * 3600000, to: monday + 10 * 3600000 })
  assert.equal(rushAt(lagos(2026, 10, 5, 10)), null)
  assert.ok(rushAt(lagos(2026, 10, 5, 17)))
  assert.equal(rushAt(lagos(2026, 10, 5, 20)), null)
  assert.ok(rushAt(lagos(2026, 10, 9, 20, 30)), 'Friday runs to 21:00')
  assert.equal(rushAt(lagos(2026, 10, 9, 21)), null)
  assert.ok(rushAt(lagos(2026, 10, 10, 18)), 'Saturday evening')
  assert.equal(rushAt(lagos(2026, 10, 10, 8)), null, 'no Saturday morning rush')
  for (let hour = 0; hour < 24; hour++) assert.equal(rushAt(lagos(2026, 10, 11, hour)), null, `Sunday ${hour}:00`)
})

test('the go-slow lengthens road trips, more in Lagos, and leaves walking and boats alone', () => {
  const rush = lagos(2026, 10, 5, 8)
  const calm = lagos(2026, 10, 5, 13)
  assert.equal(goSlowFactor('lagos'), 1.5)
  assert.equal(goSlowFactor('abuja'), 1.25)
  assert.equal(slowedSeconds(10, 'bus', 'lagos', rush), 15)
  assert.equal(slowedSeconds(10, 'bus', 'abuja', rush), 12.5)
  assert.equal(slowedSeconds(10, 'bus', 'lagos', calm), 10)
  assert.equal(slowedSeconds(10, 'trek', 'lagos', rush), 10)
  assert.equal(slowedSeconds(10, 'boat', 'lagos', rush), 10)
  assert.equal(slowFactorAt('lagos', rush), 1.5)
  assert.equal(slowFactorAt('lagos', calm), 1)
  assert.match(goSlowLine('lagos', rush), /Go-slow on the road until 10AM/)
  assert.equal(goSlowLine('lagos', calm), '')
})

test('the venue card says when the light comes back, and mentions a generator', () => {
  let found = 0
  for (let day = FIRST_DAY; day < FIRST_DAY + 40 && found < 3; day++) {
    const cut = powerCutsOn('lagos', 'Yaba', day)[0]
    if (!cut) continue
    found++
    const inside = cut.from + 30 * 60000
    assert.match(noticeLine('lagos', { id: 'market', district: 'Yaba' }, inside), /^Light is off around Yaba until \d{1,2}(:\d\d)?(AM|PM)\.$/)
    assert.match(noticeLine('lagos', { id: 'cchub', district: 'Yaba' }, inside), /This place is on generator\.$/)
    assert.match(noticeLine('lagos', { id: 'market', district: 'Yaba', generator: true }, inside), /on generator/)
    assert.equal(venueHasGenerator({ id: 'cchub', generator: false }), false)
    assert.deepEqual(gridAt('lagos', 'Yaba', inside), { on: false, until: cut.to })
    assert.deepEqual(gridAt('lagos', 'Yaba', cut.to), powerCutAt('lagos', 'Yaba', cut.to) ? { on: false, until: powerCutAt('lagos', 'Yaba', cut.to)!.to } : { on: true, until: null })
  }
  assert.equal(found, 3)
})

test('match nights fill the viewing centre, only during the match, with the same answer every time', () => {
  let matches = 0
  for (let day = FIRST_DAY; day < FIRST_DAY + 120; day++) {
    const match = matchOn('lagos', day)
    assert.deepEqual(match, matchOn('lagos', day))
    if (!match) continue
    matches++
    const during = conditionsAt('lagos', match.from + 600000).find((c) => c.kind === 'match-night')
    assert.deepEqual(during?.venues, ['viewing-centre'])
    assert.match(noticeLine('lagos', { id: 'viewing-centre', district: 'Yaba' }, match.from + 600000), /^(Light is off|Match on here until)/)
    assert.equal(conditionsAt('lagos', match.to).some((c) => c.kind === 'match-night'), false)
    assert.equal(conditionsAt('lagos', match.from - 60000).some((c) => c.kind === 'match-night'), false)
  }
  assert.ok(matches > 20 && matches < 100, `${matches} matches in 120 days`)
})

test('conditionsAt reports one cut per asked district, a go-slow in the rush, and nothing for an unknown city\'s rain', () => {
  let cutNow: number | null = null
  for (let day = FIRST_DAY; day < FIRST_DAY + 60 && cutNow === null; day++) if (powerCutsOn('lagos', 'Ikeja', day)[0]) cutNow = powerCutsOn('lagos', 'Ikeja', day)[0]!.from + 1000
  assert.ok(cutNow !== null)
  const list = conditionsAt('lagos', cutNow!, ['Ikeja', 'Ikeja'])
  assert.equal(list.filter((c) => c.kind === 'power-cut' && c.districts?.[0] === 'Ikeja').length, 1)
  assert.equal(conditionsAt('lagos', cutNow!).some((c) => c.kind === 'power-cut'), false, 'no district asked, none reported')
  assert.ok(conditionsAt('lagos', lagos(2026, 10, 5, 8)).some((c) => c.kind === 'go-slow'))
  assert.doesNotThrow(() => conditionsAt('atlantis', lagos(2026, 10, 5, 8), ['Nowhere']))
  assert.equal(lagosTime(cutNow!).day >= FIRST_DAY, true)
})
