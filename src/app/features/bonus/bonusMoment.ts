// The moment of being paid, in order: the wallet is read again (the top bar counts up to the new balance and the sound system hears the money
// come in), then one toast, one line from the companion, and the server is told it was seen so that no other device or visit repeats it.
import type { BonusClaimResponse } from '../../../types/account.ts'
import type { Say } from '../companion/say.ts'
import { companionLine, momentToast } from './bonusModel.ts'

export interface MomentDeps {
  /** POST /api/account/bonus; `seen` records that the moment was shown. */
  ask(seen?: boolean): Promise<BonusClaimResponse | null>
  /** Read the life again. */
  refresh(): Promise<unknown>
  toast(text: string): void
  say(line: Say): void
  /** The character's first name, or ''. */
  firstName(): string
}
export async function runMoment(deps: MomentDeps): Promise<'shown' | 'none'> {
  const answer = await deps.ask()
  if (!answer || answer.state !== 'paid' || !answer.show) return 'none'
  await deps.refresh()
  deps.toast(momentToast(answer))
  deps.say({ id: 'launch-bonus', text: companionLine(deps.firstName(), answer.amount), actions: [{ kind: 'open', id: 'houses', label: 'Look at homes' }] })
  await deps.ask(true)
  return 'shown'
}
