import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch as dispatchTyped, advanceLife, viewLife } from '../../life.ts';
import { modify, registerSystem } from '../../game/registry.ts';
import { rebuildCatalogue } from '../../game/systems/activities.ts';
import { VENUES } from '../../game/cities/lagos/venues.ts';

import { xpForLevel } from '../../game/systems/skills.ts';
import { makeContext } from '../../game/util.ts';
import studentSystem, { CAMPUS_JOBS, HOSTEL_STORAGE_LIMIT, MAX_ATTEMPTS, graduationOf } from './student.ts';
import { UNILAG_VENUE } from './content.ts';
import { PROGRAMMES, UNILAG_BETA_RULES } from './curriculum.ts';
import type { ActiveTerm, CourseDefinition, ProgrammeId } from '../../types/campus.ts';
import type { ActionBody } from '../../types/actions.ts';
import type { LifeState } from '../../types/life.ts';
import type { LifeView } from '../../types/view.ts';

/** What the tests read of an action or settlement result. */
interface Outcome {
  ok: boolean;
  code: string;
  reason?: string;
}

interface Player {
  state: LifeState;
  readonly now: number;
  at(ms: number): Player;
  act(type: string, payload?: Record<string, unknown>): Outcome;
  step(seconds: number): Outcome;
  spot(id: string): Outcome;
  view(): LifeView;
}

/** The value, or a failed assertion: the test twin of a noUncheckedIndexedAccess guard. */
function present<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

/** The registered semester of a test life. */
const termOf = (state: LifeState): ActiveTerm => present(state.unilagStudent.term);

/** The courses of one semester (1-based) of a programme. */
const coursesOf = (programmeId: ProgrammeId, semesterNumber: number): readonly CourseDefinition[] => present(PROGRAMMES[programmeId].semesters[semesterNumber - 1]).courses;


const DAY = 86400000;
const HOUR = 3600000;
const START = Date.UTC(2026, 0, 5, 8); // Monday 9:00 AM in Lagos.

// Register the actual delivered venue in this isolated engine test process.
VENUES.unilag = UNILAG_VENUE;

const events: unknown[] = [];

registerSystem({
  id: 'unilagStudentTestProbe', stateKeys: [], sanitize() {}, actions: {}, advance() {},
  on: { 'campus.graduated': (_state: unknown, data: unknown) => events.push(structuredClone(data)) },
});
rebuildCatalogue('lagos');

function lagosAt(dayOffset: number, hour: number, minute = 0, second = 0): number {
  return START + dayOffset * DAY + (hour - 9) * HOUR + minute * 60000 + second * 1000;
}

function player(extra: Record<string, unknown> = {}): Player {
  let now = START, sequence = 0;
  const state = createLife({
    location: 'unilag', spot: 'senate', cash: 5000,
    skills: { coding: xpForLevel(1), charisma: 0 },
    inventory: { bread: 3, rice: 2 },
    ...extra,
  }, makeContext({ now, cityId: 'lagos', seed: 'create' })) 
  return {
    state,
    get now() { return now; },
    at(ms) { now = ms; return this; },
    act(type, payload = {}) {
      sequence += 1;
      return dispatchTyped(state, { type, payload, actionId: `student-${sequence}` } as ActionBody, makeContext({ now, cityId: 'lagos', seed: `action-${sequence}` }));
    },
    step(seconds) {
      now += seconds * 1000;
      sequence += 1;
      return advanceLife(state, seconds, makeContext({ now, cityId: 'lagos', seed: `settle-${sequence}` })) ;
    },
    spot(id) { return this.act('spot', { id }); },
    view() { return viewLife(state, makeContext({ now, cityId: 'lagos', seed: 'view' })) ; },
  };
}

function admitAndRegister(p: Player, programmeId: ProgrammeId = 'computer'): void {
  assert.equal(p.act('unilag.apply', { programme: programmeId }).code, 'admitted');
  assert.equal(p.act('unilag.matriculate').code, 'matriculated');
  const courses = coursesOf(programmeId, p.state.unilagStudent.records.length + 1).map((course) => course.id);
  assert.equal(p.act('unilag.register-semester', { courses }).code, 'registered');
}

