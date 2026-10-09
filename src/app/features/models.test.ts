import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await preloadCityContent('lagos');
// The logic behind the converted screens, without a browser: what the HUD says for each
// connection state, what an activity card shows, the Bank's badge, the Messages counts and
// notification lines, the panel registry and the Phone's home screen, and the Report a
// problem form end to end against a fake server.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { LifeState } from '../../types/life.ts'
import type { SocialOverview } from '../../types/social.ts'
import type { ActivityCard, LoanCard } from '../../types/view.ts'
import type { PanelMeta, PanelView } from '../types/panel.ts'
import { LINK_STATES } from '../types/client.ts'
import { createGame } from '../state/game.ts'
import { buildRegistry, definePanel } from '../state/panels.ts'
import { createFakeServer, memoryStorage } from '../testing/fakeServer.ts'
import { cap, hueOf, initialOf, money, plural, signedMoney } from '../ui/format.ts'
import { billsDue } from './bank/bankModel.ts'
import { billsLine, loanReasons, loanRule, rentStanding } from './bank/bankLines.ts'
import { LINKS, cashDelta, hudNotice, linkWording, moodOf, needFlash, savedPill } from './hud/hudModel.ts'
import { createNoticeMarks, messagesBadge, notificationLines, unreadChats, unreadUpdates, updatesCount } from './messages/messagesModel.ts'
import { lastLine, partnerOf, readOnlyReason, targetOf, threadTitle, updateLines } from './messages/messagesThread.ts'
import { DOCK, badgeText, battery, dockApps, listedApps, notificationsOf, phonePages } from './phone/phoneModel.ts'
import { createSupport, sendFailure, statusTone, textProblem } from './support/supportModel.ts'
import { activityFace, effectTags } from './venue/venueModel.ts'

async function connected() {
  const server = createFakeServer()
  const game = createGame({ fetch: server.fetch, storage: memoryStorage(), now: () => server.now(), setTimeout: () => 0, clearTimeout: () => {}, toast: () => {} })
  await game.connect()
  return { server, game, state: game.state.value, view: game.view.value }
}

test('format: naira, signed amounts, plurals and avatar marks', () => {
  assert.equal(money(96000), '₦96,000')
  assert.equal(money('not a number'), '₦0')
  assert.deepEqual([signedMoney(1200), signedMoney(-300)], ['+₦1,200', '−₦300'])
  assert.deepEqual([plural(1, 'item'), plural(3, 'item'), cap('hunger'), cap('')], ['1 item', '3 items', 'Hunger', ''])
  assert.deepEqual([initialOf(' ada'), initialOf(''), initialOf(null)], ['A', '?', '?'])
  assert.equal(hueOf('pub-ada'), hueOf('pub-ada'))
  assert.ok(hueOf('pub-ada') >= 0 && hueOf('pub-ada') < 360)
})

test('HUD: each connection state has its own truthful wording', async () => {
  const { view } = await connected()
  assert.equal(linkWording(view), null, 'connected has no notice')
  assert.deepEqual(savedPill(view, 0), { kind: 'status', tone: 'ok', icon: 'good', text: 'Saved', title: view.net.text })
  assert.equal(savedPill(view, 1).text, 'Saving…')
  assert.equal(savedPill({ ...view, storage: { reason: 'Disk full.' } }, 0).text, 'Not saving')
  assert.equal(hudNotice({ ...view, storage: { reason: 'Disk full.' } })?.storage, true)
  for (const link of LINK_STATES) {
    if (link === 'online') continue
    const down = { ...view, connected: false, link }
    assert.equal(linkWording(down), LINKS[link])
    const pill = savedPill(down, 0)
    if (link === 'connecting') assert.equal(pill.kind, 'status'); else assert.equal(pill.kind, 'button', `${link}: the pill is the way out`)
    // "No internet" is said only when this device has no network.
    assert.equal(/internet|offline/i.test(`${LINKS[link].pill} ${LINKS[link].notice?.title ?? ''}`), link === 'offline')
  }
  assert.deepEqual(hudNotice({ ...view, connected: false, link: 'expired' })?.actions.map((action) => action.run), ['new-life', 'reconnect'])
  assert.deepEqual(hudNotice({ ...view, connected: false, link: 'recovery' })?.actions.map((action) => action.run), ['support', 'reconnect'])
  assert.equal(hudNotice({ ...view, connected: false, link: 'connecting' }), null)
})

