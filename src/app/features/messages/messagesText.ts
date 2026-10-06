// What only the open conversation needs, as plain functions (no DOM, no network): the rows of a thread grouped by day and by sender,
// a message cut into text and mention chips, the @ picker's parts, emoji-only messages, :shortcodes:, drafts kept per conversation on
// this device, the chat list's pins and search. Tested in messagesText.test.ts.
import type { Conversation, Mention, Message, OutboxEntry, ThreadItem } from '../../../types/social.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import { SHORTCODES } from './emojiData.ts'

const DAY = 86400000
const isOutbox = (item: ThreadItem): item is OutboxEntry => 'status' in item
const itemTime = (item: ThreadItem): number => item.at
const itemSender = (item: ThreadItem): string => (isOutbox(item) ? 'me' : item.sys ? 'sys' : item.from?.id ?? 'sys')

/** "Today", "Yesterday", the weekday for the last week, else the date. `now` and `at` are server times; the device's own day decides. */
export function dayLabel(at: number, now: number): string {
  const a = new Date(at), b = new Date(now)
  const start = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const gap = Math.round((start(b) - start(a)) / DAY)
  if (gap <= 0) return 'Today'
  if (gap === 1) return 'Yesterday'
  if (gap < 7) return a.toLocaleDateString('en-NG', { weekday: 'long' })
  return a.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', ...(a.getFullYear() === b.getFullYear() ? {} : { year: 'numeric' }) })
}
export type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'item'; key: string; item: ThreadItem; /** The first of a run from one sender: the name shows. */ head: boolean; /** The last of the run: the time shows. */ tail: boolean }
/** A run is the same sender with no more than five minutes between lines and no day change. */
export const RUN_MS = 5 * 60000
export function threadRows(items: readonly ThreadItem[], now: number): ThreadRow[] {
  const rows: ThreadRow[] = []
  let day = '', previous: ThreadItem | null = null
  for (const [index, item] of items.entries()) {
    const label = dayLabel(itemTime(item), now)
    const key = new Date(itemTime(item)).toDateString()
    if (key !== day) { rows.push({ kind: 'day', key: `day:${key}`, label }); day = key; previous = null }
    const next = items[index + 1]
    const joins = (a: ThreadItem, b: ThreadItem): boolean => itemSender(a) === itemSender(b) && itemSender(a) !== 'sys' && itemTime(b) - itemTime(a) <= RUN_MS && new Date(itemTime(a)).toDateString() === new Date(itemTime(b)).toDateString()
    rows.push({ kind: 'item', key: isOutbox(item) ? `o:${item.clientId}` : `m:${item.seq}`, item, head: !previous || !joins(previous, item), tail: !next || !joins(item, next) })
    previous = item
  }
  return rows
}

/** A message body cut into plain text and mention chips, from the server's positions. */
export interface Piece { text: string; mention?: Mention }
export function pieces(body: string, mentions: readonly Mention[] | undefined): Piece[] {
  if (!mentions?.length) return [{ text: body }]
  const out: Piece[] = []
  let at = 0
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < at || mention.end > body.length) continue
    if (mention.start > at) out.push({ text: body.slice(at, mention.start) })
    out.push({ text: body.slice(mention.start, mention.end), mention })
    at = mention.end
  }
  if (at < body.length) out.push({ text: body.slice(at) })
  return out
}

