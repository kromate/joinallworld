// OWNER: social — the first minute's pure rules (docs/FEED.md, "First minute"): the strip's items, the people line and the one next action.
import test from 'node:test'
import assert from 'node:assert/strict'
import { actionHint, hereText, nextAction, stripItems, whenText } from './firstMinuteModel.ts'
import type { MinuteFacts } from './firstMinuteModel.ts'
import { BADGE_KEY, hasBadge, keepBadge } from '../feed/badgeMark.ts'
import { BADGE_DOCK, DOCK } from '../phone/phoneHomeModel.ts'
import type { CrewView, EventView, PostView } from '../../../types/feed.ts'

const NOW = 1_800_000_000_000
const person = (id: string, located?: { city: string; lga?: string }) => ({ id, name: `P${id}`, ...(located ? { located: { ...located, name: located.city } } : {}) })
const post = (id: string, o: Partial<PostView> = {}): PostView => ({
  id, by: person(id), at: NOW, kind: 'text', body: `hello from ${id}`, place: null, vis: 'public', reactions: [], replies: 0, thread: [], canReply: true, ...o,
})
const event = (id: string, start: number, o: Partial<EventView> = {}): EventView => ({
  id, title: `Party ${id}`, about: '', by: person('h'), cohosts: [], start, end: start + 3600000, phase: start <= NOW ? 'live' : 'soon',
  place: { city: 'lagos', cityName: 'Lagos', label: 'Yaba Market' }, cap: 50, going: 2, maybe: 0, me: null, friendsGoing: [], code: 'ABCDEF', mine: false, ...o,
})
const crew = (id: string, o: Partial<CrewView> = {}): CrewView => ({
  id, name: `Crew ${id}`, colour: 'gold', about: '', at: NOW, owner: person('o'), members: [], size: 3, cap: 1000, mine: false, owned: false, mod: false,
  kind: 'city', kindLabel: 'City', open: true, mods: [], ...o,
})
const facts = (o: Partial<MinuteFacts> = {}): MinuteFacts => ({ posts: [], communities: [], badge: null, city: 'lagos', others: 0, canChat: true, canWalk: true, ...o })
const BADGE = { city: 'lagos', lga: 'yaba' }

test('the next action: someone here first, then a neighbour, then a community of the area, then the city, then the Square', () => {
  const neighbour = post('n', { by: person('n', { city: 'lagos', lga: 'yaba' }) })
  const cityPost = post('c', { by: person('c', { city: 'lagos', lga: 'ikeja' }) })
  const area = crew('area', { place: { city: 'lagos', lga: 'yaba', real: 1 } })
  const town = crew('town', { place: { city: 'lagos', real: 1 } })
  const all = facts({ badge: BADGE, posts: [cityPost, neighbour], communities: [town, area], others: 2 })
  assert.deepEqual(nextAction(all), { kind: 'room', label: 'Say hello' })
  assert.equal(nextAction({ ...all, canChat: false }).kind, 'reply', 'a street walk has no room chat')
  assert.deepEqual(nextAction({ ...all, others: 0 }), { kind: 'reply', label: 'Say hello', post: 'n', who: 'Pn' }, 'a neighbour of the same local government')
  assert.deepEqual(nextAction({ ...all, others: null, posts: [cityPost] }), { kind: 'join', label: 'Join Crew area', crew: 'area', name: 'Crew area' }, 'the area community before a city post')
  assert.equal(nextAction({ ...all, others: 0, posts: [cityPost], communities: [] }).kind, 'reply', 'then a post of the city')
  assert.equal(nextAction(facts({ posts: [cityPost] })).kind, 'reply', 'without a badge, the city is near')
  assert.deepEqual(nextAction(facts()), { kind: 'square', label: 'Walk to the Square' })
  assert.deepEqual(nextAction(facts({ canWalk: false })), { kind: 'post', label: 'Say hello' }, 'in the Square or on a walk: a post on Near you')
})

