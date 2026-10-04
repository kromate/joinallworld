/**
 * UNILAG campus games and community rules for Allworld.
 *
 * `unilagCommunity` is per-life state only. Elections and leaderboards below are exported pure
 * reducers for a server-owned transactional store. This module does not pretend that shared
 * persistence exists. A route must derive participant/result identity from its authoritative
 * life, run the reducer in the shared-store transaction, and then run the server-only life action.
 *
 * All rewards, timings, limits, questions, clubs, discoveries and event schedules are original
 * beta gameplay content. No campus game or community action changes cash.
 */
import { emit } from '../../game/registry.js';
import { addSkillXp, changeNeeds } from '../../game/api.js';
import { busy, cleanText, fail, finite, isRecord, ok, safeCount } from '../../game/util.js';
import { lagosDayStart, lagosTime } from '../../game/clock.js';
import { DISCOVERY_TRAIL } from './content.js';
import { PROGRAMMES, programmeOf } from './curriculum.js';

export const CAMPUS_GAME_KIND = 'campus-game';
export const CAMPUS_HALLS = Object.freeze(['moremi', 'mariere', 'eni-njoku', 'jaja', 'fagunwa']);
export const CAMPUS_FACULTIES = Object.freeze([...new Set(Object.values(PROGRAMMES).map((programme) => programme.faculty))]);
export const CAMPUS_CLUBS = Object.freeze([
  Object.freeze({ id: 'robotics', label: 'Robotics Club', spot: 'engineering' }),
  Object.freeze({ id: 'literary', label: 'Literary Society', spot: 'arts' }),
  Object.freeze({ id: 'debate', label: 'Debate Society', spot: 'student-union' }),
  Object.freeze({ id: 'enterprise', label: 'Enterprise Club', spot: 'management' }),
  Object.freeze({ id: 'football', label: 'Football Club', spot: 'sports-centre' }),
]);

/** Metadata only. A table-game framework owner must bind these seats to a Whot implementation. */
export const STUDENT_UNION_TABLES = Object.freeze([
  Object.freeze({ id: 'union-whot-1', label: 'Whot table 1', spot: 'student-union', game: 'whot', seats: 4, frameworkBinding: 'table-game:whot' }),
  Object.freeze({ id: 'union-whot-2', label: 'Whot table 2', spot: 'student-union', game: 'whot', seats: 4, frameworkBinding: 'table-game:whot' }),
]);

export const CAMPUS_GAME_RULES = Object.freeze({
  penaltySeconds: 15,
  penaltyKicks: 5,
  penaltyChance: 0.55,
  maxClubs: 3,
  keptDays: 14,
  quizCorrectScore: 10,
  quizWrongScore: 2,
  discoveryScore: 5,
  volunteerSeconds: 45,
  volunteerFun: 5,
  volunteerXp: 5,
  leaderboardRecords: 2048,
  electionCandidates: 16,
  electionBallots: 2048,
});

const authoredQuestions = Object.freeze({
  Engineering: [
    { id: 'eng-circuit', prompt: 'Which component stores energy in an electric field?', options: [['a', 'Resistor'], ['b', 'Capacitor'], ['c', 'Fuse']], answer: 'b' },
    { id: 'eng-force', prompt: 'What unit measures force?', options: [['a', 'Newton'], ['b', 'Watt'], ['c', 'Volt']], answer: 'a' },
    { id: 'eng-binary', prompt: 'What is decimal 5 in binary?', options: [['a', '101'], ['b', '110'], ['c', '111']], answer: 'a' },
  ],
  Arts: [
    { id: 'arts-metaphor', prompt: 'A direct comparison that says one thing is another is called what?', options: [['a', 'Metaphor'], ['b', 'Alliteration'], ['c', 'Irony']], answer: 'a' },
    { id: 'arts-drama', prompt: 'What do stage directions tell performers?', options: [['a', 'Ticket prices'], ['b', 'Actions and movement'], ['c', 'Book sales']], answer: 'b' },
    { id: 'arts-narrator', prompt: 'Who tells the story in a work of fiction?', options: [['a', 'Narrator'], ['b', 'Publisher'], ['c', 'Audience']], answer: 'a' },
  ],
  'Management Sciences': [
    { id: 'mgt-balance', prompt: 'Assets equal liabilities plus what?', options: [['a', 'Equity'], ['b', 'Revenue'], ['c', 'Inventory']], answer: 'a' },
    { id: 'mgt-market', prompt: 'Which term means the group most likely to buy a product?', options: [['a', 'Supply chain'], ['b', 'Target market'], ['c', 'Ledger']], answer: 'b' },
    { id: 'mgt-plan', prompt: 'Which document explains how a venture will operate and earn?', options: [['a', 'Business plan'], ['b', 'Receipt'], ['c', 'Timesheet']], answer: 'a' },
  ],
  'Social Sciences': [
    { id: 'soc-scarcity', prompt: 'Economics begins with the problem of limited resources called what?', options: [['a', 'Scarcity'], ['b', 'Inflation'], ['c', 'Exports']], answer: 'a' },
    { id: 'soc-demand', prompt: 'When price rises and other things stay equal, demand usually does what?', options: [['a', 'Rises'], ['b', 'Falls'], ['c', 'Doubles']], answer: 'b' },
    { id: 'soc-census', prompt: 'A count of a population is called what?', options: [['a', 'Tariff'], ['b', 'Census'], ['c', 'Budget']], answer: 'b' },
  ],
});

