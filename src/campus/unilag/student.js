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
import { emit } from '../../game/registry.ts';
import { addItem, addSkillXp, canAfford, canCredit, changeNeeds, countItem, credit, debit, removeItems, skillLevel } from '../../game/api.ts';
import { busy, fail, isRecord, naira, ok, safeCount } from '../../game/util.ts';
import { lagosTime } from '../../game/clock.ts';
import { LECTURE_SLOTS, PROGRAMMES, UNILAG_BETA_RULES, courseOf, programmeOf, semesterOf } from './curriculum.js';

/** @typedef {{id:string,label:string,faculty:string,department:string,spot:string,skill:string,careerTrack:string|null,semesters:ReadonlyArray<{number:number,courses:ReadonlyArray<Course>}>}} Programme */
/** @typedef {{id:string,title:string,credits:number,skill:string,slot:string}} Course */
/** @typedef {{courseId:string,credits:number,attendanceDays:number,attendanceMark:number,assignment:number,exam:number,total:number,grade:string,points:number}} CourseResult */
/** @typedef {{semester:number,attempt:number,startedDay:number,closedDay:number,courseResults:CourseResult[],gpa:number,passed:boolean,scholarshipAwarded:boolean}} SemesterRecord */
/** @typedef {{assignment:number|null,test:number|null}} AssessmentState */
/** @typedef {{semester:number,attempt:number,startDay:number,deferredDays:number,deadlineDay:number,registeredCourses:string[],attendance:Record<string,number[]>,study:Record<string,number>,assessments:Record<string,AssessmentState>,deferredAtDay:number|null}} ActiveTerm */
/** @typedef {{semester:number,attempt:number,hall:string,room:number}} HostelAllocation */
/** @typedef {{allocations:HostelAllocation[],storage:Record<string,number>}} HostelState */
/** @typedef {{scholarshipPaid:boolean,campusJobDays:number[]}} StudentLifetime */
/** @typedef {{status:string,programme:string|null,studentId:string|null,admittedDay:number|null,applicationCount:number,term:ActiveTerm|null,records:SemesterRecord[],hostel:HostelState,lifetime:StudentLifetime}} StudentState */
/** @typedef {{kind:string,id:string,duration:number,remaining:number,task:string,semester?:number,startedDay:number,startedMinute:number,session?:string}} CampusActiveTask */
/** @typedef {{now?:number,rng:()=>number}} StudentActionContext */
/** @typedef {{t:number,location:string,spot:string,cash:number,unilagStudent:StudentState,activeAction:CampusActiveTask|null,[key:string]:any}} GameState Shared core life state; the index signature covers state owned by other systems. */
/** @typedef {{ok:boolean,code:string,state:GameState,[key:string]:any}} ActionResult */

export const CAMPUS_VENUE = 'unilag';
export const CAMPUS_STUDY_KIND = 'campus-study';
export const MAX_ATTEMPTS = 6;
export const MAX_STUDY_SESSIONS = 28;
export const MAX_DEFERRED_DAYS = 365;
export const HOSTEL_HALLS = Object.freeze(['moremi', 'mariere', 'eni-njoku', 'jaja', 'fagunwa']);
export const HOSTEL_STORAGE_ITEMS = Object.freeze(['rice', 'garri', 'sugar', 'noodles', 'eggs', 'bread', 'zobo', 'plantain']);
export const HOSTEL_STORAGE_LIMIT = 20;
export const CAMPUS_JOBS = Object.freeze({
  'library-assistant': Object.freeze({ id: 'library-assistant', label: 'Library assistant', spot: 'library', pay: 150 }),
  'lab-assistant': Object.freeze({ id: 'lab-assistant', label: 'Lab assistant', spot: 'engineering', pay: 200 }),
  tutor: Object.freeze({ id: 'tutor', label: 'Peer tutor', spot: 'library', pay: 250 }),
});

