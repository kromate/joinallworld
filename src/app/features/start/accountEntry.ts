// The start screens' way into accounts. An account is optional: this only says whether sign-in
// exists on this server and opens the sheets.
//
//   const account = useAccountEntry()
//   <button v-if="account.available" @click="account.openSignUp()">Sign up free</button>
//
// `available` is false until the server has said accounts are configured, and stays false when they
// are not — the caller shows nothing then. It is read from reactive state, so a template that reads
// it is redrawn when the answer arrives.
import { useApp } from '../../state/app.ts'
import { openLogin, openSignup } from '../account/accountOpen.ts'
import { useAccountLite } from '../account/useAccountLite.ts'

export interface AccountEntry {
  /** Accounts are configured on this server. */
  readonly available: boolean
  /** Signed in on this device already (the creator then offers none of the choices). */
  readonly signedIn: boolean
  /** "Sign up free — keep your character": create an account; the character being made is kept with it. */
  openSignUp(): void
  /** "I already have an account · Log in": sign in, and play the account's character on this device. */
  openSignIn(): void
  /** "Save your character" on the last step: sign in or create an account, and keep this device's character with it. */
  openSave(): void
}

export function useAccountEntry(): AccountEntry {
  const account = useAccountLite(), { shell } = useApp()
  void account.load()
  return {
    get available() { return account.state.loaded && account.state.enabled },
    get signedIn() { return account.state.account !== null },
    openSignUp() { openSignup(shell, 'creator', account.state.guest) },
    openSignIn() { openLogin(shell, 'creator') },
    openSave() { openSignup(shell, 'ready', account.state.guest) },
  }
}
