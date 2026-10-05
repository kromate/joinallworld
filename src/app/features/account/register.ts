// The account panels: static metadata only, so the first download carries none of the sign-in code.
// The component (and through it the store and, later still, the provider's code) is fetched the
// first time the screen is opened.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'

/** The id the rest of the game opens: `shell.open(ACCOUNT_PANEL, { intent: 'save' | 'sign-in' })`. */
export const ACCOUNT_PANEL = 'account-sign-in'
/**
 * Sign in, or save this device's character to an account. It may be opened over the landing screen and over a life
 * that is still held for its look (role 'session-gate' is what lets a sheet do that), and it is listed AFTER the
 * landing screen (`order`), which therefore stays the gate a new device is shown.
 */
export const accountSignIn = definePanel({
  id: ACCOUNT_PANEL, title: 'Your account', placement: 'modal', role: 'session-gate', live: false, order: 200,
  component: defineAsyncComponent(() => import('./AccountSignIn.vue')),
})

export const ACCOUNT_PANELS: readonly VuePanel[] = [accountSignIn]
