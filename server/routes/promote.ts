/**
 * OWNER: social
 * ALLWORLD FOR BUSINESS under /api/promote/ (docs/PROMOTE.md; rules in server/promote/service.ts).
 *   GET  /api/promote/me                     my listings and orders, prices, how payment works now
 *   GET  /api/promote/directory?city=&category=   live businesses of a city, boosted first (no session needed)
 *   POST /api/promote/listings   { id?, name, category, area?, about?, photo? }   create or edit (reviewed before it is live)
 *   POST /api/promote/listings/remove { id }
 *   POST /api/promote/order      { listing, tier, weeks, email?, arcon? }   a boost: a Bachs checkout address, or bank details
 *   POST /api/promote/order/verify { ref }   after the checkout: Allworld asks Bachs itself and starts the boost when paid
 *   POST /api/promote/contact    { listing, via? }  someone opened the business (a count, no name). via: board counts a tap on a billboard; street says a contact began in the business street
 *   GET  /api/promote/boards?city=   the city's boosted businesses for its billboards (name, kind, photo), rotating (no session needed)
 *   GET  /api/promote/street?city=   the city's business street: live listings in shop fronts, grouped by kind (no session needed)
 * Admin: GET /api/admin/promote, POST /api/admin/promote/act (server/routes/promote-admin.ts).
 */
import { HTTP_PER_MINUTE } from './social.ts'
import { addressBucket } from '../host-context.ts'
import { promoteService } from '../promote/service.ts'
import { judge } from '../feed/review.ts'
import { registerAdminSetting } from '../admin/settings.ts'
import { characterCity } from '../character.ts'
import { categoryLabel, TIERS } from '../../src/promote/model.ts'
import type { ListingView } from '../../src/types/promote.ts'
import type { StreetView } from '../../src/types/neighbourhood.ts'
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts'

