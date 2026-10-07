import { createTokenVerifier, KeysUnavailable, TOKEN_MAX_AGE_MS } from '../accounts/token.ts'
import { accountOfSession } from '../admin/gate.ts'
import { csrfOf } from '../routes/auth.ts'
import { atLeast } from '../../src/game/trust/index.ts'
import { trustOf, trustService } from './service.ts'
import { phoneConfigured } from './config.ts'
import type { RouteContext, RouteRequest } from '../types.ts'

export function phoneChecks(ctx: RouteContext) {
  const config = ctx.config.accounts
  const verifier = config ? createTokenVerifier({ projectId: config.projectId, fetch: ctx.fetch, now: ctx.now, maxAuthAgeMs: TOKEN_MAX_AGE_MS }) : null
  const trust = trustService(ctx)
  const ready = () => phoneConfigured(ctx.env, config)
  return {
    ready,
    async complete(request: RouteRequest) {
      if (!ready() || !verifier) throw ctx.fail(503, 'provider_unavailable')
      const body = await request.json()
      ctx.onceId(body.clientId)
      if (!request.strictOrigin || !request.cookie) throw ctx.fail(403, 'origin_required')
      const expected = await csrfOf(request.cookie)
      if (typeof body.csrf !== 'string' || body.csrf.length !== expected.length) throw ctx.fail(403, 'csrf_rejected')
      let difference = 0
      for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ body.csrf.charCodeAt(i)
      if (difference) throw ctx.fail(403, 'csrf_rejected')
      const binding = await ctx.store.read(db => {
        const session = request.requireSession(db), account = accountOfSession(db, session)
        if (!account) throw ctx.fail(403, 'account_required')
        if (!ctx.allow(`trust:phone:${session.publicId}`, 6, 3600000)) throw ctx.fail(429, 'rate_limited')
        return { subject: account.subject, account: account.id, player: session.publicId }
      })
      const identity = await verifier.verify(body.idToken).catch(error => { throw ctx.fail(error instanceof KeysUnavailable ? 503 : 401, error instanceof KeysUnavailable ? 'provider_unavailable' : 'invalid_token') })
      if (identity.subject !== binding.subject || !identity.emailVerified || !identity.phoneLinked) throw ctx.fail(403, 'linked_phone_required')
      return ctx.store.transact(db => {
        const session = request.requireSession(db), account = accountOfSession(db, session)
        if (!account || account.id !== binding.account || session.publicId !== binding.player || account.subject !== identity.subject) throw ctx.fail(403, 'account_changed')
        return ctx.once(db, session, { id: body.clientId, kind: 'trust.phone', fingerprint: [identity.digest] }, () => {
          if (!atLeast(trust.tierOf(db, session), 'phone')) trustOf(ctx, db).players[session.publicId] = { tier: 'phone', by: 'provider', at: ctx.now(), ref: ctx.randomId(), account: account.id }
          return { ok: true, code: 'phone_checked', tier: trust.tierOf(db, session) }
        })
      })
    },
  }
}
