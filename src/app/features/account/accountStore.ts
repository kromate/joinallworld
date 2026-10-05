// The account store of the page: whether accounts exist on this server, who (if anyone) is signed in
// on this device, and the steps of signing in. Every screen under features/account reads it, and so
// does the entry the start screens call (features/start/accountEntry.ts).
//
// WHAT IS KEPT WHERE. The reactive state holds only what may be on screen: an address, a character's
// name, a sentence. Tokens live in this module's closure, in memory, for as long as a step needs them
// and never longer (a sign-in's refresh token until the page starts again, so the choice that may
// follow it can be proved); a password is passed through and not kept at all. Nothing is written to storage,
// and nothing here is reported to telemetry.
//
// The provider's code (identityProvider.ts) is imported the first time a sign-in is actually sent, so
// a page that never signs in never fetches it.
import { reactive } from 'vue'
import type { AccountResponse, AccountStateResponse, ParkedCharacter, SignInResponse, SwitchCharacterResponse, AccountExportResponse } from '../../../types/account.ts'
import type { ApiError, FetchJson } from '../../types/client.ts'
import type { IdentityProvider, ProviderTokens } from './identityProvider.ts'
import { PROVIDER_TEXT, RESET_SENT, VERIFY_PENDING, VERIFY_SENT, characterChanged, cleanEmail, emailProblem, passwordProblem, serverText, tokenSaysVerified } from './accountModel.ts'
import type { ProviderRefusal } from './accountModel.ts'

/** 'form' the sign-in form · 'verify' waiting for the address to be confirmed · 'choice' two characters, one to play · 'done' finished, reload to continue */
export type AccountStep = 'form' | 'verify' | 'choice' | 'done'
export interface AccountState {
  /** GET /api/account has answered. Until then nothing about accounts is shown. */
  loaded: boolean
  /** Accounts are configured on this server. False hides every account screen. */
  enabled: boolean
  /** The Google button's client id, or '' when Google sign-in is not offered. */
  googleClientId: string
  /** This browser has a playable session. */
  guest: boolean
  account: AccountStateResponse['account']
  character: AccountStateResponse['character']
  parked: ParkedCharacter[]
  busy: boolean
  error: string
  notice: string
  step: AccountStep
  /** What the last sign-in did, for the sentences on the final screen and the choice screen. */
  result: Pick<SignInResponse, 'outcome' | 'character' | 'parked' | 'devices' | 'ended'> | null
}
export interface AccountDeps {
  fetchJson: FetchJson
  /** The provider's code, fetched on first use. */
  loadProvider(): Promise<{ createIdentityProvider(options: { apiKey: string; origin: string }): IdentityProvider }>
  origin(): string
  /** Drop the copy of the life this device keeps: the character in play is about to be a different one. */
  forgetLife(): void
  reload(): void
}
/**
 * How the person proves who they are again — their password, or a new Google credential. Everything that reaches past
 * this browser (ending other sign-ins, the account's data, which character is in play, deleting) asks for it: the
 * server takes a fresh sign-in for that, never the cookie alone.
 */
export type Reauth = { password: string } | { credential: string }

const codeOf = (error: unknown): string | undefined => (error !== null && typeof error === 'object' ? (error as ApiError).code : undefined)
const refusalOf = (error: unknown): ProviderRefusal | null => {
  const refusal = error !== null && typeof error === 'object' ? (error as { refusal?: unknown }).refusal : undefined
  return typeof refusal === 'string' && Object.hasOwn(PROVIDER_TEXT, refusal) ? refusal as ProviderRefusal : null
}
/** The sentence for whatever went wrong: the provider's refusal, the server's code, or the connection. */
function sentence(error: unknown): string {
  const refusal = refusalOf(error)
  if (refusal) return PROVIDER_TEXT[refusal]
  const code = codeOf(error)
  if (code) return serverText(code)
  return error instanceof Error && error.message ? error.message : serverText(undefined)
}

