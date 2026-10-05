// ONE CHARACTER ON SEVERAL DEVICES (docs/DEVICES.md), as the shell needs it.
//
// The character is shared: its place, its city and a running trip are the server's, the same on every device. The
// SCREEN is each device's own: which panel is open, the Map or the venue, the camera. So when the place changed because
// of something done on another device, this device's scene follows it and says so in one calm line — and whatever the
// person has open here stays open. decide that with continuedElsewhere(); nothing here touches the DOM.
import { isDeparting } from '../../life.ts'
import type { ChangeCause } from '../../client.ts'
import type { LifeState } from '../../types/life.ts'

/** What a device says, once, when its character was moved on from another device of the same player. */
export const CONTINUED_TEXT = 'Continued from your other device.'
/** The close code of a socket whose session changed: signed out, or the account plays another character. */
export const SESSION_CHANGED = 4401

/** The parts of a life that say where the character is. */
type Placed = Pick<LifeState, 'location' | 'activeAction' | 'estate'>
/** The trip a state is on, as a key ('' when it is not travelling). */
const tripOf = (state: Placed): string => { const active = state.activeAction; return active && isDeparting(state) ? `${active.kind}|${state.location}|${active.id}|${active.duration}` : '' }

/**
 * Was this change of place made somewhere else?
 *   'elsewhere'  the server named an action this device did not send: yes, when the city, the trip or the place differs;
 *   'wake'       this device was away and has just read the life: judged from the two states — a city it was not in, a
 *                trip where it had none, or a place it was not travelling to (its own trip ending is not "elsewhere");
 *   'own'        this device's own action or poll: no.
 */
export function continuedElsewhere(cause: ChangeCause, previous: Placed, state: Placed): boolean {
  if (cause === 'own') return false
  const city = state.estate.city !== previous.estate.city
  const was = tripOf(previous), now = tripOf(state)
  const place = state.location !== previous.location
  if (cause === 'elsewhere') return city || place || (now !== '' && now !== was)
  return city || (now !== '' && was === '') || (place && !isDeparting(previous))
}
