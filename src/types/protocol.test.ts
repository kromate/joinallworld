// Keeps the wire types honest. Everything here compares a runtime list exported next to a type
// with what the server really registers, sends or stores, so a branch that adds a route, a frame
// or a response field without updating src/types fails this file:
//   - the route and socket registries, read the way server/registry.test.ts reads them;
//   - the frame types the server sends and what the Cloudflare Worker implements, read from source;
//   - the exact key sets of real answers from a real server (server/test-fixture.ts).
//
//   node --experimental-strip-types --test src/types/protocol.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../server/test-fixture.ts'
import { buildRoutes } from '../../server/routes/index.ts'
import { buildSocketHandlers } from '../../server/ws/index.ts'
import { cityCatalogue, registeredCityIds } from '../game/cities/registry.ts'
import { CATEGORIES, STATUSES } from '../../server/support/service.ts'
import { REPORT_REASONS as SERVER_REPORT_REASONS } from '../../server/social/service.ts'
import {
  ACTION_DUPLICATE_RESPONSE_KEYS, ACTION_RESPONSE_KEYS, CHAT_FRAME_KEYS, CLIENT_FRAME_TYPES, ERROR_BODY_KEYS, HEALTH_RESPONSE_KEYS, HTTP_ROUTE_KEYS,
  LIFE_RESPONSE_KEYS, LIFE_RESPONSE_TEACHING_KEYS, ACTION_RESPONSE_TEACHING_KEYS, ACTION_DUPLICATE_RESPONSE_TEACHING_KEYS, PRESENCE_MEMBER_KEYS, OWN_SESSION_KEYS, PUBLIC_SESSION_KEYS, SERVER_FRAME_TYPES, SESSION_RESPONSE_KEYS, VOICE_CONFIG_RESPONSE_KEYS,
  WORKER_CLIENT_FRAME_TYPES, WORKER_HOST_ROUTE_KEYS, WORKER_HTTP_ROUTE_KEYS, WORKER_SERVER_FRAME_TYPES,
} from './protocol.ts'
import { CONVERSATION_KEYS, HOUSE_VIEW_KEYS, OWN_MESSAGE_KEYS, PEOPLE_LISTING_KEYS, REPORT_REASONS, SOCIAL_LIMITS_KEYS, SOCIAL_OVERVIEW_KEYS } from './social.ts'
import {
  ADS_RESPONSE_KEYS, GOV_RESPONSE_KEYS, GOV_RULES_KEYS, GOV_YOU_KEYS, HUNT_RESPONSE_KEYS, NEIGHBOURS_RESPONSE_KEYS, PREFS_RESPONSE_KEYS, PULSE_RESPONSE_KEYS,
  RADIO_RESPONSE_KEYS, RICH_LIST_RESPONSE_KEYS,
} from './civic.ts'
import {
  AUDIT_LINE_KEYS, FILE_REPORT_RESPONSE_KEYS, MOD_OVERVIEW_RESPONSE_KEYS, MUTE_KEYS, MY_REPORTS_RESPONSE_KEYS, STATEMENT_KEYS, STATEMENT_RESPONSE_KEYS, SUPPORT_CATEGORIES, SUPPORT_CONTEXT_KEYS,
  SUPPORT_RECEIPT_KEYS, SUPPORT_REPORT_KEYS, SUPPORT_STATUSES,
} from './support.ts'
import {
  CALENDAR_OCCURRENCE_KEYS, CLIENT_SIGNALS, CONSENT_VIEW_KEYS, DIGEST_KEYS, FUNNEL_STEPS, GROWTH_METRICS_RESPONSE_KEYS, HELLO_RESPONSE_KEYS, OUTREACH_MINE_KEYS,
  OUTREACH_OPERATOR_RESPONSE_KEYS, REFERRAL_VIEW_KEYS, SHARE_FACTS_KEYS, SHARE_KINDS, TABLE_STATE_FRAME_KEYS, TABLE_SUMMARY_KEYS,
} from './growth.ts'
import {
  WORLD_CITY_LGA_KEYS, WORLD_HOUSES_RESPONSE_KEYS, WORLD_LGA_RESPONSE_KEYS, WORLD_ME_RESPONSE_KEYS, WORLD_OWN_HOUSE_KEYS, WORLD_PERSON_KEYS,
} from './world.ts'
import { LGA_IDS } from './life.ts'
import { SHARE_KINDS as ENGINE_SHARE_KINDS } from '../game/share-model.ts'
import { CLIENT_SIGNALS as SERVER_CLIENT_SIGNALS, FUNNEL_ORDER } from '../../server/growth/metrics.ts'
import { COLLECTION_NAMES, DATABASE_KEYS } from '../../server/types.ts'
import type { ActionReceipt, CityLifeRecord, GrowthCollection, GrowthPlayerRecord, OnceReceipt, RouteContext, SessionRecord, ShareRecord } from '../../server/types.ts'

