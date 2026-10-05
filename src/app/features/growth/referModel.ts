// What Bring a friend says, worked out from the hello's referral view. Pure, so it is tested
// without a browser. Rules: server/growth/referral.ts; numbers: src/game/content/growth.ts.
import type { ReferralView } from '../../../types/growth.ts'

/** The red badge on the Friends icon: counted friends whose reward the player has not been paid yet. */
export const referBadge = (referral: Pick<ReferralView, 'owed'> | null | undefined): number => referral?.owed || 0
