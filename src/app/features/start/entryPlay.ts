// "Play now" on the entry page: the same one-tap guest start the creator sends (CreatorApp.vue playNow), with the character the device
// already holds (a random look and a suggested name, made once and kept). Nothing here decides anything the server does: it keeps
// the tapped Play on the device until the server has answered, reports the funnel, and sends 'jaw:quick-start' for App.vue.
// The card is NOT closed here: it stays up saying "Starting…" until the life exists (the app closes it then, or reopens it with what
// went wrong). Closing it at the tap left a bare screen for two round trips, on the step where half the taps were lost.
import { keepPlay, play } from '../../../quick-start/entry.ts'
import { isDefaultName } from '../../../game/cities/registry.ts'
import { cr } from './creatorState.ts'
import { planPlay } from './quickStartModel.ts'
import { currentDraft, draft as quickDraftRef, qs } from './quickStartState.ts'
import { joinTarget, keepDraft, pendingRef, presetLook, track } from './startBoundary.ts'
import { fallbackPreset } from './quickStartModel.ts'

export interface EntryPlayDeps { viewName: string }

/** Is an invite or share link waiting for this Play? */
export const invitedNow = (): boolean => Boolean(joinTarget() || pendingRef())

/** The first Play of this device. Returns false when it did nothing (one is already being sent). `city`: born there, when it is open. */
export function playFromEntry(deps: EntryPlayDeps, city: string | null = null): boolean {
  if (play.sending) return false
  qs.taps += 1
  const quick = currentDraft(isDefaultName(deps.viewName) ? undefined : deps.viewName)
  let plan = planPlay(quick.name, quick.look)
  if (plan.kind === 'look') {
    // A character that cannot be used is replaced by the first preset, exactly as the creator does.
    const fallback = presetLook(fallbackPreset().id)
    if (fallback) { quickDraftRef.value = keepDraft({ look: fallback, preset: fallbackPreset().id }); plan = planPlay(quick.name, fallback) }
  }
  if (plan.kind !== 'go') return false
  const now = quickDraftRef.value ?? quick
  quickDraftRef.value = keepDraft({ name: plan.name })
  keepPlay({ look: plan.look, ...(invitedNow() ? { joining: true } : {}) })
  track('named', { edited: now.nameEdited, length: plan.name.length })
  track('quick_look_done', { shuffles: now.shuffles, preset: now.preset, edited: false })
  track('play_tapped', { taps: qs.taps })
  void import('../growth/attribution.ts').then((counting) => { counting.noteSource('play') })
  play.sending = true
  play.settling = false
  cr.city = city
  window.dispatchEvent(new CustomEvent('jaw:quick-start', { detail: { name: plan.name, look: plan.look, ...(city ? { city } : {}) } }))
  return true
}
