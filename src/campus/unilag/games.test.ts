import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch as dispatchTyped, advanceLife, viewLife } from '../../life.ts';
import { VENUES } from '../../game/content/venues.ts';
import { registerSystem } from '../../game/registry.ts';
import { rebuildCatalogue } from '../../game/systems/activities.ts';
import { makeContext } from '../../game/util.ts';
import { xpForLevel } from '../../game/systems/skills.ts';
import studentSystem from './student.ts';
import { UNILAG_VENUE } from './content.ts';
import { PROGRAMMES, UNILAG_BETA_RULES } from './curriculum.ts';
import gamesSystem, {
  campusTeamStandings, creditCampusGoal, CAMPUS_CLUBS, CAMPUS_GAME_RULES, QUIZ_QUESTIONS, STUDENT_UNION_TABLES,
  campusLeaderboardStandings, creditCampusLeaderboard, electionPhaseAt, emptyCampusElection,
  emptyCampusLeaderboard, eventsAt, finalizeCampusElection, nominateCampusElection,
  sanitizeCampusElection, sanitizeCampusLeaderboard, voteCampusElection,
} from './games.ts';
import type { CampusEventMap } from '../../types/campus.ts';
import type { ActionBody } from '../../types/actions.ts';
import type { ActionOutcome, AdvanceOutcome, LifeContext, LifeContextInit, LifeState } from '../../types/life.ts';
import type { LifeView } from '../../types/view.ts';

/** Loose on purpose: several tests send malformed actions to see them refused. */
const dispatch = (state: LifeState, body: { type: string; payload?: Record<string, unknown>; actionId?: string }, ctx: LifeContext): ActionOutcome => dispatchTyped(state, body as ActionBody, ctx);

const DAY = 86400000;
const HOUR = 3600000;
const MONDAY_9 = Date.UTC(2026, 0, 5, 8); // Lagos is UTC+1.
const localAt = (dayOffset: number, hour: number, minute = 0, second = 0): number => MONDAY_9 + dayOffset * DAY + (hour - 9) * HOUR + minute * 60000 + second * 1000;

// Actual delivered venue, registered only inside this test process.
VENUES.unilag = UNILAG_VENUE;

type Seen = ['score', CampusEventMap['campus.game.scored']] | ['volunteer', CampusEventMap['campus.volunteered']];
const seen: Seen[] = [];
/** The Lagos week an election or leaderboard instant falls in. */
const weekOf = (now: number): number => {
  const { week } = electionPhaseAt(now);
  assert.ok(week !== null);
  return week;
};


registerSystem({
  id: 'unilagGamesTestProbe', stateKeys: [], sanitize() {}, actions: {}, advance() {},
  on: {
    'campus.game.scored': (_state: LifeState, data: CampusEventMap['campus.game.scored']) => seen.push(['score', structuredClone(data)]),
    'campus.volunteered': (_state: LifeState, data: CampusEventMap['campus.volunteered']) => seen.push(['volunteer', structuredClone(data)]),
  },
});
rebuildCatalogue('lagos');

interface Player {
  state: LifeState
  readonly now: number
  at(value: number): Player
  act(type: string, payload?: Record<string, unknown>, extraCtx?: LifeContextInit): ActionOutcome
  step(seconds: number): AdvanceOutcome
  spot(id: string): ActionOutcome
  view(): LifeView
}

function player(): Player {
  let now = MONDAY_9, sequence = 0;
  const state = createLife({ location: 'unilag', spot: 'senate', cash: 5000, skills: { coding: xpForLevel(1) } }, makeContext({ now, cityId: 'lagos', seed: 'games-create' }));
  const api: Player = {
    state,
    get now() { return now; },
    at(value: number) { now = value; return api; },
    act(type: string, payload: Record<string, unknown> = {}, extraCtx: LifeContextInit = {}) {
      sequence += 1;
      return dispatch(state, { type, payload, actionId: `games-${sequence}` }, makeContext({ now, cityId: 'lagos', seed: `games-${sequence}`, ...extraCtx }));
    },
    step(seconds: number) {
      now += seconds * 1000; sequence += 1;
      return advanceLife(state, seconds, makeContext({ now, cityId: 'lagos', seed: `games-step-${sequence}` }));
    },
    spot(id: string) { return api.act('spot', { id }); },
    view() { return viewLife(state, makeContext({ now, cityId: 'lagos', seed: 'games-view' })); },
  };
  assert.equal(api.act('unilag.apply', { programme: 'computer' }).code, 'admitted');
  assert.equal(api.act('unilag.matriculate').code, 'matriculated');
  const semester = PROGRAMMES.computer.semesters[0];
  assert.ok(semester);
  const courses = semester.courses.map((course) => course.id);
  assert.equal(api.act('unilag.register-semester', { courses }).code, 'registered');
  assert.equal(api.act('unilag.hostel.allocate', { hall: 'moremi' }).code, 'hostel_allocated');
  return api;
}

