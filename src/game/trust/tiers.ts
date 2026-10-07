/**
 * OWNER: trust. Who a player is to strangers, and what that lets them post. Pure and portable (server and client both
 * read it). Money level L0: no money moves through Allworld, so trust is about who you meet and where you are sent.
 *
 *   guest     a device character that never claimed an account: may browse, may not post, contact or verify
 *   claimed   T0, a signed-in account
 *   phone     T1, phone checked by a provider (none configured yet: "coming soon"), or an admin checked it by hand
 *   id        T2, ID checked by a provider (only the result and a reference are kept, never a BVN, NIN or picture)
 *   business  T3, a registered business checked by hand
 *
 * GATES (POST_RULES): a stall needs T1; a gig or a class needs T2; a meetup needs T2 and an "I am 18 or older" answer.
 * Every gate also waits out NEW_ACCOUNT_COOLDOWN_MS after the account was made, and is closed while the player's
 * listings are held after COMPLAINT_HOLD_AT upheld complaints (COMPLAINT_WINDOW_MS) until a moderator reviews them.
 */

export const TRUST_TIERS = ['guest', 'claimed', 'phone', 'id', 'business'] as const
export type TrustTier = (typeof TRUST_TIERS)[number]
/** The tiers a check (a provider or an admin) can grant; `guest` and `claimed` follow from the account alone. */
export const VERIFIED_TIERS = ['phone', 'id', 'business'] as const satisfies readonly TrustTier[]
export type VerifiedTier = (typeof VERIFIED_TIERS)[number]

export const TIER_LABELS: Record<TrustTier, string> = {
  guest: 'Guest',
  claimed: 'Account',
  phone: 'Phone checked',
  id: 'ID checked',
  business: 'Business checked',
}

export const isTrustTier = (value: unknown): value is TrustTier => typeof value === 'string' && (TRUST_TIERS as readonly string[]).includes(value)
export const isVerifiedTier = (value: unknown): value is VerifiedTier => typeof value === 'string' && (VERIFIED_TIERS as readonly string[]).includes(value)
export const tierRank = (tier: TrustTier): number => TRUST_TIERS.indexOf(tier)
/** `tier` is `need` or higher. */
export const atLeast = (tier: TrustTier, need: TrustTier): boolean => tierRank(tier) >= tierRank(need)

export const POST_KINDS = ['stall', 'gig', 'class', 'meetup'] as const
export type PostKind = (typeof POST_KINDS)[number]
export const POST_RULES: Record<PostKind, { tier: TrustTier; adult: boolean; label: string }> = {
  stall: { tier: 'phone', adult: false, label: 'open a stall' },
  gig: { tier: 'id', adult: false, label: 'post a gig' },
  class: { tier: 'id', adult: false, label: 'run a class' },
  meetup: { tier: 'id', adult: true, label: 'host a meetup' },
}

export const HOUR_MS = 3600000
export const DAY_MS = 24 * HOUR_MS
/** A new account waits this long before it can post anything strangers act on. */
export const NEW_ACCOUNT_COOLDOWN_MS = DAY_MS
/** Upheld complaints count for this long. */
export const COMPLAINT_WINDOW_MS = 90 * DAY_MS
/** This many upheld complaints in the window hold a player's listings until a moderator reviews them. */
export const COMPLAINT_HOLD_AT = 3

/** What another player can see about someone before they deal with them. Never an address, a phone number or a real name. */
export interface TrustBadge { id: string; name: string; tier: TrustTier; label: string; complaints: number; held: boolean }

/** What the gate needs to know about the player who wants to post. */
export interface PosterFacts {
  tier: TrustTier
  /** true: answered "18 or older"; false: answered "under 18"; null: not answered. */
  adult: boolean | null
  /** When the account was made (server ms); absent for a guest. */
  accountAt?: number
  /** Listings held after upheld complaints. */
  held: boolean
  now: number
}
export interface TrustRefusal { code: string; reason: string }

const refuse = (code: string, reason: string): TrustRefusal => ({ code, reason })
const hoursWords = (ms: number): string => { const hours = Math.max(1, Math.ceil(ms / HOUR_MS)); return hours === 1 ? 'an hour' : `${hours} hours` }

/** null when the player may post this kind of thing now, or why not, in a sentence they can act on. */
export function postBlock(kind: PostKind, facts: PosterFacts): TrustRefusal | null {
  const rule = POST_RULES[kind]
  if (facts.tier === 'guest') return refuse('account_required', `Claim your account first. Guests can look around, but only an account can ${rule.label}.`)
  if (facts.held) return refuse('listings_held', 'Your listings are on hold after three upheld complaints. A moderator will review them; until then you cannot post new ones.')
  if (rule.adult && facts.adult === false) return refuse('adults_only', `You said you are under 18, so you cannot ${rule.label}. Meetups are for adults only.`)
  if (rule.adult && facts.adult !== true) return refuse('age_required', `Tell us you are 18 or older before you ${rule.label}.`)
  if (!atLeast(facts.tier, rule.tier)) {
    return refuse('verification_required', rule.tier === 'phone'
      ? `You need a checked phone number to ${rule.label}. Phone checks are coming soon.`
      : `You need a checked ID to ${rule.label}. ID checks are coming soon.`)
  }
  const wait = (facts.accountAt ?? facts.now) + NEW_ACCOUNT_COOLDOWN_MS - facts.now
  if (wait > 0) return refuse('account_too_new', `New accounts wait a day before they ${rule.label}. Try again in ${hoursWords(wait)}.`)
  return null
}