test('the next action: only a post a person may answer, and only a community one may join', () => {
  const far = post('far', { by: person('far', { city: 'abuja' }) })
  const ai = post('ai', { by: { ...person('ai', { city: 'lagos', lga: 'yaba' }), ai: true } })
  const closed = post('closed', { by: person('closed', { city: 'lagos', lga: 'yaba' }), canReply: false })
  const own = post('own', { by: person('own', { city: 'lagos', lga: 'yaba' }), mine: true })
  assert.equal(nextAction(facts({ badge: BADGE, posts: [far, ai, closed, own] })).kind, 'square', 'the world, AI characters, closed replies and my own posts do not count')
  assert.equal(nextAction(facts({ posts: [post('placed', { place: { city: 'lagos', cityName: 'Lagos' } })] })).kind, 'reply', 'a post placed in my city counts')
  const blocked = [crew('m', { mine: true }), crew('shut', { open: false }), crew('locals', { qualifies: false }), crew('full', { size: 20, cap: 20 })]
  assert.equal(nextAction(facts({ communities: blocked })).kind, 'square', 'mine, closed, locals-only without my badge, full')
  assert.equal(nextAction(facts({ badge: BADGE, communities: [crew('other', { place: { city: 'ibadan' } })] })).kind, 'join', 'any open one of the list when none is of my place')
})

test('the strip: an event first (the soonest not over), then posts as ranked, at most three, never my own', () => {
  const later = post('e2', { kind: 'event', body: '', event: event('e2', NOW + 3 * 3600000) })
  const soon = post('e1', { kind: 'event', body: '', event: event('e1', NOW + 20 * 60000) })
  const over = post('e0', { kind: 'event', body: '', event: event('e0', NOW - 7200000, { phase: 'over' }) })
  const long = post('long', { body: `${'word '.repeat(40)}end` })
  const items = stripItems([post('a'), later, post('mine', { mine: true }), over, long, soon, post('b')], NOW)
  assert.deepEqual(items.map((i) => i.id), ['e1', 'a', 'long'])
  assert.deepEqual(items[0], { id: 'e1', who: 'Pe1', event: true, text: 'Party e1 · in 20 min · Yaba Market' })
  assert.ok((items[2]?.text.length ?? 0) <= 90 && items[2]?.text.endsWith('…'), 'a long post is cut')
  assert.deepEqual(stripItems([], NOW), [])
})

test('the words: when, who is here, what the button does', () => {
  assert.equal(whenText(NOW - 1, NOW), 'on now')
  assert.equal(whenText(NOW + 5 * 3600000, NOW, 'live'), 'on now')
  assert.equal(whenText(NOW + 30 * 60000, NOW), 'in 30 min')
  assert.equal(whenText(NOW + 5 * 3600000, NOW), 'in 5 h')
  assert.equal(whenText(NOW + 26 * 3600000, NOW), 'tomorrow')
  assert.equal(whenText(NOW + 4 * 86400000, NOW), 'in 4 days')
  assert.equal(hereText(null), null)
  assert.equal(hereText(0), 'Nobody else here yet')
  assert.equal(hereText(1), '1 person here now')
  assert.equal(hereText(12), '12 people here now')
  assert.equal(actionHint({ kind: 'reply', label: 'Say hello', post: 'x', who: 'Ada' }), 'Reply to Ada')
})

test('the badge mark: yes or no on the device, and the Phone puts Feed first for it', () => {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
  assert.equal(hasBadge(store), false)
  keepBadge(true, store)
  assert.equal(m.get(BADGE_KEY), '1')
  assert.equal(hasBadge(store), true)
  keepBadge(false, store)
  assert.equal(hasBadge(store), false)
  assert.equal(hasBadge(null), false, 'no storage: the usual order')
  assert.equal(BADGE_DOCK[0], 'feed')
  assert.deepEqual(BADGE_DOCK.slice(1), DOCK.slice(0, 3), 'the rest of the dock keeps its order')
})

test('a regular who is standing here comes before the walk to the Square, and a player who is back gets their goal', () => {
  const regulars = [{ id: 'tunji', name: 'Tunji' }, { id: 'ada', name: 'Ada' }]
  assert.deepEqual(nextAction(facts({ regulars })), { kind: 'npc', label: 'Say hello to Tunji', npc: 'tunji', name: 'Tunji' })
  assert.equal(nextAction(facts({ regulars, others: 2 })).kind, 'room', 'people come before a regular')
  assert.equal(nextAction(facts({ regulars: [] })).kind, 'square')
  assert.equal(actionHint(nextAction(facts({ regulars }))), 'Tunji is a regular here')
  assert.equal(hereText(0, regulars), '2 regulars here')
  assert.equal(hereText(0, regulars.slice(0, 1)), 'Tunji is here')
  assert.equal(hereText(3, regulars), '3 people here now')
  assert.deepEqual(nextAction(facts({ regulars, others: 2, back: 'Eat something' })), { kind: 'goal', label: 'Eat something' }, 'back after a while: the goal first')
  assert.equal(nextAction(facts({ back: null })).kind, 'square')
})
