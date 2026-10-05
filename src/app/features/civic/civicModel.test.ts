// The civic screens' own rules, with no DOM: wording of an error, countdowns, which reason
// disables which button, the radio schedule, the rules text.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CivicNotice, GovRules, GovYou, RadioEntry } from '../../../types/civic.ts'
import {
  announceWhy, count, dateTime, electionRules, explain, gemToast, huntChipLines, huntClaimWhy, huntSearchWhy, inClub, lastResultLine, noticeToast, podium,
  radioKey, radioPath, radioWhy, rentWhy, runWhy, schedule, shoutoutMissing, sloganTooShort, song, unseenNews, unseenNotices, until, voteWhy,
} from './civicModel.ts'

test('explain: the server\'s reason first, then our words by code, then the message', () => {
  assert.equal(explain({ reason: 'You cannot do that.', code: 'x' }), 'You cannot do that.')
  assert.equal(explain({ code: 'civic_rate_limited' }), 'You are doing that too quickly. Wait a minute and try again.')
  assert.equal(explain({ code: 'device_session_required' }), 'Your device session is missing or expired. Reconnect first.')
  assert.equal(explain(new Error('boom')), 'boom')
  assert.equal(explain(null), 'The server could not be reached. Try again.')
  assert.equal(explain(undefined), 'The server could not be reached. Try again.')
})

test('until: days and hours, hours and minutes, minutes; never negative', () => {
  const now = 1_000_000
  assert.equal(until(now + 5 * 60000, now), '5m')
  assert.equal(until(now + (3 * 60 + 12) * 60000, now), '3h 12m')
  assert.equal(until(now + (2 * 24 * 60 + 4 * 60) * 60000, now), '2d 4h')
  assert.equal(until(now - 99999, now), '0m')
  assert.equal(until(now + 1, now), '1m', 'a started minute counts')
})

test('dateTime is Nigerian time; count is whole numbers with separators', () => {
  assert.match(dateTime(Date.UTC(2026, 9, 11, 4, 28)), /Sun, 11 Oct, 5:28 am/i)
  assert.equal(count(1234.6), '1,235')
  assert.equal(count('x'), '0')
  assert.equal(count(undefined), '0')
})

test('unseenNews: only news from this life and newer than what was read', () => {
  const notices = [{ at: 100 }, { at: 200 }, { at: 300 }]
  assert.equal(unseenNews(notices, { readAt: 0, since: 150 }), 2)
  assert.equal(unseenNews(notices, { readAt: 250, since: 150 }), 1)
  assert.equal(unseenNews(notices, { readAt: 300, since: 0 }), 0)
  assert.equal(unseenNews(notices, { readAt: 0, since: null }), 0, 'a life with no start has no badge')
  assert.equal(unseenNews(undefined, { since: 0 }), 0)
})

test('unseenNotices: a first visit replays nothing, then only what is new, and it remembers', () => {
  const kept = new Map<string, string>()
  const store = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value) } }
  const notice = (id: string): CivicNotice => ({ id, kind: 'result', at: 1, title: id, text: '' })
  assert.deepEqual(unseenNotices([notice('a'), notice('b')], store), [])
  assert.deepEqual(unseenNotices([notice('c'), notice('a')], store).map((item) => item.id), ['c'])
  assert.deepEqual(unseenNotices([notice('c')], store), [])
  assert.deepEqual(unseenNotices([notice('x')], null), [], 'no storage: nothing is replayed')
})

