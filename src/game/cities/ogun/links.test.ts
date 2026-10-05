import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife } from '../../../life.ts'
import { relocateBlock } from '../../systems/estate.ts'
import { allCityLinks, cityModule, cityRules, linksFrom, loadCityContent } from '../registry.ts'
import { OGUN_LINKS } from './links.ts'
import type { CityLink } from '../../../types/content.ts'

const OPEN = ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu'] as const
const key = (link: Pick<CityLink, 'a' | 'b' | 'mode'>): string => `${[link.a, link.b].sort().join('|')}|${link.mode}`
const openLinks = allCityLinks().filter(link => OPEN.includes(link.a as typeof OPEN[number]) && OPEN.includes(link.b as typeof OPEN[number]))

test('the open links are exactly the declared passenger routes, each listed once', () => {
  assert.deepEqual(openLinks.map(key).sort(), [
    'abeokuta|ibadan|rail', 'abeokuta|ibadan|road', 'abeokuta|lagos|rail', 'abeokuta|lagos|road', 'abeokuta|ota|road', 'abeokuta|sagamu|road',
    'ibadan|lagos|rail', 'ibadan|lagos|road', 'ijebu-ode|sagamu|road', 'lagos|ota|road', 'ota|sagamu|road',
  ])
  assert.equal(new Set(allCityLinks().map(key)).size, allCityLinks().length, 'no route is duplicated')
  assert.equal(Object.keys(OGUN_LINKS).length, 9)
})

test('every link is labelled beta, is positive and is listed by the modules at both ends', () => {
  for (const link of allCityLinks()) {
    assert.equal(link.beta, true, `${key(link)} is labelled beta`)
    assert.ok(link.fare > 0 && link.seconds > 0 && link.km > 0 && link.label.length > 0 && link.icon.length > 0, key(link))
    assert.notEqual(link.a, link.b)
  }
  for (const link of openLinks) {
    for (const id of [link.a, link.b]) {
      const listed = cityModule(id)?.rules.links.filter(item => key(item) === key(link)) ?? []
      assert.equal(listed.length, 1, `${id} lists ${key(link)} exactly once`)
      assert.deepEqual(listed[0], link, `${id} lists the same fare and time`)
    }
    const forward = linksFrom(link.a).find(item => item.to === link.b && item.mode === link.mode)
    const back = linksFrom(link.b).find(item => item.to === link.a && item.mode === link.mode)
    assert.ok(forward && back, 'both directions exist')
    assert.deepEqual([forward.fare, forward.seconds, forward.km, forward.label], [back.fare, back.seconds, back.km, back.label])
    for (const id of [link.a, link.b]) assert.ok(cityRules(id)?.hub[link.mode], `${id} names its ${link.mode} hub`)
  }
  for (const id of OPEN) for (const link of cityModule(id)?.rules.links ?? []) assert.ok(link.a === id || link.b === id, `${id} lists only its own links`)
})

test('Lagos to Ota is the short, cheap hop; the train stations are Abeokuta and Ibadan only; Papalanto is not a boarding point', () => {
  const lagosOta = linksFrom('lagos').find(link => link.to === 'ota')
  assert.ok(lagosOta)
  for (const link of linksFrom('lagos').filter(item => item.to !== 'ota' && OPEN.includes(item.to as typeof OPEN[number]))) {
    assert.ok(lagosOta.fare < link.fare && lagosOta.seconds <= link.seconds, `Lagos to Ota is cheaper and shorter than ${link.to} by ${link.mode}`)
  }
  assert.deepEqual(openLinks.filter(link => link.mode === 'rail').flatMap(link => [link.a, link.b]).sort(), ['abeokuta', 'abeokuta', 'ibadan', 'ibadan', 'lagos', 'lagos'])
  for (const id of ['ota', 'sagamu', 'ijebu-ode']) assert.equal(cityRules(id)?.hub.rail, undefined, `${id} has no rail hub`)
  const wording = JSON.stringify([...allCityLinks(), ...OPEN.map(id => cityRules(id)?.hub)]).toLowerCase()
  assert.ok(!wording.includes('papalanto') && !wording.includes('ewekoro'))
})

test('no link can be used to travel to a city that is not open', async () => {
  await loadCityContent('lagos')
  const rich = createLife({ name: 'Rich' }, { now: Date.UTC(2026, 0, 5, 9), cityId: 'lagos', seed: 'links', isNew: true })
  rich.cash = 10_000_000
  for (const link of allCityLinks()) for (const [from, to] of [[link.a, link.b], [link.b, link.a]] as const) {
    if (from !== 'lagos' && from !== 'ibadan') continue
    rich.estate.city = from
    const open = cityRules(to)?.status === 'open'
    const blocked = relocateBlock(rich, to, link.mode)
    if (!open) assert.equal(blocked?.code, 'city_not_open', `${from} to ${to} by ${link.mode} is refused: ${to} is closed`)
    else if (link.status === 'coming') assert.equal(blocked?.code, 'route_not_open', `${from} to ${to} by ${link.mode} is planned, not bookable`)
    else assert.equal(blocked, null, `${from} to ${to} by ${link.mode} is allowed`)
  }
  rich.estate.city = 'lagos'
  assert.equal(relocateBlock(rich, 'ota', 'rail')?.code, 'no_route', 'Ota has no train')
  assert.equal(relocateBlock(rich, 'sagamu', 'road')?.code, 'no_route', 'Lagos to Sagamu is not a direct link')
  assert.equal(relocateBlock(rich, 'papalanto', 'rail')?.code, 'invalid_city')
})
