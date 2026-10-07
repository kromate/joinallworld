import type { Contact, ContactExchange, ListingCard, ListingInput, ListingKind, ListingPage } from './real-value.ts'
import type { HostErrorCode, JsonBodyErrorCode, Ok, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { OutboundLink, TrustBadge, TrustReportReason } from '../game/trust/index.ts'

type ReadError = HostErrorCode | SessionErrorCode | 'rate_limited' | 'account_required' | 'listing_unavailable' | 'contact_unavailable' | 'invalid_cursor' | 'listings_held' | 'adult_self_declaration_required' | 'verified_adult_required'
type WriteError = ReadError | JsonBodyErrorCode | StorageErrorCode | 'invalid_listing' | 'invalid_city' | 'public_venue_required' | 'venue_lga_mismatch' | 'invalid_expiry' | 'invalid_schedule' | 'invalid_deadline' | 'unsupported_listing_field' | 'home_address_not_allowed' | 'link_not_allowed' | 'contact_not_allowed' | 'fee_request' | 'expected_revision_required' | 'revision_conflict' | 'listing_capacity' | 'listing_closed' | 'listing_kind_fixed' | 'report_capacity' | 'self_contact' | 'invalid_contact' | 'contact_capacity' | 'owner_required' | 'contact_state_conflict' | 'accept_required' | 'contact_expired' | 'invalid_event' | 'real_value_storage_invalid' | 'verification_required' | 'account_too_new'
type Receipt = { clientId: string }
type Revision = Receipt & { expectedRevision: number }
type Result = Ok<{ ok: boolean; code: string; id?: string; revision?: number; duplicate?: true; hidden?: true; capped?: true }>
type ContactSummary = Pick<ContactExchange, 'id' | 'listingId' | 'owner' | 'requester' | 'revision' | 'expiresAt' | 'status'>
interface Analytics { id: string; windowDays: number; uniqueClaimedViewers: number; uniqueLinkTappers: number; uniqueSavers: number; capped: boolean; capPerMetric: number; countLabel: string; beta: true }

export interface RealValueHttpRoutes {
  'GET /api/real-value/listings': { response: Ok<ListingPage>; errors: ReadError }
  'GET /api/real-value/mine': { response: Ok<ListingPage>; errors: ReadError }
  'GET /api/real-value/listings/:id': { response: Ok<{ listing: ListingCard | null }>; errors: ReadError }
  'GET /api/real-value/share/:id': { response: Ok<{ id: string; title: string; preview: string; cityId: string; lgaId: string; kind: ListingKind; moneyLevel: 'L0'; beta: true }>; errors: ReadError }
  'GET /api/real-value/link/:id': { response: Ok<{ link: OutboundLink; badge: TrustBadge; warning: string; requiresWarning: true; moneyLevel: 'L0' }>; errors: ReadError }
  'GET /api/real-value/analytics/:id': { response: Ok<Analytics>; errors: ReadError }
  'GET /api/real-value/contacts': { response: Ok<{ contacts: ContactSummary[] }>; errors: ReadError }
  'GET /api/real-value/contacts/:id': { response: Ok<ContactSummary & { contact?: Contact }>; errors: ReadError }
  'POST /api/real-value/listings': { body: ListingInput & Revision; response: Result; errors: WriteError }
  'POST /api/real-value/listings/:id/edit': { body: ListingInput & Revision; response: Result; errors: WriteError }
  'POST /api/real-value/listings/:id/close': { body: Revision; response: Result; errors: WriteError }
  'POST /api/real-value/listings/:id/report': { body: Receipt & { reason: TrustReportReason; note?: string }; response: Result; errors: WriteError }
  'POST /api/real-value/listings/:id/event': { body: Receipt & { event: 'view' | 'link' | 'save' }; response: Result; errors: WriteError }
  'POST /api/real-value/listings/:id/contact-request': { body: Revision & { contact: Contact }; response: Result; errors: WriteError }
  'POST /api/real-value/contacts/:id/answer': { body: Revision & ({ accept: true; contact: Contact } | { accept: false }); response: Result; errors: WriteError }
  'POST /api/real-value/contacts/:id/revoke': { body: Revision; response: Result; errors: WriteError }
}