function completeTimed(p: Player, type: string, payload: Record<string, unknown>, seconds: number): void {
  const started = p.act(type, payload);
  assert.equal(started.code, 'started', `${type} ${JSON.stringify(payload)}: ${started.reason ?? ''}`);
  assert.equal(p.step(seconds).code, 'completed');
}

function attendSemester(p: Player, programmeId: ProgrammeId, semesterNumber: number): void {
  const courses = coursesOf(programmeId, semesterNumber);
  assert.equal(p.spot(PROGRAMMES[programmeId].spot).code, 'selected');
  const startDay = termOf(p.state).startDay;
  for (let day = 0; day < UNILAG_BETA_RULES.semesterDays; day++) {
    for (const slot of ['morning', 'afternoon'] as const) {
      p.at(lagosAt(startDay - Math.floor((START + 3600000) / DAY) + day, slot === 'morning' ? 9 : 14, 10));
      for (const course of courses.filter((item) => item.slot === slot)) {
        completeTimed(p, 'unilag.lecture', { course: course.id }, UNILAG_BETA_RULES.lectureSeconds);
      }
    }
  }
  p.at(lagosAt(startDay - Math.floor((START + 3600000) / DAY) + 6, 16));
  for (const course of courses) {
    completeTimed(p, 'unilag.assignment', { course: course.id, score: 30 }, UNILAG_BETA_RULES.assessmentSeconds);
    completeTimed(p, 'unilag.test', { course: course.id, score: 50 }, UNILAG_BETA_RULES.assessmentSeconds);
  }
}

test('admission through graduation charges each fee once, ignores payload scores and emits a derived degree', () => {
  events.length = 0;
  const p = player();
  const opening = p.state.cash;
  assert.equal(p.act('unilag.apply', { programme: 'computer' }).code, 'admitted');
  assert.equal(p.state.cash, opening - UNILAG_BETA_RULES.admissionFee);
  assert.equal(p.act('unilag.apply', { programme: 'eee' }).code, 'already_applied');
  assert.equal(p.state.cash, opening - UNILAG_BETA_RULES.admissionFee, 'a replay cannot charge the application twice');
  assert.equal(p.act('unilag.matriculate', { studentId: '<img onerror=alert(1)>' }).code, 'matriculated');
  assert.match(present(p.state.unilagStudent.studentId), /^ULG-[0-9]{4}-[0-9]{6}$/);

  for (let semester = 1; semester <= 2; semester++) {
    const ids = coursesOf('computer', semester).map((course) => course.id);
    const before = p.state.cash;
    const incomplete = p.act('unilag.register-semester', { courses: ids.slice(1) });
    assert.equal(incomplete.code, 'courses_required');
    assert.equal(p.state.cash, before, 'course validation happens before the atomic fee debit');
    assert.equal(p.act('unilag.register-semester', { courses: ids }).code, 'registered');
    assert.equal(p.state.cash, before - UNILAG_BETA_RULES.tuition - UNILAG_BETA_RULES.levy);
    assert.equal(p.act('unilag.register-semester', { courses: ids }).code, 'already_registered');
    attendSemester(p, 'computer', semester);
    p.at(lagosAt(termOf(p.state).deadlineDay - Math.floor((START + 3600000) / DAY), 0));
    assert.equal(p.act('unilag.close-semester').code, semester === 2 ? 'graduated' : 'semester_passed');
  }

  const student = p.state.unilagStudent, degree = graduationOf(student);
  assert.equal(student.status, 'graduated');
  assert.deepEqual(events, [degree]);
  assert.deepEqual(degree, { programme: 'computer', faculty: 'Engineering', cgpa: 5, skill: 'coding', careerTrack: 'tech' });
  assert.equal(present(student.records[0]).courseResults.every((result) => result.assignment > 0 && result.exam > 0), true, 'server RNG produced every score');
  assert.equal(present(student.records[0]).courseResults.some((result) => result.assignment !== 30 || result.exam !== 50), true, 'payload scores were ignored');
  assert.equal(student.lifetime.scholarshipPaid, true);
  assert.equal(p.state.cash, opening - UNILAG_BETA_RULES.admissionFee - 2 * (UNILAG_BETA_RULES.tuition + UNILAG_BETA_RULES.levy) + UNILAG_BETA_RULES.scholarshipAward);
  assert.deepEqual(p.state.ledger.filter((line) => line.reason.startsWith('UNILAG')).map((line) => line.amount), [-200, -1100, 200, -1100]);
  assert.equal(p.view().unilagStudent.degree?.cgpa, 5);
  const modifierCtx = makeContext({ now: p.now, cityId: 'lagos', seed: 'modifier' });
  assert.equal(modify(p.state, 'career.performance', 10, { job: 'tech', level: 1 }, modifierCtx), 11);
  assert.equal(modify(p.state, 'career.performance', 10, { job: 'banking', level: 1 }, modifierCtx), 10);
  assert.deepEqual(createLife(structuredClone(p.state), makeContext({ now: p.now, cityId: 'lagos', seed: 'reload' })), p.state);
});

