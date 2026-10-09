// The guide's one table of buttons (registry.ts): every id has a route, every panel and section a route names exists in the interface's source,
// a model suggestion and the brain's own answer are the same button, and a button that cannot work says why. No browser; the browser-driven
// table of the main asks is scripts-side (the real clicks), this one holds the same table against the source.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { answerFor } from './answers.ts'
import { GAMES, PLAIN_IDS, entryFor, panelsOf, route, whyNot } from './registry.ts'
import { SUGGEST_IDS, suggestToAction } from './suggest.ts'
import { ctx } from './testFixtures.ts'
import type { CompanionAction, CompanionContext } from './types.ts'

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
const FILES = walk(join(root, 'src/app/features')).filter((path) => /\.(vue|ts)$/.test(path) && !/\.test\./.test(path))
const SOURCE = FILES.map((path) => readFileSync(path, 'utf8')).join('\n')
const PANELS = new Set([
  ...[...SOURCE.matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1] as string),
  ...[...SOURCE.matchAll(/(?:phonePanel|lazyPanel)\(\s*'([a-z-]+)'/g)].map((match) => match[1] as string),
  'phone', 'account-sign-in',
])

const market = { id: 'market', label: 'Market', district: 'Lagos Island', category: 'work', open: true, status: 'Open now', here: false, activities: [], description: '', market: true }
const base = (over: Partial<CompanionContext> = {}): CompanionContext => ctx({ places: [...ctx().places.filter((place) => place.id !== 'market'), market], friends: [{ id: 'f1', name: 'Bola', online: true }], ...over })

/** Every `{ section }` a route names has an element marked for it in the source; every game and flag it names is read by the panel. */
function landsSomewhere(action: CompanionAction): void {
  for (const panel of panelsOf(action)) assert.ok(PANELS.has(panel), `${panel} is a panel`)
  if (action.kind !== 'open' || !action.params) return
  const section = action.params.section
  if (typeof section === 'string') assert.ok(SOURCE.includes(`data-section="${section}"`), `${action.id}: a data-section="${section}" exists`)
  const game = action.params.game
  if (typeof game === 'string') assert.ok(GAMES.some((item) => item === game))
  if (action.params.new === 'group') assert.ok(/asked\.new === 'group'/.test(SOURCE), 'Messages reads new: group')
  if (action.params.gift === true) assert.ok(/asked\.gift === true/.test(SOURCE), 'the person card reads gift')
}

test('every suggestion id has a route, and the model path builds exactly the button the brain builds', () => {
  const state = base()
  for (const id of PLAIN_IDS) { const action = entryFor(id, state); assert.ok(action, id); landsSomewhere(action) }
  assert.deepEqual([...SUGGEST_IDS].sort(), [...PLAIN_IDS].sort(), 'the ids the server allows are the ids the table has')
  for (const id of [...SUGGEST_IDS, 'open-map-venue:hospital', 'start-trip:abuja', 'show-tour:money', ...GAMES.map((game) => `play-game:${game}`)]) {
    const suggested = suggestToAction(id, state)
    if (suggested) landsSomewhere(suggested)
  }
  assert.deepEqual(suggestToAction('open-stall', state), route.stall(state))
  assert.deepEqual(suggestToAction('new-group', state), route.newGroup())
  assert.deepEqual(suggestToAction('open-sound', state), route.sound())
  assert.deepEqual(suggestToAction('play-game:chess', state), route.game('chess'))
  assert.equal(suggestToAction('play-game:poker', state), null)
})

const only = (text: string, over: Partial<CompanionContext> = {}): CompanionAction[] => answerFor(text, base(over)).actions
const lands = (text: string, over: Partial<CompanionContext>, kind: string, id?: string, params?: Record<string, unknown>): void => {
  const found = only(text, over).find((action) => action.kind === kind && (id === undefined || (action.kind === 'open' && action.id === id)))
  assert.ok(found, `${text}: ${kind} ${id ?? ''} offered`)
  if (params && found.kind === 'open') for (const [key, value] of Object.entries(params)) assert.deepEqual(found.params?.[key], value, `${text}: ${key}`)
  landsSomewhere(found)
}