test('HUD: mood, wallet delta and need highlights', async () => {
  const { view } = await connected()
  assert.equal(moodOf(view).word, view.onboarding.mood.word, 'the character system\'s five words win')
  const core = moodOf({ needs: { ...view.needs, mood: { score: 20, label: 'Miserable', icon: '😫' } }, onboarding: { ...view.onboarding, mood: { word: '', tone: 'good', icon: '', score: 0 } } })
  assert.deepEqual([core.word, core.tone], ['Miserable', 'bad'])
  assert.equal(cashDelta(-300, { amount: -300, reason: 'Danfo to Lekki' }, money), '−₦300 · Danfo to Lekki')
  assert.equal(cashDelta(500, { amount: 200, reason: 'Other' }, money), '+₦500', 'the reason is shown only when the newest line is this change')
  assert.deepEqual([needFlash(undefined, 50), needFlash(50, 51), needFlash(50, 49), needFlash(50, 47)], [null, 'up', null, 'down'])
})

test('venue: an activity card says its price, what it gives, and the one reason it cannot start', async () => {
  const { game, state, view } = await connected()
  await game.command('spot', { id: 'kitchen' })
  const cards = game.view.value.activities.cards
  assert.ok(cards.length > 0)
  for (const card of cards) {
    const face = activityFace(card, game.state.value, true)
    assert.equal(face.disabled, Boolean(card.blocked))
    assert.equal(Boolean(face.why), Boolean(card.blocked), `${card.id}: a blocked card names why, an open one does not`)
    assert.ok(face.label.startsWith(`${card.label}, ${card.duration} seconds, `))
    assert.equal(activityFace(card, game.state.value, false).disabled, true, 'offline nothing starts')
  }
  const open = cards.find((card) => !card.blocked)
  assert.ok(open)
  assert.equal(activityFace(open, game.state.value, false).why, 'Not connected — cannot start now')
  const busy = activityFace(open, { ...state, activeAction: { kind: 'activity', id: 'x', duration: 5, remaining: 5 } as LifeState['activeAction'] }, true)
  assert.deepEqual([busy.state, busy.why, busy.full], ['busy', '', 'Finish or cancel what you are doing first'])
  const paid: ActivityCard = { ...open, reward: 1500, cost: 0, effects: { energy: -10, fun: 5 }, xp: { cooking: 50 }, beta: true }
  assert.deepEqual([activityFace(paid, state, true).price, activityFace(paid, state, true).priceTone], ['+₦1,500', 'earn'])
  assert.deepEqual(effectTags(paid), [{ text: '−10 Energy', cost: true }, { text: '+5 Fun' }, { text: '+50 Cooking XP' }, { text: 'Beta', beta: true }])
  void view
})

test('bank: badge, rent standing and the reasons a payment is unavailable', async () => {
  const { state, view } = await connected()
  assert.equal(billsDue(state, view), 0, 'a new life owes nothing yet')
  const loan: LoanCard = { principal: 60000, total: 72000, weekly: 12000, left: 72000, fees: 0, paid: 0, progress: 0, cleared: false, prepaid: 0, instalment: 12000, weeksLeft: 6, nextDue: 0, nextDueLabel: 'Sat 10 Jan', nextCollection: '', weekBlocked: null, allBlocked: null, rule: '' }
  assert.equal(billsDue(state, { economy: { ...view.economy, loan } }), 0, 'an instalment the balance covers is not a warning')
  assert.equal(billsDue(state, { economy: { ...view.economy, loan: { ...loan, weekBlocked: 'You need ₦12,000.' } } }), 1)
  assert.equal(billsDue(state, { economy: { ...view.economy, loan: { ...loan, weekBlocked: 'x', prepaid: 1 } } }), 0, 'a prepaid week is not due')
  assert.deepEqual(rentStanding({ arrears: 6000, warning: 'x' }), { tone: 'bad', label: 'Overdue' })
  assert.deepEqual(rentStanding({ arrears: 0, warning: 'x' }), { tone: 'warn', label: 'At risk' })
  assert.deepEqual(rentStanding({ arrears: 0, warning: null }), { tone: 'good', label: 'Up to date' })
  assert.deepEqual(loanReasons({ weekBlocked: 'a', allBlocked: 'a' }, null), ['a'], 'the same reason is said once')
  assert.deepEqual(loanReasons({ weekBlocked: 'a', allBlocked: 'b' }, 'Offline'), ['Offline'])
  assert.deepEqual(loanRule('₦12,000 is collected every Saturday after rent. A missed week stays owed and adds a ₦500 fee (at most 4 times).'), { penalty: 'A missed week stays owed and adds a ₦500 fee (at most 4 times).', rest: ['₦12,000 is collected every Saturday after rent.'] }, 'the penalty stays on the card')
  assert.deepEqual(billsLine({ weeklyBills: 0 }, { employed: false }), { due: false, tail: '' })
  assert.deepEqual(billsLine({ weeklyBills: 18000 }, { employed: false, weeklyPay: 0 }), { due: true, tail: 'no-job' })
})