// ---- the @ picker --------------------------------------------------------------------------------------------------
/** The `@word` the caret is in, if any: where the @ is and what has been typed after it. An @ inside a word (an address) is not one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1] ?? ''))) return null
  const query = before.slice(at + 1)
  return query.length > 24 || /[\n@]/.test(query) ? null : { start: at, query }
}
export interface Choice { id: string; name: string }
/** The members to offer for what was typed: names that start with it, or have a word that does; `everyone` first for the admin. */
export function mentionChoices(members: readonly PlayerRef[], meId: string, query: string, admin: boolean): Choice[] {
  const q = query.trim().toLowerCase()
  const fits = (name: string): boolean => !q || name.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)) || name.toLowerCase().startsWith(q)
  const list = members.filter((member) => member.id !== meId && fits(member.name)).map((member) => ({ id: member.id, name: member.name }))
  return admin && fits('everyone') ? [{ id: 'everyone', name: 'everyone' }, ...list] : list
}
export interface Picked { id: string; name: string }
/** Put the chosen name in the text in place of what was typed after the @; the caret goes after it. */
export function insertMention(text: string, caret: number, start: number, choice: Choice): { text: string; caret: number } {
  const word = `@${choice.name} `
  return { text: text.slice(0, start) + word + text.slice(caret), caret: start + word.length }
}
/** The mentions still standing in the text: each chosen name, in order, where `@name` is still written. Editing a name out drops it. */
export function liveMentions(text: string, picked: readonly Picked[]): { id: string; start: number }[] {
  const found: { id: string; start: number }[] = []
  let from = 0
  for (const item of picked) {
    const at = text.indexOf(`@${item.name}`, from)
    if (at < 0) continue
    found.push({ id: item.id, start: at })
    from = at + item.name.length + 1
  }
  return found
}

// ---- emoji ------------------------------------------------------------------------------------------------------------
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic}|[\u{e0020}-\u{e007f}])*$/u
/** How many emoji a message is made of, when it is nothing else (1 to 3, shown large); 0 otherwise. */
export function emojiOnly(body: string): number {
  const text = body.replace(/\s+/g, '')
  if (!text || text.length > 60) return 0
  const clusters = segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text)
  return clusters.length <= 3 && clusters.every((cluster) => EMOJI.test(cluster)) ? clusters.length : 0
}
/** `:smile:` written out becomes the emoji, for a keyboard that has none; an unknown name is left alone. */
export function shortcodes(text: string): string { return text.replace(/:([a-z0-9+]{2,12}):/g, (whole, name: string) => SHORTCODES[name] ?? whole) }

// ---- drafts, pins, search ---------------------------------------------------------------------------------------------
export const DRAFTS_KEY = 'joinallworld-chat-drafts'
/** What was being typed in each conversation, kept on this device only (a draft is not sent anywhere). At most 30, oldest dropped. */
export function createDrafts(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  let kept: Record<string, string> | null = null
  const load = (): Record<string, string> => {
    if (kept) return kept
    try { const saved: unknown = JSON.parse(storage?.getItem(DRAFTS_KEY) ?? 'null'); kept = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...(saved as Record<string, string>) } : {} } catch { kept = {} }
    return kept
  }
  return {
    get: (conv: string): string => load()[conv] ?? '',
    set(conv: string, text: string): void {
      const all = load()
      if (text) { delete all[conv]; all[conv] = text } else delete all[conv]
      const keys = Object.keys(all)
      for (const old of keys.slice(0, Math.max(0, keys.length - 30))) delete all[old]
      try { storage?.setItem(DRAFTS_KEY, JSON.stringify(all)) } catch { /* kept for this visit only */ }
    },
  }
}
/** Pinned chats first, then the newest. */
export const sortChats = (list: readonly Conversation[]): Conversation[] => [...list].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || (b.last?.at ?? 0) - (a.last?.at ?? 0))
/** Chats whose name (or a member's name) has the words typed in it. */
export function filterChats(list: readonly Conversation[], query: string): Conversation[] {
  const q = query.trim().toLowerCase()
  return q ? list.filter((conv) => conv.name.toLowerCase().includes(q) || conv.members.some((member) => member.name.toLowerCase().includes(q))) : [...list]
}
/** The line the composer needs to grow to, at most `max` lines. */
export const composerLines = (text: string, max = 4): number => Math.min(max, Math.max(1, text.split('\n').length))

/** The sentence under a bubble for the money of a gift. */
export function giftLine(message: Message, meId: string): string {
  const amount = `₦${Math.round(message.gift?.amount ?? 0).toLocaleString('en-NG')}`
  return message.from?.id === meId ? `You sent ${amount}` : `${message.from?.name ?? 'Someone'} sent you ${amount}`
}
export const giftDetail = (message: Message, meId: string): string | null => (message.from?.id !== meId && message.gift?.repaid ? `₦${Math.round(message.gift.repaid).toLocaleString('en-NG')} went to your ride home` : null)
