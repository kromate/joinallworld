/**
 * Server-authoritative UNILAG student life for Allworld.
 *
 * State from persistence and every action payload are untrusted. This module bounds and rebuilds
 * its whole slice, derives graduation from validated course results, and never accepts a client
 * score. A pure sanitizer cannot prove who wrote an otherwise valid save. The authoritative host
 * must keep using its trusted persistence boundary and keyed ctx.rng, just as the rules engine
 * requires for every wallet balance and timed reward.
 *
 * Actions: unilag.apply, unilag.matriculate, unilag.change-programme,
 * unilag.register-semester, unilag.lecture, unilag.assignment, unilag.test,
 * unilag.close-semester, unilag.defer, unilag.resume, unilag.drop,
 * unilag.hostel.allocate, unilag.hostel.sleep, unilag.hostel.store, unilag.job.
 *
 * Event: campus.graduated { programme, faculty, cgpa, skill, careerTrack }.
 * Modifier: career.performance adds one point to a positive shift gain when the current job
 * matches the career track of a degree earned through validated semester results.
 */
import { LEFT_OUT, PLAYS } from '../../game/profile.ts';
import { emit } from '../../game/registry.ts';
import { addItem, addSkillXp, canAfford, canCredit, changeNeeds, countItem, credit, debit, removeItems, skillLevel } from '../../game/api.ts';
import { busy, fail, isRecord, naira, ok, safeCount } from '../../game/util.ts';
import { lagosTime } from '../../game/clock.ts';
import type {
  ActiveTerm, AssessmentAction, AssessmentState, CampusJobAction, CampusJobDefinition, CampusJobId, CampusStudyAction, CourseDefinition,
  CourseId, CourseResult, Degree, Grade, HostelAllocation, HostelHallId, HostelState, HostelStorageItemId, HostelSleepAction,
  LectureAction, ProgrammeDefinition, SemesterNumber, SemesterRecord, UnilagStudentState, UnilagStudentView,
  CampusOutcome,
} from '../../types/campus.ts';
import type { ActionFailure, ActionOutcome, ActionSuccess, LagosDay, LifeContext, LifeState } from '../../types/life.ts';
import type { SavedActiveAction, SavedInput, SystemDefinition } from '../../types/registry.ts';
import { freshStudent } from './slices.ts';
import { LECTURE_SLOTS, PROGRAMMES, UNILAG_BETA_RULES, courseOf, programmeOf, semesterOf } from './curriculum.ts';

/** The fields a saved 'campus-study' action keeps: what ActiveKindHandler.sanitize returns. */
type StudyFields<A> = Omit<A, 'kind' | 'id' | 'duration' | 'remaining'>;
type SanitizedStudy = StudyFields<LectureAction> | StudyFields<AssessmentAction> | StudyFields<CampusJobAction> | StudyFields<HostelSleepAction>;

export const CAMPUS_VENUE = 'unilag';
export const CAMPUS_STUDY_KIND = 'campus-study';
export const MAX_ATTEMPTS = 6;
export const MAX_STUDY_SESSIONS = 28;
export const MAX_DEFERRED_DAYS = 365;
export const HOSTEL_HALLS: readonly HostelHallId[] = Object.freeze(['moremi', 'mariere', 'eni-njoku', 'jaja', 'fagunwa'] as const);
export const HOSTEL_STORAGE_ITEMS: readonly HostelStorageItemId[] = Object.freeze(['rice', 'garri', 'sugar', 'noodles', 'eggs', 'bread', 'zobo', 'plantain'] as const);
export const HOSTEL_STORAGE_LIMIT = 20;
export const CAMPUS_JOBS: Readonly<Record<CampusJobId, Readonly<CampusJobDefinition>>> = Object.freeze({
  'library-assistant': Object.freeze({ id: 'library-assistant', label: 'Library assistant', spot: 'library', pay: 150 }),
  'lab-assistant': Object.freeze({ id: 'lab-assistant', label: 'Lab assistant', spot: 'engineering', pay: 200 }),
  tutor: Object.freeze({ id: 'tutor', label: 'Peer tutor', spot: 'library', pay: 250 }),
} as const);

const STATUS = new Set<string>(['none', 'admitted', 'matriculated', 'studying', 'deferred', 'dropped', 'graduated']);
const safeDay = (value: unknown): value is LagosDay => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isInt = (value: unknown): value is number => Number.isInteger(value);
const asRecord = (value: unknown): value is Record<string, unknown> => isRecord(value);
/** `value` when it is a record, else an empty one: what `value?.[key]` read in the untyped original. */
const recordOf = (value: unknown): Record<string, unknown> => (asRecord(value) ? value : {});
const isHall = (value: unknown): value is HostelHallId => (HOSTEL_HALLS as readonly unknown[]).includes(value);
const isStorageItem = (value: unknown): value is HostelStorageItemId => (HOSTEL_STORAGE_ITEMS as readonly unknown[]).includes(value);
const isJobId = (value: unknown): value is CampusJobId => typeof value === 'string' && Object.hasOwn(CAMPUS_JOBS, value);
/** A record entry the state's invariants guarantee (every registered course has one); the untyped original would have thrown on a miss. */
const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new TypeError(`UNILAG student state is missing ${what}`);
  return value;
};
const boundedCount = (value: unknown, max: number): number => (typeof value === 'number' && safeCount(value) ? Math.min(value, max) : 0);
/** A safe integer 0 … max, else null. */
const scoreOrNull = (value: unknown, max: number): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null);
const nowOf = (state: LifeState, ctx?: { now?: number }): number => (ctx?.now !== undefined && Number.isFinite(ctx.now) ? ctx.now : state.t);
const todayOf = (state: LifeState, ctx?: { now?: number }): LagosDay => lagosTime(nowOf(state, ctx)).day;
const studentOf = (state: LifeState): UnilagStudentState => state.unilagStudent;
const sameMembers = (value: unknown, expected: string[]): value is CourseId[] => Array.isArray(value) && value.length === expected.length
  && new Set(value).size === expected.length && expected.every((id) => value.includes(id));
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function gradeOf(total: number): { grade: Grade; points: number } {
  if (total >= 70) return { grade: 'A', points: 5 };
  if (total >= 60) return { grade: 'B', points: 4 };
  if (total >= 50) return { grade: 'C', points: 3 };
  if (total >= 45) return { grade: 'D', points: 2 };
  if (total >= 40) return { grade: 'E', points: 1 };
  return { grade: 'F', points: 0 };
}

