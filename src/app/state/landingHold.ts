// One thing at a time on the first landing. While the walkthrough is due or running, the things that would compete with
// it wait: the hint to click the floor, the welcome and other non-critical toasts, and the invitation chip. When it ends
// they are let go one at a time, a few seconds apart (the same spacing the invitation nudges keep).
import { reactive, watch } from 'vue'
import { tour } from '../features/tour/tourState.ts'
import { releaseToasts, toastHold } from './toasts.ts'

/** What is still waiting. */
export const hold = reactive({ hint: false, toasts: false, invite: false })
/** Between one thing coming back and the next. */
export const RELEASE_GAP_MS = 3500

let timers: ReturnType<typeof setTimeout>[] = []
function apply(): void {
  const body = globalThis.document?.body
  if (body) { if (hold.hint) body.dataset['holdHint'] = ''; else delete body.dataset['holdHint'] }
  toastHold.value = hold.toasts
}
export function startLandingHold(): void {
  watch(() => tour.pending || tour.active, (busy) => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
    if (busy) { hold.hint = hold.toasts = hold.invite = true; apply(); return }
    hold.hint = false; apply()
    timers.push(setTimeout(() => { hold.toasts = false; apply(); releaseToasts() }, RELEASE_GAP_MS))
    timers.push(setTimeout(() => { hold.invite = false }, RELEASE_GAP_MS * 2))
  })
}
