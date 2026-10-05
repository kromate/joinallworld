// The Ping client without a DOM: the button's states, the notices' words, the share text, the join link a device keeps,
// and the store against a fake server (one client id per ping, the frames, the landing of a link).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { attach } from '../social/useSocial.ts'
import type { PanelApi } from '../../types/panel.ts'
import type { PingControl, PingNotice, PingPlace } from '../../../types/ping.ts'
import { captureToken, forgetToken, keptToken, pingUi, tokenFrom } from './pingLoader.ts'
import { PING_HINT, bannerView, noticeKey, pingButton, pingInstead, shareWords, whatsappUrl } from './pingModel.ts'
import { cancelPing, closeBanner, joinFriend, loadControl, loadIncoming, openKeptLink, pingState, sendPing, takeFrames } from './pingStore.ts'

const NOW = 1_700_000_000_000, MINUTE = 60000
const TOKEN = 'Ab1_-'.repeat(19)
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada' }, BAYO = { id: '22222222-2222-4222-8222-222222222222', name: 'Bayo' }
const PARK: PingPlace = { cityId: 'lagos', cityName: 'Lagos', venue: 'park', home: false, label: 'at Freedom Park, Lagos' }
const notice = (over: Partial<PingNotice> = {}): PingNotice => ({ from: ADA, at: NOW, expiresAt: NOW + 60 * MINUTE, place: PARK, ...over })
const control = (over: Partial<PingControl> = {}): PingControl => ({ can: true, code: null, reason: null, again: null, live: null, ...over })
const button = (over: Partial<Parameters<typeof pingButton>[0]> = {}) => pingButton({ connected: true, self: false, friend: true, blocked: false, name: 'Bayo', control: control(), busy: false, now: NOW, ...over })

test('Ping stands where Call does only for a friend who is not in the game', () => {
  assert.deepEqual(['offline', 'away', 'online', 'reconnecting', undefined, null].map((status) => pingInstead(status)), [true, true, false, false, false, false])
})

test('the button: one tap when it can be pressed, and a plain reason when it cannot — never one about how the friend is reached', () => {
  assert.deepEqual(button(), { label: 'Ping Bayo', disabled: false, reason: null })
  assert.deepEqual(button({ compact: true }), { label: 'Ping', disabled: false, reason: null })
  assert.deepEqual(button({ control: null }), { label: 'Ping Bayo', disabled: false, reason: null }, 'before the server has answered, the server is what decides')
  assert.deepEqual(button({ busy: true }), { label: 'Pinging…', disabled: true, reason: null })
  assert.equal(button({ self: true }).reason, 'This is you.')
  assert.equal(button({ connected: false }).reason, 'Not connected.')
  assert.equal(button({ blocked: true }).reason, 'Unblock this player to ping them.')
  assert.equal(button({ friend: false }).reason, 'Add Bayo as a friend to ping them.')
  assert.deepEqual(button({ control: control({ can: false, code: 'founder', reason: 'Zed is everyone’s first friend, so they cannot be pinged. Send them a message instead.' }) }), { label: 'Ping Bayo', disabled: true, reason: 'Zed is everyone’s first friend, so they cannot be pinged. Send them a message instead.' })
  // The wait counts down on this device's reading of server time, and ends by itself.
  const waiting = control({ can: false, code: 'cooldown', reason: 'You pinged Bayo a moment ago. You can ping again in 30 minutes.', again: NOW + 12 * MINUTE })
  assert.deepEqual(button({ control: waiting }), { label: 'Ping Bayo', disabled: true, reason: 'You pinged Bayo. You can ping again in 12 minutes.', waiting: true })
  assert.deepEqual(button({ control: waiting, now: NOW + 12 * MINUTE }), { label: 'Ping Bayo', disabled: false, reason: null })
  for (const view of [button(), button({ friend: false }), button({ control: waiting })]) assert.ok(!/e-?mail|address|notification|deliver|inbox/i.test(`${view.label} ${view.reason ?? ''} ${PING_HINT}`))
  assert.equal(PING_HINT, 'Tell them you are here. If they come, they land right where you are.')
})

