// "What you can do now": what the card remembers (which situations were dismissed) and the words it hands to other screens.
// The numbers and the rules are the game's (src/game/relief.ts); the card shows what src/game/reliefHelp.ts works out.
import { helpOf } from './reliefHelp.ts'
import { makeContext } from '../../../game/util.ts'
import type { LifeState } from '../../../types/life.ts'
import type { ReliefAction, ReliefHelp } from '../../../types/view.ts'

const KEY = 'jaw-relief-dismissed'
const KEPT = 20

/** A device's list of dismissed situations: a situation is its `key`, so a different one (another city, hunger as well) is shown. */
export function createDismissals(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const read = (): string[] => {
    try { const raw = JSON.parse(storage?.getItem(KEY) ?? '[]') as unknown; return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(-KEPT) : [] } catch { return [] }
  }
  let kept = read()
  return {
    has: (key: string): boolean => kept.includes(key),
    add(key: string): void { if (!kept.includes(key)) kept = [...kept, key].slice(-KEPT); try { storage?.setItem(KEY, JSON.stringify(kept)) } catch { /* it lasts for this visit */ } },
    /** A card shown again for the same situation after the player left it (they got home): the next time it comes it is new. */
    clear(key: string): void { kept = kept.filter((item) => item !== key); try { storage?.setItem(KEY, JSON.stringify(kept)) } catch { /* ignore */ } },
  }
}

/** The help to show in the HUD: not a dismissed situation. */
export const shownHelp = (help: ReliefHelp | null | undefined, isDismissed: (key: string) => boolean): ReliefHelp | null => (help && !isDismissed(help.key) ? help : null)

/** The message ready in the box when a stuck player asks a friend (a plain sentence, no request feature). */
export function askFriendText(where: string, cash: number, home: string | null): string {
  const money = `₦${Math.round(cash).toLocaleString('en-NG')}`
  return `Hi! I am stuck in ${where} with ${money}.${home ? ` Could you send me a little so I can get home to ${home}?` : ' Could you send me a little to get by?'} Thank you!`
}

/** The label of the main button of an action: what happens when it is tapped. */
export function actionVerb(action: ReliefAction): string {
  switch (action.id) {
    case 'odd-job': case 'bench': case 'tap': case 'clinic': return action.here ? 'Do it now' : 'Go there'
    case 'credit-ride': return 'Ride home'
    case 'friend': return 'Write'
    case 'cash-box': return 'Open'
    case 'repay': return 'Pay now'
  }
}

/** The card for the life as it stands now. */
export const helpNow = (state: LifeState, cityId: string): ReliefHelp | null => helpOf(state, makeContext({ cityId, now: state.t }))

/** A wait in words a person says: "under a minute", "12 min", "3 h 45 min" (rounded up to the minute). */
export function humanWait(seconds: number): string {
  if (!(seconds >= 60)) return 'under a minute'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

const clock = (hours: string | undefined, minutes: string | undefined, seconds?: string): number => Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)

/** The short line under a row that cannot be done now: "Again in 3 h 45 min", "Closed · opens in 2 h 3 min", else the game's own sentence. */
export function shortReason(reason: string): string {
  const again = /available again in (?:(\d+)m )?(\d+)s/.exec(reason)
  if (again) return `Again in ${humanWait(clock(undefined, again[1], again[2]))}`
  const opens = /Opens in (?:(\d+)h )?(?:(\d+)m)?/.exec(reason)
  if (opens && /closed/i.test(reason)) return `Closed · opens in ${humanWait(clock(opens[1], opens[2]))}`
  return reason
}

/** The rows in the order they are offered: what can be done now first, then what cannot (each group in the order the game gave). */
export const orderedActions = (actions: readonly ReliefAction[]): ReliefAction[] => [...actions.filter((action) => !action.blocked), ...actions.filter((action) => action.blocked)]
