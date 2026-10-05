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
import { LEFT_OUT, PLAYS } from '../../game/profile.ts';
import { emit } from '../../game/registry.ts';
import { addSkillXp, changeNeeds } from '../../game/api.ts';
import { busy, cleanText, fail, ok } from '../../game/util.ts';
import { lagosDayStart, lagosTime } from '../../game/clock.ts';
import { DISCOVERY_TRAIL } from './trail.ts';
import { PROGRAMMES, programmeOf } from './curriculum.ts';
import { freshCommunity } from './slices.ts';
import { STUDENT_REQUIRED, STUDENT_REQUIRED_BLOCK, VOLUNTEER_ACTIVITY, VOLUNTEER_RULES, hasCampus } from './volunteer.ts';
import { tablesAt } from '../../tables/places.ts';
import type {
  CampusCandidate, CampusClubDefinition, CampusClubId, CampusDiscoveryDefinition, CampusDiscoveryId, CampusElectionRecord,
  CampusEvent, CampusFaculty, CampusGameAction, CampusGameId, CampusPlayerStanding, CampusTeam, CampusTeamStanding,
  CommunityDay, ElectionPhase, HostelHallId, PendingQuiz, ProgrammeDefinition, QuizQuestion, StudentUnionTable, TrailStopId,
  UnilagCommunityState, UnilagCommunityView, UnilagStudentState,
  CampusActionType, CampusOutcome,
} from '../../types/campus.ts';
import type { Block } from '../../types/content.ts';
import type { ActionFailure, ActionOutcome, ActionSuccess, LifeContext, LifeState } from '../../types/life.ts';
import type { ActivityVetoCode } from '../../types/actions.ts';
import type { AttachedActivity, ServerOnlyAction, TypedActionHandler, SavedActiveAction, SavedInput, SystemDefinition } from '../../types/registry.ts';

// Narrowing versions of game/util.js isRecord/finite/safeCount (same tests).
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const CAMPUS_GAME_KIND = 'campus-game';
export const CAMPUS_HALLS: readonly HostelHallId[] = Object.freeze(['moremi', 'mariere', 'eni-njoku', 'jaja', 'fagunwa'] as const);
export const CAMPUS_FACULTIES: readonly CampusFaculty[] = Object.freeze([...new Set(Object.values(PROGRAMMES).map((programme) => programme.faculty))]);
export const CAMPUS_CLUBS: readonly Readonly<CampusClubDefinition>[] = Object.freeze([
  Object.freeze({ id: 'robotics', label: 'Robotics Club', spot: 'engineering' }),
  Object.freeze({ id: 'literary', label: 'Literary Society', spot: 'arts' }),
  Object.freeze({ id: 'debate', label: 'Debate Society', spot: 'student-union' }),
  Object.freeze({ id: 'enterprise', label: 'Enterprise Club', spot: 'management' }),
  Object.freeze({ id: 'football', label: 'Football Club', spot: 'sports-centre' }),
] as const);

/** The Student Union's game tables: the campus rows of the one table registry (src/tables/places.ts), played through the shared table framework. */
export const STUDENT_UNION_TABLES: readonly Readonly<StudentUnionTable>[] = Object.freeze(tablesAt('unilag').map(({ id, label, game, seats }): Readonly<StudentUnionTable> => Object.freeze({
  id, label, spot: 'student-union', game: game as StudentUnionTable['game'], seats,
})));

export const CAMPUS_GAME_RULES = Object.freeze({
  penaltySeconds: 15,
  penaltyKicks: 5,
  penaltyChance: 0.55,
  maxClubs: 3,
  keptDays: 14,
  quizCorrectScore: 10,
  quizWrongScore: 2,
  discoveryScore: 5,
  volunteerSeconds: VOLUNTEER_RULES.seconds,
  volunteerFun: VOLUNTEER_RULES.fun,
  volunteerXp: VOLUNTEER_RULES.xp,
  leaderboardRecords: 2048,
  electionCandidates: 16,
  electionBallots: 2048,
});

interface AuthoredQuestion {
  id: string
  prompt: string
  options: readonly (readonly [string, string])[]
  answer: string
}