test('unseenNotices across cities: a city’s first look replays nothing, coming back does not tell its old news again, and what is new there is told once', () => {
  const kept = new Map<string, string>()
  const store = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value) } }
  const notice = (id: string): CivicNotice => ({ id, kind: 'result', at: 1, title: id, text: '' })
  const ids = (list: CivicNotice[]): string[] => list.map((item) => item.id)
  // Every city numbers its notices alike: the week's result and the open polls have the same ids in Lagos and in Abuja.
  const lagos = [notice('nominations-9'), notice('result-8'), notice('voting-8')], abuja = [notice('nominations-9')]
  assert.deepEqual(unseenNotices(lagos, store, 'lagos'), [], 'the first look at Lagos')
  assert.deepEqual(unseenNotices(abuja, store, 'abuja'), [], 'the first look at Abuja, on arriving there')
  assert.deepEqual(unseenNotices(lagos, store, 'lagos'), [], 'home again: last week’s result and the open polls are not news')
  assert.deepEqual(ids(unseenNotices([notice('voting-9'), ...abuja], store, 'abuja')), ['voting-9'], 'the polls opened in Abuja while the player was away')
  assert.deepEqual(unseenNotices([notice('voting-9'), ...abuja], store, 'abuja'), [])
  assert.deepEqual(ids(unseenNotices([notice('voting-9'), ...lagos], store, 'lagos')), ['voting-9'], 'and in Lagos: the same number there is Lagos’s own news, told once')
  assert.deepEqual(unseenNotices([notice('voting-9'), ...lagos], store, 'lagos'), [])
  // A tour of every city later (a week of notices in each), nothing of the first ones has been forgotten.
  for (let city = 0; city < 12; city++) unseenNotices(Array.from({ length: 6 }, (_, index) => notice(`n${index}`)), store, `city-${city}`)
  assert.deepEqual(unseenNotices([notice('voting-9'), ...lagos], store, 'lagos'), [])
  assert.deepEqual(ids(unseenNotices([notice('n0'), notice('n6')], store, 'city-0')), ['n6'], 'a city looked at long ago: its old notice is not news, a new one is')
  // A list kept by the build before (bare ids, one city at a time): what it holds still counts as shown, and nothing is replayed after the update.
  kept.set('joinallworld-civic-seen', JSON.stringify(['result-8', 'voting-8']))
  assert.deepEqual(ids(unseenNotices([notice('nominations-9'), notice('result-8'), notice('voting-8')], store, 'lagos')), ['nominations-9'])
  assert.deepEqual(unseenNotices([notice('result-8')], store, 'abuja'), [], 'another city’s first look after the update')
  assert.deepEqual(unseenNotices([notice('nominations-9'), notice('result-8'), notice('voting-8')], store, 'lagos'), [])
})

const rules: GovRules = { beta: true, minDaysToRun: 2, minDaysToVote: 1, minWorkDays: 2, votesPerAddress: 3, filingFee: 2000, sloganMin: 3, sloganMax: 60, maxCandidates: 30, announcementMax: 140, announcementsPerDay: 3, pollingVenue: null }
test('electionRules: every line is real text with the numbers of this city', () => {
  const lines = electionRules(rules)
  assert.equal(lines.length, 9)
  assert.ok(lines.includes('The Polling Unit is not built in this city yet, so for now you vote from this app.'))
  assert.ok(lines.includes('To run: live here 2 days and be paid for work on 2 different days.'))
  assert.ok(lines.includes('To vote: live here 1 day and be paid for work on 2 different days.'))
  assert.ok(lines.some((line) => line.includes('₦2,000') && line.includes('At most 30 candidates')))
  assert.ok(lines.some((line) => line.includes('At most 3 votes are counted from one network connection.')))
  assert.ok(electionRules({ ...rules, votesPerAddress: 0, pollingVenue: 'polling-unit' }).every((line) => !line.includes('network connection') || line.startsWith('A device')))
})

test('lastResultLine: a winner, nobody voted, nobody stood', () => {
  const base = { week: 1, closedAt: 0, termEndsAt: 0, totalVotes: 7 }
  assert.equal(lastResultLine({ ...base, candidates: 2, winner: { id: 'a', name: 'Ada', slogan: '', votes: 5 } }), 'Ada won with 5 of 7 votes.')
  assert.equal(lastResultLine({ ...base, candidates: 2, winner: null }), 'Nobody voted, so nobody took office.')
  assert.equal(lastResultLine({ ...base, candidates: 0, winner: null }), 'Nobody stood, so the seat stays empty.')
})

