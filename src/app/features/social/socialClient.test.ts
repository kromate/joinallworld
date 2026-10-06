// The social client against a fake host: a scripted fetchJson and a fake socket. What is asserted
// is what the screens rely on: the request paths, the one retry key per message and per group
// form, what a push changes, and that the state is reactive.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed } from 'vue'
import type { Conversation, Message, SocialOverview } from '../../../types/social.ts'
import type { PanelApi, PanelView } from '../../types/panel.ts'
import type { ApiError, FetchOptions } from '../../types/client.ts'
import { createSocialClient, failureReason } from './socialClient.ts'
import type { SocketLike } from './socialClient.ts'

const ME = { id: 'me-id', name: 'Ada', since: 1 }
const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({ id, kind: 'dm', name: 'Bayo', members: [], owner: null, with: 'bayo-id', last: null, unread: 0, ...extra })
const message = (seq: number, conversation: string, extra: Partial<Message> = {}): Message => ({ seq, id: `${conversation}#${seq}`, conv: conversation, from: { id: 'bayo-id', name: 'Bayo' }, body: `m${seq}`, at: seq, ...extra })
const overview = (extra: Partial<SocialOverview> = {}): SocialOverview => ({
  ok: true, code: 'ok', me: ME, friends: [], requests: { in: [], out: [] }, baeRequests: [], bae: null, blocked: [], conversations: [], updates: [], reports: [],
  house: { capacity: 5, cityId: 'lagos', conv: null, guests: [], host: ME, hostStatus: 'home', knocks: [], role: 'host' },
  visiting: null, invitePath: '/v/x', limits: { body: 500, groupSize: 8, groupName: 30, guests: 5, reportText: 200, reasons: ['spam'] }, ...extra,
} as SocialOverview)

class FakeSocket implements SocketLike {
  readyState = 1
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true }
  push(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}