const player = (id: string, name: string) => ({ id, name })
function overview(): SocialOverview {
  const me = player('me', 'Kunle'), ada = player('ada', 'Ada'), bola = player('bola', 'Bola')
  return {
    ok: true, code: 'ok', me: { ...me, since: 1 }, friends: [], bae: null, blocked: [], reports: [], invitePath: '/v/me', visiting: null, door: { who: 'knock', out: false, chosen: true }, invites: [],
    requests: { in: [{ ...bola, at: 5 }], out: [] }, baeRequests: [],
    conversations: [
      { id: 'dm.ada.me', kind: 'dm', name: 'Ada', members: [me, ada], owner: null, with: 'ada', unread: 2, last: { seq: 3, from: ada, body: 'How far?', at: 900 } },
      { id: 'g.1', kind: 'group', name: 'Yaba crew', members: [me, ada, bola], owner: 'me', with: null, unread: 0, last: { seq: 1, from: me, body: 'Hello', at: 800 } },
    ],
    updates: [
      { id: 1, kind: 'transfer', text: 'Ada sent you ₦500', at: 700, read: false },
      { id: 2, kind: 'transfer', text: 'Ada sent you ₦200', at: 700, read: true },
      { id: 3, kind: 'friend-request', text: 'Bola wants to be friends', at: 600, read: false },
    ],
    house: { host: me, capacity: 4, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks: [{ from: ada, at: 950, expiresAt: 9999 }] },
    prefs: { groups: 'friends', mentions: 'on', pictures: 'friends', introductions: 'off', notify: { text: true, groups: 'mentions', pausedUntil: null, quietDm: false, quietGroups: true } },
    limits: { body: 500, groupSize: 8, groupName: 30, guests: 4, reportText: 300, reasons: ['spam'], pins: 3, mentions: 5, pictures: { on: true, bytes: 250000, caption: 200 } },
  }
}

test('messages: unread counts, the badge and the notification lines', () => {
  const me = overview()
  const notices = [{ id: 1, kind: 'rent-due', text: 'Rent is due Saturday', at: 400 }, { id: 2, kind: 'gov', text: 'New Governor', at: 990 }]
  assert.equal(unreadChats(me), 2)
  assert.equal(unreadUpdates(me), 1, 'a waiting friend request is counted as a request, not again as an update')
  assert.equal(messagesBadge(me, true, 1), 4)
  assert.equal(messagesBadge(me, false, 1), 0, 'not connected: no badge')
  assert.equal(messagesBadge(null, true, 1), 0)
  assert.equal(updatesCount(me, 1), 3)
  const lines = notificationLines(me, { connected: true, now: 1000, notices, seen: 500 })
  assert.deepEqual(lines.map((line) => [line.id, line.app, line.fresh]), [
    ['knock:ada', 'invite', true], ['friend:bola', 'people', true], ['chat:dm.ada.me', 'messages', true],
    ['update:1', 'statement', true], ['update:2', 'statement', false], ['notice:1', 'bank', false], ['notice:2', 'governor', true],
  ])
  assert.equal(new Set(lines.map((line) => line.id)).size, lines.length, 'two updates of one kind in the same millisecond keep separate keys')
  assert.deepEqual(lines.find((line) => line.id === 'chat:dm.ada.me')?.params, { conv: 'dm.ada.me' })
  assert.deepEqual(notificationLines(me, { connected: false, now: 1000, seen: 0 }), [])
  assert.deepEqual(updateLines(me.updates, notices, 500).map((line) => [line.text, line.fresh, `${line.kind}:${line.id}`]), [['New Governor', true, 'notice:gov'], ['Ada sent you ₦500', true, 'update:transfer'], ['Ada sent you ₦200', false, 'update:transfer'], ['Bola wants to be friends', true, 'update:friend-request'], ['Rent is due Saturday', false, 'notice:rent-due']])
})