test('faculty quiz, discovery and penalties use server state, award no cash and credit once per Lagos day', () => {
  seen.length = 0;
  const p = player(), cash = p.state.cash;
  p.at(localAt(4, 18));
  assert.equal(p.act('unilag.quiz.start').code, 'wrong_place');
  p.spot('student-union');
  assert.equal(p.act('unilag.quiz.start', { question: 'eng-binary', answer: 'a', score: 999 }).code, 'quiz_started');
  const quiz = p.view().unilagCommunity.quiz;
  assert.ok(quiz);
  assert.equal(QUIZ_QUESTIONS.Engineering.some((question) => question.id === quiz.question.id), true);
  assert.equal(JSON.stringify(quiz).includes('answer'), false, 'the view never returns the answer key');
  const firstOption = quiz.question.options[0];
  assert.ok(firstOption);
  const answer = firstOption.id;
  assert.match(p.act('unilag.quiz.answer', { answer, score: 999 }).code, /correct|incorrect/);
  assert.equal(p.act('unilag.quiz.start').code, 'daily_limit');

  p.spot('lagoon-front');
  assert.equal(p.act('unilag.discovery', { spot: 'senate', score: 999 }).code, 'discovered', 'the actual state.spot wins over payload claims');
  p.spot('senate');
  assert.equal(p.act('unilag.discovery', { spot: 'senate' }).code, 'daily_limit');

  p.spot('sports-centre');
  assert.equal(p.act('unilag.penalties', { goals: 5, timing: 0 }).code, 'started');
  assert.equal(p.state.activeAction?.duration, CAMPUS_GAME_RULES.penaltySeconds);
  assert.equal(p.step(CAMPUS_GAME_RULES.penaltySeconds).code, 'completed');
  assert.match(p.state.message, /[0-5] of 5 scored/);
  assert.equal(p.act('unilag.penalties').code, 'daily_limit');

  const scores = seen.flatMap((entry) => entry[0] === 'score' ? [entry[1]] : []);
  assert.deepEqual(scores.map((item) => item.game), ['quiz', 'discovery', 'penalties']);
  assert.ok(scores.every((item) => item.studentId === p.state.unilagStudent.studentId && item.faculty === 'Engineering' && item.hall === 'moremi'));
  assert.ok(scores.every((item) => Number.isInteger(item.score) && item.score >= 0));
  assert.equal(p.state.cash, cash, 'campus games never change cash');
});

