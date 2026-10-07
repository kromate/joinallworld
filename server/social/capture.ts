/** Visit-scoped consent for the host's local, silent scene capture. */
import type { VisitRecord } from '../types.ts'

export interface CaptureVisit { id: string; visit: VisitRecord }
export interface CaptureProjection { revision: string; ready: boolean; endsAt: number }

/** Membership IDs plus the consent counter make every room change invalidate an active capture. */
export function captureRevision(counter: number | undefined, visits: readonly CaptureVisit[]): string {
  const roster = visits.map(({ id, visit }) => `${id}:${visit.captureId ?? 'old'}`).sort()
  return `${Number.isSafeInteger(counter) && (counter ?? 0) >= 0 ? counter : 0}|${roster.join('|')}`
}

/** Guests must all opt in and remain within their accepted visit's expiry. */
export function captureProjection(counter: number | undefined, visits: readonly CaptureVisit[], hostHome: boolean, now: number): CaptureProjection {
  const endsAt = visits.length ? Math.min(...visits.map(({ visit }) => visit.expires)) : 0
  return {
    revision: captureRevision(counter, visits),
    ready: hostHome && visits.length > 0 && visits.every(({ visit }) => visit.expires > now && visit.captureConsent === true),
    endsAt,
  }
}