test('messages: thread wording, where a message goes, and when it cannot be written', () => {
  const me = overview()
  const [dm, group] = me.conversations
  assert.ok(dm && group)
  assert.deepEqual([lastLine(dm, 'me'), lastLine(group, 'me'), lastLine({ ...dm, last: null }, 'me')], ['Ada: How far?', 'You: Hello', 'No messages yet'])
  assert.deepEqual([targetOf('to:ada'), targetOf('dm.ada.me')], [{ to: 'ada' }, { conv: 'dm.ada.me' }])
  // The other player of a direct chat is known before its first message, so the header's controls are there from the start; a group and a house chat have none.
  assert.deepEqual([partnerOf('to:ada', null), partnerOf('dm.ada.me', dm), partnerOf('g.1', group), partnerOf('h.ada', null), partnerOf(null, null)], ['ada', dm.with, null, null, null])
  assert.deepEqual([threadTitle('to:ada', null, 'Ada'), threadTitle('to:x', null, null), threadTitle('h.ada', null, null), threadTitle('g.1', group, 'ignored')], ['Ada', 'New chat', 'House chat', 'Yaba crew'])
  assert.equal(readOnlyReason('dm.ada.me', me, null), null)
  assert.equal(readOnlyReason('dm.ada.me', me, 'This device has no internet connection.'), 'This device has no internet connection.', 'the connection\'s own words')
  assert.match(readOnlyReason('h.ada', me, null) ?? '', /visit has ended/)
  assert.equal(readOnlyReason('h.me', me, null), null, 'the host can always write in their own house chat')
})

test('messages: read marks belong to an actor and city, including A to B to A and reload', () => {
  const storage = memoryStorage(), marks = createNoticeMarks(storage)
  const notices = [{ id: 1, kind: 'rent', text: 'a', at: 100 }, { id: 2, kind: 'loan', text: 'b', at: 200 }]
  assert.equal(marks.fresh('ada', 'lagos', notices), 2)
  assert.equal(marks.mark('ada', 'lagos', notices), true)
  assert.equal(marks.mark('ada', 'lagos', notices), false, 'nothing new to mark')
  assert.equal(marks.fresh('bola', 'lagos', notices.slice(0, 1)), 1, 'A at 200 cannot hide B at 100')
  assert.equal(marks.mark('bola', 'lagos', notices.slice(0, 1)), true)
  assert.deepEqual([marks.seen('ada', 'lagos'), marks.seen('bola', 'lagos')], [200, 100], 'returning to A preserves both actors')
  assert.deepEqual([marks.fresh('ada', 'lagos', notices), marks.fresh('ada', 'ibadan', notices)], [0, 2])
  assert.equal(marks.mark('ada', 'ibadan', notices.slice(0, 1)), true)
  const restored = createNoticeMarks(storage)
  assert.deepEqual([restored.seen('ada', 'lagos'), restored.seen('ada', 'ibadan'), restored.seen('bola', 'lagos'), restored.seen('bola', 'ibadan')], [200, 100, 100, 0])
  assert.equal(restored.fresh('bola', 'lagos', notices), 1)
})

test('messages: legacy unscoped marks stay untouched and are never assigned to an actor', () => {
  const legacy = JSON.stringify({ lagos: 900 }), storage = memoryStorage({ 'joinallworld-notices-seen': legacy })
  const marks = createNoticeMarks(storage), notices = [{ id: 1, kind: 'rent', text: 'a', at: 100 }]
  assert.deepEqual([marks.seen('ada', 'lagos'), marks.seen('bola', 'lagos')], [0, 0])
  assert.equal(marks.mark('ada', 'lagos', notices), true)
  assert.equal(storage.getItem('joinallworld-notices-seen'), legacy)
  assert.equal(createNoticeMarks(storage).seen('bola', 'lagos'), 0)
  assert.equal(createNoticeMarks(memoryStorage({ 'joinallworld-notices-seen:ada': '[not json' })).seen('ada', 'lagos'), 0)
})

