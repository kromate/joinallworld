import type { ApiEnvelope } from '../../../types/protocol.ts'
import type { QualificationResponse } from '../../../types/living-world.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the actual client API result, including its HTTP success envelope. */
export function validQualificationReply(value: unknown): value is QualificationResponse & ApiEnvelope {
  if (!isRecord(value)
    || typeof value.serverTime !== 'number' || !Number.isSafeInteger(value.serverTime) || value.serverTime < 0
    || value.storage !== undefined && value.storage !== 'failing'
    // A successful response marked unsaved cannot establish a persisted qualification.
    || value.storage === 'failing'
    || typeof value.ok !== 'boolean' || typeof value.code !== 'string' || value.code.length > 80
    || typeof value.valid !== 'boolean' || !Object.prototype.hasOwnProperty.call(value, 'qualification')
    || Object.keys(value).some(key => !['serverTime', 'storage', 'ok', 'code', 'reason', 'duplicate', 'qualification', 'valid'].includes(key))
    || value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 500)
    || value.duplicate !== undefined && value.duplicate !== true) return false

  const q = value.qualification
  const qualificationShape = q === null || isRecord(q) && Object.keys(q).sort().join(',') === 'earnedAt,evidenceJourneyId,id,status,version'
    && q.id === 'district-driving' && q.version === 1
    && typeof q.evidenceJourneyId === 'string' && /^[\w:-]{1,100}$/.test(q.evidenceJourneyId)
    && Number.isSafeInteger(q.earnedAt) && (q.earnedAt as number) >= 0
    && (q.status === 'active' || q.status === 'revoked')
  return qualificationShape && (!value.valid || value.ok && value.code === 'qualified' && q !== null && isRecord(q) && q.status === 'active')
}
