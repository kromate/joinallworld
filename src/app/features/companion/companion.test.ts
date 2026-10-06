// The companion's brain, director, memory, actions and tours, against crafted game snapshots. No browser.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAIN_CHIPS, answerFor, nextStep } from './answers.ts'
import { askCompanion } from './brain.ts'
import type { Hosted } from './brain.ts'
import { CHANGELOG } from './changelog.ts'
import { CONCEPTS } from './knowledge.ts'
import { BACKOFF_AFTER, IDLE_AFTER_MS, MIN_GAP_MS, MOMENT_GAP_MS, afterEngaged, afterIgnored, afterShown, dailyThree, decide, detectEvents, gapFor } from './director.ts'
import type { DirectorFacts, Quiet } from './director.ts'
import { createMemory, readPrefs, writePrefs } from './memory.ts'
import type { PlayerMemory } from './memory.ts'
import { runAction, panelOf } from './actions.ts'
import type { ActionEnv } from './actions.ts'
import { TOUR_IDS, tourSteps } from './tours.ts'
import { suggestToAction } from './suggest.ts'
import { ctx } from './testFixtures.ts'
import type { CompanionAction, CompanionContext, CompanionReply } from './types.ts'
import { playlist } from '../tour/tourModel.ts'

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path] })
const FEATURES = walk(join(root, 'src/app/features')).filter((path) => /\.(vue|ts)$/.test(path) && !/\.test\./.test(path) && !path.includes('features/companion/'))
const SOURCE = FEATURES.map((path) => readFileSync(path, 'utf8')).join('\n')
const sentences = (text: string): number => text.split(/(?<=[.!?])\s+/).filter(Boolean).length
const store = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } } }

// ---- the answers, from the state ------------------------------------------------------------------------------------------
const say = (text: string, over: Partial<CompanionContext> = {}): CompanionReply => answerFor(text, ctx(over))

test('what should I do: one concrete step from the state, strongest need first', () => {
  const stuck = say('what should i do', { stuck: true, cash: 120, away: true, cityId: 'abuja', cityName: 'Abuja' })
  assert.deepEqual(stuck.actions.map((a) => a.kind), ['relief'], 'a broke visitor is sent to the help card')
  const hungry = say('wetin I go do', { needs: { hunger: 10, energy: 70, fun: 50, social: 50, hygiene: 60, bladder: 60 }, hour: 23 })
  assert.match(hungry.text, /hungry/i); assert.deepEqual(hungry.actions[0], { kind: 'map', venue: 'amala-shitta', label: 'Take me there' })
  const nightTired = say('what next', { needs: { hunger: 70, energy: 10, fun: 50, social: 50, hygiene: 60, bladder: 60 }, hour: 23, places: [...ctx().places, { id: 'home', label: 'Home', district: 'Your place', category: 'home', open: true, status: 'Open', here: false, activities: [], description: '' }] })
  assert.match(nightTired.text, /late|energy/i); assert.equal(nightTired.actions[0]?.kind, 'map')
  const fresh = say('i am bored', { newPlayer: true, guest: true, goal: { title: 'Play a round of Ayo', hint: 'It is free and quick.', go: ['park', 'trees'] } })
  assert.match(fresh.text, /Ayo/); assert.deepEqual(fresh.actions[0], { kind: 'go', venue: 'park', spot: 'trees', label: 'Take me there' })
  const rent = say('what should i do', { rentArrears: 7000 })
  assert.match(rent.text, /₦7,000/); assert.equal(panelOf(rent.actions[0] as CompanionAction), 'bank')
  const stall = say('what should i do', { stallsOpened: 1, stallAlert: 'The market closes your stall tonight if rent stays unpaid.' })
  assert.match(stall.text, /stall/i); assert.equal(panelOf(stall.actions[0] as CompanionAction), 'business')
  const mission = say('what should i do', { missions: { locked: null, claimable: 2, open: [] } })
  assert.match(mission.text, /2 finished missions/)
  const friend = nextStep(ctx({ friends: [{ id: 'f1', name: 'Tunde', online: true }], employed: true }), 0)
  assert.equal(friend.actions[0]?.kind, 'chat'); assert.match(friend.text, /Tunde/)
  const job = say('what should i do', { cash: 900, employed: false })
  assert.equal(panelOf(job.actions[0] as CompanionAction), 'jobs')
})

