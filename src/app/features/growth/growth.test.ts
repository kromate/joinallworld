import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The logic behind the growth screens, without a browser: the shared client (hello at most every
// five minutes, the exactly-once share flow, the session reset, the away card's dismissal), and
// what Missions, Events, Bring a friend, Stay in touch, the away card and the inbox chip say.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarOccurrence, ConsentView, Digest, ReferralView } from '../../../types/growth.ts'
import type { MissionRow, MissionSet } from '../../../types/view.ts'
import type { FetchOptions } from '../../types/client.ts'
import type { PhoneNotification } from '../../types/panel.ts'
import type { PreparedShare, ShareModule } from './boundary.ts'
import { awayCardFor, awayWanted, inboxChip, inboxSlot } from './awayModel.ts'
import { eventsBadge, eventsNotifications } from './eventsModel.ts'
import { nothingOn, presenceNote, sprayReason, whenLine } from './eventsLines.ts'
import { HELLO_MAX_AGE, announceAge, channelHref, failureOf, growthReady, helloEvents, helloStale, isInvite, span, track, until } from './growthModel.ts'
import type { HelloOk } from './growthModel.ts'
import { missionsBadge, missionsNotifications } from './missionsModel.ts'
import { daysTail, missionAction, missionHint, missionIcon, missionPercent, setLine, showsProgress, stampCells, stampsNote } from './missionsLines.ts'
import { referBadge } from './referModel.ts'
import { byLine, friendState, heroFigure, heroNote, paidLine, referRules, waitingLine } from './referLines.ts'
import { ageCard, devicesLine, emailCard, emailDisabled, emailReason, pushCard, pushDeclinedWords, showsChannels } from './touchModel.ts'
import { createGrowth } from './growthStore.ts'
import type { GrowthDeps } from './growthStore.ts'

const money = (value: number): string => `₦${value.toLocaleString('en-NG')}`
const consent = (over: Partial<ConsentView> = {}): ConsentView => ({ age: 'adult', push: false, email: false, at: 1, ...over })
const referral = (over: Partial<ReferralView> = {}): ReferralView => ({
  by: null, invited: [], counted: 0, waiting: 0, owed: 0, title: null, nextTitle: null, paid: null,
  rules: { welcome: 500, reward: 2000, stars: 5, perWeek: 3, lifetime: 20, workDays: 2, linkWithinDays: 7 }, ...over,
})
const digest: Digest = { subject: 'S', greeting: 'Hi', lines: [], more: 0, tasks: [], footer: 'F', caps: { perDay: 1, perWeek: 3, settleMinutes: 5, quietFrom: 22, quietTo: 7, backoffDays: [1, 3, 7], maxPerAbsence: 4 }, delivery: 'dry-run' } as unknown as Digest
const helloOk = (over: Partial<HelloOk> = {}): HelloOk => ({
  ok: true, channel: '', contact: { channel: '', email: null, push: { devices: 0 }, live: { email: false } }, away: { hours: 5, since: 111 },
  referral: referral(), consent: null, events: [], digest, sharesLeft: 3, ...over,
}) as unknown as HelloOk
const mission = (over: Partial<MissionRow> = {}): MissionRow => ({ id: 'm1', kind: 'life', label: 'Eat', hint: 'Have a meal', n: 0, count: 1, done: false, claimed: false, cash: 250, open: null, go: null, ...over }) as unknown as MissionRow

// ---- the shared client -----------------------------------------------------------------------

interface Sent { path: string; options?: FetchOptions }
function harness(over: { connected?: boolean; required?: boolean; copy?: boolean; answer?: (path: string) => unknown } = {}) {
  const sent: Sent[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const commands: string[] = []
  const revoked: string[] = []
  const listeners = new Set<() => void>()
  const memory = new Map<string, string>()
  const clock = { now: 1_000_000 }
  const view = { cityId: 'lagos', connected: over.connected ?? true, onboarding: { required: over.required ?? false } }
  const prepared: PreparedShare = { text: 'Hello', link: 'https://x/s/abc', file: null, url: 'blob:one', whatsapp: 'https://wa.me/?text=Hello', x: 'https://x.com/intent/post?text=Hello' }
  const shareModule: ShareModule & { shared: number } = { shared: 0, prepareShare: async () => ({ ...prepared, url: `blob:${++shareModule.shared}` }), systemShare: async () => 'unavailable', copyText: async () => over.copy ?? true }
  const deps: GrowthDeps = {
    fetchJson: (async (path: string, options?: FetchOptions) => {
      sent.push({ path, options })
      const answer = over.answer?.(path)
      if (answer instanceof Error) throw answer
      return answer ?? { ok: true }
    }) as GrowthDeps['fetchJson'],
    view: () => view,
    command: async (type) => { commands.push(type) },
    toast: (text) => { toasts.push(text) },
    open: (id) => { opened.push(id) },
    now: () => clock.now,
    storage: { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } },
    deviceToken: () => 'device-token-0000000',
    loadShare: async () => shareModule,
    origin: () => 'https://allworld.example',
    revokeUrl: (url) => { revoked.push(url) },
    onSessionChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { growth: createGrowth(deps), sent, toasts, opened, commands, revoked, listeners, clock, view, memory }
}

test('hello: asked when a screen is drawn, at most every five minutes, and forced when asked to', async () => {
  const h = harness({ answer: () => helloOk() })
  await h.growth.load()
  await h.growth.load()
  assert.equal(h.sent.length, 1, 'a second draw within five minutes reuses the answer')
  assert.deepEqual(h.sent[0]?.options, { method: 'POST', body: { cityId: 'lagos', device: 'device-token-0000000' } })
  h.clock.now += HELLO_MAX_AGE - 1
  await h.growth.load()
  assert.equal(h.sent.length, 1)
  h.clock.now += 1
  await h.growth.load()
  assert.equal(h.sent.length, 2)
  await h.growth.load({ force: true })
  assert.equal(h.sent.length, 3)
  assert.equal(h.growth.state.hello?.away.hours, 5)
  assert.equal(h.growth.state.error, null)
})

test('hello: not asked while offline or while the life is a guest held for the quick start', async () => {
  for (const over of [{ connected: false }, { required: true }]) {
    const h = harness(over)
    await h.growth.load()
    assert.equal(h.sent.length, 0)
    assert.equal(h.growth.state.hello, null)
  }
})

test('hello: a refusal keeps the reason, a transport failure says nothing changed, and a gift refreshes the missions', async () => {
  const refused = harness({ answer: () => ({ ok: false, code: 'not_ready', reason: 'Not ready yet.' }) })
  await refused.growth.load()
  assert.equal(refused.growth.state.error, 'Not ready yet.')
  assert.equal(refused.growth.state.hello, null)
  const down = harness({ answer: () => Object.assign(new Error('x'), {}) })
  await down.growth.load()
  assert.match(down.growth.state.error ?? '', /could not be reached/)
  const gift = harness({ answer: () => helloOk({ state: {} as never }) })
  await gift.growth.load()
  assert.deepEqual(gift.commands, ['missions.refresh'])
})

test('call: never throws; a failure is { ok: false, code, reason }', async () => {
  assert.deepEqual(failureOf({ status: 429 }), { ok: false, code: 'network', transport: false, reason: 'Too many requests. Wait a minute and try again.' })
  assert.match(failureOf({ status: 401 }).reason, /session expired/)
  assert.deepEqual(failureOf(new Error('offline')), { ok: false, code: 'network', transport: true, reason: 'The server could not be reached. Nothing was changed; try again.' })
  assert.equal(failureOf({ code: 'x', reason: 'Because.' }).reason, 'Because.')
  const h = harness({ answer: () => Object.assign(new Error('boom'), { status: 500, code: 'storage_unavailable', reason: 'Full.' }) })
  const result = await h.growth.call('/api/growth/consent', { age: 'adult' })
  assert.deepEqual(result, { ok: false, code: 'storage_unavailable', transport: false, reason: 'Full.' })
  await h.growth.call('/api/growth/push/key')
  assert.equal(h.sent[1]?.options, undefined, 'no body is a GET')
})

test('share: makes the link, prepares the card, opens the sheet, and replaces the old picture', async () => {
  const h = harness({ answer: (path) => (path === '/api/growth/share' ? { ok: true, code: 'shared', share: { code: 'abc', path: '/s/abc', facts: { kind: 'invite' } } } : { ok: true }) })
  const events: string[] = []
  const heard = (event: Event): void => { events.push((event as CustomEvent<{ name: string }>).detail.name) }
  const win = new EventTarget()
  Object.assign(globalThis, { window: win })
  win.addEventListener('jaw:track', heard)
  const first = h.growth.share('invite')
  assert.equal(h.growth.state.busy, 'invite', 'the pressed button says it is working')
  await first
  assert.equal(h.growth.state.busy, null)
  assert.equal(h.growth.state.sharing?.prepared.url, 'blob:1')
  assert.deepEqual(h.opened, ['share-sheet'])
  assert.deepEqual(h.sent[0]?.options, { method: 'POST', body: { cityId: 'lagos', kind: 'invite' } })
  assert.deepEqual(events, ['share_card_created', 'share_opened', 'invite_created'])
  await h.growth.share('event', { event: 'owambe' })
  assert.deepEqual(h.revoked, ['blob:1'], 'the earlier picture is released')
  assert.deepEqual(h.sent[1]?.options?.body, { cityId: 'lagos', kind: 'event', event: 'owambe' })
  assert.deepEqual(events.slice(3), ['share_card_created', 'share_opened'], 'an event share is not an invitation')
  Reflect.deleteProperty(globalThis, 'window')
})

test('share: one at a time, a refusal toasts its reason, and offline says why', async () => {
  const refused = harness({ answer: () => ({ ok: false, code: 'share_limit', reason: 'No more shares today.' }) })
  await refused.growth.share('week')
  assert.deepEqual(refused.toasts, ['No more shares today.'])
  assert.equal(refused.growth.state.busy, null)
  assert.deepEqual(refused.opened, [])
  const offline = harness({ connected: false })
  await offline.growth.share('week')
  assert.deepEqual(offline.toasts, ['Sharing needs a connection to the server.'])
  assert.equal(offline.sent.length, 0)
  const slow = harness({ answer: () => ({ ok: true, code: 'shared', share: { code: 'abc', path: '/s/abc', facts: {} } }) })
  const one = slow.growth.share('invite')
  await slow.growth.share('house')
  await one
  assert.equal(slow.sent.length, 1, 'a second press while one is on its way is ignored')
})

test('share sheet buttons: a browser without a share sheet is told, and copy says what happened', async () => {
  const h = harness({ answer: (path) => (path === '/api/growth/share' ? { ok: true, code: 'shared', share: { code: 'abc', path: '/s/abc', facts: {} } } : { ok: true }) })
  await h.growth.shareNow()
  assert.equal(h.sent.length, 0, 'nothing is shared before something is prepared')
  await h.growth.share('invite')
  await h.growth.shareNow()
  assert.deepEqual(h.sent.at(-1), { path: '/api/growth/client', options: { method: 'POST', body: { cityId: 'lagos', signals: ['share-fallback'] } } })
  assert.match(h.toasts.at(-1) ?? '', /no share sheet/)
  await h.growth.copyShare()
  assert.equal(h.toasts.at(-1), 'Copied. Paste it into any chat.')
})

test('a refused copy is reported to the sheet, not toasted as a failure', async () => {
  const h = harness({ copy: false, answer: (path) => (path === '/api/growth/share' ? { ok: true, code: 'shared', share: { code: 'abc', path: '/s/abc', facts: {} } } : { ok: true }) })
  await h.growth.share('invite')
  const before = h.toasts.length
  assert.equal(await h.growth.copyLink(), false)
  assert.equal(await h.growth.copyShare(), false)
  assert.equal(h.toasts.length, before, 'no bare "Could not copy"')
})

test('a session change drops everything loaded and releases the picture', async () => {
  const h = harness({ answer: (path) => (path === '/api/growth/share' ? { ok: true, code: 'shared', share: { code: 'abc', path: '/s/abc', facts: {} } } : helloOk()) })
  await h.growth.load()
  await h.growth.share('invite')
  for (const listener of h.listeners) listener()
  assert.deepEqual(h.revoked, ['blob:1'])
  assert.equal(h.growth.state.hello, null)
  assert.equal(h.growth.state.sharing, null)
  assert.equal(h.growth.state.at, 0)
  assert.equal(h.growth.state.busy, null)
})

test('the away card is dismissed for one hello and comes back with the next', async () => {
  const h = harness({ answer: () => helloOk({ away: { hours: 5, since: 111 } }) })
  assert.equal(h.growth.awayDismissed.value, false, 'nothing loaded: nothing dismissed')
  await h.growth.load()
  assert.equal(h.growth.awayDismissed.value, false)
  h.growth.dismissAway()
  assert.equal(h.growth.awayDismissed.value, true)
  assert.equal(h.memory.get('allworld-away'), '111')
  h.clock.now += HELLO_MAX_AGE
  await h.growth.load({ force: true })
  assert.equal(h.growth.awayDismissed.value, true, 'the same hello time stays dismissed')
})

test('channel: only an https link is ever drawn', () => {
  assert.equal(channelHref('https://whatsapp.com/channel/abc'), 'https://whatsapp.com/channel/abc')
  for (const bad of ['http://x', 'javascript:alert(1)', '', null, undefined, 3]) assert.equal(channelHref(bad), '')
})

test('hello events: an e-mail confirmed and a referral reward are reported once', () => {
  const confirmed = helloOk({ contact: { channel: '', email: { address: 'a***@x.com', confirmed: true, preview: null }, push: { devices: 0 }, live: { email: false }, comeback: { source: 'contact', on: true, pausedUntil: 0, types: { needs: true, friends: true, milestones: true, events: true, away: true, week: true }, nudged: {} } } })
  assert.deepEqual(helloEvents(confirmed, helloOk()), ['email_optin_confirmed'])
  assert.deepEqual(helloEvents(confirmed, null), [], 'the first hello reports nothing')
  const paid = (total: number) => helloOk({ referral: referral({ paid: { paidTotal: total } as never }) })
  assert.deepEqual(helloEvents(paid(2), paid(1)), ['referral_rewarded'])
  assert.deepEqual(helloEvents(paid(1), paid(1)), [])
})

test('track and announceAge are decoupled events', () => {
  const win = new EventTarget()
  Object.assign(globalThis, { window: win })
  const heard: unknown[] = []
  win.addEventListener('jaw:track', (event) => heard.push((event as CustomEvent).detail))
  win.addEventListener('jaw:age', (event) => heard.push((event as CustomEvent).detail))
  track('x', { kind: 'a' })
  announceAge('minor'); announceAge('adult'); announceAge('child'); announceAge(undefined)
  Reflect.deleteProperty(globalThis, 'window')
  assert.deepEqual(heard, [{ name: 'x', props: { kind: 'a' } }, { age: 'minor' }, { age: 'adult' }])
})

test('small rules: stale hello, readiness, invitations, time words', () => {
  assert.equal(helloStale(0, 5), true)
  assert.equal(helloStale(100, 100 + HELLO_MAX_AGE - 1), false)
  assert.equal(helloStale(100, 100 + HELLO_MAX_AGE), true)
  assert.equal(growthReady({ connected: true }), true)
  assert.equal(growthReady({ connected: true, onboarding: { required: true } }), false)
  assert.equal(growthReady({ connected: false }), false)
  assert.deepEqual((['invite', 'house', 'table', 'missions', 'week', 'event'] as const).map(isInvite), [true, true, true, false, false, false])
  assert.equal(until(0, 0), '0m')
  assert.equal(until(61 * 60000, 0), '1h 1m')
  assert.equal(until(3000 * 60000, 0), '2d 2h')
  assert.equal(until(30 * 60000 - 1, 0), '30m')
  assert.match(span(Date.UTC(2026, 0, 9, 19), Date.UTC(2026, 0, 10, 1)), /^Fri,? 8:00 pm – 2:00 am$/i)
})

// ---- Missions --------------------------------------------------------------------------------

test('Missions: a mission has the controls its state allows', () => {
  assert.deepEqual(missionAction(mission({ claimed: true, done: true }), 'daily', 1), { kind: 'collected' })
  assert.deepEqual(missionAction(mission({ done: true }), 'daily', 1), { kind: 'collect' })
  assert.deepEqual(missionAction(mission({ go: ['market'] as never }), 'daily', 1), { kind: 'go', go: true, swap: true })
  assert.deepEqual(missionAction(mission({ open: 'jobs' }), 'weekly', 1), { kind: 'go', go: true, swap: false }, 'weekly missions cannot be swapped')
  assert.deepEqual(missionAction(mission(), 'daily', 0), { kind: 'go', go: false, swap: false })
  assert.equal(missionHint(mission(), money), 'Have a meal · ₦250')
  assert.equal(missionHint(mission({ done: true }), money), 'Done · ₦250 to collect')
  assert.equal(missionHint(mission({ done: true, claimed: true }), money), 'Done')
  assert.equal(showsProgress(mission()), false)
  assert.equal(showsProgress(mission({ count: 3 })), true)
  assert.equal(showsProgress(mission({ done: true })), true)
  assert.equal(missionPercent(mission({ n: 1, count: 3 })), 33)
  assert.equal(missionIcon(mission({ done: true })), 'good')
  assert.deepEqual([missionIcon(mission({ kind: 'life' })), missionIcon(mission({ kind: 'discovery' })), missionIcon(mission({ kind: 'social' }))], ['home', 'compass', 'people'])
})

test('Missions: badge, notification, set lines and the stamp card', () => {
  assert.equal(missionsBadge({ missions: { claimable: 2 } }), 2)
  assert.equal(missionsBadge({}), 0)
  const m = { claimable: 1, day: 5 }
  assert.deepEqual(missionsNotifications({ connected: true, now: 9, missions: m }), [{ id: 'missions:5:1', at: 9, fresh: true, app: 'missions', text: '1 finished mission to collect' }])
  assert.equal(missionsNotifications({ connected: true, now: 9, missions: { claimable: 3, day: 5 } })[0]?.text, '3 finished missions to collect')
  assert.deepEqual(missionsNotifications({ connected: false, now: 9, missions: m }), [])
  const set = (over: Partial<MissionSet>): MissionSet => ({ done: 0, claimed: 0, total: 3, stars: 10, granted: false, ...over })
  assert.equal(setLine(set({}), 'today'), 'Collect all 3 today for +10 stars')
  assert.equal(setLine(set({ granted: true }), 'today'), 'All 3 collected · +10 stars earned')
  assert.equal(setLine(set({ total: 0 }), 'today'), '')
  assert.deepEqual(stampCells({ days: 2, need: 4 }), ['stamped', 'stamped', 'empty', 'goal', 'empty', 'empty', 'empty'])
  assert.equal(stampsNote({ days: 4, need: 4, stars: 5, paid: true }), 'Stamp card complete: +5 stars earned.')
  assert.match(stampsNote({ days: 1, need: 4, stars: 5, paid: false }), /^Play on any 4 days this week for \+5 stars/)
  assert.equal(daysTail({ activeDays: 1, title: null, nextTitle: null }, 'Lagos'), 'day in Lagos')
  assert.equal(daysTail({ activeDays: 9, title: 'Local', nextTitle: { days: 14, label: 'Regular' } as never }, 'Lagos'), 'days in Lagos · Local · next title at 14 days: Regular')
})

// ---- Events ----------------------------------------------------------------------------------

const occurrence = (over: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({ id: 'owambe', key: 'owambe:1', title: 'Owambe', blurb: 'Party.', venue: 'club', venueLabel: 'The Club', icon: 'x', start: Date.UTC(2026, 0, 9, 19), end: Date.UTC(2026, 0, 10, 1), live: false, spray: true, table: null, ...over })

test('Events: the badge counts unattended live events and the notification lines name them', () => {
  assert.equal(eventsBadge({ events: { live: [{ id: 'a', key: 'k1', venue: 'club', attended: true }] } as never }), 0)
  assert.equal(eventsBadge({ events: { live: [{ id: 'a', key: 'k1', venue: 'club', attended: false }] } as never }), 1)
  assert.equal(eventsBadge({}), 0)
  const live = occurrence({ live: true })
  const lines = eventsNotifications({ connected: true, events: { live: [{ key: 'owambe:1', attended: false }] } as never }, [live, occurrence({ key: 'later' })])
  assert.deepEqual(lines, [{ id: 'event:owambe:1', at: live.start, fresh: true, app: 'events', text: 'On now: Owambe at The Club' }])
  assert.equal(eventsNotifications({ connected: true, events: { live: [{ key: 'owambe:1', attended: true }] } as never }, [live])[0]?.fresh, false)
  assert.deepEqual(eventsNotifications({ connected: false }, [live]), [])
})

test('Events: when, presence, the empty state and why a spray amount is refused', () => {
  const now = Date.UTC(2026, 0, 9, 18)
  assert.match(whenLine(occurrence(), now), /· The Club · starts in 1h 0m$/)
  assert.match(whenLine(occurrence({ live: true }), Date.UTC(2026, 0, 9, 20)), /· ends in 5h 0m$/)
  assert.equal(presenceNote(true, true, true), 'You were there.')
  assert.equal(presenceNote(false, true, true), 'You are here: finish any activity to count as there.')
  assert.equal(presenceNote(false, false, true), '')
  assert.equal(nothingOn([]), 'Check back soon.')
  assert.match(nothingOn([occurrence()]), /^Next: Owambe, Fri,? 8:00 pm/i)
  assert.equal(sprayReason(1000, 500, 5000, money), 'Only ₦500 left to spray today.')
  assert.equal(sprayReason(1000, 5000, 200, money), 'You do not have ₦1,000.')
  assert.equal(sprayReason(1000, 5000, 5000, money), null)
})

// ---- Bring a friend --------------------------------------------------------------------------

test('Bring a friend: figures, titles, rewards and the friends list words', () => {
  assert.equal(referBadge(referral({ owed: 2 })), 2)
  assert.equal(referBadge(null), 0)
  assert.equal(heroFigure(1), '1 friend playing because of you')
  assert.equal(heroFigure(3), '3 friends playing because of you')
  assert.equal(heroNote(referral({ title: 'Connector', nextTitle: { id: 'x', count: 5, label: 'Host' }, counted: 3 })), 'Your title: Connector. 2 more for “Host”.')
  assert.equal(heroNote(referral()), '')
  assert.equal(friendState({ state: 'joined' }), 'Made a Sim · has not worked two days yet')
  assert.equal(friendState({ state: 'counted' }), 'Playing · counted')
  assert.equal(waitingLine(null), 'Loading your invites…')
  assert.equal(waitingLine('Not ready yet.'), 'Not ready yet.')
  const rules = referral().rules
  assert.match(byLine({ id: 'p', name: 'Ada', welcomed: false, counted: false }, rules, money), /^Finish a paid shift or gig and ₦500 is yours\. Work on 2 different days and Ada is rewarded too\.$/)
  assert.match(byLine({ id: 'p', name: 'Ada', welcomed: true, counted: true }, rules, money), /^Your ₦500 welcome gift has been paid\. Ada has been thanked\.$/)
  assert.equal(paidLine({ paidThisWeek: 1, perWeek: 3, paidTotal: 4, lifetime: 20 } as never, 2), 'Rewards paid: 1 of 3 this week, 4 of 20 for life. 2 waiting for next week. After that friends still count for your titles.')
  assert.equal(referRules(rules).length, 4)
})

// ---- Stay in touch ---------------------------------------------------------------------------

test('Stay in touch: the age question comes first and under 18 is offered nothing outside the game', () => {
  assert.equal(ageCard(null), 'ask')
  assert.equal(ageCard(consent({ age: 'minor' })), 'minor')
  assert.equal(ageCard(consent()), 'none')
  assert.equal(showsChannels(null), false)
  assert.equal(showsChannels(consent({ age: 'minor' })), false)
  assert.equal(showsChannels(consent()), true)
})

test('Stay in touch: the notification card and the e-mail card follow what is true', () => {
  assert.equal(pushCard(consent({ push: true }), 'blocked', true), 'on')
  assert.equal(pushCard(consent(), 'needs-install', false), 'needs-install')
  assert.equal(pushCard(consent(), 'unsupported', false), 'unsupported')
  assert.equal(pushCard(consent(), 'blocked', false), 'blocked')
  assert.equal(pushCard(consent(), 'ready', false), 'intro')
  assert.equal(pushCard(consent(), null, false), 'intro')
  assert.equal(pushCard(consent(), 'ready', true), 'ask')
  assert.match(devicesLine(1), /^1 phone or browser\. At most one a day/)
  assert.match(devicesLine(2), /^2 phones or browsers\./)
  assert.equal(emailCard(null), 'form')
  assert.equal(emailCard({ address: 'a', confirmed: false, preview: null }), 'confirm')
  assert.equal(emailCard({ address: 'a', confirmed: true, preview: null }), 'on')
  assert.match(pushDeclinedWords('blocked'), /blocked/)
  assert.equal(pushDeclinedWords('declined'), 'No problem. Nothing was switched on.')
  assert.match(pushDeclinedWords('failed'), /could not be switched on/)
})

test('Stay in touch: the confirmation button says why it cannot be pressed', () => {
  assert.equal(emailDisabled({ busy: false, tick: true, email: 'a@b.co' }), false)
  assert.equal(emailDisabled({ busy: true, tick: true, email: 'a@b.co' }), true)
  assert.equal(emailReason({ busy: false, tick: true, email: '' }), 'Enter your e-mail address first.')
  assert.equal(emailReason({ busy: false, tick: false, email: 'a@b.co' }), 'Tick the box to agree first.')
  assert.equal(emailReason({ busy: false, tick: true, email: 'a@b.co' }), null)
  assert.equal(emailReason({ busy: true, tick: false, email: '' }), null, 'while sending, the button says "Sending…" instead')
})

// ---- the away card and the inbox chip --------------------------------------------------------

const line = (over: Partial<PhoneNotification> = {}): PhoneNotification => ({ id: 'chat:1', at: 1, text: 'Ada: hi', fresh: true, app: 'messages', ...over })
const baseView = { connected: true, cityId: 'lagos', now: Date.UTC(2026, 0, 5, 9), onboarding: { required: false }, missions: null }

test('away card: shown for a settled, connected player back after hours with something fresh', () => {
  const card = awayCardFor(baseView, helloOk(), false, [line()])
  assert.equal(card?.title, 'While you were away')
  assert.deepEqual(card?.lines.map((item) => item.text), ['Ada: hi'])
  assert.equal(awayCardFor(baseView, helloOk(), true, [line()]), null, 'dismissed')
  assert.equal(awayCardFor(baseView, null, false, [line()]), null, 'no hello yet')
  assert.equal(awayCardFor({ ...baseView, connected: false }, helloOk(), false, [line()]), null)
  assert.equal(awayCardFor({ ...baseView, onboarding: { required: true } }, helloOk(), false, [line()]), null)
  assert.equal(awayCardFor(baseView, helloOk(), false, [line({ fresh: false })]), null, 'only fresh lines count')
  assert.equal(awayCardFor(baseView, helloOk({ away: { hours: 1, since: 1 } }), false, [line()]), null, 'under three hours')
  assert.equal(awayWanted({ connected: true, onboarding: { required: false, guest: false } }), true)
  assert.equal(awayWanted({ connected: true, onboarding: { required: false, guest: true } }), false)
  assert.equal(awayWanted({ connected: false }), false)
})

test('inbox chip: offline, a knock, hidden for a guest, loading, retry, counts', () => {
  const me = (knocks: { from: { id: string; name: string } }[] = [], requests = 0) => ({ house: { knocks }, requests: { in: new Array<unknown>(requests).fill({}) } }) as never
  const base = { connected: true, onboardingRequired: false, me: me(), error: null, unreadChats: 0, unreadUpdates: 0, freshNotices: 0, short: '' }
  assert.deepEqual(inboxChip({ ...base, connected: false, short: 'No internet' }), { kind: 'offline', short: 'No internet' })
  assert.deepEqual(inboxChip({ ...base, connected: false }), { kind: 'offline', short: 'Not connected' })
  assert.deepEqual(inboxChip({ ...base, me: me([{ from: { id: 'a', name: 'Ada' } }]) }), { kind: 'knock', name: 'Ada' })
  assert.deepEqual(inboxChip({ ...base, onboardingRequired: true }), { kind: 'hidden' })
  assert.deepEqual(inboxChip({ ...base, me: null }), { kind: 'inbox', active: false, hint: 'Loading…' })
  assert.deepEqual(inboxChip({ ...base, me: null, error: 'x' }), { kind: 'inbox', active: false, hint: 'Could not load · tap to retry' })
  assert.deepEqual(inboxChip(base), { kind: 'inbox', active: false, hint: 'No new messages' })
  assert.deepEqual(inboxChip({ ...base, unreadChats: 2, unreadUpdates: 1, me: me([], 1), freshNotices: 1 }), { kind: 'inbox', active: true, hint: '2 unread · 3 updates' })
  assert.deepEqual(inboxChip({ ...base, unreadUpdates: 1 }), { kind: 'inbox', active: true, hint: '1 update' })
  assert.equal(inboxSlot(true, me([{ from: { id: 'a', name: 'Ada' } }])), 'alert')
  assert.equal(inboxSlot(true, me()), 'hud')
  assert.equal(inboxSlot(false, me([{ from: { id: 'a', name: 'Ada' } }])), 'hud')
  assert.equal(inboxSlot(true, null), 'hud')
})