const resultCgpa = (courseResults: CourseResult[]): number => {
  const credits = courseResults.reduce((sum, result) => sum + result.credits, 0);
  const quality = courseResults.reduce((sum, result) => sum + result.points * result.credits, 0);
  return credits ? round2(quality / credits) : 0;
};

function passedRecord(records: SemesterRecord[], semester: number): SemesterRecord | undefined {
  return records.findLast((record) => record.semester === semester && record.passed);
}

export function graduationOf(student: UnilagStudentState | null | undefined): Degree | null {
  if (!student) return null;
  const programme = programmeOf(student.programme);
  if (!programme) return null;
  const first = passedRecord(student.records || [], 1), second = passedRecord(student.records || [], 2);
  if (!first || !second) return null;
  const courses = [...first.courseResults, ...second.courseResults];
  const cgpa = resultCgpa(courses);
  if (cgpa < UNILAG_BETA_RULES.graduationCgpa) return null;
  return { programme: programme.id, faculty: programme.faculty, cgpa, skill: programme.skill, careerTrack: programme.careerTrack };
}

function nextSemester(records: SemesterRecord[]): SemesterNumber | null {
  if (!passedRecord(records, 1)) return 1;
  if (!passedRecord(records, 2)) return 2;
  return null;
}

function normalizeCourseResult(value: unknown, course: CourseDefinition): CourseResult | null {
  if (!asRecord(value) || value.courseId !== course.id || value.credits !== course.credits) return null;
  const attendanceDays = boundedCount(value.attendanceDays, UNILAG_BETA_RULES.attendanceMaximumDays);
  const attendanceMark = Math.round(UNILAG_BETA_RULES.attendanceWeight * attendanceDays / UNILAG_BETA_RULES.attendanceMaximumDays);
  const assignment = boundedCount(value.assignment, UNILAG_BETA_RULES.assignmentWeight);
  const exam = boundedCount(value.exam, UNILAG_BETA_RULES.examWeight);
  const total = attendanceMark + assignment + exam;
  const grade = gradeOf(total);
  if (value.attendanceDays !== attendanceDays || value.attendanceMark !== attendanceMark || value.assignment !== assignment
    || value.exam !== exam || value.total !== total || value.grade !== grade.grade || value.points !== grade.points) return null;
  return { courseId: course.id, credits: course.credits, attendanceDays, attendanceMark, assignment, exam, total, ...grade };
}

function normalizeRecord(value: unknown, programme: ProgrammeDefinition, records: SemesterRecord[]): SemesterRecord | null {
  if (!asRecord(value) || !isInt(value.semester)) return null;
  const semesterNumber = nextSemester(records);
  // value.semester is an integer: it equals the (non-null) next semester or the record is refused.
  if (semesterNumber === null || value.semester !== semesterNumber) return null;
  const semester = semesterOf(programme.id, semesterNumber);
  const rawResults = value.courseResults;
  if (!semester || !Array.isArray(rawResults) || rawResults.length !== semester.courses.length) return null;
  const byId = new Map<unknown, Record<string, unknown>>(rawResults.filter(asRecord).map((result) => [result.courseId, result]));
  if (byId.size !== semester.courses.length) return null;
  const courseResults: CourseResult[] = [];
  for (const course of semester.courses) {
    const result = normalizeCourseResult(byId.get(course.id), course);
    if (!result) return null;
    courseResults.push(result);
  }
  const gpa = resultCgpa(courseResults), passed = gpa >= UNILAG_BETA_RULES.graduationCgpa;
  const startedDay = value.startedDay, closedDay = value.closedDay;
  if (!safeDay(startedDay) || !safeDay(closedDay) || closedDay < startedDay + UNILAG_BETA_RULES.semesterDays) return null;
  return {
    semester: semesterNumber,
    attempt: boundedCount(value.attempt, MAX_ATTEMPTS) || records.filter((record) => record.semester === semesterNumber).length + 1,
    startedDay, closedDay, courseResults, gpa, passed,
    scholarshipAwarded: value.scholarshipAwarded === true && passed && gpa >= UNILAG_BETA_RULES.scholarshipCgpa,
  };
}

function normalizeRecords(value: unknown, programme: ProgrammeDefinition): SemesterRecord[] {
  const records: SemesterRecord[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, MAX_ATTEMPTS) : []) {
    const record = normalizeRecord(item, programme, records);
    if (!record) break;
    records.push(record);
    if (passedRecord(records, 2)) break;
  }
  return records;
}

