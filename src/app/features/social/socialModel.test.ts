// The social screens' wording and rules without a browser: badges, closeness, why a call is off,
// the gate, the person card's reasons and the Invite app's knock rules.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HouseView, KnockState } from '../../../types/social.ts'
import { knockReason, knockView, roomLine, statusText, homeLine } from './inviteModel.ts'
import { baeReason, friendControl, interactReason, moneyCeiling, moneyReason, npcActionReason, npcMeterMax, npcReason } from './personModel.ts'
import { callNote, callReason, closenessText, dotHint, dotOf, gateOf, knocksWaiting, meterPercent, presenceClass, reasonLabel, requestsWaiting, staleSteps, STALE_MS, tagLabel, venueNameOf } from './socialModel.ts'

const transfer = { min: 50, maxPerTransfer: 5000, dailyAmount: 20000, dailyCount: 3, dailyReceive: 50000, minEarned: 2000, minAccountAgeMs: 0, minFriendshipMs: 0, earned: 3000, sentToday: 0, countToday: 0, leftToday: 5000, giftsLeftToday: 3 }

test('badges: People counts friend and Bae requests, Invite counts knocks; nothing before the overview', () => {
  assert.equal(requestsWaiting(null), 0)
  assert.equal(requestsWaiting({ requests: { in: [{ id: 'a', name: 'A', at: 1 }, { id: 'b', name: 'B', at: 1 }], out: [] }, baeRequests: [{ id: 'c', name: 'C', at: 1 }] }), 3)
  assert.equal(knocksWaiting(undefined), 0)
  assert.equal(knocksWaiting({ house: { knocks: [{ from: { id: 'a', name: 'A' }, at: 1, expiresAt: 2 }] } as HouseView & { knocks: HouseView['knocks'] } } as never), 1)
})

test('the listing is read again after 20 server seconds, never before', () => {
  assert.equal(staleSteps(1000, 1000), 0)
  assert.equal(staleSteps(1000 + STALE_MS - 1, 1000), 0)
  assert.equal(staleSteps(1000 + STALE_MS, 1000), 1)
  assert.equal(staleSteps(500, 1000), 0, 'a clock that went back does not read negative')
})

test('closeness: the tier, the points towards the next, and the top of the scale', () => {
  assert.equal(closenessText({ tierLabel: 'Friend', points: 12.9, next: { label: 'Paddy Mi', min: 40 } }, 60), 'Friend · 12/40 to Paddy Mi')
  assert.equal(closenessText({ tierLabel: 'Paddy Mi', points: 44, next: null }, 60), 'Paddy Mi · 44/60')
  assert.equal(meterPercent(30, 60), 50)
  assert.equal(meterPercent(90, 60), 100)
})

test('presence words: an unknown status is offline, with no hint', () => {
  assert.equal(dotOf('online'), 'on')
  assert.equal(dotOf('reconnecting'), 'wait')
  assert.equal(dotOf('nonsense'), 'off')
  assert.equal(dotOf(undefined), 'off')
  assert.equal(dotHint('nonsense'), '')
  assert.match(dotHint('away'), /travelling/)
  assert.equal(presenceClass('reconnecting'), 'reconnecting')
  assert.equal(presenceClass('x'), 'offline')
})

test('small wording: report reasons, action tags, venue names', () => {
  assert.equal(reasonLabel('offensive-name'), 'Offensive name')
  assert.equal(reasonLabel('harassment'), 'Harassment')
  assert.equal(tagLabel('social'), '+Social')
  assert.equal(venueNameOf([{ id: 'market', label: 'Balogun Market' }], 'market'), 'Balogun Market')
  assert.equal(venueNameOf([], 'market'), 'market')
})

