// Server telemetry without a network: `fetch` is a fake transport that records what would be sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, flakyDisk } from '../test-fixture.ts';
import { ROUTE_MODULES } from '../routes/index.ts';
import telemetryRoutes from './routes.ts';
import { createServerTelemetry, useTelemetry, track, captureError } from './index.ts';
import { readTelemetryConfig, publicConfig, parseDsn, DEFAULT_POSTHOG_HOST } from './config.ts';
import { ANALYTICS_QUEUE_LIMIT, ERROR_QUEUE_LIMIT, framesOf } from './transport.ts';
import { socialEvents, createCoPresence, createVoice } from './instrument.ts';
import { EVENTS } from '../../src/telemetry/events.ts';
import type { TestContext } from 'node:test';
import type { TransportFetch } from './transport.ts';
import type { FlakyDisk, TestSocket } from '../test-fixture.ts';
import type { RouteModule, WsHandlerModule } from '../types.ts';

const ADA = '9d1c7e52-3b7a-4f0e-8a55-0c2d4e6f8a10', BOLA = '1f2e3d4c-5b6a-4788-9a0b-1c2d3e4f5a6b';
const ENV = { TELEMETRY_ENV: 'production', SENTRY_DSN_SERVER: 'https://serverkey@o1.ingest.sentry.example/42', SENTRY_DSN_CLIENT: 'https://clientkey@o1.ingest.sentry.example/41',
  POSTHOG_KEY: 'phc_projectkey123', POSTHOG_HOST: 'https://eu.i.posthog.com', BUILD_ID: 'build-7' };
const CHAT = 'meet me at the bar tonight, call 0803 555 0199';