test('messages: no actor has no read marks, no fresh notices and no storage access', () => {
  let accesses = 0
  const marks = createNoticeMarks({ getItem: () => { accesses++; return null }, setItem: () => { accesses++ } })
  const notices = [{ id: 1, kind: 'rent', text: 'a', at: 100 }]
  for (const actor of [null, '']) {
    assert.equal(marks.seen(actor, 'lagos'), 0)
    assert.equal(marks.fresh(actor, 'lagos', notices), 0)
    assert.equal(marks.mark(actor, 'lagos', notices), false)
  }
  assert.equal(accesses, 0)
})

test('messages: storage failures preserve separate actor marks for this visit', () => {
  const unavailable = { getItem: (): string | null => { throw Error('unavailable') }, setItem: (): void => { throw Error('unavailable') } }
  const notices = [{ id: 1, kind: 'rent', text: 'a', at: 100 }, { id: 2, kind: 'loan', text: 'b', at: 200 }]
  for (const storage of [null, unavailable]) {
    const marks = createNoticeMarks(storage)
    assert.equal(marks.mark('ada', 'lagos', notices), true)
    assert.equal(marks.fresh('bola', 'lagos', notices.slice(0, 1)), 1)
    assert.equal(marks.mark('bola', 'lagos', notices.slice(0, 1)), true)
    assert.deepEqual([marks.seen('ada', 'lagos'), marks.seen('bola', 'lagos'), marks.seen('ada', 'ibadan')], [200, 100, 0])
  }
})

const component = { render: () => null }
/** A panel with only its static metadata, as the registry lists it. */
const plain = (id: string, extra: Partial<PanelMeta> = {}) => definePanel({ id, title: id, placement: 'phone', component, ...extra })

test('registry: sorted by order, one id once, shell ids reserved, a known placement', () => {
  const bank = plain('bank', { order: 14, group: 'money' })
  const built = buildRegistry([plain('messages', { order: 12, group: 'people' }), bank, plain('jobs', { order: 10, group: 'money' }), plain('needs', { placement: 'sim-tab', order: 20 }), plain('wallet-tips', { order: 13 })])
  assert.deepEqual(built.map((panel) => panel.id), ['jobs', 'messages', 'wallet-tips', 'bank', 'needs'], 'sorted by order, listing order breaks ties')
  assert.equal(built.find((panel) => panel.id === 'bank'), bank)
  assert.throws(() => buildRegistry([plain('phone')]), /reserved/)
  assert.throws(() => buildRegistry([plain('jobs'), plain('jobs')]), /Duplicate/)
  assert.throws(() => buildRegistry([plain('x', { placement: 'nowhere' as PanelMeta['placement'] })]), /Invalid panel/)
})

test('phone: the home screen lists the panels from their static metadata', async () => {
  const { state, view } = await connected()
  const panels = buildRegistry([
    plain('messages', { order: 12, group: 'people', badge: () => 3 }), plain('jobs', { order: 10, group: 'money' }), plain('ride', { order: 18, group: 'life' }),
    plain('groceries', { order: 16, group: 'life' }), plain('governor', { order: 40, group: 'city', badge: () => 'new!' }), plain('mystery', { order: 99 }),
    plain('career', { placement: 'sim-tab', phone: true, group: 'money', order: 60 }), plain('needs', { placement: 'sim-tab' }), plain('city', { placement: 'modal' }),
    plain('pending-app', { order: 50, group: 'money', badge: () => { throw new Error('not loaded') } }),
    definePanel({ id: 'bank', title: 'Bank', placement: 'phone', order: 14, group: 'money', badge: () => 120, notifications: () => [{ id: 'b', at: 5, text: 'Rent due', fresh: true, app: 'bank' }], component }),
  ])
  assert.deepEqual(listedApps(panels).map((app) => app.id), ['jobs', 'messages', 'bank', 'groceries', 'ride', 'governor', 'pending-app', 'career', 'mystery'], 'Phone apps and Sim tabs marked phone: true')
  assert.deepEqual(dockApps(panels).map((app) => app.id), DOCK)
  const pages = phonePages(panels)
  assert.deepEqual(pages.map((page) => page.groups.map((group) => [group.id, group.apps.map((app) => app.id)])), [
    [['life', ['groceries', 'mystery', 'help']], ['money', ['pending-app', 'career']]],
    [['city', ['governor', 'community']]],
  ], 'docked apps are not repeated; an app without a group lands in the first group; empty groups are left out')
  const view2 = view as PanelView
  const complaints: unknown[] = []
  const logError = console.error
  console.error = (...args: unknown[]) => { complaints.push(args[0]) }
  try {
    assert.deepEqual(['messages', 'bank', 'governor', 'jobs', 'pending-app'].map((id) => badgeText(panels.find((panel) => panel.id === id), state, view2)), ['3', '99+', 'new', '', ''], 'a badge that throws is no badge')
  } finally { console.error = logError }
  assert.deepEqual(complaints, ['Badge of pending-app failed:'], 'and it is reported, once')
  assert.deepEqual(notificationsOf(panels, state, view2).map((line) => line.text), ['Rent due'])
  assert.deepEqual([battery(85), battery(30), battery(10), battery(undefined)], [{ level: 85, tone: '' }, { level: 30, tone: 'is-mid' }, { level: 10, tone: 'is-low' }, { level: 0, tone: 'is-low' }])
})

