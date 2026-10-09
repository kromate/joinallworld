import test from 'node:test'
import assert from 'node:assert/strict'
import { composerLines, createDrafts, dayLabel, emojiOnly, filterChats, giftDetail, giftLine, insertMention, liveMentions, mentionChoices, mentionQuery, pieces, shortcodes, sortChats, threadRows } from './messagesText.ts'
import { EMOJI_CATEGORIES, QUICK_REACTIONS } from './emojiData.ts'
import type { Conversation, Message } from '../../../types/social.ts'

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime()
const msg = (seq: number, from: string | null, when: number, body = 'x', extra: Partial<Message> = {}): Message => ({ seq, id: `c#${seq}`, conv: 'c', from: from ? { id: from, name: from } : null, body, at: when, ...extra })

test('days are Today, Yesterday, a weekday or a date', () => {
  const now = at(2026, 10, 6)
  assert.equal(dayLabel(at(2026, 10, 6, 1), now), 'Today')
  assert.equal(dayLabel(at(2026, 10, 5, 23), now), 'Yesterday')
  assert.match(dayLabel(at(2026, 10, 2), now), /^(Friday)$/)
  assert.match(dayLabel(at(2026, 9, 1), now), /1 Sep/)
  assert.match(dayLabel(at(2025, 9, 1), now), /2025/)
})

test('a thread is cut by day and grouped by sender: the name on the first line of a run, the time on the last', () => {
  const now = at(2026, 10, 6)
  const items = [msg(1, 'ada', at(2026, 10, 5, 22, 0)), msg(2, 'ada', at(2026, 10, 5, 22, 1)), msg(3, 'bola', at(2026, 10, 5, 22, 2)), msg(4, 'ada', at(2026, 10, 6, 9, 0)), msg(5, null, at(2026, 10, 6, 9, 1), 'Ada left.', { sys: true }), msg(6, 'ada', at(2026, 10, 6, 9, 40))]
  const rows = threadRows(items, now)
  assert.deepEqual(rows.map((row) => (row.kind === 'day' ? row.label : `${(row.item as Message).seq}${row.head ? 'h' : ''}${row.tail ? 't' : ''}`)), ['Yesterday', '1h', '2t', '3ht', 'Today', '4ht', '5ht', '6ht'])
})

test('mentions are cut out of the body by the server\'s positions, and a bad position is ignored', () => {
  const body = 'Hi @Bola and @everyone!'
  const parts = pieces(body, [{ id: 'b', start: 3, end: 8 }, { id: 'everyone', start: 13, end: 22 }])
  assert.deepEqual(parts.map((piece) => [piece.text, piece.mention?.id]), [['Hi ', undefined], ['@Bola', 'b'], [' and ', undefined], ['@everyone', 'everyone'], ['!', undefined]])
  assert.deepEqual(pieces('plain', undefined), [{ text: 'plain' }])
  assert.deepEqual(pieces('short', [{ id: 'b', start: 3, end: 40 }]), [{ text: 'short' }])
})

test('the @ picker: finds the word at the caret, filters members, inserts a name, and drops a mention whose text was edited away', () => {
  assert.deepEqual(mentionQuery('hello @bo', 9), { start: 6, query: 'bo' })
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' })
  assert.equal(mentionQuery('mail ada@example.com', 20), null, 'an @ inside a word is not a mention')
  assert.equal(mentionQuery('hello @' + 'x'.repeat(30), 37), null, 'too long to be a name')
  const members = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bola Ade' }, { id: 'c', name: 'Chidi' }]
  assert.deepEqual(mentionChoices(members, 'a', 'ad', false).map((c) => c.name), ['Bola Ade'], 'a later word of a name matches; you are not offered');
  assert.deepEqual(mentionChoices(members, 'a', '', true).map((c) => c.name), ['everyone', 'Bola Ade', 'Chidi'])
  assert.deepEqual(mentionChoices(members, 'a', 'ev', false), [], 'everyone is for the admin')
  const inserted = insertMention('hey @bo there', 7, 4, { id: 'b', name: 'Bola Ade' })
  assert.deepEqual(inserted, { text: 'hey @Bola Ade  there', caret: 14 })
  assert.deepEqual(liveMentions('hey @Bola Ade  there @Chidi', [{ id: 'b', name: 'Bola Ade' }, { id: 'c', name: 'Chidi' }]), [{ id: 'b', start: 4 }, { id: 'c', start: 21 }])
  assert.deepEqual(liveMentions('hey Bola Ade', [{ id: 'b', name: 'Bola Ade' }]), [])
})