type Dict = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected a ${what}`); return value; };
/** One request the fake transport recorded. */
interface Call { url: string; headers: Record<string, string>; body: string }
/** An analytics event as PostHog's batch carries it. */
interface Posted { event: string; distinct_id: string; timestamp: string; properties: Dict }
/** A Sentry event or transaction as the server sends it (the fields these tests read). */
interface SentryEvent {
  release: string; environment: string; level: string; tags: Dict; user?: { id: string }; message: string; fingerprint: string[]; transaction: string
  exception?: { values: { type: string; value: string; stacktrace: { frames: { filename: string }[] } }[] }
  sdk: { settings: { infer_ip: string } }; contexts: { trace: { op: string } }; timestamp: number; start_timestamp: number
}
interface SentryReport { header: { dsn: string }; item: { type: string }; event: SentryEvent; headers: Record<string, string>; url: string }
/** What an answer of the routes under test carries; a refusal has `ok: false` and a `code`. */
interface Reply { enabled: boolean; analytics: boolean; under18: boolean | undefined; error: string | undefined; ok: boolean; code: string; duplicate: boolean | undefined; consent: { age: string } }
/** A frame the sockets deliver, read by name. */
interface Frame { type: string; code: string; members: { id: string; enabled: boolean; muted: boolean }[] }
/** A socket with nothing on it. */
const bare = {} as never;
/** The exception of a report. */
const exceptionOf = (report: SentryReport) => must(must(report.event.exception, 'exception').values[0], 'exception value');
/** The posthog block of a configuration that is on. */
const posthogOf = (config: ReturnType<typeof publicConfig>) => (config.enabled ? must(config.posthog, 'posthog block') : undefined);

/** The fake transport: every request recorded and decoded. */
function wire({ respond = (): { ok: boolean; status: number } => ({ ok: true, status: 200 }) }: { respond?: (url: string, options: Call) => { ok: boolean; status: number } } = {}) {
  const calls: Call[] = [];
  const fetch: TransportFetch = async (url, options) => { calls.push({ url: String(url), headers: options.headers, body: options.body }); return respond(url, options as unknown as Call); };
  return { calls, fetch,
    /** Every analytics event sent so far, in order. */
    events: (): Posted[] => calls.filter((call) => call.url.endsWith('/batch/')).flatMap((call) => (JSON.parse(call.body) as { batch: Posted[] }).batch),
    /** Every Sentry event or transaction sent so far. */
    reports: (): SentryReport[] => calls.filter((call) => call.url.includes('/envelope/')).map((call) => { const [header, item, payload] = call.body.trim().split('\n').map((line) => JSON.parse(line) as unknown); return { header: header as SentryReport['header'], item: item as SentryReport['item'], event: payload as SentryEvent, headers: call.headers, url: call.url }; }) };
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Configuration ---------------------------------------------------------------------------------

test('configuration: off unless configured, and only public values ever reach the browser', () => {
  assert.equal(readTelemetryConfig({}).active, false);
  assert.equal(readTelemetryConfig(undefined).active, false);
  assert.deepEqual(publicConfig(readTelemetryConfig({})), { enabled: false });
  assert.deepEqual(publicConfig(readTelemetryConfig({ TELEMETRY_ENV: 'production', TELEMETRY_DEBUG: '1', BUILD_ID: 'x' })), { enabled: false }, 'an environment alone switches nothing on');
  // Keys without an environment, or a dev environment: off, and it says why.
  const missing = readTelemetryConfig({ ...ENV, TELEMETRY_ENV: undefined });
  assert.equal(missing.active, false); assert.match(must(missing.problems[0]), /TELEMETRY_ENV/);
  assert.equal(readTelemetryConfig({ ...ENV, TELEMETRY_ENV: 'prod' }).active, false);
  const dev = readTelemetryConfig({ ...ENV, TELEMETRY_ENV: 'dev' });
  assert.equal(dev.active, false); assert.match(must(dev.problems[0]), /TELEMETRY_DEBUG/);
  assert.equal(readTelemetryConfig({ ...ENV, TELEMETRY_ENV: 'dev', TELEMETRY_DEBUG: '1' }).active, true);

  const config = readTelemetryConfig(ENV);
  assert.equal(config.active, true); assert.equal(config.release, 'build-7'); assert.equal(config.env, 'production');
  assert.equal(must(config.sentryServer).endpoint, 'https://o1.ingest.sentry.example/api/42/envelope/');
  assert.deepEqual(publicConfig(config), { enabled: true, env: 'production', release: 'build-7', debug: false,
    sentry: { dsn: 'https://clientkey@o1.ingest.sentry.example/41', replayOnError: false }, posthog: { key: 'phc_projectkey123', host: 'https://eu.i.posthog.com', consentAt: 'reward' } });
  assert.equal(posthogOf(publicConfig(readTelemetryConfig({ ...ENV, TELEMETRY_CONSENT_AT: 'named' })))?.consentAt, 'reward', 'the older value means the same: never before the first reward');
  assert.ok(!JSON.stringify(publicConfig(config)).includes('serverkey'), 'the server project’s DSN stays on the server');
  assert.equal(readTelemetryConfig({ ...ENV, POSTHOG_HOST: undefined }).posthog?.host, DEFAULT_POSTHOG_HOST);
  assert.equal(readTelemetryConfig({ ...ENV, TELEMETRY_REPLAY_ON_ERROR: '1', TELEMETRY_CONSENT_AT: 'landing' }).replayOnError, true);
  assert.equal(posthogOf(publicConfig(readTelemetryConfig({ ...ENV, TELEMETRY_CONSENT_AT: 'landing' })))?.consentAt, 'landing');
  // Server-only configuration: the browser is told there is nothing for it.
  assert.deepEqual(publicConfig(readTelemetryConfig({ TELEMETRY_ENV: 'production', SENTRY_DSN_SERVER: ENV.SENTRY_DSN_SERVER })), { enabled: false });

  // Secrets are refused, not passed on: a personal PostHog key, a legacy DSN with a secret, plain http, a host with a query.
  for (const key of ['phx_personalapikey1234567890', 'phs_secret1234567890', 'not a key']) {
    const refused = readTelemetryConfig({ TELEMETRY_ENV: 'production', POSTHOG_KEY: key });
    assert.equal(refused.posthog, null); assert.equal(refused.active, false); assert.equal(refused.problems.length, 1);
    assert.ok(!JSON.stringify(refused.problems).includes(key), 'the refused value is not repeated in the log line');
  }
  assert.equal(parseDsn('https://public:secret@o1.ingest.sentry.example/42'), null);
  assert.equal(parseDsn('o1.ingest.sentry.example/42'), null); assert.equal(parseDsn(undefined), null);
  assert.equal(readTelemetryConfig({ ...ENV, SENTRY_DSN_CLIENT: 'http://k@127.0.0.1:9999/1' }).sentryClient, null);
  assert.equal(readTelemetryConfig({ ...ENV, TELEMETRY_DEBUG: '1', SENTRY_DSN_CLIENT: 'http://k@127.0.0.1:9999/1' }).sentryClient?.endpoint, 'http://127.0.0.1:9999/api/1/envelope/');
  assert.equal(readTelemetryConfig({ ...ENV, POSTHOG_HOST: 'https://eu.i.posthog.com/?token=abc' }).posthog, null);
  assert.equal(readTelemetryConfig({ ...ENV, POSTHOG_HOST: 'http://127.0.0.1:9' }).posthog, null);
});

// ---- Off by default --------------------------------------------------------------------------------

test('nothing configured: every call returns at once, nothing is queued and fetch is never called', async () => {
  const net = wire();
  const telemetry = createServerTelemetry({ env: {}, fetch: net.fetch });
  assert.equal(telemetry.enabled, false);
  assert.equal(telemetry.consent(ADA, true), false);
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' }); telemetry.captureError(new Error('boom'), { route: 'GET /api/life' }); telemetry.captureMessage('server_started'); telemetry.started();
  telemetry.http({ method: 'POST', route: '/api/action', status: 200, ms: 99999, publicId: ADA, body: {} }); telemetry.httpFailed(new Error('x'), { method: 'GET', route: '/api/life', status: 500 });
  telemetry.socketIn(bare, { type: 'voice-state', enabled: true }); telemetry.socketOut(bare, { type: 'chat' }); telemetry.socketFailed(bare, { type: 'chat' }, 'boom', false, new Error('boom')); telemetry.socketClosed(bare); telemetry.beat([]);
  const listeners: unknown[][] = [];
  telemetry.attach({ on: (...args: unknown[]) => listeners.push(args) } as never);
  assert.deepEqual(listeners, [], 'no heartbeat listener is registered');
  assert.equal(telemetry.pending, 0);
  await telemetry.flush(); await telemetry.close();
  assert.deepEqual(net.calls, [] as Call[]);
  assert.deepEqual(telemetry.publicConfig(), { enabled: false });
  // The module-level functions do nothing until a host installs an instance, and never throw.
  assert.doesNotThrow(() => { track(ADA, 'chat_message_sent'); captureError(new Error('x')); (track as () => void)(); (captureError as () => void)(); });
});

test('a real server with nothing configured: the browser is told telemetry is off, and no request leaves', async (t) => {
  const original = globalThis.fetch; const outside: string[] = [];
  const f = await fixture(t);
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => { if (!String(url).startsWith(f.base)) outside.push(String(url)); return original(url, init); };
  t.after(() => { globalThis.fetch = original; });
  assert.equal(f.server.telemetry.enabled, false);
  const config = await (await f.request('/api/telemetry/config')).json();
  assert.equal(config.enabled, false); assert.deepEqual(Object.keys(config).sort(), ['enabled', 'serverTime']);
  const ada = await f.device('Ada');
  await f.request('/api/life?city=lagos', null, ada.cookie);
  assert.deepEqual(await (await f.request('/api/telemetry/consent', { analytics: true }, ada.cookie)).json().then(({ analytics }) => ({ analytics })), { analytics: false });
  f.server.beat();
  assert.equal(f.server.telemetry.pending, 0);
  assert.deepEqual(outside, []);
});

// ---- Analytics: consent, scrubbing, batching ---------------------------------------------------------

test('analytics is sent only for a player who accepted, scrubbed, in one batch — and stops when they reject', async () => {
  const net = wire();
  const telemetry = createServerTelemetry({ env: ENV, fetch: net.fetch, now: () => 1_700_000_000_000, flushMs: 5 });
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' });
  assert.equal(telemetry.pending, 0, 'no consent on record: nothing is even queued');
  assert.equal(telemetry.consent(ADA, true), true);
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park', body: CHAT, nickname: 'Ada Obi', email: 'ada@example.com', x: 3.5, z: -2, to: BOLA });
  telemetry.track(ADA, 'voice_left', { venue_id: 'bar', seconds: 75, audio: 'blob' });
  telemetry.track(BOLA, 'chat_message_sent', { venue_id: 'park' });      // Bola never accepted
  telemetry.track(ADA, 'Not An Event', {}); telemetry.track('ada', 'dm_sent', {}); telemetry.track(null, null, null);
  assert.equal(telemetry.pending, 2);
  assert.deepEqual(net.calls, [] as Call[], 'the caller is not kept waiting: nothing has been sent yet');
  await telemetry.flush();
  assert.equal(net.calls.length, 1);
  assert.equal(must(net.calls[0]).url, 'https://eu.i.posthog.com/batch/');
  assert.equal((JSON.parse(must(net.calls[0]).body) as { api_key: string }).api_key, 'phc_projectkey123');
  const common = { $geoip_disable: true, $lib: 'allworld-server', app: 'allworld', environment: 'production', release: 'build-7', source: 'server' };
  assert.deepEqual(net.events(), [
    { event: 'chat_message_sent', distinct_id: ADA, timestamp: '2023-11-14T22:13:20.000Z', properties: { venue_id: 'park', ...common } },
    { event: 'voice_left', distinct_id: ADA, timestamp: '2023-11-14T22:13:20.000Z', properties: { venue_id: 'bar', seconds: 75, ...common } },
  ]);
  for (const needle of [CHAT, 'Ada Obi', 'ada@example.com', BOLA, 'blob']) assert.ok(!must(net.calls[0]).body.includes(needle));
  telemetry.consent(ADA, false);
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' });
  await telemetry.flush();
  assert.equal(net.calls.length, 1);
  assert.equal(telemetry.hasConsent(ADA), false);
});

test('the queue is bounded and a dead endpoint never blocks, throws or grows memory', async () => {
  // An endpoint that never answers.
  const hung = createServerTelemetry({ env: ENV, fetch: () => new Promise(() => {}), flushMs: 1 });
  hung.consent(ADA, true);
  const began = performance.now();
  for (let i = 0; i < ANALYTICS_QUEUE_LIMIT * 3; i += 1) hung.track(ADA, 'chat_message_sent', { venue_id: 'park' });
  for (let i = 0; i < ERROR_QUEUE_LIMIT * 3; i += 1) hung.captureError(new Error(`failure ${i}`), { route: 'GET /api/life' });
  assert.ok(performance.now() - began < 1000, 'thousands of calls return without waiting for the network');
  assert.ok(hung.pending <= ANALYTICS_QUEUE_LIMIT + ERROR_QUEUE_LIMIT);
  assert.ok(hung.stats.dropped > 0);
  // Endpoints that refuse, fail or throw: the calls still return, flush and close still resolve.
  const logs: string[] = [];
  const transports: (TransportFetch | undefined)[] = [async () => ({ ok: false, status: 500 }), async () => { throw new Error('ECONNREFUSED'); }, () => { throw new Error('sync failure'); }, undefined];
  for (const fetch of transports) {
    const telemetry = createServerTelemetry({ env: ENV, fetch, log: (line) => logs.push(line), flushMs: 1 });
    telemetry.consent(ADA, true);
    assert.equal(telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' }), undefined);
    assert.equal(telemetry.captureError(new Error('boom')), undefined);
    await telemetry.flush(); await telemetry.close();
    assert.equal(telemetry.pending, 0, 'what could not be sent is dropped, not retried for ever');
  }
  assert.ok(logs.length >= 2 && logs.every((line) => line.startsWith('Telemetry: ')));
  // Hostile arguments and a throwing logger.
  const telemetry = createServerTelemetry({ env: ENV, fetch: async () => { throw new Error('x'); }, log: () => { throw new Error('logger'); }, flushMs: 1 });
  const hostile = { get code() { throw new Error('boom'); }, toString() { throw new Error('boom'); } } as never;
  assert.doesNotThrow(() => { telemetry.consent(hostile, true); telemetry.track(hostile, hostile, hostile); telemetry.captureError(hostile, hostile); telemetry.captureError(undefined, null); telemetry.http(hostile); (telemetry.http as () => void)(); telemetry.httpFailed(hostile, hostile);
    (telemetry.httpFailed as () => void)(); telemetry.socketIn(hostile, hostile); telemetry.socketOut(hostile, hostile); telemetry.socketFailed(hostile, hostile, hostile, false, hostile); telemetry.socketClosed(hostile); telemetry.beat(hostile); telemetry.beat([hostile]); telemetry.attach(hostile); });
  await telemetry.close();
});

// ---- Errors -----------------------------------------------------------------------------------------

test('an error report is an envelope with the release, a route template and codes — and nothing a player typed', async () => {
  const net = wire();
  const telemetry = createServerTelemetry({ env: ENV, fetch: net.fetch, now: () => 1_700_000_000_000 });
  const error = new TypeError(`Cannot store "${CHAT}" for ada@example.com (sid=${BOLA}) at x: 12.25, z: -4.5`);
  telemetry.captureError(error, { route: 'POST /api/social/house/:host', action_type: 'travel', result_code: 'internal_error', publicId: ADA, body: CHAT, nickname: 'Ada Obi', url: `/api/social/house/${BOLA}?q=Ada+Obi` });
  await telemetry.flush();
  const report = must(net.reports()[0], 'report');
  assert.equal(report.url, 'https://o1.ingest.sentry.example/api/42/envelope/');
  assert.match(must(report.headers['X-Sentry-Auth']), /sentry_key=serverkey/);
  assert.equal(report.item.type, 'event');
  assert.equal(report.header.dsn, ENV.SENTRY_DSN_SERVER);
  const { event } = report;
  assert.equal(event.release, 'build-7'); assert.equal(event.environment, 'production'); assert.equal(event.level, 'error');
  assert.deepEqual(event.tags, { route: 'POST /api/social/house/:host', action_type: 'travel', result_code: 'internal_error' });
  assert.deepEqual(event.user, { id: ADA });
  assert.equal(exceptionOf(report).type, 'TypeError');
  assert.equal(exceptionOf(report).value, 'Cannot store "[text]" for [email] (sid=[redacted] at x: [pos], z: [pos]');
  assert.equal(event.sdk.settings.infer_ip, 'never');
  const text = JSON.stringify(report);
  for (const needle of [CHAT, 'meet me', 'ada@example.com', BOLA, 'Ada Obi', '12.25', '/Users/', 'file://']) assert.ok(!text.includes(needle), needle);
  // Stack frames are project paths, with no local variables.
  const frames = exceptionOf(report).stacktrace.frames;
  assert.ok(frames.length > 0 && frames.every((frame) => frame.filename.startsWith('app:///') || frame.filename.startsWith('node:')));
  assert.equal(must(frames.at(-1)).filename, 'app:///server/telemetry/telemetry.test.ts');
  assert.deepEqual(framesOf('Error: x\n    at handle (file:///srv/app/server/server.ts:10:5)\n    at node:internal/timers:1:2\n    at /srv/app/node_modules/ws/lib/x.js:3:4'),
    [{ function: '<anonymous>', filename: 'app:///node_modules/ws/lib/x.js', lineno: 3, colno: 4, in_app: false }, { function: '<anonymous>', filename: 'node:internal/timers', lineno: 1, colno: 2, in_app: false }, { function: 'handle', filename: 'app:///server/server.ts', lineno: 10, colno: 5, in_app: true }]);
});

test('the same failure is reported at most five times a minute; the start marker carries the release', async () => {
  const net = wire();
  let time = 1_700_000_000_000;
  const telemetry = createServerTelemetry({ env: ENV, fetch: net.fetch, now: () => time });
  for (let i = 0; i < 40; i += 1) telemetry.captureError(new Error('the same failure'), { route: 'GET /api/life' });
  telemetry.captureError(new Error('another failure'), { route: 'GET /api/life' });
  await telemetry.flush();
  assert.equal(net.reports().length, 6);
  time += 61000;
  telemetry.captureError(new Error('the same failure'), { route: 'GET /api/life' });
  telemetry.started();
  await telemetry.flush();
  const reports = net.reports();
  assert.equal(reports.length, 8);
  const marker = must(reports.at(-1)).event;
  assert.deepEqual([marker.message, marker.level, marker.release, marker.fingerprint], ['server_started', 'info', 'build-7', ['server_started']]);
  assert.equal(marker.user, undefined);
});

// ---- What the traffic means (pure) --------------------------------------------------------------------

test('social results become events once: a refusal or a repeat records nothing, and no result field but ids and codes is read', () => {
  const player = { id: BOLA, name: 'Bola' };
  assert.deepEqual(socialEvents('friend-request', ADA, { ok: true, code: 'requested', player }), [{ to: ADA, name: 'friend_request_sent' }]);
  assert.deepEqual(socialEvents('friend-request', ADA, { ok: true, code: 'requested', player, duplicate: true }), []);
  assert.deepEqual(socialEvents('friend-answer', ADA, { ok: true, code: 'accepted', player }), [{ to: ADA, name: 'friend_made', props: { role: 'accepter' } }, { to: BOLA, name: 'friend_made', props: { role: 'asker' } }]);
  assert.deepEqual(socialEvents('friend-answer', ADA, { ok: true, code: 'declined', player }), []);
  assert.deepEqual(socialEvents('friend-answer', ADA, { ok: false, code: 'no_request', reason: 'x' }), []);
  assert.deepEqual(socialEvents('knock', ADA, { ok: true, code: 'knocking' }), [{ to: ADA, name: 'house_knock_sent' }]);
  assert.deepEqual(socialEvents('knock', ADA, { ok: true, code: 'inside', duplicate: true }), []);
  assert.deepEqual(socialEvents('knock-answer', ADA, { ok: true, code: 'declined' }), [{ to: ADA, name: 'house_knock_answered', props: { accepted: false } }]);
  assert.deepEqual(socialEvents('message', ADA, { ok: true, code: 'sent', conv: `dm.${ADA}.${BOLA}`, message: { body: CHAT } }), [{ to: ADA, name: 'dm_sent', props: { kind: 'direct' } }]);
  assert.deepEqual(socialEvents('message', ADA, { ok: true, code: 'sent', conv: { id: 'g.abc' } }), [{ to: ADA, name: 'dm_sent', props: { kind: 'group' } }]);
  assert.deepEqual(socialEvents('message', ADA, null), []);
});

test('co-presence and house visits from heartbeat snapshots; voice sessions from voice-state', () => {
  const presence = createCoPresence();
  const rooms = (map: Record<string, string[]>) => new Map(Object.entries(map).map(([room, ids]): [string, Set<string>] => [room, new Set(ids)]));
  assert.deepEqual(presence.beat(rooms({ 'lagos:park': [ADA] }), 10), [], 'alone is not co-presence');
  for (let i = 0; i < 9; i += 1) assert.deepEqual(presence.beat(rooms({ 'lagos:park': [ADA, BOLA] }), 10), []);
  // Bola leaves: both stretches end, 90 seconds each.
  assert.deepEqual(presence.beat(rooms({ 'lagos:park': [ADA] }), 10), [ADA, BOLA].map((to) => ({ to, name: 'co_presence', props: { venue_id: 'park', seconds: 90, minutes: 1.5, peers_max: 1 } })));
  // A meeting shorter than 30 seconds is not reported.
  presence.beat(rooms({ 'lagos:bar': [ADA, BOLA] }), 10);
  assert.deepEqual(presence.beat(rooms({}), 10), []);
  // A guest in the host's Home room with the host there: one visit per stay, for each of them.
  const home = `lagos:home:${ADA}`;
  assert.deepEqual(presence.beat(rooms({ [home]: [BOLA] }), 10), [], 'a guest without the host is not a visit');
  assert.deepEqual(presence.beat(rooms({ [home]: [ADA, BOLA] }), 10), [{ to: BOLA, name: 'house_visit', props: { role: 'guest' } }, { to: ADA, name: 'house_visit', props: { role: 'host' } }]);
  assert.deepEqual(presence.beat(rooms({ [home]: [ADA, BOLA] }), 10), []);
  assert.deepEqual(presence.end().map((event) => [event.to, event.name, event.props?.venue_id]), [], 'two beats together is still under 30 seconds');
  presence.beat(rooms({}), 10);
  assert.equal(presence.beat(rooms({ [home]: [ADA, BOLA] }), 10).filter((event) => event.name === 'house_visit').length, 2, 'a new stay is a new visit');
  for (let i = 0; i < 5; i += 1) presence.beat(rooms({ [home]: [ADA, BOLA] }), 10);
  assert.deepEqual(presence.end().map((event) => [event.name, event.props?.seconds, event.props?.venue_id]), [['co_presence', 60, 'home'], ['co_presence', 60, 'home']]);

  let time = 0;
  const voice = createVoice({ now: () => time });
  const ws = { session: { id: ADA }, room: 'lagos:bar' };
  assert.deepEqual(voice.state(ws, true), [{ to: ADA, name: 'voice_joined', props: { venue_id: 'bar' } }]);
  assert.deepEqual(voice.state(ws, true), [], 'muting and unmuting is not joining again');
  time = 95000;
  assert.deepEqual(voice.state(ws, false), [{ to: ADA, name: 'voice_left', props: { venue_id: 'bar', seconds: 95 } }]);
  assert.deepEqual(voice.leave(ws), []);
  voice.state(ws, true); time += 4000;
  assert.deepEqual(voice.leave(ws), [{ to: ADA, name: 'voice_left', props: { venue_id: 'bar', seconds: 4 } }], 'a closed socket ends the session');
});

// ---- The real server -----------------------------------------------------------------------------------

async function running(t: TestContext, { env = ENV, routes = [], disk, distDir, random = () => 1 }: { env?: Record<string, string | undefined>; routes?: RouteModule[]; disk?: FlakyDisk; distDir?: string; random?: () => number } = {}) {
  const net = wire();
  let clock = (): number => 0;
  const telemetry = createServerTelemetry({ env, fetch: net.fetch, now: () => clock(), random, flushMs: 60000 });
  const f = await fixture(t, { telemetry, log: () => {}, routes: [...ROUTE_MODULES, telemetryRoutes, ...routes], ...(disk ? { disk } : {}), ...(distDir ? { distDir } : {}) });
  clock = f.now;
  const player = async (name: string, accept = true) => {
    const device = await f.device(name);
    await f.request('/api/life?city=lagos', null, device.cookie);
    await f.request('/api/social/me', null, device.cookie); // known to the social module, as after a first page load
    if (accept) assert.deepEqual(((await (await f.request('/api/telemetry/consent', { analytics: true }, device.cookie)).json()) as Reply).analytics, true);
    return device;
  };
  const sent = async () => { await telemetry.flush(); return net.events().map((event): [string, string, Dict] => [event.distinct_id, event.event, Object.fromEntries(Object.entries(event.properties).filter(([key]) => Object.hasOwn(must(EVENTS[event.event]).props, key)))]); };
  return { f, net, telemetry, player, sent };
}
const post = async (f: Fixture, path: string, body: unknown, device: { cookie: string }): Promise<Reply> => (await f.request(path, body, device.cookie)).json() as Promise<Reply>;
const until = async (peer: TestSocket, type: string): Promise<Frame> => { for (;;) { const message = (await peer.next()) as unknown as Frame; if (message.type === type) return message; } };

test('the config and consent endpoints: public keys only, a session is required to consent', async (t) => {
  const { f, telemetry } = await running(t);
  const config = await (await f.request('/api/telemetry/config')).json();
  assert.deepEqual({ ...config, serverTime: undefined }, { ...telemetry.publicConfig(), serverTime: undefined });
  assert.ok(!JSON.stringify(config).includes('serverkey'));
  assert.equal((await f.request('/api/telemetry/consent', { analytics: true })).status, 401);
  const ada = await f.device('Ada');
  assert.equal((await f.request('/api/telemetry/consent', { analytics: 'yes' }, ada.cookie)).status, 400);
  assert.equal((await post(f, '/api/telemetry/consent', { analytics: true }, ada)).analytics, true);
  assert.equal(telemetry.hasConsent(ada.id), true);
  assert.equal((await post(f, '/api/telemetry/consent', { analytics: false }, ada)).analytics, false);
  assert.equal(telemetry.hasConsent(ada.id), false);
});

test('the age answer has one home: a player who said "under 18" in the game has analytics off on the server and is told so', async (t) => {
  const { f, telemetry, sent } = await running(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  for (const device of [ada, bola]) { await f.request('/api/life?city=lagos', null, device.cookie); await f.request('/api/social/me', null, device.cookie); }
  // Both accepted analytics; then Ada answers the age question — the growth collection is the only place it is stored.
  for (const device of [ada, bola]) assert.equal((await post(f, '/api/telemetry/consent', { analytics: true }, device)).analytics, true);
  assert.deepEqual([(await (await f.request('/api/telemetry/config', null, ada.cookie)).json()).under18, telemetry.hasConsent(ada.id)], [undefined, true]);
  const answered = await post(f, '/api/growth/consent', { cityId: 'lagos', age: 'minor' }, ada);
  assert.deepEqual([answered.ok, answered.consent.age], [true, 'minor']);
  assert.equal(telemetry.hasConsent(ada.id), false, 'the server forgets her Accept the moment the age is answered');
  // Her browser is told with the configuration (so it never starts analytics) and with every consent answer.
  assert.equal((await (await f.request('/api/telemetry/config', null, ada.cookie)).json()).under18, true);
  assert.deepEqual(await post(f, '/api/telemetry/consent', { analytics: true }, ada).then(({ analytics, under18 }) => ({ analytics, under18 })), { analytics: false, under18: true });
  assert.equal(telemetry.hasConsent(ada.id), false, 'an Accept from a browser that has not heard yet is not kept');
  // Asking again as an adult does not raise it (growth's own rule), so analytics stays off.
  assert.equal((await post(f, '/api/growth/consent', { cityId: 'lagos', age: 'adult' }, ada)).consent.age, 'minor');
  assert.equal((await post(f, '/api/telemetry/consent', { analytics: true }, ada)).analytics, false);
  // Nobody else is affected: no session, another player and an adult all get the plain configuration.
  assert.equal((await (await f.request('/api/telemetry/config')).json()).under18, undefined);
  assert.equal((await (await f.request('/api/telemetry/config', null, bola.cookie)).json()).under18, undefined);
  assert.equal((await post(f, '/api/growth/consent', { cityId: 'lagos', age: 'adult' }, bola)).consent.age, 'adult');
  assert.deepEqual([(await post(f, '/api/telemetry/consent', { analytics: true }, bola)).analytics, telemetry.hasConsent(bola.id)], [true, true]);
  // And the server records nothing for her from here on, while Bola's events still count.
  const asked = await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada);
  assert.equal(asked.error, undefined, JSON.stringify(asked));
  await post(f, '/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola);
  const events = await sent();
  assert.ok(!events.some(([id]) => id === ada.id), 'no event carries the under-18 player');
  // The same age answer is what e-mail and push are refused on (one stored answer, one place).
  const mail = await post(f, '/api/growth/email', { cityId: 'lagos', email: 'ada@example.com', consent: true }, ada);
  assert.deepEqual([mail.ok, mail.code], [false, 'under_18']);
});

test('friends, chat and voice are counted exactly once for players who accepted — never their content, never the others', async (t) => {
  const { f, net, player, sent } = await running(t);
  const ada = await player('Ada'), bola = await player('Bola'), chi = await player('Chidinma', false);
  // Friend request and answer over HTTP; a repeat of each records nothing more.
  assert.equal((await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).duplicate, true);
  assert.equal((await post(f, '/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  assert.equal((await post(f, '/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).duplicate, true);
  // Chi did not accept analytics: her request is not recorded (and neither is Ada's side of an answer she gives).
  await post(f, '/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, chi);
  assert.deepEqual(await sent(), [[ada.id, 'friend_request_sent', {}], [bola.id, 'friend_made', { role: 'accepter' }], [ada.id, 'friend_made', { role: 'asker' }]]);

  // Venue chat: one count for the sender, whatever the number of listeners; a resend of the same line is not a second message.
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola), c = await f.joinRoom(chi);
  a.ws.send(JSON.stringify({ type: 'chat', body: CHAT, clientId: 'line-1' })); await until(a, 'chat');
  a.ws.send(JSON.stringify({ type: 'chat', body: CHAT, clientId: 'line-1' })); await until(a, 'chat');
  c.ws.send(JSON.stringify({ type: 'chat', body: 'hello from someone who rejected', clientId: 'line-2' })); await until(c, 'chat');
  // A direct message over the socket.
  a.ws.send(JSON.stringify({ type: 'dm-send', to: bola.id, body: CHAT, clientId: f.id() })); await until(a, 'dm-sent');
  // Voice on, then off 90 seconds later.
  const voice = async (enabled: boolean, muted: boolean) => {
    a.ws.send(JSON.stringify({ type: 'voice-state', enabled, muted }));
    for (;;) { const me = (await until(b, 'presence')).members.find((member) => member.id === ada.id); if (me?.enabled === enabled && me.muted === muted) return; }
  };
  await voice(true, true); await voice(true, false);
  f.advance(90000);
  await voice(false, true);
  // A refused message is a counted code.
  a.ws.send(JSON.stringify({ type: 'voice-state', enabled: 'yes' })); await until(a, 'error');
  assert.deepEqual((await sent()).slice(3), [
    [ada.id, 'chat_message_sent', { venue_id: 'park' }], [ada.id, 'dm_sent', { kind: 'direct' }],
    [ada.id, 'voice_joined', { venue_id: 'park' }], [ada.id, 'voice_left', { venue_id: 'park', seconds: 90, duration: '1to5m' }],
    [ada.id, 'ws_error', { message_type: 'voice-state', code: 'invalid_voice_state' }],
  ]);
  const everything = net.calls.map((call) => call.body).join('\n');
  for (const needle of [CHAT, 'meet me', 'someone who rejected', 'Ada', 'Bola', chi.id, ada.cookie.slice(4), bola.cookie.slice(4)]) assert.ok(!everything.includes(needle), needle);
  for (const event of net.events()) assert.equal(event.properties.$geoip_disable, true);
});

test('co-presence minutes are recorded when a stretch together ends, and what is still running is sent at shutdown', async (t) => {
  const { f, player, sent, telemetry } = await running(t);
  const ada = await player('Ada'), bola = await player('Bola');
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  f.server.beat();
  for (let i = 0; i < 12; i += 1) { f.advance(10000); f.server.beat(); a.ws.pong?.(); }
  assert.deepEqual(await sent(), [], 'still together: nothing yet');
  await telemetry.close();
  const events = await sent();
  assert.deepEqual(events.map(([id, name]) => [id, name]).sort(), [[ada.id, 'co_presence'], [bola.id, 'co_presence']].sort());
  assert.deepEqual(must(events[0])[2], { venue_id: 'park', seconds: 120, minutes: 2, peers_max: 1, duration: '1to5m' });
  void b;
});

test('a 5xx is reported with its route template, action type and code; a refusal is not an error; a slow request may be sampled', async (t) => {
  const boom: RouteModule = (ctx) => ({
    'GET /api/boom/:id': () => { throw new TypeError(`cannot read "${CHAT}"`); },
    // An error that repeats, unquoted, what the player sent: the request body's own strings are taken out of the message.
    'POST /api/boom/act': async (request) => { const body = await request.json(); await ctx.store.read((db) => request.requireSession(db)); throw new Error(`engine failed on ${(body.payload as { note: string }).note}`); },
    'GET /api/boom/refused': () => { throw ctx.fail(409, 'not_allowed'); },
    'GET /api/boom/slow': async () => { await tick(70); return { body: { ok: true } }; },
  });
  let roll = 1;
  const { f, net, telemetry, player } = await running(t, { env: { ...ENV, TELEMETRY_SLOW_MS: '50' }, routes: [boom], random: () => roll });
  const ada = await player('Ada');
  assert.equal((await f.request(`/api/boom/${BOLA}?q=Ada+Obi`)).status, 500);
  assert.equal((await f.request('/api/boom/act', { actionId: 'x', type: 'travel', payload: { note: CHAT } }, ada.cookie)).status, 500);
  assert.equal((await f.request('/api/boom/refused')).status, 409);
  assert.equal((await f.request('/api/nothing/here')).status, 404);
  assert.equal((await f.request('/api/boom/slow')).status, 200);  // slow, but not in the sample
  roll = 0;
  assert.equal((await f.request('/api/boom/slow')).status, 200);  // slow and sampled
  assert.equal((await f.request('/api/health')).status, 200);     // fast: never a transaction
  await telemetry.flush();
  const reports = net.reports();
  assert.deepEqual(reports.map((report) => [report.item.type, report.event.tags]), [
    ['event', { route: 'GET /api/boom/:id', status: 500 }],
    ['event', { route: 'POST /api/boom/act', status: 500, action_type: 'travel' }],
    ['transaction', { route: 'GET /api/boom/slow', status: 200 }],
  ]);
  assert.equal(exceptionOf(must(reports[0])).value, 'cannot read "[text]"');
  assert.equal(must(reports[0]).event.user, undefined);
  assert.deepEqual(must(reports[1]).event.user, { id: ada.id }, 'the public id, never the cookie');
  assert.equal(exceptionOf(must(reports[1])).value, 'engine failed on [text]');
  const slow = must(reports[2]).event;
  assert.equal(slow.transaction, 'GET /api/boom/slow'); assert.equal(slow.contexts.trace.op, 'http.server'); assert.ok(slow.timestamp - slow.start_timestamp >= 0.05);
  const text = net.calls.map((call) => call.body).join('\n');
  for (const needle of [CHAT, BOLA, 'Ada+Obi', ada.cookie.slice(4), 'actionId']) assert.ok(!text.includes(needle), needle);
});

test('a failed write of the data file is reported as store_write_failed, not as an exception per request', async (t) => {
  const disk = flakyDisk();
  const { f, net, telemetry, player } = await running(t, { disk });
  const ada = await player('Ada', false);
  disk.fail = 'ENOSPC';
  for (let i = 0; i < 3; i += 1) assert.equal((await f.request('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'spot', payload: { id: 'bench' } }, ada.cookie)).status, 503);
  disk.fail = null;
  await telemetry.flush();
  const reports = net.reports().map((report) => [report.event.message, report.event.level, report.event.tags, report.event.exception]);
  assert.deepEqual(reports, Array.from({ length: 3 }, () => ['store_write_failed', 'error', { route: 'POST /api/action', status: 503, result_code: 'storage_unavailable', action_type: 'spot' }, undefined]));
});

test('an unexpected socket failure is an error report with the message type only', async (t) => {
  const failing: WsHandlerModule = () => ({ messages: { 'test-crash': async (_ws, message) => { throw new TypeError(`bad ${message.body}`); } } });
  const net = wire();
  const telemetry = createServerTelemetry({ env: ENV, fetch: net.fetch });
  const { WS_MODULES } = await import('../ws/index.ts');
  const f = await fixture(t, { telemetry, wsModules: [...WS_MODULES, failing], log: () => {} });
  const ada = await f.device('Ada');
  const a = await f.socket(ada);
  a.ws.send(JSON.stringify({ type: 'test-crash', body: CHAT }));
  assert.equal((await until(a, 'error')).code, 'internal_error');
  await telemetry.flush();
  const report = must(net.reports()[0], 'report');
  assert.deepEqual(report.event.tags, { route: 'WS test-crash' });
  assert.deepEqual(report.event.user, { id: ada.id });
  assert.equal(exceptionOf(report).value, 'bad [text]', 'the message the player sent is taken out of the error text');
  assert.ok(!JSON.stringify(report).includes('meet me'));
});

test('source maps are never served, and closing the server sends what is still queued', async (t) => {
  const distDir = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(distDir, { recursive: true, force: true }));
  await mkdir(join(distDir, 'assets'));
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>game</title>');
  await writeFile(join(distDir, 'assets', 'app-abc.js'), 'console.log(1)');
  await writeFile(join(distDir, 'assets', 'app-abc.js.map'), '{"sources":["../../src/life-main.js"]}');
  const net = wire();
  const telemetry = createServerTelemetry({ env: ENV, fetch: net.fetch, flushMs: 60000 });
  const f = await fixture(t, { telemetry, distDir });
  assert.equal((await fetch(`${f.base}/assets/app-abc.js`)).status, 200);
  for (const path of ['/assets/app-abc.js.map', '/assets/missing.js.map', '/anything.map']) {
    const response = await fetch(f.base + path);
    assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes('sources'));
  }
  telemetry.captureError(new Error('queued at shutdown'));
  assert.equal(net.calls.length, 0);
  await new Promise<void>((resolve) => f.server.close(() => resolve()));
  assert.equal(net.reports().length, 1);
  assert.equal(telemetry.pending, 0);
});

test('the module-level track and captureError use the instance the host installed', async () => {
  const net = wire();
  const telemetry = useTelemetry(createServerTelemetry({ env: ENV, fetch: net.fetch }));
  telemetry.consent(ADA, true);
  track(ADA, 'house_knock_sent'); captureError(new Error('through the module'), { route: 'GET /api/life' });
  await telemetry.flush();
  assert.deepEqual(net.events().map((event) => event.event), ['house_knock_sent']);
  assert.equal(net.reports().length, 1);
  useTelemetry(null);
  track(ADA, 'house_knock_sent');
  await telemetry.flush();
  assert.equal(net.events().length, 1);
});
