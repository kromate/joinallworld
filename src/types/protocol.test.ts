// Keeps the wire types honest. Everything here compares a runtime list exported next to a type
// with what the server really registers, sends or stores, so a branch that adds a route, a frame
// or a response field without updating src/types fails this file:
//   - the route and socket registries, read the way server/registry.test.js reads them;
//   - the frame types the server sends and what the Cloudflare Worker implements, read from source;
//   - the exact key sets of real answers from a real server (server/test-fixture.js).
//
//   node --experimental-strip-types --test src/types/protocol.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../server/test-fixture.js'
import { buildRoutes } from '../../server/routes/index.js'
import { buildSocketHandlers } from '../../server/ws/index.js'
import { CITY_IDS as SERVER_CITY_IDS } from '../../server/protocol.js'
import { CATEGORIES, STATUSES } from '../../server/support/service.js'
import { REPORT_REASONS as SERVER_REPORT_REASONS } from '../../server/social/service.js'
import {
  ACTION_DUPLICATE_RESPONSE_KEYS, ACTION_RESPONSE_KEYS, CHAT_FRAME_KEYS, CITY_IDS, CLIENT_FRAME_TYPES, ERROR_BODY_KEYS, HEALTH_RESPONSE_KEYS, HTTP_ROUTE_KEYS,
  LIFE_RESPONSE_KEYS, PRESENCE_MEMBER_KEYS, PUBLIC_SESSION_KEYS, SERVER_FRAME_TYPES, SESSION_RESPONSE_KEYS, VOICE_CONFIG_RESPONSE_KEYS,
  WORKER_CLIENT_FRAME_TYPES, WORKER_HTTP_ROUTE_KEYS, WORKER_SERVER_FRAME_TYPES,
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
import { COLLECTION_NAMES, DATABASE_KEYS } from '../../server/types.ts'
import type { ActionReceipt, CityLifeRecord, OnceReceipt, SessionRecord } from '../../server/types.ts'

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
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') && entry.name !== 'test-fixture.js') files.push(path)
    }
  }
  await walk(join(root, 'server'))
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
}

test('every registered route is typed, and every typed route is registered', () => {
  // The same host-free context server/registry.test.js builds the registry with.
  const keys: string[] = buildRoutes({ core: {}, config: {}, store: {}, cityIds: [] }).keys
  assert.deepEqual(sorted(keys), sorted(HTTP_ROUTE_KEYS), 'server/routes/*.js and HTTP_ROUTE_KEYS (src/types/protocol.ts) list different routes')
  assert.equal(new Set(HTTP_ROUTE_KEYS).size, HTTP_ROUTE_KEYS.length)
  assert.deepEqual([...SERVER_CITY_IDS], [...CITY_IDS])
})

test('every frame type the server accepts or sends is typed', async () => {
  const accepted = [...buildSocketHandlers({ core: {}, config: {}, store: {}, cityIds: [] }).messages.keys()] as string[]
  assert.deepEqual(sorted(accepted), sorted(CLIENT_FRAME_TYPES), 'server/ws/*.js and CLIENT_FRAME_TYPES list different message types')
  const sent = frameTypesIn(await serverSources())
  assert.deepEqual(sorted(sent), sorted(SERVER_FRAME_TYPES), 'the frames built in server/**/*.js and SERVER_FRAME_TYPES differ')
})

test('the Cloudflare Worker implements exactly the subset the types say it does', async () => {
  const source = await readFile(join(root, 'deploy', 'cloudflare-worker.js'), 'utf8')
  const routes = new Set<string>()
  for (const match of source.matchAll(/url\.pathname === '(\/api\/[a-z-]+)' && request\.method === '(GET|POST)'/g)) routes.add(`${match[2]} ${match[1]}`)
  if (source.includes("url.pathname === '/api/health'")) routes.add('GET /api/health')
  assert.deepEqual(sorted(routes), sorted(WORKER_HTTP_ROUTE_KEYS))
  const accepted = new Set([...source.matchAll(/message\.type === '([a-z][a-z0-9-]*)'/g)].map((match) => match[1] ?? ''))
  assert.deepEqual(sorted(accepted), sorted(WORKER_CLIENT_FRAME_TYPES))
  assert.deepEqual(sorted(frameTypesIn(source)), sorted(WORKER_SERVER_FRAME_TYPES))
  for (const key of WORKER_HTTP_ROUTE_KEYS) assert.ok((HTTP_ROUTE_KEYS as readonly string[]).includes(key))
  // The documented difference in the health answer (HealthResponse vs WorkerHealthResponse).
  assert.match(source, /\{ ok: true, transport: 'cloudflare', buildId: /)
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
  const ada = sameKeys(session.session, PUBLIC_SESSION_KEYS, 'session')
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
  sameKeys(overview.house, HOUSE_VIEW_KEYS, 'house')
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

  // ---- what was stored (server/types.ts) ----
  await f.flush()
  const database = record(JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as unknown, 'devices.json')
  for (const key of Object.keys(database)) assert.ok((DATABASE_KEYS as readonly string[]).includes(key), `devices.json has an untyped top-level key "${key}"`)
  for (const name of COLLECTION_NAMES) assert.ok(Object.hasOwn(database, name), `the ${name} collection was created`)
  const stored = sameKeys(record(database.sessions, 'sessions')[cookie.slice(4)], ['actions', 'cities', 'expiresAt', 'name', 'once', 'publicId', 'secret'] satisfies (keyof SessionRecord)[], 'stored session')
  sameKeys(record(stored.cities, 'cities').lagos, ['salt', 'state', 'updatedAt'] satisfies (keyof CityLifeRecord)[], 'stored city life')
  sameKeys(Object.values(record(stored.actions, 'actions'))[0], ['actionAt', 'code', 'fingerprint', 'ok', 'type'] satisfies (keyof ActionReceipt)[], 'action receipt')
  sameKeys(Object.values(record(stored.once, 'once'))[0], ['at', 'fp', 'kind', 'result'] satisfies (keyof OnceReceipt)[], 'once receipt')
})
