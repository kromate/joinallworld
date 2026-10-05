// Tests of the Campus app. The model is tested directly; the components are compiled by the
// project's own Vite configuration and rendered to a string with Vue's server renderer, against the
// real store on the fake server. The shared board and its two writes are tested against a stand-in
// for the game's fetchJson, so the request paths and bodies are asserted.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { UnilagStudentView } from '../../../types/campus.ts'
import type { App } from '../../state/app.ts'
import type { Game } from '../../state/game.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import {
  BLANK_STUDENT, NOMINATE_NOTE, activeReason, admissionOf, allocationOf, at, canChangeProgramme, cgpaOf, clampCount, closeSemesterReason, courseControls, discoveryReason, enrolmentStep, first,
  formatCount, goalView, isTab, jobReason, markOf, nextSemester, nominateReason, normalizeShared, onCampus, penaltyReason, programmeActive, quizReason, sharedKey, shuttleReason, standingRows,
  storedLine, title, voteReason,
} from './campusModel.ts'
import type { Here, StudentLike } from './campusModel.ts'
import { CAMPUS_PANELS } from './register.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <M = { default: Component }>(path: string): Promise<M> => await vite.ssrLoadModule(path) as M
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return (await renderToString(createSSRApp({ render: () => h(component, props) }))).replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->/g, '')
}
const campusApp = (): Promise<string> => render('/src/app/features/campus/CampusApp.vue')
const EMOJI = /\p{Extended_Pictographic}/u

