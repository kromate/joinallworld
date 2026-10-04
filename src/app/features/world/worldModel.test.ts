// The world panels' logic without a browser: the drawing of a house, the directory's requests and
// pages, finding the local government from a position, and the select's keys held equal to the
// control kit's own (src/ui/controls.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { keepsNative as legacyKeepsNative, nextEnabled as legacyNextEnabled, typeAhead as legacyTypeAhead } from '../../../ui/controls.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { createGame } from '../../state/game.ts'
import { memoryStorage } from '../../testing/fakeServer.ts'
import type { FetchJson } from '../../types/client.ts'
import type { CityPackApi } from './cityPack.ts'
import { findLga, GEOLOCATION_WHY, NO_LOCATION } from './lgaCardModel.ts'
import type { LgaCardUi } from './lgaCardModel.ts'
import { keepsNative, listboxKey, nextEnabled, opensList, typeAhead } from './listboxModel.ts'
import type { ListboxOption } from './listboxModel.ts'
import { addressLabel, lgaOf, unpackStyle } from './worldContent.ts'
import type { LgaPage } from './worldModel.ts'
import { asMapHouse, createLgaDirectory, emptyPeopleText, houseArtShape, lgaParam, peoplePath } from './worldModel.ts'

const OPTIONS: ListboxOption[] = [{ value: '', label: 'Choose…' }, { value: 'a', label: 'Alimosho' }, { value: 'b', label: 'Apapa', disabled: true }, { value: 'c', label: 'Ikeja' }, { value: 'd', label: 'Ikorodu' }]

test('the select keys move exactly as the control kit does', () => {
  const legacyOptions = OPTIONS as unknown
  for (const from of [-1, 0, 1, 2, 3, 4, 5]) for (const step of [1, -1] as const) assert.equal(nextEnabled(OPTIONS, from, step), (legacyNextEnabled as (o: unknown, f: number, s: number) => number)(legacyOptions, from, step), `from ${from} step ${step}`)
  for (const typed of ['a', 'al', 'ik', 'iko', 'z', 'I']) for (const from of [0, 1, 2, 3, 4]) assert.equal(typeAhead(OPTIONS, from, typed), (legacyTypeAhead as (o: unknown, f: number, t: string) => number)(legacyOptions, from, typed), `type "${typed}" from ${from}`)
  assert.equal(nextEnabled(OPTIONS, 1, 1), 3, 'a disabled option is skipped')
  assert.equal(nextEnabled(OPTIONS, 4, 1), 4, 'no wrap at the end')
  assert.equal(nextEnabled(OPTIONS, -1, 1), 0, 'Home')
  assert.equal(nextEnabled(OPTIONS, OPTIONS.length, -1), 4, 'End')
  const same = (win: Pick<Window, 'matchMedia' | 'innerWidth'>): void => assert.equal(keepsNative(win), (legacyKeepsNative as (w: unknown) => boolean)(win))
  same({ matchMedia: () => ({ matches: true }) as MediaQueryList, innerWidth: 400 })
  same({ matchMedia: () => ({ matches: true }) as MediaQueryList, innerWidth: 1200 })
  same({ matchMedia: () => ({ matches: false }) as MediaQueryList, innerWidth: 400 })
})

test('the select: which key does what, open or closed', () => {
  const key = (value: string, extra: { ctrlKey?: boolean } = {}) => listboxKey({ key: value, ctrlKey: false, metaKey: false, altKey: false, ...extra })
  assert.deepEqual(['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Tab', 'k', 'F5'].map((value) => key(value)), ['close', 'next', 'previous', 'first', 'last', 'choose', 'choose', 'leave', 'type', null])
  assert.equal(key('k', { ctrlKey: true }), null, 'a shortcut is not a typed letter')
  assert.deepEqual(['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape', 'a'].map(opensList), [true, true, true, true, false, false])
})