const authoredQuestions: Readonly<Record<CampusFaculty, readonly AuthoredQuestion[]>> = Object.freeze({
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

const publicQuestion = (question: AuthoredQuestion): Readonly<QuizQuestion> => Object.freeze({ id: question.id, prompt: question.prompt,
  options: Object.freeze(question.options.map(([id, label]) => Object.freeze({ id, label }))) });
// Object.entries/fromEntries widen the faculty keys to string; the keys are exactly CampusFaculty.
export const QUIZ_QUESTIONS = Object.freeze(Object.fromEntries(Object.entries(authoredQuestions)
  .map(([faculty, questions]) => [faculty, Object.freeze(questions.map(publicQuestion))]))) as Readonly<Record<CampusFaculty, readonly Readonly<QuizQuestion>[]>>;
const answerByQuestion = new Map(Object.values(authoredQuestions).flat().map((question): [string, string] => [question.id, question.answer]));
const questionById = new Map(Object.values(QUIZ_QUESTIONS).flat().map((question): [string, Readonly<QuizQuestion>] => [question.id, question]));

export const CAMPUS_DISCOVERIES: Readonly<Record<CampusDiscoveryId, Readonly<CampusDiscoveryDefinition>>> = Object.freeze({
  senate: Object.freeze({ id: 'senate', label: 'Senate House steps', skill: 'charisma' }),
  library: Object.freeze({ id: 'library', label: 'Library stacks', skill: 'coding' }),
  'lagoon-front': Object.freeze({ id: 'lagoon-front', label: 'Lagoon Front', skill: 'fitness' }),
  'sports-centre': Object.freeze({ id: 'sports-centre', label: 'Sports Centre tunnel', skill: 'fitness' }),
  'student-union': Object.freeze({ id: 'student-union', label: 'Student Union notice wall', skill: 'hustle' }),
} as const);

const GAME_SCORE_CAPS: Readonly<Record<CampusGameId, number>> = Object.freeze({ quiz: CAMPUS_GAME_RULES.quizCorrectScore, discovery: CAMPUS_GAME_RULES.discoveryScore, penalties: CAMPUS_GAME_RULES.penaltyKicks });
const GAME_IDS = Object.freeze(Object.keys(GAME_SCORE_CAPS) as CampusGameId[]);
const PUBLIC_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STUDENT_ID = /^ULG-[0-9]{4}-[0-9]{6}$/;
const safeDay = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const safeWeek = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const nowOf = (state: LifeState, ctx?: LifeContext): number => (finite(ctx?.now) ? ctx.now : state.t);

// Runtime id guards (the saved/untrusted values are unknown until they pass one).
const isPublicId = (value: unknown): value is string => typeof value === 'string' && PUBLIC_ID.test(value);
const isStudentId = (value: unknown): value is string => typeof value === 'string' && STUDENT_ID.test(value);
const isHall = (value: unknown): value is HostelHallId => CAMPUS_HALLS.some((hall) => hall === value);
const isHallOrNull = (value: unknown): value is HostelHallId | null => value === null || isHall(value);
const isFaculty = (value: unknown): value is CampusFaculty => CAMPUS_FACULTIES.some((faculty) => faculty === value);
const isClubId = (value: unknown): value is CampusClubId => CAMPUS_CLUBS.some((club) => club.id === value);
const isDiscoveryId = (value: unknown): value is CampusDiscoveryId => typeof value === 'string' && Object.hasOwn(CAMPUS_DISCOVERIES, value);
const isTrailId = (value: unknown): value is TrailStopId => DISCOVERY_TRAIL.some((stop) => stop.id === value);
const isGameId = (value: unknown): value is CampusGameId => GAME_IDS.some((game) => game === value);

interface CurrentStudent {
  student: UnilagStudentState
  programme: ProgrammeDefinition
  studentId: string
  faculty: CampusFaculty
  hall: HostelHallId | null
}

function currentStudent(state: LifeState): CurrentStudent | null {
  const student = state.unilagStudent;
  const programme = isRecord(student) ? programmeOf(student.programme) : null;
  if (!programme || !isStudentId(student.studentId) || !['matriculated', 'studying', 'deferred'].includes(student.status)) return null;
  const term = isRecord(student.term) ? student.term : null;
  const allocation = term && Array.isArray(student.hostel?.allocations)
    ? student.hostel.allocations.findLast((item) => item.semester === term.semester && item.attempt === term.attempt) : null;
  const hall = allocation && isHall(allocation.hall) ? allocation.hall : null;
  return { student, programme, studentId: student.studentId, faculty: programme.faculty, hall };
}


function studentBlock(state: LifeState): Block<'student_required'> | null {
  return currentStudent(state) ? null : STUDENT_REQUIRED_BLOCK;
}

/** The refusal every student-only action gives a life that is not a current student. */
const studentRequired = (state: LifeState): ActionFailure<'student_required'> => fail(state, 'student_required', STUDENT_REQUIRED);

function campusSpotBlock(state: LifeState, spot: string): Block<'wrong_place'> | null {
  return state.location === 'unilag' && state.spot === spot ? null
    : { code: 'wrong_place', reason: `Go to UNILAG and stand at ${spot.replaceAll('-', ' ')} first.` };
}

/** The `{ ok, code, reason?, state }` the pure shared-store reducers answer with. */
export interface CampusReducerResult<S> {
  ok: boolean
  code: string
  reason?: string
  state: S
}

const resultFail = <S>(state: S, code: string, reason: string): CampusReducerResult<S> => ({ ok: false, code, reason, state });
const resultOk = <S>(state: S, code: string): CampusReducerResult<S> => ({ ok: true, code, state });

/** Active weekly campus events at `now`, using the Lagos wall clock. */
export function eventsAt(now: number): CampusEvent[] {
  if (!finite(now)) return [];
  const time = lagosTime(now), dayStart = lagosDayStart(time.day), events: CampusEvent[] = [];
  if (time.weekday === 1) events.push({ id: 'freshers', label: 'Freshers welcome', startsAt: dayStart, endsAt: dayStart + 86400000, tags: ['freshers', 'community'], beta: true });
  if (time.weekday === 5 && time.minuteOfDay >= 18 * 60 && time.minuteOfDay < 21 * 60) {
    events.push({ id: 'quiz-night', label: 'Faculty quiz night', startsAt: dayStart + 18 * 3600000, endsAt: dayStart + 21 * 3600000, tags: ['quiz', 'faculty'], beta: true });
  }
  if (time.weekday === 0 && time.minuteOfDay >= 14 * 60 && time.minuteOfDay < 18 * 60) {
    events.push({ id: 'convocation', label: 'Convocation gathering', startsAt: dayStart + 14 * 3600000, endsAt: dayStart + 18 * 3600000, tags: ['convocation', 'community'], beta: true });
  }
  return events;
}

function normalizedDay(value: unknown): CommunityDay | null {
  if (!isRecord(value) || !safeDay(value.day)) return null;
  const games: Partial<Record<CampusGameId, number>> = {};
  const savedGames = isRecord(value.games) ? value.games : {};
  for (const id of GAME_IDS) {
    const score = savedGames[id];
    if (safeInteger(score) && score >= 0 && score <= GAME_SCORE_CAPS[id]) games[id] = score;
  }
  const teams: Partial<Record<CampusGameId, CampusTeam>> = {};
  const savedTeams = isRecord(value.teams) ? value.teams : {};
  for (const game of GAME_IDS) {
    const team = savedTeams[game];
    // A studentId that is not a string never matched the pattern, except an array holding one (not a real save shape).
    if (isRecord(team) && isStudentId(team.studentId) && isFaculty(team.faculty) && isHallOrNull(team.hall)) teams[game] = { studentId: team.studentId, faculty: team.faculty, hall: team.hall };
  }
  return { day: value.day, games, ...(Object.keys(teams).length ? { teams } : {}), volunteered: value.volunteered === true };
}

function sanitize(input: SavedInput, state: LifeState, ctx: LifeContext): void {
  const saved = isRecord(input.unilagCommunity) ? input.unilagCommunity : {};
  const community = freshCommunity();
  community.clubs = [...new Set(asArray(saved.clubs).filter(isClubId))].slice(0, CAMPUS_GAME_RULES.maxClubs);
  community.discoveries = [...new Set(asArray(saved.discoveries).filter(isDiscoveryId))];
  community.trail = [...new Set(asArray(saved.trail).filter(isTrailId))];
  const days = new Map<number, CommunityDay>();
  for (const value of Array.isArray(saved.days) ? saved.days.slice(-CAMPUS_GAME_RULES.keptDays * 2) : []) {
    const day = normalizedDay(value); if (day) days.set(day.day, day);
  }
  community.days = [...days.values()].sort((a, b) => a.day - b.day).slice(-CAMPUS_GAME_RULES.keptDays);
  const savedElections = isRecord(saved.elections) ? saved.elections : {};
  community.elections = {
    nominated: [...new Set(asArray(savedElections.nominated).filter(safeWeek))].sort((a, b) => a - b).slice(-8),
    voted: [...new Set(asArray(savedElections.voted).filter(safeWeek))].sort((a, b) => a - b).slice(-8),
  };
  const profile = currentStudent(state), today = lagosTime(nowOf(state, ctx)).day;
  const quiz = saved.quiz, question = isRecord(quiz) && typeof quiz.questionId === 'string' ? questionById.get(quiz.questionId) : undefined;
  if (profile && question && isRecord(quiz) && quiz.day === today && quiz.faculty === profile.faculty && QUIZ_QUESTIONS[profile.faculty]?.some((item) => item.id === question.id)
    && finite(quiz.startedAt) && quiz.startedAt >= 0 && quiz.startedAt <= nowOf(state, ctx) && community.days.find((day) => day.day === today)?.games.quiz === undefined) {
    community.quiz = { day: today, faculty: profile.faculty, questionId: question.id, startedAt: quiz.startedAt };
  }
  state.unilagCommunity = community;
}

function dayRecord(community: UnilagCommunityState, day: number): CommunityDay {
  let record = community.days.find((item) => item.day === day);
  if (!record) {
    record = { day, games: {}, volunteered: false };
    community.days.push(record);
    community.days.sort((a, b) => a.day - b.day);
    if (community.days.length > CAMPUS_GAME_RULES.keptDays) community.days.splice(0, community.days.length - CAMPUS_GAME_RULES.keptDays);
  }
  return record;
}

function scoreEvent(state: LifeState, game: CampusGameId, score: number, day: number, ctx: LifeContext): boolean {
  const profile = currentStudent(state);
  if (!profile) return false;
  const record = dayRecord(state.unilagCommunity, day); record.teams ??= {}; record.teams[game] = { studentId: profile.studentId, faculty: profile.faculty, hall: profile.hall };
  emit(state, 'campus.game.scored', { studentId: profile.studentId, game, score, day, faculty: profile.faculty, hall: profile.hall }, ctx);
  return true;
}

function joinClub(state: LifeState, payload: Record<string, unknown>): CampusOutcome<'unilag.club.join'> {
  if (studentBlock(state)) return studentRequired(state);
  const club = CAMPUS_CLUBS.find((item) => item.id === payload?.id);
  if (!club) return fail(state, 'invalid_club', `Choose one of: ${CAMPUS_CLUBS.map((item) => item.id).join(', ')}.`);
  const community = state.unilagCommunity;
  if (community.clubs.includes(club.id)) return ok(state, 'already_joined');
  if (community.clubs.length >= CAMPUS_GAME_RULES.maxClubs) return fail(state, 'club_limit', `Join at most ${CAMPUS_GAME_RULES.maxClubs} campus clubs.`);
  community.clubs.push(club.id); state.message = `Joined ${club.label}.`;
  return ok(state, 'joined');
}

function leaveClub(state: LifeState, payload: Record<string, unknown>): CampusOutcome<'unilag.club.leave'> {
  const club = CAMPUS_CLUBS.find((item) => item.id === payload?.id);
  if (!club) return fail(state, 'invalid_club', `Choose one of: ${CAMPUS_CLUBS.map((item) => item.id).join(', ')}.`);
  const index = state.unilagCommunity.clubs.indexOf(club.id);
  if (index < 0) return fail(state, 'not_member', `You have not joined ${club.label}.`);
  state.unilagCommunity.clubs.splice(index, 1); state.message = `Left ${club.label}.`;
  return ok(state, 'left');
}

function startQuiz(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.quiz.start'> {
  const blocked = busy(state); if (blocked) return blocked;
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
  const place = campusSpotBlock(state, 'student-union'); if (place) return fail(state, place.code, place.reason);
  if (!eventsAt(nowOf(state, ctx)).some((event) => event.id === 'quiz-night')) return fail(state, 'quiz_closed', 'Faculty quiz night runs Friday from 6:00 PM to 9:00 PM, Lagos time.');
  const time = lagosTime(nowOf(state, ctx)), community = state.unilagCommunity, day = dayRecord(community, time.day);
  if (day.games.quiz !== undefined) return fail(state, 'daily_limit', 'You already completed today’s faculty quiz. Come back after midnight, Lagos time.');
  if (community.quiz) return fail(state, 'quiz_started', 'Answer the current faculty question before starting another.');
  const bank = QUIZ_QUESTIONS[profile.faculty];
  const question = bank[Math.floor(ctx.rng() * bank.length)];
  // Unreachable: every faculty has questions (the original threw a TypeError here).
  if (!question) return fail(state, 'quiz_closed', 'No faculty question is available.');
  community.quiz = { day: time.day, faculty: profile.faculty, questionId: question.id, startedAt: nowOf(state, ctx) };
  state.message = 'Faculty quiz started. Choose one answer.';
  return ok(state, 'quiz_started');
}

function answerQuiz(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.quiz.answer'> {
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
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

function discover(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.discovery'> {
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
  if (state.location !== 'unilag' || !isDiscoveryId(state.spot)) return fail(state, 'nothing_here', 'Stand at a marked UNILAG discovery spot and look again.');
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

function startPenalties(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.penalties'> {
  const blocked = busy(state); if (blocked) return blocked;
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
  const place = campusSpotBlock(state, 'sports-centre'); if (place) return fail(state, place.code, place.reason);
  const today = lagosTime(nowOf(state, ctx)).day, record = dayRecord(state.unilagCommunity, today);
  if (record.games.penalties !== undefined) return fail(state, 'daily_limit', 'You already took today’s penalty shoot-out. Try again after midnight, Lagos time.');
  state.activeAction = { kind: CAMPUS_GAME_KIND, id: 'football-penalties', duration: CAMPUS_GAME_RULES.penaltySeconds,
    remaining: CAMPUS_GAME_RULES.penaltySeconds, day: today };
  state.message = 'Penalty shoot-out started. The server will settle all five kicks.';
  return ok(state, 'started');
}

function sanitizeCampusGame(value: SavedActiveAction, state: LifeState): Pick<CampusGameAction, 'day'> | null {
  const profile = currentStudent(state), record = safeDay(value.day) ? state.unilagCommunity.days.find((item) => item.day === value.day) : null;
  if (!profile || value.id !== 'football-penalties' || value.duration !== CAMPUS_GAME_RULES.penaltySeconds
    || state.location !== 'unilag' || state.spot !== 'sports-centre' || !safeDay(value.day) || record?.games.penalties !== undefined) return null;
  return { day: value.day };
}

function completeCampusGame(state: LifeState, active: CampusGameAction, ctx: LifeContext): void {
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

type ElectionClock = { week: null; phase: 'invalid' } | { week: number; phase: ElectionPhase };

function electionPhaseAt(now: number): ElectionClock {
  if (!finite(now) || now < 0) return { week: null, phase: 'invalid' };
  const time = lagosTime(now);
  return { week: time.week, phase: time.weekday >= 1 && time.weekday <= 3 ? 'nominations' : time.weekday >= 4 && time.weekday <= 6 ? 'voting' : 'results' };
}
export { electionPhaseAt };

const serverOnly = <T extends CampusActionType>(run: TypedActionHandler<T>): ServerOnlyAction<T> => ({ serverOnly: true, run,
  refusal: 'This step is completed by the campus server together with the shared election store. Use the Student Union election screen; nothing was changed.' });

function localNomination(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.election.nominate'> {
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
  const phase = electionPhaseAt(nowOf(state, ctx));
  if (phase.phase !== 'nominations') return fail(state, 'nominations_closed', 'Nominations run Monday to Wednesday, Lagos time.');
  if (state.unilagCommunity.elections.nominated.includes(phase.week)) return fail(state, 'already_candidate', 'You are already on this week’s Student Union ballot.');
  state.unilagCommunity.elections.nominated.push(phase.week);
  state.unilagCommunity.elections.nominated = state.unilagCommunity.elections.nominated.slice(-8);
  emit(state, 'campus.election.nominated', { week: phase.week, studentId: profile.studentId, faculty: profile.faculty, hall: profile.hall }, ctx);
  state.message = 'Student Union nomination recorded.';
  return ok(state, 'nominated');
}

function localVote(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.election.vote'> {
  const profile = currentStudent(state); if (!profile) return studentRequired(state);
  const phase = electionPhaseAt(nowOf(state, ctx));
  if (phase.phase !== 'voting') return fail(state, 'polls_closed', 'Student Union voting runs Thursday to Saturday, Lagos time.');
  if (!isPublicId(payload?.candidate)) return fail(state, 'invalid_candidate', 'Choose a candidate from the shared Student Union ballot.');
  if (state.unilagCommunity.elections.voted.includes(phase.week)) return fail(state, 'already_voted', 'You already voted this week. A cast ballot cannot be changed.');
  state.unilagCommunity.elections.voted.push(phase.week);
  state.unilagCommunity.elections.voted = state.unilagCommunity.elections.voted.slice(-8);
  emit(state, 'campus.election.voted', { week: phase.week, candidate: payload.candidate, studentId: profile.studentId, faculty: profile.faculty, hall: profile.hall }, ctx);
  state.message = 'Student Union vote recorded.';
  return ok(state, 'voted');
}

type ElectionCandidate = CampusElectionRecord['candidates'][number];
type ElectionBallot = CampusElectionRecord['ballots'][number];

/** The identity the server derives from the authoritative life for a shared-store write. */
export interface CampusAuthority {
  current: true
  id: string
  studentId: string
  /** Not validated here: cleanText() reduces it to a short string. */
  name?: unknown
  faculty: CampusFaculty
  hall: HostelHallId | null
}

/** Pure shared-election state. The server store owns this object, never a life save. */
export const emptyCampusElection = (week: number): CampusElectionRecord => ({ week, candidates: [], ballots: [], winner: null });

function validAuthority(value: unknown): value is CampusAuthority {
  return isRecord(value) && value.current === true && isPublicId(value.id) && isStudentId(value.studentId)
    && isFaculty(value.faculty) && isHallOrNull(value.hall);
}

export function sanitizeCampusElection(value: unknown): CampusElectionRecord {
  const input = isRecord(value) ? value : {};
  const week = safeWeek(input.week) ? input.week : 0, candidates: ElectionCandidate[] = [], ballots: ElectionBallot[] = [];
  for (const item of Array.isArray(input.candidates) ? input.candidates.slice(0, CAMPUS_GAME_RULES.electionCandidates) : []) {
    if (!isRecord(item) || !isPublicId(item.id) || !isStudentId(item.studentId) || !isFaculty(item.faculty)
      || !isHallOrNull(item.hall) || !finite(item.at) || item.at < 0 || candidates.some((other) => other.id === item.id || other.studentId === item.studentId)) continue;
    candidates.push({ id: item.id, studentId: item.studentId, name: cleanText(item.name, 24, 'Student'), faculty: item.faculty, hall: item.hall, at: item.at });
  }
  for (const item of Array.isArray(input.ballots) ? input.ballots.slice(0, CAMPUS_GAME_RULES.electionBallots) : []) {
    if (!isRecord(item) || !isStudentId(item.studentId) || !isPublicId(item.candidateId) || !finite(item.at) || item.at < 0
      || !candidates.some((candidate) => candidate.id === item.candidateId) || ballots.some((other) => other.studentId === item.studentId)) continue;
    ballots.push({ studentId: item.studentId, candidateId: item.candidateId, at: item.at });
  }
  const derived = winnerFrom(candidates, ballots);
  const winner = isRecord(input.winner) && derived && input.winner.id === derived.id && input.winner.votes === derived.votes ? derived : null;
  return { week, candidates, ballots, winner };
}

function standingsFrom(candidates: readonly ElectionCandidate[], ballots: readonly ElectionBallot[]): CampusCandidate[] {
  const counts = new Map(candidates.map((candidate): [string, number] => [candidate.id, 0]));
  for (const ballot of ballots) counts.set(ballot.candidateId, (counts.get(ballot.candidateId) ?? 0) + 1);
  return candidates.map((candidate) => ({ ...candidate, votes: counts.get(candidate.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function winnerFrom(candidates: readonly ElectionCandidate[], ballots: readonly ElectionBallot[]): { id: string; votes: number } | null {
  const winner = standingsFrom(candidates, ballots)[0];
  return winner && winner.votes > 0 ? { id: winner.id, votes: winner.votes } : null;
}

export function electionStandings(election: unknown): CampusCandidate[] {
  const clean = sanitizeCampusElection(election);
  return standingsFrom(clean.candidates, clean.ballots);
}

export function electionWinner(election: unknown): { id: string; votes: number } | null {
  const winner = electionStandings(election)[0];
  return winner && winner.votes > 0 ? { id: winner.id, votes: winner.votes } : null;
}

export function nominateCampusElection(election: unknown, now: number, authority: unknown): CampusReducerResult<CampusElectionRecord> {
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

export function voteCampusElection(election: unknown, now: number, authority: unknown, candidateId: unknown): CampusReducerResult<CampusElectionRecord> {
  const state = sanitizeCampusElection(election);
  if (!finite(now) || now < 0) return resultFail(state, 'invalid_time', 'The campus server supplied an invalid election time.');
  const phase = electionPhaseAt(now);
  if (state.week !== phase.week) return resultFail(state, 'stale_election', 'This ballot belongs to another Lagos week. Load the current ballot.');
  if (phase.phase !== 'voting') return resultFail(state, 'polls_closed', 'Voting runs Thursday to Saturday, Lagos time.');
  if (!validAuthority(authority)) return resultFail(state, 'student_required', 'The server must supply a current matriculated student identity.');
  if (state.ballots.some((ballot) => ballot.studentId === authority.studentId)) return resultFail(state, 'already_voted', 'This student already voted. A cast ballot cannot be changed.');
  if (!isPublicId(candidateId) || !state.candidates.some((candidate) => candidate.id === candidateId)) return resultFail(state, 'invalid_candidate', 'Choose a candidate from this week’s ballot.');
  if (state.ballots.length >= CAMPUS_GAME_RULES.electionBallots) return resultFail(state, 'ballot_limit', 'The shared ballot reached its supported record limit.');
  state.ballots.push({ studentId: authority.studentId, candidateId, at: now }); state.winner = null;
  return resultOk(state, 'voted');
}

export function finalizeCampusElection(election: unknown, now: number): CampusReducerResult<CampusElectionRecord> {
  const state = sanitizeCampusElection(election);
  if (!finite(now) || now < 0) return resultFail(state, 'invalid_time', 'The campus server supplied an invalid election time.');
  const phase = electionPhaseAt(now);
  if (state.week !== phase.week) return resultFail(state, 'stale_election', 'This election belongs to another Lagos week. Load the current ballot.');
  if (phase.phase !== 'results') return resultFail(state, 'polls_open', 'Results are final on Sunday, Lagos time.');
  state.winner = electionWinner(state);
  return resultOk(state, 'finalized');
}

/** One validated game result on the weekly leaderboard. */
export interface CampusLeaderboardRecord {
  lifeId: string
  studentId: string
  day: number
  game: CampusGameId
  score: number
  faculty: CampusFaculty
  hall: HostelHallId | null
}

/** The shared weekly leaderboard the server store owns. */
export interface CampusLeaderboard {
  week: number
  records: CampusLeaderboardRecord[]
}

export const emptyCampusLeaderboard = (week: number): CampusLeaderboard => ({ week, records: [] });

export function sanitizeCampusLeaderboard(value: unknown, now: number): CampusLeaderboard {
  const input = isRecord(value) ? value : null;
  if (!finite(now) || now < 0) return emptyCampusLeaderboard(safeWeek(input?.week) ? input.week : 0);
  const week = lagosTime(now).week;
  if (!input || input.week !== week) return emptyCampusLeaderboard(week);
  const records: CampusLeaderboardRecord[] = [];
  for (const item of Array.isArray(input.records) ? input.records.slice(0, CAMPUS_GAME_RULES.leaderboardRecords) : []) {
    if (!isRecord(item) || !isPublicId(item.lifeId) || !isStudentId(item.studentId) || !safeDay(item.day)
      || lagosTime(lagosDayStart(item.day)).week !== week || !isGameId(item.game) || !safeInteger(item.score)
      || item.score < 0 || item.score > GAME_SCORE_CAPS[item.game] || !isFaculty(item.faculty)
      || !isHallOrNull(item.hall)
      || records.some((record) => record.lifeId === item.lifeId && record.day === item.day && record.game === item.game)) continue;
    records.push({ lifeId: item.lifeId, studentId: item.studentId, day: item.day, game: item.game, score: item.score, faculty: item.faculty, hall: item.hall });
  }
  return { week, records };
}

export function creditCampusLeaderboard(leaderboard: unknown, result: unknown, now: number): CampusReducerResult<CampusLeaderboard> {
  if (!finite(now) || now < 0) return resultFail(sanitizeCampusLeaderboard(leaderboard, now), 'invalid_time', 'The campus server supplied an invalid leaderboard time.');
  const state = sanitizeCampusLeaderboard(leaderboard, now), time = lagosTime(now);
  if (!isRecord(result) || !isPublicId(result.lifeId) || !isStudentId(result.studentId) || result.day !== time.day
    || !isGameId(result.game) || !safeInteger(result.score) || result.score < 0 || result.score > GAME_SCORE_CAPS[result.game]
    || !isFaculty(result.faculty) || !isHallOrNull(result.hall)) {
    return resultFail(state, 'invalid_result', 'The server supplied an invalid campus game result.');
  }
  if (state.records.some((record) => record.lifeId === result.lifeId && record.day === result.day && record.game === result.game)) {
    return resultFail(state, 'already_credited', 'This life already has a result for this game today.');
  }
  if (state.records.length >= CAMPUS_GAME_RULES.leaderboardRecords) return resultFail(state, 'leaderboard_full', 'This week’s leaderboard reached its supported record limit.');
  state.records.push({ lifeId: result.lifeId, studentId: result.studentId, day: time.day, game: result.game, score: result.score, faculty: result.faculty, hall: result.hall });
  return resultOk(state, 'credited');
}

/** Optional narrowing of the standings; a value that is not a faculty / hall of the campus gives no standings. */
export interface CampusStandingsFilter {
  faculty?: unknown
  hall?: unknown
}

export function campusLeaderboardStandings(leaderboard: unknown, now: number, filter: CampusStandingsFilter = {}): Omit<CampusPlayerStanding, 'name'>[] {
  if (!finite(now) || now < 0) return [];
  const state = sanitizeCampusLeaderboard(leaderboard, now);
  if (filter.faculty !== undefined && !isFaculty(filter.faculty)) return [];
  if (filter.hall !== undefined && !isHall(filter.hall)) return [];
  const scores = new Map<string, Omit<CampusPlayerStanding, 'name'>>();
  for (const record of state.records) {
    if (filter.faculty !== undefined && record.faculty !== filter.faculty) continue;
    if (filter.hall !== undefined && record.hall !== filter.hall) continue;
    const current = scores.get(record.lifeId) ?? { id: record.lifeId, studentId: record.studentId, score: 0, results: 0 };
    current.score += record.score; current.results += 1; scores.set(record.lifeId, current);
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export { VOLUNTEER_ACTIVITY };

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
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
} satisfies Pick<SystemDefinition<'unilagCommunity'>, 'actions' | 'on' | 'advance'> : LEFT_OUT;

export default {
  id: 'unilagCommunity',
  stateKeys: ['unilagCommunity'],
  sanitize,
  active: {
    [CAMPUS_GAME_KIND]: { moves: false, sanitize: sanitizeCampusGame, complete: completeCampusGame },
  },
  activitiesFor: (cityId) => hasCampus(cityId) ? [VOLUNTEER_ACTIVITY] : [],
  modifiers: {
    'activity.block'(value, state, { def }, ctx): Block<ActivityVetoCode> | null {
      if (value || def?.id !== VOLUNTEER_ACTIVITY.id) return value;
      const student = studentBlock(state); if (student) return student;
      const day = lagosTime(nowOf(state, ctx)).day;
      return state.unilagCommunity.days.find((record) => record.day === day)?.volunteered
        ? { code: 'daily_limit', reason: 'You already completed today’s Aluta volunteering. Return after midnight, Lagos time.' } : null;
    },
  },
  view(state, ctx): UnilagCommunityView {
    const community = state.unilagCommunity, profile = currentStudent(state), today = lagosTime(nowOf(state, ctx)).day;
    const pending: PendingQuiz | null = community.quiz, current = pending ? questionById.get(pending.questionId) : null;
    return {
      clubs: CAMPUS_CLUBS.map((club) => ({ ...club, joined: community.clubs.includes(club.id) })),
      discoveries: Object.values(CAMPUS_DISCOVERIES).map((discovery) => ({ ...discovery, found: community.discoveries.includes(discovery.id) })),
      tables: STUDENT_UNION_TABLES,
      events: eventsAt(nowOf(state, ctx)),
      quiz: pending && current ? { question: current, faculty: pending.faculty } : null,
      today: community.days.find((day) => day.day === today) ?? { day: today, games: {}, volunteered: false },
      trail: { found: community.trail.length, total: DISCOVERY_TRAIL.length, complete: community.trail.length === DISCOVERY_TRAIL.length, shareText: `I explored ${community.trail.length}/${DISCOVERY_TRAIL.length} UNILAG landmarks in Allworld.` },
      eligible: Boolean(profile),
    };
  },
  ...play,
} satisfies SystemDefinition<'unilagCommunity'>;


/** Visitor trail. Each landmark can be recorded once, using the server's current spot. */
function visitTrail(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'unilag.trail.visit'> {
  const blocked = busy(state); if (blocked) return blocked;
  if (state.location !== 'unilag') return fail(state, 'wrong_place', 'Visit UNILAG to start the discovery trail.');
  const stop = DISCOVERY_TRAIL.find((item) => item.spot === state.spot);
  if (!stop) return fail(state, 'not_trail_stop', 'Visit a landmark listed on the campus discovery trail.');
  const trail = state.unilagCommunity.trail;
  if (trail.includes(stop.id)) return fail(state, 'already_visited', 'This landmark is already on your trail card.');
  trail.push(stop.id);
  if (trail.length === DISCOVERY_TRAIL.length) emit(state, 'campus.trail.completed', { count: trail.length }, ctx);
  state.message = `UNILAG discovery trail: ${trail.length}/${DISCOVERY_TRAIL.length} landmarks.`;
  return ok(state, 'trail_visited');
}

/** Aggregate validated weekly scores by faculty or hall. The shared store supplies records. */
export function campusTeamStandings(leaderboard: unknown, now: number, group: 'faculty' | 'hall'): CampusTeamStanding[] {
  if (!['faculty', 'hall'].includes(group)) return [];
  const teams = new Map<string, { id: string; score: number; members: Set<string> }>();
  for (const row of sanitizeCampusLeaderboard(leaderboard, now).records) {
    const id = row[group];
    if (!id) continue;
    let team = teams.get(id);
    if (!team) { team = { id, score: 0, members: new Set() }; teams.set(id, team); }
    team.score += row.score; team.members.add(row.lifeId);
  }
  return [...teams.values()].map((team) => ({ ...team, members: team.members.size })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** The week's shared volunteering goal, as kept by the server store. */
export interface CampusGoalState {
  week: number
  target: number
  contributions: { lifeId: string; day: number }[]
  complete: boolean
  beta: true
}

/** Server-only shared goal reducer. It counts a life at most once per Lagos day.
 * No client identity, cash or reward is accepted here. The host supplies a trusted volunteer event. */
export function creditCampusGoal(previous: unknown, contribution: unknown, now: number): CampusReducerResult<CampusGoalState> {
  const time = lagosTime(now), valid = finite(now) && now >= 0;
  const before = isRecord(previous) ? previous : {};
  const raw = before.week === time.week && Array.isArray(before.contributions) ? before.contributions : [];
  const seen = new Set<string>(), contributions: { lifeId: string; day: number }[] = [];
  for (const c of raw.slice(0, 200) as unknown[]) {
    if (!isRecord(c) || !isPublicId(c.lifeId) || !safeDay(c.day) || lagosTime(lagosDayStart(c.day)).week !== time.week) continue;
    const key = c.lifeId + ':' + c.day; if (seen.has(key)) continue; seen.add(key); contributions.push({ lifeId: c.lifeId, day: c.day });
  }
  const state: CampusGoalState = { week: time.week, target: 200, contributions, complete: contributions.length >= 200, beta: true };
  const given = isRecord(contribution) ? contribution : {};
  if (!valid || !isPublicId(given.lifeId) || given.day !== time.day) return resultFail(state, 'invalid_contribution', 'The server must supply today’s verified volunteering contribution.');
  if (state.complete) return resultFail(state, 'goal_complete', 'This week’s campus clean-up goal is complete.');
  if (seen.has(given.lifeId + ':' + given.day)) return resultFail(state, 'already_contributed', 'This life already contributed today.');
  state.contributions.push({ lifeId: given.lifeId, day: time.day }); state.complete = state.contributions.length >= state.target;
  return resultOk(state, 'contributed');
}
