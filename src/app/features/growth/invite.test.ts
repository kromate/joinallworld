// The invitation prompts and the share links, without a browser: when a prompt may show (once,
// cooldown, backoff, never busy, never for a guest who has not pressed Play), what is remembered,
// how the channel links are built and escaped, what the sheet says the inviter gets, and the
// inviter lookup of the first screen.
import assert from 'node:assert/strict'
import test from 'node:test'
import { channelLinks, isShareLink, telegramUrl, textWithoutLink } from '../../../ui/share-links.ts'
import { REFERRAL } from '../../../game/content/growth.ts'
import { COOLDOWN_MS, BACKOFF_MS, INVITE_MOMENTS, MAX_DISMISSALS, decideInvite, freshMemory, inviteMemory, inviteWords, promptActed, promptDismissed, promptShown } from './inviteNudgeModel.ts'
import type { InviteInput } from './inviteNudgeModel.ts'
import { friendGetsLine, inviterLimitLine, inviterRewardLine, isInviteSheet, progressLine, surfaceOf } from './inviteModel.ts'
import type { InviteRules } from './inviteModel.ts'
import { invitedWords, inviterName } from './inviterLookup.ts'
import { EVENTS } from '../../../telemetry/events.ts'
import type { FetchJson } from '../../types/client.ts'

const NOW = 1_700_000_000_000
const ask = (over: Partial<InviteInput> = {}): InviteInput => ({ moment: 'first-goal', memory: freshMemory(), now: NOW, activity: false, guestNotPlaying: false, ...over })

test('a prompt shows at a quiet moment, once per moment', () => {
  const first = decideInvite(ask())
  assert.deepEqual(first, { show: true, which: 'first-goal', why: 'ok' })
  const memory = promptShown(freshMemory(), 'first-goal', NOW)
  assert.deepEqual(decideInvite(ask({ memory, now: NOW + 30 * 86400000 })), { show: false, which: null, why: 'once' }, 'a moment is never offered twice, however long after')
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + COOLDOWN_MS })).show, true, 'another moment may follow once the cooldown has passed')
})

test('a global cooldown separates two prompts', () => {
  const memory = promptShown(freshMemory(), 'first-goal', NOW)
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + 60000 })).why, 'cooldown')
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + COOLDOWN_MS - 1 })).why, 'cooldown')
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + COOLDOWN_MS })).show, true)
})

test('never during an activity, and the moment is still available afterwards', () => {
  const busy = decideInvite(ask({ activity: true }))
  assert.deepEqual(busy, { show: false, which: null, why: 'busy' })
  assert.equal(decideInvite(ask({ activity: false })).show, true)
})

test('never for a guest who has not pressed Play', () => {
  assert.equal(decideInvite(ask({ guestNotPlaying: true })).why, 'guest')
  for (const moment of INVITE_MOMENTS) assert.equal(decideInvite(ask({ moment, guestNotPlaying: true })).show, false)
})

test('each dismissal backs off further, and three silence the prompts for good', () => {
  let memory = promptShown(freshMemory(), 'first-goal', NOW)
  memory = promptDismissed(memory, NOW)
  assert.equal(memory.hushUntil, NOW + BACKOFF_MS[0])
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + COOLDOWN_MS + 1 })).why, 'hushed', 'past the cooldown but inside the backoff')
  assert.equal(decideInvite(ask({ memory, moment: 'home', now: NOW + BACKOFF_MS[0] })).show, true)
  memory = promptDismissed(promptShown(memory, 'home', NOW + BACKOFF_MS[0]), NOW + BACKOFF_MS[0])
  assert.equal(memory.hushUntil, NOW + BACKOFF_MS[0] + BACKOFF_MS[1])
  assert.ok((BACKOFF_MS[1] ?? 0) > (BACKOFF_MS[0] ?? 0) && (BACKOFF_MS[2] ?? 0) > (BACKOFF_MS[1] ?? 0), 'the waits grow')
  memory = promptDismissed(promptShown(memory, 'empty-venue', NOW + 5 * 86400000), NOW + 5 * 86400000)
  assert.equal(memory.dismissed, MAX_DISMISSALS)
  assert.equal(decideInvite(ask({ memory, moment: 'table-win', now: NOW + 400 * 86400000 })).why, 'silenced')
})