test('ride debt and cash are read from the state, never guessed', () => {
  assert.match(say('how much money do i have', { cash: 12345, rideDebt: 2500 }).text, /₦12,345.*₦2,500/)
  assert.doesNotMatch(say('how much money do i have', { cash: 50 }).text, /owe/)
})

test('how-to answers name real buttons and real places', () => {
  assert.equal(say('how do i travel to Abuja').actions[0]?.kind, 'world')
  assert.deepEqual(say('how do i travel to Abuja').actions[0], { kind: 'world', city: 'abuja', label: 'Take me there' })
  assert.match(say('how do i travel to lagos').text, /already in Lagos/)
  assert.match(say('how do i travel to kano', { cities: ctx().cities.map((c) => (c.id === 'kano' ? { ...c, open: false } : c)) }).text, /not open yet/)
  const closed = say('where is quilox')
  assert.match(closed.text, /closed/i); assert.ok(closed.actions.some((a) => a.kind === 'map' && a.venue === 'quilox'))
  assert.match(say('where is freedom park').text, /already|are at/i)
  assert.match(say('i wan chop').text, /Amala Shitta/)
  assert.equal(panelOf(say('how do i save my progress', { signedIn: false }).actions[0] as CompanionAction), 'account')
  assert.match(say('how do i save my progress', { signedIn: true }).text, /signed in/)
  assert.equal(say('how do i call a friend', { friends: [{ id: 'f1', name: 'Tunde', online: true }] }).actions[0]?.kind, 'call')
  assert.equal(say('who is online', { friends: [{ id: 'f1', name: 'Tunde', online: true }] }).actions.length, 2)
  assert.match(say('who is online').text, /none of your friends|Quiet/)
  assert.match(say('any messages', { unread: 3 }).text, /3 unread/)
  assert.match(say('what is new').text, new RegExp(CHANGELOG[0]!.text.slice(0, 20)))
  assert.equal(say('show me around').actions.length, 5)
})

test('small talk has a voice, never claims to be human, and takes the safe road on a hard moment', () => {
  assert.match(say('are you human').text, /not a person|AI guide/)
  assert.match(say('are you anthony').text, /AI guide/)
  assert.doesNotMatch(say('who are you').text, /I am (a |the )?(human|person)\b/i)
  assert.match(say('hello', { hour: 8, name: 'Ada Obi' }).text, /Ada/)
  assert.ok(say('tell me a joke').text.length > 20)
  const safety = say('i want to hurt myself')
  assert.match(safety.text, /someone you trust|emergency/); assert.equal(safety.actions.length, 0)
  assert.equal(say('be quiet').actions[0]?.kind, 'mode')
})

test('an unknown question says so, offers the three closest topics and a way to ask a person', () => {
  const reply = say('what is the capital of france', { friends: [{ id: 'f1', name: 'Tunde', online: true }] })
  assert.equal(reply.topic, 'unknown'); assert.match(reply.text, /not sure/)
  assert.ok(reply.actions.filter((a) => a.kind === 'ask').length <= 3)
  assert.ok(reply.actions.some((a) => a.kind === 'chat') && reply.actions.some((a) => a.kind === 'report'))
  const none = say('xyzzy plugh')
  assert.ok(none.actions.filter((a) => a.kind === 'ask').length === 3, 'with nothing near, the usual three')
})