test('lecture slots use the Lagos start day, night class gives no attendance, and assessments can cross the deadline', () => {
  const p = player();
  admitAndRegister(p, 'english');
  p.spot('arts');
  const morning = present(coursesOf('english', 1)[0]);
  const startDay = termOf(p.state).startDay;
  const baseOffset = startDay - Math.floor((START + 3600000) / DAY);

  p.at(lagosAt(baseOffset, 8, 59));
  assert.equal(p.act('unilag.lecture', { course: morning.id }).code, 'lecture_closed');
  p.at(lagosAt(baseOffset, 10, 59, 45));
  completeTimed(p, 'unilag.lecture', { course: morning.id }, 30);
  assert.deepEqual(termOf(p.state).attendance[morning.id], [startDay]);
  p.at(lagosAt(baseOffset, 9, 30));
  completeTimed(p, 'unilag.lecture', { course: morning.id }, 30);
  assert.deepEqual(termOf(p.state).attendance[morning.id], [startDay], 'same-day replay does not add attendance');
  p.at(lagosAt(baseOffset + 1, 20));
  completeTimed(p, 'unilag.lecture', { course: morning.id }, 30);
  assert.deepEqual(termOf(p.state).attendance[morning.id], [startDay], 'night class is study only');
  assert.equal(termOf(p.state).study[morning.id], 3);

  for (const course of coursesOf('english', 1)) {
    p.at(lagosAt(baseOffset + 6, 23, 58));
    completeTimed(p, 'unilag.assignment', { course: course.id }, 45);
    p.at(lagosAt(baseOffset + 6, 23, 59, 30));
    completeTimed(p, 'unilag.test', { course: course.id }, 45);
  }
  assert.equal(present(termOf(p.state).assessments[morning.id]).test !== null, true, 'test that started before midnight completed once after it');
  p.at(lagosAt(baseOffset + 7, 9));
  assert.equal(p.act('unilag.lecture', { course: morning.id }).code, 'semester_closed');
  assert.match(p.act('unilag.test', { course: morning.id }).reason ?? '', /already completed/i);
  assert.match(p.act('unilag.close-semester').code, /^semester_/);
});