const youWith = (patch: Partial<GovYou>): GovYou => ({ days: 3, isGovernor: false, isCandidate: false, votedFor: null, run: { ok: true, checks: [] }, vote: { ok: true, checks: [] }, announce: { ok: true }, ...patch })
test('the reason a vote, a run or an announcement is off: offline first, then the server\'s', () => {
  assert.equal(voteWhy('No internet. You cannot vote right now.', youWith({})), 'No internet. You cannot vote right now.')
  assert.equal(voteWhy(null, null), 'Connect to vote.')
  assert.equal(voteWhy(null, youWith({})), '')
  assert.equal(voteWhy(null, youWith({ vote: { ok: false, code: 'too_new', reason: 'Live here one day first.', checks: [] } })), 'Live here one day first.')
  assert.equal(runWhy(null, youWith({ run: { ok: false, code: 'insufficient_funds', reason: 'Costs ₦2,000.', checks: [] } })), 'Costs ₦2,000.')
  assert.equal(runWhy('Offline.', youWith({})), 'Offline.')
  assert.equal(announceWhy(null, youWith({ announce: { ok: false, code: 'announcement_cooldown', reason: 'Wait an hour.' } })), 'Wait an hour.')
  assert.equal(announceWhy(null, youWith({})), '')
})

test('slogans and announcements are measured in characters', () => {
  assert.equal(sloganTooShort('  ab '), true)
  assert.equal(sloganTooShort('abc'), false)
  assert.equal(sloganTooShort('😀😀😀'), false, 'three emoji are three characters')
})

test('rentWhy: offline, at the limit, cannot afford, ok', () => {
  assert.equal(rentWhy('Offline.', 9999, 100, 0, 2, 'billboards'), 'Offline.')
  assert.equal(rentWhy(null, 9999, 1500, 2, 2, 'billboards'), 'You already rent 2 billboards, the most allowed at once.')
  assert.equal(rentWhy(null, 1000, 1500, 0, 2, 'billboards'), 'Costs ₦1,500; you have ₦1,000.')
  assert.equal(rentWhy(null, 1500, 1500, 1, 2, 'billboards'), '')
})

test('hunt: why Search and Claim are off', () => {
  assert.equal(huntSearchWhy('Offline.', false, 0, 3), 'Offline.')
  assert.equal(huntSearchWhy(null, true, 0, 3), 'You are on the road. Arrive first.')
  assert.equal(huntSearchWhy(null, false, 3, 3), 'You have found every gem today.')
  assert.equal(huntSearchWhy(null, false, 1, 3), '')
  assert.equal(huntClaimWhy(null, { claimed: true, found: 3, total: 3 }), 'Already claimed today. New gems at midnight, Nigerian time.')
  assert.equal(huntClaimWhy(null, { claimed: false, found: 1, total: 3 }), 'Find all 3 gems first (1 so far).')
  assert.equal(huntClaimWhy(null, { claimed: false, found: 3, total: 3 }), '')
})

const entry = (id: string, startsAt: number, endsAt: number, mine = false): RadioEntry => ({ id, by: { id: 'p', name: 'Tolu' }, title: 'Song', artist: 'Band', startsAt, endsAt, mine })
test('schedule: what is on air now, what is next, and what has ended is dropped', () => {
  const data = { playing: entry('r1', 0, 60000), queue: [entry('r2', 60000, 120000), entry('r3', 120000, 180000)] }
  assert.deepEqual(schedule(data, 30000).playing?.id, 'r1')
  assert.deepEqual(schedule(data, 30000).queue.map((item) => item.id), ['r2', 'r3'])
  assert.equal(schedule(data, 60000).playing?.id, 'r2', 'the first has ended')
  assert.deepEqual(schedule(data, 60000).queue.map((item) => item.id), ['r3'])
  assert.equal(schedule(data, 999999).playing, null)
  assert.deepEqual(schedule(null, 0), { playing: null, queue: [] })
  assert.equal(schedule({ playing: null, queue: [entry('r9', 10, 20)] }, 5).playing, null, 'queued, not started')
  assert.equal(song(entry('x', 0, 1)), 'Song — Band')
})

test('inClub: only a club venue, and not while travelling', () => {
  const venues = ['quilox']
  assert.equal(inClub({ location: 'quilox', activeAction: null }, venues), true)
  assert.equal(inClub({ location: 'market', activeAction: null }, venues), false)
  assert.equal(inClub({ location: 'quilox', activeAction: { kind: 'travel' } as never }, venues), false)
  assert.equal(inClub({ location: 'test-square', activeAction: null }, ['test-square']), true)
  assert.equal(inClub({ location: 'quilox', activeAction: null }, ['test-square']), false)
})

