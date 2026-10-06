// The paged reads of the social screens against a fake host: the paths asked for, how a page of chats and older lines joins what is held,
// and that a failure leaves it as it was.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Conversation, Message, SocialOverview } from '../../../types/social.ts'
import type { PanelApi, PanelView } from '../../types/panel.ts'
import type { FetchOptions } from '../../types/client.ts'
import { CHATS_PAGE, OLDER_PAGE, PLAYERS_PAGE, fetchPlayers, loadMoreChats, loadOlder, openChatWith, sendToMany } from './socialPages.ts'
import { attach, social } from './useSocial.ts'

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({ id, kind: 'dm', name: id, members: [], owner: null, with: null, last: null, unread: 0, ...extra })
const line = (seq: number): Message => ({ seq, id: `c#${seq}`, conv: 'c', from: null, body: `m${seq}`, at: seq })
const calls: { path: string; options?: FetchOptions }[] = []
let answer: (path: string) => unknown = () => ({ ok: false, code: 'none', reason: 'no route' })
attach({ view: () => ({ connected: true, cityId: 'lagos', now: 1 }) as unknown as PanelView, fetchJson: async (path: string, options?: FetchOptions) => { calls.push({ path, options }); const got = answer(path); if (got instanceof Error) throw got; return got } } as unknown as PanelApi)
const overview = (extra: Partial<SocialOverview>): SocialOverview => ({ ok: true, code: 'ok', conversations: [], ...extra } as SocialOverview)

test('the Players view asks for a page by sort, query and cursor, and reports the counters of the first page only', async () => {
  answer = () => ({ ok: true, code: 'ok', players: [{ id: 'a', name: 'A' }], total: 12, next: 'n:1:a', gone: 2, online: 3, sort: 'newest' })
  let counters: unknown = null
  const first = await fetchPlayers({ q: ' ada ', sort: 'name', city: 'lagos' }, null, (next) => { counters = next })
  assert.deepEqual(calls.at(-1)?.path, `/api/social/everyone?sort=name&limit=${PLAYERS_PAGE}&q=ada`)
  assert.deepEqual([first.ok && first.next, first.ok && first.total, counters], ['n:1:a', 12, { online: 3, gone: 2 }])
  counters = null
  await fetchPlayers({ q: '', sort: 'city', city: 'lagos' }, 'n:1:a', (next) => { counters = next })
  assert.equal(calls.at(-1)?.path, `/api/social/everyone?sort=city&limit=${PLAYERS_PAGE}&city=lagos&after=n%3A1%3Aa`)
  assert.equal(counters, null)
  answer = () => ({ ok: false, code: 'rate_limited', reason: 'Too quick.' })
  assert.deepEqual(await fetchPlayers({ q: '', sort: 'newest', city: 'lagos' }, null, () => {}), { ok: false, reason: 'Too quick.' })
})

test('the rest of the chat list joins the loaded chats once each, keeps the unread count of the chats not loaded, and ignores an answer for an older overview', async () => {
  social.me = overview({ conversations: [conv('a', { unread: 1 }), conv('b')], conversationsMore: { total: 5, next: 'c1', unreadOlder: 4 } })
  answer = () => ({ ok: true, code: 'ok', conversations: [conv('b'), conv('c', { unread: 3 }), conv('d', { unread: 1, muted: true, mentions: 0 })], total: 5, next: null, unread: 0 })
  assert.equal(await loadMoreChats(), true)
  assert.equal(calls.at(-1)?.path, `/api/social/conversations?limit=${CHATS_PAGE}&after=c1`)
  assert.deepEqual(social.me?.conversations.map((item) => item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(social.me?.conversationsMore, { total: 5, next: null, unreadOlder: 1 })
  assert.equal(await loadMoreChats(), false, 'nothing more to ask for')
  // The overview was read again while the page was on its way: that page is not added to the new one.
  social.me = overview({ conversations: [conv('a')], conversationsMore: { total: 5, next: 'c9', unreadOlder: 0 } })
  answer = () => { social.me = overview({ conversations: [conv('z')], conversationsMore: { total: 5, next: 'c10', unreadOlder: 0 } }); return { ok: true, code: 'ok', conversations: [conv('q')], total: 5, next: null, unread: 0 } }
  assert.equal(await loadMoreChats(), false)
  assert.deepEqual(social.me?.conversations.map((item) => item.id), ['z'])
})

test('older lines are put before the ones held, by line number, and say whether more are kept', async () => {
  social.threads.set('c', { messages: [line(161), line(162)], loaded: true, error: null })
  answer = () => ({ ok: true, code: 'ok', conv: conv('c'), messages: [line(159), line(160), line(161)], read: 0, more: true })
  assert.deepEqual(await loadOlder('c'), { added: 2, more: true })
  assert.equal(calls.at(-1)?.path, `/api/social/conversations/c?before=161&limit=${OLDER_PAGE}`)
  assert.deepEqual(social.threads.get('c')?.messages.map((item) => item.seq), [159, 160, 161, 162])
  answer = () => ({ ok: true, code: 'ok', conv: conv('c'), messages: [], read: 0, more: false })
  assert.deepEqual(await loadOlder('c'), { added: 0, more: false })
  social.threads.set('c', { messages: [line(1)], loaded: true, error: null })
  const before = calls.length
  assert.deepEqual(await loadOlder('c'), { added: 0, more: false }, 'the first line is the first: nothing is asked for')
  assert.equal(calls.length, before)
  answer = () => ({ ok: false, code: 'network', reason: 'Offline.' })
  social.threads.set('c', { messages: [line(50)], loaded: true, error: null })
  assert.equal(await loadOlder('c'), null)
  assert.deepEqual(social.threads.get('c')?.messages.map((item) => item.seq), [50])
})

test('opening a chat puts the conversation in the list; a player never talked to has none', async () => {
  social.me = overview({ conversations: [conv('a')] })
  answer = () => ({ ok: true, code: 'ok', conv: conv('dm.x') })
  assert.equal((await openChatWith('x'))?.id, 'dm.x')
  assert.deepEqual(calls.at(-1)?.options?.body, { with: 'x' })
  assert.deepEqual(social.me?.conversations.map((item) => item.id), ['dm.x', 'a'])
  await openChatWith('x')
  assert.equal(social.me?.conversations.length, 2, 'not added twice')
  answer = () => ({ ok: true, code: 'ok', conv: null })
  assert.equal(await openChatWith('y'), null)
  answer = () => ({ ok: true, code: 'sent', results: [], sent: 0 })
  await sendToMany(['a', 'b'], 'Hello', '1000:abc')
  assert.deepEqual(calls.at(-1)?.options?.body, { to: ['a', 'b'], body: 'Hello', clientId: '1000:abc' })
})
