/**
 * OWNER: business
 * The per-life limits of businesses: what one life may spend at other players' shops and carry between cities.
 * Plain numbers only, and apart from content/business.ts on purpose: the rules engine reads these in every build,
 * the catalogue of shop types and products is read by the servers alone. Original beta values (docs/BUSINESS.md).
 */
export const BUSINESS_BUYING = Object.freeze({
  /** Naira one life may spend at players' shops in one Lagos day. */
  perDay: 8000,
  /** Purchases one life may make at players' shops in one Lagos day. */
  countPerDay: 8,
  /** A need at or above this is full: a product that restores it is not sold to that life. */
  fullNeed: 95,
  /** The most one product may change one need by, and the longest its mood may last (seconds): bounds on what a server may ask for. */
  maxEffect: 60, maxMoodSeconds: 86400, maxMood: 10,
});
/** Units of trade goods one life can carry. */
export const BAG_LIMIT = 24;
/** A collected batch of sales counts toward missions at most this many times. */
export const SALES_COUNTED_PER_COLLECT = 25;
