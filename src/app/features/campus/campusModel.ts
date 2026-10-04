// The Campus app's decisions, apart from the screen: what a button says when it cannot be pressed,
// how a record is summed, what the shared board looks like once the server has answered. Pure, so it
// is tested without a browser. The words are the existing panel's (src/ui/panels/campus.js).
import type { CampusSummary, CampusUnavailable, HostelAllocation, ProgrammeId, SemesterRecord, UnilagStudentView } from '../../../types/campus.ts'
import type { LifeState } from '../../../types/life.ts'
import { glyphOfEmoji } from '../../../ui/icon-map.ts'
import { LECTURE_SLOTS } from './campusContent.ts'

export const TABS = [
  ['overview', 'Overview'],
  ['study', 'Study'],
  ['residence', 'Residence'],
  ['community', 'Community'],
] as const
export type TabId = typeof TABS[number][0]
export const isTab = (value: unknown): value is TabId => TABS.some(([id]) => id === value)

/** Where the Sim is and whether it is busy: the part of the life every reason reads. */
export type Here = Pick<LifeState, 'location' | 'spot' | 'activeAction'>

/** A card's mark. The content and the cards carry an emoji as their text fallback; the app draws its own glyph (the mortarboard when the set has none closer). */
export const markOf = (emoji: unknown): string => glyphOfEmoji(emoji) || 'campus'

/** 'main-gate' → 'Main Gate'. */
export const title = (id: unknown): string => String(id ?? '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
export const formatCount = (value: unknown): string => Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-NG')
/** The first reason that is not empty: the order the reasons are checked in is the order they are given. */
export const first = (...reasons: readonly string[]): string => reasons.find((reason) => reason !== '') ?? ''

export const onCampus = (state: Pick<Here, 'location'>): boolean => state.location === 'unilag'
export const at = (state: Here, spot: string): boolean => onCampus(state) && state.spot === spot
export const activeReason = (state: Pick<Here, 'activeAction'>, connected: boolean): string =>
  !connected ? 'Reconnect to do this.' : state.activeAction ? 'Finish or cancel your current action first.' : ''

/** One live board per person and city: when either changes, what was loaded is dropped. */
export const sharedKey = (view: { session?: { id: string } | null; cityId?: string | null } | null | undefined): string => `${view?.session?.id ?? 'guest'}:${view?.cityId ?? ''}`

/** The size of a stored stack: 1 to 20, the previous choice when the field holds no number. */
export const clampCount = (raw: unknown, fallback = 1): number => Math.max(1, Math.min(20, Math.round(Number(raw) || fallback)))

// ---- the two halves of the shared board ---------------------------------------------------------

export type SharedData = CampusSummary | CampusUnavailable
/** The server's answer as a board, or null when it is not one (an HTTP write answers with the summary in the body). */
export function normalizeShared(payload: unknown): SharedData | null {
  const body = payload as { summary?: unknown } | null | undefined
  const data = (body && typeof body === 'object' && body.summary !== undefined ? body.summary : payload) as Record<string, unknown> | null | undefined
  return data && typeof data === 'object' && Object.hasOwn(data, 'election') && Object.hasOwn(data, 'leaderboards') && Object.hasOwn(data, 'goal') ? data as unknown as SharedData : null
}

export interface StandingLike { name?: string; id?: string; studentId?: string; members?: number; score?: number; value?: number; points?: number }
export interface StandingRow { key: string; name: string; members: string; score: string }
/** The five best of a board. */
export function standingRows(items: readonly StandingLike[] | null | undefined): StandingRow[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 5).map((item, index) => ({
    key: `${index}:${item.id ?? item.studentId ?? ''}`,
    name: item.name ?? title(item.id ?? item.studentId ?? 'Player'),
    members: item.members ? `${item.members} player${item.members === 1 ? '' : 's'}` : '',
    score: formatCount(item.score ?? item.value ?? item.points ?? 0),
  }))
}

