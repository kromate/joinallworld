/**
 * Fictional NPC outlet settlement boundary. This is deliberately separate from player business
 * shops: NPC stock has no till, resale, closure, or cash-out path. It is an internal transaction
 * helper, not a route and not proof that a mapped trip is available.
 *
 * Expected future parcel-service envelope (read-only here):
 * livingWorld.parcels[publicId] = { v: 1, publicId, account, state: ParcelState }.
 * The caller must run this inside the same durable store transaction/ctx.once as its fixed wage
 * fictional game-cash wallet action. If the wallet action fails, the caller must throw so the store rolls this change
 * back with it. No browser-supplied parcel effect, pose, or amount is accepted.
 */
import { readValidatedParcelState, type ParcelState } from '../../src/game/living-world/parcel.ts'
import type { Db } from '../types.ts'

const MAX_STOCK = 60
const MAX_ACTORS = MAX_STOCK / 3
const MAX_ROOT_BYTES = 96 * 1024
const MAX_SAFE = Number.MAX_SAFE_INTEGER
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/

export const NPC_RESTOCK_POLICY = Object.freeze({
  cityId: 'lagos',
  destinationId: 'lagos-fictional-restock-outlet',
  outletId: 'lagos-fictional-restock-outlet',
  originId: 'marina-fictional-depot',
  product: 'water',
  quantity: 3,
  wage: 120,
  capacity: MAX_STOCK,
} as const)

interface OutletState {
  id: typeof NPC_RESTOCK_POLICY.outletId
  cityId: typeof NPC_RESTOCK_POLICY.cityId
  product: typeof NPC_RESTOCK_POLICY.product
  capacity: typeof MAX_STOCK
  stock: number
  revision: number
}
interface ActorWatermark {
  settlements: number
  generation: number
  parcelId: string
  deliveredAt: number
  parcelFingerprint: string
}
interface InventoryState {
  version: 1
  outlet: OutletState
  delivered: Record<string, ActorWatermark>
}

export interface NpcRestockEffect {
  readonly actorId: string
  readonly parcelId: string
  readonly generation: number
  readonly stock: Readonly<{
    outletId: typeof NPC_RESTOCK_POLICY.outletId
    product: typeof NPC_RESTOCK_POLICY.product
    quantity: typeof NPC_RESTOCK_POLICY.quantity
    expectedRevision: number
    revision: number
  }>
  readonly wage: typeof NPC_RESTOCK_POLICY.wage
}
export type NpcRestockResult =
  | { ok: true; code: 'restocked'; effect: NpcRestockEffect }
  | { ok: true; code: 'already_restocked'; duplicate: true }
  | { ok: false; code: string }

type JsonRecord = Record<string, unknown>
const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
function isPlain(value: unknown): value is JsonRecord {
  try { return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) }
  catch { return false }
}
function exact(value: JsonRecord, keys: readonly string[]): boolean {
  try {
    const own = Reflect.ownKeys(value)
    return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
  } catch { return false }
}
const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const count = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= MAX_SAFE
function validFingerprint(value: unknown, actorId: string, generation: number, parcelId: string, deliveredAt: number): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[^\x00-\x7f]/.test(value)) return false
  try {
    const parsed: unknown = JSON.parse(value)
    const state = readValidatedParcelState(parsed)
    const parcel = state?.parcel
    return !!state && state.actor === actorId && state.generation === generation && !!parcel
      && parcel.id === parcelId && parcel.generation === generation && parcel.actor === actorId
      && parcel.status === 'delivered' && parcel.custody === 'destination' && parcel.terminalAt === deliveredAt
      && parcel.cityId === NPC_RESTOCK_POLICY.cityId && parcel.originId === NPC_RESTOCK_POLICY.originId
      && parcel.destinationId === NPC_RESTOCK_POLICY.destinationId && parcel.product === NPC_RESTOCK_POLICY.product
      && parcel.quantity === NPC_RESTOCK_POLICY.quantity && parcel.wage === NPC_RESTOCK_POLICY.wage
      && JSON.stringify(state) === value
  } catch { return false }
}
function encodedBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value)
    return text === undefined || /[^\x00-\x7f]/.test(text) ? null : text.length
  } catch { return null }
}
function rowCount(rows: JsonRecord): number {
  try {
    let count = 0
    for (const key of Reflect.ownKeys(rows)) {
      if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(rows, key)) return MAX_ACTORS + 1
      if (++count > MAX_ACTORS) return count
    }
    return count
  } catch { return MAX_ACTORS + 1 }
}

