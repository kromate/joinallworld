// The sign-in provider, spoken to from the browser with fetch: no SDK. This file is fetched only when
// a player opens sign-in (accountStore.ts imports it dynamically), so nothing of it is in the first
// download.
//
// WHAT GOES WHERE. The password goes from this page straight to the provider over HTTPS and nowhere
// else: the game server never sees it. What comes back is a short-lived ID token, which is handed to
// the game server once (POST /api/account/sign-in) and then dropped; the refresh token is kept in
// memory only for as long as the "confirm your address" step is on screen. Nothing here is written
// to storage, logged or sent to telemetry.
import { refusalOf } from './accountModel.ts'
import type { ProviderRefusal } from './accountModel.ts'

const TOOLKIT = 'https://identitytoolkit.googleapis.com/v1/accounts'
const TOKENS = 'https://securetoken.googleapis.com/v1/token'
const TIMEOUT_MS = 12000

/** The provider said no, or could not be asked. Carries only which kind of refusal it was. */
export class ProviderProblem extends Error {
  readonly refusal: ProviderRefusal
  constructor(refusal: ProviderRefusal) { super(`The sign-in provider answered: ${refusal}`); this.name = 'ProviderProblem'; this.refusal = refusal }
}
/** What a successful sign-in at the provider yields. Held in memory only. */
export interface ProviderTokens { idToken: string; refreshToken: string }
export interface IdentityProviderOptions {
  apiKey: string
  /** This page's origin: the provider checks it against its list of authorised domains. */
  origin: string
  fetch?: typeof fetch
}
export interface IdentityProvider {
  signUp(email: string, password: string): Promise<ProviderTokens>
  signIn(email: string, password: string): Promise<ProviderTokens>
  /** Ask the provider to e-mail the address-confirmation link for this just-created account. */
  sendVerification(idToken: string): Promise<void>
  /** A fresh ID token for the same sign-in (it carries the address's current "confirmed" state). */
  refresh(refreshToken: string): Promise<ProviderTokens>
  /** Exchange a Google credential (from the Google button) for this provider's ID token. */
  withGoogle(credential: string): Promise<ProviderTokens>
  /** Remove the person's record at the provider, after the game server has deleted the account. */
  deleteUser(idToken: string): Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const token = (value: unknown): string | null => (typeof value === 'string' && value.length >= 20 && value.length <= 8192 ? value : null)

export function createIdentityProvider({ apiKey, origin, fetch: request = globalThis.fetch.bind(globalThis) }: IdentityProviderOptions): IdentityProvider {
  const key = `?key=${encodeURIComponent(apiKey)}`
  /** One POST to the provider. Never sends this site's cookies; never follows the answer anywhere. */
  async function post(url: string, type: string, body: string, creating: boolean): Promise<Record<string, unknown>> {
    let status = 0, reply: unknown = null
    try {
      const response = await request(url + key, { method: 'POST', headers: { 'content-type': type }, body, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
      status = response.status
      reply = await response.json()
    } catch { throw new ProviderProblem('unavailable') }
    if (status >= 200 && status < 300 && isRecord(reply)) return reply
    const message = isRecord(reply) && isRecord(reply.error) ? reply.error.message : undefined
    throw new ProviderProblem(refusalOf(message, status, creating))
  }
  const json = (method: string, payload: object, creating = false): Promise<Record<string, unknown>> => post(`${TOOLKIT}:${method}`, 'application/json', JSON.stringify(payload), creating)
  function tokens(reply: Record<string, unknown>, idName = 'idToken', refreshName = 'refreshToken'): ProviderTokens {
    const idToken = token(reply[idName]), refreshToken = token(reply[refreshName])
    if (!idToken || !refreshToken) throw new ProviderProblem('unavailable')
    return { idToken, refreshToken }
  }
  return {
    signUp: async (email, password) => tokens(await json('signUp', { email, password, returnSecureToken: true }, true)),
    signIn: async (email, password) => tokens(await json('signInWithPassword', { email, password, returnSecureToken: true })),
    sendVerification: async (idToken) => { await json('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken }) },
    refresh: async (refreshToken) => tokens(await post(TOKENS, 'application/x-www-form-urlencoded', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(), false), 'id_token', 'refresh_token'),
    async withGoogle(credential) {
      const reply = await json('signInWithIdp', { requestUri: origin, postBody: new URLSearchParams({ id_token: credential, providerId: 'google.com' }).toString(), returnSecureToken: true, returnIdpCredential: false })
      // The provider wants the person to prove an existing password first: that is not a sign-in.
      if (reply.needConfirmation === true || reply.providerId !== 'google.com') throw new ProviderProblem('credentials')
      return tokens(reply)
    },
    deleteUser: async (idToken) => { await json('delete', { idToken }) },
  }
}
