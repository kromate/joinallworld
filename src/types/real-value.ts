import type { TrustBadge } from '../game/trust/index.ts'

export const LISTING_KINDS = ['stall', 'gig', 'notice', 'class', 'meetup', 'skill-swap'] as const
export type ListingKind = (typeof LISTING_KINDS)[number]
export type ListingStatus = 'draft' | 'open' | 'closed'
export type ListingDetails =
  | { kind: 'stall'; category: string; item: string; sellerQuoteNaira: number; outsideLink: string }
  | { kind: 'gig'; work: string; payMinNaira: number; payMaxNaira: number; deadline: number }
  | { kind: 'notice'; category: 'lost-found' | 'event' | 'wanted' }
  | { kind: 'class'; subject: string; startsAt: number; durationMinutes: number; capacity: number }
  | { kind: 'meetup'; startsAt: number; capacity: number; groupOnly: true }
  | { kind: 'skill-swap'; teach: string; learn: string }
export interface ListingFields { title: string; description: string; cityId: string; lgaId: string; venueId: string; expiresAt: number }
export type ListingInput = ListingFields & ListingDetails & { status: ListingStatus }
export type Listing = ListingInput & { v: 1; id: string; owner: string; createdAt: number; updatedAt: number; revision: number; hiddenBy: string[] }
type PublicDetails = Exclude<ListingDetails, { kind: 'stall' }> | { kind: 'stall'; category: string; item: string; sellerQuoteNaira: number; outsideDomain: string; quoteLabel: 'Seller quoted real ₦' }
export type ListingCard = ListingFields & PublicDetails & { id: string; owner: string; status: ListingStatus; revision: number; createdAt: number; badge: TrustBadge; ageAssurance: 'self-declared-adult' | 'verified-adult' | 'not-required' }
export type Contact = { kind: 'email' | 'phone'; value: string }
export type ContactExchange = { v: 1; id: string; listingId: string; owner: string; requester: string; revision: number; createdAt: number; expiresAt: number } & (
  | { status: 'awaiting-owner'; requesterContact: Contact }
  | { status: 'mutual'; requesterContact: Contact; ownerContact: Contact }
  | { status: 'revoked' | 'expired' }
)
export type AnalyticsEvent = 'view' | 'link' | 'save'
export interface AnalyticsRecord { view: Record<string, number>; link: Record<string, number>; save: Record<string, number> }
export interface RealValueCollection { v: 1; seq: number; listings: Record<string, Listing>; contacts: Record<string, ContactExchange>; analytics: Record<string, AnalyticsRecord> }
export interface ListingPage { listings: ListingCard[]; next: string | null; beta: true }