test('penalty cancellation, clubs and Aluta volunteering respect caps and never pay money', () => {
  seen.length = 0;
  const p = player(), cash = p.state.cash;
  p.spot('sports-centre');
  assert.equal(p.act('unilag.penalties').code, 'started');
  p.step(CAMPUS_GAME_RULES.penaltySeconds - 1);
  assert.equal(p.act('cancel').code, 'cancelled');
  assert.equal(p.state.unilagCommunity.days.find((day) => day.day === Math.floor((MONDAY_9 + HOUR) / DAY))?.games.penalties, undefined);
  assert.equal(p.act('unilag.penalties').code, 'started');
  p.step(CAMPUS_GAME_RULES.penaltySeconds);

  assert.equal(p.act('unilag.club.join', { id: '__proto__' }).code, 'invalid_club');
  for (const club of CAMPUS_CLUBS.slice(0, CAMPUS_GAME_RULES.maxClubs)) assert.equal(p.act('unilag.club.join', { id: club.id }).code, 'joined');
  assert.equal(p.act('unilag.club.join', { id: CAMPUS_CLUBS.at(-1)?.id }).code, 'club_limit');
  assert.equal(p.act('unilag.club.leave', { id: CAMPUS_CLUBS[0]?.id }).code, 'left');

  p.spot('student-union');
  assert.equal(p.act('activity', { id: 'unilag-volunteer' }).code, 'started');
  p.step(CAMPUS_GAME_RULES.volunteerSeconds - 1);
  assert.equal(p.act('cancel').code, 'cancelled');
  assert.equal(p.act('activity', { id: 'unilag-volunteer' }).code, 'started');
  p.step(CAMPUS_GAME_RULES.volunteerSeconds);
  const volunteer = seen.flatMap((entry) => entry[0] === 'volunteer' ? [entry[1]] : [])[0];
  assert.ok(volunteer);
  assert.deepEqual(volunteer.tags, ['aluta', 'volunteering', 'community']);
  assert.equal(p.act('activity', { id: 'unilag-volunteer' }).code, 'daily_limit');
  assert.equal(p.state.cash, cash);
  assert.deepEqual(STUDENT_UNION_TABLES.map((table) => [table.id, table.game, table.seats, table.spot]), [['union-whot-1', 'whot', 4, 'student-union'], ['union-whot-2', 'whot', 4, 'student-union']], 'the Student Union tables are rows of the shared table registry');
  assert.equal(Object.hasOwn(gamesSystem.actions, 'unilag.night-class'), false, 'night class remains owned by the student system');
});

test('weekly event windows use Lagos time exactly', () => {
  assert.deepEqual(eventsAt(localAt(0, 0)).map((event) => event.id), ['freshers']);
  assert.deepEqual(eventsAt(localAt(0, 23, 59)).map((event) => event.id), ['freshers']);
  assert.deepEqual(eventsAt(localAt(1, 0)), []);
  assert.deepEqual(eventsAt(localAt(4, 17, 59)), []);
  assert.deepEqual(eventsAt(localAt(4, 18)).map((event) => event.id), ['quiz-night']);
  assert.deepEqual(eventsAt(localAt(4, 20, 59)).map((event) => event.id), ['quiz-night']);
  assert.deepEqual(eventsAt(localAt(4, 21)), []);
  assert.deepEqual(eventsAt(localAt(6, 13, 59)), []);
  assert.deepEqual(eventsAt(localAt(6, 14)).map((event) => event.id), ['convocation']);
  assert.deepEqual(eventsAt(localAt(6, 17, 59)).map((event) => event.id), ['convocation']);
  assert.deepEqual(eventsAt(localAt(6, 18)), []);
  assert.deepEqual(eventsAt(NaN), []);
});

const authority = (id: string, studentId: string, extra: Record<string, unknown> = {}) => ({ current: true, id, studentId, name: id.toUpperCase(), faculty: 'Engineering', hall: 'moremi', ...extra });

test('shared election reducers reject wrong phases, duplicate or stale ballots and finalize a stable winner', () => {
  const monday = localAt(0, 10), thursday = localAt(3, 10), sunday = localAt(6, 10);
  const week = weekOf(monday);
  let election = emptyCampusElection(week);
  assert.equal(nominateCampusElection(election, NaN, authority('bad-time', 'ULG-0001-000099')).code, 'invalid_time');
  let result = nominateCampusElection(election, monday, authority('ada', 'ULG-0001-000001'));
  assert.equal(result.code, 'nominated'); election = result.state;
  result = nominateCampusElection(election, monday, authority('bola', 'ULG-0001-000002'));
  assert.equal(result.code, 'nominated'); election = result.state;
  assert.equal(nominateCampusElection(election, monday, authority('ada-2', 'ULG-0001-000001')).code, 'already_candidate');
  assert.equal(voteCampusElection(election, monday, authority('voter', 'ULG-0001-000010'), 'ada').code, 'polls_closed');
  assert.equal(nominateCampusElection(election, thursday, authority('chidi', 'ULG-0001-000003')).code, 'nominations_closed');
  assert.equal(voteCampusElection(election, thursday, authority('fake', 'ULG-0001-000099', { current: false }), 'ada').code, 'student_required');

  result = voteCampusElection(election, thursday, authority('voter-a', 'ULG-0001-000010'), 'ada'); election = result.state;
  result = voteCampusElection(election, thursday, authority('voter-b', 'ULG-0001-000011'), 'bola'); election = result.state;
  assert.equal(voteCampusElection(election, thursday, authority('renamed', 'ULG-0001-000010'), 'bola').code, 'already_voted', 'a ballot cannot be changed through another public id');
  result = finalizeCampusElection(election, sunday);
  assert.equal(result.code, 'finalized');
  assert.deepEqual(result.state.winner, { id: 'ada', votes: 1 }, 'score tie breaks by candidate id');
  assert.deepEqual(sanitizeCampusElection({ ...result.state, winner: { id: 'bola', votes: 99 } }).winner, null, 'a forged winner is discarded');
  assert.equal(voteCampusElection(result.state, localAt(7, 10), authority('late', 'ULG-0001-000012'), 'ada').code, 'stale_election');
});

