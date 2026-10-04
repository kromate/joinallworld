// What the Messages app shows, worked out from the social overview and the life's notices.
// Pure: no DOM, no network, and the device's "seen" marks come in through a small store, so all
// of it is tested without a browser.
import type { Conversation, OutboxEntry, SocialOverview, SocialUpdate, ThreadItem } from '../../../types/social.ts'
import type { Notice } from '../../../types/life.ts'
import type { PhoneNotification } from '../../types/panel.ts'

/** A waiting friend or Bae request is counted once, as a request, not again as the update that announced it. */
const REQUEST_KINDS: readonly string[] = ['friend-request', 'bae-request']
/** Which app a line of Updates belongs to: where tapping it in the Phone's notification list goes. */
const NOTICE_APPS: Readonly<Record<string, string>> = { 'rent-due': 'bank', rent: 'bank', 'rent-missed': 'bank', loan: 'bank', 'loan-missed': 'bank', promotion: 'jobs', illness: 'health', recovered: 'health', gov: 'governor', transfer: 'statement', bae: 'people' }
const UPDATE_APPS: Readonly<Record<string, string>> = { transfer: 'statement', 'friend-request': 'people', 'friend-accepted': 'contacts', 'invite-knock': 'invite', 'invite-answer': 'invite', 'bae-request': 'people', 'bae-answer': 'people' }
const UPDATES_TAB = { tab: 'updates' } as const
export const SEEN_KEY = 'joinallworld-notices-seen'

export const unreadChats = (me: Pick<SocialOverview, 'conversations'> | null): number => (me?.conversations ?? []).reduce((sum, conv) => sum + conv.unread, 0)
export const unreadUpdates = (me: Pick<SocialOverview, 'updates'> | null): number => (me?.updates ?? []).filter((update) => !update.read && !REQUEST_KINDS.includes(update.kind)).length

/**
 * Which life notices have been read is remembered on this device only, per city: the server time
 * of the newest one already seen. The same key the existing Messages panel uses, so the two agree.
 */
export function createNoticeMarks(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  let seenAt: Record<string, number> | null = null
  function load(): Record<string, number> {
    if (seenAt) return seenAt
    try { const saved: unknown = JSON.parse(storage?.getItem(SEEN_KEY) ?? 'null'); seenAt = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, number> : {} } catch { seenAt = {} }
    return seenAt
  }
  const seen = (cityId: string): number => Number(load()[cityId]) || 0
  return {
    seen,
    fresh: (cityId: string, notices: readonly Notice[] = []): number => notices.filter((notice) => notice.at > seen(cityId)).length,
    /** Mark every notice as read. Returns true when that changed anything. */
    mark(cityId: string, notices: readonly Notice[] = []): boolean {
      const newest = Math.max(0, ...notices.map((notice) => notice.at))
      if (newest <= seen(cityId)) return false
      load()[cityId] = newest
      try { storage?.setItem(SEEN_KEY, JSON.stringify(seenAt)) } catch { /* read for this visit only */ }
      return true
    },
  }
}
export type NoticeMarks = ReturnType<typeof createNoticeMarks>

/** The red badge on the Messages icon: unread chats plus unread Updates. Requests and knocks are counted on People and Invite, where they are answered. */
export function messagesBadge(me: SocialOverview | null, connected: boolean, freshNotices: number): number {
  return connected && me ? unreadChats(me) + unreadUpdates(me) + freshNotices : 0
}
/** The count on the Updates tab: everything waiting there, requests included. */
export function updatesCount(me: SocialOverview, freshNotices: number): number {
  return unreadUpdates(me) + me.requests.in.length + me.baeRequests.length + freshNotices
}

/**
 * The Phone's notification list: what is waiting for an answer (knocks, friend and Bae requests)
 * and the newest Updates, each with the app it opens. Built from what is already loaded.
 */
export function notificationLines(me: SocialOverview | null, input: { connected: boolean; now: number; notices?: readonly Notice[]; seen: number }): PhoneNotification[] {
  if (!input.connected || !me) return []
  const { now, seen } = input
  const lines: PhoneNotification[] = []
  for (const knock of me.house.knocks) lines.push({ id: `knock:${knock.from.id}`, at: now, fresh: true, app: 'invite', text: `${knock.from.name} is knocking at your door` })
  for (const request of me.requests.in) lines.push({ id: `friend:${request.id}`, at: now - 1, fresh: true, app: 'people', text: `${request.name} wants to be friends` })
  for (const request of me.baeRequests) lines.push({ id: `bae:${request.id}`, at: now - 2, fresh: true, app: 'people', text: `${request.name} asked you to be their Bae` })
  for (const conv of me.conversations) if (conv.unread && conv.last) lines.push({ id: `chat:${conv.id}`, at: conv.last.at || now - 3, fresh: true, app: 'messages', params: { conv: conv.id }, text: `${conv.name}: ${conv.last.body}` })
  for (const update of me.updates) {
    if (REQUEST_KINDS.includes(update.kind)) continue
    const app = UPDATE_APPS[update.kind]
    // Keyed by the update's own id: two updates of one kind in the same millisecond stay two lines.
    lines.push({ id: `update:${update.id}`, at: update.at, fresh: !update.read, app: app ?? 'messages', params: app ? undefined : UPDATES_TAB, text: update.text })
  }
  for (const notice of input.notices ?? []) {
    const app = NOTICE_APPS[notice.kind]
    lines.push({ id: `notice:${notice.id ?? notice.at}`, at: notice.at, fresh: notice.at > seen, app: app ?? 'messages', params: app ? undefined : UPDATES_TAB, text: notice.text })
  }
  return lines
}

/** `kind` and `id` choose the line's glyph through the icon map ('update' or 'notice', and the update's or notice's own kind). */
export interface UpdateLine { key: string; at: number; text: string; fresh: boolean; kind: 'update' | 'notice'; id: string }
/** Updates and life notices as one list, newest first. `seen` is the mark from BEFORE the tab was opened, so what was new stays marked while it is read. */
export function updateLines(updates: readonly SocialUpdate[], notices: readonly Notice[], seen: number): UpdateLine[] {
  return [
    ...updates.map((update) => ({ key: `u${update.id}`, at: update.at, text: update.text, fresh: !update.read, kind: 'update' as const, id: update.kind })),
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