test('every answer is at most three short sentences, plus buttons', () => {
  const asks = [...MAIN_CHIPS, 'how do i earn money', 'how do i sleep', 'how do i open a business', 'how do i vote', 'how do i change my look', 'how do i send money', 'how do i report someone', 'what is mood', 'what is a ping', 'hello', 'tell me a joke', 'i am sad', 'what time is it', 'how do i skip the trip', 'where can i find food', 'what can you do']
  for (const text of asks) {
    for (const state of [ctx(), ctx({ stuck: true, cash: 50 }), ctx({ needs: { hunger: 5, energy: 5, fun: 5, social: 5, hygiene: 5, bladder: 5 } })]) {
      const reply = answerFor(text, state)
      assert.ok(sentences(reply.text.replace(/\n.*/s, '')) <= 3 || reply.topic === 'whatsnew', `"${text}" -> ${reply.text}`)
      assert.ok(reply.text.length < 330, reply.text)
    }
  }
})

test('it does not repeat a long explanation it already gave', () => {
  const first = answerFor('how do i earn money', ctx(), { explained: [], asked: 0 })
  const again = answerFor('how do i earn money', ctx(), { explained: ['earn'], asked: 1 })
  assert.ok(again.text.length < first.text.length)
})

test('the hosted seam: used only for what the local brain is unsure of; its buttons are checked; failure falls back', async () => {
  const input = (message: string) => ({ context: ctx(), message, memory: { explained: [], asked: 0 } })
  let calls = 0
  const good = async (): Promise<Hosted> => { calls++; return { text: 'Ah, a deep one. Try the Library at night.', suggest: ['open-map-venue:quilox', 'open-map-venue:nowhere', 'rm-rf'], via: 'primary' } }
  const sure = await askCompanion(input('how do i earn money'), good)
  assert.deepEqual([sure.via, calls], ['local', 0], 'a confident how-to is answered locally')
  const hosted = await askCompanion(input('what is the capital of france'), good)
  assert.deepEqual([hosted.via, calls, hosted.text.startsWith('Ah')], ['primary', 1, true])
  assert.deepEqual(hosted.actions.map((a) => a.kind === 'map' ? a.venue : a.kind), ['quilox'], 'a made-up venue and a made-up id are dropped')
  const down = await askCompanion(input('what is the capital of france'), async () => { throw new Error('offline') })
  assert.equal(down.via, 'local'); assert.equal(down.topic, 'unknown')
  const refused = await askCompanion(input('what is the capital of france'), async () => ({ text: null, suggest: [], via: 'local' }))
  assert.equal(refused.via, 'local')
  assert.equal((await askCompanion(input('i want to hurt myself'), good)).via, 'local', 'a hard moment is never sent to a model')
  assert.equal(suggestToAction('start-trip:lagos', ctx()), null, 'a trip to the city you are in is not offered')
})

test('the changelog and the explainers name labels that exist in the interface', () => {
  assert.ok(CHANGELOG.length >= 3)
  const missing: string[] = []
  for (const concept of CONCEPTS) for (const label of concept.labels) if (!SOURCE.includes(`'${label}'`) && !SOURCE.includes(`"${label}"`) && !SOURCE.includes(`>${label}<`) && !SOURCE.includes(`title: '${label}'`) && !SOURCE.includes(label)) missing.push(`${concept.id}: ${label}`)
  assert.deepEqual(missing, [])
  for (const concept of CONCEPTS) assert.ok(sentences(concept.text) <= 3, concept.id)
  const buttons = ['Take the tour', 'Report a problem', 'Send money', 'Boutique', 'Groceries', 'Go automatically']
  for (const label of buttons) assert.ok(SOURCE.includes(label), label)
})

