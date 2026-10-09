import type { ApiEnvelope } from '../../../types/protocol.ts'
import type { StarterRentalResponse } from '../../../types/living-world.ts'

const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/
const SUCCESS_CODES = ['eligible', 'permission_issued', 'permission_retained']
const REFUSAL_CODES = ['qualification_required', 'qualification_mismatch', 'permission_revoked', 'invalid_saved_rental', 'invalid_server_clock', 'rental_capacity', 'receipt_superseded', 'rental_record_too_large']
const TOP_KEYS = ['serverTime', 'storage', 'ok', 'code', 'reason', 'duplicate', 'permission', 'revision', 'eligible', 'valid', 'tripAvailable', 'allocation']
const REQUIRED_KEYS = ['serverTime', 'ok', 'code', 'permission', 'revision', 'eligible', 'valid', 'tripAvailable', 'allocation']
const PERMISSION_KEYS = ['actor', 'resourceId', 'scope', 'qualificationId', 'qualificationVersion', 'issuedAt', 'status']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value)
  return actual.length === expected.length && actual.every(key => typeof key === 'string' && expected.includes(key))
}
function boundedInteger(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= Number.MAX_SAFE_INTEGER
}

/** Validates the actual HTTP success envelope and only the starter permission contract. */
export function validStarterRentalReply(value: unknown, expectedActor?: string): value is StarterRentalResponse & ApiEnvelope {
  if (!isRecord(value) || !REQUIRED_KEYS.every(key => Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !TOP_KEYS.includes(key))
    || !boundedInteger(value.serverTime)
    // The only protocol storage marker means persistence failed, so it cannot establish a saved permission.
    || Object.hasOwn(value, 'storage')
    || typeof value.ok !== 'boolean' || typeof value.code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value.code)
    || !SUCCESS_CODES.includes(value.code) && !REFUSAL_CODES.includes(value.code)
    || typeof value.eligible !== 'boolean' || typeof value.valid !== 'boolean'
    || value.tripAvailable !== false || value.allocation !== 'none'
    || !(value.revision === null || boundedInteger(value.revision))
    || value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 500)
    || value.duplicate !== undefined && value.duplicate !== true) return false

  const permission = value.permission
  if (permission !== null && (!isRecord(permission) || !exactKeys(permission, PERMISSION_KEYS)
    || typeof permission.actor !== 'string' || !ACTOR_ID.test(permission.actor)
    || expectedActor !== undefined && permission.actor !== expectedActor
    || permission.resourceId !== 'marina-starter-sedan' || permission.scope !== 'district-driving'
    || permission.qualificationId !== 'district-driving' || permission.qualificationVersion !== 1
    || !boundedInteger(permission.issuedAt) || permission.issuedAt > value.serverTime
    || permission.status !== 'active' && permission.status !== 'revoked')) return false

  if (value.valid) {
    if (!value.ok || !SUCCESS_CODES.includes(value.code) || !permission || !isRecord(permission)
      || permission.status !== 'active' || value.revision === null || value.revision < 1 || value.eligible) return false
  }
  if (value.eligible && (!value.ok || value.code !== 'eligible' || permission !== null || value.valid
    || value.revision !== null && value.revision !== 0)) return false
  if (value.code === 'eligible' && (!value.ok || !value.eligible || permission !== null || value.valid)) return false
  if (value.code === 'permission_issued' || value.code === 'permission_retained') {
    if (!value.ok || value.eligible || !permission || !isRecord(permission) || permission.status !== 'active') return false
    if (!value.valid) return false
  }
  if (REFUSAL_CODES.includes(value.code) && value.ok) return false
  if (permission && isRecord(permission)) {
    if (value.revision === null || value.revision < 1) return false
    if (permission.status === 'active' && value.eligible) return false
    if (permission.status === 'active' && !value.valid && !REFUSAL_CODES.includes(value.code)) return false
    if (permission.status === 'revoked' && (value.valid || value.eligible)) return false
  } else if (value.valid) return false
  if (!value.ok && !REFUSAL_CODES.includes(value.code)) return false
  return true
}
