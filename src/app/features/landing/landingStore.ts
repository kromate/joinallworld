// THE LANDING OF A LINK — the one place an invite, share or table link is handled, after the quick
// start (or at once for a player who already has a life). The Vue twin of landJoin() in
// src/life-main.js; the order and the requests are the same. In order:
//   1. the share code (`ref`) is attached to the caller's life as a referral
//      (POST /api/growth/referral/link). It pays nobody now: both gifts wait for paid work on real
//      Lagos days. A link that had no `join` names its sharer here, and that is who is joined.
//   2. a brand-new guest is put beside the player the link points at (POST /api/social/join): in
//      their venue, or told they are at home (Knock), out or offline. A player who has already
//      settled in gets the Invite app on that house instead.
//   3. ONE banner says all of it ("You're joining Ada … Work a paid shift and you both get a gift").
//      There is no welcome toast beside it: the quick start said nothing because it knew a banner was coming.
//   4. a table the link named is opened in the Tables app.
// What is kept on the device (the id, the code, the table) is dropped as each is answered; with no
// answer (the connection dropped) it stays and is tried again at the next connection.
//
// `createLanding(deps)` takes everything it touches as arguments, so the tests run it against fakes.
import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'
import type { JoinAnswer, JoinBanner } from '../../../quick-start/model.ts'
import { joinBanner, linkBanner } from '../../../quick-start/model.ts'
import type { FetchJson } from '../../types/client.ts'
import type { LandingState } from '../growth/growthTypes.ts'

/** A banner is shown for 12 seconds, as the existing shell shows it. */
export const BANNER_MS = 12000