/** A host-free context for the registries: modules only read it when they are called. */
const bareContext = (): RouteContext => ({ core: {}, config: {}, store: {}, checks: {}, cityIds: [] }) as unknown as RouteContext

type Json = Record<string, unknown>
const root = join(import.meta.dirname, '..', '..')
const sorted = (list: Iterable<string>): string[] => [...list].sort()
const record = (value: unknown, what: string): Json => {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${what} is a JSON object`)
  return value as Json
}
const first = (value: unknown, what: string): Json => {
  assert.ok(Array.isArray(value) && value.length > 0, `${what} is a non-empty list`)
  return record((value as unknown[])[0], `${what}[0]`)
}
/** The value's own keys are exactly `expected` (which is exported next to the type it describes). */
function sameKeys(value: unknown, expected: readonly string[], what: string): Json {
  const object = record(value, what)
  assert.deepEqual(sorted(Object.keys(object)), sorted(expected), `${what}: the keys the server sent differ from the type's key list`)
  return object
}
const body = async (response: Response): Promise<Json> => record(await response.json() as unknown, 'response body')

/**
 * Every `{ type: '<frame-type>'` literal in the given source, comments removed: the frames a server
 * builds. Action types contain a dot and never match.
 */
function frameTypesIn(text: string): Set<string> {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return new Set([...source.matchAll(/\{\s*type:\s*'([a-z][a-z0-9-]*)'/g)].map((match) => match[1] ?? ''))
}
async function serverSources(): Promise<string> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      // server/telemetry builds Sentry and PostHog payloads (`{ type: 'transaction' …`), which go to those services, never to a socket.
      if (entry.isDirectory()) { if (path !== join(root, 'server', 'telemetry') && path !== join(root, 'server', 'testing')) await walk(path) }
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'test-fixture.ts' && entry.name !== 'types.ts') files.push(path)
    }
  }
  await walk(join(root, 'server'))
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
}

test('every registered route is typed, and every typed route is registered', () => {
  // The same host-free context server/registry.test.ts builds the registry with.
  const keys: string[] = buildRoutes(bareContext()).keys
  assert.deepEqual(sorted(keys), sorted(HTTP_ROUTE_KEYS), 'server/routes/*.ts and HTTP_ROUTE_KEYS (src/types/protocol.ts) list different routes')
  assert.equal(new Set(HTTP_ROUTE_KEYS).size, HTTP_ROUTE_KEYS.length)
  const original = ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'kano']
  assert.ok(original.every((id, index) => registeredCityIds().includes(id) && (index === 0 || registeredCityIds().indexOf(original[index - 1]!) < registeredCityIds().indexOf(id))), 'the original server city order is preserved')
  assert.deepEqual(registeredCityIds(), cityCatalogue().filter((city) => city.open).map((city) => city.id))
  assert.equal(new Set(registeredCityIds()).size, registeredCityIds().length)
})

test('every frame type the server accepts or sends is typed', async () => {
  const accepted = [...buildSocketHandlers(bareContext()).messages.keys()] as string[]
  assert.deepEqual(sorted(accepted), sorted(CLIENT_FRAME_TYPES), 'server/ws/*.ts and CLIENT_FRAME_TYPES list different message types')
  const sent = frameTypesIn(await serverSources())
  assert.deepEqual(sorted(sent), sorted(SERVER_FRAME_TYPES), 'the frames built in server/**/*.ts and SERVER_FRAME_TYPES differ')
})