type Store = { choices: { tab: string; confirmDrop: boolean }; board: { key: string; generation: number; data: unknown; loading: boolean; error: string; at: number; pending: Set<string>; nominated: Set<number>; voted: Set<number> } }
let store: Store
const state = () => app.game.state.value
const stand = (patch: Record<string, unknown>): void => { app.game.state.value = { ...state(), ...patch } as typeof app.game.state.value }
let original: typeof app.game.state.value

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.js`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  original = app.game.state.value
  store = await load<Store>('/src/app/features/campus/useCampus.ts')
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })
beforeEach(() => {
  app.game.state.value = original
  store.choices.tab = 'overview'; store.choices.confirmDrop = false
  Object.assign(store.board, { key: '', generation: 0, data: null, loading: false, error: '', at: 0, pending: new Set(), nominated: new Set(), voted: new Set() })
})

// ---- registration -------------------------------------------------------------------------------

test('the panel is registered with the static metadata of the existing one', () => {
  const [panel] = CAMPUS_PANELS
  assert.equal(CAMPUS_PANELS.length, 1)
  assert.deepEqual({ id: panel?.id, title: panel?.title, placement: panel?.placement, order: panel?.order, group: panel?.group, tint: panel?.tint, live: panel?.live, kind: panel?.kind },
    { id: 'campus', title: 'Campus', placement: 'phone', order: 47, group: 'city', tint: '#8f2434', live: true, kind: 'vue' })
})

// ---- model --------------------------------------------------------------------------------------

const walking = (patch: Partial<Here> = {}): Here => ({ location: 'unilag', spot: 'senate', activeAction: null, ...patch })

test('where the Sim stands and what stops an action', () => {
  assert.equal(title('main-gate'), 'Main Gate'); assert.equal(title(null), '')
  assert.equal(onCampus(walking()), true); assert.equal(onCampus({ location: 'park' }), false)
  assert.equal(at(walking(), 'senate'), true); assert.equal(at(walking(), 'library'), false)
  assert.equal(at(walking({ location: 'park' }), 'senate'), false, 'the spot only counts on the campus')
  assert.equal(activeReason(walking(), false), 'Reconnect to do this.')
  assert.equal(activeReason(walking({ activeAction: { kind: 'activity' } as never }), true), 'Finish or cancel your current action first.')
  assert.equal(activeReason(walking(), true), '')
  assert.equal(first('', '', 'c', 'd'), 'c'); assert.equal(first('', ''), '')
  assert.equal(formatCount(1234.4), '1,234'); assert.equal(formatCount(-3), '0'); assert.equal(formatCount('x'), '0')
  assert.equal(clampCount('50'), 20); assert.equal(clampCount('0', 7), 7); assert.equal(clampCount('3.6'), 4)
  assert.ok(isTab('study')); assert.ok(!isTab('bank'))
  assert.equal(sharedKey({ session: { id: 'a' }, cityId: 'lagos' }), 'a:lagos'); assert.equal(sharedKey(null), 'guest:')
})

test('emoji in the content are drawn as the game\'s glyphs, and an unknown one as the mortarboard', () => {
  assert.equal(markOf('🏦'), 'bank')
  assert.equal(markOf('not an emoji'), 'campus')
  assert.equal(markOf(undefined), 'campus')
})

test('admission: needs the Senate, a skill and no current action, and says which is missing first', () => {
  const skills = { coding: { level: 0 }, charisma: { level: 0 } }
  const far = admissionOf(walking({ spot: 'library' }), true, null, skills)
  assert.deepEqual({ place: far.place, skillMet: far.skillMet, reason: far.reason, fee: far.fee }, { place: false, skillMet: false, reason: 'Go to Senate House before applying.', fee: 200 })
  assert.equal(admissionOf(walking(), true, null, skills).reason, 'Reach Coding level 1 or Charisma level 1 first.')
  assert.equal(admissionOf(walking(), true, { status: 'none', betaRules: { admissionFee: 250 } } as StudentLike, { ...skills, charisma: { level: 1 } }).reason, '')
  assert.equal(admissionOf(walking(), false, null, skills).reason, 'Reconnect to do this.')
})

const student = (patch: Record<string, unknown> = {}): UnilagStudentView => ({
  status: 'studying', programme: { id: 'computer', label: 'Computer Science', faculty: 'Engineering', department: 'Computer Science', spot: 'engineering' }, studentId: 'ULG-1234-123456', admittedDay: 1, applicationCount: 1,
  term: { semester: 1, attempt: 1, startDay: 10, deferredDays: 0, deadlineDay: 17, registeredCourses: [], attendance: {}, study: {}, assessments: {}, deferredAtDay: null },
  records: [], hostel: { allocations: [], storage: {} }, lifetime: { scholarshipPaid: false, campusJobDays: [] }, degree: null, courses: [], betaRules: { admissionFee: 200, tuition: 1000, levy: 100, hostelFee: 300 }, campusJobs: [], ...patch,
}) as unknown as UnilagStudentView

test('the enrolment step, the next semester and the programme options follow the status', () => {
  assert.equal(enrolmentStep(BLANK_STUDENT), 'apply')
  assert.equal(enrolmentStep({ status: 'dropped' }), 'apply')
  assert.equal(enrolmentStep({ status: 'admitted' }), 'matriculate')
  assert.equal(enrolmentStep({ status: 'matriculated', term: null, degree: null }), 'register')
  assert.equal(enrolmentStep(student()), null, 'studying: the timetable instead')
  assert.equal(nextSemester({ records: [] }), 1)
  assert.equal(nextSemester({ records: [{ semester: 1, passed: true }, { semester: 2, passed: false }] as never }), 2)
  assert.equal(canChangeProgramme({ status: 'matriculated', term: null, records: [] }), true)
  assert.equal(canChangeProgramme({ status: 'matriculated', term: null, records: [{}] as never }), false, 'a record locks the programme')
  assert.equal(programmeActive({ status: 'studying' }), true); assert.equal(programmeActive({ status: 'graduated' }), false)
})

test('academic record: CGPA from the course results, or the degree\'s', () => {
  assert.equal(cgpaOf(null), '—')
  assert.equal(cgpaOf(student({ degree: { cgpa: 4.5 } })), '4.50')
  const records = [{ courseResults: [{ credits: 3, points: 5 }, { credits: 1, points: 1 }] }, { courseResults: [{ credits: 2, points: 4 }] }]
  assert.equal(cgpaOf({ status: 'studying', records: records as never }), '4.00')
  assert.equal(allocationOf(student({ hostel: { allocations: [{ semester: 2, attempt: 1, hall: 'jaja', room: 3 }, { semester: 1, attempt: 1, hall: 'moremi', room: 4 }], storage: {} } }))?.room, 4)
  assert.equal(allocationOf(student()), null)
  assert.deepEqual(storedLine({ rice: 2, garri: 0, eggs: 1 }), [{ id: 'rice', text: 'Rice ×2' }, { id: 'eggs', text: 'Eggs ×1' }])
})

test('a course row: lectures by the clock, one assignment and one test each', () => {
  const course = { id: 'csc-101', title: 'Intro', credits: 3, slot: 'morning', attendance: 1, study: 0, assignment: null, test: 12 } as unknown as NonNullable<UnilagStudentView['courses']>[number]
  const morning = courseControls(course, '', 9 * 60 + 30)
  assert.deepEqual(morning.attend, { label: 'Attend lecture', reason: '', primary: true })
  assert.equal(morning.assignment.reason, ''); assert.equal(morning.test.reason, 'Test already completed.')
  assert.equal(courseControls(course, '', 20 * 60 + 5).attend.label, 'Join night class')
  const shut = courseControls(course, '', 12 * 60)
  assert.equal(shut.attend.label, 'Lecture closed'); assert.equal(shut.attend.primary, false)
  assert.equal(shut.attend.reason, 'Lecture opens 9:00 AM to 11:00 AM; night class is 8:00 PM to 10:00 PM.')
  assert.equal(courseControls(course, 'Go to Engineering for classes and assessments.', 9 * 60).attend.reason, 'Go to Engineering for classes and assessments.')
})

test('closing a semester waits for every test and for the deadline', () => {
  const tests = (...marks: (number | null)[]) => student({ courses: marks.map((test) => ({ test })) })
  assert.deepEqual(closeSemesterReason('', tests(10, null), 20), { reason: 'Complete every course test first.', primary: false })
  assert.deepEqual(closeSemesterReason('', tests(10, 12), 15), { reason: 'Semester closes in 2 Lagos day(s).', primary: false })
  assert.deepEqual(closeSemesterReason('', tests(10, 12), 17), { reason: '', primary: true })
  assert.equal(closeSemesterReason('', student({ status: 'deferred', courses: [] }), 17).reason, 'Resume this semester first.')
  assert.equal(closeSemesterReason('Reconnect to do this.', tests(10), 17).reason, 'Reconnect to do this.')
})

test('jobs, the shuttle, the quiz, penalties and discoveries each give the first thing in the way', () => {
  assert.equal(jobReason('', null, false, true, 'library'), 'Current matriculated students only.')
  assert.equal(jobReason('', student(), true, true, 'library'), 'You already completed a paid campus job today.')
  assert.equal(jobReason('', student(), false, false, 'library'), 'Go to Library first.')
  assert.equal(jobReason('', student(), false, true, 'library'), '')
  assert.equal(shuttleReason('', false, 'senate'), 'Stand at one of the eight shuttle stops first.')
  assert.equal(shuttleReason('', true, ''), 'Choose another stop.')
  assert.equal(quizReason('', false, true), 'Go to Student Union first.')
  assert.equal(quizReason('', true, false), 'Matriculate as a current student first.')
  assert.equal(penaltyReason('', true, false), 'Go to the Sports Centre first.')
  assert.equal(discoveryReason('', true, null, new Set()), 'Stand at a marked discovery landmark.')
  assert.equal(discoveryReason('', true, 'library', new Set(['library'])), 'This discovery is already logged.')
  assert.equal(discoveryReason('', true, 'library', new Set()), '')
})

test('the shared board: what counts as a board, the election rules by phase, standings and the goal', () => {
  const summary = { available: true, election: { week: 4, phase: 'voting', candidates: [], winner: null }, leaderboards: { faculty: [], hall: [], players: [] }, goal: { progress: 5, target: 20, complete: false } }
  assert.equal(normalizeShared(summary), summary)
  assert.equal(normalizeShared({ ok: true, summary }), summary, 'a write answers with the board inside')
  assert.equal(normalizeShared({ election: null }), null)
  assert.equal(normalizeShared(null), null); assert.equal(normalizeShared('x'), null)
  assert.equal(nominateReason(false, true, 'nominations', false), 'Reconnect to nominate.')
  assert.equal(nominateReason(true, false, 'nominations', false), 'Matriculate as a current student first.')
  assert.equal(nominateReason(true, true, 'voting', false), 'Nominations run Monday to Wednesday.')
  assert.equal(nominateReason(true, true, 'nominations', true), 'You are already on this ballot.')
  assert.equal(nominateReason(true, true, 'nominations', false), '')
  assert.equal(voteReason(true, true, 'nominations', false), 'Voting runs Thursday to Saturday.')
  assert.equal(voteReason(true, true, 'voting', true), 'You already voted this week.')
  assert.equal(voteReason(true, true, 'voting', false), '')
  const rows = standingRows([{ id: 'engineering', score: 1200, members: 3 }, { name: 'Ada', score: 7, members: 1 }, { studentId: 'ULG-1', points: 2 }, {}, {}, { name: 'sixth' }])
  assert.equal(rows.length, 5, 'only the best five')
  assert.deepEqual(rows.slice(0, 3).map(({ name, members, score }) => [name, members, score]), [['Engineering', '3 players', '1,200'], ['Ada', '1 player', '7'], ['ULG 1', '', '2']])
  assert.deepEqual(standingRows(undefined), [])
  assert.deepEqual(goalView({ progress: 5, target: 20 }), { progress: '5', target: '20', percent: 25, complete: false })
  assert.equal(goalView({ progress: 50, target: 20, complete: true }).percent, 100)
  assert.equal(goalView(null).target, '1')
  assert.ok(NOMINATE_NOTE.startsWith('Aluta volunteering'))
})

// ---- the shared board over HTTP -----------------------------------------------------------------------

interface Call { path: string; options?: { method?: string; body?: Record<string, unknown> } }
function stand_in(answers: (call: Call) => unknown, patch: { connected?: boolean; cityId?: string } = {}) {
  const calls: Call[] = [], toasts: [string, string | undefined][] = []
  const game = {
    view: { value: { connected: true, cityId: 'lagos', session: { id: 'me' }, ...patch } },
    fetchJson: async (path: string, options?: Call['options']) => { calls.push({ path, options }); return answers({ path, options }) },
    toast: (message: string, kind?: string) => { toasts.push([message, kind]) },
  } as unknown as Game
  return { game, calls, toasts }
}
const board = (extra: Record<string, unknown> = {}) => ({ available: true, city: 'lagos', election: { week: 9, phase: 'nominations', candidates: [], winner: null }, leaderboards: { faculty: [], hall: [], players: [] }, goal: { progress: 1, target: 10, complete: false }, ...extra })

test('loading the board asks for the city, keeps what came back, and asks again only after 20 seconds or when forced', async () => {
  const { loadShared } = await load<typeof import('./useCampus.ts')>('/src/app/features/campus/useCampus.ts')
  const { game, calls } = stand_in(() => board())
  let now = 1_000_000
  loadShared(game, false, () => now)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(calls.map((call) => call.path), ['/api/campus?city=lagos'])
  assert.equal((store.board.data as { election: { week: number } }).election.week, 9)
  assert.equal(store.board.loading, false)
  now += 5000; loadShared(game, false, () => now); assert.equal(calls.length, 1, 'too soon')
  now += 20000; loadShared(game, false, () => now); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(calls.length, 2)
  loadShared(game, true, () => now); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(calls.length, 3, 'forced')
})

test('loading the board: offline asks nothing; an incomplete answer is an error; a new person starts clean', async () => {
  const { loadShared } = await load<typeof import('./useCampus.ts')>('/src/app/features/campus/useCampus.ts')
  const offline = stand_in(() => board(), { connected: false })
  loadShared(offline.game); assert.equal(offline.calls.length, 0)
  const bad = stand_in(() => ({ ok: true }))
  loadShared(bad.game); await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(store.board.error, 'The campus server returned an incomplete board.'); assert.equal(store.board.data, null)
  const other = stand_in(() => board(), { cityId: 'abuja' })
  other.game.view.value.session = { id: 'someone-else' } as never
  loadShared(other.game, true); await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(store.board.error, '', 'the other identity does not inherit the error')
  assert.equal(store.board.key, 'someone-else:abuja')
})

test('nominating and voting POST to the campus routes with the city and a fresh action id, then toast and read the board again', async () => {
  const { postShared } = await load<typeof import('./useCampus.ts')>('/src/app/features/campus/useCampus.ts')
  const { game, calls, toasts } = stand_in(({ options }) => (options?.method === 'POST' ? board({ ok: true }) : board()))
  await postShared(game, 'nominate')
  const post = calls[0]
  assert.equal(post?.path, '/api/campus/nominate'); assert.equal(post?.options?.method, 'POST')
  assert.equal(post?.options?.body?.['cityId'], 'lagos'); assert.match(String(post?.options?.body?.['actionId']), /^\d+:/); assert.equal('candidateId' in (post?.options?.body ?? {}), false)
  assert.deepEqual(toasts, [['Your nomination is on the ballot.', 'good']])
  assert.ok(store.board.nominated.has(9))
  assert.equal(calls[1]?.path, '/api/campus?city=lagos', 'the board is read again')
  await postShared(game, 'vote', 'cand-1')
  const vote = calls.find((call) => call.path === '/api/campus/vote')
  assert.equal(vote?.options?.body?.['candidateId'], 'cand-1')
  assert.ok(store.board.voted.has(9)); assert.equal(store.board.pending.size, 0)
  assert.deepEqual(toasts.at(-1), ['Your vote was counted.', 'good'])
})

test('a refused write says why; a write that never arrived says nothing was changed; offline sends nothing', async () => {
  const { postShared } = await load<typeof import('./useCampus.ts')>('/src/app/features/campus/useCampus.ts')
  const refused = stand_in(() => ({ ok: false, reason: 'Polls are closed.' }))
  await postShared(refused.game, 'vote', 'x')
  assert.deepEqual(refused.toasts, [['Polls are closed.', 'error']]); assert.equal(store.board.voted.size, 0)
  const down = stand_in(() => { throw new Error('Offline.') })
  await postShared(down.game, 'nominate')
  assert.deepEqual(down.toasts, [['Offline. Nothing was changed.', 'error']])
  const away = stand_in(() => board(), { connected: false })
  await postShared(away.game, 'nominate'); assert.equal(away.calls.length, 0)
})

// ---- components -----------------------------------------------------------------------------------

test('away from the campus: one trip away, nothing to do here, a way in, and no raw emoji anywhere', async () => {
  const html = await campusApp()
  const words = text(html)
  assert.ok(words.includes('University of Lagos · Akoka'))
  assert.ok(words.includes('Campus is one trip away'))
  assert.ok(words.includes('Explore as a visitor, or apply for the compressed campus programme.'))
  assert.ok(words.includes('Travel to UNILAG'))
  assert.ok(words.includes('Things to do here Travel to UNILAG to see activities at each landmark.'))
  assert.ok(words.includes('Open Bank'))
  assert.ok(words.includes('Travel to campus'))
  assert.ok(!words.includes('Walk around campus') && !words.includes('Landmark') && !html.includes('Select and walk'), 'no landmark picker (and no button that cannot be pressed) until the player is on the campus')
  assert.equal((html.match(/<select/g) ?? []).length, 1, 'the shuttle destination is the only choice shown')
  assert.match(html, /aria-current="page"[^>]*>Overview/)
  for (const tab of ['Overview', 'Study', 'Residence', 'Community']) assert.ok(words.includes(tab))
  assert.ok(words.includes('Discovery trail · 0/8'))
  assert.match(words, /Campus shuttle · ₦50/)
  assert.ok(words.includes('Stand at one of the eight shuttle stops first.'))
  assert.equal(EMOJI.test(html), false, 'the marks are drawn as glyphs')
  assert.ok(html.includes('<svg'))
})

test('on the campus: where you are, what can be done there with its duration and price, and the trail', async () => {
  stand({ location: 'unilag', spot: 'library', activeAction: null })
  const html = await campusApp()
  const words = text(html)
  assert.ok(words.includes('You are at Library'))
  assert.ok(words.includes('On campus'))
  assert.ok(words.includes('At Library') || /At [A-Z][\w ]+ /.test(words))
  assert.match(words, /Read and practise coding 12s · Free Start/)
  assert.equal((html.match(/>Start<\/button>/g) ?? []).length >= 2, true)
  assert.ok(words.includes('Walk here'))
  assert.ok(words.includes('Walk around campus') && words.includes('Select and walk'))
  const picker = /<select[^>]*>(.*?)<\/select>/.exec(html)?.[1] ?? ''
  assert.ok((picker.match(/<option/g) ?? []).length >= 8, 'the picker lists the landmarks of the campus')
  assert.match(picker, /<option value="library" selected>University Library<\/option>/, 'and starts on where the player stands')
  assert.equal(EMOJI.test(html), false)
})

test('a current action stops every start, with the one reason beside it', async () => {
  stand({ location: 'unilag', spot: 'library', activeAction: { kind: 'activity', id: 'x', duration: 10, remaining: 5 } })
  const html = await campusApp()
  assert.match(html, /<button type="button" class="is-primary ui-button" disabled[^>]*title="Finish or cancel your current action first\."[^>]*>Start<\/button>/)
  assert.ok(text(html).includes('Finish or cancel your current action first.'))
})

test('study: with no student, the record is empty, the application is at the Senate and the jobs are for students', async () => {
  store.choices.tab = 'study'
  const words = text(await campusApp())
  assert.ok(words.includes('Academic record Student ID Not issued CGPA — Status None'))
  assert.ok(words.includes('No completed semester record yet.'))
  assert.ok(words.includes('Apply for admission'))
  assert.ok(words.includes('The application fee is ₦200. Admission requires Coding level 1 or Charisma level 1.'))
  assert.ok(words.includes('Apply at Senate House'))
  assert.ok(words.includes('Go to Senate House before applying.') || words.includes('Reach Coding level 1 or Charisma level 1 first.'))
  assert.ok(words.includes('Scholarship and campus jobs'))
  assert.ok(words.includes('Library assistant'))
  assert.ok(!words.includes('Programme options'))
})

test('residence: before a semester there is nothing to allocate, and the way to Study', async () => {
  store.choices.tab = 'residence'
  const words = text(await campusApp())
  assert.ok(words.includes('Campus residence'))
  assert.ok(words.includes('This does not represent a real UNILAG allocation.'))
  assert.ok(words.includes('Open Study'))
})

test('community: no event, the quiz night rules, the clubs, penalties, and the board waits for the server', async () => {
  store.choices.tab = 'community'
  const words = text(await campusApp())
  assert.ok(words.includes('No timed campus event is running now.') || words.includes('Faculty quiz night'))
  assert.ok(words.includes('Quiz night runs Friday from 6:00 PM to 9:00 PM, Lagos time.'))
  assert.ok(words.includes('Robotics Club')); assert.ok(words.includes('Literary Society'))
  assert.ok(words.includes('Take five server-settled kicks once per Lagos day'))
  assert.ok(words.includes('Look for marked places at Senate, Library, Lagoon Front, Sports Centre and Student Union.'))
  assert.ok(words.includes('Shared campus'))
})

const sharedBoard = (extra: Record<string, unknown> = {}) => {
  store.board.key = sharedKey(app.game.view.value); store.board.data = board({
    election: { week: 9, phase: 'voting', candidates: [{ id: 'c1', name: '<b>Ada</b>', votes: 1 }, { id: 'c2', name: 'Bayo', votes: 0 }], winner: null },
    leaderboards: { faculty: [{ id: 'Engineering', score: 900, members: 4 }], hall: [], players: [{ id: 'p1', name: 'Ola', score: 3 }] },
    goal: { progress: 5, target: 20, complete: false }, ...extra,
  })
}

test('community: the live board - candidates as text, vote buttons, the goal bar and the standings', async () => {
  store.choices.tab = 'community'
  sharedBoard()
  const html = await campusApp()
  const words = text(html)
  assert.ok(words.includes('Student Union · Voting'))
  assert.ok(words.includes('Week 9'))
  assert.ok(words.includes('<b>Ada</b> 1 vote'), 'a name is text, never markup')
  assert.equal(html.includes('<b>Ada</b>'), false)
  assert.ok(words.includes('Bayo 0 votes'))
  assert.equal((html.match(/>Vote<\/button>/g) ?? []).length, 2)
  assert.ok(words.includes('5 / 20'))
  assert.ok(html.includes('aria-label="25% complete"')); assert.ok(html.includes('width:25%'))
  assert.ok(words.includes(NOMINATE_NOTE))
  assert.ok(words.includes('Faculty board 1. Engineering 4 players 900') || words.includes('Engineering 4 players 900'))
  assert.ok(words.includes('No hall scores yet.'))
  assert.ok(words.includes('Ola 3'))
  assert.ok(words.includes('Refresh live board'))
  assert.ok(words.includes('Go volunteer'))
})

test('community: a board for another city says it is Lagos only, with the way in', async () => {
  store.choices.tab = 'community'
  sharedBoard({ available: false, election: null, goal: null })
  const words = text(await campusApp())
  assert.ok(words.includes('The shared UNILAG election, leaderboards and weekly goal are available in Lagos. Travel to campus to take part.'))
  assert.ok(words.includes('Travel to UNILAG'))
})

test('community: a failed load says so and offers to try again', async () => {
  store.choices.tab = 'community'
  store.board.key = sharedKey(app.game.view.value); store.board.error = 'The campus board could not be reached.'
  const words = text(await campusApp())
  assert.ok(words.includes('The campus board could not be reached.')); assert.ok(words.includes('Try again'))
})
