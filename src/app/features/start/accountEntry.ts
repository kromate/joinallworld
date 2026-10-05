// The one place where character creation meets sign-in. The creator asks for two things only:
//
//   openSignIn()  a returning player on the first screen: "I already have a character"
//   openSave()    after the character is made: "Save your character" (keep it, and the life, on an account)
//
// and shows each button only while `available` is true. Nothing is wired here: with no account
// feature registered the buttons are hidden and the guest flow is exactly the one without accounts.
// The account feature calls registerAccountEntry() once, when it is ready to be used; the creator
// reads the same reactive object, so the buttons appear the moment it does.
import { shallowReactive } from 'vue'

export interface AccountEntry {
  /** True when the sign-in and save screens exist and can be opened. */
  available: boolean
  /** Open the sign-in screen for a player who already has a character. */
  openSignIn(): void
  /** Open the screen that keeps this character on an account. */
  openSave(): void
}

const entry = shallowReactive<AccountEntry>({ available: false, openSignIn() { /* not wired */ }, openSave() { /* not wired */ } })

/** The account feature's side: make the buttons appear and say what they do. Returns a function that takes them away again. */
export function registerAccountEntry(next: Pick<AccountEntry, 'openSignIn' | 'openSave'>): () => void {
  entry.openSignIn = next.openSignIn
  entry.openSave = next.openSave
  entry.available = true
  return () => { entry.available = false }
}

/** The creator's side: read `available` and call the two functions. */
export const useAccountEntry = (): AccountEntry => entry