const publicQuestion = (question) => Object.freeze({ id: question.id, prompt: question.prompt,
  options: Object.freeze(question.options.map(([id, label]) => Object.freeze({ id, label }))) });
export const QUIZ_QUESTIONS = Object.freeze(Object.fromEntries(Object.entries(authoredQuestions)
  .map(([faculty, questions]) => [faculty, Object.freeze(questions.map(publicQuestion))])));
const answerByQuestion = new Map(Object.values(authoredQuestions).flat().map((question) => [question.id, question.answer]));
const questionById = new Map(Object.values(QUIZ_QUESTIONS).flat().map((question) => [question.id, question]));

export const CAMPUS_DISCOVERIES = Object.freeze({
  senate: Object.freeze({ id: 'senate', label: 'Senate House steps', skill: 'charisma' }),
  library: Object.freeze({ id: 'library', label: 'Library stacks', skill: 'coding' }),
  'lagoon-front': Object.freeze({ id: 'lagoon-front', label: 'Lagoon Front', skill: 'fitness' }),
  'sports-centre': Object.freeze({ id: 'sports-centre', label: 'Sports Centre tunnel', skill: 'fitness' }),
  'student-union': Object.freeze({ id: 'student-union', label: 'Student Union notice wall', skill: 'hustle' }),
});

const GAME_SCORE_CAPS = Object.freeze({ quiz: CAMPUS_GAME_RULES.quizCorrectScore, discovery: CAMPUS_GAME_RULES.discoveryScore, penalties: CAMPUS_GAME_RULES.penaltyKicks });
const GAME_IDS = Object.freeze(Object.keys(GAME_SCORE_CAPS));
const PUBLIC_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STUDENT_ID = /^ULG-[0-9]{4}-[0-9]{6}$/;
const safeDay = (value) => Number.isSafeInteger(value) && value >= 0;
const safeWeek = (value) => Number.isSafeInteger(value) && value >= 0;
const nowOf = (state, ctx) => finite(ctx?.now) ? ctx.now : state.t;

function currentStudent(state) {
  const student = state.unilagStudent;
  const programme = isRecord(student) ? programmeOf(student.programme) : null;
  if (!programme || !STUDENT_ID.test(student.studentId ?? '') || !['matriculated', 'studying', 'deferred'].includes(student.status)) return null;
  const term = isRecord(student.term) ? student.term : null;
  const allocation = term && Array.isArray(student.hostel?.allocations)
    ? student.hostel.allocations.findLast((item) => item.semester === term.semester && item.attempt === term.attempt) : null;
  const hall = allocation && CAMPUS_HALLS.includes(allocation.hall) ? allocation.hall : null;
  return { student, programme, studentId: student.studentId, faculty: programme.faculty, hall };
}

function studentBlock(state) {
  return currentStudent(state) ? null : { code: 'student_required', reason: 'Matriculate as a current UNILAG student before joining campus games or community activities.' };
}

function campusSpotBlock(state, spot) {
  return state.location === 'unilag' && state.spot === spot ? null
    : { code: 'wrong_place', reason: `Go to UNILAG and stand at ${spot.replaceAll('-', ' ')} first.` };
}

const resultFail = (state, code, reason) => ({ ok: false, code, reason, state });
const resultOk = (state, code) => ({ ok: true, code, state });

/** Active weekly campus events at `now`, using the Lagos wall clock. */
export function eventsAt(now) {
  if (!finite(now)) return [];
  const time = lagosTime(now), dayStart = lagosDayStart(time.day), events = [];
  if (time.weekday === 1) events.push({ id: 'freshers', label: 'Freshers welcome', startsAt: dayStart, endsAt: dayStart + 86400000, tags: ['freshers', 'community'], beta: true });
  if (time.weekday === 5 && time.minuteOfDay >= 18 * 60 && time.minuteOfDay < 21 * 60) {
    events.push({ id: 'quiz-night', label: 'Faculty quiz night', startsAt: dayStart + 18 * 3600000, endsAt: dayStart + 21 * 3600000, tags: ['quiz', 'faculty'], beta: true });
  }
  if (time.weekday === 0 && time.minuteOfDay >= 14 * 60 && time.minuteOfDay < 18 * 60) {
    events.push({ id: 'convocation', label: 'Convocation gathering', startsAt: dayStart + 14 * 3600000, endsAt: dayStart + 18 * 3600000, tags: ['convocation', 'community'], beta: true });
  }
  return events;
}

function freshCommunity() {
  return { clubs: [], discoveries: [], trail: [], days: [], quiz: null, elections: { nominated: [], voted: [] } };
}

