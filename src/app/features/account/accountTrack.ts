// The funnel of signing up, reported through the consent-gated 'jaw:track' path (src/telemetry/events.ts lists every
// event and the properties it may carry). Words only: where a button was, which way a sign-in went. Never an address,
// a name, a password or a token.
export function track(name: string, props: Record<string, string | number | boolean> = {}): void {
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })) } catch { /* no listener is fine */ }
}
/** Where a sign-up or log-in was started from. */
export type SignupWhere = 'hud' | 'creator' | 'guestbar' | 'tour' | 'settings' | 'ready'