function normalizeTerm(value: unknown, programme: ProgrammeDefinition, records: SemesterRecord[], savedStatus: unknown): ActiveTerm | null {
  if (!asRecord(value) || records.length >= MAX_ATTEMPTS) return null;
  const semesterNumber = nextSemester(records), semester = semesterOf(programme.id, semesterNumber);
  const startDay = value.startDay;
  if (semesterNumber === null || !semester || value.semester !== semesterNumber || !safeDay(startDay)) return null;
  const ids = semester.courses.map((course) => course.id);
  if (!sameMembers(value.registeredCourses, ids)) return null;
  const deferredDays = boundedCount(value.deferredDays, MAX_DEFERRED_DAYS);
  const attendance: Record<CourseId, LagosDay[]> = {}, study: Record<CourseId, number> = {}, assessments: Record<CourseId, AssessmentState> = {};
  const savedAttendance = recordOf(value.attendance), savedStudy = recordOf(value.study), savedAssessments = recordOf(value.assessments);
  for (const course of semester.courses) {
    const savedDays: unknown[] = Array.isArray(savedAttendance[course.id]) ? savedAttendance[course.id] as unknown[] : [];
    const days = [...new Set(savedDays
      .filter((day): day is number => safeDay(day) && day >= startDay && day < startDay + UNILAG_BETA_RULES.semesterDays + deferredDays))]
      .slice(0, UNILAG_BETA_RULES.attendanceMaximumDays).sort((a, b) => a - b);
    attendance[course.id] = days;
    study[course.id] = boundedCount(savedStudy[course.id], MAX_STUDY_SESSIONS);
    const result = recordOf(savedAssessments[course.id]);
    assessments[course.id] = {
      assignment: scoreOrNull(result.assignment, UNILAG_BETA_RULES.assignmentWeight),
      test: scoreOrNull(result.test, UNILAG_BETA_RULES.examWeight),
    };
  }
  const savedDeferredAt = value.deferredAtDay;
  const deferredAtDay = savedStatus === 'deferred' && safeDay(savedDeferredAt) ? savedDeferredAt : null;
  return {
    semester: semesterNumber,
    attempt: records.filter((record) => record.semester === semesterNumber).length + 1,
    startDay,
    deferredDays,
    deadlineDay: startDay + UNILAG_BETA_RULES.semesterDays + deferredDays,
    registeredCourses: ids, attendance, study, assessments, deferredAtDay,
  };
}

function normalizeHostel(value: unknown): HostelState {
  const saved = recordOf(value);
  const allocations: HostelAllocation[] = [];
  for (const item of Array.isArray(saved.allocations) ? saved.allocations.slice(0, MAX_ATTEMPTS) : []) {
    if (!asRecord(item) || (item.semester !== 1 && item.semester !== 2)
      || !isInt(item.attempt) || item.attempt < 1 || item.attempt > MAX_ATTEMPTS
      || !isHall(item.hall) || !isInt(item.room) || item.room < 100 || item.room > 499) continue;
    const { semester, attempt, hall, room } = item;
    if (!allocations.some((entry) => entry.semester === semester && entry.attempt === attempt)) {
      allocations.push({ semester, attempt, hall, room });
    }
  }
  const storage: HostelState['storage'] = {};
  const savedStorage = recordOf(saved.storage);
  let left = HOSTEL_STORAGE_LIMIT;
  for (const id of HOSTEL_STORAGE_ITEMS) {
    const count = boundedCount(savedStorage[id], left);
    if (count) { storage[id] = count; left -= count; }
  }
  return { allocations, storage };
}

function sanitize(input: SavedInput, state: LifeState): void {
  const saved = recordOf(input.unilagStudent);
  const student = freshStudent();
  student.applicationCount = boundedCount(saved.applicationCount, 100);
  student.hostel = normalizeHostel(saved.hostel);
  const programme = programmeOf(saved.programme);
  if (programme) {
    student.programme = programme.id;
    const admittedDay = saved.admittedDay;
    student.admittedDay = safeDay(admittedDay) ? admittedDay : null;
    student.studentId = typeof saved.studentId === 'string' && /^ULG-[0-9]{4}-[0-9]{6}$/.test(saved.studentId) ? saved.studentId : null;
    student.records = normalizeRecords(saved.records, programme);
    student.term = student.studentId ? normalizeTerm(saved.term, programme, student.records, saved.status) : null;
  }
  const scholarshipInRecords = student.records.some((record) => record.scholarshipAwarded);
  const savedLifetime = recordOf(saved.lifetime);
  const savedJobDays: unknown[] = Array.isArray(savedLifetime.campusJobDays) ? savedLifetime.campusJobDays : [];
  const jobDays = [...new Set(savedJobDays.filter(safeDay))]
    .sort((a, b) => a - b).slice(-35);
  student.lifetime = { scholarshipPaid: savedLifetime.scholarshipPaid === true || scholarshipInRecords, campusJobDays: jobDays };
  const degree = graduationOf(student);
  if (degree) student.status = 'graduated';
  else if (student.term) student.status = saved.status === 'deferred' ? 'deferred' : 'studying';
  else if (student.studentId) student.status = 'matriculated';
  else if (student.programme) student.status = 'admitted';
  else if (saved.status === 'dropped') student.status = 'dropped';
  if (!STATUS.has(student.status)) student.status = 'none';
  state.unilagStudent = student;
}

