/**
 * Authenticated settlement boundary for the fictional NPC restock outlet.
 * This service deliberately does not register an HTTP route or provide a wallet adapter. The
 * host must inject its approved, synchronous, fixed game-cash action; that action runs in the
 * same durable transaction and exactly-once receipt as the inventory watermark.
 */
import { characterCity } from '../character.ts'
import { NPC_RESTOCK_POLICY, readNpcInventoryView, readValidatedNpcParcelEnvelope, settleNpcInventoryRestock, type NpcRestockEffect } from './npc-inventory.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/
const safeCount = (value: unknown, min = 0): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= min && value <= Number.MAX_SAFE_INTEGER
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  try { const own = Reflect.ownKeys(value); return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) }
  catch { return false }
}

export interface NpcRestockRequest {
  readonly cityId: 'lagos'
  readonly requestId: string
  readonly parcelId: string
  readonly revision: number
  readonly generation: number
  readonly inventoryRevision: number
}

export interface NpcRestockSettlement {
  readonly ok: boolean
  readonly code: string
  readonly duplicate?: true
  readonly inventoryRevision: number | null
  readonly stock: number | null
}

/**
 * The only extension point for money: synchronous, server-only, and supplied by the production
 * host. It receives the already validated fixed effect, never request-controlled amount/actor.
 * Implementations must throw on any rejected or partial wallet action so Store.transact rolls back.
 */
export type ApplyNpcRestockWage = (
  db: Db,
  session: SessionRecord,
  effect: NpcRestockEffect,
  at: number,
  requestId: string,
) => 'credited'

function parseRequest(value: unknown): NpcRestockRequest | null {
  if (!record(value) || !exact(value, ['cityId', 'requestId', 'parcelId', 'revision', 'generation', 'inventoryRevision'])
    || value.cityId !== NPC_RESTOCK_POLICY.cityId
    || typeof value.requestId !== 'string' || !ID.test(value.requestId)
    || typeof value.parcelId !== 'string' || !ID.test(value.parcelId)
    || !safeCount(value.revision, 1) || !safeCount(value.generation, 1) || !safeCount(value.inventoryRevision)) return null
  return {
    cityId: 'lagos', requestId: value.requestId, parcelId: value.parcelId,
    revision: value.revision, generation: value.generation, inventoryRevision: value.inventoryRevision,
  }
}

function access(ctx: RouteContext, db: Db, request: RouteRequest): SessionRecord {
  const session = request.requireSession(db, { renew: true })
  if (!ctx.allow(`living-world:restock:${session.publicId}`, 30, 60_000)) throw ctx.fail(429, 'rate_limited')
  ctx.checks?.cityGate?.(session, NPC_RESTOCK_POLICY.cityId)
  if (characterCity(session) !== NPC_RESTOCK_POLICY.cityId) throw ctx.fail(409, 'city_moved')
  const life = ctx.settle(session, NPC_RESTOCK_POLICY.cityId)
  if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
  if (life.activeAction !== null) throw ctx.fail(409, 'busy')
  return session
}

function parcelFor(db: Db, session: SessionRecord, body: NpcRestockRequest) {
  const root: unknown = db.livingWorld
  if (!record(root) || !record(root.parcels) || !Object.hasOwn(root.parcels, session.publicId)) return null
  const state = readValidatedNpcParcelEnvelope(root.parcels[session.publicId], session.publicId, session.account ?? null)
  if (!state || state.revision !== body.revision || state.generation !== body.generation || state.parcel?.id !== body.parcelId) return null
  return state
}

export function createNpcRestockService(ctx: RouteContext, applyFixedWage: ApplyNpcRestockWage) {
  if (typeof applyFixedWage !== 'function') throw new TypeError('A server-only NPC restock wage adapter is required')

  function settleDelivered(request: RouteRequest, raw: unknown): Promise<NpcRestockSettlement> {
    const body = parseRequest(raw)
    if (!body) throw ctx.fail(400, 'invalid_restock_request')
    const receiptAt = ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const session = access(ctx, db, request)
      // Recheck current ownership before replaying any receipt. Legitimate adoption preserves
      // the actor's retry identity; a stale or foreign parcel envelope cannot reuse old success.
      const retained = parcelFor(db, session, body)
      if (!retained || !retained.parcel || retained.parcel.status !== 'delivered' || retained.parcel.custody !== 'destination')
        return { ok: false, code: 'parcel_unavailable', inventoryRevision: null, stock: null }
      const inventory = readNpcInventoryView(db)
      if (!inventory) return { ok: false, code: 'inventory_quarantined', inventoryRevision: null, stock: null }
      const onceResult = ctx.once(db, session, {
        id: body.requestId,
        kind: 'living-world.npc-restock.settle',
        fingerprint: {
          cityId: body.cityId, parcelId: body.parcelId, revision: body.revision,
          generation: body.generation, inventoryRevision: body.inventoryRevision,
        },
      }, at => {
        const now = ctx.now()
        if (!safeCount(at) || at !== receiptAt || !safeCount(now) || receiptAt > now) return { ok: false, code: 'invalid_server_clock' }
        const current = parcelFor(db, session, body)
        if (!current || !current.parcel || current.parcel.status !== 'delivered' || current.parcel.custody !== 'destination')
          return { ok: false, code: 'parcel_unavailable' }
        if (current.parcel.terminalAt === undefined || current.parcel.terminalAt > now)
          return { ok: false, code: 'parcel_time_unavailable' }
        const result = settleNpcInventoryRestock(db, session.publicId, session.account ?? null, body.inventoryRevision)
        if (!result.ok) return { ok: false, code: result.code }
        if (result.code === 'already_restocked') return { ok: true, code: result.code, duplicate: true }

        // This callback is mandatory and synchronous. Throwing aborts both the NPC inventory
        // watermark and this ctx.once receipt; returning anything but the fixed success token
        // also aborts instead of acknowledging a partial wage.
        const applied = applyFixedWage(db, session, result.effect, at, body.requestId)
        if (applied !== 'credited') throw new Error('NPC restock wage action was not committed')
        return { ok: true, code: 'restocked', revision: result.effect.stock.revision }
      })
      const state = readNpcInventoryView(db)
      return {
        ok: onceResult.ok === true,
        code: typeof onceResult.code === 'string' ? onceResult.code : 'restock_refused',
        ...('duplicate' in onceResult && onceResult.duplicate === true ? { duplicate: true as const } : {}),
        inventoryRevision: state?.revision ?? null,
        stock: state?.stock ?? null,
      }
    })
  }

  return { settleDelivered }
}
