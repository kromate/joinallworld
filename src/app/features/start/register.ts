// The start and identity panels: static metadata only, exactly as the existing ones list it
// (src/ui/panels/index.js, onboarding.js, quick-start.js, session.js, account.js), so they are
// listed before any component code has been fetched. Each component is fetched the first time it
// is opened.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { play } from '../../legacy/quickStart.ts'
import { quickStartRequired } from './quickStartModel.ts'

/** The landing screen of a new device; it replaces the nickname form as the session gate. */
export const quickStart = definePanel({
  id: 'quick-start', title: 'Welcome to Allworld', placement: 'modal', role: 'session-gate', live: false,
  /** A life whose look the server has not confirmed is held here — unless its Play is being sent right now. */
  required: (_state, view) => quickStartRequired(view, play.sending),
  component: defineAsyncComponent(() => import('./QuickStartApp.vue')),
})
/** Settling in is offered, never required: a new life starts from the landing screen. */
export const onboarding = definePanel({
  id: 'onboarding', title: 'Make this life yours', placement: 'modal', live: false,
  component: defineAsyncComponent(() => import('./OnboardingApp.vue')),
})
export const session = definePanel({
  id: 'session', title: 'Your city life', placement: 'modal', role: 'session-gate', live: false,
  component: defineAsyncComponent(() => import('./SessionApp.vue')),
})
export const account = definePanel({
  id: 'account', title: 'Account', placement: 'modal',
  component: defineAsyncComponent(() => import('./AccountApp.vue')),
})

export const START_PANELS: readonly VuePanel[] = [quickStart, onboarding, session, account]