test('what a player shares by their own hand: their words, then the link; WhatsApp is only its own share address', () => {
  assert.equal(shareWords('Bayo', 'at Freedom Park, Lagos'), 'Bayo, I am in Allworld right now, at Freedom Park, Lagos. Come and join me. You land right where I am:')
  assert.equal(shareWords('Bayo', null), 'Bayo, I am in Allworld right now. Come and join me. You land right where I am:')
  const url = whatsappUrl('Come & join <me>', `https://play.example/j/${TOKEN}`)
  assert.equal(new URL(url).origin, 'https://wa.me')
  assert.equal(new URL(url).pathname, '/')
  assert.deepEqual([...new URL(url).searchParams.keys()], ['text'], 'no number, nothing but the text')
  assert.equal(new URL(url).searchParams.get('text'), `Come & join <me> https://play.example/j/${TOKEN}`)
})

test('the notices: who, where, and only what makes sense to press', () => {
  const incoming = bannerView({ kind: 'incoming', notice: notice(), busy: false, error: null })
  assert.deepEqual([incoming.title, incoming.text, incoming.actions, incoming.tone], ['Ada is at Freedom Park, Lagos', 'They pinged you to come. Join them and you land right there.', ['join', 'call', 'chat'], 'good'])
  const invited = bannerView({ kind: 'incoming', notice: notice({ invite: true }), busy: false, error: null })
  assert.deepEqual([invited.title, invited.text], ['Ada joined through your link', 'They are at Freedom Park, Lagos right now. Join them and you land right there.'])
  assert.equal(bannerView({ kind: 'incoming', notice: notice(), busy: true, error: null }).busy, true)
  const refused = bannerView({ kind: 'incoming', notice: notice(), busy: false, error: 'Finish or cancel what you are doing first, then join them.' })
  assert.deepEqual([refused.text, refused.tone, refused.actions[0]], ['Finish or cancel what you are doing first, then join them.', 'info', 'join'])
  assert.deepEqual(bannerView({ kind: 'joined', from: ADA, words: 'You joined Ada at Freedom Park, Lagos.', knock: false, present: true }).actions, ['chat', 'call'])
  assert.deepEqual(bannerView({ kind: 'joined', from: ADA, words: 'You joined Ada at Freedom Park, Lagos.', knock: false, present: false }).actions, ['chat'], 'no Call for someone a call could not reach')
  const door = bannerView({ kind: 'joined', from: ADA, words: 'Ada is at home in Lagos. Knock to come in.', knock: true, present: true })
  assert.deepEqual([door.title, door.actions], ['Ada is at home in Lagos. Knock to come in.', ['knock', 'chat']])
  const came = bannerView({ kind: 'came', by: BAYO, place: 'at Freedom Park, Lagos', present: true })
  assert.deepEqual([came.title, came.actions], ['Bayo joined you at Freedom Park, Lagos', ['chat', 'call']])
  const left = bannerView({ kind: 'left', from: ADA, words: 'Ada has left. You can message them.' })
  assert.deepEqual([left.title, left.actions, left.tone], ['Ada has left. You can message them.', ['chat'], 'info'])
  assert.deepEqual(bannerView({ kind: 'left', from: null, words: 'That invitation has ended.' }).actions, [])
  const other = bannerView({ kind: 'other' })
  assert.deepEqual([other.title, other.actions, other.who], ['That invitation was for another player', [], null])
  assert.match(other.text, /^Nothing was changed\./)
  assert.notEqual(noticeKey(notice()), noticeKey(notice({ at: NOW + 1 })))
})

test('a join link is read from the address once, kept for an hour, and is only ever a token of the right shape', () => {
  assert.equal(tokenFrom(`/j/${TOKEN}`), TOKEN)
  assert.equal(tokenFrom(`/j/${TOKEN}/`), TOKEN)
  for (const bad of ['/', `/j/${TOKEN}x`, `/j/${TOKEN.slice(1)}`, `/j/${TOKEN.slice(0, -1)}.`, `/x/j/${TOKEN}`, `/j/${TOKEN}/more`, '/j/<script>', null, undefined, 7]) assert.equal(tokenFrom(bad), null, String(bad))
  forgetToken()
  assert.equal(keptToken(NOW), null)
  assert.equal(captureToken({ pathname: '/s/abcdefgh12' }, NOW), null)
  assert.equal(captureToken({ pathname: `/j/${TOKEN}` }, NOW), TOKEN)
  assert.equal(keptToken(NOW + 59 * MINUTE), TOKEN)
  assert.equal(keptToken(NOW + 60 * MINUTE), null, 'an hour old: dropped unread')
  assert.equal(keptToken(NOW), null, 'and it stays dropped')
})