export function createAccount(deps: AccountDeps) {
  const state = reactive<AccountState>({ loaded: false, enabled: false, googleClientId: '', guest: false, account: null, character: null, parked: [], busy: false, error: '', notice: '', step: 'form', result: null })
  // In memory only, never reactive, never stored: the provider's public key, this session's anti-forgery token, and
  // the tokens of a sign-in that is waiting for its address to be confirmed.
  let apiKey = '', csrf: string | null = null, held: ProviderTokens | null = null, changed = false
  let provider: Promise<IdentityProvider> | null = null, loading: Promise<void> | null = null

  function apply(answer: AccountResponse): void {
    state.loaded = true
    state.enabled = answer.enabled === true
    // Accounts are off. A browser that signed in while they were on is still told who it is, so that it can sign out.
    if (!answer.enabled) { state.googleClientId = ''; state.account = answer.account ?? null; state.character = answer.character ?? null; state.parked = []; state.guest = false; apiKey = ''; csrf = answer.csrf ?? null; return }
    apiKey = answer.provider.apiKey; csrf = answer.csrf
    state.googleClientId = answer.provider.googleClientId; state.guest = answer.guest
    state.account = answer.account; state.character = answer.character; state.parked = answer.parked
  }
  /** Ask the server what this browser is, account-wise. One request at a time; `again` asks even if it already answered. */
  function load(again = false): Promise<void> {
    if (state.loaded && !again) return Promise.resolve()
    loading ??= deps.fetchJson<AccountResponse>('/api/account').then(apply, () => { /* unreachable: accounts simply stay hidden until the next attempt */ }).finally(() => { loading = null })
    return loading
  }
  const theProvider = (): Promise<IdentityProvider> => (provider ??= deps.loadProvider().then((module) => module.createIdentityProvider({ apiKey, origin: deps.origin() })).catch((error: unknown) => { provider = null; throw error }))
  const post = <T>(path: string, body: Record<string, unknown>): Promise<T> => deps.fetchJson<T>(path, { method: 'POST', body: { ...body, csrf } })

  /** One thing at a time; whatever it throws becomes the sentence on screen. Resolves whether it succeeded. */
  async function attempt(work: () => Promise<void>): Promise<boolean> {
    if (state.busy) return false
    state.busy = true; state.error = ''
    try { await work(); return true }
    catch (error) { state.error = sentence(error); return false }
    finally { state.busy = false }
  }
  /** A fresh ID token from whatever the person just gave. */
  async function proofOf(reauth: Reauth): Promise<ProviderTokens> {
    const api = await theProvider()
    return 'credential' in reauth ? api.withGoogle(reauth.credential) : api.signIn(state.account?.email ?? '', reauth.password)
  }
  /** Hand a fresh ID token to the game server. The ID token is used once; the sign-in itself (`tokens`) is kept in memory for the choice that may follow. */
  async function finish(tokens: ProviderTokens): Promise<void> {
    let result: SignInResponse
    try { result = await post<SignInResponse>('/api/account/sign-in', { idToken: tokens.idToken }) }
    catch (error) {
      // The server is the one that decides an address is confirmed; if it says "not yet", wait for the person here.
      if (codeOf(error) === 'email_unverified') { held = tokens; state.step = 'verify'; state.notice = ''; throw new Error(VERIFY_PENDING) }
      throw error
    }
    held = tokens; csrf = result.csrf; changed = characterChanged(result.outcome)
    state.result = { outcome: result.outcome, character: result.character, parked: result.parked, devices: result.devices, ended: result.ended }
    state.notice = ''
    state.step = result.outcome === 'parked' && result.parked ? 'choice' : 'done'
    await load(true)
  }

  return {
    state, load,
    /** The sign-in screen was opened: start from the form with nothing left over from last time. */
    begin(): void { held = null; changed = false; state.step = 'form'; state.error = ''; state.notice = ''; state.result = null },
    /** Sign in with an address and password, or create the account (`creating`). The password is passed on and not kept. */
    withPassword(email: string, password: string, creating: boolean): Promise<boolean> {
      const problem = emailProblem(email) || passwordProblem(password, creating)
      if (problem) { state.error = problem; return Promise.resolve(false) }
      return attempt(async () => {
        const api = await theProvider()
        const tokens = creating ? await api.signUp(cleanEmail(email), password) : await api.signIn(cleanEmail(email), password)
        if (creating || !tokenSaysVerified(tokens.idToken)) {
          held = tokens
          // A new account, or one whose address was never confirmed: send the link (again) and wait.
          await api.sendVerification(tokens.idToken).catch(() => { /* the screen offers to send it again */ })
          state.step = 'verify'; state.notice = VERIFY_SENT
          return
        }
        await finish(tokens)
      })
    },
    /** "I have confirmed my address": ask the provider for a fresh token and carry on if it now says so. */
    confirmed(): Promise<boolean> {
      return attempt(async () => {
        if (!held) { state.step = 'form'; throw new Error('Sign in again to continue.') }
        held = await (await theProvider()).refresh(held.refreshToken)
        if (!tokenSaysVerified(held.idToken)) throw new Error(VERIFY_PENDING)
        await finish(held)
      })
    },
    resendVerification(): Promise<boolean> {
      return attempt(async () => {
        if (!held) { state.step = 'form'; throw new Error('Sign in again to continue.') }
        await (await theProvider()).sendVerification(held.idToken)
        state.notice = VERIFY_SENT
      })
    },
    /** A credential from the Google button. */
    withGoogle(credential: string): Promise<boolean> {
      return attempt(async () => { await finish(await (await theProvider()).withGoogle(credential)) })
    },
    /** Ask for a password-reset e-mail. The answer on screen is the same whatever the address is. */
    resetPassword(email: string): Promise<boolean> {
      const problem = emailProblem(email)
      if (problem) { state.error = problem; return Promise.resolve(false) }
      return attempt(async () => { await post('/api/account/password-reset', { email: cleanEmail(email) }); state.notice = RESET_SENT })
    },
    /**
     * The merge choice: play the set-aside character (`id`), or keep the account's (null). Swapping is proved with a
     * fresh token from the sign-in that has just happened (its refresh token is still in memory), so nothing is asked twice.
     */
    choose(id: string | null): Promise<boolean> {
      return attempt(async () => {
        if (id) {
          if (!held) throw new Error('Sign in again to choose.')
          held = await (await theProvider()).refresh(held.refreshToken)
          const answer = await post<SwitchCharacterResponse>('/api/account/character', { use: id, idToken: held.idToken })
          state.character = answer.character; state.parked = answer.parked; changed = true
        }
        state.step = 'done'
      })
    },
    /** Leave the sign-in screens for the game: the cookie is new, so the page starts again; a different character means the cached one goes first. */
    continueToGame(): void { held = null; if (changed) deps.forgetLife(); deps.reload() },
    /** From Settings, with proof: bring a set-aside character into play. */
    switchTo(id: string, reauth: Reauth): Promise<boolean> {
      return attempt(async () => { await post('/api/account/character', { use: id, idToken: (await proofOf(reauth)).idToken }); deps.forgetLife(); deps.reload() })
    },
    /** This browser only: its own sign-in is enough for that. Works while accounts are switched off too. */
    signOut(): Promise<boolean> {
      return attempt(async () => { await post('/api/account/sign-out', {}); deps.forgetLife(); deps.reload() })
    },
    /** With proof: end every other browser's sign-in. */
    signOutEverywhere(reauth: Reauth): Promise<boolean> {
      return attempt(async () => {
        const answer = await post<{ ended: number }>('/api/account/sign-out-everywhere', { idToken: (await proofOf(reauth)).idToken })
        state.notice = answer.ended === 0 ? 'No other device was signed in.' : `Signed out on ${answer.ended} other ${answer.ended === 1 ? 'device' : 'devices'}.`
        await load(true)
      })
    },
    /**
     * With proof: delete the account. `erase` also removes the saved life of the character in play; otherwise it stays
     * on this device as a guest life. The provider's own record of the person is removed last.
     */
    remove(reauth: Reauth, erase: boolean): Promise<boolean> {
      return attempt(async () => {
        const api = await theProvider()
        const tokens = await proofOf(reauth)
        await post('/api/account/delete', { idToken: tokens.idToken, confirm: 'delete', erase })
        // The game's side is done. A provider that cannot be reached now keeps only the sign-in itself, which the next sign-in would show as a new account.
        await api.deleteUser(tokens.idToken).catch(() => { /* nothing of the game is left to protect */ })
        if (erase) deps.forgetLife()
        deps.reload()
      })
    },
    /** With proof: everything the server stores about this account, for its owner. */
    async exportData(reauth: Reauth): Promise<AccountExportResponse | null> {
      let data: AccountExportResponse | null = null
      await attempt(async () => { data = await post<AccountExportResponse>('/api/account/export', { idToken: (await proofOf(reauth)).idToken }) })
      return data
    },
  }
}
export type Account = ReturnType<typeof createAccount>