test('a call says why it cannot be placed: no connection, on the phone, another action', () => {
  const base = { connected: true, cannot: 'No internet. You cannot call right now.', calling: null, memberId: 'mummy', busy: false }
  assert.equal(callReason(base), null)
  assert.equal(callReason({ ...base, connected: false }), 'No internet. You cannot call right now.')
  assert.equal(callReason({ ...base, calling: 'mummy' }), 'On the phone…')
  assert.equal(callReason({ ...base, calling: 'daddy' }), null, 'another call does not stop this one from showing')
  assert.equal(callReason({ ...base, busy: true }), 'Finish or cancel your current action first.')
  assert.equal(callNote({ connected: true, cannot: 'x', busy: true }), 'Finish or cancel your current action to call.')
  assert.equal(callNote({ connected: true, cannot: 'x', busy: false }), '')
  assert.equal(callNote({ connected: false, cannot: 'x', busy: true }), 'x')
})

test('the gate: look first, then the connection, then a failed read with Retry, then loading', () => {
  const ok = { onboardingRequired: false, connected: true, why: 'Down.', error: null, hasOverview: true }
  assert.equal(gateOf(ok), null)
  assert.equal(gateOf({ ...ok, onboardingRequired: true, connected: false })?.text.startsWith('Choose your look and tap Play first'), true)
  assert.deepEqual(gateOf({ ...ok, connected: false }), { text: 'Down. People and messages are read-only until that is resolved.', warn: true, link: true, retry: false })
  assert.deepEqual(gateOf({ ...ok, error: 'Boom', hasOverview: false }), { text: 'Could not load: Boom', warn: true, link: false, retry: true })
  assert.equal(gateOf({ ...ok, error: 'Boom' }), null, 'an error after the overview loaded does not hide it')
  assert.deepEqual(gateOf({ ...ok, hasOverview: false }), { text: 'Loading…', warn: false, link: false, retry: false })
})

test('an NPC: the reasons come in the card\'s order, and the price last', () => {
  const base = { connected: true, cannot: 'Offline.', here: { blocked: null }, name: 'Mama Put', venueLabel: 'Yaba Market', busy: false }
  assert.equal(npcReason(base), null)
  assert.equal(npcReason({ ...base, connected: false }), 'Offline.')
  assert.equal(npcReason({ ...base, here: null }), 'Mama Put is at Yaba Market. Go there to interact.')
  assert.equal(npcReason({ ...base, here: { blocked: 'She is busy.' } }), 'She is busy.')
  assert.equal(npcReason({ ...base, busy: true }), 'Finish or cancel your current action first.')
  assert.equal(npcActionReason(null, 500, 200), 'You need ₦500 (you have ₦200).')
  assert.equal(npcActionReason(null, 500, 500), null)
  assert.equal(npcActionReason('Offline.', 500, 0), 'Offline.')
  assert.equal(npcMeterMax({ next: { min: 20 } }, 60), 20)
  assert.equal(npcMeterMax({ next: null }, 60), 60)
  assert.equal(npcMeterMax(undefined, 60), 5)
})

test('a player: why interactions, Bae and gifts are off', () => {
  const card = { name: 'Ada', blocked: false, bae: false, friend: true, baeAsked: false, incoming: false, requested: false }
  assert.equal(interactReason({ card, together: true, left: 2, daily: 3, busy: false }), null)
  assert.equal(interactReason({ card: { ...card, blocked: true }, together: true, left: 2, daily: 3, busy: false }), 'You blocked this player.')
  assert.equal(interactReason({ card, together: false, left: 2, daily: 3, busy: false }), 'Ada is not in this venue with you right now.')
  assert.equal(interactReason({ card, together: true, left: 0, daily: 3, busy: false }), 'You have used today’s 3 interactions with Ada.')
  assert.equal(interactReason({ card, together: true, left: 1, daily: 3, busy: true }), 'Working…')

  const social = { bae: null, baeUnlock: 20 }
  assert.equal(baeReason({ card: { ...card, bae: true }, social: { bae: 'x', baeUnlock: 20 }, meBae: true, points: 0 }), null, 'ending is always possible')
  assert.equal(baeReason({ card, social: { bae: 'other', baeUnlock: 20 }, meBae: false, points: 99 }), 'You already have a Bae.')
  assert.equal(baeReason({ card, social, meBae: true, points: 99 }), 'You already have a Bae.')
  assert.equal(baeReason({ card: { ...card, friend: false }, social, meBae: false, points: 99 }), 'Become friends first.')
  assert.equal(baeReason({ card, social, meBae: false, points: 7 }), 'Opens when you are closer (7/20).')
  assert.equal(baeReason({ card: { ...card, baeAsked: true }, social, meBae: false, points: 20 }), 'Asked. Waiting for an answer.')
  assert.equal(baeReason({ card, social, meBae: false, points: 20 }), null)

  assert.equal(moneyReason(card, transfer), null)
  assert.equal(moneyReason({ friend: false }, transfer), 'You can only send money to friends.')
  assert.equal(moneyReason(card, { ...transfer, earned: 100 }), 'Earn ₦2,000 from paid work first (earned so far: ₦100).')
  assert.equal(moneyReason(card, { ...transfer, giftsLeftToday: 0 }), 'You have sent 3 gifts today.')
  assert.equal(moneyReason(card, { ...transfer, leftToday: 10 }), 'You have given away all you may for now. You can only give money you earned from work.')
  assert.equal(moneyCeiling({ maxPerTransfer: 5000, leftToday: 1200 }), 1200)
})

