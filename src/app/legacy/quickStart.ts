// The typed boundary to the quick start's device-side state (src/quick-start/entry.js): what the
// landing screen — the existing 'quick-start' panel, shown through LegacyPanel — keeps on the
// device between tapping Play and the server confirming the look. The module is still JavaScript
// and still the single owner of that state; the landing screen and this shell read the same
// `play` object.
import { captureLink as captureLinkJs, forgetDraft as forgetDraftJs, forgetJoin as forgetJoinJs, forgetRef as forgetRefJs, forgetTable as forgetTableJs, joinTarget as joinTargetJs, keepPlay as keepPlayJs, pendingPlay as pendingPlayJs, pendingRef as pendingRefJs, pendingTable as pendingTableJs, play as playJs, track as trackJs } from '../../quick-start/entry.ts'
import type { Look } from '../../types/life.ts'

/**
 * Play was tapped and the server has not confirmed the look yet. `actionId` is made once (after the
 * session exists, so it carries server time) and reused by every retry and after every reload: the
 * server applies it exactly once. `joining` was decided when Play was tapped (an invite link is waiting).
 */
export interface PendingPlay { look: Look; actionId?: string; joining?: boolean }
/** True while a tapped Play is being sent: the landing screen stays out of the way until there is an answer. */
export const play = playJs as unknown as { sending: boolean }
export const pendingPlay = pendingPlayJs as unknown as () => PendingPlay | null
export const keepPlay = keepPlayJs as unknown as (value: PendingPlay | null) => void
/** The first minute is over (the life has moved in): forget the landing screen's drafts. */
export const forgetDraft = forgetDraftJs as unknown as () => void

// ---- the link landing ------------------------------------------------------------------------
// What a page opened with an invite, share or table link keeps on the device until each part is answered.
/** Read the link this page was opened with, once, before anything rewrites the address. */
export const captureLink = captureLinkJs as unknown as () => { join: string | null; ref: string | null; table: string | null }
/** The public id the link points at (kept until handled), or null. */
export const joinTarget = joinTargetJs as unknown as () => string | null
export const forgetJoin = forgetJoinJs as unknown as () => void
/** The share code waiting to be attached as a referral (kept for a week), or null. */
export const pendingRef = pendingRefJs as unknown as () => string | null
export const forgetRef = forgetRefJs as unknown as () => void
/** The table a link asked for, until the Tables app has been opened on it. */
export const pendingTable = pendingTableJs as unknown as () => string | null
export const forgetTable = forgetTableJs as unknown as () => void
/** One funnel event ('jaw:track'); never throws. */
export const track = trackJs as unknown as (name: string, props?: Record<string, unknown>) => void