test('the Cloudflare Worker runs the shared registries: the same routes and frames, plus what the types say only it does', async () => {
  const source = await readFile(join(root, 'deploy', 'cloudflare-worker.ts'), 'utf8')
  // The same modules as Node, not a second implementation: the registries are imported and built over one context.
  assert.match(source, /import \{ buildRoutes, ROUTE_MODULES \} from '\.\.\/server\/routes\/index\.ts'/)
  assert.match(source, /import \{ buildSocketHandlers \} from '\.\.\/server\/ws\/index\.ts'/)
  assert.match(source, /this\.routes = buildRoutes\(context, \[\.\.\.ROUTE_MODULES, telemetryRoutes\]\)/)
  assert.match(source, /this\.handlers = buildSocketHandlers\(context\)/)
  assert.deepEqual(sorted(WORKER_HTTP_ROUTE_KEYS), sorted(HTTP_ROUTE_KEYS))
  // The routes the host answers itself, before the registry.
  const own = new Set<string>()
  for (const match of source.matchAll(/url\.pathname === '(\/api\/[a-z-]+)' && raw\.method === '(GET|POST)'/g)) own.add(`${match[2]} ${match[1]}`)
  assert.deepEqual(sorted(own), sorted(WORKER_HOST_ROUTE_KEYS))
  // The frames the host handles and sends itself, beside the registry's.
  const accepted = new Set([...source.matchAll(/(?<!typeof )message\.type === '([a-z][a-z0-9-]*)'/g)].map((match) => match[1] ?? ''))
  assert.deepEqual(sorted(accepted), sorted(['chat', 'heartbeat-ack']), 'heartbeat-ack is the one frame the host consumes; a chat line is only given its body digest before the shared handler runs')
  assert.deepEqual(sorted(WORKER_CLIENT_FRAME_TYPES), sorted([...CLIENT_FRAME_TYPES, 'heartbeat-ack']))
  assert.deepEqual(sorted(frameTypesIn(source)), sorted(['chat', 'error', 'heartbeat']), 'the host builds only the error frame, its heartbeat, and a retried chat line from its receipt')
  assert.deepEqual(sorted(WORKER_SERVER_FRAME_TYPES), sorted([...SERVER_FRAME_TYPES, 'heartbeat']))
  // Every browser socket answers the heartbeat.
  for (const file of ['src/community.ts', 'src/app/features/social/socialClient.ts', 'src/tables/client.ts']) assert.match(await readFile(join(root, file), 'utf8'), /type: 'heartbeat-ack'/, file)
  // The documented addition to the health answer (WorkerHealthResponse).
  assert.match(source, /\{ transport: 'cloudflare', buildId: /)
})

test('only a trusted interactive-teaching host adds the ephemeral display capability to life and action snapshots', async (t) => {
  const enabled = await fixture(t, { interactiveTeachingStarts: true })
  const player = await enabled.device('Ada')
  const lifeResponse = await enabled.request('/api/life?city=lagos', undefined, player.cookie)
  const life = sameKeys(await body(lifeResponse), LIFE_RESPONSE_TEACHING_KEYS, 'enabled host life snapshot')
  assert.equal(life.interactiveTeachingStarts, true)

  const action = { actionId: enabled.id(), cityId: 'lagos', type: 'spot', payload: { id: 'trees' } }
  const accepted = sameKeys(await body(await enabled.request('/api/action', action, player.cookie)), ACTION_RESPONSE_TEACHING_KEYS, 'enabled host action snapshot')
  assert.equal(accepted.interactiveTeachingStarts, true)
  const duplicate = sameKeys(await body(await enabled.request('/api/action', action, player.cookie)), ACTION_DUPLICATE_RESPONSE_TEACHING_KEYS, 'enabled host duplicate snapshot')
  assert.equal(duplicate.interactiveTeachingStarts, true)

  const disabled = await fixture(t)
  const legacy = await disabled.device('Legacy')
  const oldLife = await body(await disabled.request('/api/life?city=lagos', undefined, legacy.cookie))
  assert.deepEqual(Object.keys(oldLife).sort(), [...LIFE_RESPONSE_KEYS].sort(), 'default-off keeps the existing wire keyset')
  const oldAction = await body(await disabled.request('/api/action', { actionId: disabled.id(), cityId: 'lagos', type: 'spot', payload: { id: 'trees' } }, legacy.cookie))
  assert.deepEqual(Object.keys(oldAction).sort(), [...ACTION_RESPONSE_KEYS].sort(), 'default-off does not add the capability')
})

test('core, social, civic and support answers carry exactly the typed keys', async (t) => {
  const moderatorToken = 'protocol-test-operator-token-0123456789'
  const options: Record<string, unknown> = { moderatorToken }
  const f = await fixture(t, options)
  const get = async (path: string, cookie?: string): Promise<Json> => body(await f.request(path, null, cookie))
  const post = async (path: string, payload: Json, cookie?: string): Promise<Json> => body(await f.request(path, payload, cookie))
  const operator = async (path: string, payload?: Json): Promise<Json> => body(await fetch(`${f.base}${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${moderatorToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  }))

  // ---- session, life, action ----
  sameKeys(await get('/api/health'), HEALTH_RESPONSE_KEYS, 'GET /api/health')
  const created = await f.request('/api/session', { name: 'Ada' })
  const cookie = String(created.headers.get('set-cookie')).split(';')[0] ?? ''
  const session = sameKeys(await body(created), SESSION_RESPONSE_KEYS, 'POST /api/session')
  const ada = sameKeys(session.session, OWN_SESSION_KEYS, 'session')
  sameKeys(await get('/api/session', cookie), SESSION_RESPONSE_KEYS, 'GET /api/session')
  sameKeys(await get('/api/session'), ERROR_BODY_KEYS, 'an error body')
  assert.deepEqual(await get('/api/life?city=atlantis', cookie), { error: 'invalid_city' })
  const life = sameKeys(await get('/api/life?city=lagos', cookie), LIFE_RESPONSE_KEYS, 'GET /api/life')
  assert.equal(typeof life.serverTime, 'number')
  const action = { actionId: f.id(), cityId: 'lagos', type: 'spot', payload: { id: 'trees' } }
  const done = sameKeys(await post('/api/action', action, cookie), ACTION_RESPONSE_KEYS, 'POST /api/action')
  assert.deepEqual([done.ok, done.code], [true, 'selected'])
  sameKeys(await post('/api/action', action, cookie), ACTION_DUPLICATE_RESPONSE_KEYS, 'a repeated action')
  const refused = await post('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'spot', payload: { id: 'no-such-spot' } }, cookie)
  assert.equal(refused.ok, false)
  assert.deepEqual(sorted(Object.keys(refused)).filter((key) => key !== 'reason'), sorted(ACTION_RESPONSE_KEYS), 'a refusal adds at most `reason`')

  // ---- venue room frames, voice configuration ----
  const peer = await f.socket({ cookie })
  const until = async (type: string): Promise<Json> => {
    for (let i = 0; i < 50; i++) { const frame = record(await peer.next() as unknown, 'frame'); if (frame.type === type) return frame }
    throw new Error(`No ${type} frame`)
  }
  peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }))
  const presence = sameKeys(await until('presence'), ['members', 'type'], 'presence frame')
  sameKeys(first(presence.members, 'members'), PRESENCE_MEMBER_KEYS, 'presence member')
  peer.ws.send(JSON.stringify({ type: 'chat', body: 'Hello park', clientId: 'protocol-test-1' }))
  sameKeys(await until('chat'), CHAT_FRAME_KEYS, 'chat frame')
  peer.ws.send(JSON.stringify({ type: 'no-such-frame' }))
  assert.deepEqual(await until('error'), { type: 'error', code: 'invalid_message', error: 'invalid_message' })
  peer.ws.send(JSON.stringify({ type: 'chat', body: 'x'.repeat(501), clientId: 'protocol-test-2' }))
  assert.deepEqual(await until('error'), { type: 'error', code: 'invalid_chat', error: 'invalid_chat', clientId: 'protocol-test-2' })
  sameKeys(await get('/api/voice-config', cookie), VOICE_CONFIG_RESPONSE_KEYS, 'GET /api/voice-config')

  // ---- social ----
  const fresh = await f.request('/api/session', { name: 'Chidi', onboarding: true })
  const freshCookie = String(fresh.headers.get('set-cookie')).split(';')[0] ?? ''
  assert.deepEqual(await get('/api/social/me', freshCookie), { error: 'onboarding_required' }, 'a life still in character creation has no social surface')
  const overview = sameKeys(await get('/api/social/me', cookie), SOCIAL_OVERVIEW_KEYS, 'GET /api/social/me')
  const ownHouse = sameKeys(overview.house, HOUSE_VIEW_KEYS.filter(key => key !== 'myCapture'), 'house')
  assert.equal(ownHouse.role, 'host', 'the host has no guest capture consent field')
  const limits = sameKeys(overview.limits, SOCIAL_LIMITS_KEYS, 'limits')
  assert.deepEqual(limits.reasons, [...REPORT_REASONS])
  assert.deepEqual([...SERVER_REPORT_REASONS], [...REPORT_REASONS])
  sameKeys(await get('/api/social/people?city=lagos', cookie), PEOPLE_LISTING_KEYS, 'GET /api/social/people')
  peer.ws.send(JSON.stringify({ type: 'people-list', cityId: 'lagos' }))
  sameKeys(await until('people'), [...PEOPLE_LISTING_KEYS.filter((key) => key !== 'serverTime'), 'type'], 'people frame')
  const bola = await f.device('Bola')
  await get('/api/social/me', bola.cookie)
  const sent = sameKeys(await post('/api/social/messages', { to: bola.id, body: 'How far?', clientId: f.id() }, cookie), ['code', 'conv', 'message', 'ok', 'serverTime'], 'POST /api/social/messages')
  sameKeys(sent.conv, CONVERSATION_KEYS, 'conversation')
  sameKeys(sent.message, OWN_MESSAGE_KEYS, 'message')
  const pushed = sameKeys(await until('dm'), ['conv', 'message', 'type'], 'dm frame')
  sameKeys(pushed.conv, CONVERSATION_KEYS, 'pushed conversation')
  assert.equal(record(sent.message, 'message').from !== null && record(record(sent.message, 'message').from, 'from').id, ada.id)

  // ---- civic ----
  sameKeys(await get('/api/civic/pulse?city=lagos', cookie), PULSE_RESPONSE_KEYS, 'GET /api/civic/pulse')
  const gov = sameKeys(await get('/api/civic/gov?city=lagos', cookie), GOV_RESPONSE_KEYS, 'GET /api/civic/gov')
  sameKeys(gov.rules, GOV_RULES_KEYS, 'gov.rules')
  sameKeys(gov.you, GOV_YOU_KEYS, 'gov.you')
  sameKeys(await get('/api/civic/neighbours?city=lagos', cookie), NEIGHBOURS_RESPONSE_KEYS, 'GET /api/civic/neighbours')
  sameKeys(await get('/api/civic/ads?city=lagos', cookie), ADS_RESPONSE_KEYS, 'GET /api/civic/ads')
  sameKeys(await get('/api/civic/hunt?city=lagos', cookie), HUNT_RESPONSE_KEYS, 'GET /api/civic/hunt')
  sameKeys(await get('/api/civic/radio?city=lagos&venue=quilox', cookie), RADIO_RESPONSE_KEYS, 'GET /api/civic/radio')
  sameKeys(await get('/api/civic/richlist?city=lagos', cookie), RICH_LIST_RESPONSE_KEYS, 'GET /api/civic/richlist')
  sameKeys(await post('/api/civic/prefs', { directory: false }, cookie), PREFS_RESPONSE_KEYS, 'POST /api/civic/prefs')

  // ---- support and the operator's view of it ----
  assert.deepEqual([...CATEGORIES], [...SUPPORT_CATEGORIES])
  assert.deepEqual([...STATUSES], [...SUPPORT_STATUSES])
  const filed = sameKeys(await post('/api/support/reports', { cityId: 'lagos', category: 'bug', text: 'The door would not open.', clientId: f.id() }, cookie), FILE_REPORT_RESPONSE_KEYS, 'POST /api/support/reports')
  sameKeys(filed.receipt, SUPPORT_RECEIPT_KEYS, 'receipt')
  const mine = sameKeys(await get('/api/support/reports', cookie), MY_REPORTS_RESPONSE_KEYS, 'GET /api/support/reports')
  sameKeys(first(mine.reports, 'reports'), SUPPORT_RECEIPT_KEYS, 'listed receipt')
  const statement = sameKeys(await get('/api/support/statement?city=lagos', cookie), STATEMENT_RESPONSE_KEYS, 'GET /api/support/statement')
  sameKeys(statement.statement, STATEMENT_KEYS, 'statement')
  assert.deepEqual(await body(await fetch(`${f.base}/api/mod/overview`)), { error: 'moderator_token_required' })
  sameKeys(await operator('/api/mod/overview'), MOD_OVERVIEW_RESPONSE_KEYS, 'GET /api/mod/overview')
  const problem = sameKeys(first((await operator('/api/mod/problems')).problems, 'problems'), SUPPORT_REPORT_KEYS, 'stored problem report')
  sameKeys(problem.context, SUPPORT_CONTEXT_KEYS, 'report context')
  const muted = sameKeys(await operator('/api/mod/mutes', { id: bola.id, minutes: 1, reason: 'protocol test' }), ['code', 'mute', 'ok', 'serverTime'], 'POST /api/mod/mutes')
  sameKeys(muted.mute, MUTE_KEYS, 'mute')
  sameKeys(first((await operator('/api/mod/audit')).audit, 'audit'), AUDIT_LINE_KEYS, 'audit line')

  // ---- settling in, the world and the invite landing ----
  const efe = await f.device('Efe')
  const act = async (type: string, payload: Json): Promise<Json> => post('/api/action', { actionId: f.id(), cityId: 'lagos', type, payload }, efe.cookie)
  const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
  const unplaced = sameKeys(await get('/api/world/me?city=lagos', efe.cookie), WORLD_ME_RESPONSE_KEYS, 'GET /api/world/me before settling in')
  assert.deepEqual([unplaced.placed, unplaced.lga, unplaced.plot, unplaced.counts], [false, null, null, null])
  for (const [type, payload, code] of [
    ['onboarding.look', { look }, 'look_saved'], ['onboarding.traits', { traits: ['musical', 'hustler'] }, 'traits_saved'],
    ['onboarding.dream', { dream: 'afrobeats-star' }, 'dream_saved'], ['onboarding.lottery', {}, 'rolled'], ['onboarding.home', { lga: 'ikeja' }, 'life_started'],
  ] as const) assert.equal((await act(type, payload)).code, code, type)
  const me = sameKeys(await get('/api/world/me?city=lagos', efe.cookie), WORLD_ME_RESPONSE_KEYS, 'GET /api/world/me')
  assert.deepEqual([me.placed, me.lga, me.hidden], [true, 'ikeja', false])
  const plot = sameKeys(me.plot, ['estate', 'lga', 'plot'], 'world plot')
  sameKeys(me.counts, ['houses', 'online', 'residents'], 'world counts')
  sameKeys(me.character, ['city'], 'character')
  const worldCity = sameKeys(await get('/api/world/city?city=lagos', efe.cookie), ['lgas', 'serverTime', 'v'], 'GET /api/world/city')
  assert.deepEqual((worldCity.lgas as Json[]).map((lga) => lga.id), [...LGA_IDS])
  sameKeys(first(worldCity.lgas, 'lgas'), WORLD_CITY_LGA_KEYS, 'city lga')
  sameKeys(await get(`/api/world/city?city=lagos&v=${String(worldCity.v)}`, efe.cookie), ['online', 'serverTime', 'unchanged', 'v'], 'an unchanged city')
  sameKeys(await get('/api/world/lga/ikeja?city=lagos', efe.cookie), WORLD_LGA_RESPONSE_KEYS, 'GET /api/world/lga/:id')
  assert.deepEqual(await get('/api/world/lga/atlantis?city=lagos', efe.cookie), { error: 'unknown_lga' })
  const estates = sameKeys(await get('/api/world/lga/ikeja/estates?city=lagos&count=4', efe.cookie), ['counts', 'from', 'serverTime', 'v'], 'GET /api/world/lga/:id/estates')
  sameKeys(await get(`/api/world/lga/ikeja/estates?city=lagos&count=4&v=${String(estates.v)}`, efe.cookie), ['serverTime', 'unchanged', 'v'], 'unchanged estates')
  const houses = sameKeys(await get(`/api/world/lga/ikeja/estate/${String(plot.estate)}/houses?city=lagos`, efe.cookie), WORLD_HOUSES_RESPONSE_KEYS, 'GET …/houses')
  sameKeys(first(houses.houses, 'houses'), WORLD_OWN_HOUSE_KEYS, 'the viewer’s own house')
  const people = sameKeys(await get('/api/world/lga/ikeja/people?city=lagos', efe.cookie), ['items', 'next', 'serverTime'], 'GET …/people')
  const resident = sameKeys(first(people.items, 'people'), WORLD_PERSON_KEYS, 'directory row')
  assert.deepEqual([resident.id, resident.home, resident.you], [efe.id, 'own', true])
  sameKeys(await get('/api/world/lga/ikeja/people?city=lagos&q=e', efe.cookie), ['items', 'next', 'serverTime', 'short'], 'a query that is too short')
  // Ada is in the park room (the socket above); Efe is settled, so nothing moves him: the landing only says where she can be found.
  const landing = await post('/api/social/join', { host: ada.id, cityId: 'lagos' }, efe.cookie)
  assert.deepEqual(sorted(Object.keys(landing)), ['code', 'host', 'hostStatus', 'ok', 'serverTime'], 'POST /api/social/join')
  assert.deepEqual([landing.ok, landing.code, landing.hostStatus], [true, 'out', 'out'])

  // ---- growth ----
  assert.deepEqual([...ENGINE_SHARE_KINDS], [...SHARE_KINDS])
  assert.deepEqual([...SERVER_CLIENT_SIGNALS], [...CLIENT_SIGNALS])
  assert.deepEqual([...FUNNEL_ORDER], [...FUNNEL_STEPS])
  assert.deepEqual(await post('/api/growth/hello', { cityId: 'lagos' }, freshCookie), { ok: false, code: 'not_ready', reason: 'Finish creating your character first.', serverTime: f.now() })
  const hello = sameKeys(await post('/api/growth/hello', { cityId: 'lagos', device: 'protocol-test-device-0001' }, efe.cookie), HELLO_RESPONSE_KEYS, 'POST /api/growth/hello')
  sameKeys(hello.referral, REFERRAL_VIEW_KEYS, 'referral view')
  sameKeys(hello.contact, OUTREACH_MINE_KEYS, 'contact')
  sameKeys(hello.digest, DIGEST_KEYS, 'digest')
  sameKeys(hello.away, ['hours', 'since'], 'away')
  for (const event of hello.events as unknown[]) sameKeys(event, CALENDAR_OCCURRENCE_KEYS, 'calendar occurrence')
  assert.equal(hello.consent, null)
  const shared = sameKeys(await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, efe.cookie), ['code', 'ok', 'serverTime', 'share'], 'POST /api/growth/share')
  const share = sameKeys(shared.share, ['code', 'facts', 'path'], 'share')
  const facts = sameKeys(share.facts, SHARE_FACTS_KEYS, 'share facts')
  assert.deepEqual([facts.kind, facts.name, facts.district], ['invite', 'Efe', 'Ikeja'])
  const found = sameKeys(await get(`/api/growth/share/${String(share.code)}`), ['by', 'facts', 'kind', 'ok', 'serverTime'], 'GET /api/growth/share/:code')
  assert.deepEqual(found.by, { id: efe.id, name: 'Efe' })
  assert.deepEqual(await get('/api/growth/share/nosuchcode'), { ok: false, code: 'unknown_link', reason: 'That link has expired or does not exist.', serverTime: f.now() })
  const linked = await post('/api/growth/referral/link', { cityId: 'lagos', code: share.code, device: 'protocol-test-device-0002' }, cookie)
  assert.deepEqual(linked, { ok: true, code: 'linked', by: 'Efe', serverTime: f.now() })
  assert.deepEqual(await post('/api/growth/consent', { age: 'adult' }, efe.cookie), { error: 'invalid_city' }, 'the consent route needs cityId like the others')
  const consent = sameKeys(await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, efe.cookie), ['code', 'consent', 'ok', 'serverTime'], 'POST /api/growth/consent')
  sameKeys(consent.consent, CONSENT_VIEW_KEYS, 'consent view')
  const mail = sameKeys(await post('/api/growth/email', { email: 'efe@example.org', consent: true }, efe.cookie), ['code', 'confirmPath', 'dryRun', 'email', 'ok', 'serverTime'], 'POST /api/growth/email (dry-run)')
  assert.deepEqual([mail.code, mail.dryRun, mail.email], ['dry_run', true, 'e•••@e•••.org'])
  assert.deepEqual(await post('/api/growth/email/remove', { cityId: 'lagos' }, efe.cookie), { ok: true, code: 'removed', removed: true, serverTime: f.now() })
  sameKeys(await get('/api/growth/push/key'), ['ok', 'publicKey', 'serverTime'], 'GET /api/growth/push/key')
  assert.deepEqual(await post('/api/growth/push/unsubscribe', { cityId: 'lagos' }, efe.cookie), { ok: true, code: 'unsubscribed', serverTime: f.now() })
  assert.deepEqual(await post('/api/growth/tables/claim', { cityId: 'lagos' }, efe.cookie), { ok: true, code: 'claimed', results: [], ratings: {}, serverTime: f.now() })
  assert.deepEqual(await post('/api/growth/client', { signals: ['save-data', 'no-such-signal'] }), { ok: true, counted: 1, serverTime: f.now() })
  sameKeys(await get('/api/telemetry/config'), ['enabled', 'serverTime'], 'GET /api/telemetry/config (telemetry is off)')

  // ---- table games (socket) ----
  peer.ws.send(JSON.stringify({ type: 'table-list', cityId: 'lagos', venue: 'park' }))
  const tables = sameKeys(await until('tables'), ['cityId', 'tables', 'type', 'venue'], 'tables frame')
  const table = sameKeys(first(tables.tables, 'tables'), TABLE_SUMMARY_KEYS, 'table summary')
  peer.ws.send(JSON.stringify({ type: 'table-sit', cityId: 'lagos', table: table.id }))
  const seated = sameKeys(await until('table-state'), TABLE_STATE_FRAME_KEYS, 'table-state frame')
  const seat = sameKeys(first(sameKeys(seated.table, TABLE_SUMMARY_KEYS, 'seated table').seats, 'seats'), ['away', 'bot', 'id', 'name'], 'a real player’s seat')
  assert.deepEqual([seated.you, seated.host, seat.id], [0, true, ada.id])
  sameKeys(first(seated.optionList, 'optionList'), ['label', 'name', 'names', 'value', 'values'], 'table option')
  peer.ws.send(JSON.stringify({ type: 'table-move', cityId: 'lagos', table: table.id, n: 0, move: null }))
  assert.deepEqual(await until('error'), { type: 'error', code: 'no_game', error: 'no_game', reason: 'There is no game on at this table.', message: 'There is no game on at this table.' })
  peer.ws.send(JSON.stringify({ type: 'table-leave', cityId: 'lagos', table: table.id }))

  // ---- the operator's view of growth ----
  const metrics = sameKeys(await operator('/api/mod/growth/metrics'), GROWTH_METRICS_RESPONSE_KEYS, 'GET /api/mod/growth/metrics')
  assert.deepEqual((metrics.funnel as Json[]).map((step) => step.step), [...FUNNEL_STEPS])
  const outreach = sameKeys(await operator('/api/mod/growth/outreach'), OUTREACH_OPERATOR_RESPONSE_KEYS, 'GET /api/mod/growth/outreach')
  sameKeys(outreach.email, ['awaitingConfirmation', 'configured', 'confirmed', 'dailyCap', 'from', 'lastError', 'live', 'off', 'origin', 'provider', 'sentToday'], 'outreach.email')
  sameKeys(outreach.push, ['dailyCap', 'devices', 'lastError', 'off', 'pausedUntil', 'sentToday', 'subscribers'], 'outreach.push')
  sameKeys(first(outreach.log, 'outreach log'), ['at', 'channel', 'kind', 'state'], 'outreach log line')
  assert.deepEqual(await operator('/api/mod/growth/outreach/switch', { channel: 'push', off: true }), { ok: true, channel: 'push', off: true, serverTime: f.now() })

  // ---- what was stored (server/types.ts) ----
  await f.flush()
  const database = record(JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as unknown, 'devices.json')
  for (const key of Object.keys(database)) assert.ok((DATABASE_KEYS as readonly string[]).includes(key), `devices.json has an untyped top-level key "${key}"`)
  for (const name of COLLECTION_NAMES) assert.ok(Object.hasOwn(database, name), `the ${name} collection was created`)
  const stored = sameKeys(record(database.sessions, 'sessions')[cookie.slice(4)], ['actions', 'character', 'cities', 'expiresAt', 'name', 'once', 'publicId', 'rev', 'secret'] satisfies (keyof SessionRecord)[], 'stored session')
  const growth = record(database.growth, 'growth')
  for (const key of Object.keys(growth)) assert.ok((['comeback', 'comebackStats', 'contacts', 'metrics', 'outreach', 'players', 'push', 'salt', 'shares', 'sweptAt', 'tables'] satisfies (keyof GrowthCollection)[] as string[]).includes(key), `the growth collection has an untyped key "${key}"`)
  sameKeys(record(growth.players, 'players')[efe.id], ['consent', 'counted', 'devices', 'invited', 'owed', 'ref', 'seen', 'shares', 'table', 'wins'] satisfies (keyof GrowthPlayerRecord)[], 'growth player')
  sameKeys(Object.values(record(growth.shares, 'shares'))[0], ['at', 'by', 'cityId', 'facts', 'joined', 'kind', 'opened'] satisfies (keyof ShareRecord)[], 'stored share')
  sameKeys(record(stored.cities, 'cities').lagos, ['salt', 'state', 'updatedAt'] satisfies (keyof CityLifeRecord)[], 'stored city life')
  sameKeys(Object.values(record(stored.actions, 'actions'))[0], ['actionAt', 'code', 'fingerprint', 'ok', 'type'] satisfies (keyof ActionReceipt)[], 'action receipt')
  sameKeys(Object.values(record(stored.once, 'once'))[0], ['at', 'fp', 'kind', 'result'] satisfies (keyof OnceReceipt)[], 'once receipt')
})