function campusSpot(state: LifeState, spot: string, label = 'this step'): ActionFailure<'wrong_place'> | null {
  if (state.location !== CAMPUS_VENUE || state.spot !== spot) {
    return fail(state, 'wrong_place', `Go to UNILAG and stand at ${spot.replaceAll('-', ' ')} before ${label}.`);
  }
  return null;
}

function application(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.apply'> {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, 'senate', 'applying'); if (place) return place;
  const student = studentOf(state), programme = programmeOf(payload?.programme);
  if (!programme) return fail(state, 'invalid_programme', `Choose one of: ${Object.keys(PROGRAMMES).join(', ')}.`);
  if (!['none', 'dropped'].includes(student.status)) return ok(state, 'already_applied');
  if (skillLevel(state, 'coding') < 1 && skillLevel(state, 'charisma') < 1) {
    return fail(state, 'skill_required', 'Admission requires Coding level 1 or Charisma level 1.');
  }
  if (student.applicationCount >= 100) return fail(state, 'application_limit', 'The saved application count has reached its supported limit.');
  const fee = UNILAG_BETA_RULES.admissionFee;
  if (!canAfford(state, fee)) return fail(state, 'insufficient_funds', `The application fee is ${naira(fee)}; you have ${naira(state.cash)}.`);
  debit(state, fee, 'UNILAG application fee', ctx);
  Object.assign(student, { status: 'admitted', programme: programme.id, studentId: null, admittedDay: todayOf(state, ctx), term: null, records: [], applicationCount: student.applicationCount + 1 });
  state.message = `Admitted to ${programme.label}. Matriculate at Senate before registering courses.`;
  return ok(state, 'admitted');
}

function matriculate(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.matriculate'> {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, 'senate', 'matriculating'); if (place) return place;
  const student = studentOf(state);
  if (student.status === 'matriculated' || student.status === 'studying' || student.status === 'deferred' || student.status === 'graduated') return ok(state, 'already_matriculated');
  if (student.status !== 'admitted' || !programmeOf(student.programme)) return fail(state, 'not_admitted', 'Apply and receive admission before matriculating.');
  const serial = Math.floor(ctx.rng() * 1000000);
  student.studentId = `ULG-${String(todayOf(state, ctx) % 10000).padStart(4, '0')}-${String(serial).padStart(6, '0')}`;
  student.status = 'matriculated';
  state.message = `Matriculation complete. Your Allworld student ID is ${student.studentId}.`;
  return ok(state, 'matriculated');
}

function changeProgramme(state: LifeState, payload: Record<string, unknown>): CampusOutcome<'unilag.change-programme'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), programme = programmeOf(payload?.programme);
  if (!programme) return fail(state, 'invalid_programme', `Choose one of: ${Object.keys(PROGRAMMES).join(', ')}.`);
  if (!['admitted', 'matriculated'].includes(student.status) || student.term || student.records.length) {
    return fail(state, 'programme_locked', 'Change programme before registering your first semester.');
  }
  if (student.programme === programme.id) return ok(state, 'programme_unchanged');
  student.programme = programme.id;
  state.message = `Programme changed to ${programme.label}. Your scholarship and campus-job limits are unchanged.`;
  return ok(state, 'programme_changed');
}

function registerSemester(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.register-semester'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state);
  if (student.term) return ok(state, 'already_registered');
  if (student.status !== 'matriculated') return fail(state, 'matriculation_required', 'Matriculate at Senate before registering courses.');
  const number = nextSemester(student.records), semester = semesterOf(student.programme, number);
  if (number === null || !semester) return fail(state, 'programme_complete', 'Both semesters are already complete.');
  if (student.records.length >= MAX_ATTEMPTS) return fail(state, 'attempt_limit', 'This compressed degree has reached its supported attempt limit.');
  const ids = semester.courses.map((course) => course.id);
  if (!sameMembers(payload?.courses, ids)) return fail(state, 'courses_required', `Register every semester ${number} course exactly once: ${ids.join(', ')}.`);
  const fees = UNILAG_BETA_RULES.tuition + UNILAG_BETA_RULES.levy;
  if (!canAfford(state, fees)) return fail(state, 'insufficient_funds', `Semester fees are ${naira(fees)}; you have ${naira(state.cash)}.`);
  debit(state, fees, `UNILAG semester ${number} tuition and levy`, ctx);
  const startDay = todayOf(state, ctx);
  const attendance: Record<CourseId, LagosDay[]> = {}, study: Record<CourseId, number> = {}, assessments: Record<CourseId, AssessmentState> = {};
  for (const course of semester.courses) { attendance[course.id] = []; study[course.id] = 0; assessments[course.id] = { assignment: null, test: null }; }
  student.term = { semester: number, attempt: student.records.filter((record) => record.semester === number).length + 1,
    startDay, deferredDays: 0, deadlineDay: startDay + UNILAG_BETA_RULES.semesterDays,
    registeredCourses: ids, attendance, study, assessments, deferredAtDay: null };
  student.status = 'studying';
  state.message = `Semester ${number} registered. It closes after ${UNILAG_BETA_RULES.semesterDays} Lagos calendar days.`;
  return ok(state, 'registered');
}