export interface LandingDeps {
  fetchJson: FetchJson
  /** True when connected with a session. */
  online(): boolean
  cityId(): string
  sessionId(): string | null
  /** Still a guest (not settled in): the link joins instead of opening the Invite app. */
  isGuest(): boolean
  /** Re-read the life after a join moved the player. */
  refresh(): Promise<unknown>
  open(id: string, params?: unknown): unknown
  toast(text: string): void
  venueLabel(venueId: string): string
  /** The welcome the quick start held back: the venue the player stands in and their name. */
  welcomeText(): string
  /** Whether the city has a table by that id; the table lists are fetched on this first use, so it may answer later. */
  tableExists(id: string): boolean | Promise<boolean>
  deviceToken(): string
  track(name: string, props?: Record<string, unknown>): void
  /** The address was handled: it is cleaned. */
  cleanAddress(): void
  /** The social client held the link's house id: it is not opened a second time. */
  takeLinkHost(): void
  // what the link carries, kept on the device until each part is answered
  joinTarget(): string | null
  forgetJoin(): void
  pendingRef(): string | null
  forgetRef(): void
  pendingTable(): string | null
  forgetTable(): void
  /** The panel a link in an e-mail asked for (a name from the fixed list), kept until it is opened. */
  pendingGo(): string | null
  forgetGo(): void
  /** The panel a go-link name opens, or null when this build has no such panel. */
  panelFor(go: string): string | null
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** The banner on screen: what to say, and (for "at home") a Knock button that opens the Invite app on that house. */
export interface ShownBanner extends JoinBanner { id: number; knockHost: string | null }

interface ShareLookup { ok?: boolean; by?: { id?: string; name?: string } }
interface ReferralLink { ok?: boolean; duplicate?: boolean; by?: string }
interface HttpError { status?: number }

export interface Landing {
  banner: ShallowRef<ShownBanner | null>
  /** Where the page's share link came from, once known (growth.state.landing). */
  landed: ShallowRef<LandingState | null>
  land(): Promise<void>
  /** The Knock button, or the close button. */
  knock(): void
  dismiss(): void
  /** Tell the landing that the quick start that was waiting for a join has succeeded: say a welcome if nobody could be joined. */
  owe(): void
}

export function createLanding(deps: LandingDeps): Landing {
  const banner = shallowRef<ShownBanner | null>(null)
  const landed = shallowRef<LandingState | null>(null)
  let joining = false
  let owedWelcome = false
  let serial = 0
  let timer: unknown = null

  function show(value: JoinBanner, knockHost: string | null): void {
    if (timer !== null) deps.clearTimeout(timer)
    const id = ++serial
    banner.value = { ...value, id, knockHost }
    timer = deps.setTimeout(() => { if (banner.value?.id === id) banner.value = null }, BANNER_MS)
  }
  function dismiss(): void { if (timer !== null) deps.clearTimeout(timer); timer = null; banner.value = null }
  function knock(): void {
    const host = banner.value?.knockHost
    dismiss()
    if (host) deps.open('invite', { host })
  }

  async function land(): Promise<void> {
    let host = deps.joinTarget()
    const ref = deps.pendingRef()
    const table = deps.pendingTable()
    const go = deps.pendingGo()
    if ((!host && !ref && !table && !go && !owedWelcome) || joining || !deps.online()) return
    joining = true
    const guest = deps.isGuest()
    const kind = table ? 'table' : ref ? 'share' : 'house'
    // This landing handles the link: the address is cleaned (what it carried is kept on the device until it is answered)
    // and the Invite app is not opened for it by anyone else.
    deps.cleanAddress()
    deps.takeLinkHost()
    if (host === deps.sessionId()) { deps.forgetJoin(); host = null }
    let shown: JoinBanner | null = null
    let gift = false
    let sharer: string | null = null
    try {
      if (ref) {
        const about = host ? null : await deps.fetchJson<ShareLookup>(`/api/growth/share/${encodeURIComponent(ref)}`)
        if (about?.ok && about.by?.id && about.by.id !== deps.sessionId()) { host = about.by.id; sharer = about.by.name ?? null }
        const linked = await deps.fetchJson<ReferralLink>('/api/growth/referral/link', { method: 'POST', body: { cityId: deps.cityId(), code: ref, device: deps.deviceToken() } })
        deps.forgetRef()
        if (linked.ok && !linked.duplicate) { gift = true; sharer = linked.by ?? sharer; deps.track('invite_joined', { kind }) }
      }
      if (host && guest) {
        const answer = await deps.fetchJson<JoinAnswer>('/api/social/join', { method: 'POST', body: { host, cityId: deps.cityId() } })
        deps.forgetJoin()
        deps.track('join_landed', { code: answer.code ?? 'refused' })
        if (answer.code === 'joined' || answer.code === 'here') deps.track('invite_colocated', { kind })
        shown = joinBanner(answer, (id) => deps.venueLabel(id), { gift })
        if (typeof answer.host?.name === 'string') landed.value = { kind, by: { id: host, name: answer.host.name } }
        if (answer.code === 'joined') await deps.refresh()
      } else if (host) { deps.forgetJoin(); deps.open('invite', { host }) }
    } catch (error) {
      // No answer: what is kept is tried again at the next connection. A refusal that will not change is dropped.
      const status = (error as HttpError | null)?.status
      if (status && status < 500) { deps.forgetJoin(); deps.forgetRef() }
      else { joining = false; return }
    }
    joining = false
    if (!shown && gift) shown = linkBanner(sharer || 'a friend')
    if (gift && sharer && host && !landed.value) landed.value = { kind, by: { id: host, name: sharer } }
    // A table the link named: the Tables app opens on it (the banner is shown over it).
    if (table) { deps.forgetTable(); if (await deps.tableExists(table)) deps.open('tables', { table }) }
    // An e-mail's button: one panel from the fixed list, opened once. A table link, which names its own panel, wins.
    if (go) { deps.forgetGo(); const panel = deps.panelFor(go); if (panel && !table && !host) deps.open(panel) }
    if (shown) show(shown, shown.knock && !table ? host : null)
    // Nobody could be joined after all: the welcome the quick start held back is said now, once.
    else if (owedWelcome && guest) deps.toast(deps.welcomeText())
    owedWelcome = false
  }

  return { banner, landed, land, knock, dismiss, owe() { owedWelcome = true } }
}