test('a house is drawn from its style: tier size, roof, yard, fence and the builders\' poles', () => {
  const plain = houseArtShape({ shape: 0, wall: 0, roof: 0, door: 0, windows: 0, fence: 0, yard: 0, sign: 0 }, 'starter')
  assert.deepEqual([plain.width, plain.height, plain.x, plain.y, plain.label], [70, 40, 75, 72, 'Starter house'])
  assert.deepEqual(plain.top, { kind: 'path', d: 'M69 72L110 42L151 72Z' })
  assert.deepEqual([plain.fence, plain.yard.kind, plain.poles], [null, 'none', null])
  assert.deepEqual([plain.wall, plain.roof, plain.door, plain.windows], ['#f3ead6', '#a85c40', '#6b4a2b', '#bfe0f0'])
  const big = houseArtShape({ shape: 2, wall: 1, roof: 3, door: 1, windows: 2, fence: 2, yard: 4, sign: 0 }, 'villa', true)
  assert.deepEqual([big.width, big.height], [126, 86])
  assert.equal(big.top.kind, 'rect')
  assert.deepEqual(big.yard, { kind: 'block', fill: '#2f3b46' })
  assert.equal(big.fence, '#f6f2e6')
  assert.equal(big.label, 'Villa, being upgraded')
  assert.deepEqual(big.poles?.xs, [39, 110, 181])
  assert.deepEqual(houseArtShape({ shape: 0, wall: 0, roof: 0, door: 0, windows: 0, fence: 0, yard: 1, sign: 0 }).yard, { kind: 'plant', cy: 104, r: 7, fill: '#e86a8a' })
  assert.deepEqual(houseArtShape({ shape: 3, wall: 0, roof: 0, door: 0, windows: 0, fence: 0, yard: 3, sign: 0 }).yard, { kind: 'plant', cy: 84, r: 14, fill: '#3f8a57' })
})

test('what the map hands over is read defensively', () => {
  assert.equal(asMapHouse(null), null)
  assert.equal(asMapHouse({ lga: 'ikeja' }), null)
  assert.deepEqual(asMapHouse({ lga: 'ikeja', estate: 3, plot: 9, style: 0 }), { lga: 'ikeja', estate: 3, plot: 9, id: null, name: null, online: false, you: false, style: 0, upgrading: false })
  assert.equal(lgaParam({ lga: 'ikeja' }), 'ikeja')
  assert.equal(lgaParam({ lga: 4 }), null)
  assert.equal(lgaOf('lagos', 'ikeja')?.id, 'ikeja')
  assert.equal(lgaOf('lagos', 'nowhere'), null)
  assert.equal(addressLabel('lagos', 'ikeja', 41, 17), 'Plot 4, Street 2, Estate 42, Ikeja')
  assert.equal(unpackStyle(0).tier, 'starter')
})