function lectureSession(course: CourseDefinition, minute: number): 'official' | 'night' | null {
  const official = LECTURE_SLOTS[course.slot];
  if (minute >= official.open && minute < official.close) return 'official';
  if (minute >= LECTURE_SLOTS.night.open && minute < LECTURE_SLOTS.night.close) return 'night';
  return null;
}

function studyCourse(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, task: 'lecture'): CampusOutcome<'unilag.lecture'>;
function studyCourse(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, task: 'assignment'): CampusOutcome<'unilag.assignment'>;
function studyCourse(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, task: 'test'): CampusOutcome<'unilag.test'>;
function studyCourse(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, task: 'lecture' | 'assignment' | 'test'): CampusOutcome<'unilag.lecture' | 'unilag.assignment' | 'unilag.test'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (student.status !== 'studying' || !term) return fail(state, student.status === 'deferred' ? 'deferred' : 'not_registered', student.status === 'deferred' ? 'Resume your semester before studying.' : 'Register the current semester before studying.');
  const course = courseOf(student.programme, term.semester, payload?.course);
  if (!course || !term.registeredCourses.includes(course.id)) return fail(state, 'invalid_course', 'Choose a registered course from the current semester.');
  const place = campusSpot(state, must(programmeOf(student.programme), 'its programme').spot, `starting ${task}`); if (place) return place;
  const time = lagosTime(nowOf(state, ctx));
  if (task === 'lecture' && time.day >= term.deadlineDay) return fail(state, 'semester_closed', 'The seven-day semester has ended. Complete its tests and close the semester.');
  const duration = task === 'lecture' ? UNILAG_BETA_RULES.lectureSeconds : UNILAG_BETA_RULES.assessmentSeconds;
  if (task === 'lecture') {
    if (must(term.study[course.id], 'study count') >= MAX_STUDY_SESSIONS) return fail(state, 'study_limit', 'This course has reached its 28-session beta study limit.');
    const session = lectureSession(course, time.minuteOfDay);
    if (!session) return fail(state, 'lecture_closed', `Study ${course.title} during its ${LECTURE_SLOTS[course.slot].label} lecture or the 8:00 PM to 10:00 PM night class.`);
    state.activeAction = { kind: CAMPUS_STUDY_KIND, id: course.id, duration, remaining: duration, task,
      semester: term.semester, startedDay: time.day, startedMinute: time.minuteOfDay, session };
    state.message = `${course.title}: ${session === 'official' ? 'lecture' : 'night class'} started.`;
    return ok(state, 'started');
  }
  if (must(term.assessments[course.id], 'assessments')[task] !== null) {
    return fail(state, 'already_completed', `You already completed this course ${task}.`);
  }
  state.activeAction = { kind: CAMPUS_STUDY_KIND, id: course.id, duration, remaining: duration, task,
    semester: term.semester, startedDay: time.day, startedMinute: time.minuteOfDay };
  state.message = `${course.title} ${task} started.`;
  return ok(state, 'started');
}

function assessmentScore(term: ActiveTerm, courseId: CourseId, task: 'assignment' | 'test', ctx: LifeContext): number {
  const attendance = must(term.attendance[courseId], 'attendance').length, study = Math.min(must(term.study[courseId], 'study count'), 7);
  if (task === 'assignment') return Math.min(UNILAG_BETA_RULES.assignmentWeight, 10 + attendance * 2 + study + Math.floor(ctx.rng() * 7));
  return Math.min(UNILAG_BETA_RULES.examWeight, 15 + attendance * 2 + study * 2 + Math.floor(ctx.rng() * 8));
}

function closeSemester(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.close-semester'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (!term || !['studying', 'deferred'].includes(student.status)) return fail(state, 'not_registered', 'There is no registered semester to close.');
  if (student.status === 'deferred') return fail(state, 'deferred', 'Resume the semester before closing it.');
  const today = todayOf(state, ctx);
  if (today < term.deadlineDay) return fail(state, 'semester_running', `The semester closes in ${term.deadlineDay - today} day(s).`);
  const semester = must(semesterOf(student.programme, term.semester), 'its semester');
  const missing = semester.courses.filter((course) => must(term.assessments[course.id], 'assessments').test === null);
  if (missing.length) return fail(state, 'tests_required', `Complete every course test first: ${missing.map((course) => course.id).join(', ')}.`);
  const courseResults: CourseResult[] = semester.courses.map((course) => {
    const attendanceDays = must(term.attendance[course.id], 'attendance').length;
    const attendanceMark = Math.round(UNILAG_BETA_RULES.attendanceWeight * attendanceDays / UNILAG_BETA_RULES.attendanceMaximumDays);
    const assessment = must(term.assessments[course.id], 'assessments');
    // `missing` above guarantees every test has a score.
    const assignment = assessment.assignment ?? 0, exam = assessment.test ?? 0;
    const total = attendanceMark + assignment + exam;
    return { courseId: course.id, credits: course.credits, attendanceDays, attendanceMark, assignment, exam, total, ...gradeOf(total) };
  });
  const gpa = resultCgpa(courseResults), passed = gpa >= UNILAG_BETA_RULES.graduationCgpa;
  const award = passed && gpa >= UNILAG_BETA_RULES.scholarshipCgpa && !student.lifetime.scholarshipPaid;
  if (award && !canCredit(state, UNILAG_BETA_RULES.scholarshipAward)) return fail(state, 'balance_limit', 'Your balance cannot receive the scholarship award.');
  const record: SemesterRecord = { semester: term.semester, attempt: term.attempt, startedDay: term.startDay, closedDay: today, courseResults, gpa, passed, scholarshipAwarded: award };
  student.records.push(record);
  student.term = null;
  student.status = 'matriculated';
  if (award) {
    student.lifetime.scholarshipPaid = true;
    credit(state, UNILAG_BETA_RULES.scholarshipAward, 'UNILAG scholarship', ctx);
  }
  const degree = graduationOf(student);
  if (degree) {
    student.status = 'graduated';
    emit(state, 'campus.graduated', degree, ctx);
    state.message = `Graduated from ${must(programmeOf(student.programme), 'its programme').label} with a ${degree.cgpa.toFixed(2)} CGPA.`;
    return ok(state, 'graduated');
  }
  state.message = passed ? `Semester ${record.semester} passed with a ${gpa.toFixed(2)} GPA.${award ? ` Scholarship: ${naira(UNILAG_BETA_RULES.scholarshipAward)}.` : ''}`
    : `Semester ${record.semester} GPA: ${gpa.toFixed(2)}. Register it again to reach the 2.00 pass mark.`;
  return ok(state, passed ? 'semester_passed' : 'semester_failed');
}