function emptyInventory(): InventoryState {
  return { version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: NPC_RESTOCK_POLICY.cityId,
    product: NPC_RESTOCK_POLICY.product, capacity: MAX_STOCK, stock: 0, revision: 0 }, delivered: {} }
}

/** Strictly parse without repairing malformed/future state. */
function readInventory(value: unknown): InventoryState | null {
  try {
    if (!isPlain(value) || !exact(value, ['version', 'outlet', 'delivered']) || value.version !== 1
      || !isPlain(value.outlet) || !exact(value.outlet, ['id', 'cityId', 'product', 'capacity', 'stock', 'revision'])
      || value.outlet.id !== NPC_RESTOCK_POLICY.outletId || value.outlet.cityId !== NPC_RESTOCK_POLICY.cityId
      || value.outlet.product !== NPC_RESTOCK_POLICY.product || value.outlet.capacity !== MAX_STOCK
      || !count(value.outlet.stock) || value.outlet.stock > MAX_STOCK || !count(value.outlet.revision)
      || value.outlet.revision > MAX_STOCK / NPC_RESTOCK_POLICY.quantity
      || value.outlet.stock !== value.outlet.revision * NPC_RESTOCK_POLICY.quantity
      || !isPlain(value.delivered) || rowCount(value.delivered) > MAX_ACTORS) return null
    const delivered: Record<string, ActorWatermark> = Object.create(null) as Record<string, ActorWatermark>
    let settlements = 0
    for (const actor of Object.keys(value.delivered)) {
      const raw = value.delivered[actor]
      if (!id(actor) || !isPlain(raw) || !exact(raw, ['settlements', 'generation', 'parcelId', 'deliveredAt', 'parcelFingerprint'])
        || !count(raw.settlements, 1) || !count(raw.generation, 1) || raw.settlements > raw.generation
        || !id(raw.parcelId) || !count(raw.deliveredAt)
        || !validFingerprint(raw.parcelFingerprint, actor, raw.generation, raw.parcelId, raw.deliveredAt)) return null
      settlements += raw.settlements
      if (settlements > value.outlet.revision) return null
      delivered[actor] = { settlements: raw.settlements, generation: raw.generation, parcelId: raw.parcelId, deliveredAt: raw.deliveredAt, parcelFingerprint: raw.parcelFingerprint }
    }
    const parsed: InventoryState = { version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId,
      cityId: NPC_RESTOCK_POLICY.cityId, product: NPC_RESTOCK_POLICY.product, capacity: MAX_STOCK,
      stock: value.outlet.stock, revision: value.outlet.revision }, delivered }
    const bytes = encodedBytes(parsed)
    return bytes !== null && bytes <= MAX_ROOT_BYTES && settlements === parsed.outlet.revision ? parsed : null
  } catch { return null }
}

/** Strict reader for the proposed parcel-service storage envelope; it does not validate route authority. */
export function readValidatedNpcParcelEnvelope(value: unknown, actorId: string, account: string | null): ParcelState | null {
  try {
    if (!id(actorId) || !(account === null || id(account)) || !isPlain(value) || !exact(value, ['v', 'publicId', 'account', 'state']) || value.v !== 1
      || value.publicId !== actorId || value.account !== account || !(value.account === null || id(value.account))) return null
    const state = readValidatedParcelState(value.state)
    if (!state || state.actor !== actorId || !state.parcel) return null
    return state
  } catch { return null }
}

/**
 * Apply one currently saved, strictly validated delivered parcel to the separate fictional outlet.
 * This function validates every precondition before its first write. Replays (including a parcel
 * replaced by a later generation) are a no-op. `expectedInventoryRevision` must come from the caller's
 * server-side inventory snapshot in the same transaction, never from a request body. On success,
 * the caller must perform the returned
 * fixed wage action in this same transaction or throw to roll back both effects.
 */
