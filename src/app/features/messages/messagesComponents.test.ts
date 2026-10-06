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
import type { Conversation, Message, SocialOverview } from '../../../types/social.ts'

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
const bubble = (item: Message, extra: Record<string, unknown> = {}): Promise<string> => render('/src/app/features/messages/MessageBubble.vue', { item, meId: 'ada', group: true, head: true, tail: true, time: '10:15', canReact: true, ...extra })

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

test('reactions are counted chips, yours is pressed, and the six quick ones are in the menu', async () => {
  const html = await bubble(line({ reactions: [{ emoji: '👍', count: 2, mine: true }, { emoji: '😂', count: 1 }] }))
  assert.match(html, /aria-pressed="true" aria-label="👍 2, yours"/)
  assert.match(html, /aria-pressed="false" aria-label="😂 1"/)
  const off = await bubble(line({ reactions: [{ emoji: '👍', count: 1 }] }), { canReact: false })
  assert.match(off, /<button[^>]*class="reaction"[^>]*disabled/)
  assert.ok(!off.includes('bubble-more'))
  const picker = await render('/src/app/features/messages/EmojiPicker.vue', {})
  assert.match(picker, /aria-label="Search emoji"/)
  assert.ok((picker.match(/<button[^>]*aria-label="[^"]*"[^>]*>[^<]+<\/button>/g) ?? []).length > 50, 'a grid of emoji buttons')
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