test('a player who took a prompt up is not prompted again', () => {
  const memory = promptActed(promptShown(freshMemory(), 'home', NOW))
  assert.equal(decideInvite(ask({ memory, moment: 'table-win', now: NOW + 9 * 86400000 })).why, 'acted')
})

test('the memory is read defensively and round-trips', () => {
  assert.deepEqual(inviteMemory(null), freshMemory())
  assert.deepEqual(inviteMemory('x'), freshMemory())
  assert.deepEqual(inviteMemory({ shown: { home: 5, 'made-up': 6, 'table-win': 'x' }, dismissed: -3, last: 'now', hushUntil: Infinity, acted: 'yes' }), { shown: { home: 5 }, dismissed: 0, last: null, hushUntil: 0, acted: false })
  const memory = promptDismissed(promptShown(freshMemory(), 'home', NOW), NOW)
  assert.deepEqual(inviteMemory(JSON.parse(JSON.stringify(memory))), memory)
  assert.equal(inviteMemory({ dismissed: 5000 }).dismissed, 99)
})

test('every moment has its own words, in plain text', () => {
  for (const moment of INVITE_MOMENTS) {
    const words = inviteWords(moment)
    assert.ok(words.title && words.text && words.action)
    assert.ok(!/[<>]/.test(`${words.title}${words.text}${words.action}`))
  }
  assert.equal(inviteWords('first-goal').title, 'Playing is better with friends')
  assert.equal(inviteWords('home').title, 'Show a friend your house')
  assert.equal(inviteWords('empty-venue').title, 'Nobody here yet')
})

