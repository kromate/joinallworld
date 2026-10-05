// The ways into the sign-in sheet, each one a funnel event ('signup_opened' / 'login_opened', with where it was pressed).
// Small enough for the first download: the sheet itself is fetched when it opens (register.ts).
import type { Shell } from '../../state/shell.ts'
import { ACCOUNT_PANEL } from './register.ts'
import { track } from './accountTrack.ts'
import type { SignupWhere } from './accountTrack.ts'

type Opener = Pick<Shell, 'open'>
/** "Sign up free": the create-account form (a guest's character is kept with the account). */
export function openSignup(shell: Opener, where: SignupWhere, guest = true): void {
  track('signup_opened', { where })
  shell.open(ACCOUNT_PANEL, { intent: guest ? 'save' : 'sign-in', mode: 'create', where })
}
/** "Log in": the sign-in form (the saved character is played on this device). */
export function openLogin(shell: Opener, where: SignupWhere): void {
  track('login_opened', { where })
  shell.open(ACCOUNT_PANEL, { intent: 'sign-in', mode: 'sign-in', where })
}
/** The signed-in chip: who is signed in, the devices, sign out. */
export function openAccount(shell: Opener): void { shell.open(ACCOUNT_PANEL, { intent: 'account' }) }