function deferSemester(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.defer'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state);
  if (student.status !== 'studying' || !student.term) return fail(state, 'not_studying', 'Only an active registered semester can be deferred.');
  student.status = 'deferred'; student.term.deferredAtDay = todayOf(state, ctx);
  state.message = 'Semester deferred. Its deadline is paused until you resume.';
  return ok(state, 'deferred');
}

function resumeSemester(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.resume'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (student.status !== 'deferred' || !term) return fail(state, 'not_deferred', 'There is no deferred semester to resume.');
  // sanitize() stores null for a deferred term whose saved deferredAtDay is invalid: nothing is known to have been paused.
  const paused = term.deferredAtDay === null ? 0 : Math.max(0, todayOf(state, ctx) - term.deferredAtDay);
  if (term.deferredDays + paused > MAX_DEFERRED_DAYS) return fail(state, 'defer_limit', 'This semester has reached the supported one-year deferral limit.');
  term.deferredDays += paused; term.deadlineDay += paused; term.deferredAtDay = null; student.status = 'studying';
  state.message = `Semester resumed. The new closing day is day ${term.deadlineDay}.`;
  return ok(state, 'resumed');
}

function dropProgramme(state: LifeState): CampusOutcome<'unilag.drop'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state);
  if (!['admitted', 'matriculated', 'studying', 'deferred'].includes(student.status)) return fail(state, 'not_enrolled', 'There is no active UNILAG programme to drop.');
  Object.assign(student, { status: 'dropped', programme: null, studentId: null, admittedDay: null, term: null, records: [] });
  // A later application starts a new academic attempt and must pay for a new room. Stored items
  // remain bounded and retrievable after that allocation; the old room itself is no longer valid.
  student.hostel.allocations = [];
  state.message = 'Programme dropped. Paid fees and completed campus payouts are not reset or refunded.';
  return ok(state, 'dropped');
}

function allocateHostel(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.hostel.allocate'> {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, 'senate', 'requesting hostel allocation'); if (place) return place;
  const student = studentOf(state), term = student.term;
  if (!term) return fail(state, 'not_registered', 'Register a semester before requesting hostel allocation.');
  const hall = payload?.hall;
  if (!isHall(hall)) return fail(state, 'invalid_hall', `Choose one of: ${HOSTEL_HALLS.join(', ')}.`);
  const existing = student.hostel.allocations.find((item) => item.semester === term.semester && item.attempt === term.attempt);
  if (existing) return ok(state, 'already_allocated');
  const fee = UNILAG_BETA_RULES.hostelFee;
  if (!canAfford(state, fee)) return fail(state, 'insufficient_funds', `The simulated hostel fee is ${naira(fee)}; you have ${naira(state.cash)}.`);
  debit(state, fee, `UNILAG hostel semester ${term.semester}`, ctx);
  const allocation: HostelAllocation = { semester: term.semester, attempt: term.attempt, hall, room: 100 + Math.floor(ctx.rng() * 400) };
  student.hostel.allocations.push(allocation);
  state.message = `${hall.replaceAll('-', ' ')} hall, room ${allocation.room}. This is an in-game allocation, not a real UNILAG room booking.`;
  return ok(state, 'hostel_allocated');
}

export function allocatedHostelSpot(student: UnilagStudentState | null | undefined): string {
  const allocation = student?.hostel?.allocations?.find(item => item.semester === student.term?.semester && item.attempt === student.term?.attempt);
  return allocation ? allocation.hall + '-hall' : 'senate';
}

