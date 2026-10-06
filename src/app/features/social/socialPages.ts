// The paged reads of the social screens (docs/LISTS.md), kept out of the social client so the first download does not carry them:
// the Players view, the rest of a long chat list, and the older lines of a conversation. Each works on the shared social state and
// goes through the client's own `call`, so a failure comes back as { ok: false } and nothing here throws.
import { mergeMessages } from '../../../game/social-model.ts'
import type { Conversation, ConversationsResult, EveryoneResult, HistoryResult, ManyResult, PlayerRow, PlayerSort } from '../../../types/social.ts'
import type { Fetched } from '../../ui/lazyList.ts'
import { call, social } from './useSocial.ts'

/** Rows asked for at a time in the Players view, and chats, and older lines. */
export const PLAYERS_PAGE = 40
export const CHATS_PAGE = 30
export const OLDER_PAGE = 40

export interface PlayersQuery { q: string; sort: PlayerSort; city: string }
/** The Players view's counters, from the first page of the last read. */
export interface PlayersCounts { online: number | null; gone: number }

/** One page of the Players view. `counts` is told about the counters the first page carries. */
export async function fetchPlayers(query: PlayersQuery, cursor: string | null, counts: (next: PlayersCounts) => void): Promise<Fetched<PlayerRow>> {
  const params = new URLSearchParams({ sort: query.sort, limit: String(PLAYERS_PAGE) })
  if (query.q.trim()) params.set('q', query.q.trim())
  if (query.sort === 'city') params.set('city', query.city)
  if (cursor) params.set('after', cursor)
  const result = await call<Extract<EveryoneResult, { ok: true }>>(`/api/social/everyone?${params}`)
  if (!result.ok) return { ok: false, reason: result.reason }
  if (!cursor) counts({ online: result.online ?? null, gone: result.gone })
  return { ok: true, items: result.players, next: result.next, total: result.total }
}

/** The next page of the chat list, added to the overview's. The overview says how many chats there are and where the next page starts. */
export async function loadMoreChats(): Promise<boolean> {
  const me = social.me, more = me?.conversationsMore
  if (!me || !more?.next) return false
  const after = more.next
  const result = await call<ConversationsResult>(`/api/social/conversations?limit=${CHATS_PAGE}&after=${encodeURIComponent(after)}`)
  // A read of the overview meanwhile has started the list again: this page belongs to the one before it.
  if (!result.ok || social.me !== me || me.conversationsMore?.next !== after) return false
  const known = new Set(me.conversations.map((conv) => conv.id))
  const added = result.conversations.filter((conv) => !known.has(conv.id))
  me.conversations = [...me.conversations, ...added]
  me.conversationsMore = { total: result.total ?? more.total, next: result.next ?? null, unreadOlder: Math.max(0, more.unreadOlder - added.reduce((sum, conv) => sum + (conv.muted ? conv.mentions ?? 0 : conv.unread), 0)) }
  return true
}

/** Older lines of a conversation, put before the ones held. Returns how many were added and whether older ones may remain. */
export async function loadOlder(id: string): Promise<{ added: number; more: boolean } | null> {
  const thread = social.threads.get(id), first = thread?.messages[0]?.seq
  if (!thread || !first || first <= 1) return { added: 0, more: false }
  const result = await call<Extract<HistoryResult, { ok: true }>>(`/api/social/conversations/${encodeURIComponent(id)}?before=${first}&limit=${OLDER_PAGE}`)
  if (!result.ok) return null
  const before = thread.messages.length
  thread.messages = mergeMessages(thread.messages, result.messages)
  return { added: thread.messages.length - before, more: result.more === true && result.messages.length > 0 }
}

/**
 * The direct chat with a player as the server has it: put back in my list if it was dropped from it, and added to the loaded chats.
 * Null: there is no chat yet (the first message makes it), or it could not be read.
 */
export async function openChatWith(player: string): Promise<Conversation | null> {
  const result = await call<{ conv: Conversation | null }>('/api/social/chats/open', { with: player })
  if (!result.ok || !result.conv || !social.me) return null
  const conv = result.conv
  if (!social.me.conversations.some((item) => item.id === conv.id)) social.me.conversations = [conv, ...social.me.conversations]
  return conv
}

/** The same words to several players (founder and admins). */
export const sendToMany = (to: readonly string[], body: string, clientId: string) => call<Extract<ManyResult, { ok: true }>>('/api/social/messages/many', { to, body, clientId })
