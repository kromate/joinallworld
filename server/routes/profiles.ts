import { readPublicProfile } from '../public-profile.ts'
import { publicProfilePageHtml, unavailableProfilePageHtml } from '../public-profile-page.ts'
import { feedService } from '../feed/service.ts'
import { profileSocialHtml } from '../feed/pages.ts'
import { privacyPageHtml } from '../privacy-page.ts'
import { moneyPageHtml } from '../money-page.ts'
import { guidePage } from '../docs-pages.ts'
import { sourceQuery } from '../../src/game/share-model.ts'
import type { Db, RouteContext, RouteHandler, RouteKey } from '../types.ts'

const headers = { 'Cache-Control': 'no-store' }

export default function profileRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const feed = feedService(ctx)
  /** `/p/@handle` is the same page as `/p/<public id>`. */
  const idOf = (db: Db, raw: string): string => { let text = raw; try { text = decodeURIComponent(raw) } catch { return raw } return text.startsWith('@') ? feed.resolve(db, text) ?? '' : text }
  /** The feed's part of the page: portrait, handle, bio, status, the latest public posts. Nothing for a guest viewer beyond what is public. */
  const socialOf = (db: Db, id: string, origin: string): string => { const found = feed.profile(db, null, id); if (!found.ok) return ''; const page = feed.read(db, null, { tab: 'author', by: id }); return profileSocialHtml(found.profile, 'posts' in page ? page.posts.filter((p) => p.vis === 'public') : [], origin) }
  // The public privacy page (server/privacy-page.ts): plain HTML, cacheable, the same on both hosts.
  ctx.pages?.set('/privacy', async ({ origin }) => ({ status: 200, cache: true, html: privacyPageHtml(origin) }))
  // The public money page (server/money-page.ts): what game naira is, what real money exists, who holds it, how to report a scam.
  ctx.pages?.set('/money', async ({ origin }) => ({ status: 200, cache: true, html: moneyPageHtml(origin) }))
  // The public guides (server/docs-pages.ts): every feature, every page and screen, and the AI skills. Each answers its exact address;
  // a longer one renders nothing and falls through (under /skills/ that is a skill's own files, public/skills/).
  for (const prefix of ['/about', '/features', '/pages', '/skills']) ctx.pages?.set(prefix, async ({ path, origin }) => { const html = guidePage(path, origin); return html === null ? null : { status: 200, cache: true, html } })
  ctx.pages?.set('/p/', async ({ path, query, origin, ip, method }) => {
    if (method !== 'GET' && method !== 'HEAD') return { status: 405, cache: false, html: unavailableProfilePageHtml(origin) }
    if (!ctx.allow(`profile:page:${ip}`, 60, 60000)) return { status: 429, cache: false, html: unavailableProfilePageHtml(origin) }
    const raw = path.startsWith('/p/') ? path.slice(3) : ''
    const id = raw.startsWith('@') || raw.startsWith('%40') ? await ctx.store.read((db) => idOf(db, raw)) : raw
    const result = await readPublicProfile(ctx, { id, after: query.has('after') ? query.get('after') : null })
    if (!result.ok) return { status: result.code === 'invalid_profile_cursor' ? 400 : 404, cache: false, html: unavailableProfilePageHtml(origin) }
    const social = await ctx.store.read((db) => socialOf(db, id, origin))
    return { status: 200, cache: false, html: publicProfilePageHtml(result.profile, origin, social, sourceQuery(query)) }
  })

  return {
    'GET /api/profiles/:id': async (request) => {
      if (!ctx.allow(`profile:read:${request.ip}`, 60, 60000)) throw ctx.fail(429, 'rate_limited')
      const viewer = await ctx.store.read(db => request.session(db)?.publicId ?? null)
      const asked = request.params.id ?? '', id = asked.startsWith('@') ? await ctx.store.read((db) => idOf(db, asked)) : asked
      const result = await readPublicProfile(ctx, { id, after: request.query.has('after') ? request.query.get('after') : null, viewer })
      if (!result.ok) throw ctx.fail(result.code === 'invalid_profile_cursor' ? 400 : 404, result.code)
      return { body: { profile: result.profile }, headers }
    },
  }
}