type Handler = (path: string, options?: FetchOptions) => unknown
function setup(routes: Record<string, Handler> = {}, options: { connected?: boolean; onboarding?: boolean; pathname?: string } = {}) {
  const calls: { path: string; options?: FetchOptions }[] = []
  const toasts: string[] = []
  const opened: { id: string; params?: unknown }[] = []
  const sockets: FakeSocket[] = []
  const timers: { run: () => void; ms: number; cleared: boolean }[] = []
  const commands: string[] = []
  const online: (() => void)[] = []
  let ids = 0
  const flags = { connected: options.connected ?? true, onboarding: options.onboarding ?? false, refreshes: 0, visible: true }
  const handlers: Record<string, Handler> = { '/api/social/me': () => overview(), ...routes }
  const api = {
    view: () => ({ connected: flags.connected, onboarding: flags.onboarding ? { required: true } : undefined, cityId: 'lagos', now: 1000 }) as unknown as PanelView,
    fetchJson: async (path: string, init?: FetchOptions) => {
      calls.push({ path, options: init })
      const key = Object.keys(handlers).find((route) => path === route || path.startsWith(`${route}?`) || (route.endsWith('*') && path.startsWith(route.slice(0, -1))))
      const answer = key ? handlers[key]?.(path, init) : { ok: false, code: 'unknown', reason: 'no route' }
      if (answer instanceof Error) throw answer
      return answer
    },
    newId: () => `${1000 + ++ids}:uuid-${ids}`,
    toast: (text: string) => { toasts.push(text) },
    refresh: () => { flags.refreshes += 1 },
    open: (id: string, params?: unknown) => { opened.push({ id, params }); return true },
    command: async (type: string) => { commands.push(type); return { ok: true, code: 'synced' } },
  } as unknown as PanelApi
  const client = createSocialClient({
    openSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    pageAddress: () => ({ pathname: options.pathname ?? '/', search: '' }),
    clearAddress: () => { opened.push({ id: 'address-cleared' }) },
    onOnline: (listener) => { online.push(listener) },
    visible: () => flags.visible,
    setTimeout: (run, ms) => { const timer = { run, ms, cleared: false }; timers.push(timer); return timer },
    clearTimeout: (handle) => { if (handle) (handle as { cleared: boolean }).cleared = true },
    now: () => 5000,
  })
  /** The newest timer of that length that is still booked. */
  const booked = (ms: number) => timers.filter((timer) => !timer.cleared && timer.ms === ms).at(-1)
  /** The device is online again: what the browser's `online` event does. */
  const backOnline = (): void => { for (const listener of online) listener() }
  return { client, api, calls, toasts, opened, sockets, timers, commands, flags, booked, backOnline }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
const failure = (status: number | undefined, extra: Partial<ApiError> = {}): ApiError => Object.assign(new Error('x'), { status }, extra)

test('failureReason: the server\'s own sentence for a refusal, fixed words for the rest', () => {
  assert.equal(failureReason(failure(400, { reason: 'Blocked wording.' })), 'Blocked wording.')
  assert.equal(failureReason(failure(503, { reason: 'Not saved.' })), 'Not saved.')
  assert.equal(failureReason(failure(429, { reason: 'ignored' })), 'Too many requests. Wait a minute and try again.')
  assert.equal(failureReason(failure(401)), 'Your device session expired. Reconnect to continue.')
  assert.match(failureReason(failure(403, { code: 'onboarding_required' })), /^Choose your look and tap Play first/)
  assert.equal(failureReason(failure(409)), 'That was already sent with different details. Try again.')
  assert.equal(failureReason(failure(422)), 'That request was not accepted. Check what you typed.')
  assert.equal(failureReason(failure(undefined)), 'Connection lost. Nothing was changed; try again.')
})

test('start does nothing until the game is connected and the look is chosen', async () => {
  const held = setup({}, { onboarding: true })
  held.client.start(held.api)
  await settle()
  assert.equal(held.calls.length, 0)
  assert.equal(held.sockets.length, 0)
  const offline = setup({}, { connected: false })
  offline.client.start(offline.api)
  assert.equal(offline.sockets.length, 0)
})

test('start opens one socket and reads the overview once; the socket opening reads it again and asks for the people list', async () => {
  const ctx = setup()
  ctx.client.start(ctx.api)
  ctx.client.start(ctx.api)
  await settle()
  assert.equal(ctx.sockets.length, 1, 'one socket however often it is started')
  assert.equal(ctx.client.state.socket, 'connecting')
  assert.equal(ctx.client.state.me?.me.id, 'me-id')
  assert.equal(ctx.calls.filter((item) => item.path.startsWith('/api/social/me')).length, 1)
  ctx.sockets[0]?.onopen?.()
  await settle()
  assert.equal(ctx.client.state.socket, 'open')
  assert.deepEqual(ctx.sockets[0]?.sent.map((frame) => JSON.parse(frame) as unknown), [{ type: 'people-list', cityId: 'lagos' }, { type: 'live-watch', cityId: 'lagos' }])
})

test('an invite link in the address opens the Invite app once the overview is here, then the address is cleared', async () => {
  const host = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const ctx = setup({}, { pathname: `/v/${host}` })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.start(ctx.api)
  assert.deepEqual(ctx.opened, [{ id: 'address-cleared' }, { id: 'invite', params: { host } }])
  assert.equal(ctx.client.takeLinkHost(), null, 'handled')
})

test('send shows the message at once as pending, and a confirmed one leaves the outbox', async () => {
  const ctx = setup({ '/api/social/messages': () => ({ ok: true, code: 'sent', conv: conv('dm.a.b'), message: message(1, 'dm.a.b', { from: { id: 'me-id', name: 'Ada' }, clientId: '1001:uuid-1' }) }) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.send('dm.a.b', { conv: 'dm.a.b' }, 'hello')
  assert.deepEqual(ctx.client.threadView('dm.a.b').map((item) => 'status' in item ? item.status : 'sent'), ['pending'])
  await settle()
  const post = ctx.calls.find((item) => item.path === '/api/social/messages')
  assert.deepEqual(post?.options, { method: 'POST', body: { conv: 'dm.a.b', body: 'hello', clientId: '1001:uuid-1' } })
  assert.deepEqual(ctx.client.threadView('dm.a.b').map((item) => 'status' in item ? item.status : 'sent'), ['sent'])
  assert.equal(ctx.client.outbox.size(), 0)
  assert.equal(ctx.client.state.me?.conversations[0]?.id, 'dm.a.b')
})

test('a failed send is retried under the SAME client id; delete drops it', async () => {
  let answers = 0
  const ctx = setup({ '/api/social/messages': () => (++answers === 1 ? failure(undefined) : { ok: true, code: 'sent', conv: conv('dm.a.b'), message: message(1, 'dm.a.b', { clientId: '1001:uuid-1' }) }) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.send('dm.a.b', { conv: 'dm.a.b' }, 'hello')
  await settle()
  const [failed] = ctx.client.threadView('dm.a.b')
  assert.ok(failed && 'status' in failed && failed.status === 'failed')
  assert.equal(failed.reason, 'Connection lost. Nothing was changed; try again.')
  ctx.client.retry(failed.clientId)
  await settle()
  const ids = ctx.calls.filter((item) => item.path === '/api/social/messages').map((item) => (item.options?.body as { clientId: string }).clientId)
  assert.deepEqual(ids, ['1001:uuid-1', '1001:uuid-1'])
  assert.equal(ctx.client.outbox.size(), 0)
  ctx.client.send('dm.a.b', { conv: 'dm.a.b' }, 'second')
  ctx.client.discard('1002:uuid-2')
  assert.equal(ctx.client.outbox.size(), 0)
})

test('a message to a new chat moves from its provisional key to the real conversation, and the open conversation follows', async () => {
  const ctx = setup({
    '/api/social/messages': () => ({ ok: true, code: 'sent', conv: conv('dm.a.b'), message: message(1, 'dm.a.b', { clientId: '1001:uuid-1' }) }),
    '/api/social/conversations/*': () => ({ ok: true, code: 'ok', conv: conv('dm.a.b'), messages: [message(1, 'dm.a.b')], read: 1 }),
  })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.state.openConv = 'to:bayo-id'
  ctx.client.send('to:bayo-id', { to: 'bayo-id' }, 'hi')
  await settle()
  assert.equal(ctx.client.state.openConv, 'dm.a.b')
  assert.ok(ctx.calls.some((item) => item.path === '/api/social/conversations/dm.a.b'), 'the history of the new conversation is read')
})

test('the sender of a first message reads the new thread even when the push for it arrives before the acknowledgement', async () => {
  const ctx = setup({
    '/api/social/messages': () => ({ ok: true, code: 'sent', conv: conv('dm.a.b'), message: message(1, 'dm.a.b', { clientId: '1001:uuid-1', from: { id: ME.id, name: ME.name } }) }),
    '/api/social/conversations/*': () => ({ ok: true, code: 'ok', conv: conv('dm.a.b'), messages: [message(1, 'dm.a.b', { from: { id: ME.id, name: ME.name } })], read: 1 }),
  })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.state.openConv = 'to:bayo-id'
  ctx.client.send('to:bayo-id', { to: 'bayo-id' }, 'hi')
  ctx.sockets[0]?.push({ type: 'dm', conv: conv('dm.a.b'), message: message(1, 'dm.a.b', { clientId: '1001:uuid-1', from: { id: ME.id, name: ME.name } }) })
  await settle()
  assert.equal(ctx.client.state.openConv, 'dm.a.b')
  assert.equal(ctx.client.state.threads.get('dm.a.b')?.loaded, true, 'the thread is not left on "Loading messages"')
})

test('openThread reads from the last message after the first load, merges, and marks an unread conversation read', async () => {
  let reads = 0
  const ctx = setup({
    '/api/social/conversations/*/read': () => ({ ok: true, code: 'read', conv: conv('dm.a.b') }),
    '/api/social/conversations/dm.a.b': () => ({ ok: true, code: 'ok', conv: conv('dm.a.b', { unread: ++reads === 1 ? 2 : 0 }), messages: reads === 1 ? [message(1, 'dm.a.b'), message(2, 'dm.a.b')] : [message(3, 'dm.a.b')], read: 0 }),
  })
  ctx.client.start(ctx.api)
  await settle()
  await ctx.client.openThread('dm.a.b')
  await settle()
  await ctx.client.openThread('dm.a.b')
  const paths = ctx.calls.map((item) => item.path).filter((path) => path.includes('conversations'))
  assert.deepEqual(paths, ['/api/social/conversations/dm.a.b', '/api/social/conversations/dm.a.b/read', '/api/social/conversations/dm.a.b?after=2'])
  assert.deepEqual(ctx.client.state.threads.get('dm.a.b')?.messages.map((item) => item.seq), [1, 2, 3])
})

test('a pushed message: a toast when its chat is not on screen, a read mark when it is; my own never toasts', async () => {
  const ctx = setup({ '/api/social/conversations/*': () => ({ ok: true, code: 'read', conv: conv('dm.a.b') }) })
  ctx.client.start(ctx.api)
  await settle()
  const socket = ctx.sockets[0]
  socket?.push({ type: 'dm', conv: conv('dm.a.b', { unread: 1 }), message: message(1, 'dm.a.b') })
  assert.deepEqual(ctx.toasts, ['New message from Bayo'])
  ctx.client.state.openConv = 'dm.a.b'
  socket?.push({ type: 'dm', conv: conv('dm.a.b', { unread: 1 }), message: message(2, 'dm.a.b') })
  await settle()
  assert.ok(ctx.calls.some((item) => item.path === '/api/social/conversations/dm.a.b/read'))
  ctx.client.state.openConv = null
  socket?.push({ type: 'dm', conv: conv('dm.a.b'), message: message(3, 'dm.a.b', { from: { id: 'me-id', name: 'Ada' } }) })
  assert.equal(ctx.toasts.length, 1)
  assert.deepEqual(ctx.client.state.threads.get('dm.a.b')?.messages.map((item) => item.seq), [1, 2, 3])
})

test('pushes: an update is shown and toasted, a friend request clears the profiles and reads the overview again', async () => {
  const ctx = setup()
  ctx.client.start(ctx.api)
  await settle()
  const socket = ctx.sockets[0]
  socket?.push({ type: 'social-update', update: { id: 7, kind: 'transfer', text: 'Bayo sent you ₦500', at: 9, read: false } })
  assert.equal(ctx.client.state.me?.updates[0]?.id, 7)
  assert.ok(ctx.toasts.includes('Bayo sent you ₦500'))
  ctx.client.state.profiles.set('bayo-id', { error: 'x' })
  const before = ctx.calls.filter((item) => item.path.startsWith('/api/social/me')).length
  socket?.push({ type: 'friend-request', from: { id: 'bayo-id', name: 'Bayo' } })
  await settle()
  assert.equal(ctx.client.state.profiles.size, 0)
  assert.equal(ctx.calls.filter((item) => item.path.startsWith('/api/social/me')).length, before + 1)
  socket?.push({ type: 'social-sync' })
  await settle()
  assert.deepEqual(ctx.commands, ['social.sync'], 'a social-sync also re-reads the life')
})

test('a friend\'s presence frame marks them, and one follow-up read is scheduled (22 s after they drop)', async () => {
  const ctx = setup({ '/api/social/me': () => overview({ friends: [{ id: 'f1', name: 'Femi', since: 1, bae: false, status: 'online', venue: 'market', cityId: 'lagos' }] }) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.sockets[0]?.push({ type: 'people-presence', id: 'f1', status: 'reconnecting' })
  const friend = ctx.client.state.me?.friends[0]
  assert.equal(friend?.status, 'reconnecting')
  assert.equal(friend?.venue, undefined)
  assert.equal(ctx.timers.at(-1)?.ms, 22000)
})

test('an accepted knock answer updates my own knock; the overview ending the visit clears it', async () => {
  const ctx = setup()
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.state.knock = { host: 'h1', name: 'Host', status: 'knocking', expiresAt: 9 }
  ctx.sockets[0]?.push({ type: 'invite-answer', host: { id: 'h1', name: 'Host' }, answer: 'accepted' })
  assert.equal(ctx.client.state.knock?.status, 'accepted')
  await settle()
  assert.equal(ctx.client.state.knock, null, 'the overview does not list the visit')
})

test('a guest joins the host\'s Home room once, and the presence frame fills the room', async () => {
  const visiting = { ...overview().house, host: { id: 'h1', name: 'Host' }, role: 'guest' as const }
  const ctx = setup({ '/api/social/me': () => overview({ visiting }) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.sockets[0]?.onopen?.()
  await settle()
  const joins = ctx.sockets[0]?.sent.map((frame) => JSON.parse(frame) as { type: string }).filter((frame) => frame.type === 'join')
  assert.deepEqual(joins, [{ type: 'join', cityId: 'lagos', venueId: 'home', hostId: 'h1' }])
  ctx.sockets[0]?.push({ type: 'presence', members: [{ id: 'h1', name: 'Host' }, { id: 'me-id', name: 'Ada' }] })
  assert.deepEqual(ctx.client.state.houseRoom, { host: 'h1', members: [{ id: 'h1', name: 'Host' }, { id: 'me-id', name: 'Ada' }] })
  ctx.sockets[0]?.push({ type: 'error', code: 'visit_ended', error: 'visit_ended' })
  assert.equal(ctx.client.state.houseRoom, null)
})

test('the socket closing reconnects with a back-off; after six tries it reads offline and is still tried every half minute; reconnect() tries at once', async () => {
  const ctx = setup()
  ctx.client.start(ctx.api)
  await settle()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    ctx.sockets.at(-1)?.onclose?.()
    assert.equal(ctx.client.state.socket, 'reconnecting')
    const timer = ctx.timers.at(-1)
    assert.equal(timer?.ms, Math.min(1000 * 2 ** attempt, 15000))
    timer?.run()
  }
  ctx.sockets.at(-1)?.onclose?.()
  assert.equal(ctx.client.state.socket, 'offline')
  const count = ctx.sockets.length
  // Never given up: the next try is booked, and the one after it when that fails too.
  assert.equal(ctx.timers.at(-1)?.ms, 30000)
  ctx.timers.at(-1)?.run()
  assert.equal(ctx.sockets.length, count + 1)
  ctx.sockets.at(-1)?.onclose?.()
  assert.deepEqual([ctx.client.state.socket, ctx.timers.at(-1)?.ms, ctx.timers.at(-1)?.cleared], ['offline', 30000, false])
  ctx.client.reconnect()
  assert.equal(ctx.sockets.length, count + 2)
  assert.equal(ctx.timers.filter((timer) => !timer.cleared && timer.ms === 30000).length, 0, 'the booked try was taken back')
  // Opened: the count starts again, and the state says so.
  ctx.sockets.at(-1)?.onopen?.()
  assert.equal(ctx.client.state.socket, 'open')
  ctx.sockets.at(-1)?.onclose?.()
  assert.deepEqual([ctx.client.state.socket, ctx.timers.at(-1)?.ms], ['reconnecting', 1000])
})

/** A client whose socket is open, with one thread read and one friend on the map; every later opening must bring all of it back. */
async function opened() {
  const ctx = setup({
    '/api/social/me': () => overview({ friends: [{ id: 'f1', name: 'Femi', since: 1, bae: false, status: 'online', venue: 'market', cityId: 'lagos' }] as SocialOverview['friends'] }),
    '/api/social/conversations/c1': () => ({ ok: true, conv: conv('c1'), messages: [message(1, 'c1')] }),
  })
  const seen = { calls: [] as string[], closes: 0, opens: [] as boolean[] }
  ctx.client.onCallFrame((frame) => { seen.calls.push(frame.type) })
  ctx.client.onSocketClose(() => { seen.closes += 1 })
  ctx.client.onSocketOpen((again) => { seen.opens.push(again) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.sockets[0]?.onopen?.()
  await ctx.client.openThread('c1')
  ctx.sockets[0]?.push({ type: 'live-snapshot', at: 9000, city: null, friends: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'park' }] })
  await settle()
  return { ...ctx, seen }
}
/** The socket just opened has everything again: the overview, the open thread, the people list, a live snapshot, and the call the server tells it about. */
async function whole(ctx: Awaited<ReturnType<typeof opened>>, index: number): Promise<void> {
  const socket = ctx.sockets[index]
  const before = ctx.calls.length
  socket?.onopen?.()
  await settle()
  assert.equal(ctx.client.state.socket, 'open')
  assert.deepEqual(sentTypes(socket), ['people-list', 'live-watch'])
  assert.deepEqual(ctx.calls.slice(before).map((call) => call.path).sort(), ['/api/social/conversations/c1?after=1', '/api/social/me?lite=1'])
  assert.equal(ctx.seen.opens.at(-1), true, 'the game is told it is a reconnection, and reads the life')
  socket?.push({ type: 'live-snapshot', at: 9000, city: null, friends: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'library' }] })
  socket?.push({ type: 'call-state', callId: 'k', state: 'accepted', role: 'callee', elsewhere: true, peer: { id: 'f1', name: 'Femi' } })
  assert.equal(ctx.client.state.me?.friends[0]?.venue, 'library')
  assert.equal(ctx.seen.calls.at(-1), 'call-state')
}

test('the network went and came back, the socket closing first: it reads offline while the game is not connected, and is opened as soon as the game hears from the server', async () => {
  const ctx = await opened()
  ctx.flags.connected = false
  ctx.sockets[0]?.onclose?.()
  assert.deepEqual([ctx.client.state.socket, ctx.client.state.live.friends.size, ctx.seen.closes], ['offline', 0, 1])
  assert.equal(ctx.booked(30000)?.cleared, false, 'still tried, slowly')
  ctx.backOnline()
  ctx.client.socketWanted()
  assert.equal(ctx.sockets.length, 1, 'nothing is opened while the game cannot reach the server')
  // The slow try finds the game still away, and books the next one.
  ctx.booked(30000)?.run()
  assert.deepEqual([ctx.sockets.length, ctx.booked(30000)?.cleared], [1, false])
  ctx.flags.connected = true
  ctx.client.socketWanted()
  assert.equal(ctx.sockets.length, 2)
  ctx.client.socketWanted()
  assert.equal(ctx.sockets.length, 2, 'once')
  await whole(ctx, 1)
})

test('the network came back before the stale socket closed: the socket is asked for a sign of life, its late close is still followed by a new socket', async () => {
  const ctx = await opened()
  ctx.flags.connected = false
  ctx.backOnline()
  assert.deepEqual(sentTypes(ctx.sockets[0]).at(-1), 'call-settings', 'the socket that is still there is not trusted')
  // The close arrives a moment later, while the game has not yet heard from the server.
  ctx.sockets[0]?.onclose?.()
  assert.deepEqual([ctx.client.state.socket, ctx.sockets.length], ['offline', 1])
  ctx.flags.connected = true
  ctx.client.socketWanted()
  assert.equal(ctx.sockets.length, 2)
  await whole(ctx, 1)
})

test('the network came back and the stale socket never closes: with no sign of life in four seconds it is closed and replaced; what it says afterwards is ignored', async () => {
  const ctx = await opened()
  ctx.backOnline()
  assert.deepEqual(sentTypes(ctx.sockets[0]).at(-1), 'call-settings')
  ctx.booked(4000)?.run()
  assert.deepEqual([ctx.sockets[0]?.closed, ctx.sockets.length, ctx.seen.closes, ctx.client.state.live.friends.size], [true, 2, 1, 0])
  ctx.sockets[0]?.push({ type: 'live-snapshot', at: 9000, city: null, friends: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'beach' }] })
  ctx.sockets[0]?.onclose?.()
  assert.deepEqual([ctx.client.state.live.friends.size, ctx.sockets.length, ctx.seen.closes], [0, 2, 1])
  await whole(ctx, 1)
  // The same while the game was not connected yet: the dead socket is dropped at once and the new one waits for the game.
  const late = await opened()
  late.flags.connected = false
  late.backOnline()
  late.booked(4000)?.run()
  assert.deepEqual([late.sockets[0]?.closed, late.sockets.length, late.client.state.socket], [true, 1, 'offline'])
  late.flags.connected = true
  late.client.socketWanted()
  assert.equal(late.sockets.length, 2)
  await whole(late, 1)
})

test('a socket that went silent is asked for a sign of life: an answer keeps it, none replaces it; a socket that never finished opening is replaced when the device is online', async () => {
  const ctx = await opened()
  // Frames arrived since it opened: nothing is asked.
  ctx.booked(25000)?.run()
  assert.equal(sentTypes(ctx.sockets[0]).includes('call-settings'), false)
  // A quiet stretch: asked, and answered.
  ctx.booked(25000)?.run()
  assert.equal(sentTypes(ctx.sockets[0]).at(-1), 'call-settings')
  ctx.sockets[0]?.push({ type: 'call-settings', calls: 'friends' })
  ctx.booked(4000)?.run()
  assert.deepEqual([ctx.sockets.length, ctx.sockets[0]?.closed, ctx.client.state.socket], [1, false, 'open'])
  // Quiet again, and this time nothing comes back.
  ctx.booked(25000)?.run()
  ctx.booked(4000)?.run()
  assert.deepEqual([ctx.sockets.length, ctx.sockets[0]?.closed], [2, true])
  // The new one has not opened when the device comes online again: it is not waited for.
  ctx.backOnline()
  assert.deepEqual([ctx.sockets.length, ctx.sockets[1]?.closed], [3, true])
  ctx.sockets[1]?.onopen?.()
  assert.notEqual(ctx.client.state.socket, 'open', 'a socket that was replaced opens nothing')
  await whole(ctx, 2)
})

test('a hidden page opens no socket and asks nothing; it is opened when the page is in front again', async () => {
  const ctx = await opened()
  ctx.flags.visible = false
  ctx.booked(25000)?.run(); ctx.booked(25000)?.run()
  assert.equal(sentTypes(ctx.sockets[0]).includes('call-settings'), false)
  ctx.sockets[0]?.onclose?.()
  ctx.booked(1000)?.run()
  assert.equal(ctx.sockets.length, 1)
  assert.ok(ctx.timers.some((timer) => !timer.cleared && timer.ms > 1000), 'looked at again later')
  ctx.flags.visible = true
  ctx.client.wakeSocket()
  assert.equal(ctx.sockets.length, 2)
  await whole(ctx, 1)
})

test('perform toasts the reason when refused, the good text when done, and reads the overview either way', async () => {
  let ok = false
  const ctx = setup({ '/api/social/friends/answer': () => (ok ? { ok: true, code: 'accepted' } : { ok: false, code: 'no_request', reason: 'There is no request.' }) })
  ctx.client.start(ctx.api)
  await settle()
  const before = ctx.calls.filter((item) => item.path.startsWith('/api/social/me')).length
  const refused = await ctx.client.perform('/api/social/friends/answer', { from: 'a', accept: true }, 'You are now friends')
  assert.equal(refused.ok, false)
  ok = true
  await ctx.client.perform('/api/social/friends/answer', { from: 'a', accept: true }, 'You are now friends')
  assert.deepEqual(ctx.toasts, ['There is no request.', 'You are now friends'])
  assert.equal(ctx.calls.filter((item) => item.path.startsWith('/api/social/me')).length, before + 2)
})

test('call never throws: a network failure and a server refusal both come back as { ok: false }', async () => {
  const ctx = setup({ '/api/social/search': () => failure(undefined), '/api/social/block': () => failure(400, { reason: 'Nope.', code: 'x' }) })
  ctx.client.start(ctx.api)
  await settle()
  assert.deepEqual(await ctx.client.call('/api/social/search?q=ab'), { ok: false, code: 'network', reason: 'Connection lost. Nothing was changed; try again.', transport: true })
  assert.deepEqual(await ctx.client.call('/api/social/block', {}), { ok: false, code: 'x', reason: 'Nope.', transport: false })
})

test('loadProfile ignores an answer that arrives after the profiles were invalidated', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ctx = setup({ '/api/social/players/*': async () => { await gate; return { ok: true, code: 'ok', player: { id: 'p', name: 'Pat', friend: true } } } })
  ctx.client.start(ctx.api)
  await settle()
  const loading = ctx.client.loadProfile('p')
  ctx.sockets[0]?.push({ type: 'friend-accepted', by: { id: 'p', name: 'Pat' } })
  release()
  await loading
  assert.equal(ctx.client.state.profiles.has('p'), false)
})

test('the people list: read for the city, kept, announced to watchers; a change that arrives mid-read is read again', async () => {
  let reads = 0
  const ctx = setup({ '/api/social/people': () => ({ ok: true, code: 'ok', cityId: 'lagos', venue: 'market', self: 'joined', players: [], count: ++reads }) })
  ctx.client.start(ctx.api)
  await settle()
  const seen: unknown[] = []
  const stop = ctx.client.onPeople((people) => seen.push(people))
  const first = ctx.client.loadPeople()
  void ctx.client.loadPeople()
  await first
  await settle()
  assert.equal(reads, 2)
  assert.ok(ctx.calls.some((item) => item.path === '/api/social/people?city=lagos'))
  assert.equal(ctx.client.state.peopleAt, 1000)
  assert.equal(seen.length, 2)
  stop()
})

test('resetSocial drops everything that belonged to the previous identity and closes its socket', async () => {
  const ctx = setup()
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.send('dm.a.b', { conv: 'dm.a.b' }, 'x')
  ctx.client.state.knock = { host: 'h', name: 'H', status: 'sending' }
  ctx.client.resetSocial()
  assert.equal(ctx.client.state.me, null)
  assert.equal(ctx.client.state.knock, null)
  assert.equal(ctx.client.state.socket, 'idle')
  assert.equal(ctx.client.outbox.size(), 0)
  assert.equal(ctx.sockets[0]?.closed, true)
})

test('the state is reactive: a computed follows the overview and the outbox without any redraw call', async () => {
  const ctx = setup({ '/api/social/messages': () => failure(undefined) })
  ctx.client.start(ctx.api)
  await settle()
  const friends = computed(() => ctx.client.state.me?.friends.length ?? -1)
  const pending = computed(() => ctx.client.threadView('c').length)
  assert.equal(friends.value, 0)
  assert.equal(pending.value, 0)
  const me = ctx.client.state.me
  me?.friends.push({ id: 'f', name: 'F', since: 1, bae: false, status: 'offline' })
  assert.equal(friends.value, 1)
  ctx.client.send('c', { conv: 'c' }, 'x')
  assert.equal(pending.value, 1, 'the outbox is followed through the revision counter')
  assert.ok(ctx.flags.refreshes > 0, 'the host is told too, for the panels that are not reactive')
})

// Port of src/ui/panels/social-client.test.js.
test('first incoming DM adopts an open provisional chat, marks read and keeps retries unique', async () => {
  const sender = conv('dm.receiver.sender', { with: 'sender', name: 'Sender', unread: 1 })
  const first = message(1, sender.id, { clientId: 'first-id', body: 'First message', from: { id: 'sender', name: 'Sender' } })
  const reply = message(2, sender.id, { clientId: 'reply-id', body: 'Reply waiting for acknowledgement', from: { id: 'receiver', name: 'Receiver' } })
  const ctx = setup({
    '/api/social/conversations/*/read': () => ({ ok: true, code: 'read', conv: { ...sender, unread: 0 } }),
    '/api/social/conversations/*': () => ({ ok: true, code: 'ok', conv: { ...sender, unread: 0 }, messages: [first, reply], read: 0 }),
  })
  ctx.client.start(ctx.api)
  await settle()
  ctx.client.state.me = overview({ me: { id: 'receiver', name: 'Receiver', since: 1 }, conversations: [] })
  ctx.client.state.openConv = 'to:sender'
  ctx.client.outbox.add('to:sender', reply.body, 'reply-id', 1)
  const readsOf = (): number => ctx.calls.filter((item) => item.path.endsWith('/read')).length
  const socket = ctx.sockets[0]
  socket?.push({ type: 'dm', conv: sender, message: first })
  assert.equal(ctx.client.state.openConv, sender.id, 'an already open new chat must display the first incoming message')
  assert.equal(ctx.client.outbox.get('reply-id')?.key, sender.id, 'a pending reply follows the real conversation')
  assert.deepEqual(ctx.client.threadView(sender.id).map((item) => item.body), [first.body, reply.body])
  await settle()
  assert.equal(ctx.client.state.me?.conversations[0]?.unread, 0)
  assert.equal(readsOf(), 1)
  assert.deepEqual(ctx.toasts, [], 'the visible conversation is read, not announced as a different chat')

  socket?.push({ type: 'dm', conv: sender, message: first })
  socket?.push({ type: 'dm', conv: sender, message: reply })
  assert.deepEqual(ctx.client.threadView(sender.id).map((item) => ('seq' in item ? item.seq : null)), [1, 2], 'duplicate pushes and the pending echo do not double a message')
  assert.equal(ctx.client.outbox.size(), 0)
  await ctx.client.openThread(sender.id)
  assert.deepEqual(ctx.client.threadView(sender.id).map((item) => ('seq' in item ? item.seq : null)), [1, 2], 'history refresh merges without duplication')

  const readsBefore = readsOf()
  ctx.client.state.openConv = 'to:another-person'
  socket?.push({ type: 'dm', conv: sender, message: { ...first, seq: 3 } })
  assert.equal(ctx.client.state.openConv, 'to:another-person', 'a message from someone else must not steal the open chat')
  socket?.push({ type: 'dm', conv: conv('group.one', { kind: 'group', name: 'Group' }), message: first })
  assert.equal(ctx.client.state.openConv, 'to:another-person', 'group messages do not adopt a provisional direct chat')
  assert.equal(readsOf(), readsBefore, 'background messages remain unread')
})

// ---- live location ---------------------------------------------------------------------------------
const friendRow = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, since: 1, bae: false, status: 'offline', ...extra })
const sentTypes = (socket: FakeSocket | undefined): string[] => (socket?.sent ?? []).map((frame) => (JSON.parse(frame) as { type: string }).type)

test('live location: the snapshot and each move are written over the friend rows, and a re-read of the overview does not put an older place back', async () => {
  const ctx = setup({ '/api/social/me': () => overview({ friends: [friendRow('f1', 'Femi', { status: 'online', venue: 'market', cityId: 'lagos' }), friendRow('f2', 'Gbenga')] as SocialOverview['friends'] }) })
  let told = 0
  ctx.client.onLive(() => { told += 1 })
  ctx.client.start(ctx.api)
  await settle()
  ctx.sockets[0]?.onopen?.()
  await settle()
  const socket = ctx.sockets[0]
  // The device's clock is 5000; the server's is 105000. A trip that began at 100000 and takes 10 s has 5 s to run.
  socket?.push({ type: 'live-snapshot', at: 105000, city: { cityId: 'lagos', venues: { park: 2 }, moving: 1 }, friends: [
    { id: 'f1', status: 'online', cityId: 'lagos', trip: { from: 'market', to: 'park', mode: 'keke', startedAt: 100000, duration: 10 } },
    { id: 'f2', status: 'online', cityId: 'ibadan', venue: 'agodi-gardens' },
  ] })
  const [femi, gbenga] = ctx.client.state.me?.friends ?? []
  assert.deepEqual([femi?.status, femi?.venue, femi?.going, femi?.cityId], ['away', undefined, 'park', 'lagos'], 'on a trip: no venue, and where to')
  assert.deepEqual([gbenga?.status, gbenga?.venue, gbenga?.cityId], ['online', 'agodi-gardens', 'ibadan'])
  assert.equal(ctx.client.liveNow(), 105000, 'the server clock comes from the frame')
  assert.equal(ctx.client.state.live.city?.venues.park, 2)
  assert.ok(told >= 1, 'the map host is told')
  // ONE follow-up is booked for the moment the trip reaches its door: no repeating timer.
  const booked = ctx.timers.filter((timer) => !timer.cleared && timer.ms === 5050)
  assert.equal(booked.length, 1)

  // A re-read of the overview still says "market": the live table wins.
  await ctx.client.sync()
  assert.deepEqual([ctx.client.state.me?.friends[0]?.status, ctx.client.state.me?.friends[0]?.going, ctx.client.state.me?.friends[0]?.venue], ['away', 'park', undefined])

  // He arrives, then goes home, then his connection drops.
  socket?.push({ type: 'live-move', at: 111000, spots: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'park' }], city: { cityId: 'lagos', venues: { park: 3 }, moving: 0 } })
  assert.deepEqual([ctx.client.state.me?.friends[0]?.status, ctx.client.state.me?.friends[0]?.venue, ctx.client.state.me?.friends[0]?.going], ['online', 'park', undefined])
  assert.equal(ctx.client.state.live.city?.venues.park, 3)
  socket?.push({ type: 'live-move', at: 112000, spots: [{ id: 'f1', status: 'reconnecting', seenAt: 112000 }] })
  assert.deepEqual([ctx.client.state.me?.friends[0]?.status, ctx.client.state.me?.friends[0]?.venue, ctx.client.state.me?.friends[0]?.cityId, ctx.client.state.me?.friends[0]?.seenAt], ['reconnecting', undefined, undefined, 112000])
  // The older presence frame does not undo what the live frame said.
  socket?.push({ type: 'live-move', at: 113000, spots: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'home' }] })
  socket?.push({ type: 'people-presence', id: 'f1', status: 'online' })
  assert.deepEqual([ctx.client.state.me?.friends[0]?.status, ctx.client.state.me?.friends[0]?.venue], ['online', 'home'])
})