test('hostel transfers use inventory APIs and campus jobs pay once per Lagos start day, never on cancel', () => {
  const p = player();
  admitAndRegister(p, 'business');
  const beforeHostel = p.state.cash;
  assert.equal(p.act('unilag.hostel.allocate', { hall: 'moremi' }).code, 'hostel_allocated');
  const allocation = structuredClone(present(p.state.unilagStudent.hostel.allocations[0]));
  assert.equal(p.state.cash, beforeHostel - UNILAG_BETA_RULES.hostelFee);
  assert.equal(p.act('unilag.hostel.allocate', { hall: 'jaja' }).code, 'already_allocated');
  assert.deepEqual(p.state.unilagStudent.hostel.allocations[0], allocation);
  assert.equal(p.state.cash, beforeHostel - UNILAG_BETA_RULES.hostelFee);

  p.spot('moremi-hall');
  assert.equal(p.act('unilag.hostel.sleep').code, 'started');
  p.step(59);
  const energyAfterInterruptedSleep = p.state.needs.energy;
  assert.equal(p.act('cancel').code, 'cancelled');
  assert.equal(p.state.needs.energy, energyAfterInterruptedSleep, 'cancelling hostel sleep grants no completion effect');
  completeTimed(p, 'unilag.hostel.sleep', {}, UNILAG_BETA_RULES.hostelSleepSeconds);
  assert.equal(p.state.needs.energy > energyAfterInterruptedSleep, true);
  assert.equal(p.act('unilag.hostel.store', { item: 'bread', count: 2, direction: 'in' }).code, 'stored');
  assert.deepEqual([p.state.inventory.bread, p.state.unilagStudent.hostel.storage.bread], [1, 2]);
  assert.equal(p.act('unilag.hostel.store', { item: 'bread', count: 1, direction: 'out' }).code, 'withdrawn');
  assert.deepEqual([p.state.inventory.bread, p.state.unilagStudent.hostel.storage.bread], [2, 1]);
  assert.equal(p.act('unilag.hostel.store', { item: 'phone', count: 1, direction: 'in' }).code, 'invalid_item');
  assert.equal(Object.values(p.state.unilagStudent.hostel.storage).reduce((sum, count) => sum + (count ?? 0), 0) <= HOSTEL_STORAGE_LIMIT, true);

  p.spot('library');
  const beforeJob = p.state.cash;
  assert.equal(p.act('unilag.job', { id: 'library-assistant' }).code, 'started');
  p.step(59);
  assert.equal(p.act('cancel').code, 'cancelled');
  assert.equal(p.state.cash, beforeJob);
  completeTimed(p, 'unilag.job', { id: 'library-assistant' }, UNILAG_BETA_RULES.campusJobSeconds);
  assert.equal(p.state.cash, beforeJob + CAMPUS_JOBS['library-assistant'].pay);
  p.spot('engineering');
  assert.equal(p.act('unilag.job', { id: 'lab-assistant' }).code, 'campus_job_done');

  p.at(lagosAt(1, 23, 59, 30));
  completeTimed(p, 'unilag.job', { id: 'lab-assistant' }, UNILAG_BETA_RULES.campusJobSeconds);
  assert.equal(p.state.unilagStudent.lifetime.campusJobDays.length, 2);
  assert.equal(p.act('unilag.job', { id: 'lab-assistant' }).code, 'started', 'the new day is still available after a cross-midnight job');
  p.step(UNILAG_BETA_RULES.campusJobSeconds);
  assert.equal(p.state.ledger.filter((line) => line.reason === 'UNILAG Lab assistant').length, 2);
});

test('defer, resume, programme change, drop and reapply preserve payout caps', () => {
  const p = player({
    unilagStudent: {
      status: 'admitted', programme: 'eee', studentId: null, admittedDay: 1, applicationCount: 1, term: null, records: [],
      hostel: { allocations: [], storage: {} }, lifetime: { scholarshipPaid: true, campusJobDays: [100] },
    },
  });
  assert.equal(p.act('unilag.change-programme', { programme: 'civil' }).code, 'programme_changed');
  assert.deepEqual(p.state.unilagStudent.lifetime, { scholarshipPaid: true, campusJobDays: [100] });
  assert.equal(p.act('unilag.matriculate').code, 'matriculated');
  const ids = coursesOf('civil', 1).map((course) => course.id);
  assert.equal(p.act('unilag.register-semester', { courses: ids }).code, 'registered');
  const paid = p.state.cash, deadline = termOf(p.state).deadlineDay;
  assert.equal(p.act('unilag.defer').code, 'deferred');
  p.at(p.now + 2 * DAY);
  assert.equal(p.act('unilag.resume').code, 'resumed');
  assert.equal(termOf(p.state).deadlineDay, deadline + 2);
  assert.equal(p.state.cash, paid, 'pause and resume never move money');
  assert.equal(p.act('unilag.drop').code, 'dropped');
  p.spot('senate');
  assert.equal(p.act('unilag.apply', { programme: 'economics' }).code, 'admitted');
  assert.equal(p.state.unilagStudent.lifetime.scholarshipPaid, true);
  assert.deepEqual(p.state.unilagStudent.lifetime.campusJobDays, [100]);
});

