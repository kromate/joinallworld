/** Internal, point-read privacy helpers for living-world rows. Not an HTTP route. */
import { readValidatedBarberRecord } from './barber-service.ts'
import { readValidatedDrivingRecord } from './driving-service.ts'
import { readValidatedQualificationRecord } from './qualification-service.ts'
import { readValidatedStarterRentalRecord } from './rental-service.ts'
import { readValidatedClerkRecord } from './clerk-service.ts'
import { readValidatedJusticePracticeRecord } from './justice-practice-service.ts'
import { readValidatedAssessmentRecord } from './assessment-service.ts'
import type { Db } from '../types.ts'

const SLICES = ['driving', 'qualifications', 'barber', 'rentals', 'clerk', 'justicePractice', 'assessments'] as const
const MAX_OWNED_ACTORS = 6
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w:-]+$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

type Root = Record<string, unknown> | null | false
type Rows = Record<string, unknown> | null | false
type Slice<T> = { status: 'empty' } | { status: 'quarantined' } | { status: 'present'; progress: T }

export interface LivingWorldPrivacyExport {
  version: 1
  actors: {
    publicId: string
    driving: Slice<{
      status: 'running' | 'paused' | 'complete'
      assessment: 'pending' | 'passed' | 'failed'
      routeId: string
      routeVersion: string
      checkpointIndex: number
      score: number
      cityId: string
      location: string
      updatedAt: number
    }>
    qualification: Slice<{
      id: string
      version: number
      status: 'active' | 'revoked'
      courseId: string
      courseVersion: string
      cityId: string
      earnedAt: number
    }>
    barber: Slice<{
      starterTool: boolean
      lessons: {
        basic: BarberLessonSummary
        advanced: BarberLessonSummary
      }
    }>
    starterRental: Slice<{
      resourceId: string
      scope: 'district-driving'
      qualificationId: string
      version: number
      status: 'active' | 'revoked'
      issuedAt: number
      revision: number
    }>
    clerk?: Slice<{
      scenarioVersion: 1
      step: string
      revision: number
      claimed: boolean
      updatedAt: number
    }>
    justicePractice?: Slice<{
      scenarioVersion: 1
      phase: string
      revision: number
      trainingComplete: boolean
      updatedAt: number
    }>
    assessments?: Slice<{
      courseId: 'cpe-101'
      attempts: { semester: 1; startDay: number; phase: string; revision: number; score: number | null }[]
      updatedAt: number
    }>
  }[]
}

interface BarberLessonSummary {
  status: 'not_started' | 'running' | 'paused' | 'complete_unclaimed' | 'claimed'
  revision: number | null
  styleId: string | null
  earnedAt: number | null
}

