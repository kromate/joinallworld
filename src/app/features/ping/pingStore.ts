// The one Ping store of the page, shared by the button on a friend's card and in a chat's header (PingButton.vue,
// PingStrip.vue) and by the notices (PingNotices.vue). Fetched with the first of them: nothing here is in the startup
// download (the always-loaded part is pingLoader.ts).
//
// Every write is the server's (server/routes/ping.ts). A ping carries one client id from the tap to the answer, so a double
// tap or a retry after a dropped connection is the same ping; a join likewise.
import { reactive } from 'vue'
import { call, newClientId, sync } from '../social/useSocial.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import type { PingNote } from '../../../game/ping.ts'
import type { PingControl, PingJoinResult, PingNotice, PingOpenResult, PingPlace, PingServerFrame } from '../../../types/ping.ts'
import { forgetToken, keptToken, pingUi } from './pingLoader.ts'
import { noticeKey } from './pingModel.ts'
import type { PingBanner } from './pingModel.ts'

/** The player's own live ping to one friend, as the strip under the button shows it. */
export interface SentPing { name: string; words: string; note: PingNote | null; link: string; place: PingPlace | null; expiresAt: number }
export const pingState = reactive<{ controls: Map<string, PingControl>; sent: Map<string, SentPing>; busy: Set<string>; banner: PingBanner | null }>({ controls: new Map(), sent: new Map(), busy: new Set(), banner: null })
const pending = new Map<string, string>()
const closed = new Set<string>()
const loading = new Map<string, Promise<void>>()

/** Ask the server whether this player can be pinged now (and for the player's own live ping to them). */
export function loadControl(id: string, name = ''): Promise<void> {
  const running = loading.get(id)
  if (running) return running
  const work = (async () => {
    const result = await call<{ control: PingControl }>(`/api/social/ping/${encodeURIComponent(id)}`)
    if (!result.ok) return
    pingState.controls.set(id, result.control)
    const live = result.control.live
    if (live && !pingState.sent.has(id)) pingState.sent.set(id, { name, words: `You pinged ${name || 'them'}. They can join you for the next hour.`, note: null, link: live.link, place: null, expiresAt: live.expiresAt })
    if (!live) pingState.sent.delete(id)
  })().finally(() => { loading.delete(id) })
  loading.set(id, work)
  return work
}

type Sent = { to: PlayerRef; note: PingNote; words: string; at: number; expiresAt: number; again: number; link: string; place: PingPlace }
/** One tap: tell the friend. Answers the sentence to show (the server's own), and whether it worked. */
export async function sendPing(id: string, name: string): Promise<{ ok: boolean; words: string }> {
  if (pingState.busy.has(id)) return { ok: false, words: '' }
  pingState.busy.add(id)
  // The same id until the server has answered: a retry after a lost connection cannot ping twice.
  const clientId = pending.get(id) ?? newClientId()
  pending.set(id, clientId)
  const result = await call<Sent>('/api/social/ping', { to: id, clientId })
  pingState.busy.delete(id)
  if (!result.ok) {
    if (!result.transport) pending.delete(id)
    const again = (result as { again?: unknown }).again
    if (!result.transport) pingState.controls.set(id, { can: false, code: result.code as PingControl['code'], reason: result.reason, again: typeof again === 'number' ? again : null, live: pingState.controls.get(id)?.live ?? null })
    return { ok: false, words: result.reason }
  }
  pending.delete(id)
  pingState.sent.set(id, { name, words: result.words, note: result.note, link: result.link, place: result.place, expiresAt: result.expiresAt })
  pingState.controls.set(id, { can: false, code: 'cooldown', reason: null, again: result.again, live: { at: result.at, expiresAt: result.expiresAt, link: result.link } })
  return { ok: true, words: result.words }
}
/** Take a ping back. */
export async function cancelPing(id: string): Promise<boolean> {
  const result = await call('/api/social/ping/cancel', { to: id })
  if (!result.ok) return false
  pingState.sent.delete(id)
  const control = pingState.controls.get(id)
  if (control) pingState.controls.set(id, { ...control, live: null })
  return true
}