// ---- the store, against a fake server ------------------------------------------------------------
interface Asked { path: string; body: Record<string, unknown> | undefined }
function server(answers: Record<string, (body: Record<string, unknown> | undefined) => unknown>) {
  const asked: Asked[] = []
  let serial = 0
  const api = {
    // The overview the store reads again after a change is not what these tests are about.
    fetchJson: async (path: string, options?: { body?: Record<string, unknown> }) => { if (path.startsWith('/api/social/ping')) asked.push({ path, body: options?.body }); const answer = answers[path]; if (!answer) throw Object.assign(new Error('no such route'), { status: 404 }); const made = answer(options?.body); if (made instanceof Error) throw made; return made },
    newId: () => `${NOW}:00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    view: () => ({ connected: true, now: NOW, cityId: 'lagos', onboarding: { required: false } }), toast: () => {}, refresh: () => {}, command: async () => ({ ok: true }),
  } as unknown as PanelApi
  attach(api)
  return asked
}
function reset(): void { pingState.controls.clear(); pingState.sent.clear(); pingState.busy.clear(); pingState.banner = null; pingUi.frames.length = 0; forgetToken() }
const pinged = { ok: true, code: 'pinged', to: BAYO, note: 'later', words: 'Pinged. Bayo will see it when they are back.', at: NOW, expiresAt: NOW + 60 * MINUTE, again: NOW + 30 * MINUTE, link: `/j/${TOKEN}`, place: PARK }

test('a ping: one request, the server’s own sentence, the link to share, and the wait until the next', async () => {
  reset()
  const asked = server({ '/api/social/ping': () => pinged, '/api/social/ping/cancel': () => ({ ok: true, code: 'cancelled' }) })
  assert.deepEqual(await sendPing(BAYO.id, 'Bayo'), { ok: true, words: 'Pinged. Bayo will see it when they are back.' })
  assert.deepEqual(asked.map((item) => [item.path, item.body?.to]), [['/api/social/ping', BAYO.id]])
  assert.match(String(asked[0]?.body?.clientId), /^\d+:[0-9a-f-]{36}$/)
  assert.deepEqual(pingState.sent.get(BAYO.id), { name: 'Bayo', words: pinged.words, note: 'later', link: pinged.link, place: PARK, expiresAt: pinged.expiresAt })
  assert.deepEqual(pingState.controls.get(BAYO.id), { can: false, code: 'cooldown', reason: null, again: pinged.again, live: { at: NOW, expiresAt: pinged.expiresAt, link: pinged.link } })
  assert.equal(await cancelPing(BAYO.id), true)
  assert.equal(pingState.sent.has(BAYO.id), false)
  assert.equal(pingState.controls.get(BAYO.id)?.live, null)
})

test('a ping that got no answer is the SAME ping when tried again; a refusal is said in the server’s words and sets the button', async () => {
  reset()
  let fail = true
  const asked = server({ '/api/social/ping': () => (fail ? new Error('offline') : pinged) })
  const first = await sendPing(BAYO.id, 'Bayo')
  assert.equal(first.ok, false)
  fail = false
  assert.equal((await sendPing(BAYO.id, 'Bayo')).ok, true)
  assert.equal(asked[0]?.body?.clientId, asked[1]?.body?.clientId, 'one client id from the tap to the answer')
  reset()
  const again = NOW + 9 * MINUTE
  server({ '/api/social/ping': () => ({ ok: false, code: 'cooldown', reason: 'You pinged Bayo a moment ago. You can ping again in 9 minutes.', again }) })
  assert.deepEqual(await sendPing(BAYO.id, 'Bayo'), { ok: false, words: 'You pinged Bayo a moment ago. You can ping again in 9 minutes.' })
  assert.deepEqual([pingState.controls.get(BAYO.id)?.code, pingState.controls.get(BAYO.id)?.again], ['cooldown', again])
  assert.equal(pingState.sent.has(BAYO.id), false)
})

test('the control of a friend’s card is the server’s; a ping already out is shown again with its link', async () => {
  reset()
  server({ [`/api/social/ping/${BAYO.id}`]: () => ({ ok: true, code: 'ok', control: control({ can: false, code: 'cooldown', again: NOW + MINUTE, live: { at: NOW, expiresAt: NOW + 60 * MINUTE, link: `/j/${TOKEN}` } }) }) })
  await loadControl(BAYO.id, 'Bayo')
  assert.equal(pingState.controls.get(BAYO.id)?.code, 'cooldown')
  assert.deepEqual([pingState.sent.get(BAYO.id)?.link, pingState.sent.get(BAYO.id)?.words], [`/j/${TOKEN}`, 'You pinged Bayo. They can join you for the next hour.'])
})

test('frames: an incoming ping is offered, a closed one stays closed, an ended one goes, and "they joined you" replaces it', async () => {
  reset()
  server({})
  pingUi.frames.push({ type: 'ping-incoming', notice: notice() })
  takeFrames()
  assert.equal(pingState.banner?.kind, 'incoming')
  pingUi.frames.push({ type: 'ping-ended', from: BAYO.id })
  takeFrames()
  assert.equal(pingState.banner?.kind, 'incoming', 'somebody else’s ping ending changes nothing')
  pingUi.frames.push({ type: 'ping-ended', from: ADA.id })
  takeFrames()
  assert.equal(pingState.banner, null)
  pingUi.frames.push({ type: 'ping-incoming', notice: notice({ at: NOW + 5 }) })
  takeFrames()
  closeBanner()
  pingUi.frames.push({ type: 'ping-incoming', notice: notice({ at: NOW + 5 }) })
  takeFrames()
  assert.equal(pingState.banner, null, 'the same ping is not shown again once closed')
  pingUi.frames.push({ type: 'ping-joined', by: BAYO, place: PARK, present: true })
  takeFrames()
  assert.deepEqual(pingState.banner, { kind: 'came', by: BAYO, place: 'at Freedom Park, Lagos', present: true })
  reset()
  server({ '/api/social/ping': () => ({ ok: true, code: 'ok', incoming: [notice({ at: NOW + 9 })] }) })
  await loadIncoming()
  const shown = pingState.banner as { kind: string; notice?: PingNotice } | null
  assert.deepEqual([shown?.kind, shown?.notice?.at], ['incoming', NOW + 9])
})

test('arriving in a city by joining a friend: the ping notice is the only thing said — before the first-home sheet and before the trip’s welcome', () => {
  const shell = readFileSync(new URL('../../state/app.ts', import.meta.url), 'utf8')
  const start = shell.indexOf('if (state.estate.city !== previous.estate.city) {\n      scene.world.value?.setCity')
  assert.ok(start > 0, 'the arrival branch of the shell')
  const branch = shell.slice(start, shell.indexOf('// The server has set a plot aside', start)).replace(/^\s*\/\/.*$/gm, '')
  const ping = branch.indexOf('if (pingUi.arriving)'), sheet = branch.indexOf("else if (state.onboarding.done && !state.estate.lga && !state.estate.home && !away) shell.open('city'"), welcome = branch.indexOf("else if (!away && state.message.startsWith('Welcome to ')) game.toast(state.message)")
  assert.ok(ping > 0 && sheet > ping && welcome > sheet, 'one chain: the join first, then a life with no home anywhere, then the welcome')
  // Nothing is opened or said by the join's own branch, and no second statement can run after the chain for the same arrival.
  assert.match(branch.slice(ping, sheet), /^if \(pingUi\.arriving\) \{ \/\* nothing more to open \*\/ \}\s*$/)
  assert.equal((branch.match(/game\.toast\(/g) ?? []).length, 1)
  assert.equal((branch.match(/shell\.open\(/g) ?? []).length, 1)
})

test('the join: the life is read again only when the server moved it, the city’s own sheet is held back meanwhile, and a refusal can be tried again', async () => {
  reset()
  let answer: unknown = { ok: true, code: 'joined', from: ADA, place: PARK, moved: 'city', knock: false, present: true, words: 'You joined Ada at Freedom Park, Lagos.' }
  const asked = server({ '/api/social/ping/join': () => answer })
  let refreshed = 0, held: boolean[] = []
  const cities: (string | undefined)[] = []
  const deps = { refresh: async (cityId?: string) => { refreshed += 1; held.push(pingUi.arriving); cities.push(cityId) } }
  pingState.banner = { kind: 'incoming', notice: notice(), busy: false, error: null }
  await joinFriend(ADA, deps)
  assert.deepEqual([refreshed, held, pingUi.arriving], [1, [true], false])
  assert.deepEqual(cities, ['lagos'], 'moved to another city: the life is read there')
  assert.deepEqual(pingState.banner, { kind: 'joined', from: ADA, words: 'You joined Ada at Freedom Park, Lagos.', knock: false, present: true })
  assert.deepEqual(asked.map((item) => [item.path, item.body?.from]), [['/api/social/ping/join', ADA.id]])
  // The request and the read after it are one piece of work for the page: nothing else reads the life in between.
  const order: string[] = []
  pingState.banner = { kind: 'incoming', notice: notice({ at: NOW + 5 }), busy: false, error: null }
  await joinFriend(ADA, { refresh: async () => { order.push('read') }, during: async (work) => { order.push('begin'); try { return await work() } finally { order.push('end') } } })
  assert.deepEqual(order, ['begin', 'read', 'end'])
  // Already there: nothing to read again.
  answer = { ok: true, code: 'here', from: ADA, place: PARK, moved: 'none', knock: false, present: true, words: 'You joined Ada at Freedom Park, Lagos.' }
  pingState.banner = { kind: 'incoming', notice: notice({ at: NOW + 1 }), busy: false, error: null }
  await joinFriend(ADA, deps)
  assert.equal(refreshed, 1)
  // Busy: the notice stays, says why, and Join can be pressed again.
  answer = { ok: false, code: 'busy', reason: 'Finish or cancel what you are doing first, then join them.', from: ADA }
  pingState.banner = { kind: 'incoming', notice: notice({ at: NOW + 2 }), busy: false, error: null }
  await joinFriend(ADA, deps)
  assert.deepEqual([pingState.banner?.kind, pingState.banner?.kind === 'incoming' && pingState.banner.error], ['incoming', 'Finish or cancel what you are doing first, then join them.'])
  // Left: said once, with their name for Chat.
  answer = { ok: false, code: 'left', reason: 'Ada has left. You can message them.', from: ADA }
  await joinFriend(ADA, deps)
  assert.deepEqual(pingState.banner, { kind: 'left', from: ADA, words: 'Ada has left. You can message them.' })
  assert.equal(refreshed, 1)
})

test('a join link the device was opened with: yours joins, somebody else’s changes nothing, an ended one says so, and no session keeps it for later', async () => {
  const deps = { refresh: async () => {} }
  reset()
  captureToken({ pathname: `/j/${TOKEN}` })
  let asked = server({ '/api/social/ping/open': () => ({ ok: true, code: 'yours', from: ADA, notice: notice() }), '/api/social/ping/join': () => ({ ok: true, code: 'joined', from: ADA, place: PARK, moved: 'venue', knock: false, present: true, words: 'You joined Ada at Freedom Park, Lagos.' }) })
  await openKeptLink(deps)
  assert.deepEqual(asked.map((item) => item.path), ['/api/social/ping/open', '/api/social/ping/join'])
  assert.equal(asked[0]?.body?.token, TOKEN)
  assert.equal(pingState.banner?.kind, 'joined')
  assert.equal(keptToken(), null, 'answered: not opened a second time')
  reset()
  captureToken({ pathname: `/j/${TOKEN}` })
  asked = server({ '/api/social/ping/open': () => ({ ok: true, code: 'other' }) })
  await openKeptLink(deps)
  assert.deepEqual([asked.map((item) => item.path), pingState.banner], [['/api/social/ping/open'], { kind: 'other' }], 'no join is asked for a link made for another player')
  reset()
  captureToken({ pathname: `/j/${TOKEN}` })
  server({ '/api/social/ping/open': () => ({ ok: true, code: 'yours', from: ADA, notice: null }) })
  await openKeptLink(deps)
  assert.deepEqual(pingState.banner, { kind: 'left', from: ADA, words: 'Ada has left. You can message them.' })
  reset()
  captureToken({ pathname: `/j/${TOKEN}` })
  server({ '/api/social/ping/open': () => ({ ok: false, code: 'invalid_link', reason: 'That link does not work any more.' }) })
  await openKeptLink(deps)
  assert.deepEqual([pingState.banner, keptToken()], [{ kind: 'left', from: null, words: 'That invitation has ended.' }, null])
  // Not signed in on this device: nothing is shown, and the link waits for the player to log in.
  reset()
  captureToken({ pathname: `/j/${TOKEN}` })
  server({ '/api/social/ping/open': () => Object.assign(new Error('no session'), { status: 401, code: 'device_session_required' }) })
  await openKeptLink(deps)
  assert.deepEqual([pingState.banner, keptToken()], [null, TOKEN])
  reset()
})
