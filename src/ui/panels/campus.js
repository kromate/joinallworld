/**
 * Campus phone app. Game state stays on the server; this module only keeps the
 * selected tab and form choices between renders.
 */
import './campus.css';
import { esc, json, money, uuid, glyph } from '../dom.js';
import { glyphOfEmoji } from '../icon-map.js';
import { lagosTime } from '../../game/clock.js';
import { DISCOVERY_TRAIL, spots } from '../../campus/unilag/content.js';
import { LECTURE_SLOTS, PROGRAMMES } from '../../campus/unilag/curriculum.js';
import { CAMPUS_CLUBS, CAMPUS_DISCOVERIES } from '../../campus/unilag/games.js';
import { CAMPUS_JOBS, HOSTEL_HALLS, HOSTEL_STORAGE_ITEMS } from '../../campus/unilag/student.js';
import { SHUTTLE_STOPS } from '../../campus/unilag/shuttle.js';

const PANEL = 'campus';
/**
 * The game draws its own glyphs instead of emoji (src/ui/phone/icons.js). The campus content and cards were written with
 * emoji as their icons, in text positions only — never inside an attribute — so the finished html is passed through once:
 * each emoji becomes its drawn glyph (the mortarboard when the set has no closer one).
 */
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
export const drawn = (html) => String(html).replace(EMOJI, (emoji) => glyph(glyphOfEmoji(emoji) || 'campus', 'ui-glyph'));
const TABS = Object.freeze([
  ['overview', 'Overview'],
  ['study', 'Study'],
  ['residence', 'Residence'],
  ['community', 'Community'],
]);
const choices = {
  tab: 'overview',
  programme: 'computer',
  hall: HOSTEL_HALLS[0],
  storageItem: HOSTEL_STORAGE_ITEMS[0],
  storageCount: 1,
  shuttle: SHUTTLE_STOPS[1]?.id ?? '',
  spot: 'main-gate',
  confirmDrop: false,
  studentProgramme: '',
};
const shared = { key: '', generation: 0, city: '', data: null, loading: false, error: '', at: 0, pending: new Set(), nominated: new Set(), voted: new Set() };