// ---- the buttons -------------------------------------------------------------------------------------------------------------
const panelIds = (): Set<string> => new Set([...SOURCE.matchAll(/(?:definePanel|id)\(?\{?\s*id:\s*'([a-z-]+)'/g)].map((m) => m[1] as string).concat(['phone', 'help', 'sim', 'map']))
function recorder(): { env: ActionEnv; calls: string[] } {
  const calls: string[] = []
  const rec = (name: string) => (...args: unknown[]): void => { calls.push(`${name}:${args.map(String).join(',')}`) }
  return { calls, env: { openPanel: rec('panel'), openMap: rec('map'), openWorld: rec('world'), goTo: rec('go'), openSim: rec('sim'), openChat: rec('chat'), call: rec('call'), invite: rec('invite'), startTour: rec('tour'), ask: rec('ask'), setMode: rec('mode'), dismiss: rec('dismiss') } }
}
test('every button the brain, the director and the model path can make dispatches a real route to a panel, place or city that exists', () => {
  const states = [ctx({ newPlayer: true, guest: true, goal: { title: 'Play a round of Ayo', hint: 'Free.', go: ['park', 'trees'] } }), ctx(), ctx({ stuck: true, away: true, cash: 50 }), ctx({ friends: [{ id: 'f1', name: 'Tunde', online: true }, { id: 'zed', name: 'Zed', online: false, founder: true }], employed: true, rentArrears: 100, stallsOpened: 2, stallAlert: 'Rent due', unread: 2, goal: { title: 'Do it', hint: 'Now', open: 'jobs' }, missions: { locked: null, claimable: 1, open: [{ label: 'Eat', hint: 'Food', done: false, claimed: false, go: ['amala-shitta'] }] } }), ctx({ needs: { hunger: 5, energy: 5, fun: 5, social: 5, hygiene: 5, bladder: 5 } })]
  const asks = [...MAIN_CHIPS, 'show me around', 'how do i travel to ibadan', 'where is the hospital', 'how do i open a business', 'how do i vote', 'how do i change my look', 'how do i save my progress', 'how do i turn off sound', 'how do i report someone', 'any messages', 'how do i find friends', 'how do i send money', 'how do i buy a house', 'what is a stall', 'what is mood', 'be quiet', 'talk more', 'qwerty', 'i wan chop', 'how do i rest', 'how do i call a friend']
  const ids = panelIds()
  const seen = new Set<string>()
  for (const state of states) {
    const all: CompanionAction[] = []
    for (const text of asks) all.push(...answerFor(text, state).actions)
    for (const event of ['first-job', 'first-friend', 'broke', 'new-city', 'friend-online', 'map-opened', 'joined', 'ping', 'first-sale', 'debt-repaid', 'first-trip', 'promoted'] as const) {
      const nudge = decide({ ...facts({ ctx: state, events: [event], memory: memory() }), now: 10_000_000 })
      all.push(...(nudge?.actions ?? []))
    }
    all.push(...(dailyThree(state)?.actions ?? []))
    for (const action of all) {
      const { env, calls } = recorder()
      runAction(action, env)
      assert.equal(calls.length, 1, JSON.stringify(action))
      seen.add(action.kind)
      const panel = panelOf(action); if (panel) assert.ok(ids.has(panel), `${panel} is a panel`)
      if (action.kind === 'map') assert.ok(state.places.some((p) => p.id === action.venue), action.venue)
      if (action.kind === 'world') assert.ok(state.cities.some((c) => c.id === action.city && c.open), action.city)
      if (action.kind === 'tour') assert.ok(TOUR_IDS.includes(action.tour))
      if (action.kind === 'sim') assert.ok(['needs', 'skills', 'settings', 'profile'].includes(action.tab) && SOURCE.includes(`id: '${action.tab}'`), action.tab)
    }
  }
  for (const kind of ['open', 'map', 'world', 'go', 'relief', 'call', 'chat', 'invite', 'tour', 'ask', 'sim', 'report', 'mode']) assert.ok(seen.has(kind), `${kind} was exercised`)
})

// ---- the director -------------------------------------------------------------------------------------------------------------
const QUIET: Quiet = { typing: false, inCall: false, modal: false, confirming: false, tour: false, hidden: false }
const memory = (patch: Partial<PlayerMemory> = {}): PlayerMemory => ({ ...createMemory(null, 'a').data, dailyDay: '2026-10-06', introDone: true, ...patch })
const facts = (over: Partial<DirectorFacts> = {}): DirectorFacts => ({ now: 10_000_000, day: '2026-10-06', mode: 'lively', ctx: ctx(), quiet: QUIET, idleMs: 0, events: [], memory: memory(), showing: false, openMs: 60_000, ...over })

test('the director speaks only when idle, rarely, kindly, and never in the way', () => {
  assert.equal(decide(facts()), null, 'nothing to say when the player is busy playing')
  const idle = decide(facts({ idleMs: IDLE_AFTER_MS + 1 }))
  assert.equal(idle?.kind, 'idle'); assert.ok((idle?.actions.length ?? 0) <= 2)
  for (const key of ['typing', 'inCall', 'modal', 'confirming', 'tour', 'hidden'] as const) assert.equal(decide(facts({ idleMs: 999_999, quiet: { ...QUIET, [key]: true } })), null, `quiet while ${key}`)
  assert.equal(decide(facts({ idleMs: 999_999, showing: true })), null, 'one bubble at a time')
  assert.equal(decide(facts({ idleMs: 999_999, ctx: ctx({ busy: true }) })), null, 'not in the middle of an activity')
  assert.equal(decide(facts({ idleMs: 999_999, ctx: ctx({ travelling: true }) })), null)
})

test('at most one unprompted nudge every few minutes; ignored twice and the gap doubles; engaging resets it', () => {
  const now = 10_000_000
  const recent = memory({ nudge: { lastAt: now - 60_000, ignored: 0, shownToday: 1, day: '2026-10-06', seen: {} } })
  assert.equal(decide(facts({ idleMs: 999_999, memory: recent })), null, 'one minute after the last is too soon')
  const later = memory({ nudge: { lastAt: now - MIN_GAP_MS - 1000, ignored: 0, shownToday: 1, day: '2026-10-06', seen: {} } })
  assert.ok(decide(facts({ idleMs: 999_999, memory: later })))
  assert.deepEqual([gapFor(0), gapFor(1), gapFor(BACKOFF_AFTER), gapFor(BACKOFF_AFTER + 1), gapFor(50)], [MIN_GAP_MS, MIN_GAP_MS, MIN_GAP_MS * 2, MIN_GAP_MS * 4, 30 * 60_000])
  const ignored = memory({ nudge: { lastAt: now - MIN_GAP_MS - 1000, ignored: 2, shownToday: 3, day: '2026-10-06', seen: {} } })
  assert.equal(decide(facts({ idleMs: 999_999, memory: ignored })), null, 'after two ignored, three minutes is no longer enough')
  const base = memory()
  assert.equal(afterIgnored({ ...base, nudge: afterIgnored(base) }).ignored, 2)
  assert.equal(afterEngaged({ ...base, nudge: { ...base.nudge, ignored: 5 } }).ignored, 0)
  const shown = afterShown(base, { id: 'x', kind: 'idle', text: '', actions: [], mood: 'nod' }, now, '2026-10-06')
  assert.deepEqual([shown.lastAt, shown.shownToday, shown.seen.x], [now, 1, now])
  const same = decide(facts({ idleMs: 999_999, memory: memory({ nudge: { ...base.nudge, seen: { [`idle:${nextStepKey()}`]: now - 1000 } } }) }))
  assert.ok(same === null || !same.id.endsWith(nextStepKey()), 'the same suggestion is not repeated at once')
})
const nextStepKey = (): string => nextStep(ctx(), Math.floor(10_000_000 / 60_000)).text.slice(0, 40)

test('moments, offers and social chances: right time, once, with a way out', () => {
  const now = 10_000_000
  const opened = decide(facts({ events: ['map-opened'] }))
  assert.deepEqual([opened?.kind, opened?.actions[0]?.kind], ['offer', 'tour'], 'the travel tour is offered on the first visit to the Map')
  assert.equal(decide(facts({ events: ['map-opened'], memory: memory({ milestones: ['offer:travel'] }) })), null, 'once')
  assert.equal(decide(facts({ events: ['first-job'] }))?.mood, 'celebrate')
  assert.equal(decide(facts({ events: ['first-job'], memory: memory({ milestones: ['first-job'] }) })), null)
  assert.match(decide(facts({ events: ['broke'], ctx: ctx({ stuck: true }) }))?.text ?? '', /way through/)
  assert.match(decide(facts({ events: ['new-city'], ctx: ctx({ cityId: 'abuja', cityName: 'Abuja' }) }))?.text ?? '', /Abuja/)
  const friend = decide(facts({ events: ['friend-online'], ctx: ctx({ friends: [{ id: 'f1', name: 'Tunde', online: true }] }) }))
  assert.deepEqual([friend?.kind, friend?.actions.map((a) => a.kind)], ['social', ['chat', 'call']])
  const tooSoon = memory({ nudge: { lastAt: now - MOMENT_GAP_MS + 5000, ignored: 0, shownToday: 1, day: '2026-10-06', seen: {} } })
  assert.equal(decide(facts({ events: ['first-job'], memory: tooSoon })), null, 'even a celebration waits a little')
  const events = detectEvents(ctx(), ctx({ employed: true, friendCount: 1, trips: 1, jobLevel: 0, sales: 1, rideDebt: 0, stuck: true, mode: 'map', joined: 1, pingsWaiting: 1, friends: [{ id: 'f1', name: 'T', online: true }] }), false)
  for (const event of ['first-job', 'first-friend', 'first-trip', 'first-sale', 'broke', 'friend-online', 'map-opened', 'joined', 'ping']) assert.ok(events.includes(event as never), event)
  assert.deepEqual(detectEvents(null, ctx(), false), [])
  assert.ok(detectEvents(ctx({ rideDebt: 900 }), ctx({ rideDebt: 0 }), false).includes('debt-repaid'))
})

test('warnings come before trouble, and the daily three once a day', () => {
  const hungry = decide(facts({ ctx: ctx({ needs: { hunger: 10, energy: 70, fun: 70, social: 70, hygiene: 70, bladder: 70 } }) }))
  assert.equal(hungry?.kind, 'warning')
  assert.equal(decide(facts({ ctx: ctx({ rentDueSoon: true }) }))?.id, 'warn:rent')
  assert.equal(decide(facts({ ctx: ctx({ stallsOpened: 1, hour: 19 }) }))?.id, 'warn:market')
  assert.equal(decide(facts({ ctx: ctx({ hour: 9 }), memory: memory({ dailyDay: '2026-10-05' }) }))?.kind, 'daily')
  assert.equal(decide(facts({ ctx: ctx({ hour: 9 }) }))?.kind, undefined, 'already shown today')
  const three = dailyThree(ctx({ hour: 9, missions: { locked: null, claimable: 1, open: [{ label: 'Eat a meal', hint: '', done: false, claimed: false }] } }))
  assert.match(three?.text ?? '', /1\).*2\).*3\)/)
})

