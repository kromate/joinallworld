// The typed boundary to the quick start's device-side modules (src/quick-start/*.js): the draft the
// landing screen keeps on the device, the look rules it shares with the server, the waiting invite
// and the funnel events. They are still JavaScript and still the single owner of that state; the
// existing shell and this one read the same objects. Every cast is here.
import { keepDraft as keepDraftJs, firstLanding as firstLandingJs, quickDraft as quickDraftJs } from '../../../quick-start/draft.ts'
import { joinTarget as joinTargetJs, pendingRef as pendingRefJs, track as trackJs } from '../../../quick-start/entry.ts'
import { PRESETS as PRESETS_JS, nameProblem as nameProblemJs, presetLook as presetLookJs, shuffleLook as shuffleLookJs, starterLook as starterLookJs, suggestName as suggestNameJs, withBody as withBodyJs } from '../../../quick-start/look-model.ts'
import type { DreamId, Look, TraitId } from '../../../types/life.ts'

/** The draft the landing screen edits. `preset` is the id of the one-tap character it started from, or null. */
export interface QuickDraft { name: string; look: Look; landedAt: number; nameEdited: boolean; shuffles: number; preset: string | null; traits: TraitId[]; dream: DreamId | null; area: { lga: string; via: 'device' | 'manual' } | null }
/** The draft (made on first use, then kept). `name`: a name this device already uses. */
export const quickDraft = quickDraftJs as unknown as (name?: string) => QuickDraft
/** Change the draft and keep it on the device. */
export const keepDraft = keepDraftJs as unknown as (changes: Partial<QuickDraft>) => QuickDraft
/** True the first time the landing screen is shown on this device. */
export const firstLanding = firstLandingJs as unknown as () => boolean

/** The player an invite link points at, if one is waiting. */
export const joinTarget = joinTargetJs as unknown as () => string | null
/** The share code waiting to be attached as a referral. */
export const pendingRef = pendingRefJs as unknown as () => string | null
/** Report one funnel event ('jaw:track'); it never throws. */
export const track = trackJs as unknown as (name: string, props?: Record<string, unknown>) => void

export interface Preset { id: string; label: string; look: Look }
export const PRESETS = PRESETS_JS as unknown as readonly Preset[]
export const presetLook = presetLookJs as unknown as (id: string) => Look | null
export const shuffleLook = shuffleLookJs as unknown as (random: () => number) => Look
export const withBody = withBodyJs as unknown as (look: Look, body: string) => Look
/** What is wrong with a name before it is sent, or null. */
export const nameProblem = nameProblemJs as unknown as (value: unknown) => string | null
export const suggestName = suggestNameJs as unknown as (random: () => number) => string
/** `value` as a look a new Sim may wear, or null when any part of it is not a valid starter choice. */
export const starterLook = starterLookJs as unknown as (value: unknown) => Look | null