function normalizedDay(value) {
  if (!isRecord(value) || !safeDay(value.day)) return null;
  const games = {};
  for (const id of GAME_IDS) {
    const score = value.games?.[id];
    if (Number.isSafeInteger(score) && score >= 0 && score <= GAME_SCORE_CAPS[id]) games[id] = score;
  }
  const teams={};for(const game of GAME_IDS){const team=value.teams?.[game];if(team&&STUDENT_ID.test(team.studentId)&&CAMPUS_FACULTIES.includes(team.faculty)&&(team.hall===null||CAMPUS_HALLS.includes(team.hall)))teams[game]={studentId:team.studentId,faculty:team.faculty,hall:team.hall};}
  return { day: value.day, games, ...(Object.keys(teams).length?{teams}:{}), volunteered: value.volunteered === true };
}

function sanitize(input, state, ctx) {
  const saved = isRecord(input.unilagCommunity) ? input.unilagCommunity : {};
  const community = freshCommunity();
  community.clubs = [...new Set((Array.isArray(saved.clubs) ? saved.clubs : []).filter((id) => CAMPUS_CLUBS.some((club) => club.id === id)))].slice(0, CAMPUS_GAME_RULES.maxClubs);
  community.discoveries = [...new Set((Array.isArray(saved.discoveries) ? saved.discoveries : []).filter((id) => Object.hasOwn(CAMPUS_DISCOVERIES, id)))];
  community.trail = [...new Set((Array.isArray(saved.trail)?saved.trail:[]).filter(id=>DISCOVERY_TRAIL.some(stop=>stop.id===id)))];
  const days = new Map();
  for (const value of Array.isArray(saved.days) ? saved.days.slice(-CAMPUS_GAME_RULES.keptDays * 2) : []) {
    const day = normalizedDay(value); if (day) days.set(day.day, day);
  }
  community.days = [...days.values()].sort((a, b) => a.day - b.day).slice(-CAMPUS_GAME_RULES.keptDays);
  community.elections = {
    nominated: [...new Set((Array.isArray(saved.elections?.nominated) ? saved.elections.nominated : []).filter(safeWeek))].sort((a, b) => a - b).slice(-8),
    voted: [...new Set((Array.isArray(saved.elections?.voted) ? saved.elections.voted : []).filter(safeWeek))].sort((a, b) => a - b).slice(-8),
  };
  const profile = currentStudent(state), today = lagosTime(nowOf(state, ctx)).day;
  const quiz = saved.quiz, question = isRecord(quiz) ? questionById.get(quiz.questionId) : null;
  if (profile && question && quiz.day === today && quiz.faculty === profile.faculty && QUIZ_QUESTIONS[profile.faculty]?.some((item) => item.id === question.id)
    && finite(quiz.startedAt) && quiz.startedAt >= 0 && quiz.startedAt <= nowOf(state, ctx) && community.days.find((day) => day.day === today)?.games.quiz === undefined) {
    community.quiz = { day: today, faculty: profile.faculty, questionId: question.id, startedAt: quiz.startedAt };
  }
  state.unilagCommunity = community;
}

function dayRecord(community, day) {
  let record = community.days.find((item) => item.day === day);
  if (!record) {
    record = { day, games: {}, volunteered: false };
    community.days.push(record);
    community.days.sort((a, b) => a.day - b.day);
    if (community.days.length > CAMPUS_GAME_RULES.keptDays) community.days.splice(0, community.days.length - CAMPUS_GAME_RULES.keptDays);
  }
  return record;
}

function scoreEvent(state, game, score, day, ctx) {
  const profile = currentStudent(state);
  if (!profile) return false;
  const record=dayRecord(state.unilagCommunity,day);record.teams??={};record.teams[game]={studentId:profile.studentId,faculty:profile.faculty,hall:profile.hall};
  emit(state, 'campus.game.scored', { studentId: profile.studentId, game, score, day, faculty: profile.faculty, hall: profile.hall }, ctx);
  return true;
}

function joinClub(state, payload) {
  const student = studentBlock(state); if (student) return fail(state, student.code, student.reason);
  const club = CAMPUS_CLUBS.find((item) => item.id === payload?.id);
  if (!club) return fail(state, 'invalid_club', `Choose one of: ${CAMPUS_CLUBS.map((item) => item.id).join(', ')}.`);
  const community = state.unilagCommunity;
  if (community.clubs.includes(club.id)) return ok(state, 'already_joined');
  if (community.clubs.length >= CAMPUS_GAME_RULES.maxClubs) return fail(state, 'club_limit', `Join at most ${CAMPUS_GAME_RULES.maxClubs} campus clubs.`);
  community.clubs.push(club.id); state.message = `Joined ${club.label}.`;
  return ok(state, 'joined');
}

function leaveClub(state, payload) {
  const club = CAMPUS_CLUBS.find((item) => item.id === payload?.id);
  if (!club) return fail(state, 'invalid_club', `Choose one of: ${CAMPUS_CLUBS.map((item) => item.id).join(', ')}.`);
  const index = state.unilagCommunity.clubs.indexOf(club.id);
  if (index < 0) return fail(state, 'not_member', `You have not joined ${club.label}.`);
  state.unilagCommunity.clubs.splice(index, 1); state.message = `Left ${club.label}.`;
  return ok(state, 'left');
}

