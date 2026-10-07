import { isListing, REAL_VALUE } from '../../src/game/real-value/model.ts'
import type { AnalyticsEvent, AnalyticsRecord } from '../../src/types/real-value.ts'
import type { Db, RouteContext, SessionRecord } from '../types.ts'
import { isAnalytics, peekRealValue, realValueOf } from './data.ts'
import type { ListingService } from './listings.ts'

export function analyticsService(ctx: RouteContext, listings: ListingService) {
  function prune(record: AnalyticsRecord): void {
    for (const event of ['view', 'link', 'save'] as const) for (const [actor, at] of Object.entries(record[event])) if (at < ctx.now() - REAL_VALUE.retention) delete record[event][actor]
  }
  return {
    event(db: Db, session: SessionRecord, id: string, body: Record<string, unknown>) {
      listings.claimed(db, session)
      const listing = listings.get(db, id, session.publicId)
      if (listing.status !== 'open' || listing.expiresAt <= ctx.now()) throw ctx.fail(404, 'listing_unavailable')
      const event: AnalyticsEvent | undefined = (['view', 'link', 'save'] as const).find((event) => event === body.event)
      if (!event || (event === 'link' && listing.kind !== 'stall')) throw ctx.fail(400, 'invalid_event')
      if (event === 'link') listings.link(db, session, id)
      if (listing.owner === session.publicId) return { ok: true, code: 'owner_not_counted' }
      const collection = realValueOf(ctx, db), analytics = collection.analytics[id] ??= { view: {}, link: {}, save: {} }
      prune(analytics)
      const set = analytics[event]
      if (!Object.hasOwn(set, session.publicId) && Object.keys(set).length >= REAL_VALUE.analyticsActors) return { ok: true, code: 'analytics_saturated', capped: true }
      set[session.publicId] = ctx.now()
      return { ok: true, code: 'counted' }
    },
    read(db: Db, session: SessionRecord, id: string) {
      listings.claimed(db, session)
      const collection = peekRealValue(db), listing = collection.listings[id]
      if (!isListing(listing) || listing.id !== id || listing.owner !== session.publicId) throw ctx.fail(404, 'listing_unavailable')
      const stored = isAnalytics(collection.analytics[id]) ? collection.analytics[id] : undefined
      const counts = (event: AnalyticsEvent): number => stored ? Object.values(stored[event]).filter((at) => at >= ctx.now() - REAL_VALUE.retention).length : 0
      const view = counts('view'), link = counts('link'), save = counts('save')
      return { id, windowDays: 30, uniqueClaimedViewers: view, uniqueLinkTappers: link, uniqueSavers: save, capped: view >= REAL_VALUE.analyticsActors || link >= REAL_VALUE.analyticsActors || save >= REAL_VALUE.analyticsActors, capPerMetric: REAL_VALUE.analyticsActors, countLabel: 'Up to 1,000 unique claimed players per metric in 30 days', beta: true }
    },
  }
}