// ---- the notices -----------------------------------------------------------------------------------
/** Show a live ping, unless the player closed this very one. A notice about a join the player made is not replaced by it. */
function offer(notice: PingNotice): void {
  if (closed.has(noticeKey(notice))) return
  const now = pingState.banner
  if (now && now.kind !== 'incoming' && now.kind !== 'left' && now.kind !== 'other') return
  if (now?.kind === 'incoming' && now.busy) return
  pingState.banner = { kind: 'incoming', notice, busy: false, error: null }
}
export function closeBanner(): void {
  const now = pingState.banner
  if (now?.kind === 'incoming') closed.add(noticeKey(now.notice))
  pingState.banner = null
}
/** What the server pushed (pingLoader.ts queues the frames until this store exists). */
export function takeFrames(): void {
  for (const frame of pingUi.frames.splice(0) as PingServerFrame[]) {
    if (frame.type === 'ping-incoming') { offer(frame.notice); void sync() }
    else if (frame.type === 'ping-ended') { const now = pingState.banner; if (now?.kind === 'incoming' && now.notice.from.id === frame.from && !now.busy) pingState.banner = null }
    else if (frame.type === 'ping-joined') { pingState.sent.delete(frame.by.id); pingState.banner = { kind: 'came', by: frame.by, place: frame.place.label, present: frame.present }; void sync() }
  }
}
/** The live pings waiting for this player: asked once when the notices open (a returning player), never polled. */
export async function loadIncoming(): Promise<void> {
  const result = await call<{ incoming: PingNotice[] }>('/api/social/ping')
  const first = result.ok ? result.incoming.find((notice) => !closed.has(noticeKey(notice))) : undefined
  if (first) offer(first)
}

export interface JoinDeps {
  /** Read the life again after the server moved it: at a new venue, or in another city (`cityId`, so it is asked for where it now is). */
  refresh(cityId?: string): Promise<unknown>
  /**
   * Run the join as one change of this device's own, from the request to the read after it: until it has finished, a hint
   * from the server that the life changed is not followed (the join reads the life itself, where it now is).
   */
  during?<T>(work: () => Promise<T>): Promise<T>
}
/** Go to the friend who pinged. The server checks everything again and answers where the player now is. */
export async function joinFriend(from: PlayerRef, deps: JoinDeps): Promise<void> {
  const now = pingState.banner
  if (now?.kind === 'incoming' && now.busy) return
  const notice = now?.kind === 'incoming' && now.notice.from.id === from.id ? now.notice : null
  if (notice) pingState.banner = { kind: 'incoming', notice, busy: true, error: null }
  const key = `join:${from.id}`, clientId = pending.get(key) ?? newClientId()
  pending.set(key, clientId)
  const during = deps.during?.bind(deps) ?? (<T>(work: () => Promise<T>): Promise<T> => work())
  const result = await during(async () => {
    const answer = await call<Extract<PingJoinResult, { ok: true }>>('/api/social/ping/join', { from: from.id, clientId })
    if (answer.ok && answer.moved !== 'none') {
      // The city's own "you have arrived" sheet stays closed: this notice says where the player is and whom they joined.
      pingUi.arriving = true
      try { await deps.refresh(answer.moved === 'city' ? answer.place.cityId : undefined) } finally { pingUi.arriving = false }
    }
    return answer
  })
  if (!result.ok) {
    if (!result.transport) pending.delete(key)
    // Over (they left, it ran out): said once, with a way to write to them. Anything else can be tried again from the same notice.
    if (result.code === 'left' || result.code === 'not_friends' || result.code === 'unknown_player') { if (notice) closed.add(noticeKey(notice)); pingState.banner = { kind: 'left', from: (result as { from?: PlayerRef }).from ?? null, words: result.reason } }
    else if (notice) pingState.banner = { kind: 'incoming', notice, busy: false, error: result.reason }
    else pingState.banner = { kind: 'left', from, words: result.reason }
    return
  }
  pending.delete(key)
  if (notice) closed.add(noticeKey(notice))
  pingState.banner = { kind: 'joined', from: result.from, words: result.words, knock: result.knock, present: result.present }
  void sync()
}

/** A join link this device was opened with: ask the server what it is, once, and act on the answer. */
let opening = false
export async function openKeptLink(deps: JoinDeps): Promise<void> {
  const token = keptToken()
  if (!token || opening) return
  opening = true
  try {
    const result = await call<Extract<PingOpenResult, { ok: true }>>('/api/social/ping/open', { token })
    // No answer at all, or no session yet: the link is kept for the next connection.
    if (!result.ok && (result.transport || result.code === 'device_session_required' || result.code === 'onboarding_required' || result.code === 'rate_limited')) return
    forgetToken()
    if (!result.ok) { pingState.banner = { kind: 'left', from: null, words: 'That invitation has ended.' }; return }
    if (result.code === 'other') { pingState.banner = { kind: 'other' }; return }
    if (!result.notice) { pingState.banner = { kind: 'left', from: result.from, words: `${result.from.name} has left. You can message them.` }; return }
    // The player pressed "Join" in their mail: the join goes ahead, as themselves.
    pingState.banner = { kind: 'incoming', notice: result.notice, busy: false, error: null }
    await joinFriend(result.from, deps)
  } finally { opening = false }
}