test('election life actions are server-only and local receipts have no cash effect', () => {
  const p = player(), cash = p.state.cash;
  const publicTry = p.act('unilag.election.nominate', { internal: true });
  assert.equal(publicTry.code, 'server_only'); assert.ok(!publicTry.ok); assert.match(publicTry.reason ?? '', /nothing was changed/);
  assert.equal(p.state.cash, cash);
  assert.equal(p.act('unilag.election.nominate', {}, { internal: true }).code, 'nominated');
  assert.equal(p.act('unilag.election.nominate', {}, { internal: true }).code, 'already_candidate');
  p.at(localAt(3, 10));
  assert.equal(p.act('unilag.election.vote', { candidate: '__proto__' }, { internal: true }).code, 'invalid_candidate');
  // A non-string id is refused: the JavaScript coerced it (PUBLIC_ID.test(12) read "12"); the typed guard needs a string. Intentional.
  assert.equal(p.act('unilag.election.vote', { candidate: 12 }, { internal: true }).code, 'invalid_candidate');
  assert.equal(p.act('unilag.election.vote', { candidate: 'ada' }, { internal: true }).code, 'voted');
  assert.equal(p.act('unilag.election.vote', { candidate: 'bola' }, { internal: true }).code, 'already_voted');
  assert.equal(p.state.cash, cash);
});

test('leaderboard reducer credits one result per life, day and game, sorts stably and rolls weekly', () => {
  const now = localAt(4, 19), day = Math.floor((now + HOUR) / DAY);
  let board = emptyCampusLeaderboard(weekOf(now));
  const entry = (lifeId: string, studentId: string, game: string, score: number, extra: Record<string, unknown> = {}) => ({ lifeId, studentId, day, game, score, faculty: 'Engineering', hall: 'moremi', ...extra });
  assert.equal(creditCampusLeaderboard(board, entry('bad-time', 'ULG-0001-000099', 'quiz', 2), NaN).code, 'invalid_time');
  const source = board, untouched = structuredClone(board);
  let result = creditCampusLeaderboard(board, entry('ada', 'ULG-0001-000001', 'quiz', 10), now); board = result.state;
  assert.deepEqual(source, untouched, 'the reducer did not mutate its input');
  assert.equal(creditCampusLeaderboard(board, entry('ada', 'ULG-0001-000001', 'quiz', 2), now).code, 'already_credited');
  result = creditCampusLeaderboard(board, entry('ada', 'ULG-0001-000001', 'penalties', 5), now); board = result.state;
  result = creditCampusLeaderboard(board, entry('bola', 'ULG-0001-000002', 'quiz', 10), now); board = result.state;
  result = creditCampusLeaderboard(board, entry('bola', 'ULG-0001-000002', 'discovery', 5), now); board = result.state;
  assert.deepEqual(campusLeaderboardStandings(board, now).map((item) => [item.id, item.score]), [['ada', 15], ['bola', 15]]);
  assert.deepEqual(campusLeaderboardStandings(board, now, { hall: 'moremi' }).map((item) => item.id), ['ada', 'bola']);
  assert.equal(creditCampusLeaderboard(board, entry('bad', 'ULG-0001-000003', 'quiz', 99), now).code, 'invalid_result');
  assert.equal(creditCampusLeaderboard(board, entry('bad', 'ULG-0001-000003', 'quiz', 5, { faculty: '__proto__' }), now).code, 'invalid_result');
  assert.equal(sanitizeCampusLeaderboard(board, localAt(7, 10)).records.length, 0, 'a new Lagos week starts a fresh board');
});

