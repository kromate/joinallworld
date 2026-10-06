// What the admin address's page shows, decided from what the server said, without a screen. Pure, so it is tested without a browser.
export type Phase = 'loading' | 'signin' | 'denied' | 'ready' | 'off' | 'down'
/** `me`: what GET /api/admin/me answered (null until it was asked): ok, refused with the plain 404 every non-admin gets, or failed some other way. */
export function phaseOf(account: { enabled: boolean; signedIn: boolean }, me: 'ok' | 'refused' | 'failed' | null): Phase {
  if (!account.enabled) return account.signedIn ? 'denied' : 'off'
  if (!account.signedIn) return 'signin'
  return me === 'ok' ? 'ready' : me === 'refused' ? 'denied' : me === 'failed' ? 'down' : 'loading'
}
/** The game's own address, for the way back: the admin host name without its first label, with the same scheme and port. */
export const gameUrlOf = (location: { protocol: string; host: string }): string => `${location.protocol}//${location.host.replace(/^admin\./, '')}/`
export const STAFF_ONLY = 'This area is for Allworld staff'
