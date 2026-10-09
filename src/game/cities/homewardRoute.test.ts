import assert from 'node:assert/strict'
import test from 'node:test'
import type { CityLinkFrom } from '../../types/content.ts'
import { RIDE_CREDIT } from '../content/relief.ts'
import { INTERCITY_TIME, intercitySeconds } from '../content/travel.ts'
import { isOpenCityId, linksFrom, loadCityLinks, loadCityRules, playableCityIds } from './registry.ts'
import { MAX_HOMEWARD_LEGS, planHomewardRoute } from './homewardRoute.ts'

const link = (
  to: string,
  fare: number,
  seconds = 20,
  mode: CityLinkFrom['mode'] = 'road',
  status?: CityLinkFrom['status'],
): CityLinkFrom => ({ to, fare, seconds, mode, ...(status ? { status } : {}), km: 1, label: `${mode} to ${to}`, icon: '→' })

function plan(edges: Readonly<Record<string, readonly CityLinkFrom[]>>, closed: readonly string[] = []) {
  return planHomewardRoute('nairobi', 'ibadan', city => edges[city] ?? [], city => !closed.includes(city))
}

test('plans a real multi-hop homeward route with its actual modes, fares and durations', () => {
  const roadSeconds = intercitySeconds('road', 130)
  const quote = plan({
    nairobi: [link('lagos', 325_000, 20, 'air')],
    lagos: [link('ibadan', 3_500, roadSeconds, 'road')],
  })
  assert.ok(quote)
  assert.deepEqual(quote.legs, [
    { from: 'nairobi', to: 'lagos', mode: 'air', fare: 325_000, seconds: 20 },
    { from: 'lagos', to: 'ibadan', mode: 'road', fare: 3_500, seconds: roadSeconds },
  ])
  assert.deepEqual([quote.version, quote.from, quote.to, quote.totalFare, quote.totalSeconds], [1, 'nairobi', 'ibadan', 328_500, 20 + roadSeconds])
  assert.equal(quote.key, JSON.stringify([1, 'nairobi', 'ibadan', [
    JSON.stringify(['nairobi', 'lagos', 'air', 325_000, 20]),
    JSON.stringify(['lagos', 'ibadan', 'road', 3_500, roadSeconds]),
  ]]))
})

test('ignores a cheaper five-leg path and chooses the cheapest valid route of at most four legs', () => {
  const quote = plan({
    nairobi: [link('cheap-1', 1), link('valid-1', 200)],
    'cheap-1': [link('cheap-2', 1)],
    'cheap-2': [link('cheap-3', 1)],
    'cheap-3': [link('cheap-4', 1)],
    'cheap-4': [link('ibadan', 1)],
    'valid-1': [link('valid-2', 200)],
    'valid-2': [link('valid-3', 200)],
    'valid-3': [link('ibadan', 200)],
  })
  assert.ok(quote)
  assert.equal(quote.legs.length, 4)
  assert.equal(quote.totalFare, 800)
  assert.deepEqual(quote.legs.map(leg => leg.to), ['valid-1', 'valid-2', 'valid-3', 'ibadan'])
  assert.equal(plan({
    nairobi: [link('one', 1)], one: [link('two', 1)], two: [link('three', 1)], three: [link('four', 1)], four: [link('ibadan', 1)],
  }), null, 'a cheap path beyond the leg bound is not offered as a valid quote')
})

test('excludes cycles, coming routes, closed cities and malformed fare or duration values', () => {
  const quote = plan({
    nairobi: [
      link('loop', 1),
      link('closed', 1),
      link('coming', 1, 60, 'road', 'coming'),
      link('bad-fare', Number.MAX_SAFE_INTEGER + 1),
      link('bad-time', 10, 0),
      link('ibadan', 50),
    ],
    loop: [link('nairobi', 1)],
    closed: [link('ibadan', 1)],
    'bad-fare': [link('ibadan', 1)],
    'bad-time': [link('ibadan', 1)],
  }, ['closed'])
  assert.ok(quote)
  assert.deepEqual(quote.legs.map(leg => [leg.from, leg.to]), [['nairobi', 'ibadan']])
  assert.equal(plan({ nairobi: [link('ibadan', 1)] }, ['ibadan']), null)
})