function startQuiz(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  const place = campusSpotBlock(state, 'student-union'); if (place) return fail(state, place.code, place.reason);
  if (!eventsAt(nowOf(state, ctx)).some((event) => event.id === 'quiz-night')) return fail(state, 'quiz_closed', 'Faculty quiz night runs Friday from 6:00 PM to 9:00 PM, Lagos time.');
  const time = lagosTime(nowOf(state, ctx)), community = state.unilagCommunity, day = dayRecord(community, time.day);
  if (day.games.quiz !== undefined) return fail(state, 'daily_limit', 'You already completed today’s faculty quiz. Come back after midnight, Lagos time.');
  if (community.quiz) return fail(state, 'quiz_started', 'Answer the current faculty question before starting another.');
  const bank = QUIZ_QUESTIONS[profile.faculty];
  const question = bank[Math.floor(ctx.rng() * bank.length)];
  community.quiz = { day: time.day, faculty: profile.faculty, questionId: question.id, startedAt: nowOf(state, ctx) };
  state.message = 'Faculty quiz started. Choose one answer.';
  return ok(state, 'quiz_started');
}

function answerQuiz(state, payload, ctx) {
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  const community = state.unilagCommunity, current = community.quiz;
  if (!current) return fail(state, 'no_quiz', 'Start a faculty quiz before answering.');
  if (current.faculty !== profile.faculty) { community.quiz = null; return fail(state, 'quiz_invalidated', 'Your programme changed, so start a new faculty quiz.'); }
  const question = questionById.get(current.questionId);
  if (!question || !question.options.some((option) => option.id === payload?.answer)) return fail(state, 'invalid_answer', 'Choose one of the answers shown for the current question.');
  const correct = answerByQuestion.get(question.id) === payload.answer;
  const score = correct ? CAMPUS_GAME_RULES.quizCorrectScore : CAMPUS_GAME_RULES.quizWrongScore;
  const record = dayRecord(community, current.day);
  if (record.games.quiz !== undefined) { community.quiz = null; return fail(state, 'daily_limit', 'Today’s faculty quiz result is already recorded.'); }
  record.games.quiz = score; community.quiz = null;
  changeNeeds(state, { fun: correct ? 5 : 2 });
  addSkillXp(state, profile.programme.skill, correct ? 5 : 2, ctx);
  scoreEvent(state, 'quiz', score, current.day, ctx);
  state.message = correct ? `Correct. Faculty quiz score: ${score}.` : `Not this time. Faculty quiz score: ${score}.`;
  return ok(state, correct ? 'correct' : 'incorrect');
}

function discover(state, payload, ctx) {
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  if (state.location !== 'unilag' || !Object.hasOwn(CAMPUS_DISCOVERIES, state.spot)) return fail(state, 'nothing_here', 'Stand at a marked UNILAG discovery spot and look again.');
  const community = state.unilagCommunity, discovery = CAMPUS_DISCOVERIES[state.spot], today = lagosTime(nowOf(state, ctx)).day;
  const record = dayRecord(community, today);
  if (record.games.discovery !== undefined) return fail(state, 'daily_limit', 'You already logged one campus discovery today. Look again after midnight, Lagos time.');
  if (community.discoveries.includes(discovery.id)) return fail(state, 'already_discovered', `${discovery.label} is already in your campus discoveries.`);
  community.discoveries.push(discovery.id); record.games.discovery = CAMPUS_GAME_RULES.discoveryScore;
  changeNeeds(state, { fun: 5 }); addSkillXp(state, discovery.skill, 3, ctx);
  scoreEvent(state, 'discovery', CAMPUS_GAME_RULES.discoveryScore, today, ctx);
  state.message = `Discovered ${discovery.label}.`;
  return ok(state, 'discovered');
}

function startPenalties(state, payload, ctx) {
  const blocked = busy(state); if (blocked) return blocked;
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  const place = campusSpotBlock(state, 'sports-centre'); if (place) return fail(state, place.code, place.reason);
  const today = lagosTime(nowOf(state, ctx)).day, record = dayRecord(state.unilagCommunity, today);
  if (record.games.penalties !== undefined) return fail(state, 'daily_limit', 'You already took today’s penalty shoot-out. Try again after midnight, Lagos time.');
  state.activeAction = { kind: CAMPUS_GAME_KIND, id: 'football-penalties', duration: CAMPUS_GAME_RULES.penaltySeconds,
    remaining: CAMPUS_GAME_RULES.penaltySeconds, day: today };
  state.message = 'Penalty shoot-out started. The server will settle all five kicks.';
  return ok(state, 'started');
}

function sanitizeCampusGame(value, state) {
  const profile = currentStudent(state), record = safeDay(value.day) ? state.unilagCommunity.days.find((item) => item.day === value.day) : null;
  if (!profile || value.id !== 'football-penalties' || value.duration !== CAMPUS_GAME_RULES.penaltySeconds
    || state.location !== 'unilag' || state.spot !== 'sports-centre' || !safeDay(value.day) || record?.games.penalties !== undefined) return null;
  return { day: value.day };
}