test('settings: off says nothing; quiet only leaves a dot for important things; lively speaks', () => {
  const warn = ctx({ needs: { hunger: 10, energy: 70, fun: 70, social: 70, hygiene: 70, bladder: 70 } })
  assert.equal(decide(facts({ mode: 'off', ctx: warn, idleMs: 999_999 })), null)
  assert.equal(decide(facts({ mode: 'quiet', idleMs: 999_999 })), null, 'quiet: no idle suggestions')
  assert.equal(decide(facts({ mode: 'quiet', ctx: warn }))?.dot, true, 'quiet: a dot, not a bubble')
  assert.equal(decide(facts({ mode: 'quiet', events: ['first-job'] })), null, 'quiet: no celebrations either')
  assert.ok(decide(facts({ mode: 'lively', ctx: warn })))
})

// ---- memory ----------------------------------------------------------------------------------------------------------------
test('what it remembers is per player and per device, bounded, and survives bad data', () => {
  const disk = store()
  const a = createMemory(disk, 'ada')
  a.explained('earn'); a.markMilestone('first-job'); a.tour('travel', 'skipped'); a.resume('money', 'money-bank'); a.visitCity('lagos')
  for (let i = 0; i < 60; i++) a.append({ id: String(i), from: 'lumo', text: `line ${i}`, at: i, read: false })
  const again = createMemory(disk, 'ada')
  assert.deepEqual([again.data.explained, again.data.milestones, again.data.tours.travel, again.data.resume.money, again.data.cities], [['earn'], ['first-job'], 'skipped', 'money-bank', ['lagos']])
  assert.equal(again.data.log.length, 40); assert.equal(again.unread(), 40)
  again.markRead(); assert.equal(again.unread(), 0)
  assert.deepEqual(createMemory(disk, 'bola').data.explained, [], 'another player on this device has their own')
  again.tour('money', 'done'); assert.equal(again.data.resume.money, undefined, 'a finished tour is not resumed')
  for (const bad of ['', 'null', '[]', '{"ada":42}', '{"ada":{"log":[1,2],"explained":"x"}}', '{{{']) assert.equal(createMemory({ getItem: () => bad, setItem: () => {} }, 'ada').data.log.length, 0)
  const prefs = store(); assert.equal(readPrefs(prefs).mode, 'lively')
  writePrefs(prefs, { mode: 'quiet', x: 0.5, y: 0.25 }); assert.deepEqual(readPrefs(prefs), { mode: 'quiet', x: 0.5, y: 0.25 })
  prefs.setItem('allworld-companion-prefs', '{"mode":"loud"}'); assert.equal(readPrefs(prefs).mode, 'lively')
  for (let i = 0; i < 12; i++) createMemory(disk, `p${i}`).explained('x')
  assert.ok(Object.keys(JSON.parse(disk.data.get('allworld-companion') ?? '{}')).length <= 8, 'only a few players are kept on a device')
})

