// The typed boundary to the quick start's device-side state (src/quick-start/entry.js): what the
// landing screen — the existing 'quick-start' panel, shown through LegacyPanel — keeps on the
// device between tapping Play and the server confirming the look. The module is still JavaScript
// and still the single owner of that state; the landing screen and this shell read the same
// `play` object.
import { forgetDraft as forgetDraftJs, keepPlay as keepPlayJs, pendingPlay as pendingPlayJs, play as playJs } from '../../quick-start/entry.ts'
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
