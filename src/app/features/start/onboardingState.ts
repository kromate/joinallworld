// What the settle-in sheet keeps between openings, as the existing panel keeps it in module
// variables: the draft being edited (so closing the sheet and opening it again resumes where it
// was), the card on screen, the pending request, the last refusal and the shuffle to undo.
// Every step is saved by the server; this is only the draft.
import { reactive } from 'vue'
import type { LifeState, Look } from '../../../types/life.ts'
import type { PanelView } from '../../types/panel.ts'
import { LAST_STEP, firstStep, keepLook, storedLook } from './onboardingModel.ts'
import type { Draft } from './onboardingModel.ts'

export const ob = reactive<{ draft: Draft | null; shown: number; error: string; pending: string; owner: string | null; undo: Look | null; offered: boolean }>({
  draft: null, shown: 0, error: '', pending: '', owner: null, undo: null, offered: false,
})
/** The data-key of the control to put the keyboard on after a tap. */
export const focus = { key: '' }

/** Whose draft this is: the session and the city. */
export const ownerOf = (view: Pick<PanelView, 'session' | 'cityId'>): string => `${view.session?.id ?? 'local'}:${view.cityId}`

/** Start the draft from the saved state — unless it is already this life's. */
export function sync(state: Pick<LifeState, 'onboarding'>, view: Pick<PanelView, 'session' | 'cityId' | 'onboarding'>): void {
  const o = state.onboarding, key = ownerOf(view)
  if (ob.draft && ob.owner === key) return
  ob.owner = key
  ob.draft = { look: (o.step === 0 && storedLook(key)) || { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house, extra: {} }
  ob.shown = Math.max(firstStep(view.onboarding.guest), Math.min(o.step, LAST_STEP))
  ob.error = ''
  ob.pending = ''
  ob.undo = null
}
/** Keep the look being edited on the device (or forget it). */
export const storeLook = (look: Look | null): void => keepLook(ob.owner, look)
