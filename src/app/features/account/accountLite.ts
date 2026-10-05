// What the first download knows about accounts: whether they exist on this server and who, if anyone, is
// signed in on this device. It is the whole of what the top bar, the guest bar and the creator's first
// step need to decide what to show, and it asks the server one small question (GET /api/account). Every
// screen of signing in, the store that drives it and the provider's code are fetched later, when a player
// opens one (accountStore.ts builds on this state; it does not keep a second copy).
import { reactive } from 'vue'
import type { AccountResponse, AccountStateResponse, ParkedCharacter, SignInResponse } from '../../../types/account.ts'
import type { FetchJson } from '../../types/client.ts'

/** 'form' the sign-in form · 'verify' waiting for the address to be confirmed · 'choice' two characters, one to play · 'done' finished, reload to continue */
export type AccountStep = 'form' | 'verify' | 'choice' | 'done'
/** The field an error is about, so it can be shown beside that field. '' when it concerns the whole form. */
export type ErrorField = '' | 'email' | 'password'
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
  /** Which field `error` is about. */
  errorField: ErrorField
  notice: string
  step: AccountStep
  /** The address a sign-up or sign-in is waiting on, for the "check your inbox" screen. Never stored. */
  pendingEmail: string
  /** What the last sign-in did, for the sentences on the final screen and the choice screen. */
  result: Pick<SignInResponse, 'outcome' | 'character' | 'parked' | 'devices' | 'ended'> | null
}

export function createAccountLite(fetchJson: FetchJson) {
  const state = reactive<AccountState>({ loaded: false, enabled: false, googleClientId: '', guest: false, account: null, character: null, parked: [], busy: false, error: '', errorField: '', notice: '', step: 'form', pendingEmail: '', result: null })
  // In memory only, never reactive, never stored: the provider's public key and this session's anti-forgery token.
  let apiKey = '', csrf: string | null = null, loading: Promise<void> | null = null

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
    loading ??= fetchJson<AccountResponse>('/api/account').then(apply, () => { /* unreachable: accounts simply stay hidden until the next attempt */ }).finally(() => { loading = null })
    return loading
  }
  return {
    state, load,
    /** The provider's public key, as the server last told it. */
    key: (): string => apiKey,
    /** This session's anti-forgery token. */
    token: (): string | null => csrf,
    setToken(next: string): void { csrf = next },
  }
}
export type AccountLite = ReturnType<typeof createAccountLite>