export interface GoalView { progress: string; target: string; percent: number; complete: boolean }
export function goalView(goal: { progress?: unknown; target?: unknown; complete?: boolean } | null | undefined): GoalView {
  const target = Math.max(1, Number(goal?.target) || 1), progress = Math.max(0, Number(goal?.progress) || 0)
  return { progress: formatCount(progress), target: formatCount(target), percent: Math.min(100, Math.round(progress / target * 100)), complete: Boolean(goal?.complete) }
}

export const NOMINATE_NOTE = 'Aluta volunteering adds one verified contribution per player each day.'
export function nominateReason(connected: boolean, eligible: boolean, phase: string, nominated: boolean): string {
  return !connected ? 'Reconnect to nominate.' : !eligible ? 'Matriculate as a current student first.' : phase !== 'nominations' ? 'Nominations run Monday to Wednesday.' : nominated ? 'You are already on this ballot.' : ''
}
export function voteReason(connected: boolean, eligible: boolean, phase: string, voted: boolean): string {
  return !connected ? 'Reconnect to vote.' : !eligible ? 'Matriculate as a current student first.' : phase !== 'voting' ? 'Voting runs Thursday to Saturday.' : voted ? 'You already voted this week.' : ''
}

// ---- the student ----------------------------------------------------------------------------------

/** What the Study tab reads before a student exists. */
export type StudentLike = Pick<UnilagStudentView, 'status'> & Partial<Omit<UnilagStudentView, 'status'>>
export const BLANK_STUDENT: StudentLike = { status: 'none', records: [] }

export function cgpaOf(student: StudentLike | null | undefined): string {
  if (student?.degree?.cgpa !== undefined) return Number(student.degree.cgpa).toFixed(2)
  const courses = (student?.records ?? []).flatMap((record) => record.courseResults ?? [])
  const credits = courses.reduce((sum, course) => sum + (Number(course.credits) || 0), 0)
  const points = courses.reduce((sum, course) => sum + (Number(course.points) || 0) * (Number(course.credits) || 0), 0)
  return credits ? (points / credits).toFixed(2) : '—'
}

export const recordLine = (record: SemesterRecord): { head: string; sub: string; gpa: string } => ({
  head: `Semester ${record.semester} · attempt ${record.attempt}`,
  sub: `${record.passed ? 'Passed' : 'Not passed'}${record.scholarshipAwarded ? ' · Scholarship awarded' : ''}`,
  gpa: Number(record.gpa || 0).toFixed(2),
})

export function allocationOf(student: StudentLike | null | undefined): HostelAllocation | null {
  return student?.hostel?.allocations?.find((item) => item.semester === student.term?.semester && item.attempt === student.term?.attempt) ?? null
}

export interface Admission { coding: number; charisma: number; skillMet: boolean; place: boolean; reason: string; fee: number }
export function admissionOf(state: Here, connected: boolean, student: StudentLike | null | undefined, skills: Partial<Record<string, { level?: number } | undefined>> | null | undefined): Admission {
  const coding = skills?.['coding']?.level ?? 0, charisma = skills?.['charisma']?.level ?? 0
  const skillMet = coding >= 1 || charisma >= 1
  const place = at(state, 'senate')
  return {
    coding, charisma, skillMet, place, fee: student?.betaRules?.admissionFee ?? 200,
    reason: first(activeReason(state, connected), !place ? 'Go to Senate House before applying.' : '', !skillMet ? 'Reach Coding level 1 or Charisma level 1 first.' : ''),
  }
}

/** The semester a matriculated student registers next: the second once the first is passed. */
export const nextSemester = (student: Pick<StudentLike, 'records'>): 1 | 2 => (student.records?.find((record) => record.semester === 1 && record.passed) ? 2 : 1)
export const semesterFee = (student: StudentLike): number => (student.betaRules?.tuition ?? 1000) + (student.betaRules?.levy ?? 100)

export const MATRICULATE_REASON = 'Go to Senate House to matriculate.'
/** Which enrolment card the Study tab shows. */
export function enrolmentStep(student: StudentLike): 'apply' | 'matriculate' | 'register' | null {
  if (['none', 'dropped'].includes(student.status)) return 'apply'
  if (student.status === 'admitted') return 'matriculate'
  if (student.status === 'matriculated' && !student.term && !student.degree) return 'register'
  return null
}

