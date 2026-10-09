// The visit store of the page: the calls the buttons, the Home tab and the notices make (server/routes/visit.ts). Fetched with
// the first of them; nothing here is in the startup download (the always-loaded part is ping/pingLoader.ts).
// Every answer is the server's: a button only asks, and the server checks the door again.
import { reactive } from 'vue'
import { call, social, sync } from '../social/useSocial.ts'
import type { DoorWho } from '../../../game/visit.ts'
import type { CloseResult, DoorSetResult, EnterResult, HouseLinkView, InviteResult, LinkEndResult, LinkResult, LinksResult, PeekResult } from '../../../types/visit.ts'

/** What the page can do for the store: say a line, open a screen. */
export interface Hands { toast(text: string, tone?: 'good' | 'error'): void; open(id: string, params?: unknown): unknown }
export const visitState = reactive<{ links: HouseLinkView[]; linksLoaded: boolean; busy: string }>({ links: [], linksLoaded: false, busy: '' })

/** One tap on Visit home / Knock / Come in. */
export async function visitHome(hands: Hands, id: string, name: string): Promise<boolean> {
  if (visitState.busy) return false
  visitState.busy = `enter:${id}`
  try {
    const done = await call<Extract<EnterResult, { ok: true }>>('/api/social/visit/enter', { host: id })
    if (!done.ok) { hands.toast(done.reason, 'error'); return false }
    if (done.code === 'knocking') {
      social.knock = { host: id, name, status: 'knocking', expiresAt: done.expiresAt }
      hands.toast(`Knocking at ${name}’s door. Waiting for an answer.`)
    } else hands.toast(`You are visiting ${name}’s home.`, 'good')
    await sync()
    hands.open('invite', { host: id })
    return true
  } finally { visitState.busy = '' }
}

/** Choose who may come in (and whether friends may visit while out). */
export async function chooseDoor(who: DoorWho | undefined, out?: boolean): Promise<string | null> {
  const done = await call<Extract<DoorSetResult, { ok: true }>>('/api/social/visit/door', { ...(who ? { who } : {}), ...(out === undefined ? {} : { out }) })
  if (!done.ok) return done.reason
  await sync()
  return null
}
export async function closeDoor(closed: boolean): Promise<string | null> {
  const done = await call<Extract<CloseResult, { ok: true }>>('/api/social/visit/close', { closed })
  if (!done.ok) return done.reason
  await sync()
  return null
}
export async function endVisit(): Promise<string | null> {
  const done = await call('/api/social/visit/end', {})
  if (!done.ok) return done.reason
  await sync()
  return null
}
/** Ask these friends over. Answers a line to show. */
export async function inviteOver(ids: string[]): Promise<{ ok: boolean; words: string }> {
  const done = await call<Extract<InviteResult, { ok: true }>>('/api/social/visit/invite', { to: ids })
  if (!done.ok) return { ok: false, words: done.reason }
  await sync()
  const names = done.invited.map((who) => who.name)
  return { ok: names.length > 0, words: names.length ? `${names.length === 1 ? names[0] : `${names.length} friends`} invited. Each can come in for the next 30 minutes.` : 'Nobody could be invited.' }
}

export async function loadLinks(): Promise<void> {
  const done = await call<Extract<LinksResult, { ok: true }>>('/api/social/visit/links')
  if (done.ok) { visitState.links = done.links; visitState.linksLoaded = true }
}
export async function makeLink(options: { hours?: number; max?: number; open?: boolean }): Promise<{ link: HouseLinkView | null; reason: string | null }> {
  const done = await call<Extract<LinkResult, { ok: true }>>('/api/social/visit/link', options)
  if (!done.ok) return { link: null, reason: done.reason }
  await loadLinks()
  return { link: done.link, reason: null }
}
export async function endLink(id: string): Promise<string | null> {
  const done = await call<Extract<LinkEndResult, { ok: true }>>('/api/social/visit/link/end', { id })
  if (!done.ok) return done.reason
  await loadLinks()
  return null
}

/** A house link opened by someone with or without a session: is it good, and whose home is it? */
export async function peekLink(token: string): Promise<PeekResult | null> {
  const done = await call<PeekResult>('/api/social/visit/peek', { token })
  return done.ok ? done : null
}