function completeCampusGame(state, active, ctx) {
  const profile = currentStudent(state); if (!profile) return;
  const record = dayRecord(state.unilagCommunity, active.day);
  if (record.games.penalties !== undefined) return;
  let goals = 0;
  for (let kick = 0; kick < CAMPUS_GAME_RULES.penaltyKicks; kick++) if (ctx.rng() < CAMPUS_GAME_RULES.penaltyChance) goals += 1;
  record.games.penalties = goals;
  changeNeeds(state, { fun: 2 + goals }); addSkillXp(state, 'fitness', 2 + goals, ctx);
  scoreEvent(state, 'penalties', goals, active.day, ctx);
  state.message = `Penalty shoot-out: ${goals} of ${CAMPUS_GAME_RULES.penaltyKicks} scored.`;
}

function electionPhaseAt(now) {
  if (!finite(now) || now < 0) return { week: null, phase: 'invalid' };
  const time = lagosTime(now);
  return { week: time.week, phase: time.weekday >= 1 && time.weekday <= 3 ? 'nominations' : time.weekday >= 4 && time.weekday <= 6 ? 'voting' : 'results' };
}
export { electionPhaseAt };

const serverOnly = (run) => ({ serverOnly: true, run,
  refusal: 'This step is completed by the campus server together with the shared election store. Use the Student Union election screen; nothing was changed.' });

function localNomination(state, payload, ctx) {
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  const phase = electionPhaseAt(nowOf(state, ctx));
  if (phase.phase !== 'nominations') return fail(state, 'nominations_closed', 'Nominations run Monday to Wednesday, Lagos time.');
  if (state.unilagCommunity.elections.nominated.includes(phase.week)) return fail(state, 'already_candidate', 'You are already on this week’s Student Union ballot.');
  state.unilagCommunity.elections.nominated.push(phase.week);
  state.unilagCommunity.elections.nominated = state.unilagCommunity.elections.nominated.slice(-8);
  emit(state, 'campus.election.nominated', { week: phase.week, studentId: profile.studentId, faculty: profile.faculty, hall: profile.hall }, ctx);
  state.message = 'Student Union nomination recorded.';
  return ok(state, 'nominated');
}

function localVote(state, payload, ctx) {
  const profile = currentStudent(state); if (!profile) return fail(state, studentBlock(state).code, studentBlock(state).reason);
  const phase = electionPhaseAt(nowOf(state, ctx));
  if (phase.phase !== 'voting') return fail(state, 'polls_closed', 'Student Union voting runs Thursday to Saturday, Lagos time.');
  if (!PUBLIC_ID.test(payload?.candidate ?? '')) return fail(state, 'invalid_candidate', 'Choose a candidate from the shared Student Union ballot.');
  if (state.unilagCommunity.elections.voted.includes(phase.week)) return fail(state, 'already_voted', 'You already voted this week. A cast ballot cannot be changed.');
  state.unilagCommunity.elections.voted.push(phase.week);
  state.unilagCommunity.elections.voted = state.unilagCommunity.elections.voted.slice(-8);
  emit(state, 'campus.election.voted', { week: phase.week, candidate: payload.candidate, studentId: profile.studentId, faculty: profile.faculty, hall: profile.hall }, ctx);
  state.message = 'Student Union vote recorded.';
  return ok(state, 'voted');
}

/** Pure shared-election state. The server store owns this object, never a life save. */
export const emptyCampusElection = (week) => ({ week, candidates: [], ballots: [], winner: null });

function validAuthority(value) {
  return isRecord(value) && value.current === true && PUBLIC_ID.test(value.id ?? '') && STUDENT_ID.test(value.studentId ?? '')
    && CAMPUS_FACULTIES.includes(value.faculty) && (value.hall === null || CAMPUS_HALLS.includes(value.hall));
}

export function sanitizeCampusElection(value) {
  const week = safeWeek(value?.week) ? value.week : 0, candidates = [], ballots = [];
  for (const item of Array.isArray(value?.candidates) ? value.candidates.slice(0, CAMPUS_GAME_RULES.electionCandidates) : []) {
    if (!isRecord(item) || !PUBLIC_ID.test(item.id ?? '') || !STUDENT_ID.test(item.studentId ?? '') || !CAMPUS_FACULTIES.includes(item.faculty)
      || (item.hall !== null && !CAMPUS_HALLS.includes(item.hall)) || !finite(item.at) || item.at < 0 || candidates.some((other) => other.id === item.id || other.studentId === item.studentId)) continue;
    candidates.push({ id: item.id, studentId: item.studentId, name: cleanText(item.name, 24, 'Student'), faculty: item.faculty, hall: item.hall, at: item.at });
  }
  for (const item of Array.isArray(value?.ballots) ? value.ballots.slice(0, CAMPUS_GAME_RULES.electionBallots) : []) {
    if (!isRecord(item) || !STUDENT_ID.test(item.studentId ?? '') || !PUBLIC_ID.test(item.candidateId ?? '') || !finite(item.at) || item.at < 0
      || !candidates.some((candidate) => candidate.id === item.candidateId) || ballots.some((other) => other.studentId === item.studentId)) continue;
    ballots.push({ studentId: item.studentId, candidateId: item.candidateId, at: item.at });
  }
  const derived = winnerFrom(candidates, ballots);
  const winner = isRecord(value?.winner) && derived && value.winner.id === derived.id && value.winner.votes === derived.votes ? derived : null;
  return { week, candidates, ballots, winner };
}