// ---- the tours ------------------------------------------------------------------------------------------------------------
test('every tour step has a real anchor, a short line, and the tours are short, skippable and complete', () => {
  const direct = new Set([...SOURCE.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1] as string))
  const navTabs = new Set([...SOURCE.matchAll(/id: '([a-z]+)'[^\n]*placement: 'nav'/g)].map((m) => `nav-${m[1]}`).concat(['nav-map', 'nav-phone', 'nav-buy']))
  const appIds = panelIds()
  const known = (id: string): boolean => direct.has(id) || navTabs.has(id) || (id.startsWith('app-') && appIds.has(id.slice(4)))
  assert.deepEqual(TOUR_IDS, ['basics', 'travel', 'money', 'friends', 'business'])
  for (const id of TOUR_IDS) {
    const steps = tourSteps(id)
    assert.ok(steps.length >= 4 && steps.length <= 13, `${id}: ${steps.length} steps`)
    assert.equal(steps.at(-1)?.id, 'done')
    for (const step of steps) {
      for (const anchor of [...(step.targets ?? []), ...(step.doneTargets ?? []), ...(step.needs ?? [])]) assert.ok(known(anchor), `${id}/${step.id}: no element is marked ${anchor}`)
      const text = typeof step.text === 'function' ? step.text({ home: false, touch: false, has: () => true }) : step.text
      assert.ok(text.length > 20 && text.length < 380, `${id}/${step.id}`)
    }
    // With nothing on screen the tour is still a card, a step and a close: it never dead-ends.
    assert.ok(playlist(steps, { home: false, touch: false, has: () => false }).length >= 2)
  }
  assert.match(tourSteps('basics')[0]!.text as string, /Lumo.*show you around.*skip any time/)
  const waits = TOUR_IDS.flatMap((id) => tourSteps(id).filter((step) => step.wait))
  assert.ok(waits.length >= 5 && waits.every((step) => step.task), 'a waiting step says what to do')
})