const STATUS = new Set(['none', 'admitted', 'matriculated', 'studying', 'deferred', 'dropped', 'graduated']);
/** @param {*} value @returns {boolean} */
const safeDay = (value) => Number.isSafeInteger(value) && value >= 0;
/** @param {*} value @param {number} max @returns {number} */
const boundedCount = (value, max) => (safeCount(value) ? Math.min(value, max) : 0);
/** @param {GameState} state @param {StudentActionContext} [ctx] @returns {number} */
const nowOf = (state, ctx) => Number.isFinite(ctx?.now) ? ctx.now : state.t;
/** @param {GameState} state @param {StudentActionContext} [ctx] @returns {number} */
const todayOf = (state, ctx) => lagosTime(nowOf(state, ctx)).day;
/** @param {GameState} state @returns {StudentState} */
const studentOf = (state) => state.unilagStudent;
/** @param {*} value @param {string[]} expected @returns {boolean} */
const sameMembers = (value, expected) => Array.isArray(value) && value.length === expected.length
  && new Set(value).size === expected.length && expected.every((id) => value.includes(id));
/** @param {number} value @returns {number} */
const round2 = (value) => Math.round(value * 100) / 100;

/** @param {number} total @returns {{grade:string,points:number}} */
export function gradeOf(total) {
  if (total >= 70) return { grade: 'A', points: 5 };
  if (total >= 60) return { grade: 'B', points: 4 };
  if (total >= 50) return { grade: 'C', points: 3 };
  if (total >= 45) return { grade: 'D', points: 2 };
  if (total >= 40) return { grade: 'E', points: 1 };
  return { grade: 'F', points: 0 };
}

/** @param {CourseResult[]} courseResults @returns {number} */
const resultCgpa = (courseResults) => {
  const credits = courseResults.reduce((sum, result) => sum + result.credits, 0);
  const quality = courseResults.reduce((sum, result) => sum + result.points * result.credits, 0);
  return credits ? round2(quality / credits) : 0;
};

/** @param {SemesterRecord[]} records @param {number} semester @returns {SemesterRecord|undefined} */
function passedRecord(records, semester) {
  return records.findLast((record) => record.semester === semester && record.passed);
}

/** @param {StudentState|null|undefined} student @returns {{programme:string,faculty:string,cgpa:number,skill:string,careerTrack:string|null}|null} */
export function graduationOf(student) {
  if (!student || !programmeOf(student.programme)) return null;
  const first = passedRecord(student.records || [], 1), second = passedRecord(student.records || [], 2);
  if (!first || !second) return null;
  const programme = PROGRAMMES[student.programme];
  const courses = [...first.courseResults, ...second.courseResults];
  const cgpa = resultCgpa(courses);
  if (cgpa < UNILAG_BETA_RULES.graduationCgpa) return null;
  return { programme: programme.id, faculty: programme.faculty, cgpa, skill: programme.skill, careerTrack: programme.careerTrack };
}

/** @param {SemesterRecord[]} records @returns {number|null} */
function nextSemester(records) {
  if (!passedRecord(records, 1)) return 1;
  if (!passedRecord(records, 2)) return 2;
  return null;
}

/** @returns {StudentState} */
function freshStudent() {
  return {
    status: 'none', programme: null, studentId: null, admittedDay: null, applicationCount: 0,
    term: null, records: [],
    hostel: { allocations: [], storage: {} },
    lifetime: { scholarshipPaid: false, campusJobDays: [] },
  };
}