test('radioWhy: offline, used up, queue full, cannot afford, ok', () => {
  const radio = { venue: 'quilox', club: true, playing: null, queue: [], price: 500, slotSeconds: 60, perDay: 3, queueMax: 20, usedToday: 0 }
  assert.equal(radioWhy('Offline.', radio, 0, false, 9999), 'Offline.')
  assert.equal(radioWhy(null, { ...radio, usedToday: 3 }, 0, false, 9999), 'You have used all 3 shout-outs today. They reset at midnight, Nigerian time.')
  assert.equal(radioWhy(null, radio, 19, true, 9999), 'The queue is full. Try again in a few minutes.')
  assert.equal(radioWhy(null, radio, 0, false, 100), 'Costs ₦500; you have ₦100.')
  assert.equal(radioWhy(null, radio, 0, false, 500), '')
  assert.equal(shoutoutMissing({ title: ' ', artist: 'x' }), 'title')
  assert.equal(shoutoutMissing({ title: 'x', artist: '' }), 'artist')
  assert.equal(shoutoutMissing({ title: 'x', artist: 'y' }), null)
})

test('podium: second, first, third, then the rest', () => {
  const row = (rank: number) => ({ rank, id: `p${rank}`, name: `P${rank}`, amount: 100 - rank, you: false })
  const shape = podium([1, 2, 3, 4, 5].map(row))
  assert.deepEqual(shape.steps.map((item) => item?.rank), [2, 1, 3])
  assert.deepEqual(shape.rest.map((item) => item.rank), [4, 5])
  assert.deepEqual(podium([row(1)]).steps.map((item) => item?.rank), [undefined, 1, undefined])
})

test('the hunt chip: no number until the counters are here; a toast for one more gem', () => {
  const hunt = { found: 1, total: 3, claimed: false, prize: 3000 }
  assert.deepEqual(huntChipLines(hunt, null), { first: 'next prize ₦3,000', second: 'You: 1/3 today' })
  const pulse = { hunt: { found: 1234, today: 0, claims: 0, prize: 3000, gemsPerDay: 3 }, counters: { players: 9, online: 7, visits: 2 } }
  assert.deepEqual(huntChipLines({ ...hunt, claimed: true }, pulse), { first: '1,234 found · prize claimed today', second: 'You: 1/3 today · 7 online' })
  assert.equal(huntChipLines(hunt, pulse, 12).second, 'You: 1/3 today · 12 online', 'the header pill\'s own number wins when the page has one')
  assert.equal(huntChipLines(hunt, { ...pulse, counters: { ...pulse.counters, online: 0 } }).second, 'You: 1/3 today · 1 online', 'the reader is online: never 0')
  assert.equal(gemToast(null, 'lagos:1', hunt), '', 'the first look is the baseline')
  assert.equal(gemToast({ key: 'lagos:1', found: 0 }, 'lagos:1', hunt), 'Gem found: 1 of 3 today.')
  assert.equal(gemToast({ key: 'lagos:1', found: 2 }, 'lagos:1', { found: 3, total: 3 }), 'Gem found — that is all 3. Claim your prize from the gem hunt chip.')
  assert.equal(gemToast({ key: 'lagos:0', found: 0 }, 'lagos:1', hunt), '', 'a new day is a new baseline')
  assert.equal(gemToast({ key: 'lagos:1', found: 1 }, 'lagos:1', hunt), '')
  assert.equal(noticeToast({ kind: 'announcement', title: 'Governor Ada', text: 'Hello' }), 'Governor Ada: Hello')
  assert.equal(noticeToast({ kind: 'result', title: 'A new Governor', text: 'x' }), 'A new Governor')
})

test('cache keys and paths match the server routes', () => {
  assert.equal(radioKey('lagos', 'quilox'), 'radio:lagos:quilox')
  assert.equal(radioPath('lagos', 'quilox'), '/api/civic/radio?city=lagos&venue=quilox')
})