export interface CourseControls {
  attend: { label: string; reason: string; primary: boolean }
  assignment: { reason: string }
  test: { reason: string }
  slotLabel: string
}
/** The three buttons of one course row and why each may be shut. */
export function courseControls(course: NonNullable<UnilagStudentView['courses']>[number], base: string, minuteOfDay: number): CourseControls {
  const slot = LECTURE_SLOTS[course.slot], night = LECTURE_SLOTS.night
  const official = minuteOfDay >= slot.open && minuteOfDay < slot.close
  const nightOpen = minuteOfDay >= night.open && minuteOfDay < night.close
  return {
    slotLabel: slot.label,
    attend: {
      label: official ? 'Attend lecture' : nightOpen ? 'Join night class' : 'Lecture closed',
      reason: first(base, !official && !nightOpen ? `Lecture opens ${slot.label}; night class is ${night.label}.` : ''),
      primary: official || nightOpen,
    },
    assignment: { reason: first(base, course.assignment !== null ? 'Assignment already completed.' : '') },
    test: { reason: first(base, course.test !== null ? 'Test already completed.' : '') },
  }
}

export function closeSemesterReason(blocked: string, student: UnilagStudentView, today: number): { reason: string; primary: boolean } {
  const allTests = student.courses.every((course) => course.test !== null)
  const deadline = student.term?.deadlineDay ?? today
  return {
    reason: first(blocked, student.status === 'deferred' ? 'Resume this semester first.' : '', !allTests ? 'Complete every course test first.' : '', today < deadline ? `Semester closes in ${deadline - today} Lagos day(s).` : ''),
    primary: allTests && today >= deadline,
  }
}

export const canChangeProgramme = (student: StudentLike): boolean => ['admitted', 'matriculated'].includes(student.status) && !student.term && !(student.records?.length)
export const programmeActive = (student: StudentLike): boolean => ['admitted', 'matriculated', 'studying', 'deferred'].includes(student.status)

export function jobReason(blocked: string, student: StudentLike | null | undefined, doneToday: boolean, atJob: boolean, spot: string): string {
  return first(blocked, !student?.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status) ? 'Current matriculated students only.' : '', doneToday ? 'You already completed a paid campus job today.' : '', !atJob ? `Go to ${title(spot)} first.` : '')
}

export const storedLine = (storage: Partial<Record<string, number>> | undefined): { id: string; text: string }[] =>
  Object.entries(storage ?? {}).filter(([, count]) => (count ?? 0) > 0).map(([id, count]) => ({ id, text: `${title(id)} ×${count}` }))

// ---- the shuttle ----------------------------------------------------------------------------------

export function shuttleReason(blocked: string, atStop: boolean, chosen: string): string {
  return first(blocked, !atStop ? 'Stand at one of the eight shuttle stops first.' : '', !chosen ? 'Choose another stop.' : '')
}

// ---- community ------------------------------------------------------------------------------------

export const ELIGIBLE_FIRST = 'Matriculate as a current student first.'
export const clubReason = (connected: boolean, eligible: boolean): string => (!connected ? 'Reconnect to change clubs.' : !eligible ? ELIGIBLE_FIRST : '')
export function discoveryReason(blocked: string, eligible: boolean, hereId: string | null, found: ReadonlySet<string>): string {
  return first(blocked, !eligible ? ELIGIBLE_FIRST : '', !hereId ? 'Stand at a marked discovery landmark.' : '', hereId !== null && found.has(hereId) ? 'This discovery is already logged.' : '')
}
export const penaltyReason = (blocked: string, eligible: boolean, atSports: boolean): string => first(blocked, !eligible ? ELIGIBLE_FIRST : '', !atSports ? 'Go to the Sports Centre first.' : '')
export const quizReason = (blocked: string, atUnion: boolean, eligible: boolean): string => first(blocked, !atUnion ? 'Go to Student Union first.' : '', !eligible ? ELIGIBLE_FIRST : '')

/** The programme a student studies, else the one last chosen. */
export const programmeChoice = (student: { programme?: { id: ProgrammeId } | null } | null | undefined, chosen: ProgrammeId): ProgrammeId => student?.programme?.id || chosen