/** @param {*} value @param {Course} course @returns {CourseResult|null} */
function normalizeCourseResult(value, course) {
  if (!isRecord(value) || value.courseId !== course.id || value.credits !== course.credits) return null;
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

/** @param {*} value @param {Programme} programme @param {SemesterRecord[]} records @returns {SemesterRecord|null} */
function normalizeRecord(value, programme, records) {
  if (!isRecord(value) || !Number.isInteger(value.semester) || value.semester !== nextSemester(records)) return null;
  const semester = semesterOf(programme.id, value.semester);
  if (!semester || !Array.isArray(value.courseResults) || value.courseResults.length !== semester.courses.length) return null;
  const byId = new Map(value.courseResults.filter(isRecord).map((result) => [result.courseId, result]));
  if (byId.size !== semester.courses.length) return null;
  const courseResults = semester.courses.map((course) => normalizeCourseResult(byId.get(course.id), course));
  if (courseResults.some((result) => !result)) return null;
  const gpa = resultCgpa(courseResults), passed = gpa >= UNILAG_BETA_RULES.graduationCgpa;
  if (!safeDay(value.startedDay) || !safeDay(value.closedDay) || value.closedDay < value.startedDay + UNILAG_BETA_RULES.semesterDays) return null;
  return {
    semester: value.semester,
    attempt: boundedCount(value.attempt, MAX_ATTEMPTS) || records.filter((record) => record.semester === value.semester).length + 1,
    startedDay: value.startedDay, closedDay: value.closedDay, courseResults, gpa, passed,
    scholarshipAwarded: value.scholarshipAwarded === true && passed && gpa >= UNILAG_BETA_RULES.scholarshipCgpa,
  };
}

/** @param {*} value @param {Programme} programme @returns {SemesterRecord[]} */
function normalizeRecords(value, programme) {
  const records = [];
  for (const item of Array.isArray(value) ? value.slice(0, MAX_ATTEMPTS) : []) {
    const record = normalizeRecord(item, programme, records);
    if (!record) break;
    records.push(record);
    if (passedRecord(records, 2)) break;
  }
  return records;
}

/** @param {*} value @param {Programme} programme @param {SemesterRecord[]} records @param {string} savedStatus @returns {ActiveTerm|null} */
function normalizeTerm(value, programme, records, savedStatus) {
  if (!isRecord(value) || records.length >= MAX_ATTEMPTS) return null;
  const semesterNumber = nextSemester(records), semester = semesterOf(programme.id, semesterNumber);
  if (!semester || value.semester !== semesterNumber || !safeDay(value.startDay)) return null;
  const ids = semester.courses.map((course) => course.id);
  if (!sameMembers(value.registeredCourses, ids)) return null;
  const deferredDays = boundedCount(value.deferredDays, MAX_DEFERRED_DAYS);
  const attendance = {}, study = {}, assessments = {};
  for (const course of semester.courses) {
    const days = [...new Set((Array.isArray(value.attendance?.[course.id]) ? value.attendance[course.id] : [])
      .filter((day) => safeDay(day) && day >= value.startDay && day < value.startDay + UNILAG_BETA_RULES.semesterDays + deferredDays))]
      .slice(0, UNILAG_BETA_RULES.attendanceMaximumDays).sort((a, b) => a - b);
    attendance[course.id] = days;
    study[course.id] = boundedCount(value.study?.[course.id], MAX_STUDY_SESSIONS);
    const result = isRecord(value.assessments?.[course.id]) ? value.assessments[course.id] : {};
    assessments[course.id] = {
      assignment: Number.isSafeInteger(result.assignment) && result.assignment >= 0 && result.assignment <= UNILAG_BETA_RULES.assignmentWeight ? result.assignment : null,
      test: Number.isSafeInteger(result.test) && result.test >= 0 && result.test <= UNILAG_BETA_RULES.examWeight ? result.test : null,
    };
  }
  const deferredAtDay = savedStatus === 'deferred' && safeDay(value.deferredAtDay) ? value.deferredAtDay : null;
  return {
    semester: semesterNumber,
    attempt: records.filter((record) => record.semester === semesterNumber).length + 1,
    startDay: value.startDay,
    deferredDays,
    deadlineDay: value.startDay + UNILAG_BETA_RULES.semesterDays + deferredDays,
    registeredCourses: ids, attendance, study, assessments, deferredAtDay,
  };
}

/** @param {*} value @returns {HostelState} */
function normalizeHostel(value) {
  const saved = isRecord(value) ? value : {};
  const allocations = [];
  for (const item of Array.isArray(saved.allocations) ? saved.allocations.slice(0, MAX_ATTEMPTS) : []) {
    if (!isRecord(item) || !Number.isInteger(item.semester) || ![1, 2].includes(item.semester)
      || !Number.isInteger(item.attempt) || item.attempt < 1 || item.attempt > MAX_ATTEMPTS
      || !HOSTEL_HALLS.includes(item.hall) || !Number.isInteger(item.room) || item.room < 100 || item.room > 499) continue;
    if (!allocations.some((entry) => entry.semester === item.semester && entry.attempt === item.attempt)) {
      allocations.push({ semester: item.semester, attempt: item.attempt, hall: item.hall, room: item.room });
    }
  }
  const storage = {};
  let left = HOSTEL_STORAGE_LIMIT;
  for (const id of HOSTEL_STORAGE_ITEMS) {
    const count = boundedCount(saved.storage?.[id], left);
    if (count) { storage[id] = count; left -= count; }
  }
  return { allocations, storage };
}

/** @param {{unilagStudent?:unknown}} input @param {GameState} state @returns {void} */
function sanitize(input, state) {
  const saved = isRecord(input.unilagStudent) ? input.unilagStudent : {};
  const student = freshStudent();
  student.applicationCount = boundedCount(saved.applicationCount, 100);
  student.hostel = normalizeHostel(saved.hostel);
  const programme = programmeOf(saved.programme);
  if (programme) {
    student.programme = programme.id;
    student.admittedDay = safeDay(saved.admittedDay) ? saved.admittedDay : null;
    student.studentId = typeof saved.studentId === 'string' && /^ULG-[0-9]{4}-[0-9]{6}$/.test(saved.studentId) ? saved.studentId : null;
    student.records = normalizeRecords(saved.records, programme);
    student.term = student.studentId ? normalizeTerm(saved.term, programme, student.records, saved.status) : null;
  }
  const scholarshipInRecords = student.records.some((record) => record.scholarshipAwarded);
  const jobDays = [...new Set((Array.isArray(saved.lifetime?.campusJobDays) ? saved.lifetime.campusJobDays : []).filter(safeDay))]
    .sort((a, b) => a - b).slice(-35);
  student.lifetime = { scholarshipPaid: saved.lifetime?.scholarshipPaid === true || scholarshipInRecords, campusJobDays: jobDays };
  const degree = graduationOf(student);
  if (degree) student.status = 'graduated';
  else if (student.term) student.status = saved.status === 'deferred' ? 'deferred' : 'studying';
  else if (student.studentId) student.status = 'matriculated';
  else if (student.programme) student.status = 'admitted';
  else if (saved.status === 'dropped') student.status = 'dropped';
  if (!STATUS.has(student.status)) student.status = 'none';
  state.unilagStudent = student;
}

/** @param {GameState} state @param {string} spot @param {string} [label] @returns {ActionResult|null} */
function campusSpot(state, spot, label = 'this step') {
  if (state.location !== CAMPUS_VENUE || state.spot !== spot) {
    return fail(state, 'wrong_place', `Go to UNILAG and stand at ${spot.replaceAll('-', ' ')} before ${label}.`);
  }
  return null;
}

/** @param {GameState} state @param {{programme?:string}} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function application(state, payload, ctx) {
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

/** @param {GameState} state @param {*} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function matriculate(state, payload, ctx) {
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

/** @param {GameState} state @param {{programme?:string}} payload @returns {ActionResult} */
function changeProgramme(state, payload) {
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

/** @param {GameState} state @param {{courses?:string[]}} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function registerSemester(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state);
  if (student.term) return ok(state, 'already_registered');
  if (student.status !== 'matriculated') return fail(state, 'matriculation_required', 'Matriculate at Senate before registering courses.');
  const number = nextSemester(student.records), semester = semesterOf(student.programme, number);
  if (!semester) return fail(state, 'programme_complete', 'Both semesters are already complete.');
  if (student.records.length >= MAX_ATTEMPTS) return fail(state, 'attempt_limit', 'This compressed degree has reached its supported attempt limit.');
  const ids = semester.courses.map((course) => course.id);
  if (!sameMembers(payload?.courses, ids)) return fail(state, 'courses_required', `Register every semester ${number} course exactly once: ${ids.join(', ')}.`);
  const fees = UNILAG_BETA_RULES.tuition + UNILAG_BETA_RULES.levy;
  if (!canAfford(state, fees)) return fail(state, 'insufficient_funds', `Semester fees are ${naira(fees)}; you have ${naira(state.cash)}.`);
  debit(state, fees, `UNILAG semester ${number} tuition and levy`, ctx);
  const startDay = todayOf(state, ctx);
  const attendance = {}, study = {}, assessments = {};
  for (const course of semester.courses) { attendance[course.id] = []; study[course.id] = 0; assessments[course.id] = { assignment: null, test: null }; }
  student.term = { semester: number, attempt: student.records.filter((record) => record.semester === number).length + 1,
    startDay, deferredDays: 0, deadlineDay: startDay + UNILAG_BETA_RULES.semesterDays,
    registeredCourses: ids, attendance, study, assessments, deferredAtDay: null };
  student.status = 'studying';
  state.message = `Semester ${number} registered. It closes after ${UNILAG_BETA_RULES.semesterDays} Lagos calendar days.`;
  return ok(state, 'registered');
}

/** @param {Course} course @param {number} minute @returns {'official'|'night'|null} */
function lectureSession(course, minute) {
  const official = LECTURE_SLOTS[course.slot];
  if (minute >= official.open && minute < official.close) return 'official';
  if (minute >= LECTURE_SLOTS.night.open && minute < LECTURE_SLOTS.night.close) return 'night';
  return null;
}

/** @param {GameState} state @param {{course?:string}} payload @param {StudentActionContext} ctx @param {'lecture'|'assignment'|'test'} task @returns {ActionResult} */
function studyCourse(state, payload, ctx, task) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (student.status !== 'studying' || !term) return fail(state, student.status === 'deferred' ? 'deferred' : 'not_registered', student.status === 'deferred' ? 'Resume your semester before studying.' : 'Register the current semester before studying.');
  const course = courseOf(student.programme, term.semester, payload?.course);
  if (!course || !term.registeredCourses.includes(course.id)) return fail(state, 'invalid_course', 'Choose a registered course from the current semester.');
  const place = campusSpot(state, programmeOf(student.programme).spot, `starting ${task}`); if (place) return place;
  const time = lagosTime(nowOf(state, ctx));
  if (task === 'lecture' && time.day >= term.deadlineDay) return fail(state, 'semester_closed', 'The seven-day semester has ended. Complete its tests and close the semester.');
  let session = null;
  if (task === 'lecture') {
    if (term.study[course.id] >= MAX_STUDY_SESSIONS) return fail(state, 'study_limit', 'This course has reached its 28-session beta study limit.');
    session = lectureSession(course, time.minuteOfDay);
    if (!session) return fail(state, 'lecture_closed', `Study ${course.title} during its ${LECTURE_SLOTS[course.slot].label} lecture or the 8:00 PM to 10:00 PM night class.`);
  } else if (student.term.assessments[course.id][task] !== null) {
    return fail(state, 'already_completed', `You already completed this course ${task}.`);
  }
  const duration = task === 'lecture' ? UNILAG_BETA_RULES.lectureSeconds : UNILAG_BETA_RULES.assessmentSeconds;
  state.activeAction = { kind: CAMPUS_STUDY_KIND, id: course.id, duration, remaining: duration, task,
    semester: term.semester, startedDay: time.day, startedMinute: time.minuteOfDay, ...(session ? { session } : {}) };
  state.message = task === 'lecture' ? `${course.title}: ${session === 'official' ? 'lecture' : 'night class'} started.` : `${course.title} ${task} started.`;
  return ok(state, 'started');
}

/** @param {GameState} state @param {string} courseId @param {'assignment'|'test'} task @param {StudentActionContext} ctx @returns {number} */
function assessmentScore(state, courseId, task, ctx) {
  const term = studentOf(state).term;
  const attendance = term.attendance[courseId].length, study = Math.min(term.study[courseId], 7);
  if (task === 'assignment') return Math.min(UNILAG_BETA_RULES.assignmentWeight, 10 + attendance * 2 + study + Math.floor(ctx.rng() * 7));
  return Math.min(UNILAG_BETA_RULES.examWeight, 15 + attendance * 2 + study * 2 + Math.floor(ctx.rng() * 8));
}

/** @param {GameState} state @param {*} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function closeSemester(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (!term || !['studying', 'deferred'].includes(student.status)) return fail(state, 'not_registered', 'There is no registered semester to close.');
  if (student.status === 'deferred') return fail(state, 'deferred', 'Resume the semester before closing it.');
  const today = todayOf(state, ctx);
  if (today < term.deadlineDay) return fail(state, 'semester_running', `The semester closes in ${term.deadlineDay - today} Lagos day(s).`);
  const semester = semesterOf(student.programme, term.semester);
  const missing = semester.courses.filter((course) => term.assessments[course.id].test === null);
  if (missing.length) return fail(state, 'tests_required', `Complete every course test first: ${missing.map((course) => course.id).join(', ')}.`);
  const courseResults = semester.courses.map((course) => {
    const attendanceDays = term.attendance[course.id].length;
    const attendanceMark = Math.round(UNILAG_BETA_RULES.attendanceWeight * attendanceDays / UNILAG_BETA_RULES.attendanceMaximumDays);
    const assignment = term.assessments[course.id].assignment ?? 0, exam = term.assessments[course.id].test;
    const total = attendanceMark + assignment + exam;
    return { courseId: course.id, credits: course.credits, attendanceDays, attendanceMark, assignment, exam, total, ...gradeOf(total) };
  });
  const gpa = resultCgpa(courseResults), passed = gpa >= UNILAG_BETA_RULES.graduationCgpa;
  const award = passed && gpa >= UNILAG_BETA_RULES.scholarshipCgpa && !student.lifetime.scholarshipPaid;
  if (award && !canCredit(state, UNILAG_BETA_RULES.scholarshipAward)) return fail(state, 'balance_limit', 'Your balance cannot receive the scholarship award.');
  const record = { semester: term.semester, attempt: term.attempt, startedDay: term.startDay, closedDay: today, courseResults, gpa, passed, scholarshipAwarded: award };
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
    state.message = `Graduated from ${programmeOf(student.programme).label} with a ${degree.cgpa.toFixed(2)} CGPA.`;
    return ok(state, 'graduated');
  }
  state.message = passed ? `Semester ${record.semester} passed with a ${gpa.toFixed(2)} GPA.${award ? ` Scholarship: ${naira(UNILAG_BETA_RULES.scholarshipAward)}.` : ''}`
    : `Semester ${record.semester} GPA: ${gpa.toFixed(2)}. Register it again to reach the 2.00 pass mark.`;
  return ok(state, passed ? 'semester_passed' : 'semester_failed');
}

/** @param {GameState} state @param {*} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function deferSemester(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state);
  if (student.status !== 'studying' || !student.term) return fail(state, 'not_studying', 'Only an active registered semester can be deferred.');
  student.status = 'deferred'; student.term.deferredAtDay = todayOf(state, ctx);
  state.message = 'Semester deferred. Its deadline is paused until you resume.';
  return ok(state, 'deferred');
}

/** @param {GameState} state @param {*} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function resumeSemester(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), term = student.term;
  if (student.status !== 'deferred' || !term) return fail(state, 'not_deferred', 'There is no deferred semester to resume.');
  const paused = Math.max(0, todayOf(state, ctx) - term.deferredAtDay);
  if (term.deferredDays + paused > MAX_DEFERRED_DAYS) return fail(state, 'defer_limit', 'This semester has reached the supported one-year deferral limit.');
  term.deferredDays += paused; term.deadlineDay += paused; term.deferredAtDay = null; student.status = 'studying';
  state.message = `Semester resumed. The new closing day is Lagos day ${term.deadlineDay}.`;
  return ok(state, 'resumed');
}

/** @param {GameState} state @returns {ActionResult} */
function dropProgramme(state) {
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

/** @param {GameState} state @param {{hall?:string}} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function allocateHostel(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, 'senate', 'requesting hostel allocation'); if (place) return place;
  const student = studentOf(state), term = student.term;
  if (!term) return fail(state, 'not_registered', 'Register a semester before requesting hostel allocation.');
  if (!HOSTEL_HALLS.includes(payload?.hall)) return fail(state, 'invalid_hall', `Choose one of: ${HOSTEL_HALLS.join(', ')}.`);
  const existing = student.hostel.allocations.find((item) => item.semester === term.semester && item.attempt === term.attempt);
  if (existing) return ok(state, 'already_allocated');
  const fee = UNILAG_BETA_RULES.hostelFee;
  if (!canAfford(state, fee)) return fail(state, 'insufficient_funds', `The simulated hostel fee is ${naira(fee)}; you have ${naira(state.cash)}.`);
  debit(state, fee, `UNILAG hostel semester ${term.semester}`, ctx);
  const allocation = { semester: term.semester, attempt: term.attempt, hall: payload.hall, room: 100 + Math.floor(ctx.rng() * 400) };
  student.hostel.allocations.push(allocation);
  state.message = `${payload.hall.replaceAll('-', ' ')} hall, room ${allocation.room}. This is an in-game allocation, not a real UNILAG room booking.`;
  return ok(state, 'hostel_allocated');
}

/** @param {StudentState|null|undefined} student @returns {string} */
export function allocatedHostelSpot(student) {
  const allocation = student?.hostel?.allocations?.find(item => item.semester === student.term?.semester && item.attempt === student.term?.attempt);
  return allocation ? allocation.hall + '-hall' : 'senate';
}

/** @param {GameState} state @param {{item?:string,count?:number,direction?:string}} payload @returns {ActionResult} */
function hostelStore(state, payload) {
  const blocked = busy(state); if (blocked) return blocked;
  const place = campusSpot(state, allocatedHostelSpot(studentOf(state)), 'using hostel storage'); if (place) return place;
  const student = studentOf(state), term = student.term;
  if (!term || !student.hostel.allocations.some((item) => item.semester === term.semester && item.attempt === term.attempt)) {
    return fail(state, 'hostel_required', 'Get this semester’s hostel allocation before using its storage.');
  }
  const id = payload?.item, count = payload?.count, direction = payload?.direction;
  if (!HOSTEL_STORAGE_ITEMS.includes(id)) return fail(state, 'invalid_item', `Hostel storage accepts: ${HOSTEL_STORAGE_ITEMS.join(', ')}.`);
  if (!Number.isSafeInteger(count) || count <= 0 || count > HOSTEL_STORAGE_LIMIT) return fail(state, 'invalid_count', `Choose a whole count from 1 to ${HOSTEL_STORAGE_LIMIT}.`);
  if (!['in', 'out'].includes(direction)) return fail(state, 'invalid_direction', 'Choose direction "in" or "out".');
  const storage = student.hostel.storage;
  if (direction === 'in') {
    const total = Object.values(storage).reduce((sum, value) => sum + value, 0);
    if (total + count > HOSTEL_STORAGE_LIMIT) return fail(state, 'storage_full', `Hostel storage holds at most ${HOSTEL_STORAGE_LIMIT} items.`);
    if (countItem(state, id) < count) return fail(state, 'missing_items', `You do not have ${count} ${id.replaceAll('-', ' ')} to store.`);
    removeItems(state, { [id]: count }); storage[id] = (storage[id] ?? 0) + count;
  } else {
    if ((storage[id] ?? 0) < count) return fail(state, 'missing_items', `Hostel storage does not contain ${count} ${id.replaceAll('-', ' ')}.`);
    if (!addItem(state, id, count)) return fail(state, 'inventory_full', `Your inventory cannot receive ${count} ${id.replaceAll('-', ' ')}.`);
    storage[id] -= count; if (!storage[id]) delete storage[id];
  }
  state.message = direction === 'in' ? `Stored ${count} ${id.replaceAll('-', ' ')}.` : `Took ${count} ${id.replaceAll('-', ' ')} from storage.`;
  return ok(state, direction === 'in' ? 'stored' : 'withdrawn');
}

/** @param {GameState} state @param {*} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function hostelSleep(state, payload, ctx) {
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

/** @param {GameState} state @param {{id?:string}} payload @param {StudentActionContext} ctx @returns {ActionResult} */
function campusJob(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const student = studentOf(state), job = typeof payload?.id === 'string' && Object.hasOwn(CAMPUS_JOBS,payload.id) ? CAMPUS_JOBS[payload.id] : null;
  if (!job) return fail(state, 'invalid_job', `Choose one of: ${Object.keys(CAMPUS_JOBS).join(', ')}.`);
  if (!student.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status)) return fail(state, 'student_required', 'Matriculate as a current student before taking a campus job.');
  const place = campusSpot(state, job.spot, `starting the ${job.label} job`); if (place) return place;
  const day = todayOf(state, ctx);
  if (student.lifetime.campusJobDays.includes(day)) return fail(state, 'campus_job_done', 'You already completed one paid campus job this Lagos day.');
  if (!canCredit(state, job.pay)) return fail(state, 'balance_limit', 'Your balance cannot receive this campus-job pay.');
  state.activeAction = { kind: CAMPUS_STUDY_KIND, id: job.id, duration: UNILAG_BETA_RULES.campusJobSeconds,
    remaining: UNILAG_BETA_RULES.campusJobSeconds, task: 'job', startedDay: day, startedMinute: lagosTime(nowOf(state, ctx)).minuteOfDay };
  state.message = `${job.label} job started.`;
  return ok(state, 'started');
}

/** @param {*} value @param {GameState} state @returns {{task:string,semester?:number,startedDay:number,startedMinute:number,session?:string}|null} */
function sanitizeActive(value, state) {
  const student = studentOf(state);
  if (!['lecture', 'assignment', 'test', 'job', 'sleep'].includes(value.task) || !safeDay(value.startedDay)
    || !Number.isInteger(value.startedMinute) || value.startedMinute < 0 || value.startedMinute >= 1440) return null;
  if (value.task === 'sleep') {
    const term = student.term;
    if (!term || value.id !== 'hostel-sleep' || value.duration !== UNILAG_BETA_RULES.hostelSleepSeconds
      || state.location !== CAMPUS_VENUE || state.spot !== allocatedHostelSpot(student)
      || !student.hostel.allocations.some((item) => item.semester === term.semester && item.attempt === term.attempt)) return null;
    return { task: 'sleep', startedDay: value.startedDay, startedMinute: value.startedMinute };
  }
  if (value.task === 'job') {
    const job = Object.hasOwn(CAMPUS_JOBS, value.id) ? CAMPUS_JOBS[value.id] : null;
    if (!job || value.duration !== UNILAG_BETA_RULES.campusJobSeconds || state.location !== CAMPUS_VENUE || state.spot !== job.spot
      || !student.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status)
      || student.lifetime.campusJobDays.includes(value.startedDay)) return null;
    return { task: 'job', startedDay: value.startedDay, startedMinute: value.startedMinute };
  }
  const term = student.term, course = term && courseOf(student.programme, term.semester, value.id);
  if (!term || student.status !== 'studying' || !course || value.semester !== term.semester || state.location !== CAMPUS_VENUE || state.spot !== programmeOf(student.programme).spot
    || value.startedDay < term.startDay || (value.task === 'lecture' && value.startedDay >= term.deadlineDay)) return null;
  const duration = value.task === 'lecture' ? UNILAG_BETA_RULES.lectureSeconds : UNILAG_BETA_RULES.assessmentSeconds;
  if (value.duration !== duration) return null;
  if (value.task === 'lecture') {
    if (term.study[course.id] >= MAX_STUDY_SESSIONS) return null;
    const session = lectureSession(course, value.startedMinute);
    if (!session || value.session !== session) return null;
    return { task: value.task, semester: value.semester, startedDay: value.startedDay, startedMinute: value.startedMinute, session };
  }
  if (term.assessments[course.id][value.task] !== null) return null;
  return { task: value.task, semester: value.semester, startedDay: value.startedDay, startedMinute: value.startedMinute };
}

