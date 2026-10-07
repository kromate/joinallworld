/**
 * OWNER: trust. THE SHARED TRUST API for stalls, passports, gigs, classes and meetups (Phase R, money level L0).
 *
 *   tiers.ts  TrustTier (guest, claimed, phone, id, business), POST_RULES and postBlock(kind, facts): may this player post?
 *   fees.ts   screenFee(text): refuses "pay to apply", registration fees, deposits and money-doubling offers (English and Pidgin)
 *   links.ts  outboundLink(text) / lineParts(body): the allow-list of places a link may send a player
 *   reports   TRUST_REPORT_REASONS and their words
 *
 * Server side (server/trust/service.ts) every feature asks the same three questions inside its transaction:
 *   trust.badge(db, publicId)                → TrustBadge (tier, complaint count, held) to show next to a listing
 *   trust.postBlock(db, session, kind)       → null | { code, reason }: refuse the post with that sentence
 *   screenFee(text) ?? screenText(text, …)   → refuse a listing's text the same way chat is refused
 * and hides a held player's listings (badge.held) from everyone but the owner.
 */
export * from './tiers.ts'
export * from './fees.ts'
export * from './links.ts'

export const TRUST_REPORT_REASONS = ['scam', 'fee-request', 'fake-item', 'abuse', 'under-18'] as const
export type TrustReportReason = (typeof TRUST_REPORT_REASONS)[number]
export const TRUST_REPORT_WORDS: Record<TrustReportReason, string> = {
  scam: 'Scam or trying to cheat me',
  'fee-request': 'Asked me to pay a fee or deposit first',
  'fake-item': 'Fake or not as described',
  abuse: 'Abuse or threats',
  'under-18': 'Looks under 18',
}
/** The line every "leaving Allworld" screen shows. */
export const SAFETY_LINE = 'Never pay before you see the goods or meet in a public place.'
