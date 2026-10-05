// The account screens' decisions without a DOM: what counts as an address or a password here, what
// each refusal says, and what to tell the player after a sign-in. (Who a person is, is decided by the
// sign-in provider and checked by the server: server/accounts/token.ts. Design: docs/ACCOUNTS.md.)
import type { SignInOutcome, SignInResponse } from '../../../types/account.ts'

/** A new password is at least this long. The provider's own policy is the authority; this only saves a round trip. */
export const NEW_PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

/** The address as it is sent: trimmed and lower-case. */
export const cleanEmail = (typed: string): string => typed.trim().toLowerCase()
/** Why this is not an address that can be sent, or ''. Only its shape is judged. */
export function emailProblem(typed: string): string {
  const email = cleanEmail(typed)
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Enter your e-mail address.'
}
/** Why this password cannot be sent, or ''. A new one has a minimum; signing in only needs something typed. */
export function passwordProblem(password: string, creating: boolean): string {
  if (password.length > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`
  if (creating) return password.length >= NEW_PASSWORD_MIN ? '' : `Use a password of at least ${NEW_PASSWORD_MIN} characters.`
  return password.length ? '' : 'Enter your password.'
}

/**
 * What the provider refused, reduced to what may be shown. Signing in has ONE sentence for a wrong password, an
 * unknown address, a malformed address and a disabled account; creating has one for every refusal that is not about
 * the password — so the screen never says whether an address has an account.
 */
export type ProviderRefusal = 'credentials' | 'not_created' | 'weak_password' | 'throttled' | 'unavailable' | 'cancelled'
export const PROVIDER_TEXT: Readonly<Record<ProviderRefusal, string>> = {
  credentials: 'That e-mail and password do not match an account.',
  not_created: 'An account could not be created with that e-mail. If you already have one, sign in or reset your password.',
  weak_password: 'Choose a longer, less common password.',
  throttled: 'Too many attempts. Wait a few minutes and try again.',
  unavailable: 'Sign-in cannot be reached right now. Try again shortly.',
  cancelled: 'Sign-in was cancelled.',
}
const THROTTLED = ['TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED', 'RESOURCE_EXHAUSTED']
const WEAK = ['WEAK_PASSWORD', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS']
const CREDENTIALS = ['INVALID_LOGIN_CREDENTIALS', 'INVALID_CREDENTIAL', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_EMAIL', 'USER_DISABLED', 'MISSING_PASSWORD', 'MISSING_EMAIL', 'INVALID_IDP_RESPONSE', 'FEDERATED_USER_ID_ALREADY_LINKED']
/** The provider's error message (`EMAIL_EXISTS`, `WEAK_PASSWORD : …`) as one of the refusals above. */
export function refusalOf(message: unknown, status: number, creating: boolean): ProviderRefusal {
  const code = typeof message === 'string' ? /^[A-Z_]+/.exec(message)?.[0] ?? '' : ''
  if (status === 429 || THROTTLED.includes(code)) return 'throttled'
  if (status >= 500 || !code) return 'unavailable'
  if (WEAK.includes(code)) return creating ? 'weak_password' : 'credentials'
  if (creating) return 'not_created'
  return CREDENTIALS.includes(code) ? 'credentials' : 'unavailable'
}

/** What the game server refused, as a sentence. Anything unknown reads as "try again". */
export const SERVER_TEXT: Readonly<Record<string, string>> = {
  invalid_token: 'That sign-in could not be confirmed. Sign in again.',
  email_unverified: 'Confirm your e-mail address first: open the link we sent you.',
  parked_full: 'This account already has as many set-aside characters as it can hold. Keep playing here as a guest, or sign in from a device without a character.',
  account_rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  accounts_unavailable: 'Sign-in cannot be reached right now. Try again shortly.',
  storage_unavailable: 'The server could not save this, so nothing was changed. Try again in a moment.',
  csrf_rejected: 'This page is out of date. Reload it and try again.',
  origin_required: 'This page is out of date. Reload it and try again.',
  account_required: 'You are not signed in on this device.',
  account_mismatch: 'That sign-in is for a different account.',
  character_not_found: 'That character is no longer set aside.',
  character_unavailable: 'That character could not be brought back. Nothing was changed.',
  not_found: 'Accounts are not available on this server.',
}
export const serverText = (code: unknown): string => (typeof code === 'string' && Object.hasOwn(SERVER_TEXT, code) ? SERVER_TEXT[code] ?? '' : 'That did not work. Try again in a moment.')

/** What a reset request always answers, whatever the address is. */
export const RESET_SENT = 'If that address has an account, an e-mail with a reset link is on its way.'
export const VERIFY_SENT = 'We sent a link to your e-mail address. Open it to confirm the address, then come back here.'
export const VERIFY_PENDING = 'That address is not confirmed yet. Open the link in the e-mail we sent, then try again.'

/** After a sign-in: what happened to the character, in one sentence. */
export function outcomeText(result: Pick<SignInResponse, 'outcome' | 'character' | 'parked'>): string {
  const name = result.character?.name ?? ''
  const said: Record<SignInOutcome, string> = {
    linked: `Saved. ${name || 'Your character'} is now kept with your account: sign in on any device to play on.`,
    restored: `Welcome back. This device now plays ${name || 'your character'}.`,
    parked: `This account already has a character, ${name || 'your saved character'}. It is the one in play.`,
    signed_in: 'You are signed in. The character you start now is kept with your account.',
  }
  return said[result.outcome]
}
/** Whether the character in play on this device is a different one than before the sign-in (the cached copy of the old one must go). */
export const characterChanged = (outcome: SignInOutcome): boolean => outcome !== 'linked'

/** `email_verified` as the token's own payload states it — used only to decide which screen to show; the server verifies the token itself. */
export function tokenSaysVerified(idToken: string): boolean {
  try {
    const part = idToken.split('.')[1] ?? ''
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4))
    const claims: unknown = JSON.parse(json)
    return claims !== null && typeof claims === 'object' && (claims as { email_verified?: unknown }).email_verified === true
  } catch { return false }
}
/** A claim of a Google credential's payload (its `nonce`), or undefined. Reading only: nothing is trusted on the strength of it. */
export function credentialClaim(credential: string, name: string): unknown {
  try {
    const part = credential.split('.')[1] ?? ''
    const claims: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)))
    return claims !== null && typeof claims === 'object' ? (claims as Record<string, unknown>)[name] : undefined
  } catch { return undefined }
}
