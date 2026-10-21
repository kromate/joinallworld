import { SHARING_TERMS_VERSION } from '../../src/types/sharing.ts'
import { hasSharingTerms } from '../sharing-policy.ts'
import type { RouteModule } from '../types.ts'

const sharing: RouteModule = ctx => ({
  'GET /api/sharing/terms': async request => ({
    body: await ctx.store.read(db => ({ version: SHARING_TERMS_VERSION, accepted: hasSharingTerms(db, request.requireSession(db)) })),
    headers: { 'Cache-Control': 'no-store' },
  }),
  'POST /api/sharing/terms': async request => {
    const body = await request.json()
    if (body.version !== SHARING_TERMS_VERSION || body.over13 !== true) throw ctx.fail(400, 'terms_confirmation_required')
    return { body: await ctx.store.transact(db => {
      const session = request.requireSession(db, { renew: true })
      const target = session.account ? db.accounts?.[session.account] : session
      if (!target) throw ctx.fail(401, 'device_session_required')
      if (!hasSharingTerms(db, session)) target.sharingTerms = { version: SHARING_TERMS_VERSION, at: ctx.now(), minimumAge: 13 }
      return { version: SHARING_TERMS_VERSION, accepted: true }
    }), renew: true, headers: { 'Cache-Control': 'no-store' } }
  },
})
export default sharing