test('the friendship button: none while blocked, then remove, accept, sent, add', () => {
  const card = { blocked: false, friend: false, incoming: false, requested: false }
  assert.equal(friendControl({ ...card, blocked: true, friend: true }), 'none')
  assert.equal(friendControl({ ...card, friend: true }), 'unfriend')
  assert.equal(friendControl({ ...card, incoming: true }), 'accept')
  assert.equal(friendControl({ ...card, requested: true }), 'sent')
  assert.equal(friendControl(card), 'add')
})

test('a house: Knock is off for a host who is out, a full house or a knock in flight; never while inside', () => {
  const house = { host: { id: 'h', name: 'Tolu' }, hostStatus: 'home' as const, guests: [] as { id: string; name: string; since: number; expiresAt: number }[], capacity: 2 }
  assert.equal(knockReason(house, false, false), null)
  assert.equal(knockReason({ ...house, hostStatus: 'out' }, false, false), 'Tolu must be at home to answer (Online, but not at home).')
  assert.equal(knockReason({ ...house, hostStatus: 'offline' }, true, false), null, 'inside, nothing is off')
  assert.equal(knockReason({ ...house, guests: [{ id: 'a', name: 'A', since: 1, expiresAt: 2 }, { id: 'b', name: 'B', since: 1, expiresAt: 2 }] }, false, false), 'The house is full (2 guests).')
  assert.equal(knockReason(house, false, true), 'Knocking… waiting for an answer.')
  assert.equal(statusText('reconnecting'), 'Reconnecting…')
  assert.equal(statusText('???'), 'Unavailable')
})

test('a knock: waiting until it expires; "sending" is always waiting; expired only after it was answered by time', () => {
  const knock = (extra: Partial<KnockState>): KnockState => ({ host: 'h', name: 'T', status: 'knocking', expiresAt: 100, ...extra })
  assert.deepEqual(knockView(null, 50), { waiting: false, expired: false })
  assert.deepEqual(knockView(knock({}), 50), { waiting: true, expired: false })
  assert.deepEqual(knockView(knock({}), 100), { waiting: false, expired: true })
  assert.deepEqual(knockView(knock({ status: 'sending', expiresAt: undefined }), 999), { waiting: true, expired: false })
  assert.deepEqual(knockView(knock({ status: 'declined' }), 50), { waiting: false, expired: false })
})

test('the invite card lines', () => {
  assert.equal(homeLine(1, 5, true), '1 of 5 guests inside · you are home, knocks will ring')
  assert.equal(homeLine(0, 5, false), '0 of 5 guests inside · you are out, so knocks will not ring')
  assert.equal(roomLine({ host: 'h', members: [{ name: 'A' }, { name: 'B' }] }, 'h'), 'in the room now: A, B')
  assert.equal(roomLine({ host: 'other', members: [] }, 'h'), 'joining the room…')
  assert.equal(roomLine(null, 'h'), 'joining the room…')
})
