/**
 * OWNER: moderation — the ONE content file behind the text filter (server/moderation/text.ts).
 *
 * Deliberately short. It lists only terms that are abuse in every context this game has, so that
 * ordinary talk, banter and pidgin are never refused. Anything subtler is handled by people:
 * players block and report, an operator mutes (SECURITY.md). Do not add everyday profanity,
 * words with common innocent meanings, or anything a place or personal name contains ("Niger" is
 * a river, a state and a country here; "Kike" is a Yoruba name; armour has chinks).
 *
 * How entries are matched (text.js): the text is lower-cased, accents and look-alike digits are
 * folded (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), and it is split into words.
 *   WORDS    match one whole word (also its plain plural, and the word spelt out with spaces,
 *            dots or dashes between the letters, or with letters repeated).
 *   PHRASES  match a run of whole words.
 * Each entry: [term, category]. Categories are only used in the audit trail of what was refused:
 *   'hate'    slurs against a group
 *   'threat'  telling someone to die or threatening sexual violence
 *   'minors'  sexual content about children
 */
export type BlockedCategory = 'hate' | 'threat' | 'minors'

export const BLOCKED_WORDS: [string, BlockedCategory][] = [
  ['nigger', 'hate'],
  ['faggot', 'hate'],
  ['wetback', 'hate'],
  ['tranny', 'hate'],
  ['retard', 'hate'],
  ['kaffir', 'hate'],
  ['kys', 'threat'],
  ['childporn', 'minors'],
];

export const BLOCKED_PHRASES: [string, BlockedCategory][] = [
  ['kill yourself', 'threat'],
  ['kill urself', 'threat'],
  ['go and die', 'threat'],
  ['hope you die', 'threat'],
  ['i will rape', 'threat'],
  ['rape you', 'threat'],
  ['child porn', 'minors'],
];
