// The conversation's own components rendered to a string: what a bubble shows (mention chips, a quote, large emoji, a gift's money
// line, reaction chips), the emoji picker, the composer's reply bar and the group panel. What a click does is in messagesText.test.ts.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Conversation, Message, MessagePinsView, MoneyRequestView, SocialOverview } from '../../../types/social.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
before(async () => { vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } }) })
after(async () => { await vite?.close() })
async function render(path: string, props: Record<string, unknown>): Promise<string> {
  const component = ((await vite.ssrLoadModule(path)) as { default: Component }).default
  return (await renderToString(createSSRApp({ render: () => h(component, props) }))).replace(/<!--.*?-->/g, '').replace(/ data-v-[0-9a-f]+/g, '').replace(/&#39;/g, "'")
}
const words = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const line = (extra: Partial<Message> = {}): Message => ({ seq: 4, id: 'g.1#4', conv: 'g.1', from: { id: 'bola', name: 'Bola' }, body: 'Hi', at: 1, ...extra })
const bubble = (item: Message, extra: Record<string, unknown> = {}): Promise<string> => render('/src/app/features/messages/MessageBubble.vue', { item, meId: 'ada', group: true, head: true, tail: true, time: '10:15', canReact: true, canActions: true, ...extra })

test('a bubble shows the name on the first line of a run, mention chips that open a card, and the time on the last', async () => {
  const html = await bubble(line({ body: 'Hi @Ada and @everyone', mentions: [{ id: 'ada', start: 3, end: 7 }, { id: 'everyone', start: 12, end: 21 }] }))
  assert.match(html, /class="bubble-name"[^>]*>Bola</)
  assert.match(html, /<button[^>]*class="chip"[^>]*aria-label="Open Ada's card"[^>]*>@Ada<\/button>/)
  assert.match(html, /<span class="chip is-all">@everyone<\/span>/)
  assert.ok(words(html).includes('10:15'))
  const middle = await bubble(line(), { head: false, tail: false })
  assert.ok(!middle.includes('bubble-name') && !words(middle).includes('10:15'))
  assert.ok(!(await bubble(line({ from: { id: 'ada', name: 'Ada' } }))).includes('bubble-name'), 'your own lines carry no name')
  const hostile = await bubble(line({ body: '<img src=x onerror=alert(1)>' }))
  assert.ok(!hostile.includes('<img') && hostile.includes('&lt;img'))
})

test('a reply shows its frozen quote as a button, and a message of only emoji is large', async () => {
  const html = await bubble(line({ body: 'Same here', replyTo: { seq: 2, from: { id: 'chi', name: 'Chidi' }, text: 'Dinner at eight' } }))
  assert.match(html, /<button[^>]*class="bubble-quote"[^>]*aria-label="Show the message from Chidi"[^>]*><b>Chidi<\/b><span>Dinner at eight<\/span>/)
  assert.match(await bubble(line({ body: '😂' })), /class="is-big bubble-text" style="font-size:44px/)
  assert.match(await bubble(line({ body: '😂😂😂' })), /font-size:30px/)
  assert.ok(!(await bubble(line({ body: '😂😂😂😂' }))).includes('is-big'))
  assert.ok(!(await bubble(line({ body: '😂', replyTo: { seq: 2, from: null, text: 'x' } }))).includes('is-big bubble-text'))
})

test('a gift is a money line with the amount, and the share that paid a ride debt is for the receiver', async () => {
  const gift = line({ body: 'Sent ₦1,500', from: { id: 'ada', name: 'Ada' }, gift: { amount: 1500 } })
  const sender = words(await bubble(gift))
  assert.ok(sender.includes('You sent ₦1,500') && sender.includes('10:15'))
  const received = line({ body: 'Sent ₦1,500', gift: { amount: 1500, repaid: 750 } })
  const receiver = words(await bubble(received))
  assert.ok(receiver.includes('Bola sent you ₦1,500') && receiver.includes('₦750 went to your ride home'))
  assert.match(await bubble(gift), /aria-label="coin"|<svg/)
})

test('reaction permission is separate from the accessible message actions used in house chats', async () => {
  const html = await bubble(line({ reactions: [{ emoji: '👍', count: 2, mine: true }, { emoji: '😂', count: 1 }] }))
  assert.match(html, /aria-pressed="true" aria-label="👍 2, yours"/)
  assert.match(html, /aria-pressed="false" aria-label="😂 1"/)
  const houseHost = await bubble(line({ reactions: [{ emoji: '👍', count: 1 }] }), { canReact: false, canActions: true, canPin: true })
  assert.match(houseHost, /<button[^>]*class="reaction"[^>]*disabled/)
  assert.match(houseHost, /class="bubble-more"[^>]*aria-label="Message actions, including Pin message"/)
  const readOnly = await bubble(line(), { canReact: false, canActions: false, canPin: false })
  assert.ok(!readOnly.includes('bubble-more'))
  const picker = await render('/src/app/features/messages/EmojiPicker.vue', {})
  assert.match(picker, /aria-label="Search emoji"/)
  assert.ok((picker.match(/<button[^>]*aria-label="[^"]*"[^>]*>[^<]+<\/button>/g) ?? []).length > 50, 'a grid of emoji buttons')
})

test('pinned messages render three bounded rows, filtered-empty management, and offline controls', async () => {
  const items = [line({ seq: 1, id: 'g.1#1', body: 'Meet at the library' }), line({ seq: 2, id: 'g.1#2', body: '', image: { id: 'picture', width: 80, height: 60 } }), line({ seq: 3, id: 'g.1#3', body: '', voice: { id: 'voice', durationMs: 5000 } })]
  const pins: MessagePinsView = { scope: 'scope-1', revision: 3, canManage: true, items: items.map((message) => ({ message })) }
  const html = await render('/src/app/features/messages/PinnedMessages.vue', { pins, kind: 'group', loading: false, pending: false, retryable: false, disabled: false, error: '' })
  const rows = [...html.matchAll(/<button[^>]*class="pinned-row"[^>]*>(.*?)<\/button>/g)].map((match) => words(match[1] ?? ''))
  assert.deepEqual(rows, ['Bola Meet at the library', 'Bola Picture', 'Bola Voice message'])
  assert.ok(words(html).includes('Clear all also removes shared pins you cannot see.'))

  const filtered: MessagePinsView = { ...pins, items: [] }
  const offline = await render('/src/app/features/messages/PinnedMessages.vue', { pins: filtered, kind: 'group', loading: false, pending: false, retryable: false, disabled: true, error: '' })
  assert.ok(words(offline).includes('No shared pins you can see.'))
  assert.match(offline, /class="pinned-clear"[^>]*disabled/)
  const member = await render('/src/app/features/messages/PinnedMessages.vue', { pins: { ...filtered, canManage: false, items: [{ message: items[0]! }] }, kind: 'group', loading: false, pending: false, retryable: false, disabled: false, error: '' })
  assert.ok(!member.includes('pinned-clear') && words(member).includes('Only the group owner can change them.'))
})

test('an older pinned picture or voice preview stays label-only and does not load media', async () => {
  const picture = await bubble(line({ body: 'Caption', image: { id: 'private-picture', width: 80, height: 60 } }), { preview: true, canReact: false, canActions: true, canPin: true, pinned: true })
  assert.ok(words(picture).includes('Picture Caption'))
  assert.ok(!picture.includes('<img') && !picture.includes('private-picture'))
  assert.match(picture, /aria-label="Message actions, including Unpin message"/)
  const voice = await bubble(line({ body: '', voice: { id: 'private-voice', durationMs: 5000 } }), { preview: true, canReact: false, canActions: true, canPin: true, pinned: true })
  assert.ok(words(voice).includes('Voice message'))
  assert.ok(!voice.includes('<audio') && !voice.includes('/api/social/voice') && !voice.includes('private-voice'))
})

test('the composer shows the message being answered and a message box that is named', async () => {
  const html = await render('/src/app/features/messages/Composer.vue', { conv: 'g.1', members: [{ id: 'bola', name: 'Bola' }], meId: 'ada', admin: false, max: 500, disabled: false, reply: line({ body: 'Dinner at eight' }), prefill: '' })
  assert.ok(words(html).includes('Bola Dinner at eight'))
  assert.match(html, /aria-label="Cancel reply"/)
  assert.match(html, /<textarea[^>]*aria-label="Message"/)
  assert.match(html, /aria-label="Emoji"/)
  const off = await render('/src/app/features/messages/Composer.vue', { conv: 'g.1', members: [], meId: 'ada', admin: false, max: 500, disabled: true, reply: null, prefill: '' })
  assert.match(off, /<textarea[^>]*disabled/)
})

test('the group panel: people with the admin marked, who may change them, the size and how to leave', async () => {
  const conv: Conversation = { id: 'g.1', kind: 'group', name: 'Weekend Crew', members: [{ id: 'ada', name: 'Ada' }, { id: 'bola', name: 'Bola' }], owner: 'ada', with: null, last: null, unread: 0 }
  const me = { me: { id: 'ada', name: 'Ada', since: 1 }, limits: { groupSize: 12, groupName: 32 } } as unknown as SocialOverview
  const admin = words(await render('/src/app/features/messages/GroupManage.vue', { conv, me }))
  assert.ok(admin.includes('2 of 12 people') && admin.includes('Ada (you) Admin') && admin.includes('Bola Remove') && admin.includes('Rename') && admin.includes('Add people') && admin.includes('Leave group') && admin.includes('Report group'))
  const member = words(await render('/src/app/features/messages/GroupManage.vue', { conv, me: { ...me, me: { id: 'bola', name: 'Bola', since: 1 } } }))
  assert.ok(!member.includes('Remove') && !member.includes('Add people') && member.includes('Ada runs this group'))
  const full = words(await render('/src/app/features/messages/GroupManage.vue', { conv: { ...conv, members: Array.from({ length: 12 }, (_, i) => ({ id: i ? `m${i}` : 'ada', name: `P${i}` })) }, me }))
  assert.ok(full.includes('12 of 12'))
})

test('a request for money is a card: the friend asked gets Pay and Decline, the asker gets Cancel, and a resolved card has none', async () => {
  const request: MoneyRequestView = { id: 'MR-1', amount: 1500, note: 'Lunch', state: 'open', mine: false, expiresAt: 5000, payable: true }
  const card = (view: Partial<MoneyRequestView>, extra: Record<string, unknown> = {}) => bubble(line({ body: 'Asked for ₦1,500: Lunch', request: { ...request, ...view } }), { now: 1000, ...extra })
  const asked = await card({})
  assert.match(asked, /role="group"[^>]*aria-label="Bola asked you ₦1,500: Lunch\. Open\."/)
  assert.ok(words(asked).includes('Bola asked you') && words(asked).includes('₦1,500') && words(asked).includes('Lunch') && words(asked).includes('Open'))
  assert.match(asked, />Pay<\/button>/); assert.match(asked, />Decline<\/button>/); assert.ok(!asked.includes('Cancel request'))
  const own = await card({ mine: true, payable: false }, { partner: 'Chidi' })
  assert.ok(words(own).includes('You asked Chidi') && !words(own).includes('You asked Bola')); assert.match(own, />Cancel request<\/button>/); assert.ok(!own.includes('>Pay<'))
  for (const [state, label] of [['paid', 'Paid'], ['declined', 'Declined'], ['cancelled', 'Cancelled']] as const) {
    const done = await card({ state })
    assert.ok(words(done).includes(label), state); assert.ok(!done.includes('request-btn'), `${state} has no buttons`)
  }
  const late = await card({}, { now: 5000 })
  assert.ok(words(late).includes('Expired') && !late.includes('request-btn'), 'out of time, with no write yet')
  assert.match(await card({}, { requestBusy: true }), /<button[^>]*disabled[^>]*>Working…<\/button>/)
  assert.match(await card({}, { requestOffline: true }), /<button[^>]*disabled[^>]*>Pay<\/button>/)
  const menu = await card({}, { canActions: true })
  assert.ok(!menu.includes('class="bubble-text"'), 'a card is not words')
  const hostile = await card({ note: '<img src=x onerror=alert(1)>' })
  assert.ok(!hostile.includes('<img') && hostile.includes('&lt;img'))
})