test('hostile per-life community state is bounded, cannot forge scores, and round-trips', () => {
  const p = player(), raw: Record<string, unknown> = { ...structuredClone(p.state) };
  raw.unilagCommunity = {
    clubs: ['__proto__', ...CAMPUS_CLUBS.flatMap((club) => [club.id, club.id]), 'x'],
    discoveries: ['__proto__', 'senate', 'senate', ...new Array<string>(100).fill('x')],
    days: Array.from({ length: 1000 }, (_, index) => ({ day: index, games: { quiz: index % 2 ? 999 : 10, discovery: -1, penalties: Infinity }, volunteered: index % 2 === 0 })),
    quiz: { day: Infinity, faculty: '__proto__', questionId: '__proto__', startedAt: NaN, answer: 'a' },
    volunteerDay: Infinity,
    elections: { nominated: Array.from({ length: 100 }, (_, index) => index), voted: [NaN, -1, ...Array.from({ length: 100 }, (_, index) => index)] },
    leaderboards: { forged: true }, election: { winner: 'me' },
  };
  raw.activeAction = { kind: 'campus-game', id: 'football-penalties', duration: Infinity, remaining: NaN, day: -1, score: 5 };
  const clean = createLife(raw, makeContext({ now: MONDAY_9, cityId: 'lagos', seed: 'hostile-games' }));
  assert.equal(clean.unilagCommunity.clubs.length <= CAMPUS_GAME_RULES.maxClubs, true);
  assert.deepEqual(clean.unilagCommunity.discoveries, ['senate']);
  assert.equal(clean.unilagCommunity.days.length <= CAMPUS_GAME_RULES.keptDays, true);
  assert.equal(clean.unilagCommunity.days.every((record) => record.games.quiz === undefined || record.games.quiz <= CAMPUS_GAME_RULES.quizCorrectScore), true);
  assert.equal(clean.unilagCommunity.quiz, null);
  assert.equal(clean.unilagCommunity.elections.nominated.length, 8);
  assert.equal(clean.unilagCommunity.elections.voted.length, 8);
  assert.equal(clean.activeAction, null);
  assert.equal(Object.hasOwn(clean.unilagCommunity, 'leaderboards'), false);
  assert.equal(Object.hasOwn(clean.unilagCommunity, 'election'), false);
  assert.deepEqual(createLife(structuredClone(clean), makeContext({ now: MONDAY_9, cityId: 'lagos', seed: 'hostile-games-reload' })), clean);
});


test('visitors complete the eight-stop trail with no money or student admission',()=>{
 const state=createLife({location:'unilag',spot:'main-gate'},makeContext({now:MONDAY_9,cityId:'lagos',seed:'visitor'}));
 const ctx=makeContext({now:MONDAY_9,cityId:'lagos',seed:'visit'}),cash=state.cash;
 for(const spot of ['main-gate','cafeteria','library','engineering','sports-centre','auditorium','lagoon-front','student-union']){
  dispatch(state,{type:'spot',payload:{id:spot}},ctx);
  assert.equal(dispatch(state,{type:'unilag.trail.visit',payload:{spot:'senate'}},ctx).code,'trail_visited');
  assert.equal(dispatch(state,{type:'unilag.trail.visit',payload:{}},ctx).code,'already_visited');
 }
 assert.equal(viewLife(state,ctx).unilagCommunity.trail.complete,true);assert.equal(state.cash,cash);
});

test('team standings aggregate teams and shared community goals reject replay',()=>{
 const now=MONDAY_9,day=Math.floor((now+3600000)/DAY);
 let board=emptyCampusLeaderboard(weekOf(now));
 for(const [lifeId,studentId,faculty,score] of [['ada','ULG-0001-000001','Engineering',10],['bola','ULG-0001-000002','Arts',2]])board=creditCampusLeaderboard(board,{lifeId,studentId,faculty,hall:'moremi',day,game:'quiz',score},now).state;
 assert.deepEqual(campusTeamStandings(board,now,'faculty').map(t=>[t.id,t.score]),[['Engineering',10],['Arts',2]]);
 assert.equal(campusTeamStandings(board,now,'hall')[0]?.score,12);
 const result=creditCampusGoal(null,{lifeId:'ada',day},now);assert.equal(result.code,'contributed');
 assert.equal(creditCampusGoal(result.state,{lifeId:'ada',day},now).code,'already_contributed');
});