const title = (id) => String(id ?? '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const currentStudent = (view) => view.unilagStudent ?? null;
const currentCommunity = (view) => view.unilagCommunity ?? null;
const onCampus = (state) => state.location === 'unilag';
const at = (state, spot) => onCampus(state) && state.spot === spot;
const activeReason = (state, view) => !view.connected ? 'Reconnect to do this.' : state.activeAction ? 'Finish or cancel your current action first.' : '';
const disabled = (reason) => reason ? `disabled title="${esc(reason)}"` : '';
const formatCount = (value) => Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-NG');
const sharedKey = (view) => `${view?.session?.id ?? 'guest'}:${view?.cityId ?? ''}`;

function bindSharedIdentity(view) {
  const key = sharedKey(view);
  if (shared.key === key) return { key, generation: shared.generation };
  shared.key = key;
  shared.generation += 1;
  shared.city = view?.cityId ?? '';
  shared.data = null;
  shared.loading = false;
  shared.error = '';
  shared.at = 0;
  shared.pending = new Set();
  shared.nominated = new Set();
  shared.voted = new Set();
  return { key, generation: shared.generation };
}

function action(type, payload, label, { reason = '', primary = false, close = false } = {}) {
  const attrs = payload === undefined ? '' : ` data-payload="${json(payload)}"`;
  return `<span class="campus-control"><button class="ui-button${primary ? ' is-primary' : ''}" data-action="${esc(type)}"${attrs}${close ? ' data-then="close"' : ''} ${disabled(reason)}>${esc(label)}</button>${reason ? `<small>${esc(reason)}</small>` : ''}</span>`;
}

function go(spot, label = `Go to ${title(spot)}`) {
  return `<button class="ui-button campus-go" data-campus-go="${esc(spot)}">${esc(label)}</button>`;
}

function card(icon, heading, body, extra = '') {
  return `<article class="campus-card"><div class="campus-card-head"><span aria-hidden="true">${esc(icon)}</span><h3>${esc(heading)}</h3></div>${body}${extra}</article>`;
}

function programmeOptions(selected) {
  return Object.values(PROGRAMMES).map((programme) => `<option value="${esc(programme.id)}" ${programme.id === selected ? 'selected' : ''}>${esc(programme.label)}</option>`).join('');
}

function hallOptions(selected) {
  return HOSTEL_HALLS.map((hall) => `<option value="${esc(hall)}" ${hall === selected ? 'selected' : ''}>${esc(title(hall))} Hall</option>`).join('');
}

function campusHeader(state, view) {
  const student = currentStudent(view);
  const place = onCampus(state) ? title(state.spot || 'campus') : (view.city?.name || 'the city');
  return `<section class="campus-hero">
    <div><span class="campus-kicker">University of Lagos · Akoka</span><h3>${onCampus(state) ? `You are at ${esc(place)}` : 'Campus is one trip away'}</h3>
    <p>${student?.programme ? `${esc(student.programme.label)} · ${esc(title(student.status))}` : 'Explore as a visitor, or apply for the compressed campus programme.'}</p></div>
    ${onCampus(state) ? '<span class="campus-live">On campus</span>' : '<button class="ui-button is-primary" data-campus-enter>Travel to UNILAG</button>'}
  </section>`;
}

function tabs() {
  return `<nav class="campus-tabs" aria-label="Campus sections">${TABS.map(([id, label]) => `<button type="button" data-campus-tab="${esc(id)}" aria-current="${choices.tab === id ? 'page' : 'false'}">${esc(label)}</button>`).join('')}</nav>`;
}

function campusActivities(state, view) {
  if (!onCampus(state)) return card('📍', 'Things to do here', '<p>Travel to UNILAG to see activities at each landmark.</p>');
  const place = spots[state.spot];
  const activities = place?.activities ?? [];
  const block = activeReason(state, view);
  const rows = activities.map((item) => `<div class="campus-row"><div><strong>${esc(item.icon)} ${esc(item.label)}</strong><small>${esc(`${item.duration}s`)}${item.cost ? ` · ${esc(money(item.cost))}` : ' · Free'}</small></div>${action('activity', { id: item.id }, 'Start', { reason: block, primary: true })}</div>`).join('');
  return card('✨', `At ${place?.label ?? title(state.spot)}`, rows || '<p>Walk to another landmark to find something to do.</p>');
}

function walkPicker(state) {
  const options = Object.values(spots).map((spot) => `<option value="${esc(spot.id)}" ${spot.id === state.spot ? 'selected' : ''}>${esc(spot.label)}</option>`).join('');
  return card('🚶🏾', 'Walk around campus', `<label class="campus-field">Landmark<select data-campus-spot>${options}</select></label>`,
    `<button class="ui-button is-primary" data-campus-walk ${onCampus(state) ? '' : 'disabled'}>Select and walk</button>`);
}

function discoveryTrail(state, view) {
  const found = new Set(state.unilagCommunity?.trail ?? []);
  const rows = DISCOVERY_TRAIL.map((stop, index) => {
    const done = found.has(stop.id), here = at(state, stop.spot);
    const control = done ? '<span class="campus-done">✓ Visited</span>' : here
      ? action('unilag.trail.visit', {}, 'Mark visited', { reason: activeReason(state, view), primary: true })
      : go(stop.spot, 'Walk here');
    return `<li class="${done ? 'is-done' : ''}"><span class="campus-step">${esc(index + 1)}</span><div><strong>${esc(stop.label)}</strong><small>${esc(stop.description)}</small></div>${control}</li>`;
  }).join('');
  return card('🗺️', `Discovery trail · ${found.size}/${DISCOVERY_TRAIL.length}`, `<ol class="campus-trail">${rows}</ol>`);
}

function shuttle(state, view) {
  const shuttleView = view.unilagShuttle ?? {};
  const stops = shuttleView.stops?.length ? shuttleView.stops : SHUTTLE_STOPS;
  const atStop = onCampus(state) && stops.some((stop) => stop.id === state.spot);
  const usable = stops.filter((stop) => stop.id !== state.spot);
  if (!usable.some((stop) => stop.id === choices.shuttle)) choices.shuttle = usable[0]?.id ?? '';
  const options = usable.map((stop) => `<option value="${esc(stop.id)}" ${stop.id === choices.shuttle ? 'selected' : ''}>${esc(stop.label)}</option>`).join('');
  const reason = activeReason(state, view) || (!atStop ? 'Stand at one of the eight shuttle stops first.' : '') || (!choices.shuttle ? 'Choose another stop.' : '');
  const active = shuttleView.active;
  const running = active ? `<p class="campus-notice">Shuttle in progress: ${esc(title(active.origin))} to ${esc(title(active.destination))}. The fare is not refundable.</p>` : '';
  return card('🚌', `Campus shuttle · ${money(shuttleView.fare ?? 50)}`, `${running}<label class="campus-field">Destination<select data-campus-shuttle>${options}</select></label><p class="campus-note">Eight stops, including Main Gate, Senate, Engineering, Sports Centre and Lagoon Front.</p>`,
    `<button class="ui-button is-primary" data-campus-board ${disabled(reason)}>Board shuttle</button>${reason ? `<small class="campus-why">${esc(reason)}</small>` : ''}`);
}

function overview(state, view) {
  return `<div class="campus-grid">${walkPicker(state)}${campusActivities(state, view)}</div>
    <div class="campus-actions"><button class="ui-button" data-open="bank">🏦 Open Bank</button>${onCampus(state) ? '' : '<button class="ui-button is-primary" data-campus-enter>🎓 Travel to campus</button>'}</div>
    ${shuttle(state, view)}${discoveryTrail(state, view)}`;
}

function cgpaOf(student) {
  if (student?.degree?.cgpa !== undefined) return Number(student.degree.cgpa).toFixed(2);
  const courses = (student?.records ?? []).flatMap((record) => record.courseResults ?? []);
  const credits = courses.reduce((sum, course) => sum + (Number(course.credits) || 0), 0);
  const points = courses.reduce((sum, course) => sum + (Number(course.points) || 0) * (Number(course.credits) || 0), 0);
  return credits ? (points / credits).toFixed(2) : '—';
}

function admission(state, view, student) {
  const rules = student?.betaRules ?? {};
  const coding = view.skills?.coding?.level ?? 0, charisma = view.skills?.charisma?.level ?? 0;
  const skillMet = coding >= 1 || charisma >= 1;
  const place = at(state, 'senate');
  const reason = activeReason(state, view) || (!place ? 'Go to Senate House before applying.' : '') || (!skillMet ? 'Reach Coding level 1 or Charisma level 1 first.' : '');
  return card('📝', 'Apply for admission', `<p>This is a compressed in-game programme. The application fee is ${esc(money(rules.admissionFee ?? 200))}. Admission requires Coding level 1 or Charisma level 1.</p>
    <ul class="campus-checks"><li class="${skillMet ? 'is-met' : ''}">${skillMet ? '✓' : '○'} Coding ${esc(coding)} · Charisma ${esc(charisma)}</li><li class="${place ? 'is-met' : ''}">${place ? '✓' : '○'} Apply at Senate House</li></ul>
    <label class="campus-field">Programme<select data-campus-programme>${programmeOptions(choices.programme)}</select></label>`,
    `${action('unilag.apply', { programme: choices.programme }, `Apply · ${money(rules.admissionFee ?? 200)}`, { reason, primary: true })}${place ? '' : go('senate')}`);
}

function records(student) {
  const rows = (student?.records ?? []).map((record) => `<li><div><strong>Semester ${esc(record.semester)} · attempt ${esc(record.attempt)}</strong><small>${record.passed ? 'Passed' : 'Not passed'}${record.scholarshipAwarded ? ' · Scholarship awarded' : ''}</small></div><b>${esc(Number(record.gpa || 0).toFixed(2))}</b></li>`).join('');
  return card('📄', 'Academic record', `<dl class="campus-stats"><div><dt>Student ID</dt><dd>${esc(student?.studentId || 'Not issued')}</dd></div><div><dt>CGPA</dt><dd>${esc(cgpaOf(student))}</dd></div><div><dt>Status</dt><dd>${esc(title(student?.status || 'none'))}</dd></div></dl>${rows ? `<ul class="campus-records">${rows}</ul>` : '<p class="campus-note">No completed semester record yet.</p>'}`);
}

function enrolmentControls(state, view, student) {
  const status = student?.status ?? 'none';
  const block = activeReason(state, view);
  if (['none', 'dropped'].includes(status)) return admission(state, view, student);
  if (status === 'admitted') {
    const reason = block || (!at(state, 'senate') ? 'Go to Senate House to matriculate.' : '');
    return card('🎓', 'Complete matriculation', `<p>You are admitted to ${esc(student.programme?.label || 'your programme')}. Matriculation issues your Allworld student ID.</p>`,
      `${action('unilag.matriculate', {}, 'Matriculate', { reason, primary: true })}${at(state, 'senate') ? '' : go('senate')}`);
  }
  if (status === 'matriculated' && !student.term && !student.degree) {
    const next = (student.records?.find((record) => record.semester === 1 && record.passed) ? 2 : 1);
    const courses = PROGRAMMES[student.programme?.id]?.semesters[next - 1]?.courses ?? [];
    const fee = (student.betaRules?.tuition ?? 1000) + (student.betaRules?.levy ?? 100);
    const reason = block;
    return card('📚', `Register semester ${next}`, `<p>Registration includes every course below and costs ${esc(money(fee))} in tuition and levy.</p><ul class="campus-course-list">${courses.map((course) => `<li><span>${esc(course.id)}</span>${esc(course.title)}</li>`).join('')}</ul>`,
      action('unilag.register-semester', { courses: courses.map((course) => course.id) }, `Register all · ${money(fee)}`, { reason, primary: true }));
  }
  return '';
}

function courseRows(state, view, student) {
  if (!student?.term || !student.courses?.length) return '';
  const time = lagosTime(view.now), programmeSpot = student.programme.spot;
  const inClass = at(state, programmeSpot), base = activeReason(state, view) || (!inClass ? `Go to ${title(programmeSpot)} for classes and assessments.` : '');
  const rows = student.courses.map((course) => {
    const slot = LECTURE_SLOTS[course.slot], official = time.minuteOfDay >= slot.open && time.minuteOfDay < slot.close;
    const night = time.minuteOfDay >= LECTURE_SLOTS.night.open && time.minuteOfDay < LECTURE_SLOTS.night.close;
    const lectureReason = base || (!official && !night ? `Lecture opens ${slot.label}; night class is ${LECTURE_SLOTS.night.label}.` : '');
    const assignmentReason = base || (course.assignment !== null ? 'Assignment already completed.' : '');
    const testReason = base || (course.test !== null ? 'Test already completed.' : '');
    return `<article class="campus-course"><header><div><strong>${esc(course.id)} · ${esc(course.title)}</strong><small>${esc(slot.label)} · ${esc(course.credits)} credits</small></div><span>${esc(course.attendance)}/7 days</span></header>
      <div class="campus-course-progress"><span>Study ${esc(course.study)}</span><span>Assignment ${course.assignment === null ? '—' : esc(`${course.assignment}/30`)}</span><span>Test ${course.test === null ? '—' : esc(`${course.test}/50`)}</span></div>
      <div class="campus-actions">${action('unilag.lecture', { course: course.id }, official ? 'Attend lecture' : night ? 'Join night class' : 'Lecture closed', { reason: lectureReason, primary: official || night })}${action('unilag.assignment', { course: course.id }, 'Assignment', { reason: assignmentReason })}${action('unilag.test', { course: course.id }, 'Test', { reason: testReason })}</div></article>`;
  }).join('');
  const today = lagosTime(view.now).day, allTests = student.courses.every((course) => course.test !== null);
  const closeReason = activeReason(state, view) || (student.status === 'deferred' ? 'Resume this semester first.' : '') || (!allTests ? 'Complete every course test first.' : '') || (today < student.term.deadlineDay ? `Semester closes in ${student.term.deadlineDay - today} Lagos day(s).` : '');
  return `<section class="campus-section-head"><div><h3>Semester ${esc(student.term.semester)} timetable</h3><p>Classes are held at ${esc(title(programmeSpot))}. Official lectures add attendance; night classes add study only.</p></div>${inClass ? '' : go(programmeSpot, 'Go to class')}</section>${rows}
    <div class="campus-actions">${student.status === 'deferred' ? action('unilag.resume', {}, 'Resume semester', { reason: activeReason(state, view), primary: true }) : action('unilag.defer', {}, 'Defer semester', { reason: activeReason(state, view) })}${action('unilag.close-semester', {}, 'Close semester', { reason: closeReason, primary: allTests && today >= student.term.deadlineDay })}</div>`;
}

function programmeManagement(state, view, student) {
  const canChange = ['admitted', 'matriculated'].includes(student?.status) && !student.term && !(student.records?.length);
  const active = ['admitted', 'matriculated', 'studying', 'deferred'].includes(student?.status);
  if (!canChange && !active) return '';
  const change = canChange ? `<label class="campus-field">Change programme<select data-campus-programme>${programmeOptions(student.programme?.id || choices.programme)}</select></label>${action('unilag.change-programme', { programme: choices.programme }, 'Change programme', { reason: activeReason(state, view) })}` : '';
  const drop = !active ? '' : choices.confirmDrop
    ? `<div class="campus-confirm"><p>Drop ${esc(student.programme?.label || 'this programme')}? Your student ID, active term, records and room allocation will be removed. Paid fees are not refunded.</p><button class="ui-button campus-danger" data-campus-drop-confirm>Yes, drop programme</button><button class="ui-button" data-campus-drop-cancel>Keep studying</button></div>`
    : '<button class="ui-button campus-danger-link" data-campus-drop>Drop programme</button>';
  return card('⚙️', 'Programme options', `<div class="campus-form-row">${change}</div>${drop}`);
}

function jobs(state, view, student) {
  const doneToday = Boolean(student?.lifetime?.campusJobDays?.includes(lagosTime(view.now).day));
  const rows = Object.values(CAMPUS_JOBS).map((job) => {
    const reason = activeReason(state, view) || (!student?.studentId || ['none', 'admitted', 'dropped', 'graduated'].includes(student.status) ? 'Current matriculated students only.' : '') || (doneToday ? 'You already completed a paid campus job today.' : '') || (!at(state, job.spot) ? `Go to ${title(job.spot)} first.` : '');
    return `<div class="campus-row"><div><strong>${esc(job.label)}</strong><small>${esc(title(job.spot))} · ${esc(money(job.pay))}</small></div>${at(state, job.spot) ? action('unilag.job', { id: job.id }, 'Start job', { reason, primary: true }) : go(job.spot)}</div>`;
  }).join('');
  const rules = student?.betaRules ?? {};
  return card('💼', 'Scholarship and campus jobs', `<p>A passed semester with a GPA of ${esc(Number(rules.scholarshipCgpa ?? 4).toFixed(2))} pays the one-time ${esc(money(rules.scholarshipAward ?? 200))} scholarship. One campus job can be completed per Lagos day.</p>${rows}`);
}

function study(state, view) {
  const student = currentStudent(view) ?? { status: 'none', records: [], betaRules: {} };
  return `${records(student)}${enrolmentControls(state, view, student)}${courseRows(state, view, student)}${jobs(state, view, student)}${programmeManagement(state, view, student)}`;
}

function allocationOf(student) {
  return student?.hostel?.allocations?.find((item) => item.semester === student.term?.semester && item.attempt === student.term?.attempt) ?? null;
}

function storagePanel(state, view, student, allocation) {
  const roomSpot = `${allocation.hall}-hall`, storage = student.hostel?.storage ?? {}, inventory = state.inventory ?? {};
  const stored = Object.entries(storage).filter(([, count]) => count > 0).map(([id, count]) => `<span>${esc(title(id))} ×${esc(count)}</span>`).join('') || '<span>Nothing stored</span>';
  const options = HOSTEL_STORAGE_ITEMS.map((id) => `<option value="${esc(id)}" ${id === choices.storageItem ? 'selected' : ''}>${esc(title(id))} · bag ${esc(inventory[id] ?? 0)} · room ${esc(storage[id] ?? 0)}</option>`).join('');
  const placeReason = !at(state, roomSpot) ? `Go to ${title(roomSpot)} to use the room.` : '';
  const reason = activeReason(state, view) || placeReason;
  return `${card('🛏️', `${title(allocation.hall)} Hall · room ${allocation.room}`, `<p>This room is the active allocation for semester ${esc(allocation.semester)}, attempt ${esc(allocation.attempt)}.</p><div class="campus-storage">${stored}</div>`, `${at(state, roomSpot) ? '' : go(roomSpot, 'Go to my room')}${action('unilag.hostel.sleep', {}, 'Sleep · energy +20', { reason, primary: true })}`)}
    ${card('📦', 'Room storage', `<label class="campus-field">Item<select data-campus-storage-item>${options}</select></label><label class="campus-field">Count<input type="number" min="1" max="20" value="${esc(choices.storageCount)}" data-campus-storage-count></label>`, `<div class="campus-actions"><button class="ui-button is-primary" data-campus-store="in" ${disabled(reason)}>Store from bag</button><button class="ui-button" data-campus-store="out" ${disabled(reason)}>Take to bag</button></div>${reason ? `<small class="campus-why">${esc(reason)}</small>` : ''}`)}`;
}

function residence(state, view) {
  const student = currentStudent(view) ?? { status: 'none' }, allocation = allocationOf(student);
  if (!student.term) return card('🏠', 'Campus residence', '<p>Register a semester before requesting an in-game hostel room. This does not represent a real UNILAG allocation.</p>', '<button class="ui-button is-primary" data-campus-tab="study">Open Study</button>');
  if (allocation) return storagePanel(state, view, student, allocation);
  const atSenate = at(state, 'senate'), reason = activeReason(state, view) || (!atSenate ? 'Go to Senate House to request a room.' : '');
  return card('🏠', 'Request a hostel room', `<p>Choose a hall for this semester. The simulated hostel fee is ${esc(money(student.betaRules?.hostelFee ?? 300))}.</p><label class="campus-field">Hall<select data-campus-hall>${hallOptions(choices.hall)}</select></label>`,
    `${action('unilag.hostel.allocate', { hall: choices.hall }, `Allocate · ${money(student.betaRules?.hostelFee ?? 300)}`, { reason, primary: true })}${atSenate ? '' : go('senate')}`);
}

function quiz(state, view, community) {
  const current = community?.quiz;
  if (current) {
    return card('🧠', 'Faculty quiz', `<p><strong>${esc(current.question.prompt)}</strong></p><div class="campus-answers">${current.question.options.map((option) => action('unilag.quiz.answer', { answer: option.id }, option.label, { reason: !view.connected ? 'Reconnect to answer.' : '', primary: true })).join('')}</div>`);
  }
  const reason = activeReason(state, view) || (!at(state, 'student-union') ? 'Go to Student Union first.' : '') || (!community?.eligible ? 'Matriculate as a current student first.' : '');
  return card('🧠', 'Faculty quiz night', '<p>Quiz night runs Friday from 6:00 PM to 9:00 PM, Lagos time. The server chooses one question for your faculty.</p>',
    `${action('unilag.quiz.start', {}, 'Start quiz', { reason, primary: true })}${at(state, 'student-union') ? '' : go('student-union')}`);
}

function gamesAndClubs(state, view, community) {
  const clubs = (community?.clubs?.length ? community.clubs : CAMPUS_CLUBS).map((club) => {
    const joined = club.joined === true;
    const reason = !view.connected ? 'Reconnect to change clubs.' : !community?.eligible ? 'Matriculate as a current student first.' : '';
    return `<div class="campus-row"><div><strong>${esc(club.label)}</strong><small>${esc(title(club.spot))}${joined ? ' · Joined' : ''}</small></div>${action(joined ? 'unilag.club.leave' : 'unilag.club.join', { id: club.id }, joined ? 'Leave' : 'Join', { reason, primary: !joined })}</div>`;
  }).join('');
  const discovered = new Set((community?.discoveries ?? []).filter((item) => item.found).map((item) => item.id));
  const hereDiscovery = onCampus(state) ? CAMPUS_DISCOVERIES[state.spot] : null;
  const discoveryReason = activeReason(state, view) || (!community?.eligible ? 'Matriculate as a current student first.' : '') || (!hereDiscovery ? 'Stand at a marked discovery landmark.' : '') || (discovered.has(hereDiscovery?.id) ? 'This discovery is already logged.' : '');
  const penaltyReason = activeReason(state, view) || (!community?.eligible ? 'Matriculate as a current student first.' : '') || (!at(state, 'sports-centre') ? 'Go to the Sports Centre first.' : '');
  return `${card('🧩', 'Clubs', clubs)}${card('🔎', 'Campus trivia and discoveries', `<p>${hereDiscovery ? `You found ${esc(hereDiscovery.label)}.` : 'Look for marked places at Senate, Library, Lagoon Front, Sports Centre and Student Union.'}</p>`, action('unilag.discovery', {}, 'Log this discovery', { reason: discoveryReason, primary: true }))}
    ${card('⚽', 'Penalty shoot-out', '<p>Take five server-settled kicks once per Lagos day and add the score to the weekly board.</p>', `${action('unilag.penalties', {}, 'Take penalties', { reason: penaltyReason, primary: true })}${at(state, 'sports-centre') ? '' : go('sports-centre')}`)}`;
}

function listStandings(items, emptyText) {
  if (!Array.isArray(items) || !items.length) return `<p class="campus-note">${esc(emptyText)}</p>`;
  return `<ol class="campus-standings">${items.slice(0, 5).map((item) => `<li><span>${esc(item.name ?? title(item.id ?? item.studentId ?? 'Player'))}${item.members ? `<small>${esc(item.members)} player${item.members === 1 ? '' : 's'}</small>` : ''}</span><b>${esc(formatCount(item.score ?? item.value ?? item.points ?? 0))}</b></li>`).join('')}</ol>`;
}

function sharedCommunity(state, view) {
  const sameIdentity = shared.key === sharedKey(view);
  const data = sameIdentity ? shared.data : null;
  const loading = sameIdentity && shared.loading;
  const error = sameIdentity ? shared.error : '';
  if (!view.connected && !data) return card('🌍', 'Shared campus', '<p>Reconnect to load the live election, leaderboards and weekly goal.</p>');
  if (loading && !data) return card('🌍', 'Shared campus', '<p role="status">Loading the live campus board…</p>');
  if (error && !data) return card('🌍', 'Shared campus', `<p class="ui-error" role="alert">${esc(error)}</p>`, '<button class="ui-button" data-campus-retry>Try again</button>');
  if (!data) return card('🌍', 'Shared campus', '<p role="status">Loading the live campus board…</p>');
  if (data.available === false) return card('🌍', 'Shared campus', '<p>The shared UNILAG election, leaderboards and weekly goal are available in Lagos. Travel to campus to take part.</p>', '<button class="ui-button is-primary" data-campus-enter>Travel to UNILAG</button>');
  const election = data.election ?? { phase: 'nominations', week: null, candidates: [], winner: null };
  const community = currentCommunity(view), elections = state.unilagCommunity?.elections;
  const nominated = shared.nominated.has(election.week) || elections?.nominated?.includes(election.week);
  const voted = shared.voted.has(election.week) || elections?.voted?.includes(election.week);
  const eligible = community?.eligible === true;
  const nominateReason = !view.connected ? 'Reconnect to nominate.' : !eligible ? 'Matriculate as a current student first.' : election.phase !== 'nominations' ? 'Nominations run Monday to Wednesday.' : nominated ? 'You are already on this ballot.' : '';
  const candidates = Array.isArray(election.candidates) ? election.candidates : [];
  const candidateRows = candidates.map((candidate) => {
    const voteReason = !view.connected ? 'Reconnect to vote.' : !eligible ? 'Matriculate as a current student first.' : election.phase !== 'voting' ? 'Voting runs Thursday to Saturday.' : voted ? 'You already voted this week.' : '';
    return `<div class="campus-row"><div><strong>${esc(candidate.name)}</strong><small>${esc(formatCount(candidate.votes))} vote${candidate.votes === 1 ? '' : 's'}</small></div><button class="ui-button" data-campus-vote="${esc(candidate.id)}" ${disabled(voteReason || shared.pending.has(`vote:${candidate.id}`) ? voteReason || 'Sending your vote…' : '')}>${shared.pending.has(`vote:${candidate.id}`) ? 'Voting…' : 'Vote'}</button></div>`;
  }).join('') || '<p class="campus-note">No candidates yet.</p>';
  const goal = data.goal ?? {}, target = Math.max(1, Number(goal.target) || 1), progress = Math.max(0, Number(goal.progress) || 0), percent = Math.min(100, Math.round(progress / target * 100));
  const winner = election.winner && (election.winner.name || candidates.find((candidate) => candidate.id === election.winner.id)?.name);
  return `${card('🗳️', `Student Union · ${title(election.phase)}`, `<p>Week ${esc(election.week ?? '—')}${winner ? ` · Winner: ${esc(winner)}` : ''}</p>${candidateRows}`,
      `<button class="ui-button is-primary" data-campus-nominate ${disabled(nominateReason || shared.pending.has('nominate') ? nominateReason || 'Sending nomination…' : '')}>${shared.pending.has('nominate') ? 'Nominating…' : nominated ? 'Nominated' : 'Nominate yourself'}</button>${nominateReason && !nominated ? `<small class="campus-why">${esc(nominateReason)}</small>` : ''}`)}
    ${card('🤝', 'Weekly clean-up goal', `<div class="campus-goal"><div><strong>${esc(formatCount(progress))} / ${esc(formatCount(target))}</strong><span>${goal.complete ? 'Complete' : 'Aluta volunteering adds one verified contribution per player each day.'}</span></div><div aria-label="${esc(`${percent}% complete`)}"><i style="width:${esc(`${percent}%`)}"></i></div></div>`, at(state, 'student-union') ? action('activity', { id: 'unilag-volunteer' }, 'Volunteer today', { reason: activeReason(state, view), primary: true }) : go('student-union', 'Go volunteer'))}
    <div class="campus-grid campus-leaders">${card('🏫', 'Faculty board', listStandings(data.leaderboards?.faculty, 'No faculty scores yet.'))}${card('🏠', 'Hall board', listStandings(data.leaderboards?.hall, 'No hall scores yet.'))}</div>
    ${card('🏅', 'Top players', listStandings(data.leaderboards?.players, 'No player scores yet.'), error ? `<p class="ui-error">Refresh failed: ${esc(error)}</p>` : '<button class="ui-button campus-refresh" data-campus-retry>Refresh live board</button>')}`;
}

function community(state, view) {
  const local = currentCommunity(view) ?? { clubs: [], discoveries: [], eligible: false };
  const events = local.events?.length ? `<div class="campus-events">${local.events.map((event) => `<span>${esc(event.label)}</span>`).join('')}</div>` : '<p class="campus-note">No timed campus event is running now.</p>';
  return `${events}${quiz(state, view, local)}${gamesAndClubs(state, view, local)}${sharedCommunity(state, view)}`;
}

function normalizeShared(payload) {
  const data = payload?.summary ?? payload;
  return data && typeof data === 'object' && Object.hasOwn(data, 'election')
    && Object.hasOwn(data, 'leaderboards') && Object.hasOwn(data, 'goal') ? data : null;
}

function loadShared(api, force = false) {
  const view = api.view(), city = view?.cityId;
  if (!view?.connected || !city) return;
  const request = bindSharedIdentity(view);
  if (shared.loading) return;
  if (!force && shared.at && (shared.data || shared.error) && Date.now() - shared.at < 20000) return;
  shared.loading = true; shared.error = '';
  api.fetchJson(`/api/campus?city=${encodeURIComponent(city)}`).then((result) => {
    const data = normalizeShared(result);
    if (!data) throw new Error('The campus server returned an incomplete board.');
    if (shared.key === request.key && shared.generation === request.generation) shared.data = data;
  }).catch((error) => {
    if (shared.key === request.key && shared.generation === request.generation) {
      shared.error = error?.message || 'The campus board could not be reached.';
    }
  }).finally(() => {
    if (shared.key !== request.key || shared.generation !== request.generation) return;
    shared.loading = false; shared.at = Date.now(); api.refresh();
  });
}

async function postShared(api, kind, candidateId = '') {
  const tag = candidateId ? `${kind}:${candidateId}` : kind;
  const view = api.view();
  if (!view?.connected) return;
  const request = bindSharedIdentity(view), pending = shared.pending;
  if (pending.has(tag)) return;
  pending.add(tag); api.refresh();
  try {
    const randomId = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : uuid();
    const body = { cityId: view.cityId, actionId: `${Date.now()}:${randomId}`, ...(candidateId ? { candidateId } : {}) };
    const result = await api.fetchJson(`/api/campus/${kind}`, { method: 'POST', body });
    if (shared.key !== request.key || shared.generation !== request.generation) return;
    if (result?.ok === false) { api.toast(result.reason || 'The campus server refused that request.', 'error'); return; }
    const data = normalizeShared(result);
    if (data) shared.data = data;
    const week = data?.election?.week ?? shared.data?.election?.week;
    if (week !== undefined && week !== null && kind === 'nominate') shared.nominated.add(week);
    if (week !== undefined && week !== null && kind === 'vote') shared.voted.add(week);
    api.toast(kind === 'nominate' ? 'Your nomination is on the ballot.' : 'Your vote was counted.', 'good');
  } catch (error) {
    if (shared.key !== request.key || shared.generation !== request.generation) return;
    shared.error = error?.message || 'The campus server could not be reached.';
    api.toast(`${shared.error} Nothing was changed.`, 'error');
  } finally {
    pending.delete(tag);
    if (shared.key !== request.key || shared.generation !== request.generation) return;
    shared.at = 0; api.refresh(); loadShared(api, true);
  }
}

function bindSelect(root, api, selector, key, refresh = false) {
  root.querySelector(selector)?.addEventListener('change', (event) => {
    choices[key] = event.currentTarget.value;
    if (refresh) api.refresh();
  });
}

async function run(api, type, payload) {
  const result = await api.command(type, payload);
  if (!result?.ok) api.toast(result?.reason || 'That could not be done.', 'error');
  return result;
}

const campus = {
  id: PANEL,
  title: 'Campus',
  placement: 'phone',
  order: 47,
  group: 'city',
  live: true,
  render(state, view) {
    if (!TABS.some(([id]) => id === choices.tab)) choices.tab = 'overview';
    const student = currentStudent(view);
    if (student?.programme?.id && choices.studentProgramme !== student.programme.id) {
      choices.studentProgramme = student.programme.id;
      choices.programme = student.programme.id;
    } else if (!student?.programme?.id) choices.studentProgramme = '';
    const body = choices.tab === 'study' ? study(state, view) : choices.tab === 'residence' ? residence(state, view)
      : choices.tab === 'community' ? community(state, view) : overview(state, view);
    return drawn(`${campusHeader(state, view)}${tabs()}<section class="campus-body" data-campus-section="${esc(choices.tab)}">${body}</section>`);
  },
  bind(root, api) {
    loadShared(api);
    for (const button of root.querySelectorAll('[data-campus-tab]')) button.addEventListener('click', () => { choices.tab = button.dataset.campusTab; api.refresh(); });
    for (const button of root.querySelectorAll('[data-campus-enter]')) button.addEventListener('click', () => { api.close(); api.goTo('unilag', 'main-gate'); });
    for (const button of root.querySelectorAll('[data-campus-go]')) button.addEventListener('click', () => { api.close(); api.goTo('unilag', button.dataset.campusGo); });
    bindSelect(root, api, '[data-campus-programme]', 'programme', true);
    bindSelect(root, api, '[data-campus-hall]', 'hall', true);
    bindSelect(root, api, '[data-campus-storage-item]', 'storageItem');
    bindSelect(root, api, '[data-campus-shuttle]', 'shuttle');
    bindSelect(root, api, '[data-campus-spot]', 'spot');
    root.querySelector('[data-campus-storage-count]')?.addEventListener('input', (event) => {
      choices.storageCount = Math.max(1, Math.min(20, Math.round(Number(event.currentTarget.value) || 1)));
    });
    root.querySelector('[data-campus-walk]')?.addEventListener('click', () => { api.close(); api.goTo('unilag', root.querySelector('[data-campus-spot]')?.value || choices.spot); });
    root.querySelector('[data-campus-board]')?.addEventListener('click', () => run(api, 'campus-shuttle', { destination: root.querySelector('[data-campus-shuttle]')?.value || choices.shuttle }));
    for (const button of root.querySelectorAll('[data-campus-store]')) button.addEventListener('click', () => run(api, 'unilag.hostel.store', {
      item: root.querySelector('[data-campus-storage-item]')?.value || choices.storageItem,
      count: Math.max(1, Math.min(20, Math.round(Number(root.querySelector('[data-campus-storage-count]')?.value) || choices.storageCount))),
      direction: button.dataset.campusStore,
    }));
    root.querySelector('[data-campus-drop]')?.addEventListener('click', () => { choices.confirmDrop = true; api.refresh(); });
    root.querySelector('[data-campus-drop-cancel]')?.addEventListener('click', () => { choices.confirmDrop = false; api.refresh(); });
    root.querySelector('[data-campus-drop-confirm]')?.addEventListener('click', async () => { if ((await run(api, 'unilag.drop', {}))?.ok) choices.confirmDrop = false; });
    root.querySelector('[data-campus-retry]')?.addEventListener('click', () => loadShared(api, true));
    root.querySelector('[data-campus-nominate]')?.addEventListener('click', () => postShared(api, 'nominate'));
    for (const button of root.querySelectorAll('[data-campus-vote]')) button.addEventListener('click', () => postShared(api, 'vote', button.dataset.campusVote));
  },
};

export default campus;
