// What a location-confirmed badge says, in one place. Honest by construction: it is the player's own device that said so, the game
// has checked no document and knows where nobody is, and the badge never says "verified".
import type { WorldBadge } from '../../../types/world.ts'

export const BADGE_NOTE = 'Optional. You can live anywhere in Allworld wherever you are in the real world.'

/** The full wording, for a tooltip, a screen reader and the card. `own` reads "your device". */
export function badgeLong(badge: WorldBadge, own = false): string {
  const who = own ? 'your device' : 'their device'
  return badge.name ? `Lives in ${badge.name} · confirmed by ${who}` : `Location-confirmed · confirmed by ${who}`
}
/** The short form beside a name: the local government, or a generic tick when it is private. */
export const badgeShort = (badge: WorldBadge): string => badge.name ?? 'Location-confirmed'
