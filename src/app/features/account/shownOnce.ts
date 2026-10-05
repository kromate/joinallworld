// "signup_shown" is told once per place per page load: a redraw, or a bar that comes and goes, is not another offer.
import { track } from './accountTrack.ts'
import type { SignupWhere } from './accountTrack.ts'

const told = new Set<SignupWhere>()
export function signupShown(where: SignupWhere): void {
  if (told.has(where)) return
  told.add(where)
  track('signup_shown', { where })
}
/** For tests: forget what was told. */
export const forgetShown = (): void => told.clear()
