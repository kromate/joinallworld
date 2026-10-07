import { LISTING_KINDS } from '../../types/real-value.ts'
import type { Contact, Listing, ListingInput, ListingKind, ListingStatus } from '../../types/real-value.ts'

/** Beta capacity limits; no record grows with the total number of players. */
export const REAL_VALUE = Object.freeze({ listings: 2000, cityActive: 200, ownerActive: 5, page: 20, contacts: 2000, contactsPerListing: 100, hidden: 1000, analyticsActors: 1000, day: 86400000, retention: 30 * 86400000, expiry: 30 * 86400000 })
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
export const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f<>]/.test(value)
export const isKind = (value: unknown): value is ListingKind => LISTING_KINDS.some((kind) => kind === value)
export const adultKind = (kind: ListingKind): boolean => kind === 'stall' || kind === 'gig' || kind === 'meetup'
export const active = (listing: Listing, now: number): boolean => listing.status !== 'closed' && listing.expiresAt > now
export function parseInput(value: unknown): ListingInput | null {
  if (!record(value) || !text(value.title, 80) || !text(value.description, 600) || !text(value.cityId, 60) || !text(value.lgaId, 60) || !text(value.venueId, 60)
    || !integer(value.expiresAt) || !['draft', 'open', 'closed'].includes(String(value.status))) return null
  const status: ListingStatus = value.status === 'draft' ? 'draft' : value.status === 'open' ? 'open' : 'closed'
  const common = { title: value.title.trim(), description: value.description.trim(), cityId: value.cityId, lgaId: value.lgaId, venueId: value.venueId, expiresAt: value.expiresAt, status }
  switch (value.kind) {
    case 'stall': return text(value.category, 60) && text(value.item, 120) && integer(value.sellerQuoteNaira, 0, 100000000) && text(value.outsideLink, 300) ? { ...common, kind: 'stall', category: value.category.trim(), item: value.item.trim(), sellerQuoteNaira: value.sellerQuoteNaira, outsideLink: value.outsideLink } : null
    case 'gig': return text(value.work, 300) && integer(value.payMinNaira, 0, 100000000) && integer(value.payMaxNaira, value.payMinNaira, 100000000) && integer(value.deadline) ? { ...common, kind: 'gig', work: value.work.trim(), payMinNaira: value.payMinNaira, payMaxNaira: value.payMaxNaira, deadline: value.deadline } : null
    case 'notice': return value.category === 'lost-found' || value.category === 'event' || value.category === 'wanted' ? { ...common, kind: 'notice', category: value.category } : null
    case 'class': return text(value.subject, 120) && integer(value.startsAt) && integer(value.durationMinutes, 15, 240) && integer(value.capacity, 2, 100) ? { ...common, kind: 'class', subject: value.subject.trim(), startsAt: value.startsAt, durationMinutes: value.durationMinutes, capacity: value.capacity } : null
    case 'meetup': return integer(value.startsAt) && integer(value.capacity, 3, 100) && value.groupOnly === true ? { ...common, kind: 'meetup', startsAt: value.startsAt, capacity: value.capacity, groupOnly: true } : null
    case 'skill-swap': return text(value.teach, 120) && text(value.learn, 120) ? { ...common, kind: 'skill-swap', teach: value.teach.trim(), learn: value.learn.trim() } : null
    default: return null
  }
}
export function isListing(value: unknown): value is Listing {
  return record(value) && value.v === 1 && text(value.id, 40) && text(value.owner, 80) && integer(value.createdAt) && integer(value.updatedAt) && integer(value.revision, 1)
    && Array.isArray(value.hiddenBy) && value.hiddenBy.length <= REAL_VALUE.hidden && value.hiddenBy.every((id) => text(id, 80)) && parseInput(value) !== null
}
export function parseContact(value: unknown): Contact | null {
  if (!record(value) || typeof value.value !== 'string') return null
  const contact = value.value.trim()
  if (value.kind === 'email' && contact.length <= 120 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(contact)) return { kind: 'email', value: contact }
  if (value.kind === 'phone' && /^\+[1-9]\d{7,14}$/.test(contact)) return { kind: 'phone', value: contact }
  return null
}
export function listingProse(input: ListingInput): string[] {
  const common = [input.title, input.description]
  switch (input.kind) {
    case 'stall': return [...common, input.category, input.item]
    case 'gig': return [...common, input.work]
    case 'class': return [...common, input.subject]
    case 'skill-swap': return [...common, input.teach, input.learn]
    case 'notice': case 'meetup': return common
    default: { const exhaustive: never = input; return exhaustive }
  }
}
