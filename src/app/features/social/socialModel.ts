// What the People, Contacts, Family and Invite screens say and when a control is off, worked out
// without a DOM: the badges, the closeness line, why a call or a search cannot be made, and the
// gate every social screen shows until the overview has loaded. Pure, so node --test reaches it.
import type { SocialOverview } from '../../../types/social.ts'

/** Friend and Bae requests waiting for an answer: the badge on People. */
export const requestsWaiting = (me: Pick<SocialOverview, 'requests' | 'baeRequests'> | null | undefined): number => (me?.requests.in.length || 0) + (me?.baeRequests.length || 0)
/** Knocks at the door: the badge on Invite. */
export const knocksWaiting = (me: Pick<SocialOverview, 'house'> | null | undefined): number => me?.house.knocks.length || 0