/** Only account/session authority may call this, with its already-proven active and parked character IDs. */
export function exportLivingWorldProgress(db: Db, expectedAccount: string | null, ownedPublicIds: readonly string[]): LivingWorldPrivacyExport {
  if (!ownerId(expectedAccount)) throw new TypeError('Privacy export requires a valid server-derived account owner.')
  const ids = actorIds(ownedPublicIds)
  if (!ids) throw new TypeError('Privacy export requires bounded proven-owned character IDs.')
  const root = livingWorldRoot(db)
  const drivingRows = sliceRows(root, 'driving')
  const qualificationRows = sliceRows(root, 'qualifications')
  const barberRows = sliceRows(root, 'barber')
  const rentalRows = sliceRows(root, 'rentals')
  const clerkRows = sliceRows(root, 'clerk')
  const hasClerk = record(root) && Object.hasOwn(root, 'clerk')
  const justiceRows = sliceRows(root, 'justicePractice')
  const hasJustice = record(root) && Object.hasOwn(root, 'justicePractice')
  const assessmentRows = sliceRows(root, 'assessments')
  const hasAssessments = record(root) && Object.hasOwn(root, 'assessments')
  return {
    version: 1,
    actors: ids.map((publicId) => {
      const drivingRow = lookup(drivingRows, publicId, readValidatedDrivingRecord)
      const qualificationRow = lookup(qualificationRows, publicId, readValidatedQualificationRecord)
      const foundBarberRow = lookup(barberRows, publicId, readValidatedBarberRecord)
      const rentalRow = lookup(rentalRows, publicId, readValidatedStarterRentalRecord)
      const foundClerk = lookup(clerkRows, publicId, readValidatedClerkRecord)
      const foundJustice = lookup(justiceRows, publicId, readValidatedJusticePracticeRecord)
      const justiceRow = foundJustice.status === 'present' && foundJustice.row.account !== expectedAccount
        ? { status: 'quarantined' as const } : foundJustice
      const foundAssessments = lookup(assessmentRows, publicId, readValidatedAssessmentRecord)
      const assessmentsRow = foundAssessments.status === 'present' && foundAssessments.row.account !== expectedAccount
        ? { status: 'quarantined' as const } : foundAssessments
      const clerkRow = foundClerk.status === 'present' && foundClerk.row.account !== expectedAccount
        ? { status: 'quarantined' as const } : foundClerk
      const rental = rentalRow.status !== 'present' ? rentalRow : rentalRow.row.entitlement === null
        ? { status: 'quarantined' as const }
        : { status: 'present' as const, progress: {
          resourceId: rentalRow.row.entitlement.resourceId,
          scope: rentalRow.row.entitlement.scope,
          qualificationId: rentalRow.row.entitlement.qualificationId,
          version: rentalRow.row.entitlement.qualificationVersion,
          status: rentalRow.row.entitlement.status,
          issuedAt: rentalRow.row.entitlement.issuedAt,
          revision: rentalRow.row.revision,
        } }
      const barberRow = foundBarberRow.status === 'present' && foundBarberRow.row.account !== expectedAccount
        ? { status: 'quarantined' as const }
        : foundBarberRow
      return {
        publicId,
        driving: drivingRow.status !== 'present' ? drivingRow : { status: 'present', progress: {
          status: drivingRow.row.state.status,
          assessment: drivingRow.row.state.assessment,
          routeId: drivingRow.row.state.routeId,
          routeVersion: drivingRow.row.state.routeVersion,
          checkpointIndex: drivingRow.row.state.checkpointIndex,
          score: drivingRow.row.state.score,
          cityId: drivingRow.row.cityId,
          location: drivingRow.row.location,
          updatedAt: drivingRow.row.updatedAt,
        } },
        qualification: qualificationRow.status !== 'present' ? qualificationRow : { status: 'present', progress: {
          id: qualificationRow.row.qualification.id,
          version: qualificationRow.row.qualification.version,
          status: qualificationRow.row.qualification.status,
          courseId: qualificationRow.row.courseId,
          courseVersion: qualificationRow.row.courseVersion,
          cityId: qualificationRow.row.cityId,
          earnedAt: qualificationRow.row.qualification.earnedAt,
        } },
        barber: barberRow.status !== 'present' ? barberRow : { status: 'present', progress: barberSummary(barberRow.row) },
        starterRental: rental,
        ...(hasClerk ? { clerk: clerkRow.status !== 'present' ? clerkRow : { status: 'present' as const, progress: {
          scenarioVersion: 1 as const, step: clerkRow.row.practice.step,
          revision: clerkRow.row.practice.revision, claimed: clerkRow.row.claimed, updatedAt: clerkRow.row.updatedAt,
        } } } : {}),
        ...(hasJustice ? { justicePractice: justiceRow.status !== 'present' ? justiceRow : { status: 'present' as const, progress: {
          scenarioVersion: 1 as const, phase: justiceRow.row.practice.phase,
          revision: justiceRow.row.practice.revision, trainingComplete: justiceRow.row.practice.phase === 'complete',
          updatedAt: justiceRow.row.updatedAt,
        } } } : {}),
        ...(hasAssessments ? { assessments: assessmentsRow.status !== 'present' ? assessmentsRow : { status: 'present' as const, progress: {
          courseId: assessmentsRow.row.courseId,
          attempts: assessmentsRow.row.attempts.map(attempt => ({ semester: attempt.semester, startDay: attempt.startDay,
            phase: attempt.practice.phase, revision: attempt.practice.revision, score: attempt.practice.score })),
          updatedAt: assessmentsRow.row.updatedAt,
        } } } : {}),
      }
    }),
  }
}