function standingsFrom(candidates, ballots) {
  const counts = new Map(candidates.map((candidate) => [candidate.id, 0]));
  for (const ballot of ballots) counts.set(ballot.candidateId, (counts.get(ballot.candidateId) ?? 0) + 1);
  return candidates.map((candidate) => ({ ...candidate, votes: counts.get(candidate.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function winnerFrom(candidates, ballots) {
  const winner = standingsFrom(candidates, ballots)[0];
  return winner && winner.votes > 0 ? { id: winner.id, votes: winner.votes } : null;
}

export function electionStandings(election) {
  const clean = sanitizeCampusElection(election);
  return standingsFrom(clean.candidates, clean.ballots);
}

export function electionWinner(election) {
  const winner = electionStandings(election)[0];
  return winner && winner.votes > 0 ? { id: winner.id, votes: winner.votes } : null;
}

export function nominateCampusElection(election, now, authority) {
  const state = sanitizeCampusElection(election);
  if (!finite(now) || now < 0) return resultFail(state, 'invalid_time', 'The campus server supplied an invalid election time.');
  const phase = electionPhaseAt(now);
  if (state.week !== phase.week) return resultFail(state, 'stale_election', 'This election belongs to another Lagos week. Load the current ballot.');
  if (phase.phase !== 'nominations') return resultFail(state, 'nominations_closed', 'Nominations run Monday to Wednesday, Lagos time.');
  if (!validAuthority(authority)) return resultFail(state, 'student_required', 'The server must supply a current matriculated student identity.');
  if (state.candidates.some((candidate) => candidate.id === authority.id || candidate.studentId === authority.studentId)) return resultFail(state, 'already_candidate', 'This student is already on the ballot.');
  if (state.candidates.length >= CAMPUS_GAME_RULES.electionCandidates) return resultFail(state, 'ballot_full', `The ballot is full at ${CAMPUS_GAME_RULES.electionCandidates} candidates.`);
  state.candidates.push({ id: authority.id, studentId: authority.studentId, name: cleanText(authority.name, 24, 'Student'), faculty: authority.faculty, hall: authority.hall, at: now });
  state.winner = null;
  return resultOk(state, 'nominated');
}

export function voteCampusElection(election, now, authority, candidateId) {
  const state = sanitizeCampusElection(election);
  if (!finite(now) || now < 0) return resultFail(state, 'invalid_time', 'The campus server supplied an invalid election time.');
  const phase = electionPhaseAt(now);
  if (state.week !== phase.week) return resultFail(state, 'stale_election', 'This ballot belongs to another Lagos week. Load the current ballot.');
  if (phase.phase !== 'voting') return resultFail(state, 'polls_closed', 'Voting runs Thursday to Saturday, Lagos time.');
  if (!validAuthority(authority)) return resultFail(state, 'student_required', 'The server must supply a current matriculated student identity.');
  if (state.ballots.some((ballot) => ballot.studentId === authority.studentId)) return resultFail(state, 'already_voted', 'This student already voted. A cast ballot cannot be changed.');
  if (!PUBLIC_ID.test(candidateId ?? '') || !state.candidates.some((candidate) => candidate.id === candidateId)) return resultFail(state, 'invalid_candidate', 'Choose a candidate from this week’s ballot.');
  if (state.ballots.length >= CAMPUS_GAME_RULES.electionBallots) return resultFail(state, 'ballot_limit', 'The shared ballot reached its supported record limit.');
  state.ballots.push({ studentId: authority.studentId, candidateId, at: now }); state.winner = null;
  return resultOk(state, 'voted');
}

export function finalizeCampusElection(election, now) {
  const state = sanitizeCampusElection(election);
  if (!finite(now) || now < 0) return resultFail(state, 'invalid_time', 'The campus server supplied an invalid election time.');
  const phase = electionPhaseAt(now);
  if (state.week !== phase.week) return resultFail(state, 'stale_election', 'This election belongs to another Lagos week. Load the current ballot.');
  if (phase.phase !== 'results') return resultFail(state, 'polls_open', 'Results are final on Sunday, Lagos time.');
  state.winner = electionWinner(state);
  return resultOk(state, 'finalized');
}

export const emptyCampusLeaderboard = (week) => ({ week, records: [] });

export function sanitizeCampusLeaderboard(value, now) {
  if (!finite(now) || now < 0) return emptyCampusLeaderboard(safeWeek(value?.week) ? value.week : 0);
  const week = lagosTime(now).week;
  if (!isRecord(value) || value.week !== week) return emptyCampusLeaderboard(week);
  const records = [];
  for (const item of Array.isArray(value.records) ? value.records.slice(0, CAMPUS_GAME_RULES.leaderboardRecords) : []) {
    if (!isRecord(item) || !PUBLIC_ID.test(item.lifeId ?? '') || !STUDENT_ID.test(item.studentId ?? '') || !safeDay(item.day)
      || lagosTime(lagosDayStart(item.day)).week !== week || !GAME_IDS.includes(item.game) || !Number.isSafeInteger(item.score)
      || item.score < 0 || item.score > GAME_SCORE_CAPS[item.game] || !CAMPUS_FACULTIES.includes(item.faculty)
      || (item.hall !== null && !CAMPUS_HALLS.includes(item.hall))
      || records.some((record) => record.lifeId === item.lifeId && record.day === item.day && record.game === item.game)) continue;
    records.push({ lifeId: item.lifeId, studentId: item.studentId, day: item.day, game: item.game, score: item.score, faculty: item.faculty, hall: item.hall });
  }
  return { week, records };
}

export function creditCampusLeaderboard(leaderboard, result, now) {
  if (!finite(now) || now < 0) return resultFail(sanitizeCampusLeaderboard(leaderboard, now), 'invalid_time', 'The campus server supplied an invalid leaderboard time.');
  const state = sanitizeCampusLeaderboard(leaderboard, now), time = lagosTime(now);
  if (!isRecord(result) || !PUBLIC_ID.test(result.lifeId ?? '') || !STUDENT_ID.test(result.studentId ?? '') || result.day !== time.day
    || !GAME_IDS.includes(result.game) || !Number.isSafeInteger(result.score) || result.score < 0 || result.score > GAME_SCORE_CAPS[result.game]
    || !CAMPUS_FACULTIES.includes(result.faculty) || (result.hall !== null && !CAMPUS_HALLS.includes(result.hall))) {
    return resultFail(state, 'invalid_result', 'The server supplied an invalid campus game result.');
  }
  if (state.records.some((record) => record.lifeId === result.lifeId && record.day === result.day && record.game === result.game)) {
    return resultFail(state, 'already_credited', 'This life already has a result for this game today.');
  }
  if (state.records.length >= CAMPUS_GAME_RULES.leaderboardRecords) return resultFail(state, 'leaderboard_full', 'This week’s leaderboard reached its supported record limit.');
  state.records.push({ lifeId: result.lifeId, studentId: result.studentId, day: result.day, game: result.game, score: result.score, faculty: result.faculty, hall: result.hall });
  return resultOk(state, 'credited');
}

export function campusLeaderboardStandings(leaderboard, now, filter = {}) {
  if (!finite(now) || now < 0) return [];
  const state = sanitizeCampusLeaderboard(leaderboard, now);
  if (filter.faculty !== undefined && !CAMPUS_FACULTIES.includes(filter.faculty)) return [];
  if (filter.hall !== undefined && !CAMPUS_HALLS.includes(filter.hall)) return [];
  const scores = new Map();
  for (const record of state.records) {
    if (filter.faculty !== undefined && record.faculty !== filter.faculty) continue;
    if (filter.hall !== undefined && record.hall !== filter.hall) continue;
    const current = scores.get(record.lifeId) ?? { id: record.lifeId, studentId: record.studentId, score: 0, results: 0 };
    current.score += record.score; current.results += 1; scores.set(record.lifeId, current);
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const VOLUNTEER_ACTIVITY = Object.freeze({
  id: 'unilag-volunteer', label: 'Aluta volunteering', icon: '🤝', duration: CAMPUS_GAME_RULES.volunteerSeconds,
  cost: 0, reward: 0, effects: { fun: CAMPUS_GAME_RULES.volunteerFun }, xp: { charisma: CAMPUS_GAME_RULES.volunteerXp },
  tags: ['aluta', 'volunteering', 'community'], beta: true,
  note: 'Original beta activity: once per Lagos day, no cash reward.',
  where: { venue: 'unilag', spot: 'student-union', spotLabel: 'Student Union', spotIcon: '🤝' },
});

export default {
  id: 'unilagCommunity',
  stateKeys: ['unilagCommunity'],
  sanitize,
  actions: {
    'unilag.club.join': joinClub,
    'unilag.club.leave': leaveClub,
    'unilag.trail.visit': visitTrail,
    'unilag.quiz.start': startQuiz,
    'unilag.quiz.answer': answerQuiz,
    'unilag.discovery': discover,
    'unilag.penalties': startPenalties,
    'unilag.election.nominate': serverOnly(localNomination),
    'unilag.election.vote': serverOnly(localVote),
  },
  active: {
    [CAMPUS_GAME_KIND]: { moves: false, sanitize: sanitizeCampusGame, complete: completeCampusGame },
  },
  activities: [VOLUNTEER_ACTIVITY],
  modifiers: {
    'activity.block'(value, state, { def }, ctx) {
      if (value || def?.id !== VOLUNTEER_ACTIVITY.id) return value;
      const student = studentBlock(state); if (student) return student;
      const day = lagosTime(nowOf(state, ctx)).day;
      return state.unilagCommunity.days.find((record) => record.day === day)?.volunteered
        ? { code: 'daily_limit', reason: 'You already completed today’s Aluta volunteering. Return after midnight, Lagos time.' } : null;
    },
  },
  on: {
    'activity.completed'(state, { id, tags }, ctx) {
      if (id !== VOLUNTEER_ACTIVITY.id) return;
      const day = lagosTime(nowOf(state, ctx)).day;
      dayRecord(state.unilagCommunity, day).volunteered = true;
      const profile = currentStudent(state);
      if (profile) emit(state, 'campus.volunteered', { studentId: profile.studentId, day, faculty: profile.faculty, hall: profile.hall, tags: Array.isArray(tags) ? tags : [] }, ctx);
    },
  },
  advance() {},
  view(state, ctx) {
    const community = state.unilagCommunity, profile = currentStudent(state), today = lagosTime(nowOf(state, ctx)).day;
    const current = community.quiz ? questionById.get(community.quiz.questionId) : null;
    return {
      clubs: CAMPUS_CLUBS.map((club) => ({ ...club, joined: community.clubs.includes(club.id) })),
      discoveries: Object.values(CAMPUS_DISCOVERIES).map((discovery) => ({ ...discovery, found: community.discoveries.includes(discovery.id) })),
      tables: STUDENT_UNION_TABLES,
      events: eventsAt(nowOf(state, ctx)),
      quiz: current ? { question: current, faculty: community.quiz.faculty } : null,
      today: community.days.find((day) => day.day === today) ?? { day: today, games: {}, volunteered: false },
      trail:{found:community.trail.length,total:DISCOVERY_TRAIL.length,complete:community.trail.length===DISCOVERY_TRAIL.length,shareText:`I explored ${community.trail.length}/${DISCOVERY_TRAIL.length} UNILAG landmarks in Allworld.`},
      eligible: Boolean(profile),
    };
  },
};


/** Visitor trail. Each landmark can be recorded once, using the server's current spot. */
function visitTrail(state,payload,ctx){
 const blocked=busy(state);if(blocked)return blocked;
 if(state.location!=='unilag')return fail(state,'wrong_place','Visit UNILAG to start the discovery trail.');
 const stop=DISCOVERY_TRAIL.find(item=>item.spot===state.spot);
 if(!stop)return fail(state,'not_trail_stop','Visit a landmark listed on the campus discovery trail.');
 const trail=state.unilagCommunity.trail;
 if(trail.includes(stop.id))return fail(state,'already_visited','This landmark is already on your trail card.');
 trail.push(stop.id);
 if(trail.length===DISCOVERY_TRAIL.length)emit(state,'campus.trail.completed',{count:trail.length},ctx);
 state.message=`UNILAG discovery trail: ${trail.length}/${DISCOVERY_TRAIL.length} landmarks.`;
 return ok(state,'trail_visited');
}

/** Aggregate validated weekly scores by faculty or hall. The shared store supplies records.
 * @param {object} leaderboard @param {number} now @param {'faculty'|'hall'} group
 * @returns {Array<{id:string,score:number,members:number}>} */
export function campusTeamStandings(leaderboard,now,group){
 if(!['faculty','hall'].includes(group))return [];
 const teams=new Map();
 for(const row of sanitizeCampusLeaderboard(leaderboard,now).records){
  if(!row[group])continue;
  if(!teams.has(row[group]))teams.set(row[group],{id:row[group],score:0,members:new Set()});
  const team=teams.get(row[group]);team.score+=row.score;team.members.add(row.lifeId);
 }
 return [...teams.values()].map(team=>({...team,members:team.members.size})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}

/** Server-only shared goal reducer. It counts a life at most once per Lagos day.
 * No client identity, cash or reward is accepted here. The host supplies a trusted volunteer event.
 * @param {object|null} previous @param {{lifeId:string,day:number}} contribution @param {number} now
 * @returns {{ok:boolean,code:string,reason?:string,state:object}} */
export function creditCampusGoal(previous,contribution,now){
 const time=lagosTime(now),valid=finite(now)&&now>=0;
 const raw=previous?.week===time.week&&Array.isArray(previous.contributions)?previous.contributions:[];
 const seen=new Set(),contributions=[];
 for(const c of raw.slice(0,200)){
  if(!PUBLIC_ID.test(c?.lifeId??'')||!safeDay(c?.day)||lagosTime(lagosDayStart(c.day)).week!==time.week)continue;
  const key=c.lifeId+':'+c.day;if(seen.has(key))continue;seen.add(key);contributions.push({lifeId:c.lifeId,day:c.day});
 }
 const state={week:time.week,target:200,contributions,complete:contributions.length>=200,beta:true};
 if(!valid||!PUBLIC_ID.test(contribution?.lifeId??'')||contribution?.day!==time.day)return resultFail(state,'invalid_contribution','The server must supply today’s verified volunteering contribution.');
 if(state.complete)return resultFail(state,'goal_complete','This week’s campus clean-up goal is complete.');
 if(seen.has(contribution.lifeId+':'+contribution.day))return resultFail(state,'already_contributed','This life already contributed today.');
 state.contributions.push({lifeId:contribution.lifeId,day:contribution.day});state.complete=state.contributions.length>=state.target;
 return resultOk(state,'contributed');
}
