import { cityContent, cityRules } from '../../src/game/cities/index.ts'
import { NEW_ACCOUNT_COOLDOWN_MS, outboundLink, screenFee, SAFETY_LINE } from '../../src/game/trust/index.ts'
import { active, adultKind, integer, isListing, listingProse, parseInput, REAL_VALUE } from '../../src/game/real-value/model.ts'
import type { Listing, ListingCard, ListingInput, ListingPage, RealValueCollection } from '../../src/types/real-value.ts'
import { screenText } from '../moderation/text.ts'
import { trustService } from '../trust/service.ts'
import type { Db, RouteContext, SessionRecord } from '../types.ts'
import { peekRealValue, prune, realValueOf } from './data.ts'

export function listingService(ctx: RouteContext) {
  const trust = trustService(ctx)
  function claimed(db: Db, session: SessionRecord): void {
    if (trust.tierOf(db, session) === 'guest') throw ctx.fail(403, 'account_required')
  }
  function gate(db: Db, session: SessionRecord, kind: ListingInput['kind']): void {
    claimed(db, session)
    if (trust.complaints(db, session.publicId).held) throw ctx.fail(403, 'listings_held')
    if (adultKind(kind) && trust.adult(db, session.publicId) !== true) throw ctx.fail(403, 'adult_self_declaration_required')
    if (kind === 'meetup' && !trust.verifiedAdult(db, session.publicId)) throw ctx.fail(403, 'verified_adult_required')
    if (kind === 'stall' || kind === 'gig' || kind === 'class' || kind === 'meetup') {
      const refusal = trust.postBlock(db, session, kind)
      if (refusal) throw ctx.fail(403, refusal.code)
    } else {
      const facts = trust.facts(db, session)
      if ((facts.accountAt ?? facts.now) + NEW_ACCOUNT_COOLDOWN_MS > facts.now) throw ctx.fail(403, 'account_too_new')
    }
  }
  function blocked(db: Db, a: string, b: string): boolean {
    return Boolean(ctx.checks?.blocked?.(a, b) || db.social?.players?.[a]?.blocked?.[b] || db.social?.players?.[b]?.blocked?.[a])
  }
  function visible(db: Db, listing: Listing, viewer?: string): boolean {
    if (viewer && (listing.hiddenBy.includes(viewer) || blocked(db, viewer, listing.owner))) return false
    if (viewer === listing.owner) return true
    const owner = ctx.core.sessionByPublicId?.(db, listing.owner)
    if (!owner || listing.status !== 'open' || listing.expiresAt <= ctx.now()) return false
    try { gate(db, owner, listing.kind) } catch { return false }
    return true
  }
  function card(db: Db, listing: Listing): ListingCard | null {
    const badge = trust.badge(db, listing.owner)
    if (!badge) return null
    const common = { id: listing.id, owner: listing.owner, title: listing.title, description: listing.description, cityId: listing.cityId, lgaId: listing.lgaId, venueId: listing.venueId, expiresAt: listing.expiresAt, createdAt: listing.createdAt, revision: listing.revision, status: listing.status, badge,
      ageAssurance: listing.kind === 'meetup' ? 'verified-adult' as const : adultKind(listing.kind) ? 'self-declared-adult' as const : 'not-required' as const }
    switch (listing.kind) {
      case 'stall': return { ...common, kind: 'stall', category: listing.category, item: listing.item, sellerQuoteNaira: listing.sellerQuoteNaira, outsideDomain: outboundLink(listing.outsideLink)?.host ?? '', quoteLabel: 'Seller quoted real ₦' }
      case 'gig': return { ...common, kind: 'gig', work: listing.work, payMinNaira: listing.payMinNaira, payMaxNaira: listing.payMaxNaira, deadline: listing.deadline }
      case 'notice': return { ...common, kind: 'notice', category: listing.category }
      case 'class': return { ...common, kind: 'class', subject: listing.subject, startsAt: listing.startsAt, durationMinutes: listing.durationMinutes, capacity: listing.capacity }
      case 'meetup': return { ...common, kind: 'meetup', startsAt: listing.startsAt, capacity: listing.capacity, groupOnly: true }
      case 'skill-swap': return { ...common, kind: 'skill-swap', teach: listing.teach, learn: listing.learn }
      default: { const exhaustive: never = listing; return exhaustive }
    }
  }
  function get(db: Db, id: string, viewer?: string): Listing {
    const listing = peekRealValue(db).listings[id]
    if (!isListing(listing) || listing.id !== id || !visible(db, listing, viewer)) throw ctx.fail(404, 'listing_unavailable')
    return listing
  }
  function revision(value: unknown, expected: number): void {
    if (!integer(value)) throw ctx.fail(400, 'expected_revision_required')
    if (value !== expected) throw ctx.fail(409, 'revision_conflict')
  }
  function validate(body: Record<string, unknown>): ListingInput {
    if (Object.keys(body).some((key) => /fee|deposit|payment|checkout|address|phone|contact|email|owner|wallet/i.test(key))) throw ctx.fail(400, 'unsupported_listing_field')
    const input = parseInput(body)
    if (!input) throw ctx.fail(400, 'invalid_listing')
    const cityId = ctx.cityIds.find((id) => id === input.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const rules = cityRules(cityId), content = cityContent(cityId)
    const lga = rules?.units.find((unit) => unit.id === input.lgaId)
    const venue = content?.venues.find((place) => place.id === input.venueId && place.definition.category !== 'home')
    if (!lga || !venue) throw ctx.fail(400, 'public_venue_required')
    const district = rules?.districts.find((district) => district.id === venue.district || district.name === venue.district)
    if (district && district.localUnitId !== input.lgaId) throw ctx.fail(400, 'venue_lga_mismatch')
    const now = ctx.now()
    if (input.expiresAt <= now || input.expiresAt > now + REAL_VALUE.expiry) throw ctx.fail(400, 'invalid_expiry')
    if ((input.kind === 'class' || input.kind === 'meetup') && (input.startsAt <= now || input.startsAt >= input.expiresAt)) throw ctx.fail(400, 'invalid_schedule')
    if (input.kind === 'gig' && (input.deadline <= now || input.deadline > input.expiresAt)) throw ctx.fail(400, 'invalid_deadline')
    for (const prose of listingProse(input)) {
      const refusal = screenFee(prose, { what: 'This listing' }) ?? screenText(prose, { contact: true, what: 'This listing' })
      if (refusal) throw ctx.fail(400, refusal.code)
      if (/\b(?:home address|house address|my house|my home|flat \d|apartment \d|\d+\s+\w+\s+(?:street|road|avenue|close))\b/i.test(prose)) throw ctx.fail(400, 'home_address_not_allowed')
    }
    if (input.kind === 'stall') {
      const link = outboundLink(input.outsideLink)
      if (!link) throw ctx.fail(400, 'link_not_allowed')
      return { ...input, outsideLink: link.url }
    }
    return input
  }
  function capacity(collection: RealValueCollection, input: ListingInput, owner: string, omit?: string): void {
    const listings = Object.values(collection.listings).filter((listing) => listing.id !== omit && active(listing, ctx.now()))
    if (input.status !== 'closed' && (listings.filter((listing) => listing.owner === owner).length >= REAL_VALUE.ownerActive || listings.filter((listing) => listing.cityId === input.cityId).length >= REAL_VALUE.cityActive)) throw ctx.fail(429, 'listing_capacity')
  }
  return {
    trust, claimed, gate, blocked, visible, card, get, revision,
    page(db: Db, query: URLSearchParams, viewer?: string, mine = false): ListingPage {
      const city = query.get('city'), kind = query.get('kind'), after = query.get('after')
      const limit = Math.min(REAL_VALUE.page, Math.max(1, Number(query.get('limit')) || REAL_VALUE.page))
      if (after && !/^RV-\d{1,16}$/.test(after)) throw ctx.fail(400, 'invalid_cursor')
      const afterSeq = after ? Number(after.slice(3)) : Infinity
      const rows = Object.entries(peekRealValue(db).listings).flatMap(([id, listing]) => isListing(listing) && listing.id === id ? [listing] : []).filter((listing) => Number(listing.id.slice(3)) < afterSeq && (!city || listing.cityId === city) && (!kind || listing.kind === kind) && (!mine || listing.owner === viewer) && visible(db, listing, viewer))
        .sort((a, b) => Number(b.id.slice(3)) - Number(a.id.slice(3))).flatMap((listing) => { const view = card(db, listing); return view ? [view] : [] })
      const listings = rows.slice(0, limit)
      return { listings, next: rows.length > limit ? listings[listings.length - 1]?.id ?? null : null, beta: true }
    },
    create(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const input = validate(body); gate(db, session, input.kind); revision(body.expectedRevision, 0)
      const collection = realValueOf(ctx, db); prune(collection, ctx.now()); capacity(collection, input, session.publicId)
      if (Object.keys(collection.listings).length >= REAL_VALUE.listings) throw ctx.fail(429, 'listing_capacity')
      const id = `RV-${++collection.seq}`, now = ctx.now()
      collection.listings[id] = { ...input, v: 1, id, owner: session.publicId, createdAt: now, updatedAt: now, revision: 1, hiddenBy: [] }
      return { ok: true, code: 'created', id, revision: 1 }
    },
    edit(db: Db, session: SessionRecord, id: string, body: Record<string, unknown>, close = false) {
      claimed(db, session)
      const collection = realValueOf(ctx, db), current = collection.listings[id]
      if (!current || current.owner !== session.publicId) throw ctx.fail(404, 'listing_unavailable')
      revision(body.expectedRevision, current.revision)
      if (close) {
        collection.listings[id] = { ...current, status: 'closed', updatedAt: ctx.now(), revision: current.revision + 1 }
      } else {
        if (current.status === 'closed' || current.expiresAt <= ctx.now()) throw ctx.fail(409, 'listing_closed')
        const input = validate(body); if (input.kind !== current.kind) throw ctx.fail(400, 'listing_kind_fixed')
        gate(db, session, input.kind); capacity(collection, input, session.publicId, id)
        collection.listings[id] = { ...input, v: 1, id, owner: current.owner, createdAt: current.createdAt, updatedAt: ctx.now(), revision: current.revision + 1, hiddenBy: current.hiddenBy }
      }
      return { ok: true, code: close ? 'closed' : 'updated', id, revision: current.revision + 1 }
    },
    report(db: Db, session: SessionRecord, id: string, body: Record<string, unknown>) {
      if (trust.tierOf(db, session) === 'guest') throw ctx.fail(403, 'account_required')
      const collection = realValueOf(ctx, db), listing = collection.listings[id]
      if (!listing || listing.owner === session.publicId || blocked(db, session.publicId, listing.owner)) throw ctx.fail(404, 'listing_unavailable')
      if (!listing.hiddenBy.includes(session.publicId) && listing.hiddenBy.length >= REAL_VALUE.hidden) throw ctx.fail(429, 'report_capacity')
      const report = trust.report(db, session, { ...body, about: listing.owner })
      if (!report.ok) return report
      if (!listing.hiddenBy.includes(session.publicId)) listing.hiddenBy.push(session.publicId)
      return { ...report, hidden: true }
    },
    link(db: Db, session: SessionRecord, id: string) {
      const listing = get(db, id, session.publicId); claimed(db, session)
      if (trust.complaints(db, session.publicId).held) throw ctx.fail(403, 'listings_held')
      if (trust.adult(db, session.publicId) !== true) throw ctx.fail(403, 'adult_self_declaration_required')
      if (listing.kind !== 'stall' || listing.status !== 'open' || listing.expiresAt <= ctx.now()) throw ctx.fail(404, 'listing_unavailable')
      const link = outboundLink(listing.outsideLink), badge = trust.badge(db, listing.owner)
      if (!link || !badge || badge.held) throw ctx.fail(404, 'listing_unavailable')
      return { link, badge, warning: SAFETY_LINE, requiresWarning: true, moneyLevel: 'L0' }
    },
  }
}
export type ListingService = ReturnType<typeof listingService>