test('live location: watched again only when the city or the friends changed; a closed socket forgets what it knew and the next one asks afresh', async () => {
  let friends = [friendRow('f1', 'Femi')] as SocialOverview['friends']
  const ctx = setup({ '/api/social/me': () => overview({ friends }) })
  ctx.client.start(ctx.api)
  await settle()
  ctx.sockets[0]?.onopen?.()
  await settle()
  assert.deepEqual(sentTypes(ctx.sockets[0]), ['people-list', 'live-watch'])
  await ctx.client.sync(); await ctx.client.sync()
  assert.deepEqual(sentTypes(ctx.sockets[0]), ['people-list', 'live-watch'], 'the same friends: not asked again')
  friends = [...friends, friendRow('f2', 'Gbenga')] as SocialOverview['friends']
  await ctx.client.sync()
  assert.deepEqual(sentTypes(ctx.sockets[0]), ['people-list', 'live-watch', 'live-watch'], 'a new friend is watched')

  ctx.sockets[0]?.push({ type: 'live-snapshot', at: 9000, city: { cityId: 'lagos', venues: { park: 1 }, moving: 0 }, friends: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'park' }] })
  assert.equal(ctx.client.state.live.friends.size, 1)
  let told = 0
  ctx.client.onLive(() => { told += 1 })
  ctx.sockets[0]?.onclose?.()
  assert.deepEqual([ctx.client.state.live.friends.size, ctx.client.state.live.city], [0, null], 'nothing stale is kept on the map')
  assert.equal(told, 1)
  ctx.timers.at(-1)?.run()
  ctx.sockets[1]?.onopen?.()
  await settle()
  assert.deepEqual(sentTypes(ctx.sockets[1]), ['people-list', 'live-watch'])
  // A new identity starts with nothing.
  ctx.sockets[1]?.push({ type: 'live-snapshot', at: 9000, city: null, friends: [{ id: 'f1', status: 'online', cityId: 'lagos', venue: 'park' }] })
  ctx.client.resetSocial()
  assert.equal(ctx.client.state.live.friends.size, 0)
})