function hostelStore(state: LifeState, payload: Record<string, unknown>): CampusOutcome<'unilag.hostel.store'> {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, allocatedHostelSpot(studentOf(state)), 'using hostel storage'); if (place) return place;
  const student = studentOf(state), term = student.term;
  if (!term || !student.hostel.allocations.some((item) => item.semester === term.semester && item.attempt === term.attempt)) {
    return fail(state, 'hostel_required', 'Get this semester’s hostel allocation before using its storage.');
  }
  const id = payload?.item, count = payload?.count, direction = payload?.direction;
  if (!isStorageItem(id)) return fail(state, 'invalid_item', `Hostel storage accepts: ${HOSTEL_STORAGE_ITEMS.join(', ')}.`);
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0 || count > HOSTEL_STORAGE_LIMIT) return fail(state, 'invalid_count', `Choose a whole count from 1 to ${HOSTEL_STORAGE_LIMIT}.`);
  if (direction !== 'in' && direction !== 'out') return fail(state, 'invalid_direction', 'Choose direction "in" or "out".');
  const storage = student.hostel.storage;
  if (direction === 'in') {
    const total = Object.values(storage).reduce((sum, value) => sum + (value ?? 0), 0);
    if (total + count > HOSTEL_STORAGE_LIMIT) return fail(state, 'storage_full', `Hostel storage holds at most ${HOSTEL_STORAGE_LIMIT} items.`);
    if (countItem(state, id) < count) return fail(state, 'missing_items', `You do not have ${count} ${id.replaceAll('-', ' ')} to store.`);
    removeItems(state, { [id]: count }); storage[id] = (storage[id] ?? 0) + count;
  } else {
    if ((storage[id] ?? 0) < count) return fail(state, 'missing_items', `Hostel storage does not contain ${count} ${id.replaceAll('-', ' ')}.`);
    if (!addItem(state, id, count)) return fail(state, 'inventory_full', `Your inventory cannot receive ${count} ${id.replaceAll('-', ' ')}.`);
    storage[id] = (storage[id] ?? 0) - count; if (!storage[id]) delete storage[id];
  }
  state.message = direction === 'in' ? `Stored ${count} ${id.replaceAll('-', ' ')}.` : `Took ${count} ${id.replaceAll('-', ' ')} from storage.`;
  return ok(state, direction === 'in' ? 'stored' : 'withdrawn');
}

function hostelSleep(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.hostel.sleep'> {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, allocatedHostelSpot(studentOf(state)), 'sleeping'); if (place) return place;
  const student = studentOf(state), term = student.term;
  if (!term || !student.hostel.allocations.some((item) => item.semester === term.semester && item.attempt === term.attempt)) {
    return fail(state, 'hostel_required', 'Get this semester’s hostel allocation before sleeping there.');
  }
  const time = lagosTime(nowOf(state, ctx));
  state.activeAction = { kind: CAMPUS_STUDY_KIND, id: 'hostel-sleep', duration: UNILAG_BETA_RULES.hostelSleepSeconds,
    remaining: UNILAG_BETA_RULES.hostelSleepSeconds, task: 'sleep', startedDay: time.day, startedMinute: time.minuteOfDay };
  state.message = 'Hostel sleep started.';
  return ok(state, 'started');
}

function campusJob(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.job'> {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), jobId = payload?.id, job = isJobId(jobId) ? CAMPUS_JOBS[jobId] : null;
  if (!job) return fail(state, 'invalid_job', `Choose one of: ${Object.keys(CAMPUS_JOBS).join(', ')}.`);
  if (!student.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status)) return fail(state, 'student_required', 'Matriculate as a current student before taking a campus job.');
  const place = campusSpot(state, job.spot, `starting the ${job.label} job`); if (place) return place;
  const day = todayOf(state, ctx);
  if (student.lifetime.campusJobDays.includes(day)) return fail(state, 'campus_job_done', 'You already completed one paid campus job this day.');
  if (!canCredit(state, job.pay)) return fail(state, 'balance_limit', 'Your balance cannot receive this campus-job pay.');
  state.activeAction = { kind: CAMPUS_STUDY_KIND, id: job.id, duration: UNILAG_BETA_RULES.campusJobSeconds,
    remaining: UNILAG_BETA_RULES.campusJobSeconds, task: 'job', startedDay: day, startedMinute: lagosTime(nowOf(state, ctx)).minuteOfDay };
  state.message = `${job.label} job started.`;
  return ok(state, 'started');
}

function sanitizeActive(value: SavedActiveAction, state: LifeState): SanitizedStudy | null {
  const student = studentOf(state);
  const task = value.task, startedDay = value.startedDay, startedMinute = value.startedMinute;
  if ((task !== 'lecture' && task !== 'assignment' && task !== 'test' && task !== 'job' && task !== 'sleep') || !safeDay(startedDay)
    || !isInt(startedMinute) || startedMinute < 0 || startedMinute >= 1440) return null;
  if (task === 'sleep') {
    const term = student.term;
    if (!term || value.id !== 'hostel-sleep' || value.duration !== UNILAG_BETA_RULES.hostelSleepSeconds
      || state.location !== CAMPUS_VENUE || state.spot !== allocatedHostelSpot(student)
      || !student.hostel.allocations.some((item) => item.semester === term.semester && item.attempt === term.attempt)) return null;
    return { task: 'sleep', startedDay, startedMinute };
  }
  if (task === 'job') {
    const job = isJobId(value.id) ? CAMPUS_JOBS[value.id] : null;
    if (!job || value.duration !== UNILAG_BETA_RULES.campusJobSeconds || state.location !== CAMPUS_VENUE || state.spot !== job.spot
      || !student.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status)
      || student.lifetime.campusJobDays.includes(startedDay)) return null;
    return { task: 'job', startedDay, startedMinute };
  }
  const term = student.term, course = term && courseOf(student.programme, term.semester, value.id);
  if (!term || student.status !== 'studying' || !course || value.semester !== term.semester || state.location !== CAMPUS_VENUE || state.spot !== programmeOf(student.programme)?.spot
    || startedDay < term.startDay || (task === 'lecture' && startedDay >= term.deadlineDay)) return null;
  const duration = task === 'lecture' ? UNILAG_BETA_RULES.lectureSeconds : UNILAG_BETA_RULES.assessmentSeconds;
  if (value.duration !== duration) return null;
  if (task === 'lecture') {
    if (must(term.study[course.id], 'study count') >= MAX_STUDY_SESSIONS) return null;
    const session = lectureSession(course, startedMinute);
    if (!session || value.session !== session) return null;
    return { task, semester: term.semester, startedDay, startedMinute, session };
  }
  if (must(term.assessments[course.id], 'assessments')[task] !== null) return null;
  return { task, semester: term.semester, startedDay, startedMinute };
}

