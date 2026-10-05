// What only the Messages app itself draws: the Updates list and the lines and rules of a thread. The badge, the notice marks and
// the notification lines the first download needs are in messagesModel.ts.
import type { Conversation, OutboxEntry, SocialOverview, SocialUpdate, ThreadItem } from '../../../types/social.ts'
import type { Notice } from '../../../types/life.ts'

/** `kind` and `id` choose the line's glyph through the icon map ('update' or 'notice', and the update's or notice's own kind). */
export interface UpdateLine { key: string; at: number; text: string; fresh: boolean; kind: 'update' | 'notice'; id: string; /** The player this line is about, when it offers their card (a friend who joined through the link). */ player?: string }
/** Updates and life notices as one list, newest first. `seen` is the mark from BEFORE the tab was opened, so what was new stays marked while it is read. */
export function updateLines(updates: readonly SocialUpdate[], notices: readonly Notice[], seen: number): UpdateLine[] {
  return [
    ...updates.map((update) => ({ key: `u${update.id}`, at: update.at, text: update.text, fresh: !update.read, kind: 'update' as const, id: update.kind, ...(update.kind === 'invite-joined' && update.data?.from ? { player: update.data.from } : {}) })),
    ...notices.map((notice) => ({ key: `n${notice.id ?? notice.at}`, at: notice.at, text: notice.text, fresh: notice.at > seen, kind: 'notice' as const, id: notice.kind })),
  ].sort((a, b) => b.at - a.at)
}

/** A thread line still in the outbox: sending, or failed with a reason and a Retry. */
export const isOutbox = (item: ThreadItem): item is OutboxEntry => 'status' in item
/** The second line of a conversation row: who said what last. */
export function lastLine(conv: Conversation, meId: string): string {
  if (!conv.last) return 'No messages yet'
  return `${conv.last.from ? `${conv.last.from.id === meId ? 'You' : conv.last.from.name}: ` : ''}${conv.last.body}`
}
/** The key a chat with a player has before the server has created the conversation. */
export const provisionalKey = (playerId: string): string => `to:${playerId}`
/**
 * The other player of a direct chat: the conversation's, or — before the first message has made one — the player the chat
 * was opened with. So the name, Send money and Call or Ping are in the header from the moment a chat with a friend opens.
 */
export const partnerOf = (key: string | null, conv: Conversation | null): string | null =>
  (conv ? (conv.kind === 'dm' ? conv.with ?? null : null) : key?.startsWith('to:') ? key.slice(3) : null)
/** What to POST for a conversation key: a player for a provisional key, else the conversation. */
export const targetOf = (key: string): { to: string } | { conv: string } => (key.startsWith('to:') ? { to: key.slice(3) } : { conv: key })
/** The host's public id for a house chat key (`h.<hostId>`), else null. */
export const houseHostOf = (key: string): string | null => (key.startsWith('h.') ? key.slice(2) : null)
/** Why the thread cannot be written to, or null. */
export function readOnlyReason(key: string, me: SocialOverview, notConnected: string | null): string | null {
  if (notConnected) return notConnected
  const host = houseHostOf(key)
  return host && host !== me.me.id && me.visiting?.host.id !== host ? 'Your visit has ended. Knock again to join the house chat.' : null
}
export function threadTitle(key: string, conv: Conversation | null, openName: string | null): string {
  return conv?.name ?? openName ?? (houseHostOf(key) ? 'House chat' : 'New chat')
}
export const threadKind = (conv: Conversation | null): string => (conv?.kind === 'group' ? `${conv.members.length} people` : conv?.kind === 'house' ? 'House chat' : 'Direct message')
