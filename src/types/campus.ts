/**
 * The UNILAG campus (src/campus/unilag), as types: three systems registered after `growth`
 * (systems/index.js), in this order:
 *
 *   unilagStudent    student.js   admission, the two compressed semesters, the hostel, campus jobs
 *   unilagCommunity  games.js     clubs, the discovery trail, the faculty quiz, penalties, the student vote
 *   unilagShuttle    shuttle.js   the paid ride between campus stops
 *
 * Every shape is read off that system's `sanitize()`, its action handlers, the timed actions it
 * stores in `state.activeAction` and its `view()`. The venue itself ('unilag', scene kind 'unilag',
 * Lagos only) and its cast are content: see content.ts (VenueDefinition.cities, SpotDefinition.integration).
 *
 * The campus rules live OUTSIDE src/game, so two lists of registry.ts do not cover them: the events
 * the campus emits are `CampusEventMap` here (EVENT_NAMES is the list of src/game only).
 */
import type { ActionResponse } from './protocol.ts'
import type { CityGateErrorCode, ActionErrorCode, HostErrorCode, JsonBodyErrorCode, Ok, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'
import type { JobId, LagosDay, LagosWeek, Ms, PlayerPublicId, SkillId, SpotId } from './life.ts'
import type { NoPayload } from './actions.ts'
import type { TableGameId } from './growth.ts'

// ---- closed id sets -----------------------------------------------------------------------

/** Degree programmes (curriculum.js PROGRAMMES). */
export type ProgrammeId = 'eee' | 'computer' | 'mechanical' | 'civil' | 'english' | 'business' | 'economics'

/** The faculties of those programmes (games.js CAMPUS_FACULTIES): also the keys of the quiz question bank. */
export type CampusFaculty = 'Engineering' | 'Arts' | 'Management Sciences' | 'Social Sciences'

/**
 * Halls a room can be allocated in (student.js HOSTEL_HALLS, games.js CAMPUS_HALLS — the same list twice).
 * The venue spot of a hall is `<hall>-hall` (student.js allocatedHostelSpot).
 */
export type HostelHallId = 'moremi' | 'mariere' | 'eni-njoku' | 'jaja' | 'fagunwa'

/** Inventory items the hostel locker takes (student.js HOSTEL_STORAGE_ITEMS). */
export type HostelStorageItemId = 'rice' | 'garri' | 'sugar' | 'noodles' | 'eggs' | 'bread' | 'zobo' | 'plantain'

/** Paid campus jobs (student.js CAMPUS_JOBS). Not `JobId`: a campus job never becomes `state.job`. */
export type CampusJobId = 'library-assistant' | 'lab-assistant' | 'tutor'

/** Clubs (games.js CAMPUS_CLUBS). */
export type CampusClubId = 'robotics' | 'literary' | 'debate' | 'enterprise' | 'football'

/** Students' discovery spots (games.js CAMPUS_DISCOVERIES): each id is also the venue spot to stand at. */
export type CampusDiscoveryId = 'senate' | 'library' | 'lagoon-front' | 'sports-centre' | 'student-union'

/** Stops of the visitor trail (content.js DISCOVERY_TRAIL). An id is NOT always its spot ('new-hall' is at 'cafeteria'). */
export type TrailStopId = 'main-gate' | 'new-hall' | 'library' | 'engineering' | 'sports' | 'auditorium' | 'lagoon' | 'student-union'

/** The scored daily games (games.js GAME_IDS). */
export type CampusGameId = 'quiz' | 'discovery' | 'penalties'

/** Shuttle stops (shuttle.js SHUTTLE_STOPS): each id is also a venue spot. */
export type ShuttleStopId =
  | 'main-gate' | 'new-hall-shopping' | 'senate' | 'engineering' | 'sports-centre' | 'second-gate' | 'dli-building' | 'lagoon-front'

/** Weekly campus events (games.js eventsAt). */
export type CampusEventId = 'freshers' | 'quiz-night' | 'convocation'

/** Lecture slots (curriculum.js LECTURE_SLOTS). No course is taught in 'night': it is the catch-up class of every course. */
export type LectureSlotId = 'morning' | 'afternoon' | 'night'

/** A semester of the compressed degree. */
export type SemesterNumber = 1 | 2

/** A course id of the curriculum (`eee-101`, `mth-101-eee` …): an open set, validated against the programme's semester. */
export type CourseId = string

/** `ULG-<4 digits>-<6 digits>`, made at matriculation (student.js matriculate). */
export type StudentId = string

/** Letter grades and their points (student.js gradeOf). */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/**
 * Where a life is on the way to a degree (student.js STATUS). sanitize() DERIVES it from the rest of
 * the slice — graduated (two passed semesters), else studying/deferred (a term), matriculated (a
 * student id), admitted (a programme) — so only 'deferred' and 'dropped' are read from the save.
 */
export type StudentStatus = 'none' | 'admitted' | 'matriculated' | 'studying' | 'deferred' | 'dropped' | 'graduated'

// ---- curriculum and campus content --------------------------------------------------------

/** One lecture slot; `open` and `close` are minutes of the Lagos day. */
export interface LectureSlot {
  id: LectureSlotId
  open: number
  close: number
  label: string
}

export interface CourseDefinition {
  id: CourseId
  title: string
  credits: number
  /** The skill a finished lecture gives XP in. */
  skill: SkillId
  slot: Exclude<LectureSlotId, 'night'>
}

export interface SemesterDefinition {
  number: SemesterNumber
  courses: readonly CourseDefinition[]
}

export interface ProgrammeDefinition {
  id: ProgrammeId
  label: string
  faculty: CampusFaculty
  department: string
  /** The venue spot lectures, assignments and tests are taken at. */
  spot: SpotId
  /** The skill of the faculty quiz. */
  skill: SkillId
  /** The career track a degree in this programme helps in ('career.performance' +1), or null. */
  careerTrack: JobId | null
  /** Present on 'computer' only. */
  note?: string
  semesters: readonly SemesterDefinition[]
}

/** Every number of student life (curriculum.js UNILAG_BETA_RULES): naira, seconds, Lagos days, marks and grade points. */
export interface UnilagBetaRules {
  admissionFee: number
  tuition: number
  levy: number
  hostelFee: number
  hostelSleepSeconds: number
  hostelSleepEnergy: number
  semesterDays: number
  lectureSeconds: number
  assessmentSeconds: number
  campusJobSeconds: number
  lectureXp: number
  attendanceMaximumDays: number
  attendanceWeight: number
  assignmentWeight: number
  examWeight: number
  graduationCgpa: number
  scholarshipCgpa: number
  scholarshipAward: number
}

export interface CampusJobDefinition {
  id: CampusJobId
  label: string
  /** The venue spot the job is done at. */
  spot: SpotId
  /** Naira, credited when the job finishes. */
  pay: number
}

export interface CampusClubDefinition {
  id: CampusClubId
  label: string
  spot: SpotId
}

export interface CampusDiscoveryDefinition {
  id: CampusDiscoveryId
  label: string
  /** The skill that gets 3 XP when it is found. */
  skill: SkillId
}

/** One stop of the visitor trail (content.js DISCOVERY_TRAIL). */
export interface TrailStopDefinition {
  id: TrailStopId
  label: string
  description: string
  venue: 'unilag'
  spot: SpotId
}

/**
 * A Student Union table (games.js STUDENT_UNION_TABLES): the 'unilag' rows of the one table registry
 * (src/tables/places.js), so `id` is a table id of the shared table framework (growth.ts TableSummary.id).
 */
export interface StudentUnionTable {
  id: string
  label: string
  spot: 'student-union'
  game: TableGameId
  seats: number
}

/** A quiz question as a player may see it: never the answer (games.js QUIZ_QUESTIONS). */
export interface QuizQuestion {
  id: string
  prompt: string
  options: readonly { id: string; label: string }[]
}

/** A campus event that is on (games.js eventsAt). `startsAt` and `endsAt` are server ms. */
export interface CampusEvent {
  id: CampusEventId
  label: string
  startsAt: Ms
  endsAt: Ms
  tags: string[]
  beta: true
}

// ---- unilagStudent: state -----------------------------------------------------------------

/** One course of a closed semester. `total = attendanceMark + assignment + exam`; grade and points follow from it. */
export interface CourseResult {
  courseId: CourseId
  credits: number
  /** Different Lagos days with an OFFICIAL lecture attended, at most attendanceMaximumDays. */
  attendanceDays: number
  /** 0 … attendanceWeight. */
  attendanceMark: number
  /** 0 … assignmentWeight; 0 when the assignment was never done. */
  assignment: number
  /** 0 … examWeight (the test). */
  exam: number
  total: number
  grade: Grade
  /** 5 (A) … 0 (F). */
  points: number
}

/** One closed semester attempt. A failed attempt (`passed` false) is registered again. At most MAX_ATTEMPTS (6) in all. */
export interface SemesterRecord {
  semester: SemesterNumber
  /** 1-based attempt at this semester. */
  attempt: number
  startedDay: LagosDay
  closedDay: LagosDay
  /** One per course of the semester, in curriculum order. */
  courseResults: CourseResult[]
  /** Credit-weighted grade points, two decimals. */
  gpa: number
  /** `gpa >= graduationCgpa`. */
  passed: boolean
  /** The one scholarship of a life was paid for this semester. */
  scholarshipAwarded: boolean
}

/** A course's two assessments: null until done, then the score the server rolled. */
export interface AssessmentState {
  assignment: number | null
  test: number | null
}

/** The registered semester. Every record below has exactly the semester's course ids as keys. */
export interface ActiveTerm {
  semester: SemesterNumber
  attempt: number
  startDay: LagosDay
  /** Lagos days the semester was paused for, at most MAX_DEFERRED_DAYS (365). */
  deferredDays: number
  /** `startDay + semesterDays + deferredDays`: lectures stop and the semester can be closed from this day. */
  deadlineDay: LagosDay
  registeredCourses: CourseId[]
  /** Lagos days an official lecture was attended on, ascending. */
  attendance: Record<CourseId, LagosDay[]>
  /** Lectures and night classes finished, at most MAX_STUDY_SESSIONS (28). */
  study: Record<CourseId, number>
  assessments: Record<CourseId, AssessmentState>
  /** The Lagos day the semester was deferred on; null unless `status` is 'deferred'. */
  deferredAtDay: LagosDay | null
}

/** A room for one semester attempt. `room` is 100–499. */
export interface HostelAllocation {
  semester: SemesterNumber
  attempt: number
  hall: HostelHallId
  room: number
}

export interface HostelState {
  /** At most one per semester attempt; emptied by 'unilag.drop'. */
  allocations: HostelAllocation[]
  /** The locker: at most HOSTEL_STORAGE_LIMIT (20) items over all kinds; a kind at 0 has no key. */
  storage: Partial<Record<HostelStorageItemId, number>>
}

/** What a new application does NOT reset. */
export interface StudentLifetime {
  scholarshipPaid: boolean
  /** Lagos days a campus job was paid on (one a day), ascending, the last 35. */
  campusJobDays: LagosDay[]
}

export interface UnilagStudentState {
  status: StudentStatus
  programme: ProgrammeId | null
  studentId: StudentId | null
  admittedDay: LagosDay | null
  /** Applications paid for, at most 100. */
  applicationCount: number
  /** Null unless `status` is 'studying' or 'deferred'. */
  term: ActiveTerm | null
  /** Closed semesters, oldest first. */
  records: SemesterRecord[]
  hostel: HostelState
  lifetime: StudentLifetime
}

/** OWNER campus (student.js). */
export interface UnilagStudentSlice {
  unilagStudent: UnilagStudentState
}

/** An earned degree (student.js graduationOf): both semesters passed and the CGPA over them at least graduationCgpa. */
export interface Degree {
  programme: ProgrammeId
  faculty: CampusFaculty
  cgpa: number
  skill: SkillId
  careerTrack: JobId | null
}

// ---- unilagCommunity: state ---------------------------------------------------------------

/** Who a score was made as, so the weekly leaderboards credit the faculty and hall of that day. */
export interface CampusTeam {
  studentId: StudentId
  faculty: CampusFaculty
  /** The hall of the current semester's room, or null without one. */
  hall: HostelHallId | null
}

/** One Lagos day of campus games. */
export interface CommunityDay {
  day: LagosDay
  /** The score of each game played that day: quiz 2 or 10, discovery 5, penalties 0–5. A game not played has no key. */
  games: Partial<Record<CampusGameId, number>>
  /** The key exists only once a game was scored that day (games.js scoreEvent, normalizedDay). */
  teams?: Partial<Record<CampusGameId, CampusTeam>>
  /** The Aluta volunteering activity was finished that day. */
  volunteered: boolean
}

/** The faculty question being answered. Dropped at a load unless it is today's, for the life's current faculty. */
export interface PendingQuiz {
  day: LagosDay
  faculty: CampusFaculty
  questionId: string
  startedAt: Ms
}

export interface UnilagCommunityState {
  /** At most CAMPUS_GAME_RULES.maxClubs (3). */
  clubs: CampusClubId[]
  discoveries: CampusDiscoveryId[]
  /** Trail stops visited, in visiting order. */
  trail: TrailStopId[]
  /** The last CAMPUS_GAME_RULES.keptDays (14) days with a record, ascending. */
  days: CommunityDay[]
  quiz: PendingQuiz | null
  /** Lagos weeks this life stood in / voted in (the last 8 each); the ballot itself is in the server's shared store. */
  elections: { nominated: LagosWeek[]; voted: LagosWeek[] }
}

/** OWNER campus (games.js). */
export interface UnilagCommunitySlice {
  unilagCommunity: UnilagCommunityState
}

// ---- unilagShuttle: state -----------------------------------------------------------------

export interface UnilagShuttleState {
  /** Completed rides. */
  rides: number
}

/** OWNER campus (shuttle.js). */
export interface UnilagShuttleSlice {
  unilagShuttle: UnilagShuttleState
}

// ---- timed actions ------------------------------------------------------------------------

interface CampusActionBase {
  /** Total length in seconds. */
  duration: number
  /** Seconds still to run. */
  remaining: number
}

interface CampusStudyBase extends CampusActionBase {
  kind: 'campus-study'
  /** The Lagos day and the minute of that day the task was started at. */
  startedDay: LagosDay
  startedMinute: number
}

/** A lecture ('official': in the course's slot, counts for attendance) or the night class (study only). */
export interface LectureAction extends CampusStudyBase {
  task: 'lecture'
  id: CourseId
  semester: SemesterNumber
  session: 'official' | 'night'
}

/** An assignment or a test: the score is rolled by the server when it finishes. */
export interface AssessmentAction extends CampusStudyBase {
  task: 'assignment' | 'test'
  id: CourseId
  semester: SemesterNumber
}

/** A paid campus job; the pay is credited on completion, once per Lagos day (`startedDay`). */
export interface CampusJobAction extends CampusStudyBase {
  task: 'job'
  id: CampusJobId
}

/** Sleeping in the allocated hostel room. */
export interface HostelSleepAction extends CampusStudyBase {
  task: 'sleep'
  id: 'hostel-sleep'
}

/**
 * Kind 'campus-study' (student.js): one kind for four different tasks, told apart by `task`.
 * `semester` exists only on a lecture, an assignment and a test; `session` only on a lecture.
 * Never moves the player; no cancel hook, so a cancel always goes through and nothing is given back
 * (nothing was charged at the start).
 */
export type CampusStudyAction = LectureAction | AssessmentAction | CampusJobAction | HostelSleepAction

/** Kind 'campus-game' (games.js): the penalty shoot-out; the five kicks are rolled on completion. */
export interface CampusGameAction extends CampusActionBase {
  kind: 'campus-game'
  id: 'football-penalties'
  /** The Lagos day the score counts for. */
  day: LagosDay
}

/**
 * Kind 'campus-shuttle' (shuttle.js): a ride between two stops. Declared `moves: false` — the player
 * stays in the venue and only the spot changes on arrival. A cancel goes through; the fare is kept.
 */
export interface CampusShuttleAction extends CampusActionBase {
  kind: 'campus-shuttle'
  /** The destination stop; always equal to `dest`. */
  id: ShuttleStopId
  /** The stop boarded at (the spot the player still stands at during the ride). */
  origin: ShuttleStopId
  dest: ShuttleStopId
  /** Server ms of boarding. */
  start: Ms
}

/** The timed actions the campus adds to `ActiveAction`. */
export type CampusActiveAction = CampusStudyAction | CampusGameAction | CampusShuttleAction

// ---- actions ------------------------------------------------------------------------------

/** Not standing at the campus spot a step is done at (student.js campusSpot, games.js campusSpotBlock). */
type WrongPlace = 'wrong_place'

/** Starting a lecture, an assignment or a test (student.js studyCourse): the codes all three share. */
type StudyFail = 'busy' | 'deferred' | 'not_registered' | 'invalid_course' | WrongPlace

/**
 * The campus actions, in registration order. They are part of `ActionMap` (actions.ts).
 *
 * A guest of the quick start is refused the student ones with 'settle_required' before the handler
 * runs (onboarding.js GUEST_CAMPUS): see `GuestCampusActionType`. The trail, the clubs, the quiz, the
 * discoveries, the penalties and the shuttle are not vetoed — the first four still need a student.
 */
export interface CampusActionMap {
  // -- unilagStudent --
  /**
   * At the Senate spot: pay the admission fee and be admitted. 'already_applied' (any status but
   * 'none' and 'dropped') is a success that changes nothing. Needs Coding or Charisma level 1.
   */
  'unilag.apply': {
    payload: { programme: ProgrammeId }
    ok: 'admitted' | 'already_applied'
    fail: 'busy' | WrongPlace | 'invalid_programme' | 'skill_required' | 'application_limit' | 'insufficient_funds'
  }
  /** At the Senate spot: get a student id. 'already_matriculated' is a success. */
  'unilag.matriculate': { payload: NoPayload; ok: 'matriculated' | 'already_matriculated'; fail: 'busy' | WrongPlace | 'not_admitted' }
  /** Before the first semester is registered only. Works anywhere. */
  'unilag.change-programme': { payload: { programme: ProgrammeId }; ok: 'programme_changed' | 'programme_unchanged'; fail: 'busy' | 'invalid_programme' | 'programme_locked' }
  /**
   * Pay tuition and levy for the next semester. `courses` must name every course of that semester
   * exactly once. 'already_registered' (a term exists) is a success. Works anywhere.
   */
  'unilag.register-semester': {
    payload: { courses: CourseId[] }
    ok: 'registered' | 'already_registered'
    fail: 'busy' | 'matriculation_required' | 'programme_complete' | 'attempt_limit' | 'courses_required' | 'insufficient_funds'
  }
  /** At the programme's spot, in the course's slot or the night class (timed action kind 'campus-study'). */
  'unilag.lecture': { payload: { course: CourseId }; ok: 'started'; fail: StudyFail | 'semester_closed' | 'study_limit' | 'lecture_closed' }
  /** Once per course per semester (kind 'campus-study'). */
  'unilag.assignment': { payload: { course: CourseId }; ok: 'started'; fail: StudyFail | 'already_completed' }
  /** Once per course per semester (kind 'campus-study'); every test must be done before the semester closes. */
  'unilag.test': { payload: { course: CourseId }; ok: 'started'; fail: StudyFail | 'already_completed' }
  /**
   * From the deadline day on: grade the semester. All three ok codes close it; 'semester_failed'
   * means it must be registered again. 'balance_limit': the scholarship could not be credited.
   * INCONSISTENT: 'deferred' is a failure code here and on the three study actions, and the success
   * code of 'unilag.defer'.
   */
  'unilag.close-semester': {
    payload: NoPayload
    ok: 'graduated' | 'semester_passed' | 'semester_failed'
    fail: 'busy' | 'not_registered' | 'deferred' | 'semester_running' | 'tests_required' | 'balance_limit'
  }
  /** Pause the semester's deadline. */
  'unilag.defer': { payload: NoPayload; ok: 'deferred'; fail: 'busy' | 'not_studying' }
  'unilag.resume': { payload: NoPayload; ok: 'resumed'; fail: 'busy' | 'not_deferred' | 'defer_limit' }
  /** Leave the programme: records, term and rooms go; nothing is refunded; the locker's contents stay. */
  'unilag.drop': { payload: NoPayload; ok: 'dropped'; fail: 'busy' | 'not_enrolled' }
  /** At the Senate spot: pay for a room for the registered semester attempt. 'already_allocated' is a success. */
  'unilag.hostel.allocate': {
    payload: { hall: HostelHallId }
    ok: 'hostel_allocated' | 'already_allocated'
    fail: 'busy' | WrongPlace | 'not_registered' | 'invalid_hall' | 'insufficient_funds'
  }
  /**
   * At the allocated hall's spot (kind 'campus-study', task 'sleep').
   * INCONSISTENT: the place is checked before the allocation (student.js:499-503), and without an
   * allocation the expected spot is 'senate', so a student without a room is told 'wrong_place'
   * everywhere except at the Senate, where the answer is 'hostel_required'. The same on 'unilag.hostel.store'.
   */
  'unilag.hostel.sleep': { payload: NoPayload; ok: 'started'; fail: 'busy' | WrongPlace | 'hostel_required' }
  /** At the allocated hall's spot: move `count` (1–20) of one item between the inventory and the locker. */
  'unilag.hostel.store': {
    payload: { item: HostelStorageItemId; count: number; direction: 'in' | 'out' }
    ok: 'stored' | 'withdrawn'
    fail: 'busy' | WrongPlace | 'hostel_required' | 'invalid_item' | 'invalid_count' | 'invalid_direction' | 'storage_full' | 'missing_items' | 'inventory_full'
  }
  /** At the job's spot, one paid job per Lagos day (kind 'campus-study', task 'job'). */
  'unilag.job': { payload: { id: CampusJobId }; ok: 'started'; fail: 'busy' | 'invalid_job' | 'student_required' | WrongPlace | 'campus_job_done' | 'balance_limit' }

  // -- unilagCommunity --
  /** Works anywhere. 'already_joined' is a success. */
  'unilag.club.join': { payload: { id: CampusClubId }; ok: 'joined' | 'already_joined'; fail: 'student_required' | 'invalid_club' | 'club_limit' }
  /** No student check: a life that dropped out can still leave. */
  'unilag.club.leave': { payload: { id: CampusClubId }; ok: 'left'; fail: 'invalid_club' | 'not_member' }
  /** Record the trail stop at the spot the player stands at. Open to visitors and guests. */
  'unilag.trail.visit': { payload: NoPayload; ok: 'trail_visited'; fail: 'busy' | WrongPlace | 'not_trail_stop' | 'already_visited' }
  /**
   * At the Student Union spot during quiz night: draw one question of the life's faculty.
   * INCONSISTENT: 'quiz_started' is both the success code (games.js:226) and the failure code for
   * "a question is already waiting" (games.js:221); only `ok` tells them apart.
   */
  'unilag.quiz.start': { payload: NoPayload; ok: 'quiz_started'; fail: 'busy' | 'student_required' | WrongPlace | 'quiz_closed' | 'daily_limit' | 'quiz_started' }
  /** `answer` is an option id of the waiting question. Both ok codes record the day's score. No place or busy check. */
  'unilag.quiz.answer': { payload: { answer: string }; ok: 'correct' | 'incorrect'; fail: 'student_required' | 'no_quiz' | 'quiz_invalidated' | 'invalid_answer' | 'daily_limit' }
  /** Log the discovery of the spot the player stands at: one a Lagos day, each once. */
  'unilag.discovery': { payload: NoPayload; ok: 'discovered'; fail: 'student_required' | 'nothing_here' | 'daily_limit' | 'already_discovered' }
  /** At the Sports Centre spot, once a Lagos day (timed action kind 'campus-game'). */
  'unilag.penalties': { payload: NoPayload; ok: 'started'; fail: 'busy' | 'student_required' | WrongPlace | 'daily_limit' }
  /** SERVER ONLY (POST /api/campus/nominate): record that this life stands in this week's election. Monday to Wednesday. */
  'unilag.election.nominate': { payload: NoPayload; ok: 'nominated'; fail: 'student_required' | 'nominations_closed' | 'already_candidate'; serverOnly: true }
  /** SERVER ONLY (POST /api/campus/vote): record that this life voted this week. Thursday to Saturday. `candidate` is a public id. */
  'unilag.election.vote': { payload: { candidate: string }; ok: 'voted'; fail: 'student_required' | 'polls_closed' | 'invalid_candidate' | 'already_voted'; serverOnly: true }

  // -- unilagShuttle --
  /**
   * Board at a shuttle stop for another one; the fare is charged at once and not refunded (kind 'campus-shuttle').
   * INCONSISTENT: the only campus action outside the `unilag.` namespace, and it answers
   * 'wrong_venue' / 'wrong_stop' where every other campus action answers 'wrong_place'.
   */
  'campus-shuttle': {
    payload: { destination: ShuttleStopId }
    ok: 'started'
    fail: 'busy' | 'wrong_venue' | 'wrong_stop' | 'invalid_destination' | 'route_unavailable' | 'insufficient_funds'
  }
}

export type CampusActionType = keyof CampusActionMap

/**
 * The campus actions a guest of the quick start is refused with 'settle_required'
 * (onboarding.js GUEST_CAMPUS): becoming or being a student, the hostel, campus jobs and the student vote.
 */
export type GuestCampusActionType = Extract<
  CampusActionType,
  | 'unilag.apply' | 'unilag.matriculate' | 'unilag.change-programme' | 'unilag.register-semester' | 'unilag.lecture'
  | 'unilag.assignment' | 'unilag.test' | 'unilag.close-semester' | 'unilag.defer' | 'unilag.resume' | 'unilag.drop' | 'unilag.job'
  | `unilag.hostel.${string}` | `unilag.election.${string}`
>

/** Vetoes the community system contributes through 'activity.block', for the 'unilag-volunteer' activity only. */
export type CampusActivityVetoCode = 'student_required' | 'daily_limit'

// ---- events -------------------------------------------------------------------------------

/**
 * Events the campus emits through `emit(state, '<name>', data, ctx)`. No system listens to any of
 * them. They are NOT in registry.ts `EngineEventMap` / EVENT_NAMES, which list the events of src/game.
 * (The community system LISTENS to 'activity.completed', and the shuttle arrives through
 * api.arrive(), which emits 'travel.arrived' with `mode: 'campus-shuttle'`.)
 */
export interface CampusEventMap {
  /** Emitted by 'unilag.close-semester' when it answers 'graduated'. */
  'campus.graduated': Degree
  /** A campus job was paid. */
  'campus.job.completed': { job: CampusJobId; pay: number; day: LagosDay }
  /** A daily game was scored. */
  'campus.game.scored': CampusTeam & { game: CampusGameId; score: number; day: LagosDay }
  /** The Aluta volunteering activity finished for a current student; `tags` are the activity's. */
  'campus.volunteered': CampusTeam & { day: LagosDay; tags: string[] }
  /** The last stop of the visitor trail was recorded. */
  'campus.trail.completed': { count: number }
  'campus.election.nominated': CampusTeam & { week: LagosWeek }
  'campus.election.voted': CampusTeam & { week: LagosWeek; candidate: string }
}

export type CampusEngineEvent = keyof CampusEventMap

// ---- views --------------------------------------------------------------------------------

/** A course of the registered semester with this life's progress in it. */
export interface CourseProgress extends CourseDefinition, AssessmentState {
  /** Official lectures attended (days). */
  attendance: number
  /** Lectures and night classes finished. */
  study: number
}

/**
 * `view.unilagStudent` (student.js view): the whole slice, with `programme` replaced by the
 * programme's card, plus the derived degree, the courses of the registered semester and the rules.
 * INCONSISTENT: `hostel`, `term`, `records` and `lifetime` are the STATE objects themselves, not copies.
 */
export interface UnilagStudentView extends Omit<UnilagStudentState, 'programme'> {
  programme: Pick<ProgrammeDefinition, 'id' | 'label' | 'faculty' | 'department' | 'spot'> | null
  degree: Degree | null
  /** Empty without a registered semester. */
  courses: CourseProgress[]
  betaRules: UnilagBetaRules
  campusJobs: CampusJobDefinition[]
}

/** `view.unilagCommunity` (games.js view). */
export interface UnilagCommunityView {
  clubs: (CampusClubDefinition & { joined: boolean })[]
  discoveries: (CampusDiscoveryDefinition & { found: boolean })[]
  tables: readonly StudentUnionTable[]
  /** Campus events on right now. */
  events: CampusEvent[]
  /** The waiting faculty question, without its answer. */
  quiz: { question: QuizQuestion; faculty: CampusFaculty } | null
  /** Today's record (the stored object when there is one, otherwise an empty one). */
  today: CommunityDay
  trail: { found: number; total: number; complete: boolean; shareText: string }
  /** A current student (matriculated, studying or deferred): may play the student games. */
  eligible: boolean
}

/** `view.unilagShuttle` (shuttle.js view). */
export interface UnilagShuttleView {
  /** Naira per ride. */
  fare: number
  /** The sentence saying the route is a game rule, not a real timetable. */
  source: string
  stops: { id: ShuttleStopId; label: string }[]
  /** The running ride, or null. */
  active: { origin: ShuttleStopId; destination: ShuttleStopId; refundable: false } | null
}

// ---- HTTP: /api/campus (server/routes/campus.js) ---------------------------------------------------
//
// The shared half of the campus: the weekly Student Union election (kept in the `campus`
// collection of the server's store) and the leaderboards, which are computed on every read from
// the stored lives of Lagos. Lagos only.

/** games.js electionPhaseAt: Monday–Wednesday, Thursday–Saturday, Sunday. */
export type ElectionPhase = 'nominations' | 'voting' | 'results'

/** A candidate with their votes, most votes first (games.js electionStandings). */
export interface CampusCandidate {
  /** The candidate's public id. */
  id: PlayerPublicId
  studentId: StudentId
  name: string
  faculty: CampusFaculty
  hall: HostelHallId | null
  /** Server ms of the nomination. */
  at: Ms
  votes: number
}

/** The week's election as the server keeps it (games.js sanitizeCampusElection): `db.campus.election`. */
export interface CampusElectionRecord {
  week: LagosWeek
  candidates: Omit<CampusCandidate, 'votes'>[]
  ballots: { studentId: StudentId; candidateId: PlayerPublicId; at: Ms }[]
  winner: { id: PlayerPublicId; votes: number } | null
}

/** A faculty or a hall on the weekly leaderboard (games.js campusTeamStandings). `id` is the faculty or hall. */
export interface CampusTeamStanding {
  id: string
  score: number
  /** Different lives that scored for it. */
  members: number
}

/** A player on the weekly leaderboard (games.js campusLeaderboardStandings, plus the display name). */
export interface CampusPlayerStanding {
  id: PlayerPublicId
  studentId: StudentId
  score: number
  /** Game results counted. */
  results: number
  name: string
}

/** What GET /api/campus answers for Lagos, and what both writes add to their action result. */
export interface CampusSummary {
  available: true
  city: 'lagos'
  /** `winner` is null until the phase is 'results', and when nobody got a vote. */
  election: { week: LagosWeek; phase: ElectionPhase; candidates: CampusCandidate[]; winner: { id: PlayerPublicId; votes: number } | null }
  leaderboards: { faculty: CampusTeamStanding[]; hall: CampusTeamStanding[]; players: CampusPlayerStanding[] }
  /** The week's shared volunteering goal: one count per life per day. */
  goal: { progress: number; target: number; complete: boolean }
}

/** What GET /api/campus answers for any other city (no session needed). */
export interface CampusUnavailable {
  available: false
  reason: string
  election: null
  leaderboards: { faculty: []; hall: []; players: [] }
  goal: null
}

/** Why the shared ballot refused a write (games.js nominateCampusElection / voteCampusElection): 409 with a `reason`; the action is undone. */
export type CampusElectionErrorCode =
  | 'invalid_time' | 'stale_election' | 'nominations_closed' | 'polls_closed' | 'student_required' | 'already_candidate' | 'ballot_full'
  | 'already_voted' | 'invalid_candidate' | 'ballot_limit'

/** A campus write: the life's own action answer (`ok`, `code`, `state`, `reason?`) and the summary afterwards. */
export type CampusWriteResponse = ActionResponse & CampusSummary

type CampusWriteErrors =
  | HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode | ActionErrorCode
  | 'campus_lagos_only' | 'campus_rate_limited' | CampusElectionErrorCode

export interface CampusHttpRoutes {
  /** 90 a minute per player (429 `campus_rate_limited`). Any `city` but 'lagos' answers CampusUnavailable, without a session. */
  'GET /api/campus': {
    query: { city: string }
    response: Ok<CampusSummary | CampusUnavailable>
    errors: HostErrorCode | SessionErrorCode | 'campus_rate_limited'
  }
  /** Runs 'unilag.election.nominate' with server authority and puts the caller on the ballot. 400 `campus_lagos_only` for another city. */
  'POST /api/campus/nominate': { body: { cityId: 'lagos'; actionId: TimedId }; response: CampusWriteResponse; errors: CampusWriteErrors }
  /** Runs 'unilag.election.vote' and casts the ballot. `candidateId` is a candidate's public id. */
  'POST /api/campus/vote': { body: { cityId: 'lagos'; actionId: TimedId; candidateId: PlayerPublicId }; response: CampusWriteResponse; errors: CampusWriteErrors }
}

// ---- runtime lists (checked against the campus code by engine.test.ts) ---------------------------

/** Every event name emitted in src/campus/unilag, sorted. */
export const CAMPUS_EVENT_NAMES = [
  'campus.election.nominated', 'campus.election.voted', 'campus.game.scored', 'campus.graduated', 'campus.job.completed',
  'campus.trail.completed', 'campus.volunteered',
] as const satisfies readonly CampusEngineEvent[]

/** The campus action types, in registration order (student, community, shuttle). */
export const CAMPUS_ACTION_TYPES = [
  'unilag.apply', 'unilag.matriculate', 'unilag.change-programme', 'unilag.register-semester', 'unilag.lecture', 'unilag.assignment',
  'unilag.test', 'unilag.close-semester', 'unilag.defer', 'unilag.resume', 'unilag.drop', 'unilag.hostel.allocate',
  'unilag.hostel.sleep', 'unilag.hostel.store', 'unilag.job',
  'unilag.club.join', 'unilag.club.leave', 'unilag.trail.visit', 'unilag.quiz.start', 'unilag.quiz.answer', 'unilag.discovery',
  'unilag.penalties', 'unilag.election.nominate', 'unilag.election.vote',
  'campus-shuttle',
] as const satisfies readonly CampusActionType[]

/** The campus actions a guest is refused with 'settle_required': the members of CAMPUS_ACTION_TYPES that onboarding.js GUEST_CAMPUS matches. */
export const GUEST_CAMPUS_ACTIONS = [
  'unilag.apply', 'unilag.matriculate', 'unilag.change-programme', 'unilag.register-semester', 'unilag.lecture', 'unilag.assignment',
  'unilag.test', 'unilag.close-semester', 'unilag.defer', 'unilag.resume', 'unilag.drop', 'unilag.hostel.allocate',
  'unilag.hostel.sleep', 'unilag.hostel.store', 'unilag.job', 'unilag.election.nominate', 'unilag.election.vote',
] as const satisfies readonly GuestCampusActionType[]
