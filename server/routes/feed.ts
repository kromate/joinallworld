/**
 * OWNER: social
 * THE FEED under /api/feed/ (docs/FEED.md). Thin adapters: the rules are src/feed/model.ts and server/feed/service.ts.
 *
 *   GET  /api/feed/me                          your profile, drafts (moments), inbox, crews; whether photos are on
 *   POST /api/feed/seen                        the inbox was read
 *   GET  /api/feed/list?tab=near|friends|city|world&city=&after=   a page of posts (near, city and world carry `news`: the gist;
 *                                              near, for a badge holder, its badge city's neighbours first and `near`: this month's counts)
 *   GET  /api/feed/crew?id=&after=             a crew's wall (members)          GET /api/feed/by?id=&after=   someone's posts
 *   GET  /api/feed/post?id=                    one post with every reply
 *   POST /api/feed/post    { body, vis?, crew?, media?, draft?, label? }        POST /api/feed/post/remove { id }
 *   POST /api/feed/react   { id, emoji | null }   POST /api/feed/reply { id, body }   POST /api/feed/reply/remove { id, n }
 *   POST /api/feed/report  { kind, id, n?, reason }                             POST /api/feed/draft/remove { n }
 *   POST /api/feed/media?use=post|portrait&ms=   (body: the photo or clip)      GET  /api/feed/media/:hash   GET /api/feed/portrait/:id
 *   GET  /api/feed/profile?id=<id|@handle|CODE> POST /api/feed/profile { bio?, status?, withPlace?, open? }   POST /api/feed/handle { handle }
 *   GET  /api/feed/code?code=                  what a friend, crew or event code is
 *   POST /api/feed/follow  { id, on }          GET /api/feed/suggestions        POST /api/feed/vouch { id, skill, on }
 *   POST /api/feed/located { city, lga? } | { on: false }   the location badge: a city and maybe one of its local units, never a position
 *   POST /api/feed/crews   { name, colour?, about?, kind?, city?, lga?, locals? }   POST /api/feed/crews/join { code }   POST /api/feed/crews/leave { id, member? }   GET /api/feed/crews/one?id=
 *   GET  /api/feed/events?city=                POST /api/feed/events { title, about?, start, hours?, place?, cap?, cohosts? }
 *   GET  /api/feed/events/one?id=|code=        POST /api/feed/events/rsvp { id, answer: going|maybe|null }   POST /api/feed/events/cancel { id }
 *   GET  /api/feed/gigs?city=                  POST /api/feed/gigs { title, about?, reward }   POST /api/feed/gigs/act { id, op, worker?, stars?, text? }
 * Pages (no script): /c/<code> a crew's invitation, /ev/<code> an event's.
 * Answers are { ok: true, … } or { ok: false, code, reason } with HTTP 200; a malformed request is 400. Writes need the device session and
 * share the social routes' per-player rate limit. Reads of public things (a public profile, a world feed, an event by code) need none.
 */
import { HTTP_PER_MINUTE } from './social.ts'
import { addressBucket } from '../host-context.ts'
import { feedService } from '../feed/service.ts'
import { earnService } from '../earn/service.ts'
import { review } from '../feed/review.ts'
import { contactsService } from '../feed/contacts.ts'
import { promoteService } from '../promote/service.ts'
import { registerAdminSetting } from '../admin/settings.ts'
import type { Push } from '../feed/service.ts'
import { crewPageHtml, eventPageHtml, goneHtml } from '../feed/pages.ts'
import { cleanCode, FEED } from '../../src/feed/model.ts'
import { CONTENT_TYPES, FAULT_WORDS, claimedType, cleanPicture } from '../social/images.ts'
import { characterCity } from '../character.ts'
import { loadCityRules } from '../../src/game/cities/registry.ts'
import { growthOf } from '../growth/data.ts'
import { count, noteActivated, notePosted } from '../growth/metrics.ts'
import { requestOrigin } from '../execution-origin.ts'
import type { FeedMedia } from '../../src/types/feed.ts'
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts'
import type { ServerFrame } from '../../src/types/protocol.ts'

const MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4'])
const VIDEO_TYPE: Readonly<Record<string, string>> = Object.freeze({ webm: 'video/webm', mp4: 'video/mp4' })

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** A clip: a WebM (EBML header) or an MP4 (an `ftyp` box first). Nothing else is played back. */
const videoKind = (bytes: Uint8Array): 'webm' | 'mp4' | null => (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? 'webm' : bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 ? 'mp4' : null)

export default function feedRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const feed = feedService(ctx), earn = earnService(ctx)
  const contacts = contactsService(ctx)
  const promote = promoteService(ctx)
  // Public photos and clips: on (the owner's decision of 18 Oct 2026); an admin can switch them back to friends-and-crews without a deploy.
  registerAdminSetting(ctx, { key: 'feedPublicMedia', label: 'Feed: public photos and clips', help: 'On: adults may post photos and clips for everyone. The AI reviewer checks every public picture when it is posted. Off: photos go to friends and crews only.', kind: 'boolean', default: () => (typeof ctx.env === 'function' ? ctx.env('FEED_PUBLIC_MEDIA') : '').trim().toLowerCase() !== 'off' })
  /** The AI reviewer, after the commit: never in the request's way, never blocking an answer. */
  const reviewLater = (target: { kind: 'post' | 'reply' | 'crew' | 'event' | 'gig' | 'profile'; id: string; rn?: number }, why: 'report' | 'new'): void => { ctx.waitUntil?.(review(ctx, target, why).catch(() => null)); if (!ctx.waitUntil) void review(ctx, target, why).catch(() => null) }
  // The gist tells the feed about every public line that names someone (server/gist/ledger.ts add): drafts and AI moments.
  if (ctx.checks) ctx.checks.moment = (db, item, ids) => feed.noteMoment(db, item, ids)
  let lastReminder = 0
  ctx.on?.('heartbeat', () => {
    if (ctx.now() - lastReminder < 60000) return
    lastReminder = ctx.now()
    const work = (async () => {
      const any = await ctx.store.read((db) => Boolean(feed.peek(db)))
      if (!any) return
      send(await ctx.store.transact((db) => { feed.takeTrash(); const pushed = feed.remind(db); feed.purge(db); const gone = feed.takeTrash(); if (gone.length) (feed.peek(db)!.trash ??= []).push(...gone); contacts.sweep(db); return pushed }, { durable: false }))
      // Bytes of erased players' media (server/feed/service.ts forgetFeedPlayers): deleted, then taken off the list.
      const trash = await ctx.store.read((db) => (feed.peek(db)?.trash ?? []).slice(0, 100))
      if (trash.length && ctx.models) {
        await ctx.models.remove(trash)
        await ctx.store.transact((db) => { const f = feed.peek(db); if (f?.trash) f.trash = f.trash.filter((h) => !trash.includes(h)) })
      }
    })().catch(() => undefined)
    ctx.waitUntil?.(work)
  })
  const send = (push: Push | undefined): void => { for (const [to, frame] of push ?? []) ctx.push(to, frame satisfies ServerFrame) }
  const dropBytes = (hashes: string[]): void => { if (hashes.length && ctx.models) ctx.waitUntil?.(ctx.models.remove(hashes).catch(() => undefined)) }

  /** One write as the caller: session, rate limit, the change, then (after the commit) the live frames and any bytes no longer named. */
  async function write<R extends object>(request: RouteRequest, call: (db: Db, session: SessionRecord) => R): Promise<R extends unknown ? Omit<R, 'push'> : never> {
    const outcome = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true })
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited')
      feed.takeTrash()
      const result = call(db, session)
      return { result, trash: feed.takeTrash() }
    })
    const { push, ...rest } = outcome.result as R & { push?: Push }
    send(push)
    dropBytes(outcome.trash)
    return rest as R extends unknown ? Omit<R, 'push'> : never
  }
  const viewerOf = (request: RouteRequest) => ctx.store.read((db) => request.session(db)?.publicId ?? null)
  const readAs = async <R>(request: RouteRequest, call: (db: Db, viewer: string | null) => R): Promise<R> => {
    if (!ctx.allow(`feed:read:${addressBucket(request.ip)}`, 240, 60000)) throw ctx.fail(429, 'rate_limited')
    return ctx.store.read((db) => call(db, request.session(db)?.publicId ?? null))
  }
  const cityOf = async (request: RouteRequest): Promise<string> => {
    const asked = request.query.get('city')
    if (asked && (asked === 'world' || ctx.cityIds.some((c) => c === asked))) return asked
    return ctx.store.read((db) => { const s = request.session(db); return (s && characterCity(s)) ?? ctx.cityIds[0] ?? 'lagos' })
  }
  /** A body naming one of a city's local units: the city's rules are loaded first, so the service can check the unit is that city's. */
  const unitsFor = async (b: Record<string, unknown>): Promise<void> => { if (typeof b.lga === 'string' && b.lga && typeof b.city === 'string') await loadCityRules(b.city).catch(() => null) }
  const counted = (name: string) => (db: Db): void => { count(growthOf(ctx, db), ctx.now(), name) }
  /** A person's first meaningful action in the feed (a post, a community, a "going"): once per life, and never an AI agent's (growth/metrics.ts noteActivated). */
  const activated = (request: RouteRequest, db: Db, s: SessionRecord): void => { noteActivated(growthOf(ctx, db), ctx.now(), s.publicId, requestOrigin(request, s)) }
  const noStore = { 'Cache-Control': 'no-store' }

  async function upload(request: RouteRequest) {
    if (!feed.mediaOn() || !ctx.models || !request.binaryBody) return { ok: false, code: 'media_off', reason: 'Photos and clips are not switched on here.' }
    const use = request.query.get('use') === 'portrait' ? 'portrait' : 'post'
    const session = await ctx.store.read((db) => request.requireSession(db))
    if (!ctx.allow(`feed:media:${session.publicId}`, use === 'portrait' ? 10 : 30, 3600000)) return { ok: false, code: 'rate_limited', reason: 'You have added a lot of photos this hour. Try again later.' }
    const type = (request.header?.('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const isVideo = type.startsWith('video/')
    if (isVideo && use === 'portrait') return { ok: false, code: 'unknown_type', reason: 'A portrait is a picture.' }
    const bytes = await request.binaryBody(isVideo ? FEED.media.clipBytes : use === 'portrait' ? FEED.media.portraitBytes : FEED.media.photoBytes, MEDIA_TYPES)
    let media: FeedMedia, stored: Uint8Array
    if (isVideo) {
      const kind = videoKind(bytes)
      if (!kind || VIDEO_TYPE[kind] !== type) return { ok: false, code: 'unknown_type', reason: 'Only WebM or MP4 clips can be posted.' }
      const ms = Math.max(500, Math.min(FEED.media.clipMs, Math.round(Number(request.query.get('ms')) || 10000)))
      const w = Math.max(16, Math.min(4096, Math.round(Number(request.query.get('w')) || 720))), h = Math.max(16, Math.min(4096, Math.round(Number(request.query.get('h')) || 1280)))
      stored = bytes; media = { hash: await sha256(bytes), type: kind, w, h, ms }
    } else {
      const checked = cleanPicture(bytes, claimedType(type))
      if (!checked.ok) return { ok: false, code: checked.fault, reason: FAULT_WORDS[checked.fault] }
      stored = checked.picture.bytes
      media = { hash: await sha256(stored), type: checked.picture.type, w: checked.picture.width, h: checked.picture.height }
    }
    await ctx.models.put(media.hash, stored)
    const done = await write(request, (db, s) => feed.noteMedia(db, s, media, use))
    if (done.ok && use === 'portrait') reviewLater({ kind: 'profile', id: session.publicId }, 'new')
    return done
  }
  async function file(request: RouteRequest, hash: string, type: string, allowed: boolean) {
    if (!allowed || !ctx.models) throw ctx.fail(404, 'unknown_media')
    const bytes = await ctx.models.get(hash)
    if (!bytes) throw ctx.fail(404, 'unknown_media')
    return { file: { bytes, type, cache: 'immutable' as const } }
  }
  const typeOf = (t: FeedMedia['type']): string => (t === 'webm' || t === 'mp4' ? VIDEO_TYPE[t]! : CONTENT_TYPES[t])

  ctx.pages?.set('/c/', async ({ path, origin, ip }) => {
    if (!ctx.allow(`feed:page:${addressBucket(ip)}`, 60, 60000)) return { status: 429, cache: false, html: goneHtml(origin, 'Crew') }
    const code = cleanCode(path.slice(3))
    const found = code ? await ctx.store.read((db) => feed.code(db, code, null)) : null
    return found && found.ok && found.crew ? { status: 200, cache: false, html: crewPageHtml(found.crew, code!, origin) } : { status: 404, cache: false, html: goneHtml(origin, 'Crew') }
  })
  ctx.pages?.set('/ev/', async ({ path, origin, ip }) => {
    if (!ctx.allow(`feed:page:${addressBucket(ip)}`, 60, 60000)) return { status: 429, cache: false, html: goneHtml(origin, 'Event') }
    const found = await ctx.store.read((db) => feed.event(db, null, path.slice(4)))
    return found.ok ? { status: 200, cache: false, html: eventPageHtml(found.event, origin) } : { status: 404, cache: false, html: goneHtml(origin, 'Event') }
  })

  const body = async (request: RouteRequest): Promise<Record<string, unknown>> => { const b = await request.json(); return b && typeof b === 'object' ? b as Record<string, unknown> : {} }
  return {
    'GET /api/feed/me': async (request) => ({ body: await write(request, (db, s) => ({ ok: true as const, ...feed.me(db, s) })), headers: noStore, renew: true }),
    'POST /api/feed/seen': async (request) => ({ body: await write(request, (db, s) => feed.seen(db, s)) }),
    'GET /api/feed/list': async (request) => {
      const tab = request.query.get('tab'), city = await cityOf(request)
      if (tab !== 'near' && tab !== 'friends' && tab !== 'city' && tab !== 'world') throw ctx.fail(400, 'invalid_tab')
      const after = request.query.get('after')
      const playApp = request.header?.('X-Allworld-App') === 'play'
      const page = await readAs(request, (db, viewer) => { const r = feed.read(db, viewer, { tab, city, after }); return r.ok && tab !== 'friends' && !after ? { ...r, sponsored: playApp ? [] : promote.sponsored(db, viewer, city, tab === 'world') } : r })
      // Sponsored cards shown are counted for the business (a number, nobody's name), after the answer.
      const shown = 'sponsored' in page && page.sponsored?.length ? page.sponsored.map((s) => s.order) : []
      if (shown.length) { const work = ctx.store.transact((db) => promote.noteShown(db, shown), { durable: false }).catch(() => undefined); if (ctx.waitUntil) ctx.waitUntil(work) }
      return { body: page, headers: noStore }
    },
    'GET /api/feed/crew': async (request) => ({ body: await readAs(request, (db, viewer) => feed.read(db, viewer, { tab: 'crew', crew: request.query.get('id') ?? '', after: request.query.get('after') })), headers: noStore }),
    'GET /api/feed/by': async (request) => ({ body: await readAs(request, (db, viewer) => { const id = feed.resolve(db, request.query.get('id')); return id ? feed.read(db, viewer, { tab: 'author', by: id, after: request.query.get('after') }) : { ok: false, code: 'unknown_player', reason: 'That person was not found.' } }), headers: noStore }),
    'GET /api/feed/post': async (request) => ({ body: await readAs(request, (db, viewer) => feed.thread(db, viewer, request.query.get('id'))), headers: noStore }),
    'POST /api/feed/post': async (request) => {
      const b = await body(request)
      const answer = await write(request, (db, s) => { const r = feed.createPost(db, s, b); if (r.ok) { counted('feed.post')(db); notePosted(growthOf(ctx, db), ctx.now(), s.publicId); activated(request, db, s) } return r })
      // Every public photo or clip is looked at once when it is posted (there is no other scanning of pictures).
      if (answer.ok && answer.post.media && (answer.post.vis === 'public' || answer.post.vis === 'city')) reviewLater({ kind: 'post', id: answer.post.id }, 'new')
      return { body: answer, renew: true }
    },
    'POST /api/feed/post/remove': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.removePost(db, s, b)) } },
    'POST /api/feed/react': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.react(db, s, b); if (r.ok && b.emoji !== null) earn.notePoint(db, s, b.id); return r }) } },
    'POST /api/feed/reply': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.reply(db, s, b); if (r.ok) { counted('feed.reply')(db); earn.notePoint(db, s, b.id) } return r }) } },
    'POST /api/feed/reply/remove': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.removeReply(db, s, b)) } },
    'POST /api/feed/report': async (request) => {
      const b = await body(request)
      const answer = await write(request, (db, s) => feed.report(db, s, b))
      if (!answer.ok) return { body: answer }
      const { review: target, ...rest } = answer
      if (target) reviewLater(target, 'report')
      return { body: rest }
    },
    'POST /api/feed/draft/remove': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.dropDraft(db, s, b)) } },
    'POST /api/feed/media': async (request) => ({ body: await upload(request), renew: true }),
    'GET /api/feed/media/:hash': async (request) => {
      const hash = request.params.hash ?? ''
      if (!ctx.allow(`feed:file:${addressBucket(request.ip)}`, 600, 60000)) throw ctx.fail(429, 'rate_limited')
      const media = await ctx.store.read((db) => feed.mediaAllowed(db, request.session(db)?.publicId ?? null, hash))
      return file(request, hash, media ? typeOf(media.type) : '', Boolean(media))
    },
    'GET /api/feed/portrait/:id': async (request) => {
      if (!ctx.allow(`feed:file:${addressBucket(request.ip)}`, 600, 60000)) throw ctx.fail(429, 'rate_limited')
      const p = await ctx.store.read((db) => feed.portraitOf(db, request.params.id ?? ''))
      return file(request, p?.hash ?? '', p ? CONTENT_TYPES[p.type] : '', Boolean(p))
    },
    'GET /api/feed/profile': async (request) => ({ body: await readAs(request, (db, viewer) => feed.profile(db, viewer, request.query.get('id'))), headers: noStore }),
    'POST /api/feed/profile': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.editProfile(db, s, b)) } },
    'POST /api/feed/handle': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.setHandle(db, s, b)) } },
    'GET /api/feed/code': async (request) => {
      if (!ctx.allow(`feed:code:${addressBucket(request.ip)}`, 30, 60000)) throw ctx.fail(429, 'rate_limited')
      return { body: await readAs(request, (db, viewer) => feed.code(db, request.query.get('code'), viewer)), headers: noStore }
    },
    'POST /api/feed/follow': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.follow(db, s, b); if (r.ok && b.on !== false) counted('feed.follow')(db); return r }) } },
    'GET /api/feed/suggestions': async (request) => ({ body: await ctx.store.read((db) => feed.suggestions(db, request.requireSession(db))), headers: noStore }),
    // Contacts (server/feed/contacts.ts): hashes only, blinded with a secret that is not in the data, matched only both ways.
    'GET /api/feed/contacts': async (request) => ({ body: await ctx.store.read((db) => contacts.status(db, request.requireSession(db))), headers: noStore }),
    'POST /api/feed/contacts/self': async (request) => {
      const b = await body(request), session = await ctx.store.read((db) => request.requireSession(db))
      if (!ctx.allow(`contacts:self:${addressBucket(request.ip)}`, 10, 3600000)) throw ctx.fail(429, 'rate_limited')
      return { body: await contacts.declare(session, b), headers: noStore }
    },
    'POST /api/feed/contacts/match': async (request) => {
      const raw = await request.json(40_000), session = await ctx.store.read((db) => request.requireSession(db))
      if (!ctx.allow(`contacts:match:${addressBucket(request.ip)}`, 20, 86400000)) throw ctx.fail(429, 'rate_limited')
      const done = await contacts.match(session, raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})
      if (!done.ok) return { body: done, headers: noStore }
      const people = await ctx.store.read((db) => done.matched.map((id) => feed.profile(db, session.publicId, id)).flatMap((r) => (r.ok ? [{ id: r.profile.id, name: r.profile.name, ...(r.profile.handle ? { handle: r.profile.handle } : {}), ...(r.profile.portrait ? { portrait: r.profile.portrait } : {}) }] : [])))
      return { body: { ok: true, matched: people, waiting: done.waiting }, headers: noStore }
    },
    'POST /api/feed/contacts/forget': async (request) => ({ body: await ctx.store.transact((db) => contacts.forget(db, request.requireSession(db, { renew: true }).publicId)), headers: noStore }),
    'POST /api/feed/vouch': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.vouch(db, s, b)) } },
    'POST /api/feed/crews': async (request) => { const b = await body(request); await unitsFor(b); return { body: await write(request, (db, s) => { const r = feed.createCrew(db, s, b); if (r.ok) { counted('crew.made')(db); activated(request, db, s) } return r }), renew: true } },
    'POST /api/feed/crews/join': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.joinCrew(db, s, b); if (r.ok) { counted('crew.joined')(db); activated(request, db, s) } return r }), renew: true } },
    'POST /api/feed/crews/leave': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.leaveCrew(db, s, b)) } },
    'GET /api/feed/communities': async (request) => { const city = await cityOf(request); return { body: await readAs(request, (db, viewer) => feed.discover(db, viewer, city, request.query.get('kind'))), headers: noStore } },
    'POST /api/feed/crews/mod': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.setMod(db, s, b)) } },
    'POST /api/feed/crews/locals': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.setLocals(db, s, b)) } },
    // The location badge: the city (and maybe the local government) the device found itself in, never a position; the network's country
    // only as the host saw it.
    'POST /api/feed/located': async (request) => { const b = await body(request); await unitsFor(b); const country = request.header?.('cf-ipcountry') ?? ''; return { body: await write(request, (db, s) => feed.setLocated(db, s, b, country)) } },
    'POST /api/feed/crews/world': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.attachWorld(db, s, b)) } },
    'GET /api/feed/crews/one': async (request) => ({ body: await readAs(request, (db, viewer) => feed.crew(db, viewer, request.query.get('id'))), headers: noStore }),
    'GET /api/feed/events': async (request) => { const city = await cityOf(request); return { body: await readAs(request, (db, viewer) => feed.events(db, viewer, city)), headers: noStore } },
    'GET /api/feed/events/one': async (request) => ({ body: await readAs(request, (db, viewer) => feed.event(db, viewer, request.query.get('id') ?? request.query.get('code'))), headers: noStore }),
    'POST /api/feed/events': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.createEvent(db, s, b); if (r.ok) counted('event.made')(db); return r }), renew: true } },
    'POST /api/feed/events/rsvp': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.rsvp(db, s, b); if (r.ok && b.answer === 'going') { counted('event.going')(db); activated(request, db, s) } return r }) } },
    'POST /api/feed/events/cancel': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => feed.cancelEvent(db, s, b)) } },
    'GET /api/feed/gigs': async (request) => { const city = await cityOf(request); return { body: await readAs(request, (db, viewer) => feed.gigs(db, viewer, city)), headers: noStore } },
    'POST /api/feed/gigs': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.createGig(db, s, b); if (r.ok) counted('gig.posted')(db); return r }), renew: true } },
    'POST /api/feed/gigs/act': async (request) => { const b = await body(request); return { body: await write(request, (db, s) => { const r = feed.gigAct(db, s, b); if (r.ok && b.op === 'done') counted('gig.done')(db); return r }) } },
  }
}
