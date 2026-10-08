/** L0 beta discovery only. Public cards never contain contacts or the outbound URL. */
import type { Db, RouteContext, RouteHandler, RouteKey, SessionRecord } from '../types.ts'
import { listingService } from '../real-value/listings.ts'
import { contactService } from '../real-value/contacts.ts'
import { analyticsService } from '../real-value/analytics.ts'

export default function realValueRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const listings = listingService(ctx), contacts = contactService(ctx, listings), analytics = analyticsService(ctx, listings)
  const headers = { 'Cache-Control': 'no-store' }
  const rate = (key: string, count = 60): void => { if (!ctx.allow(`real-value:${key}`, count)) throw ctx.fail(429, 'rate_limited') }
  type Step = (db: Db, session: SessionRecord, id: string, body: Record<string, unknown>) => { ok: boolean; code: string }
  const write = (op: string, step: Step): RouteHandler => async (request) => {
    const body = await request.json(); ctx.onceId(body.clientId)
    const id = String(request.params.id ?? '')
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db); rate(`write:${session.publicId}`, 20)
      return ctx.once(db, session, { id: body.clientId, kind: `real-value.${op}`, fingerprint: [id, body] }, () => step(db, session, id, body))
    })
    return { body: result, headers, renew: true }
  }
  return {
    'GET /api/real-value/listings': async (request) => ({ body: await ctx.store.read((db) => { const viewer = request.session(db)?.publicId; rate(`read:${viewer ?? request.ip}`); return listings.page(db, request.query, viewer) }), headers }),
    'GET /api/real-value/mine': async (request) => ({ body: await ctx.store.read((db) => { const session = request.requireSession(db); rate(`read:${session.publicId}`); listings.claimed(db, session); return listings.page(db, request.query, session.publicId, true) }), headers }),
    'GET /api/real-value/listings/:id': async (request) => ({ body: await ctx.store.read((db) => { const viewer = request.session(db)?.publicId; rate(`read:${viewer ?? request.ip}`); return { listing: listings.card(db, listings.get(db, String(request.params.id), viewer)) } }), headers }),
    'GET /api/real-value/share/:id': async (request) => ({ body: await ctx.store.read((db) => { rate(`share:${request.ip}`); const listing = listings.get(db, String(request.params.id), request.session(db)?.publicId); return { id: listing.id, title: listing.title, preview: listing.description.slice(0, 160), cityId: listing.cityId, lgaId: listing.lgaId, kind: listing.kind, moneyLevel: 'L0', beta: true } }), headers }),
    'GET /api/real-value/link/:id': async (request) => ({ body: await ctx.store.read((db) => { const session = request.requireSession(db); rate(`read:${session.publicId}`); return listings.link(db, session, String(request.params.id)) }), headers }),
    'GET /api/real-value/analytics/:id': async (request) => ({ body: await ctx.store.read((db) => { const session = request.requireSession(db); rate(`read:${session.publicId}`); return analytics.read(db, session, String(request.params.id)) }), headers }),
    'GET /api/real-value/contacts': async (request) => ({ body: await ctx.store.read((db) => { const session = request.requireSession(db); rate(`read:${session.publicId}`); return { contacts: contacts.mine(db, session) } }), headers }),
    'GET /api/real-value/contacts/:id': async (request) => ({ body: await ctx.store.read((db) => { const session = request.requireSession(db); rate(`read:${session.publicId}`); return contacts.read(db, session, String(request.params.id)) }), headers }),
    'POST /api/real-value/listings': write('create', (db, session, _id, body) => listings.create(db, session, body)),
    'POST /api/real-value/listings/:id/edit': write('edit', (db, session, id, body) => listings.edit(db, session, id, body)),
    'POST /api/real-value/listings/:id/close': write('close', (db, session, id, body) => listings.edit(db, session, id, body, true)),
    'POST /api/real-value/listings/:id/report': write('report', (db, session, id, body) => listings.report(db, session, id, body)),
    'POST /api/real-value/listings/:id/event': write('event', (db, session, id, body) => analytics.event(db, session, id, body)),
    'POST /api/real-value/listings/:id/contact-request': write('contact-request', (db, session, id, body) => contacts.request(db, session, id, body)),
    'POST /api/real-value/contacts/:id/answer': write('contact-answer', (db, session, id, body) => contacts.answer(db, session, id, body)),
    'POST /api/real-value/contacts/:id/revoke': write('contact-revoke', (db, session, id, body) => contacts.answer(db, session, id, body, true)),
  }
}