test('channel links are plain https links with every part encoded', () => {
  const link = 'https://play.example/s/abc123defg'
  const text = `Come & join "Ada" <b>now</b> #1 100%\n${link}`
  const links = channelLinks(text, link)
  assert.equal(links.whatsapp, `https://wa.me/?text=${encodeURIComponent(text)}`)
  assert.equal(links.x, `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`)
  assert.equal(links.telegram, `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Come & join "Ada" <b>now</b> #1 100%')}`)
  for (const href of Object.values(links)) {
    assert.ok(isShareLink(href))
    const url = new URL(href)
    assert.equal(url.protocol, 'https:')
    assert.ok(!/[<>"\s]/.test(href), 'nothing unsafe is left in the address')
  }
  assert.equal(new URL(links.telegram).searchParams.get('url'), link, 'the link survives the round trip')
  assert.equal(new URL(links.whatsapp).searchParams.get('text'), text)
})

test('a link or name with unsafe characters cannot leave its place in the address', () => {
  const link = 'https://play.example/s/abc123defg?x=1&y=2#frag'
  const evil = 'Ada&url=https://evil.example#"><script>alert(1)</script>'
  const telegram = telegramUrl(link, evil)
  const parsed = new URL(telegram)
  assert.equal(parsed.host, 't.me')
  assert.equal(parsed.searchParams.get('url'), link)
  assert.equal(parsed.searchParams.get('text'), evil)
  assert.deepEqual([...parsed.searchParams.keys()], ['url', 'text'], 'the name did not add a parameter')
  assert.ok(!telegram.includes('<') && !telegram.includes('"'))
  assert.equal(isShareLink('javascript:alert(1)'), false)
  assert.equal(isShareLink('https://ok.example/a b'), false)
  assert.equal(isShareLink(null), false)
})

test('the link line is taken off the text only when it is the last line', () => {
  assert.equal(textWithoutLink('Hi\nhttps://a.example/s/x', 'https://a.example/s/x'), 'Hi')
  assert.equal(textWithoutLink('Hi\nhttps://a.example/s/x there', 'https://a.example/s/x'), 'Hi\nhttps://a.example/s/x there')
  assert.equal(channelLinks('Hi', 'https://a.example/s/x').whatsapp, `https://wa.me/?text=${encodeURIComponent('Hi\nhttps://a.example/s/x')}`, 'a text without its link gets it')
})

const RULES: InviteRules = { welcome: REFERRAL.welcome, reward: REFERRAL.reward, stars: REFERRAL.rewardStars, perWeek: REFERRAL.paidPerWeek, lifetime: REFERRAL.paidLifetime, workDays: REFERRAL.countWorkDays, linkWithinDays: REFERRAL.linkWithinDays }
const money = (value: number): string => `₦${value.toLocaleString('en-NG')}`

test('what the inviter gets is the referral rule, with its condition and its limits', () => {
  assert.equal(inviterRewardLine(RULES, money), 'When a friend you invite has been paid for work on 2 different days, you get ₦1,500 and 2 stars in the game.')
  assert.equal(inviterLimitLine(RULES), 'At most 5 rewards a week and 20 for life. Nothing is paid for sharing the link, or for a friend who never plays.')
  assert.equal(friendGetsLine(RULES, money), 'They get ₦1,000 in the game after their first paid day. The link counts in the first 3 days of their life.')
  assert.ok(!/cash|money back|real/i.test(inviterRewardLine(RULES, money)))
})

test('progress says how many friends joined, and how many of them count', () => {
  const friend = (id: string, state: 'joined' | 'counted') => ({ id, name: id, state, at: 1 })
  assert.equal(progressLine(null), '')
  assert.equal(progressLine({ invited: [], counted: 0 }), 'No friends have joined yet')
  assert.equal(progressLine({ invited: [friend('a', 'joined')], counted: 0 }), '1 friend joined')
  assert.equal(progressLine({ invited: [friend('a', 'counted'), friend('b', 'joined'), friend('c', 'joined')], counted: 1 }), '3 friends joined · 1 counted')
})

test('the sheet treats invitations apart, and a surface is one of a fixed few', () => {
  assert.deepEqual(['invite', 'house', 'table', 'missions', 'week', 'event', undefined].map((kind) => isInviteSheet(kind)), [true, true, true, false, false, false, false])
  assert.deepEqual(['hud', 'prompt', 'phone', 'table', '<x>', undefined].map(surfaceOf), ['hud', 'prompt', 'phone', 'table', 'other', 'other'])
})

test('the first screen names the inviter as text, or falls back to "a friend"', async () => {
  const fetchJson = (answer: unknown): FetchJson => (async () => { if (answer instanceof Error) throw answer; return answer }) as unknown as FetchJson
  assert.equal(await inviterName(fetchJson({ ok: true, by: { id: 'x', name: 'Ada' } }), 'abc12345'), 'Ada')
  assert.equal(await inviterName(fetchJson({ ok: true, by: { name: '  <b>Ada</b>\n' } }), 'abc12345'), '<b>Ada</b>', 'kept as text; the screen escapes it')
  assert.equal(await inviterName(fetchJson({ ok: false }), 'abc12345'), null)
  assert.equal(await inviterName(fetchJson({ ok: true, by: { name: 5 } }), 'abc12345'), null)
  assert.equal(await inviterName(fetchJson(new Error('offline')), 'abc12345'), null)
  const asked: string[] = []
  await inviterName((async (path: string) => { asked.push(path); return { ok: false } }) as unknown as FetchJson, 'a/b?c')
  assert.deepEqual(asked, ['/api/growth/share/a%2Fb%3Fc'])
  assert.deepEqual(invitedWords('Ada'), { title: 'Ada invited you.', text: 'Make your Sim, tap Play and you land where Ada is.' })
  assert.deepEqual(invitedWords(null), { title: 'A friend invited you.', text: 'Tap Play and you land where they are.' })
})

test('the invite telemetry events are in the catalogue with exactly the properties the code sends', () => {
  const sent: Record<string, string[]> = { share_opened: ['surface'], share_channel: ['channel'], invite_prompt_shown: ['moment'], invite_prompt_dismissed: ['moment'] }
  for (const [name, props] of Object.entries(sent)) {
    const spec = EVENTS[name]
    assert.ok(spec, `${name} is listed`)
    assert.equal(spec.from, 'growth')
    assert.deepEqual(Object.keys(spec.props), props)
  }
})