test('one to three emoji alone are large; flags, skin tones, families and keycaps count as one each', () => {
  assert.equal(emojiOnly('😂'), 1); assert.equal(emojiOnly('👍🏽'), 1); assert.equal(emojiOnly('🇳🇬'), 1); assert.equal(emojiOnly('👨‍👩‍👧‍👦'), 1); assert.equal(emojiOnly('1️⃣'), 1)
  assert.equal(emojiOnly('😂 😂 🇳🇬'), 3); assert.equal(emojiOnly('😂😂😂😂'), 0); assert.equal(emojiOnly('ok 😂'), 0); assert.equal(emojiOnly('12'), 0); assert.equal(emojiOnly(''), 0)
})

test(':shortcodes: are replaced, unknown ones are not', () => { assert.equal(shortcodes('well :joy: :nonsense: done:'), 'well 😂 :nonsense: done:') })

test('drafts are kept per conversation on this device and cleared when empty', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  const drafts = createDrafts(storage, 'actor-a')
  drafts.set('g.1', 'half a thought'); drafts.set('dm.x', 'another')
  assert.equal(createDrafts(storage, 'actor-a').get('g.1'), 'half a thought')
  drafts.set('g.1', '')
  assert.equal(createDrafts(storage, 'actor-a').get('g.1'), ''); assert.equal(createDrafts(storage, 'actor-a').get('dm.x'), 'another')
  for (let i = 0; i < 40; i += 1) drafts.set(`c${i}`, 'x')
  assert.equal(Object.keys(JSON.parse(store.get('joinallworld-chat-drafts:actor-a') ?? '{}')).length, 30)
  assert.equal(createDrafts(null, 'actor-a').get('x'), '')
})

test('shared group and provisional drafts belong to their actor; legacy drafts have no provable owner', () => {
  const store = new Map<string, string>([['joinallworld-chat-drafts', JSON.stringify({ 'g.shared': 'Unknown owner' })]])
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  const first = createDrafts(storage, 'actor-a'), second = createDrafts(storage, 'actor-b')
  assert.equal(first.get('g.shared'), '', 'the unscoped legacy record is not assigned to a character')
  first.set('g.shared', 'Ada group draft'); first.set('to:friend', 'Ada direct draft')
  assert.equal(second.get('g.shared'), '')
  assert.equal(second.get('to:friend'), '')
  second.set('g.shared', 'Bola group draft')
  assert.equal(createDrafts(storage, 'actor-a').get('g.shared'), 'Ada group draft')
  assert.equal(createDrafts(storage, 'actor-a').get('to:friend'), 'Ada direct draft')
  assert.equal(createDrafts(storage, 'actor-b').get('g.shared'), 'Bola group draft')
})

test('chats: pinned first then newest; search by the chat\'s or a member\'s name; the composer grows to four lines', () => {
  const chat = (id: string, name: string, last: number, extra: Partial<Conversation> = {}): Conversation => ({ id, kind: 'group', name, members: [{ id: 'm', name: 'Zainab' }], owner: null, with: null, last: { seq: 1, from: null, body: '', at: last }, unread: 0, ...extra })
  const list = [chat('a', 'Old', 1), chat('b', 'New', 9), chat('c', 'Pinned old', 0, { pinned: true })]
  assert.deepEqual(sortChats(list).map((c) => c.id), ['c', 'b', 'a'])
  assert.deepEqual(filterChats(list, 'zain').length, 3); assert.deepEqual(filterChats(list, 'pinn').map((c) => c.id), ['c']); assert.equal(filterChats(list, '').length, 3)
  assert.deepEqual([composerLines(''), composerLines('a\nb'), composerLines('a\nb\nc\nd\ne\nf')], [1, 2, 4])
})

test('a gift reads "You sent" for the sender, and the share that paid a ride debt shows only to the receiver', () => {
  const gift = msg(1, 'ada', 1, 'Sent ₦1,500', { gift: { amount: 1500, repaid: 750 } })
  assert.equal(giftLine(gift, 'ada'), 'You sent ₦1,500'); assert.equal(giftLine(gift, 'bola'), 'ada sent you ₦1,500')
  assert.equal(giftDetail(gift, 'bola'), '₦750 went to your ride home'); assert.equal(giftDetail(gift, 'ada'), null)
})

test('the emoji table has a few hundred entries in categories, and the quick reactions are six', () => {
  assert.ok(EMOJI_CATEGORIES.reduce((n, c) => n + c.emoji.length, 0) >= 300)
  assert.ok(EMOJI_CATEGORIES.every((c) => c.emoji.every((e) => e.char && e.words)))
  assert.equal(QUICK_REACTIONS.length, 6)
})