test('the main asks land on the right panel and the right section inside it', () => {
  lands('how do i find work', {}, 'open', 'jobs', { section: 'list' })
  lands('how do i earn money', {}, 'open', 'jobs', { section: 'list' })
  lands('how do i send money', { friends: [{ id: 'f1', name: 'Bola', online: true }] }, 'open', 'person', { player: 'f1', gift: true })
  lands('send money to bola', { friends: [{ id: 'f2', name: 'Tunde', online: true }, { id: 'f1', name: 'Bola', online: false }] }, 'open', 'person', { player: 'f1', gift: true })
  lands('how do i open a stall', {}, 'map')
  lands('how do i open a stall', { places: [{ ...market, here: true }, ...ctx().places.filter((place) => place.id !== 'market')] }, 'open', 'business', { venue: 'market', section: 'rent' })
  lands('how do i play chess', {}, 'open', 'games', { game: 'chess' })
  lands('how do i play weave', {}, 'open', 'games', { game: 'weave' })
  lands('todays word', {}, 'open', 'games', { game: 'oro' })
  lands('how do i create a group', {}, 'open', 'messages', { new: 'group' })
  lands('how do i travel to abuja', {}, 'world')
  lands('where is the hospital', {}, 'map')
  lands('how do i turn the sound off', {}, 'open', 'settings', { section: 'sound' })
  lands('how do i sign up', { signedIn: false }, 'open', 'account-sign-in', { intent: 'save', mode: 'create' })
  lands('how do i save my progress', { signedIn: true }, 'open', 'settings', { section: 'account' })
  lands('how do i report someone', {}, 'report')
  lands('what should i do now', { stuck: true, cash: 40 }, 'relief')
  lands('how do i make friends', {}, 'open', 'people')
  lands('how do i call a friend', {}, 'call')
  lands('any messages', { unread: 2 }, 'open', 'messages')
  lands('how do i pay rent', { rentArrears: 5000 }, 'open', 'bank')
})

test('a button that cannot work now says why instead of doing nothing', () => {
  assert.match(whyNot(route.sendMoney({ id: 'f1', name: 'Bola' }), base({ cash: 0 })) ?? '', /nothing to send/)
  assert.equal(whyNot(route.sendMoney({ id: 'f1', name: 'Bola' }), base()), null)
  const closed = base({ places: [{ ...market, here: true, open: false, status: 'Closed · opens 8AM' }] })
  assert.match(whyNot(route.stall(closed), closed) ?? '', /closed right now.*opens 8am/i)
  assert.match(whyNot(route.stall(base({ stallsOpened: 1, places: [{ ...market, here: true }] })), base({ stallsOpened: 1 })) ?? '', /already run a stall/)
  assert.match(whyNot(route.signUp(), base({ signedIn: true })) ?? '', /signed in already/)
  assert.equal(whyNot(route.signUp(), base({ signedIn: false })), null)
  assert.match(whyNot(route.relief(), base({ stuck: false })) ?? '', /not short of money/)
  assert.equal(whyNot(route.relief(), base({ stuck: true })), null)
  assert.match(whyNot(route.city('abuja'), base({ travelling: true })) ?? '', /on a trip/)
  assert.match(whyNot(route.city('abuja'), base({ cities: ctx().cities.map((city) => (city.id === 'abuja' ? { ...city, open: false } : city)) })) ?? '', /not open yet/)
  assert.match(whyNot(route.call({ id: 'f2', name: 'Tunde' }), base({ friends: [{ id: 'f2', name: 'Tunde', online: false }] })) ?? '', /offline/)
  assert.match(whyNot(route.call({ id: 'f1', name: 'Bola' }), base({ inCall: true })) ?? '', /call already/)
})