export function settleNpcInventoryRestock(db: Db, actorId: string, expectedAccount: string | null, expectedRevision: number): NpcRestockResult {
  if (!id(actorId) || !(expectedAccount === null || id(expectedAccount))) return { ok: false, code: 'invalid_binding' }
  if (!count(expectedRevision)) return { ok: false, code: 'invalid_revision' }
  try {
    const root: unknown = db.livingWorld
    if (!isPlain(root))
      return { ok: false, code: 'parcel_source_unavailable' }
    const parcelMapDescriptor = Object.getOwnPropertyDescriptor(root, 'parcels')
    if (!parcelMapDescriptor || !('value' in parcelMapDescriptor) || !parcelMapDescriptor.enumerable || !isPlain(parcelMapDescriptor.value))
      return { ok: false, code: 'parcel_source_unavailable' }
    const rows = parcelMapDescriptor.value
    const parcelDescriptor = Object.getOwnPropertyDescriptor(rows, actorId)
    if (!parcelDescriptor) return { ok: false, code: 'parcel_missing' }
    if (!('value' in parcelDescriptor) || !parcelDescriptor.enumerable) return { ok: false, code: 'parcel_unavailable' }
    const parcelState = readValidatedNpcParcelEnvelope(parcelDescriptor.value, actorId, expectedAccount)
    if (!parcelState) return { ok: false, code: 'parcel_unavailable' }
    const parcel = parcelState.parcel!
    if (parcel.status !== 'delivered' || parcel.custody !== 'destination' || parcel.terminalAt === undefined)
      return { ok: false, code: 'parcel_not_delivered' }
    if (parcel.cityId !== NPC_RESTOCK_POLICY.cityId || parcel.originId !== NPC_RESTOCK_POLICY.originId
      || parcel.destinationId !== NPC_RESTOCK_POLICY.destinationId || parcel.product !== NPC_RESTOCK_POLICY.product
      || parcel.quantity !== NPC_RESTOCK_POLICY.quantity || parcel.wage !== NPC_RESTOCK_POLICY.wage)
      return { ok: false, code: 'parcel_terms_mismatch' }
    const encodedFingerprint = JSON.stringify(parcelState)
    if (!validFingerprint(encodedFingerprint, actorId, parcel.generation, parcel.id, parcel.terminalAt)) return { ok: false, code: 'parcel_unavailable' }
    const parcelFingerprint = encodedFingerprint

    const inventoryDescriptor = Object.getOwnPropertyDescriptor(root, 'npcInventory')
    if (inventoryDescriptor && (!('value' in inventoryDescriptor) || !inventoryDescriptor.enumerable
      || (!inventoryDescriptor.writable && !inventoryDescriptor.configurable))) return { ok: false, code: 'inventory_quarantined' }
    const current = inventoryDescriptor ? readInventory(inventoryDescriptor.value) : emptyInventory()
    if (!current) return { ok: false, code: 'inventory_quarantined' }
    const prior = current.delivered[actorId]
    if (prior && parcel.generation < prior.generation) return { ok: true, code: 'already_restocked', duplicate: true }
    if (prior && parcel.generation === prior.generation) {
      if (parcel.id !== prior.parcelId || parcel.terminalAt !== prior.deliveredAt || parcelFingerprint !== prior.parcelFingerprint)
        return { ok: false, code: 'parcel_generation_conflict' }
      return { ok: true, code: 'already_restocked', duplicate: true }
    }
    if (prior && parcel.terminalAt < prior.deliveredAt) return { ok: false, code: 'clock_reversed' }
    if (current.outlet.revision !== expectedRevision) return { ok: false, code: 'revision_conflict' }
    if (current.outlet.revision >= MAX_SAFE) return { ok: false, code: 'inventory_revision_exhausted' }
    if (current.outlet.stock + parcel.quantity > current.outlet.capacity) return { ok: false, code: 'outlet_capacity' }
    if (!prior && rowCount(current.delivered) >= MAX_ACTORS) return { ok: false, code: 'inventory_actor_capacity' }

    const next: InventoryState = {
      version: 1,
      outlet: { ...current.outlet, stock: current.outlet.stock + parcel.quantity, revision: current.outlet.revision + 1 },
      delivered: { ...current.delivered, [actorId]: { settlements: (prior?.settlements ?? 0) + 1, generation: parcel.generation, parcelId: parcel.id,
        deliveredAt: parcel.terminalAt, parcelFingerprint } },
    }
    const bytes = encodedBytes(next)
    if (bytes === null || bytes > MAX_ROOT_BYTES) return { ok: false, code: 'inventory_record_too_large' }

    const stock = Object.freeze({ outletId: NPC_RESTOCK_POLICY.outletId, product: NPC_RESTOCK_POLICY.product,
      quantity: NPC_RESTOCK_POLICY.quantity, expectedRevision: current.outlet.revision, revision: next.outlet.revision })
    const effect: NpcRestockEffect = Object.freeze({ actorId, parcelId: parcel.id, generation: parcel.generation, stock, wage: NPC_RESTOCK_POLICY.wage })
    // Mutate only after all validation and effect construction succeeded. A surrounding store
    // transaction discards this assignment if its fictional wage action or durable write fails.
    Object.defineProperty(root, 'npcInventory', inventoryDescriptor
      ? { ...inventoryDescriptor, value: next }
      : { value: next, enumerable: true, configurable: true, writable: true })
    return { ok: true, code: 'restocked', effect }
  } catch {
    return { ok: false, code: 'inventory_unavailable' }
  }
}