test('report a problem: validated, filed once, and a retry reuses the same key', async () => {
  const server = createFakeServer()
  const game = createGame({ fetch: server.fetch, storage: memoryStorage(), now: () => server.now(), setTimeout: () => 0, clearTimeout: () => {}, toast: () => {} })
  await game.connect()
  const filed: Record<string, unknown>[] = []
  let failNext = 0
  server.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', reports: filed.map((body, index) => ({ id: `P-${index + 1}`, at: 1, cityId: 'lagos', category: body.category, text: body.text, status: 'received', note: '', updatedAt: 1 })), categories: [], limits: { text: 600, open: 5 } } }))
  server.route('POST /api/support/reports', (request) => {
    if (failNext) { const status = failNext; failNext = 0; return { status, body: { error: status === 429 ? 'rate_limited' : 'internal_error' } } }
    const body = request.body ?? {}
    if (!filed.some((item) => item.clientId === body.clientId)) filed.push(body)
    return { status: 200, body: { ok: true, code: 'filed', receipt: { id: `P-${filed.findIndex((item) => item.clientId === body.clientId) + 1}` } } }
  })
  let loaded = 0, noted = 0
  const support = createSupport({ fetchJson: game.fetchJson, newId: game.newId, cityId: () => game.cityId.value, onLoaded: () => { loaded += 1 }, onFiled: () => { noted += 1 } })

  await support.load()
  assert.deepEqual([support.list.value?.reports.length, support.list.value?.failed, loaded], [0, false, 1])
  support.preset('money'); assert.equal(support.draft.category, 'money', 'a category handed over is applied while nothing is typed')
  support.draft.text = 'hi'
  support.preset('stuck'); assert.equal(support.draft.category, 'money', 'never over what the player has started')
  assert.equal(await support.submit(), false)
  assert.equal(support.notice.value?.text, textProblem('hi'))
  assert.equal(server.requests.filter((request) => request.method === 'POST' && request.path === '/api/support/reports').length, 0, 'too short: nothing is sent')

  support.draft.text = '  The bank shows the wrong balance  '
  failNext = 429
  assert.equal(await support.submit(), false)
  assert.equal(support.notice.value?.text, sendFailure({ status: 429 }))
  assert.equal(support.draft.text, '  The bank shows the wrong balance  ', 'the text is kept')
  const key = support.draft.clientId
  assert.match(String(key), /^\d+:[0-9a-f-]{36}$/)
  failNext = 500
  assert.equal(await support.submit(), false)
  assert.equal(support.notice.value?.text, sendFailure({ status: 500 }))
  assert.equal(await support.submit(), true)
  const posts = server.requests.filter((request) => request.method === 'POST' && request.path === '/api/support/reports')
  assert.deepEqual(posts.map((request) => request.body?.clientId), [key, key, key], 'every attempt carried the same key, so it can be filed at most once')
  assert.deepEqual(posts.at(-1)?.body, { cityId: 'lagos', category: 'money', text: 'The bank shows the wrong balance', clientId: key })
  assert.equal(filed.length, 1)
  assert.deepEqual([support.notice.value?.kind, support.draft.text, support.draft.clientId, noted], ['good', '', null, 1])
  assert.match(support.notice.value?.text ?? '', /Report P-1 was received/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(support.list.value?.reports[0]?.text, 'The bank shows the wrong balance', 'the list is read again after filing')

  server.fault.offline = true
  await support.load()
  assert.deepEqual([support.list.value?.failed, support.list.value?.reports.length], [true, 1], 'a failed reload keeps what was loaded and says so')
  assert.deepEqual([statusTone('resolved'), statusTone('dismissed'), statusTone('received')], ['good', 'neutral', 'warn'])
})