/** Same-character account changes only: preserve every validated barber field except its account owner. */
export function rebindBarberAccount(db: Db, publicId: string, expectedOwner: string | null, nextOwner: string | null): boolean {
  if (!identifier(publicId) || !ownerId(expectedOwner) || !ownerId(nextOwner)) return false
  try {
    const rows = sliceRows(livingWorldRoot(db), 'barber')
    if (!record(rows) || !Object.hasOwn(rows, publicId)) return false
    const stored: unknown = rows[publicId]
    const validated = readValidatedBarberRecord(stored, publicId)
    if (!validated || validated.account !== expectedOwner || !record(stored)) return false
    const descriptor = Object.getOwnPropertyDescriptor(stored, 'account')
    if (!descriptor || !('value' in descriptor) || (!descriptor.writable && !descriptor.configurable)) return false
    Object.defineProperty(stored, 'account', { ...descriptor, value: nextOwner })
    return true
  } catch {
    return false
  }
}

/** Preserve the same character's validated exercise and reward receipt across account ownership changes. */
export function rebindClerkAccount(db: Db, publicId: string, expectedOwner: string | null, nextOwner: string | null): boolean {
  if (!identifier(publicId) || !ownerId(expectedOwner) || !ownerId(nextOwner)) return false
  try {
    const rows = sliceRows(livingWorldRoot(db), 'clerk')
    if (!record(rows) || !Object.hasOwn(rows, publicId)) return false
    const stored: unknown = rows[publicId]
    const validated = readValidatedClerkRecord(stored, publicId)
    if (!validated || validated.account !== expectedOwner || !record(stored)) return false
    const descriptor = Object.getOwnPropertyDescriptor(stored, 'account')
    if (!descriptor || !('value' in descriptor) || (!descriptor.writable && !descriptor.configurable)) return false
    Object.defineProperty(stored, 'account', { ...descriptor, value: nextOwner })
    return true
  } catch { return false }
}

/** Rebind only a proven character's valid training row; receipts and decisions remain private. */
export function rebindJusticePracticeAccount(db: Db, publicId: string, expectedOwner: string | null, nextOwner: string | null): boolean {
  if (!identifier(publicId) || !ownerId(expectedOwner) || !ownerId(nextOwner)) return false
  try {
    const rows = sliceRows(livingWorldRoot(db), 'justicePractice')
    if (!record(rows) || !Object.hasOwn(rows, publicId)) return false
    const stored: unknown = rows[publicId]
    const validated = readValidatedJusticePracticeRecord(stored, publicId)
    if (!validated || validated.account !== expectedOwner || !record(stored)) return false
    const descriptor = Object.getOwnPropertyDescriptor(stored, 'account')
    if (!descriptor || !('value' in descriptor) || (!descriptor.writable && !descriptor.configurable)) return false
    Object.defineProperty(stored, 'account', { ...descriptor, value: nextOwner })
    return true
  } catch { return false }
}

/** Preserve bounded lab attempts when the same proven character changes account owner. */
export function rebindAssessmentAccount(db: Db, publicId: string, expectedOwner: string | null, nextOwner: string | null): boolean {
  if (!identifier(publicId) || !ownerId(expectedOwner) || !ownerId(nextOwner)) return false
  try {
    const rows = sliceRows(livingWorldRoot(db), 'assessments')
    if (!record(rows) || !Object.hasOwn(rows, publicId)) return false
    const stored: unknown = rows[publicId]
    const validated = readValidatedAssessmentRecord(stored, publicId)
    if (!validated || validated.account !== expectedOwner || !record(stored)) return false
    const descriptor = Object.getOwnPropertyDescriptor(stored, 'account')
    if (!descriptor || !('value' in descriptor) || (!descriptor.writable && !descriptor.configurable)) return false
    Object.defineProperty(stored, 'account', { ...descriptor, value: nextOwner })
    return true
  } catch { return false }
}