test('accepts the exact fare ceiling and four-leg timetable maximum, rejects oversize and unsafe values', () => {
  const exact = plan({ nairobi: [link('ibadan', RIDE_CREDIT.max, INTERCITY_TIME.air.max, 'air')] })
  assert.ok(exact)
  assert.deepEqual([exact.totalFare, exact.totalSeconds], [RIDE_CREDIT.max, INTERCITY_TIME.air.max])
  assert.equal(plan({ nairobi: [link('ibadan', RIDE_CREDIT.max + 1)] }), null)
  assert.equal(plan({ nairobi: [link('mid', RIDE_CREDIT.max / 2)], mid: [link('ibadan', RIDE_CREDIT.max / 2 + 1)] }), null)
  assert.equal(plan({ nairobi: [link('ibadan', 1, Number.MAX_SAFE_INTEGER)] }), null)
  assert.equal(plan({ nairobi: [link('ibadan', 1, INTERCITY_TIME.road.max + 1)] }), null)
  const longest = plan({
    nairobi: [link('one', 100, INTERCITY_TIME.road.max)],
    one: [link('two', 100, INTERCITY_TIME.road.max)],
    two: [link('three', 100, INTERCITY_TIME.road.max)],
    three: [link('ibadan', 100, INTERCITY_TIME.road.max)],
  })
  assert.ok(longest)
  assert.deepEqual([longest.legs.length, longest.totalSeconds], [MAX_HOMEWARD_LEGS, MAX_HOMEWARD_LEGS * INTERCITY_TIME.road.max])
  assert.equal(plan({ nairobi: [link('ibadan', Number.MAX_SAFE_INTEGER + 1)] }), null)
})

test('is deterministic across provider order and changes its key when the quoted intent changes', () => {
  const first = plan({
    nairobi: [link('via-b', 100, 20, 'air'), link('via-a', 100, 20, 'road')],
    'via-a': [link('ibadan', 100, 20, 'road')],
    'via-b': [link('ibadan', 100, 20, 'air')],
  })
  const reordered = plan({
    nairobi: [link('via-a', 100, 20, 'road'), link('via-b', 100, 20, 'air')],
    'via-a': [link('ibadan', 100, 20, 'road')],
    'via-b': [link('ibadan', 100, 20, 'air')],
  })
  assert.ok(first && reordered)
  assert.deepEqual(reordered, first)

  const baseline = plan({ nairobi: [link('ibadan', 100, 20)] })
  const changedFare = plan({ nairobi: [link('ibadan', 101, 20)] })
  const changedTime = plan({ nairobi: [link('ibadan', 100, 21)] })
  const changedPath = plan({ nairobi: [link('via', 50, 10)], via: [link('ibadan', 50, 10)] })
  assert.ok(baseline && changedFare && changedTime && changedPath)
  for (const changed of [changedFare, changedTime, changedPath]) assert.notEqual(changed.key, baseline.key)
})

test('does not quote a same-city journey or a route whose origin is closed', () => {
  assert.equal(planHomewardRoute('nairobi', 'nairobi', () => [], () => true), null)
  assert.equal(planHomewardRoute('nairobi', 'ibadan', () => [link('ibadan', 1)], city => city !== 'nairobi'), null)
})

test('queries each city once even in a dense graph with no homeward route', () => {
  const cities = ['nairobi', ...Array.from({ length: 42 }, (_, index) => `city-${index}`), 'ibadan']
  const queryCount = new Map<string, number>()
  const links = (from: string): readonly CityLinkFrom[] => {
    queryCount.set(from, (queryCount.get(from) ?? 0) + 1)
    return cities.filter(to => to !== from && to !== 'ibadan').map(to => link(to, 1, 25))
  }
  const quote = planHomewardRoute('nairobi', 'ibadan', links, () => true)
  assert.equal(quote, null)
  assert.ok(queryCount.size <= cities.length)
  assert.ok([...queryCount.values()].every(count => count === 1), 'outgoing route lists are cached for this planning call')
})

test('all five starter capitals have quoted real routes to airport and non-airport Nigerian homes', async () => {
  await Promise.all([loadCityLinks(), ...playableCityIds().map(loadCityRules)])
  for (const from of ['yaounde', 'lome', 'accra', 'nairobi', 'algiers']) for (const home of ['ibadan', 'maiduguri']) {
    const quote = planHomewardRoute(from, home, linksFrom, isOpenCityId)
    assert.ok(quote, `${from} has an available bounded route to ${home}`)
    assert.equal(quote.from, from)
    assert.equal(quote.to, home)
    assert.ok(quote.legs.length <= MAX_HOMEWARD_LEGS && quote.totalFare <= RIDE_CREDIT.max)
    assert.equal(quote.totalFare, quote.legs.reduce((total, leg) => total + leg.fare, 0))
    assert.equal(quote.totalSeconds, quote.legs.reduce((total, leg) => total + leg.seconds, 0))
    for (const leg of quote.legs) assert.ok(linksFrom(leg.from).some(link => link.to === leg.to && link.mode === leg.mode && link.fare === leg.fare && link.seconds === leg.seconds && link.status !== 'coming'), `${leg.from} to ${leg.to} is a current real ticket`)
  }
})