const NO_STORE = { 'Cache-Control': 'no-store' }
const playRequest = (request: RouteRequest): boolean => request.header?.('X-Allworld-App') === 'play'
const neutralListings = (listings: readonly ListingView[]): ListingView[] => listings.map((listing) => ({ ...listing, boosted: false }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
const neutralStreet = (street: StreetView): StreetView => ({ ...street, groups: street.groups.map((group) => ({ ...group, listings: neutralListings(group.listings) })) })
export default function promoteRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const promote = promoteService(ctx)
  registerAdminSetting(ctx, { key: 'promoteBoostPrice', label: 'Business: Boost, naira a week', help: 'A week of a Sponsored card in the city feed and the top of its directory.', kind: 'number', min: 100, max: 1_000_000, default: () => TIERS.boost.price })
  registerAdminSetting(ctx, { key: 'promoteSpotlightPrice', label: 'Business: Spotlight, naira a week', help: 'Boost plus a Sponsored card in the World feed of every city.', kind: 'number', min: 100, max: 5_000_000, default: () => TIERS.spotlight.price })
  registerAdminSetting(ctx, { key: 'promoteBankDetails', label: 'Business: bank transfer details', help: 'Shown to a business that orders a boost while card payment is not set up (bank, account number, account name). Empty: boosts are not on sale yet.', kind: 'text', max: 300, default: () => '' })
  const origin = (): string => { const o = typeof ctx.env === 'function' ? ctx.env('PUBLIC_ORIGIN') : ''; return /^https:\/\/[a-z0-9.-]+$/i.test(o ?? '') ? o! : 'https://joinallworld.com' }
  /** The reviewer reads a listing (words and photo) with the advertising rules; tried again on the heartbeat when it had no answer. */
  async function reviewListing(id: string): Promise<void> {
    const l = await ctx.store.read((db) => promote.peek(db)?.listings[id])
    if (!l || l.status !== 'review') return
    const verdict = await judge(ctx, { kind: 'business listing', text: `${l.name}\n${categoryLabel(l.category)}\n${l.area}\n${l.about}`, ...(l.photo ? { image: l.photo } : {}), facts: 'A business or service asking to be listed in a city directory.', ad: true }).catch(() => null)
    await ctx.store.transact((db) => promote.reviewed(db, id, verdict)).catch(() => undefined)
  }
  /** Ask Bachs about an order and start its boost when the payment went through. */
  async function settle(o: { id: string; ref: string; checkout?: string }) {
    const said = await promote.verify(o)
    return said?.paid ? ctx.store.transact((db) => promote.markPaid(db, o.id, 'bachs', said.amount)) : null
  }
  const later = (work: Promise<unknown>): void => { if (ctx.waitUntil) ctx.waitUntil(work.catch(() => undefined)); else void work.catch(() => undefined) }
  let lastBeat = 0
  ctx.on?.('heartbeat', () => {
    if (ctx.now() - lastBeat < 5 * 60000) return
    lastBeat = ctx.now()
    later(ctx.store.read((db) => promote.pending(db)).then((ids) => Promise.all(ids.map(reviewListing))))
    if (promote.payment() === 'bachs') later(ctx.store.read((db) => promote.awaiting(db)).then((orders) => Promise.all(orders.map(settle))))
  })
  async function write<R extends object>(request: RouteRequest, call: (db: Db, session: SessionRecord) => R): Promise<R> {
    return ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true })
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited')
      return call(db, session)
    })
  }
  /** The city a read asks for, or the viewer's own, or the first. */
  const askedCity = (asked: string | null, s: SessionRecord | undefined): string => (asked && ctx.cityIds.some((c) => c === asked) ? asked : (s && characterCity(s)) ?? ctx.cityIds[0] ?? 'lagos')
  const body = async (request: RouteRequest): Promise<Record<string, unknown>> => { const b = await request.json(); return b && typeof b === 'object' ? b as Record<string, unknown> : {} }
  return {
    'GET /api/promote/me': async (request) => ({ body: await ctx.store.read((db) => promote.me(db, request.requireSession(db))), headers: NO_STORE }),
    'GET /api/promote/directory': async (request) => {
      if (!ctx.allow(`promote:dir:${addressBucket(request.ip)}`, 120, 60000)) throw ctx.fail(429, 'rate_limited')
      const asked = request.query.get('city'), category = request.query.get('category')
      const answer = await ctx.store.read((db) => { const s = request.session(db); const city = asked && ctx.cityIds.some((c) => c === asked) ? asked : (s && characterCity(s)) ?? ctx.cityIds[0] ?? 'lagos'; return promote.directory(db, s?.publicId ?? null, city, category || null) })
      return { body: playRequest(request) ? { ...answer, listings: neutralListings(answer.listings) } : answer, headers: NO_STORE }
    },
    'POST /api/promote/listings': async (request) => {
      const b = await body(request)
      const r = await write(request, (db, s) => promote.save(db, s, b))
      if (!r.ok) return { body: r }
      const { review, ...rest } = r
      if (review) later(reviewListing(review))
      return { body: rest, renew: true }
    },
    'POST /api/promote/listings/remove': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => promote.remove(db, s, b)) } },
    'POST /api/promote/order': async (request) => {
      const b = await body(request)
      const r = await write(request, (db, s) => promote.order(db, s, b))
      if (!r.ok) return { body: r }
      const { email, ...rest } = r
      if (promote.payment() === 'bachs' && email) {
        const name = await ctx.store.read((db) => promote.nameOf(db, request.requireSession(db).publicId))
        const page = await promote.checkout({ ref: r.order.ref, amount: r.order.amount, email, name }, origin())
        if (!page) return { body: { ok: false, code: 'checkout_failed', reason: 'The payment page could not be opened. Try again in a minute.' } }
        await ctx.store.transact((db) => promote.keepCheckout(db, r.order.id, page.id))
        return { body: { ...rest, pay: page.url } }
      }
      return { body: { ...rest, bank: await ctx.store.read((db) => promote.me(db, request.requireSession(db)).bank) } }
    },
    'POST /api/promote/order/verify': async (request) => {
      const b = await body(request)
      const session = await ctx.store.read((db) => request.requireSession(db))
      if (!ctx.allow(`promote:verify:${session.publicId}`, 20, 3600000)) throw ctx.fail(429, 'rate_limited')
      const found = await ctx.store.read((db) => promote.ownOrder(db, session.publicId, b.ref) ?? null)
      if (!found) return { body: { ok: false, code: 'unknown_order', reason: 'That payment was not found.' } }
      if (promote.payment() !== 'bachs') return { body: { ok: false, code: 'not_card', reason: 'This order is paid by bank transfer; an admin confirms it.' } }
      if (found.status === 'paid' || found.status === 'ended') return { body: await ctx.store.read((db) => promote.viewOf(db, found)) }
      if (found.status !== 'pending') return { body: { ok: false, code: 'order_closed', reason: 'That order was cancelled.' } }
      const done = await settle(found)
      if (!done) return { body: { ok: false, code: 'not_paid', reason: 'The payment has not gone through yet. If you paid, wait a minute and check again.' } }
      return { body: done }
    },
    'GET /api/promote/boards': async (request) => {
      if (!ctx.allow(`promote:boards:${addressBucket(request.ip)}`, 120, 60000)) throw ctx.fail(429, 'rate_limited')
      const asked = request.query.get('city')
      return { body: await ctx.store.read((db) => { const s = request.session(db); const city = askedCity(asked, s); return { ok: true as const, city, boards: promote.boards(db, s?.publicId ?? null, city) } }), headers: { 'Cache-Control': 'no-store' } }
    },
    'GET /api/promote/street': async (request) => {
      if (!ctx.allow(`promote:street:${addressBucket(request.ip)}`, 120, 60000)) throw ctx.fail(429, 'rate_limited')
      const asked = request.query.get('city')
      const answer = await ctx.store.read((db) => { const s = request.session(db); const city = askedCity(asked, s); return { ok: true as const, ...promote.street(db, s?.publicId ?? null, city) } })
      return { body: playRequest(request) ? { ok: true as const, ...neutralStreet(answer) } : answer, headers: NO_STORE }
    },
    'POST /api/promote/contact': async (request) => {
      if (!ctx.allow(`promote:contact:${addressBucket(request.ip)}`, 60, 60000)) throw ctx.fail(429, 'rate_limited')
      const b = await body(request)
      return { body: await ctx.store.transact((db) => promote.contact(db, b.listing, b.via), { durable: false }) }
    },
  }
}