/** Explicit erasure helper. It deletes only supplied IDs from existing, well-formed known maps. */
export function eraseLivingWorldProgress(db: Db, ownedPublicIds: readonly string[]): void {
  const ids = actorIds(ownedPublicIds)
  if (!ids) throw new TypeError('Privacy erasure requires bounded proven-owned character IDs.')
  if (ids.length === 0) return
  let root: Root
  let maps: (Record<string, unknown> | null)[]
  try {
    root = livingWorldRoot(db)
    if (root === null) return
    if (root === false) throw erasureUnavailable()
    maps = []
    for (const slice of SLICES) {
      const rows = sliceRows(root, slice)
      if (rows === false) throw erasureUnavailable()
      maps.push(rows)
    }
  } catch {
    throw erasureUnavailable()
  }
  for (const rows of maps) {
    if (rows === null) continue
    for (const publicId of ids) if (Object.hasOwn(rows, publicId) && !Reflect.deleteProperty(rows, publicId)) {
      throw erasureUnavailable()
    }
  }
}

function erasureUnavailable(): Error { return new Error('privacy-erasure-unavailable') }

function ownerId(value: string | null): boolean { return value === null || identifier(value) }
function actorIds(values: readonly string[]): string[] | null {
  if (!Array.isArray(values) || values.length > MAX_OWNED_ACTORS || !values.every(identifier)) return null
  return [...new Set(values)]
}
function livingWorldRoot(db: Db): Root {
  if (!Object.hasOwn(db, 'livingWorld')) return null
  const value: unknown = Reflect.get(db, 'livingWorld')
  if (value === undefined) return null
  return record(value) ? value : false
}
function sliceRows(root: Root, name: typeof SLICES[number]): Rows {
  if (root === null || root === false || !Object.hasOwn(root, name)) return root === false ? false : null
  const value: unknown = Reflect.get(root, name)
  return record(value) ? value : false
}
type Lookup<T> = { status: 'empty' | 'quarantined' } | { status: 'present'; row: T }
function lookup<T>(rows: Rows, publicId: string, read: (value: unknown, publicId: string) => T | null): Lookup<T> {
  if (rows === null) return { status: 'empty' }
  if (rows === false) return { status: 'quarantined' }
  if (!Object.hasOwn(rows, publicId)) return { status: 'empty' }
  try {
    const row = read(rows[publicId], publicId)
    return row ? { status: 'present', row } : { status: 'quarantined' }
  } catch {
    return { status: 'quarantined' }
  }
}
type StoredBarberRecord = NonNullable<ReturnType<typeof readValidatedBarberRecord>>
function barberSummary(row: StoredBarberRecord): {
  starterTool: boolean
  lessons: { basic: BarberLessonSummary; advanced: BarberLessonSummary }
} {
  const summary = (lessonId: 'basic' | 'advanced'): BarberLessonSummary => {
    const result = row.results[lessonId], lesson = row.lessons[lessonId]
    if (result) return { status: 'claimed', revision: lesson?.revision ?? null, styleId: result.styleId, earnedAt: result.earnedAt }
    if (!lesson) return { status: 'not_started', revision: null, styleId: null, earnedAt: null }
    return {
      status: lesson.practice.status === 'complete' ? 'complete_unclaimed' : lesson.practice.status,
      revision: lesson.revision,
      styleId: null,
      earnedAt: null,
    }
  }
  return { starterTool: row.starterTool, lessons: { basic: summary('basic'), advanced: summary('advanced') } }
}
