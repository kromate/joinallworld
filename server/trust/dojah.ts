import { accountOfSession } from '../admin/gate.ts'
import { atLeast } from '../../src/game/trust/index.ts'
import { dojahConfig } from './config.ts'
import { trustOf } from './service.ts'
import type { Db, RouteContext, RouteRequest } from '../types.ts'

export interface IdCheck { ref: string; player: string; account: string; widget: string; environment: string; at: number; expiresAt: number; status: 'pending' | 'passed' | 'failed'; adult?: true }
export interface IdChecks { v: 1; checks: Record<string, IdCheck> }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const DAY = 86400000, LIMIT = 4000

function checksOf(ctx: RouteContext, db: Db): IdChecks {
  const found = ctx.collection(db, 'trustChecks', { v: 1, checks: {} })
  if (found.v !== 1 || !record(found.checks) || Object.keys(found.checks).length > LIMIT) throw ctx.fail(503, 'verification_storage_invalid')
  return found as unknown as IdChecks
}

/** Exact HMAC bytes. Neither signature nor provider payload enters durable state. */
export async function validDojahSignature(bytes: Uint8Array<ArrayBuffer>, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const signed = Uint8Array.from(signature.match(/.{2}/g) ?? [], value => parseInt(value, 16))
  return crypto.subtle.verify('HMAC', key, signed, bytes)
}

/** Read the verified document DOB in memory and discard it after deriving the threshold. */
function adultAt(value: unknown, now: number): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false
  const today = new Date(now), year = date.getUTCFullYear()
  if (year < today.getUTCFullYear() - 120 || date.getTime() > now) return false
  const eighteenth = Date.UTC(year + 18, date.getUTCMonth(), date.getUTCDate())
  return eighteenth <= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
}

/** This mapping must be sandbox-proven for the configured ID + selfie flow before activation. */
export function dojahOutcome(payload: unknown, now: number): { ref: string; widget: string; status: 'pending' | 'passed' | 'failed'; adult?: true } | null {
  if (!record(payload) || typeof payload.reference_id !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(payload.reference_id) || typeof payload.widget_id !== 'string') return null
  const base = { ref: payload.reference_id, widget: payload.widget_id }
  if (payload.verification_status === 'Ongoing' || payload.verification_status === 'Pending') return { ...base, status: 'pending' }
  if (payload.verification_status === 'Failed' || payload.verification_status === 'Abandoned') return { ...base, status: 'failed' }
  if (payload.verification_status !== 'Completed') return null
  const data = record(payload.data) ? payload.data : {}, id = record(data.id) ? data.id : {}, selfie = record(data.selfie) ? data.selfie : {}
  const document = record(id.data) && record(id.data.id_data) ? id.data.id_data : {}
  const passed = payload.status === true && id.status === true && selfie.status === true && adultAt(document.date_of_birth, now)
  return { ...base, status: passed ? 'passed' : 'failed', ...(passed ? { adult: true as const } : {}) }
}

export function dojahChecks(ctx: RouteContext) {
  const config = ctx.config.accounts ? dojahConfig(ctx.env) : null
  return {
    ready: () => config !== null,
    async start(request: RouteRequest) {
      if (!config) throw ctx.fail(503, 'provider_unavailable')
      if (!request.strictOrigin) throw ctx.fail(403, 'origin_required')
      const body = await request.json(); ctx.onceId(body.clientId)
      if (body.consent !== true) throw ctx.fail(400, 'verification_consent_required')
      return ctx.store.transact(db => {
        const session = request.requireSession(db), account = accountOfSession(db, session)
        if (!account) throw ctx.fail(403, 'account_required')
        if (!ctx.allow(`trust:id:${session.publicId}`, 3, 3600000)) throw ctx.fail(429, 'rate_limited')
        return ctx.once(db, session, { id: body.clientId, kind: 'trust.id.start', fingerprint: [config.widgetId, config.environment] }, () => {
          const collection = checksOf(ctx, db), now = ctx.now()
          for (const [id, check] of Object.entries(collection.checks)) if (check.expiresAt < now - DAY) delete collection.checks[id]
          const pending = Object.values(collection.checks).find(check => check.player === session.publicId && check.account === account.id && check.widget === config.widgetId && check.environment === config.environment && check.status === 'pending' && check.expiresAt > now)
          if (!pending && Object.keys(collection.checks).length >= LIMIT) throw ctx.fail(503, 'verification_capacity')
          const ref = pending?.ref ?? ctx.randomId()
          if (!pending) collection.checks[ref] = { ref, player: session.publicId, account: account.id, widget: config.widgetId, environment: config.environment, at: now, expiresAt: now + 2 * 3600000, status: 'pending' }
          return { ok: true, code: 'id_check_started', ref, appId: config.appId, publicKey: config.publicKey, widgetId: config.widgetId, environment: config.environment }
        })
      })
    },
    async result(request: RouteRequest) {
      return ctx.store.read(db => {
        const session = request.requireSession(db), account = accountOfSession(db, session)
        if (!account) throw ctx.fail(403, 'account_required')
        const ref = request.query.get('ref') ?? '', collection = db.trustChecks as IdChecks | undefined, found = collection?.checks?.[ref]
        if (!found || found.player !== session.publicId || found.account !== account.id) throw ctx.fail(404, 'verification_unavailable')
        return { ref, status: found.status === 'pending' && found.expiresAt <= ctx.now() ? 'expired' : found.status, environment: found.environment }
      })
    },
    async webhook(request: RouteRequest) {
      if (!config || !request.rawBody || !request.header) throw ctx.fail(503, 'provider_unavailable')
      const bytes = await request.rawBody(128 * 1024)
      if (!await validDojahSignature(bytes, request.header('x-dojah-signature'), config.secret)) throw ctx.fail(401, 'invalid_signature')
      let payload: unknown
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw ctx.fail(400, 'invalid_json') }
      const outcome = dojahOutcome(payload, ctx.now())
      if (!outcome) throw ctx.fail(400, 'unsupported_verification_result')
      return ctx.store.transact(db => {
        const collection = checksOf(ctx, db), check = collection.checks[outcome.ref]
        if (!check || check.widget !== outcome.widget || check.widget !== config.widgetId || check.environment !== config.environment || check.expiresAt <= ctx.now() || check.status !== 'pending') return { ok: true, code: 'ignored' }
        if (outcome.status === 'pending') return { ok: true, code: 'pending' }
        const account = db.accounts?.[check.account]
        if (!account || account.publicId !== check.player) { check.status = 'failed'; return { ok: true, code: 'ignored' } }
        check.status = outcome.status
        if (outcome.status === 'passed') {
          check.adult = true
          // Sandbox results are visible to their owner but never become a real-player badge.
          if (config.environment === 'production') {
            const stored = trustOf(ctx, db).players[check.player]
            trustOf(ctx, db).players[check.player] = stored && (!stored.account || stored.account === check.account) && atLeast(stored.tier, 'id')
              ? { ...stored, ref: check.ref, account: check.account, adultVerified: true }
              : { tier: 'id', by: 'provider', at: ctx.now(), ref: check.ref, account: check.account, adultVerified: true }
          }
        }
        return { ok: true, code: 'recorded' }
      })
    },
  }
}