function completeActive(state: LifeState, active: CampusStudyAction, ctx: LifeContext): void {
  const student = studentOf(state);
  if (active.task === 'sleep') {
    changeNeeds(state, { energy: UNILAG_BETA_RULES.hostelSleepEnergy });
    state.message = `Hostel sleep completed. Energy +${UNILAG_BETA_RULES.hostelSleepEnergy}.`;
    return;
  }
  if (active.task === 'job') {
    const job = CAMPUS_JOBS[active.id];
    if (!job || student.lifetime.campusJobDays.includes(active.startedDay)) return;
    if (!canCredit(state, job.pay) || !credit(state, job.pay, `UNILAG ${job.label}`, ctx)) {
      state.message = `${job.label} finished, but your balance could not receive the pay.`;
      return;
    }
    student.lifetime.campusJobDays.push(active.startedDay);
    student.lifetime.campusJobDays = student.lifetime.campusJobDays.slice(-35);
    state.message = `${job.label} completed. You earned ${naira(job.pay)}.`;
    emit(state, 'campus.job.completed', { job: job.id, pay: job.pay, day: active.startedDay }, ctx);
    return;
  }
  const term = student.term, course = term && courseOf(student.programme, active.semester, active.id);
  if (!term || !course || term.semester !== active.semester) return;
  if (active.task === 'lecture') {
    if (must(term.study[course.id], 'study count') >= MAX_STUDY_SESSIONS) return;
    term.study[course.id] = Math.min(MAX_STUDY_SESSIONS, must(term.study[course.id], 'study count') + 1);
    const days = must(term.attendance[course.id], 'attendance');
    if (active.session === 'official' && !days.includes(active.startedDay) && days.length < UNILAG_BETA_RULES.attendanceMaximumDays) {
      days.push(active.startedDay); days.sort((a, b) => a - b);
    }
    addSkillXp(state, course.skill, UNILAG_BETA_RULES.lectureXp, ctx);
    state.message = active.session === 'official' ? `${course.title} lecture completed. Attendance recorded.` : `${course.title} night class completed. Study recorded without attendance.`;
    return;
  }
  const result = must(term.assessments[course.id], 'assessments');
  if (result[active.task] !== null) return;
  result[active.task] = assessmentScore(term, course.id, active.task, ctx);
  state.message = `${course.title} ${active.task} completed: ${result[active.task]}/${active.task === 'assignment' ? UNILAG_BETA_RULES.assignmentWeight : UNILAG_BETA_RULES.examWeight}.`;
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    'unilag.apply': application,
    'unilag.matriculate': matriculate,
    'unilag.change-programme': changeProgramme,
    'unilag.register-semester': registerSemester,
    'unilag.lecture': (state, payload, ctx) => studyCourse(state, payload, ctx, 'lecture'),
    'unilag.assignment': (state, payload, ctx) => studyCourse(state, payload, ctx, 'assignment'),
    'unilag.test': (state, payload, ctx) => studyCourse(state, payload, ctx, 'test'),
    'unilag.close-semester': closeSemester,
    'unilag.defer': deferSemester,
    'unilag.resume': resumeSemester,
    'unilag.drop': dropProgramme,
    'unilag.hostel.allocate': allocateHostel,
    'unilag.hostel.sleep': hostelSleep,
    'unilag.hostel.store': hostelStore,
    'unilag.job': campusJob,
  },
  advance() {},
} satisfies Pick<SystemDefinition<'unilagStudent'>, 'actions' | 'advance'> : LEFT_OUT;

export default {
  id: 'unilagStudent',
  stateKeys: ['unilagStudent'],
  sanitize,
  active: {
    [CAMPUS_STUDY_KIND]: {
      moves: false,
      sanitize: sanitizeActive,
      complete: completeActive,
    },
  },
  modifiers: {
    'career.performance'(value, state, data) {
      const degree = graduationOf(studentOf(state));
      return degree && data?.job === degree.careerTrack && Number.isFinite(value) && value > 0 ? value + 1 : value;
    },
  },
  view(state): UnilagStudentView {
    const student = studentOf(state), programme = programmeOf(student.programme), degree = graduationOf(student);
    const term = student.term;
    const semester = term ? semesterOf(student.programme, term.semester) : null;
    return {
      ...student,
      degree,
      programme: programme ? { id: programme.id, label: programme.label, faculty: programme.faculty, department: programme.department, spot: programme.spot } : null,
      courses: term && semester ? semester.courses.map((course) => ({ ...course, attendance: must(term.attendance[course.id], 'attendance').length,
        study: must(term.study[course.id], 'study count'), ...must(term.assessments[course.id], 'assessments') })) : [],
      betaRules: UNILAG_BETA_RULES,
      campusJobs: Object.values(CAMPUS_JOBS),
    };
  },
  ...play,
} satisfies SystemDefinition<'unilagStudent'>;