test('resuming a deferred term whose deferral day was lost pauses nothing', () => {
  const p = player();
  admitAndRegister(p);
  const term = termOf(p.state), deadline = term.deadlineDay;
  assert.equal(p.act('unilag.defer').code, 'deferred');
  term.deferredAtDay = null; // what sanitize() stores when the saved deferredAtDay is invalid
  p.at(p.now + 3 * DAY);
  assert.equal(p.act('unilag.resume').code, 'resumed');
  assert.equal(termOf(p.state).deadlineDay, deadline, 'no pause by the whole day number');
  assert.equal(termOf(p.state).deferredDays, 0);
});

test('hostile saved state is bounded, bogus graduation is ignored, and sanitize is a fixed point', () => {
  const huge = Array.from({ length: 1000 }, (_, index) => index);
  const hostile = createLife({
    location: 'unilag', spot: 'senate',
    unilagStudent: {
      status: 'graduated', graduated: true, degree: { cgpa: 5 }, programme: 'computer', studentId: '<script>', admittedDay: Infinity,
      applicationCount: Infinity,
      term: { semester: 99, startDay: NaN, deadlineDay: Infinity, registeredCourses: huge, attendance: { '__proto__': huge }, study: { 'cpe-101': Infinity } },
      records: [{ semester: 1, startedDay: 1, closedDay: 2, passed: true, gpa: 5, courseResults: huge }],
      hostel: { allocations: huge.map(() => ({ semester: 1, attempt: 1, hall: '__proto__', room: Infinity })), storage: { bread: 999999, '__proto__': 10 } },
      lifetime: { scholarshipPaid: false, campusJobDays: huge },
    },
    activeAction: { kind: 'campus-study', id: '__proto__', duration: Infinity, remaining: NaN, task: 'test', startedDay: -1, startedMinute: 9999 },
  }, makeContext({ now: START, cityId: 'lagos', seed: 'hostile' })) 
  const student = hostile.unilagStudent;
  assert.equal(student.status, 'admitted');
  assert.equal(student.studentId, null);
  assert.equal(student.term, null);
  assert.deepEqual(student.records, []);
  assert.equal(graduationOf(student), null);
  assert.equal(student.hostel.allocations.length, 0);
  assert.equal(Object.values(student.hostel.storage).reduce((sum, count) => sum + (count ?? 0), 0) <= HOSTEL_STORAGE_LIMIT, true);
  assert.equal(student.lifetime.campusJobDays.length, 35);
  assert.equal(student.applicationCount, 0);
  assert.equal(hostile.activeAction, null);
  assert.equal(student.records.length <= MAX_ATTEMPTS, true);
  assert.deepEqual(createLife(structuredClone(hostile), makeContext({ now: START, cityId: 'lagos', seed: 'hostile-reload' })), hostile);
});


test('overdue students can finish missing tests, and repeated study stops at the beta cap', () => {
 const p=player();admitAndRegister(p,'english');p.spot('arts');
 const course=present(coursesOf('english',1)[0]);
 termOf(p.state).study[course.id]=28;
 assert.equal(p.act('unilag.lecture',{course:course.id}).code,'study_limit');
 p.at(lagosAt(8,9));
 completeTimed(p,'unilag.test',{course:course.id},45);
 assert.equal(p.act('unilag.test',{course:course.id}).code,'already_completed');
});

test('hostel benefits require the allocated hall and invalid job keys refuse safely',()=>{
 const p=player();admitAndRegister(p);p.act('unilag.hostel.allocate',{hall:'mariere'});
 p.spot('moremi-hall');assert.equal(p.act('unilag.hostel.sleep').code,'wrong_place');
 p.spot('mariere-hall');assert.equal(p.act('unilag.hostel.sleep').code,'started');p.act('cancel');
 assert.equal(p.act('unilag.job',{id:'constructor'}).code,'invalid_job');
});
