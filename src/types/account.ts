// The account routes on the wire (server/routes/auth.ts; design: docs/ACCOUNTS.md). An account is optional: a guest
// plays without one, and signing in attaches the character to something that can be reached from another device.
// Nothing here carries a token, a cookie or the provider's subject id.
import type { ApiEnvelope, HostErrorCode, JsonBodyErrorCode, StorageErrorCode } from './protocol.ts'

/** How the provider says the account signed in. */
export type AccountProviderId = 'google' | 'password'
/** The public id and name of a character. */
export interface AccountCharacter { id: string; name: string }
/** A character the account has set aside; `id` is what POST /api/account/character takes as `use`. */
export interface ParkedCharacter { id: string; name: string; at: number }
/** The sign-in provider's public client configuration. `googleClientId` is '' when the Google button is not offered. */
export interface AccountProviderConfig { apiKey: string; googleClientId: string }

/**
 * GET /api/account while accounts are not configured: the client shows no sign-in at all. A browser that signed in
 * while they were configured is still told who it is (`account`) and given its token, so that it can sign out.
 */
export interface AccountsOffResponse extends ApiEnvelope { enabled: false; csrf?: string | null; account?: AccountStateResponse['account']; character?: AccountCharacter | null }
export interface AccountStateResponse extends ApiEnvelope {
  enabled: true
  provider: AccountProviderConfig
  /** The anti-forgery token of this browser's session cookie; null when it has none. Sent back as `csrf` with every change. */
  csrf: string | null
  /** This browser has a playable session (as a guest or signed in). */
  guest: boolean
  account: { email: string; provider: AccountProviderId; createdAt: number; devices: number } | null
  character: AccountCharacter | null
  parked: ParkedCharacter[]
}
export type AccountResponse = AccountsOffResponse | AccountStateResponse

/**
 *   linked     this browser's character now belongs to the account
 *   restored   this browser now plays the account's character
 *   parked     the account's character is active; the life this browser had was set aside (`parked`)
 *   signed_in  signed in; the account has no character yet, and the next new life becomes it
 */
export type SignInOutcome = 'linked' | 'restored' | 'parked' | 'signed_in'
export interface SignInRequest { idToken: string; csrf?: string | null }
export interface SignInResponse extends ApiEnvelope {
  outcome: SignInOutcome
  created: boolean
  character: AccountCharacter | null
  parked: ParkedCharacter | null
  /** Browsers signed in to the account now, this one included. */
  devices: number
  /** Other browsers this sign-in signed out: it linked a character into an account that already existed, or used another way of signing in than the account last did. */
  ended: number
  /** The token of the NEW cookie this answer set. */
  csrf: string
}
export interface SwitchCharacterResponse extends ApiEnvelope { character: AccountCharacter; parked: ParkedCharacter[] }
export interface AccountExportResponse extends ApiEnvelope {
  account: { provider: AccountProviderId; email: string; createdAt: number; lastSeenAt: number }
  devices: { signedInAt: number; lastSeenAt: number; expiresAt: number; thisDevice: boolean }[]
  character: (AccountCharacter & { cities: string[] }) | null
  setAside: ParkedCharacter[]
  history: { at: number; event: string; character?: string }[]
}

/** What every state-changing account route can refuse with, before it looks at anything else. */
export type AccountGuardErrorCode = HostErrorCode | JsonBodyErrorCode | 'origin_required' | 'csrf_rejected' | 'account_rate_limited'
/** One answer for every way a token can be wrong; 503 when the provider's keys cannot be fetched. */
export type AccountTokenErrorCode = 'invalid_token' | 'accounts_unavailable'
/** A route that needs PROOF: a signed-in browser AND a fresh ID token for that same account. */
export type AccountProofErrorCode = AccountGuardErrorCode | AccountTokenErrorCode | StorageErrorCode | 'account_required' | 'account_mismatch'

export interface AccountHttpRoutes {
  'GET /api/account': { response: AccountResponse; errors: HostErrorCode }
  'POST /api/account/sign-in': { body: SignInRequest; response: SignInResponse; errors: AccountGuardErrorCode | AccountTokenErrorCode | StorageErrorCode | 'email_unverified' | 'parked_full' | 'account_capacity' }
  /** The one account route that still answers when accounts are switched off. */
  'POST /api/account/sign-out': { body: { csrf: string }; response: ApiEnvelope & { ok: true }; errors: AccountGuardErrorCode | StorageErrorCode | 'account_required' }
  'POST /api/account/character': { body: { idToken: string; use: string; csrf: string }; response: SwitchCharacterResponse; errors: AccountProofErrorCode | 'character_not_found' | 'character_unavailable' }
  'POST /api/account/sign-out-everywhere': { body: { idToken: string; csrf: string }; response: ApiEnvelope & { ok: true; ended: number }; errors: AccountProofErrorCode }
  'POST /api/account/export': { body: { idToken: string; csrf: string }; response: AccountExportResponse; errors: AccountProofErrorCode }
  'POST /api/account/delete': { body: { idToken: string; csrf: string; confirm: 'delete'; erase?: boolean }; response: ApiEnvelope & { ok: true; kept: boolean }; errors: AccountProofErrorCode | 'confirmation_required' }
  'POST /api/account/password-reset': { body: { email: string; csrf?: string | null }; response: ApiEnvelope & { ok: true }; errors: AccountGuardErrorCode | 'invalid_email' }
}
