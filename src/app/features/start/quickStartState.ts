// What the landing screen keeps between openings, as the existing panel keeps it in module
// variables: whether the keyboard focus goes back to a tapped control, how many taps the player has
// made (reported with Play), the sentence of the last mistake, and whether "More options" is open.
import { reactive, shallowRef } from 'vue'
import type { QuickDraft } from './startBoundary.ts'
import { quickDraft } from './startBoundary.ts'

export const qs = reactive({ more: false, error: '', taps: 0, landed: false })
/** The data-key of the control to put the keyboard on after a tap ('' = Play). */
export const focus = { key: '' }
/** The draft being edited, mirrored here so the screen redraws when it changes (the device keeps the truth, in startBoundary.ts). */
export const draft = shallowRef<QuickDraft | null>(null)
export function currentDraft(name?: string): QuickDraft {
  const kept = quickDraft(name)
  if (draft.value !== kept) draft.value = kept
  return kept
}
