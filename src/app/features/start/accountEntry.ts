// The start screens' way into accounts. An account is optional: this only says whether sign-in
// exists on this server and opens the two screens.
//
//   const account = useAccountEntry()
//   <button v-if="account.available" @click="account.openSignIn()">Sign in</button>
//
// `available` is false until the server has said accounts are configured, and stays false when they
// are not — the caller shows nothing then. It is read from reactive state, so a template that reads
// it is redrawn when the answer arrives.
import { useApp } from '../../state/app.ts'
import { ACCOUNT_PANEL } from '../account/register.ts'
import { useAccount } from '../account/useAccount.ts'

export interface AccountEntry {
  /** Accounts are configured on this server. */
  readonly available: boolean
  /** "I already have an account": sign in, and play the account's character on this device. */
  openSignIn(): void
  /** "Save your character": sign in or create an account, and keep this device's character with it. */
  openSave(): void
}

export function useAccountEntry(): AccountEntry {
  const account = useAccount(), { shell } = useApp()
  void account.load()
  return {
    get available() { return account.state.loaded && account.state.enabled },
    openSignIn() { shell.open(ACCOUNT_PANEL, { intent: 'sign-in' }) },
    openSave() { shell.open(ACCOUNT_PANEL, { intent: 'save' }) },
  }
}
