// What the rest of the shell needs to know about the tour, and nothing more: whether it is on screen.
// The attention ring, the coach line and the settle-in offer stay quiet while it is (and resume after).
// The tour itself (TourHost.vue and what it uses) is fetched when it is first needed.
import { reactive } from 'vue'

export const tour = reactive({ active: false })

/** Funnel events through the consent-gated 'jaw:track' path. No personal data: a step index, never a name or a place. */
export function track(name: string, props: Record<string, string | number | boolean> = {}): void {
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })) } catch { /* no listener is fine */ }
}
