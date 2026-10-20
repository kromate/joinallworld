import { SHARING_TERMS_VERSION } from '../src/types/sharing.ts'
import type { Db, SessionRecord, RouteContext, RouteHandler } from './types.ts'

const SHARING = [
  /^\/api\/social\/(?:messages(?:\/many)?|images|voice|groups(?:\/[^/]+)?|conversations\/[^/]+\/(?:message|react)|introduction)$/,
  /^\/api\/feed\/(?:post|reply|media|profile|handle|crews|events|gigs)$/,
  /^\/api\/showcase\/mine(?:\/photos|\/share|\/submit)?$/,
  /^\/api\/promote\/listings$/,
  /^\/api\/business\/(?:open|stock|price|bag\/stock)$/,
  /^\/api\/glue\/(?:talks|board\/posts)$/,
  /^\/api\/(?:clans\/(?:create|edit)|places\/room\/edit)$/,
  /^\/api\/spaces\/(?:models(?:\/upload-link)?|worlds(?:\/update|\/cover)?|world\/script|host|games)$/,
  /^\/api\/agents\/call\/(?:start|transcribe|turn)$/,
  /^\/api\/neighbourhood\/(?:notices|meetups\/plan)$/,
  /^\/api\/civic\/(?:gov\/announce|radio\/shoutout|ads\/rent)$/,
  /^\/api\/voice-config$/,
]

export function sharingRequest(method: string, path: string): boolean {
  return (method === 'POST' || path === '/api/voice-config') && SHARING.some(pattern => pattern.test(path))
}

export function hasSharingTerms(db: Db, session: SessionRecord): boolean {
  const acceptance = session.account ? db.accounts?.[session.account]?.sharingTerms : session.sharingTerms
  return acceptance?.version === SHARING_TERMS_VERSION && acceptance.minimumAge === 13
}

export function requireSharingTerms(ctx: Pick<RouteContext, 'fail'>, db: Db, session: SessionRecord): void {
  if (!hasSharingTerms(db, session)) throw Object.assign(ctx.fail(403, 'sharing_terms_required'), { reason: "Read Allworld's rules and confirm that you are 13 or over before sharing." })
}

export function playPaymentRequest(path: string): boolean {
  return path.startsWith('/api/earn/') || path === '/api/earn' || path.startsWith('/api/promote/order') || path.startsWith('/api/civic/ads')
}

export function withSharingPolicy(ctx: RouteContext, handler: RouteHandler): RouteHandler {
  return async request => {
    if (request.header?.('X-Allworld-App') === 'play') {
      if (request.method === 'GET' && request.path === '/api/promote/boards') return { body: { ok: true, city: request.query.get('city') ?? '', boards: [] }, headers: { 'Cache-Control': 'no-store' } }
      let refused = playPaymentRequest(request.path)
      if (request.method === 'POST' && /^\/api\/showcase\/[^/]+\/go$/.test(request.path)) {
        const body = await request.json()
        request.json = async () => body
        refused ||= body.kind === 'pay'
      }
      if (refused) throw Object.assign(ctx.fail(403, 'play_payment_unavailable'), { reason: 'This payment feature is unavailable in the app.' })
    }
    if (sharingRequest(request.method, request.path)) await ctx.store.read(db => requireSharingTerms(ctx, db, request.requireSession(db)))
    return handler(request)
  }
}