/** @param {GameState} state @param {{task:string,id:string,semester?:number,startedDay:number,session?:string}} active @param {StudentActionContext} ctx @returns {void} */
function completeActive(state, active, ctx) {
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
    if (term.study[course.id] >= MAX_STUDY_SESSIONS) return;
    term.study[course.id] = Math.min(MAX_STUDY_SESSIONS, term.study[course.id] + 1);
    const days = term.attendance[course.id];
    if (active.session === 'official' && !days.includes(active.startedDay) && days.length < UNILAG_BETA_RULES.attendanceMaximumDays) {
      days.push(active.startedDay); days.sort((a, b) => a - b);
    }
    addSkillXp(state, course.skill, UNILAG_BETA_RULES.lectureXp, ctx);
    state.message = active.session === 'official' ? `${course.title} lecture completed. Attendance recorded.` : `${course.title} night class completed. Study recorded without attendance.`;
    return;
  }
  const result = term.assessments[course.id];
  if (result[active.task] !== null) return;
  result[active.task] = assessmentScore(state, course.id, active.task, ctx);
  state.message = `${course.title} ${active.task} completed: ${result[active.task]}/${active.task === 'assignment' ? UNILAG_BETA_RULES.assignmentWeight : UNILAG_BETA_RULES.examWeight}.`;
}

export default {
  id: 'unilagStudent',
  stateKeys: ['unilagStudent'],
  sanitize,
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
  advance() {},
  view(state) {
    const student = studentOf(state), programme = programmeOf(student.programme), degree = graduationOf(student);
    const semester = student.term && semesterOf(student.programme, student.term.semester);
    return {
      ...student,
      degree,
      programme: programme ? { id: programme.id, label: programme.label, faculty: programme.faculty, department: programme.department, spot: programme.spot } : null,
      courses: semester ? semester.courses.map((course) => ({ ...course, attendance: student.term.attendance[course.id].length,
        study: student.term.study[course.id], ...student.term.assessments[course.id] })) : [],
      betaRules: UNILAG_BETA_RULES,
      campusJobs: Object.values(CAMPUS_JOBS),
    };
  },
};