test('the directory: counts and first page, a search, the online filter, more, and a failed read', async () => {
  const server = createFakeServer()
  const game = createGame({ fetch: server.fetch, storage: memoryStorage(), now: () => server.now(), setTimeout: () => 0, clearTimeout: () => {}, toast: () => {} })
  await game.connect()
  const asked: string[] = []
  let fail = false
  const people = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, name: `Name ${from + i}`, home: 'own', online: false, you: false }))
  const fetchJson = (async (path: string) => {
    asked.push(path)
    if (fail) { const error = new Error('x') as Error & { reason?: string }; error.reason = 'The world is resting.'; throw error }
    if (path.includes('/people')) {
      if (path.includes('q=a')) return { items: [], next: null, short: true }
      return path.includes('after=25') ? { items: people(3, 25), next: null } : { items: people(25), next: 25 }
    }
    return { residents: 10, houses: 8, online: 2, id: 'ikeja', capacity: 1, rev: 1, yours: false }
  }) as FetchJson
  const directory = createLgaDirectory({ fetchJson, cityId: () => game.cityId.value })
  const now = (): LgaPage => directory.pageOf('ikeja')
  assert.equal(now().items, null)
  await directory.load('ikeja')
  assert.deepEqual([now().items?.length, now().next, now().info?.residents, now().loading], [25, 25, 10, false])
  assert.deepEqual(asked, ['/api/world/lga/ikeja?city=lagos', '/api/world/lga/ikeja/people?city=lagos'])
  await directory.load('ikeja', true)
  assert.deepEqual([now().items?.length, now().next], [28, null])
  assert.equal(asked.at(-1), '/api/world/lga/ikeja/people?city=lagos&after=25', 'the cursor is sent back, the counts are not read again')
  await directory.search('ikeja', '  a ')
  assert.deepEqual([now().q, now().short, now().items?.length], ['a', true, 0])
  assert.match(asked.at(-1) ?? '', /&q=a$/)
  await directory.search('ikeja', 'ada lovelace')
  assert.match(asked.at(-1) ?? '', /&q=ada%20lovelace$/)
  await directory.toggleOnline('ikeja')
  assert.match(asked.at(-1) ?? '', /&q=ada%20lovelace&online=1$/)
  assert.equal(now().online, true)
  fail = true
  await directory.restart('ikeja')
  assert.deepEqual([now().error, now().items, now().loading], ['The world is resting.', null, false])
  fail = false
  await directory.restart('ikeja')
  assert.equal(now().error, '')
  assert.equal(peoplePath('ikeja', 'lagos', { q: '', online: false, after: null }), '/api/world/lga/ikeja/people?city=lagos')
  assert.equal(emptyPeopleText({ q: 'x', online: false }), 'Nobody listed by that name here.')
  assert.equal(emptyPeopleText({ q: '', online: true }), 'Nobody listed here is online right now.')
  assert.equal(emptyPeopleText({ q: '', online: false }), 'Nobody is listed here yet.')
})

function freshUi(): LgaCardUi { return { finding: false, found: null, note: '', picking: false, sending: false } }
const packs = (over: Partial<CityPackApi> = {}): (() => Promise<CityPackApi>) => async () => ({ has: () => true, load: async () => ({ name: 'Lagos' }), resolve: () => ({ id: 'ikeja', name: 'Ikeja', sure: true }), ...over })

test('finding the local government: only an id is kept, and every failure says why and offers the list', async () => {
  const position = { coords: { latitude: 6.6, longitude: 3.3 } } as GeolocationPosition
  const seen: unknown[] = []
  const ok = { getCurrentPosition: (success: PositionCallback) => success(position) }
  let ui = freshUi()
  await findLga(ui, 'lagos', { geolocation: ok, packs: packs({ resolve: (_pack, latitude, longitude) => { seen.push([latitude, longitude]); return { id: 'ikeja', name: 'Ikeja', sure: false } } }) })
  assert.deepEqual([ui.found, ui.finding, ui.picking, ui.note], [{ id: 'ikeja', name: 'Ikeja', sure: false }, false, false, ''])
  assert.deepEqual(seen, [[6.6, 3.3]], 'the position goes to the lookup on this device')
  assert.ok(!JSON.stringify(ui).includes('6.6'), 'and is not kept anywhere')
  ui = freshUi()
  await findLga(ui, 'lagos', { geolocation: undefined })
  assert.deepEqual([ui.note, ui.picking], [NO_LOCATION, true])
  ui = freshUi()
  await findLga(ui, 'lagos', { geolocation: ok, packs: packs({ has: () => false }) })
  assert.deepEqual([ui.note, ui.picking, ui.finding], [NO_LOCATION, true, false])
  ui = freshUi()
  await findLga(ui, 'lagos', { geolocation: ok, packs: packs({ resolve: () => null }) })
  assert.deepEqual([ui.note, ui.picking], ['You do not seem to be in Lagos right now. Pick the local government you call home.', true])
  for (const code of [1, 2, 3, 9]) {
    ui = freshUi()
    await findLga(ui, 'lagos', { geolocation: { getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code } as GeolocationPositionError) }, packs: packs() })
    assert.equal(ui.note, GEOLOCATION_WHY[code] ?? GEOLOCATION_WHY[2], `code ${code}`)
    assert.equal(ui.picking, true)
  }
})
