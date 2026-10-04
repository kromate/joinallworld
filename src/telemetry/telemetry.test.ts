// The client side of telemetry, without a browser and without a network: a fake window, fake SDK
// chunks and a fake transport that records what would have been sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createTelemetry, CALL_LIMIT } from './index.ts';
import { createCore, STORAGE_KEY, QUEUE_LIMIT } from './core.ts';
import { captureArgs } from './clean.ts';
import { scrubEvent } from './scrub.ts';
import { isDevHost, privacySignal, resolveConsent, clientPlan, lagosDay, daysBetween, latencyBucket, fpsBucket } from './policy.ts';
import { newMemo, sessionStarted, stateEvents } from './funnel.ts';
import { consentHtml } from './consent-ui.ts';
import type { ConsentState } from './consent-ui.ts';
import { CONSENT, whatWeCollect, regionWords } from './what-we-collect.ts';
import { EVENTS, TRACKED_EVENTS } from './events.ts';
import { createLife } from '../life.ts';

type Life = ReturnType<typeof createLife>;

import type { CoreLoaders, CoreClient, TelemetryWindow } from './core.ts';
import type { ClientConfig } from './policy.ts';
import type { Item, CaptureOptions } from './clean.ts';

const PUBLIC = '9d1c7e52-3b7a-4f0e-8a55-0c2d4e6f8a10';
const CONFIG: ClientConfig = { enabled: true, env: 'production', release: 'build-7', debug: false, sentry: { dsn: 'https://abc@o1.ingest.example/7', replayOnError: false }, posthog: { key: 'phc_testkey123', host: 'https://us.i.posthog.com', consentAt: 'reward' } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

interface Request { url: string; method: string; body: { analytics?: boolean } | undefined }
interface SavedChoice { consent?: unknown; at?: unknown; [key: string]: unknown }
/** The window the telemetry code sees, plus what the tests look at. The stub is built narrowly and cast once, in fakeWindow. */
type FakeWindow = TelemetryWindow & {
  fetches: Request[]; timers: Array<() => void>; saved(): SavedChoice | null; dispatch(type: string, detail?: unknown): void; listening(type: string): number;
  openDialog: object | null; docListeners: Map<string, unknown>; consentAnswer?: { under18?: boolean };
};
interface FakeWindowOptions { hostname?: string; nav?: Record<string, unknown>; stored?: SavedChoice | null; config?: unknown; configStatus?: number }

/** A window with just what telemetry touches. `fetches` records every request it would have made. */
function fakeWindow({ hostname = 'play.example', nav = {}, stored = null, config = { enabled: false }, configStatus = 200 }: FakeWindowOptions = {}): FakeWindow {
  const listeners = new Map<string, Set<(event: { type: string, detail?: unknown }) => void>>(), store = new Map<string, string>(stored ? [[STORAGE_KEY, JSON.stringify(stored)]] : []);
  const win = {
    fetches: [] as Request[], timers: [] as Array<() => void>,
    location: { hostname, host: hostname, pathname: '/', href: `https://${hostname}/?invite=abc123` },
    navigator: { hardwareConcurrency: 4, userAgent: 'TestBrowser/1', ...nav },
    performance: { now: () => 1234.5 },
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: unknown) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
    saved: (): SavedChoice | null => JSON.parse(store.get(STORAGE_KEY) ?? 'null'),
    addEventListener(type: string, fn: (event: { type: string, detail?: unknown }) => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)?.add(fn); },
    removeEventListener(type: string, fn: (event: { type: string, detail?: unknown }) => void) { listeners.get(type)?.delete(fn); },
    dispatch(type: string, detail?: unknown) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, detail }); },
    listening: (type: string) => listeners.get(type)?.size ?? 0,
    openDialog: null as object | null,
    docListeners: new Map<string, unknown>(),
    document: { hidden: true, addEventListener(type: string, fn: unknown) { win.docListeners.set(type, fn); }, removeEventListener(type: string) { win.docListeners.delete(type); }, querySelector: (selector: string) => (selector === 'dialog[open]' ? win.openDialog : null) },
    setTimeout(fn: () => void) { win.timers.push(fn); return win.timers.length; },
    requestAnimationFrame() {},
    async fetch(url: string, options: { method?: string, body?: string } = {}): Promise<{ ok: boolean, status: number, json(): Promise<unknown> }> {
      win.fetches.push({ url: String(url), method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined });
      if (String(url) === '/api/telemetry/config') return { ok: configStatus === 200, status: configStatus, json: async () => config };
      return { ok: true, status: 200, json: async () => (String(url) === '/api/telemetry/consent' ? win.consentAnswer ?? {} : {}) };
    },
    consentAnswer: undefined as { under18?: boolean } | undefined,
    __jawErrors: [] as Array<{ e: unknown }>, __jawErrorHandler: (() => {}) as (() => void) | null,
  };
  win.addEventListener('error', win.__jawErrorHandler as () => void);
  return win as unknown as FakeWindow;
}

interface Log {
  loaded: string[]; sent: Array<{ name: string, props: unknown, at: number | undefined, options: CaptureOptions }>; identified: unknown[]; groups: Array<[string, string]>; stopped: number;
  reports: Array<{ error: unknown, context: unknown }>; crumbs: Array<{ category: string, data: Record<string, unknown>, timestamp: number }>; users: unknown[];
  sheets: Array<Parameters<Awaited<ReturnType<CoreLoaders['consent']>>['showConsent']>[0]>; answer: string | null;
}
/** Fake SDK chunks. `sent` is what PostHog would have been given (after the real cleaning step); `reports` what Sentry would. */
function fakeLoaders(): { log: Log, loaders: CoreLoaders } {
  const log: Log = { loaded: [], sent: [], identified: [], groups: [], stopped: 0, reports: [], crumbs: [], users: [], sheets: [], answer: null };
  return { log, loaders: {
    posthog: async () => { log.loaded.push('posthog'); return { startPosthog: () => ({
      capture(item: Item) { const args = captureArgs(item); if (args) log.sent.push({ name: args[0], props: args[1], at: item.at, options: args[2] }); },
      identify: (id: unknown) => log.identified.push(id), group: (type: string, id: string) => log.groups.push([type, id]), stop: () => { log.stopped += 1; },
    }) }; },
    sentry: async () => { log.loaded.push('sentry'); return { startSentry: async ({ userId }) => { log.users.push(userId); return {
      capture: (error: unknown, context?: unknown) => log.reports.push({ error, context }), crumb: (item) => log.crumbs.push(item as Log['crumbs'][number]), user: (id: unknown) => log.users.push(id),
    }; } }; },
    consent: async () => { log.loaded.push('consent'); return { showConsent: async (options) => { log.sheets.push(options); if (log.answer) options.onChoice?.(log.answer); return log.answer; } }; },
  } };
}
const names = (log: Log) => log.sent.map((event) => event.name);
const client = (_state?: unknown, extra: Partial<CoreClient> = {}): CoreClient => ({ session: { id: PUBLIC }, cityId: 'lagos', storage: null, now: 1000, ...extra });

// ---- Off unless configured ------------------------------------------------------------------------

test('only the three wrapper files import an SDK, and the facade imports nothing at all', () => {
  const dir = new URL('.', import.meta.url);
  const importsOf = (file: string) => [...readFileSync(new URL(file, dir), 'utf8').matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)].map((match) => match[1] ?? match[2] ?? '');
  const sdk = (name: string) => name.startsWith('@sentry/') || name.startsWith('posthog-js');
  const users = readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && importsOf(file).some(sdk));
  assert.deepEqual(users.sort(), ['posthog.ts', 'sentry-replay.ts', 'sentry.ts']);
  assert.deepEqual(importsOf('index.ts'), [], 'the facade in the entry chunk has no static import');
  // The core reaches the SDK wrappers and the sheet only through import(): each stays its own chunk.
  assert.ok(importsOf('core.ts').every((name) => ['./policy.ts', './funnel.ts'].includes(name)));
  // The game's entry reaches telemetry through the facade only.
  assert.deepEqual(importsOf('../life-main.js').filter((name) => name.includes('telemetry')), ['./telemetry/index.ts']);
});

test('nothing configured: no SDK code is loaded, nothing is fetched but the game’s own config, and nothing is kept', async () => {
  const win = fakeWindow({ config: { enabled: false } });
  let coreLoads = 0;
  const telemetry = createTelemetry({ window: win, loadCore: async () => { coreLoads += 1; return { createCore }; } });
  telemetry.needName(); telemetry.track('landed', {}); telemetry.captureError(new Error('early')); telemetry.screen('venue'); telemetry.hudReady();
  telemetry.session({ id: PUBLIC }, true, 5); telemetry.state({}, {}, { session: { id: PUBLIC }, serverNow: () => 1 }); telemetry.action('travel')({ ok: true, code: 'ok' });
  await tick();
  assert.deepEqual(win.fetches, [], 'before the first scene is drawn there is no request at all');
  assert.equal(telemetry.status, 'pending');
  assert.ok(telemetry.kept > 0);
  telemetry.sceneReady(true, null);
  assert.equal(win.timers.length, 1, 'starting is deferred until after the scene');
  win.timers[0]!(); await tick(); await tick();
  assert.deepEqual(win.fetches, [{ url: '/api/telemetry/config', method: 'GET', body: undefined }]);
  assert.equal(coreLoads, 0, 'the telemetry core is not even downloaded');
  assert.equal(telemetry.status, 'off');
  assert.equal(telemetry.kept, 0);
  assert.deepEqual(win.__jawErrors, []);
  assert.equal(win.listening('jaw:track'), 0);
  assert.equal(win.listening('error'), 0, 'the page’s early error buffer stops listening');
  telemetry.track('landed', {}); win.dispatch('jaw:track', { name: 'x_y_z' }); telemetry.setConsent('granted');
  assert.equal(telemetry.kept, 0);
  assert.equal(win.fetches.length, 1);
  assert.equal(win.saved(), null, 'nothing is written to this device');
});

test('the config request failing, or answering nonsense, means off', async () => {
  for (const options of [{ configStatus: 404 }, { config: null }, { config: { enabled: 'yes' } }, { config: 'text' }]) {
    const win = fakeWindow(options);
    let coreLoads = 0;
    const telemetry = createTelemetry({ window: win, loadCore: async () => { coreLoads += 1; return { createCore }; } });
    await telemetry.start();
    assert.equal(telemetry.status, 'off'); assert.equal(coreLoads, 0);
  }
  const win = fakeWindow(); win.fetch = async () => { throw new Error('offline'); };
  const telemetry = createTelemetry({ window: win });
  await telemetry.start();
  assert.equal(telemetry.status, 'off');
  // A core chunk that does not arrive is the same: off, and the game never hears of it.
  const other = createTelemetry({ window: fakeWindow({ config: CONFIG }), loadCore: async () => { throw new Error('chunk'); } });
  await other.start();
  assert.equal(other.status, 'off');
});

test('the facade never throws and never keeps more than its limit', () => {
  const telemetry = createTelemetry({ window: fakeWindow() });
  const hostile = { get name() { throw new Error('boom'); } };
  for (let i = 0; i < CALL_LIMIT * 4; i += 1) telemetry.track('event_name', { i });
  assert.equal(telemetry.kept, CALL_LIMIT);
  for (const call of [() => telemetry.track(hostile, hostile), () => telemetry.track(), () => telemetry.screen(null), () => telemetry.identify({}, 7), () => telemetry.setGroup(), () => telemetry.captureError(),
    () => telemetry.setConsent(Symbol('x')), () => telemetry.state(null, null, null as never), () => telemetry.state({}, {}, undefined as never), () => telemetry.action()(hostile as never), () => telemetry.link(hostile), () => telemetry.session(),
    () => telemetry.chunkFailed(), () => telemetry.needName(), () => telemetry.hudReady(), () => telemetry.sceneReady()]) assert.doesNotThrow(call);
  // Not a browser at all (this test file itself imported the module-level instance without a window).
  const bare = createTelemetry({ window: undefined });
  assert.doesNotThrow(() => { bare.track('a_b_c'); bare.sceneReady(true); bare.state({}, {}, {} as never); bare.action('x')(); });
});

test('a development host stays off unless the server says TELEMETRY_DEBUG=1', async () => {
  for (const host of ['localhost', '127.0.0.1', '192.168.1.20', 'game.test', '[::1]']) {
    const win = fakeWindow({ hostname: host, config: CONFIG });
    const { log, loaders } = fakeLoaders();
    const telemetry = createTelemetry({ window: win, loadCore: async () => ({ createCore: (options) => createCore({ ...options, loaders }) }) });
    telemetry.track('landed'); telemetry.captureError(new Error('x'));
    await telemetry.start(); await tick();
    assert.equal(telemetry.status, 'off', host);
    assert.deepEqual(log.loaded, [], host);
  }
  const win = fakeWindow({ hostname: 'localhost', config: { ...CONFIG, debug: true } });
  const { log, loaders } = fakeLoaders();
  const telemetry = createTelemetry({ window: win, loadCore: async () => ({ createCore: (options) => createCore({ ...options, loaders }) }) });
  await telemetry.start(); await tick();
  assert.equal(telemetry.status, 'on');
  assert.deepEqual(log.loaded, ['sentry']);
  assert.equal(isDevHost('play.joinallworld.com'), false);
  assert.equal(isDevHost('10.1.2.3'), true); assert.equal(isDevHost('172.20.0.4'), true); assert.equal(isDevHost('172.32.0.4'), false); assert.equal(isDevHost(''), true);
  assert.deepEqual(clientPlan({ enabled: true, posthog: { key: 'phc_x', host: '' } }, 'play.example'), { sentry: false, posthog: false });
});

// ---- Consent ---------------------------------------------------------------------------------------

function running({ now = () => 1_700_000_000_000, ...options }: FakeWindowOptions & { now?: () => number, config?: ClientConfig } = {}) {
  const win = fakeWindow({ config: CONFIG, ...options });
  const { log, loaders } = fakeLoaders();
  const core = createCore({ config: options.config ?? CONFIG, window: win, loaders, now, random: () => 0 });
  return { win, log, core };
}

test('before the player answers, nothing reaches PostHog — not the SDK, not one event', async () => {
  const { win, log, core } = running();
  core.needName(); core.session({ id: PUBLIC }, true, 500); core.track('activity_completed', { activity_id: 'jog', venue_id: 'park' }); core.screen('map');
  await tick(); await tick();
  assert.deepEqual(log.loaded.filter((name) => name === 'posthog'), [], 'the PostHog chunk is not downloaded');
  assert.deepEqual(log.sent, []);
  assert.equal(core.consent, 'unset');
  assert.deepEqual(win.fetches, [], 'and the server is told nothing');
  assert.equal(win.saved(), null, 'and nothing is written to this device');
  // A session alone does not bring the question up: it waits for the first reward (see the consent-timing test).
  assert.equal(log.sheets.length, 0);
});

test('Accept sends what was waiting, at the time it happened; later events go straight out', async () => {
  let time = 1_700_000_000_000;
  const { win, log, core } = running({ now: () => time });
  core.needName(); core.track('landed', { join: false, ms: 0, name: 'Ada Obi' }); time += 4000; core.track('play_tapped', { taps: 1, ms: 4000 }); core.session({ id: PUBLIC }, true, 500); time += 1000;
  core.setConsent('granted', 'sheet'); await tick(); await tick();
  assert.deepEqual(log.loaded.filter((name) => name === 'posthog'), ['posthog']);
  assert.deepEqual(log.identified, [PUBLIC]);
  // The landing screen's own events (reported with jaw:track → track) waited in memory and go out at the time they happened;
  // telemetry itself reports neither `landed` nor `named` (one source per event).
  assert.deepEqual(names(log), ['$pageview', 'landed', 'play_tapped', 'consent_choice', 'session_start']);
  assert.equal(log.sent[1]?.at, 1_700_000_000_000); assert.equal(log.sent[2]?.at, 1_700_000_004_000);
  assert.deepEqual([log.sent[1]?.props, log.sent[2]?.props], [{ join: false, ms: 0 }, { taps: 1, ms: 4000 }]);
  assert.deepEqual(log.sent[3]?.props, { choice: 'granted', source: 'sheet' });
  assert.deepEqual(log.sent[4]?.options.$set_once, { first_seen_date: '2023-11-14' });
  core.track('activity_completed', { activity_id: 'jog', venue_id: 'park', nickname: 'Ada Obi' });
  assert.deepEqual(log.sent.at(-1), { name: 'activity_completed', props: { activity_id: 'jog', venue_id: 'park' }, at: time, options: { timestamp: new Date(time) } });
  // The server is told once, so the events it records for this player follow the same choice.
  assert.deepEqual(win.fetches, [{ url: '/api/telemetry/consent', method: 'POST', body: { analytics: true } }]);
  assert.equal(win.saved()?.consent, 'granted');
});

test('Reject: what was waiting is discarded, the SDK is never downloaded, and nothing is sent afterwards', async () => {
  const { win, log, core } = running();
  core.needName(); core.session({ id: PUBLIC }, true, 500); core.track('activity_completed', { activity_id: 'jog', venue_id: 'park' });
  core.setConsent('denied', 'sheet');
  core.track('activity_completed', { activity_id: 'jog', venue_id: 'park' }); core.screen('map'); core.state(createLife(undefined), createLife(undefined), client());
  await tick(); await tick();
  assert.deepEqual(log.loaded.filter((name) => name === 'posthog'), []);
  assert.deepEqual(log.sent, []);
  assert.deepEqual(win.saved(), { consent: 'denied', at: 1_700_000_000_000 }, 'only the choice itself is remembered');
  assert.deepEqual(win.fetches, [{ url: '/api/telemetry/consent', method: 'POST', body: { analytics: false } }]);
  // The next visit: the choice stands, and the sheet is not shown again.
  const again = running({ stored: win.saved() });
  again.core.session({ id: PUBLIC }, false, 500); again.core.track('activity_completed', { activity_id: 'jog' });
  await tick(); await tick();
  assert.deepEqual(again.log.loaded.filter((name) => name !== 'sentry'), []);
  assert.deepEqual(again.log.sent, []);
  assert.deepEqual(again.win.fetches, []);
});

test('Reject after Accept stops the SDK and clears what it kept; Accept again sends only what happens from then on', async () => {
  const { win, log, core } = running();
  core.session({ id: PUBLIC }, false, 500); core.setConsent('granted', 'sheet'); await tick(); await tick();
  const before = log.sent.length;
  core.setConsent('denied', 'settings');
  assert.equal(log.stopped, 1);
  core.track('activity_completed', { activity_id: 'jog', venue_id: 'park' }); await tick();
  assert.equal(log.sent.length, before);
  assert.deepEqual(Object.keys(win.saved() ?? {}).sort(), ['at', 'consent']);
  assert.deepEqual(win.fetches.map((call) => call.body), [{ analytics: true }, { analytics: false }]);
  core.setConsent('granted', 'settings'); await tick(); await tick();
  assert.deepEqual(names(log).slice(before), ['consent_choice'], 'no second page view or daily session for the same page and day');
  core.track('activity_completed', { activity_id: 'jog', venue_id: 'park' });
  assert.equal(names(log).at(-1), 'activity_completed');
});

test('Do Not Track and Global Privacy Control are a Reject: no sheet, no SDK, no event — even over a stored Accept', async () => {
  for (const nav of [{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { globalPrivacyControl: true }]) {
    const { win, log, core } = running({ nav, stored: { consent: 'granted', at: 1 } });
    core.session({ id: PUBLIC }, false, 500); core.track('activity_completed', { activity_id: 'jog' }); core.setConsent('granted', 'api');
    await tick(); await tick();
    assert.equal(core.consent, 'denied');
    assert.deepEqual(log.loaded.filter((name) => name !== 'sentry'), []);
    assert.deepEqual(log.sent, []);
    assert.deepEqual(win.fetches.filter((call) => call.body?.analytics === true), []);
  }
  assert.equal(privacySignal({ doNotTrack: '0' }), false); assert.equal(privacySignal({}), false); assert.equal(privacySignal(undefined, { doNotTrack: '1' }), true);
  assert.equal(resolveConsent({ stored: 'granted' }), 'granted'); assert.equal(resolveConsent({ stored: 'granted', signal: true }), 'denied');
  assert.equal(resolveConsent({ stored: 'granted', under18: true }), 'denied'); assert.equal(resolveConsent({ stored: 'maybe' }), 'unset');
});

test('a player known to be under 18 has analytics off, whatever was accepted', async () => {
  const { log, core } = running({ stored: { consent: 'granted', at: 1 } });
  core.session({ id: PUBLIC }, false, 500); await tick(); await tick();
  const before = log.sent.length;
  assert.ok(before > 0);
  core.identify(PUBLIC, { under18: true });
  assert.equal(log.stopped, 1);
  core.track('activity_completed', { activity_id: 'jog' }); core.setConsent('granted', 'settings'); await tick();
  assert.equal(log.sent.length, before);
  assert.equal(core.consent, 'denied');
});

test('consent timing: never during the first minute — after the first reward, when no sheet is open and nothing is running; "landing" asks at once', async () => {
  const landing = running({ config: { ...CONFIG, posthog: { ...CONFIG.posthog!, consentAt: 'landing' } } });
  await tick();
  assert.equal(landing.log.sheets.length, 1);
  // The default: a new guest is not asked on the landing screen, when the session is made, on arrival, or while playing.
  const { win, log, core } = running();
  const life = (change?: (o: Life['onboarding'], state: Life) => void) => { const state = createLife(null, { now: 1000, isNew: true, quickStart: true }); change?.(state.onboarding, state); return state; };
  const held = life(), playing = life((o) => { o.required = false; o.playedAt = 2000; });
  const busy = life((o, state) => { o.required = false; state.activeAction = { kind: 'activity', id: 'play-ayo', duration: 7, remaining: 3 }; });
  const rewarded = life((o) => { o.required = false; o.firstAt = 10000; o.activities = 1; });
  const rewardedBusy = life((o, state) => { o.required = false; o.firstAt = 10000; state.activeAction = { kind: 'activity', id: 'chill', duration: 11, remaining: 5 }; });
  const step = async (previous: Life, next: Life, now: number) => { core.state(next, previous, client(next, { now })); await tick(); return log.sheets.length; };
  core.needName(); core.session({ id: PUBLIC }, true, 1000); await tick();
  assert.equal(log.sheets.length, 0, 'not when the session is made');
  assert.equal(await step(createLife(undefined), held, 1000), 0, 'not while the landing screen is up');
  assert.equal(await step(held, playing, 2000), 0, 'not on arrival');
  assert.equal(await step(playing, busy, 4000), 0, 'not during the first activity');
  assert.equal(await step(busy, rewarded, 10000), 0, 'not on top of the reward: the reward and the settle-in offer come first');
  win.openDialog = {};
  assert.equal(await step(rewarded, rewarded, 20000), 0, 'not while another sheet ("Make this life yours") is open');
  win.openDialog = null;
  assert.equal(await step(rewarded, rewardedBusy, 21000), 0, 'not while something is running');
  assert.equal(await step(rewardedBusy, rewarded, 30000), 1, 'then, once');
  assert.deepEqual([log.sheets[0]?.source, log.sheets[0]?.state?.consent], ['sheet', 'unset']);
  assert.equal(await step(rewarded, rewarded, 40000), 1, 'and never a second time');
  // A returning player (settled, or a life that never was a guest) is past the first minute — but is not asked on arrival
  // (an invite, a table or an arrival sheet may be on its way): a few seconds into the visit, at the next quiet state.
  const back = running();
  back.core.session({ id: PUBLIC }, false, 5); await tick();
  assert.equal(back.log.sheets.length, 0);
  const home = createLife(undefined);
  back.core.state(home, createLife(undefined), client(null, { now: 60 })); await tick();
  assert.equal(back.log.sheets.length, 0, 'not at their first state');
  back.core.screen('map');
  back.core.state(structuredClone(home), home, client(null, { now: 9000 })); await tick();
  assert.equal(back.log.sheets.length, 0, 'not on the map (a trip, a picked place)');
  back.core.screen('venue');
  back.core.state(structuredClone(home), home, client(null, { now: 9500 })); await tick();
  assert.equal(back.log.sheets.length, 1);
  assert.equal(back.log.sheets[0]?.giveWay, true, 'and it steps aside if the game opens a sheet of its own');
  const answered = running({ stored: { consent: 'denied', at: 1 } });
  answered.core.session({ id: PUBLIC }, false, 5); answered.core.state(createLife(undefined), structuredClone(createLife(undefined)), client(null, { now: 60 })); await tick();
  assert.equal(answered.log.sheets.length, 0);
  // Analytics not configured at all: no sheet, no queue; error monitoring still runs.
  const errorsOnly = running({ config: { ...CONFIG, posthog: null } });
  errorsOnly.core.session({ id: PUBLIC }, true, 5); errorsOnly.core.setConsent('granted'); errorsOnly.core.state(createLife(undefined), structuredClone(createLife(undefined)), client(null, { now: 60 })); await tick(); await tick();
  assert.deepEqual(errorsOnly.log.loaded, ['sentry']);
});

test('the age answer has one home: "under 18" from the server’s configuration, from its consent answer or from the page switches analytics off', async () => {
  // 1. The game's server says so with the configuration: nothing is loaded, nothing is asked, a stored Accept does not count.
  const told = running({ config: { ...CONFIG, under18: true }, stored: { consent: 'granted', at: 1 } });
  told.core.session({ id: PUBLIC }, false, 5); told.core.track('landed', { join: false }); told.core.state(createLife(undefined), structuredClone(createLife(undefined)), client(null, { now: 60 })); told.core.setConsent('granted', 'settings');
  await tick(); await tick();
  assert.deepEqual([told.core.consent, told.log.sent, told.log.sheets.length, told.log.loaded.filter((name) => name !== 'sentry')], ['denied', [], 0, []]);
  assert.deepEqual(told.win.fetches.filter((call) => call.body?.analytics === true), [], 'and the server is never told Accept');
  // 2. The server's answer to an Accept says so (the age was given on another device): the SDK is stopped at once.
  const late = running({ stored: { consent: 'granted', at: 1 } });
  late.win.consentAnswer = { under18: true }; // (the server also answers { analytics: false }, which telemetry ignores)
  late.core.session({ id: PUBLIC }, false, 5); await tick(); await tick(); await tick();
  assert.deepEqual([late.core.consent, late.log.stopped], ['denied', 1]);
  const sent = late.log.sent.length;
  late.core.track('activity_completed', { activity_id: 'jog' }); late.core.setConsent('granted', 'settings'); await tick();
  assert.equal(late.log.sent.length, sent);
  // 3. The page says so the moment the question is answered ('jaw:age', through the facade); "adult" changes nothing.
  const win = fakeWindow({ config: CONFIG, stored: { consent: 'granted', at: 1 } });
  const { log, loaders } = fakeLoaders();
  const telemetry = createTelemetry({ window: win, loadCore: async () => ({ createCore: (options) => createCore({ ...options, loaders, now: () => 1_700_000_000_000 }) }) });
  await telemetry.start(); telemetry.identify(PUBLIC); await tick(); await tick();
  win.dispatch('jaw:age', { age: 'adult' }); telemetry.track('activity_completed', { activity_id: 'jog' });
  assert.deepEqual([log.stopped, names(log).at(-1)], [0, 'activity_completed']);
  const before = log.sent.length;
  win.dispatch('jaw:age', { age: 'minor' }); win.dispatch('jaw:age', { age: 'adult' }); win.dispatch('jaw:age', null);
  telemetry.track('activity_completed', { activity_id: 'jog' }); telemetry.setConsent('granted'); await tick();
  assert.deepEqual([log.stopped, log.sent.length], [1, before], 'off, and an "adult" afterwards does not switch it back on');
  // The game's two places that hold the answer both announce it.
  const growthClient = readFileSync(new URL('../ui/panels/growth-client.js', import.meta.url), 'utf8'), touch = readFileSync(new URL('../ui/panels/touch.js', import.meta.url), 'utf8');
  assert.match(growthClient, /announceAge\(result\.consent\?\.age\)/); assert.match(touch, /announceAge\(result\.consent\?\.age\)/);
});

test('the local government becomes a coarse group once it is chosen — never the game’s guess, never a guest’s', async () => {
  const { log, core } = running({ stored: { consent: 'granted', at: 1 } });
  core.session({ id: PUBLIC }, false, 5); await tick(); await tick();
  const life = (change: (state: Life) => void) => { const state = createLife(undefined); change(state); return state; };
  const guess = life((state) => { state.onboarding.done = true; state.estate.lga = 'mushin'; state.estate.lgaConfirmed = false; });
  const guest = life((state) => { state.onboarding.done = false; state.onboarding.stage = 'guest'; state.estate.lga = 'mushin'; state.estate.lgaConfirmed = true; });
  const ikeja = life((state) => { state.onboarding.done = true; state.estate.lga = 'ikeja'; state.estate.lgaConfirmed = true; });
  const epe = life((state) => { state.onboarding.done = true; state.estate.lga = 'epe'; state.estate.lgaConfirmed = true; });
  core.state(guess, createLife(undefined), client(null, { now: 10 })); core.state(guest, guess, client(null, { now: 20 }));
  assert.deepEqual(log.groups, []);
  core.state(ikeja, guest, client(null, { now: 30 })); core.state(structuredClone(ikeja), ikeja, client(null, { now: 40 })); core.state(epe, ikeja, client(null, { now: 50 }));
  assert.deepEqual(log.groups, [['lga', 'ikeja'], ['lga', 'epe']], 'set when it is known, and again only when it changes');
});

test('the sheet: Accept and Reject are the same control, the details are one tap away, and Settings shows the choice in force', () => {
  const first = consentHtml({ source: 'sheet', state: { analytics: true, errors: true, consent: 'unset' } });
  const buttons = [...first.matchAll(/<button type="button" data-consent="(granted|denied)">([^<]+)<\/button>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(buttons, [['denied', 'Reject'], ['granted', 'Accept']], 'two buttons with identical markup: no class, style or order marks one as preferred');
  assert.ok(first.includes(CONSENT.ask) && first.includes('data-consent="more"') && first.includes('hidden'));
  assert.ok(!first.includes('data-consent="close"'), 'the first question has no way round it');
  const open = consentHtml({ source: 'sheet', state: { analytics: true, consent: 'unset' }, open: true, host: 'https://eu.i.posthog.com' });
  for (const section of whatWeCollect({ host: 'https://eu.i.posthog.com' })) assert.ok(open.includes(section.heading));
  assert.ok(open.includes('European Union'));
  assert.equal(regionWords('https://us.i.posthog.com'), ' Its servers for this game are in the United States.');
  assert.equal(regionWords('https://analytics.example'), '');
  const on = consentHtml({ source: 'settings', state: { analytics: true, consent: 'granted' } });
  assert.ok(on.includes(CONSENT.on) && on.includes('data-consent="denied"') && on.includes('data-consent="close"') && !on.includes('data-consent="granted"'));
  const off = consentHtml({ source: 'settings', state: { analytics: true, consent: 'denied' } });
  assert.ok(off.includes(CONSENT.off) && off.includes('data-consent="granted"'));
  for (const state of [{ analytics: true, signal: true, consent: 'denied' }, { analytics: true, under18: true }, { analytics: false, errors: false }] as ConsentState[]) {
    for (const source of ['sheet', 'settings'] as const) {
      const html = consentHtml({ source, state });
      assert.ok(!html.includes('data-consent="granted"') && !html.includes('data-consent="denied"'), 'no choice is offered where none can take effect');
    }
  }
  assert.ok(consentHtml({ source: 'settings', state: { analytics: true, signal: true } }).includes('Global Privacy Control'));
  assert.ok(consentHtml({ source: 'settings', state: { analytics: false, errors: false } }).includes(CONSENT.notConfigured));
});

// ---- Error monitoring ------------------------------------------------------------------------------

test('error monitoring does not wait for consent; early and kept errors are delivered, breadcrumbs are action types and codes', async () => {
  const win = fakeWindow({ config: CONFIG });
  const early = new Error('before any code ran');
  win.__jawErrors?.push({ e: early });
  const { log, loaders } = fakeLoaders();
  const core = createCore({ config: CONFIG, window: win, loaders, random: () => 1 });
  const kept = new Error('kept');
  core.captureError(kept, { chunk: 'map' });
  core.session({ id: PUBLIC }, false, 5); core.pending('travel'); core.actionDone('travel', 80, { ok: false, code: 'busy' }); core.link('connecting'); core.link('online'); core.screen('map');
  await tick(); await tick(); await tick();
  assert.deepEqual(log.loaded.filter((name) => name === 'sentry'), ['sentry']);
  assert.deepEqual(log.reports.map((report) => report.error), [early, kept]);
  assert.deepEqual(log.reports[1]?.context, { chunk: 'map' });
  assert.deepEqual(log.crumbs.map((crumb) => [crumb.category, crumb.data]), [['action', { type: 'travel', code: 'busy', ok: false }], ['link', { from: 'connecting', to: 'online' }], ['screen', { screen: 'map' }]]);
  assert.deepEqual(win.__jawErrors, []); assert.equal(win.listening('error'), 0);
  assert.ok(log.users.includes(PUBLIC));
  assert.deepEqual(log.sent, [], 'and none of it went to analytics');
  const late = new Error('late');
  core.captureError(late, { chunk: 'scene' }); core.chunkFailed('community', 'did not load');
  assert.deepEqual(log.reports.slice(2).map((report) => report.error), [late, 'did not load']);
  // What such a report looks like once the real scrubber has rebuilt it (the wrapper's beforeSend).
  const event = scrubEvent({ exception: { values: [{ type: 'Error', value: 'late' }] }, extra: { chunk: 'scene' }, breadcrumbs: log.crumbs }, { userId: PUBLIC });
  assert.ok(event);
  assert.deepEqual(event.user, { id: PUBLIC });
  assert.deepEqual(event.breadcrumbs?.map((crumb) => crumb.category), ['action', 'link', 'screen', 'chunk']);
});

test('the kept lists are bounded', async () => {
  const { log, core } = running();
  core.session({ id: PUBLIC }, false, 5);
  for (let i = 0; i < QUEUE_LIMIT * 3; i += 1) core.track('activity_completed', { activity_id: `a${i}` });
  core.setConsent('granted', 'sheet'); await tick(); await tick();
  const waiting = log.sent.filter((event) => event.name === 'activity_completed');
  assert.ok(waiting.length <= QUEUE_LIMIT);
  assert.equal((waiting.at(-1)?.props as { activity_id?: unknown } | undefined)?.activity_id, `a${QUEUE_LIMIT * 3 - 1}`, 'the newest are the ones kept');
});

// ---- The funnel, exactly once -----------------------------------------------------------------------

/** States as the server would send them along a first day. */
function firstDay() {
  const base = createLife(undefined);
  const at = (change: (state: Life) => void) => { const next = structuredClone(base); change(next); return next; };
  const ob = (step: number, more: Record<string, unknown> = {}) => (state: Life) => { state.onboarding = { ...state.onboarding, required: true, step, ...more } as Life['onboarding']; };
  const done = (state: Life) => { ob(5, { done: true, house: 'yaba', lottery: { id: 'lapo-baby', at: 9000 }, completedAt: 9000 })(state); state.location = 'home'; };
  return {
    created: at(ob(0)), look: at(ob(1)), traits: at(ob(2)), dream: at(ob(3)), lottery: at(ob(4)), moved: at(done),
    eating: at((state: Life) => { done(state); state.activeAction = { kind: 'activity', id: 'cook', duration: 30, remaining: 30 }; }),
    eatingLater: at((state: Life) => { done(state); state.activeAction = { kind: 'activity', id: 'cook', duration: 30, remaining: 12 }; }),
    travelling: at((state: Life) => { done(state); state.activeAction = { kind: 'travel', id: 'park', duration: 60, remaining: 60, mode: 'danfo' }; }),
    arrived: at((state: Life) => { done(state); state.location = 'park'; state.travel.trips = 1; state.travel.lastTrip = { mode: 'danfo', from: 'home', to: 'park' }; }),
    worked: at((state: Life) => { done(state); state.location = 'park'; state.travel.trips = 1; state.travel.lastTrip = { mode: 'danfo', from: 'home', to: 'park' }; state.job = 'barista' as unknown as Life['job']; /* a fixture id, not one of the game's jobs */ state.completedShifts = 1; }),
  };
}

test('what telemetry derives from the server’s states fires once with the right properties — across polls, repeats and a reload', async () => {
  let time = 1_700_000_000_000;
  const { win, log, core } = running({ now: () => time });
  const s = firstDay();
  const fresh = createLife(undefined);
  core.setConsent('granted', 'sheet');
  core.needName(); core.needName();                      // the gate is drawn more than once: telemetry reports nothing for it
  time += 3000; core.session({ id: PUBLIC }, true, 1000);
  const play = (previous: Life, next: Life, now: number, pending: string | null = null) => { if (pending) core.pending(pending); core.state(next, previous, client(next, { now })); if (pending) core.actionDone(pending, 50, { ok: true, code: 'ok' }); };
  const dayTwo = structuredClone(s.worked); dayTwo.missions.active = { days: 2, last: 9 }; dayTwo.missions.stamps = { week: 1, days: 2, paid: false };
  const dayOne = structuredClone(s.worked); dayOne.missions.active = { days: 1, last: 8 }; dayOne.missions.stamps = { week: 1, days: 1, paid: false };
  const atEvent = structuredClone(dayTwo); atEvent.events.count = 1;
  play(fresh, s.created, 1000);                          // the first state after connecting: a baseline
  play(s.created, s.look, 3000, 'onboarding.look');
  play(s.look, s.traits, 6000, 'onboarding.traits');
  play(s.traits, s.dream, 7000, 'onboarding.dream');
  play(s.dream, s.lottery, 8000, 'onboarding.lottery');
  play(s.lottery, s.moved, 9000, 'onboarding.home');     // settling in is the quick start's to report (save_character_done), not telemetry's
  play(s.moved, s.moved, 9500);
  play(s.moved, s.eating, 10000, 'activity');
  play(s.eating, s.eatingLater, 28000);                  // polls while it runs
  play(s.eatingLater, s.moved, 40000);                   // it ran to its end
  play(s.moved, s.eating, 41000, 'activity');
  play(s.eating, s.moved, 42000, 'cancel');              // a cancelled activity is not a completed one
  play(s.moved, s.travelling, 50000, 'travel');
  play(s.travelling, s.arrived, 110000);
  play(s.arrived, s.arrived, 111000);
  play(s.arrived, s.worked, 200000);
  play(s.worked, s.worked, 201000);
  play(s.worked, dayOne, 202000);                        // the first active day
  play(dayOne, dayOne, 203000);
  play(dayOne, dayTwo, 90000000);                        // the next one
  play(dayTwo, atEvent, 90001000);                       // showed up at an event
  play(atEvent, atEvent, 90002000);
  await tick(); await tick();
  const funnel = log.sent.filter((event) => !['$pageview', 'consent_choice', 'session_start', 'action_latency'].includes(event.name)).map((event): [string, unknown] => [event.name, event.props]);
  assert.deepEqual(funnel, [
    ['activity_completed', { activity_id: 'cook', venue_id: 'home' }],
    ['first_travel', { mode: 'danfo', ms_since_session: 109000 }],
    ['first_job_shift', { job_id: 'barista', ms_since_session: 199000 }],
    ['streak_day', { days: 1, stamps: 1 }],
    ['streak_day', { days: 2, stamps: 2 }],
    ['event_joined', { venue_id: 'park', total: 1 }],
  ]);
  for (const [name, props] of funnel) for (const key of Object.keys(props as object)) assert.ok(Object.hasOwn(EVENTS[name]!.props, key), `${name}.${key} is in the catalogue`);
  assert.equal(names(log).filter((name) => name === 'session_start').length, 1);

  // A reload on the same device: the same life, the same states — nothing fires a second time.
  const again = running({ now: () => time, stored: win.saved() });
  again.core.needName(); again.core.session({ id: PUBLIC }, false, 300000);
  again.core.state(atEvent, fresh, client(atEvent, { now: 300000 }));
  again.core.state(structuredClone(atEvent), atEvent, client(atEvent, { now: 301000 }));
  await tick(); await tick();
  assert.deepEqual(names(again.log), ['$pageview']);

  // Another device (nothing remembered) with a life that is already under way: the milestones the
  // life has are reported once, marked as backfilled and without invented timings — and no day or event is replayed.
  const other = running({ now: () => time, stored: { consent: 'granted', at: 1 } });
  other.core.session({ id: PUBLIC }, false, 300000);
  other.core.state(atEvent, fresh, client(atEvent, { now: 300000 }));
  other.core.state(structuredClone(atEvent), atEvent, client(atEvent, { now: 301000 }));
  await tick(); await tick();
  assert.deepEqual(other.log.sent.filter((event) => !['$pageview', 'session_start'].includes(event.name)).map((event) => [event.name, event.props]), [
    ['first_travel', { mode: 'danfo', backfill: true }], ['first_job_shift', { job_id: 'barista', backfill: true }]]);
});

test('the derived events read nothing from an unrelated previous state', () => {
  const s = firstDay(), memo = newMemo();
  sessionStarted(memo, 100); sessionStarted(memo, 900);
  assert.equal(memo.t.session, 100, 'the session moment is set once');
  // Another city's life arriving (baseline): what it did is not this page's doing.
  assert.deepEqual(stateEvents(s.created, s.dream, memo, { now: 500, baseline: true }), []);
  assert.deepEqual(stateEvents(s.eating, s.moved, newMemo(), { now: 500, baseline: true }), []);
  assert.deepEqual(stateEvents(s.eating, s.moved, newMemo(), { now: 500 }).map(([name]) => name), ['activity_completed']);
  const days = structuredClone(s.moved); days.missions.active = { days: 5, last: 3 };
  assert.deepEqual(stateEvents(s.moved, days, newMemo(), { now: 1, baseline: true }), [], 'a life seen for the first time does not replay its days');
  assert.deepEqual(stateEvents(null, null, newMemo(), { now: 1 }), []);
});

test('every event the game’s screens report is in the catalogue, with every property it carries — and nothing is defined twice', () => {
  const root = new URL('../', import.meta.url);
  const files: string[] = [];
  const walk = (dir: string): void => { for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) { if (entry.isDirectory()) walk(`${dir}${entry.name}/`); else if ((entry.name.endsWith('.js') || entry.name.endsWith('.ts')) && !/\.test\.[jt]s$/.test(entry.name)) files.push(`${dir}${entry.name}`); } };
  for (const dir of ['ui/', 'quick-start/', 'tables/', 'map3d/', 'scene/']) walk(dir);
  files.push('life-main.js', 'client.ts');
  const reported = new Map<string, { files: Set<string>, keys: Set<string> }>();
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const match of text.matchAll(/\btrack\('([a-z0-9_]+)'(?:,\s*\{([^}]*)\})?/g)) {
      const keys = (match[2] ?? '').split(',').map((part) => (part.trim().split(':')[0] ?? '').trim()).filter((key) => /^[a-z_]+$/i.test(key));
      if (!reported.has(match[1]!)) reported.set(match[1]!, { files: new Set(), keys: new Set() });
      reported.get(match[1]!)!.files.add(file); for (const key of keys) reported.get(match[1]!)!.keys.add(key);
    }
    // Events built as data and reported by the entry: { name: '…', props: { … } }, and the settle-in steps of src/quick-start/model.js.
    for (const match of [...text.matchAll(/name: '([a-z0-9_]+)', props: \{/g), ...(file === 'quick-start/model.ts' ? text.matchAll(/\d: '(settle_[a-z_]+)'/g) : [])]) { if (!reported.has(match[1]!)) reported.set(match[1]!, { files: new Set(), keys: new Set() }); reported.get(match[1]!)!.files.add(file); }
  }
  // The funnel events of src/quick-start/model.js are built as data and reported by life-main.
  for (const name of ['arrived', 'first_activity_started', 'first_activity_completed', 'settle_traits_done', 'settle_dream_done', 'settle_lottery_done', 'save_character_done']) assert.ok(reported.has(name), name);
  assert.ok(reported.size >= 30, `the scan found the game's events (${reported.size})`);
  for (const [name, found] of reported) {
    assert.ok(EVENTS[name], `${name} (reported in ${[...found.files].join(', ')}) is not in the catalogue`);
    assert.ok(['quick-start', 'world', 'growth'].includes(EVENTS[name]!.from), `${name} is reported by a screen, so it must not also be derived by telemetry`);
    for (const key of found.keys) assert.ok(Object.hasOwn(EVENTS[name]!.props, key), `${name}.${key} would be dropped: it is not in the catalogue`);
  }
  // …and the other way round: nothing is catalogued as a screen's event that no screen reports.
  for (const name of TRACKED_EVENTS) assert.ok(reported.has(name), `${name} is catalogued but nothing reports it`);
  // One source per event: an event a screen reports is never also derived here, and the old flow's derivations are gone.
  const derived = readFileSync(new URL('./funnel.ts', import.meta.url), 'utf8') + readFileSync(new URL('./core.ts', import.meta.url), 'utf8');
  for (const name of TRACKED_EVENTS) assert.ok(!new RegExp(`['"]${name}['"]`).test(derived), `${name} is also emitted by telemetry itself`);
  for (const [name, spec] of Object.entries(EVENTS)) if (spec.from === 'client' && name !== '$pageview') assert.ok(new RegExp(`['"]${name}['"]`).test(derived), `${name} is catalogued as derived but telemetry does not emit it`);
});

test('session_start fires once per Lagos day per device, with the first-seen date; day2_return once, on the next day', async () => {
  let time = Date.UTC(2026, 9, 4, 22, 30); // 23:30 in Lagos on 4 October
  const first = running({ now: () => time, stored: { consent: 'granted', at: 1 } });
  first.core.session({ id: PUBLIC }, false, 5); first.core.identify(PUBLIC); first.core.state(createLife({}), createLife(undefined), client());
  await tick(); await tick();
  assert.deepEqual(first.log.sent.filter((event) => event.name === 'session_start').map((event) => [event.props, event.options.$set_once]), [[{ days_since_first_seen: 0, returning: false }, { first_seen_date: '2026-10-04' }]]);
  // The same Lagos day, a reload: no second session_start.
  const reload = running({ now: () => time, stored: first.win.saved() });
  reload.core.session({ id: PUBLIC }, false, 5); await tick(); await tick();
  assert.deepEqual(names(reload.log), ['$pageview']);
  // 40 minutes later it is 5 October in Lagos (still 4 October in UTC): a new day.
  time += 40 * 60000;
  const next = running({ now: () => time, stored: first.win.saved() });
  next.core.session({ id: PUBLIC }, false, 5); await tick(); await tick();
  assert.deepEqual(next.log.sent.filter((event) => event.name !== '$pageview').map((event) => [event.name, event.props]), [['session_start', { days_since_first_seen: 1, returning: true }], ['day2_return', {}]]);
  assert.deepEqual(next.log.sent.find((event) => event.name === 'session_start')?.options.$set_once, { first_seen_date: '2026-10-04' });
  // A week later: a session_start, no second day2_return.
  time += 6 * 86400000;
  const week = running({ now: () => time, stored: next.win.saved() });
  week.core.session({ id: PUBLIC }, false, 5); await tick(); await tick();
  assert.deepEqual(week.log.sent.filter((event) => event.name !== '$pageview').map((event) => [event.name, event.props]), [['session_start', { days_since_first_seen: 7, returning: true }]]);
  // No player connected: a page view is not a session.
  const viewer = running({ now: () => time, stored: { consent: 'granted', at: 1 } });
  await tick(); await tick();
  assert.deepEqual(names(viewer.log), ['$pageview']);
  assert.equal(lagosDay(Date.UTC(2026, 9, 4, 22, 59)), '2026-10-04'); assert.equal(lagosDay(Date.UTC(2026, 9, 4, 23, 0)), '2026-10-05');
  assert.equal(daysBetween('2026-10-04', '2026-11-03'), 30);
});

// ---- Health -----------------------------------------------------------------------------------------

test('health events: failures by code, sampled latency, connection and storage transitions, chunk failures, first scene', async () => {
  let roll = 0;
  const win = fakeWindow({ config: CONFIG, stored: { consent: 'granted', at: 1, lastDay: '2023-11-14', firstSeen: '2023-11-14' } });
  const { log, loaders } = fakeLoaders();
  const core = createCore({ config: CONFIG, window: win, loaders, now: () => 1_700_000_000_000, random: () => roll });
  await tick(); await tick();
  const since = () => log.sent.splice(0).filter((event) => event.name !== '$pageview').map((event) => [event.name, event.props]);
  since();
  core.pending('travel'); core.actionDone('travel', 340.4, { ok: false, code: 'not_enough_cash' });
  assert.deepEqual(since(), [['action_failed', { action_type: 'travel', code: 'not_enough_cash' }], ['action_latency', { action_type: 'travel', ms: 340, bucket: 'lt500', ok: false }]]);
  roll = 0.9; // outside the 1-in-5 sample
  core.actionDone('activity', 90, { ok: true, code: 'started' }); core.actionDone('activity', 5, { ok: false, code: 'busy' });
  assert.deepEqual(since(), []);
  core.link('connecting'); core.link('connecting'); core.link('online'); core.link('unreachable');
  assert.deepEqual(since(), [['connection_state', { from: 'connecting', to: 'online' }], ['connection_state', { from: 'online', to: 'unreachable' }]]);
  const state = createLife(undefined);
  core.state(state, state, client(state, { storage: { reason: 'The server cannot save right now.' } })); core.state(state, state, client(state, { storage: { reason: 'x' } })); core.state(state, state, client(state));
  assert.deepEqual(since(), [['storage_state', { state: 'failing' }], ['storage_state', { state: 'recovered' }]]);
  core.chunkFailed('map', new Error('Failed to fetch dynamically imported module'));
  assert.deepEqual(since(), [['chunk_load_failed', { chunk: 'map' }]]);
  core.hudReady(412.7); core.sceneReady(true, { getContext: (kind) => (kind === 'webgl2' ? {} : null) }, 1880.2); core.sceneReady(true, null, 5);
  win.timers.at(-1)!(); // the frame count did not finish (hidden page): reported without a frame rate
  assert.deepEqual(since(), [['first_scene', { ok: true, renderer: 'webgl2_mid', tti_ms: 413, scene_ms: 1880 }]]);
  assert.equal(latencyBucket(99), 'lt100'); assert.equal(latencyBucket(9000), 'gte5000'); assert.equal(fpsBucket(58), 'gte55'); assert.equal(fpsBucket(12), 'lt15'); assert.equal(fpsBucket(30), '25to39');
});

test('jaw:track: another branch can emit an event without importing anything', async () => {
  const win = fakeWindow({ config: CONFIG, stored: { consent: 'granted', at: 1 } });
  const { log, loaders } = fakeLoaders();
  const telemetry = createTelemetry({ window: win, loadCore: async () => ({ createCore: (options) => createCore({ ...options, loaders, now: () => 1_700_000_000_000 }) }) });
  win.dispatch('jaw:track', { name: 'share_card_created', props: { kind: 'house', channel: 'copy', link: 'https://play.example/?invite=abc123' } });
  win.dispatch('jaw:track', { name: 'minigame_won', props: { game: 'ludo', opponent: 'Ada Obi' } });
  win.dispatch('jaw:track', null); win.dispatch('jaw:track', { name: 42 }); win.dispatch('jaw:track', { name: 'Not A Name' });
  await telemetry.start(); await tick(); await tick();
  assert.equal(telemetry.status, 'on');
  assert.deepEqual(log.sent.filter((event) => event.name !== '$pageview').map((event) => [event.name, event.props]), [['share_card_created', { kind: 'house' }], ['minigame_won', { game: 'ludo' }]]);
  // The identity and a coarse group go through the same facade.
  telemetry.identify(PUBLIC, { nickname: 'Ada Obi' }); telemetry.setGroup('lga', 'ikeja'); telemetry.setGroup('lga', { not: 'an id' });
  assert.deepEqual(log.identified, [PUBLIC]); assert.deepEqual(log.groups, [['lga', 'ikeja']]);
  win.dispatch('jaw:track', { name: 'invite_joined', props: { kind: 'house', minutes_since_opened: 3 } });
  assert.deepEqual(log.sent.at(-1)?.props, { kind: 'house' }, 'a property the catalogue does not list is dropped');
});

test('consent queueing: the question steps aside for a sheet of the game’s, is asked again after it closes, and never inside a flow', async () => {
  // It was showing when the game opened a sheet (an invite link, say): the sheet resolves 'later' with no answer recorded.
  const { win, log, core } = running();
  const home = createLife(undefined);
  const at = async (now: number) => { core.state(structuredClone(home), home, client(null, { now })); await tick(); await tick(); return log.sheets.length; };
  core.session({ id: PUBLIC }, false, 5); await tick();
  assert.equal(await at(100), 0);
  log.answer = 'later';
  assert.equal(await at(6000), 1);
  assert.equal(core.consent, 'unset', 'stepping aside is not an answer');
  assert.equal(win.saved(), null, 'and nothing is remembered');
  // The game's sheet is open: nothing is asked, however many states arrive.
  win.openDialog = {};
  assert.equal(await at(7000), 1);
  // It closes — and another opens straight away (a flow): the look a moment later sees it and waits on.
  const closed = win.docListeners.get('close') as (event: unknown) => void;
  assert.equal(typeof closed, 'function');
  closed({ target: { id: 'life-dialog' } });
  assert.equal(log.sheets.length, 1, 'not at the instant of closing');
  assert.equal(win.timers.length, 1, 'one look, a moment later');
  win.timers.shift()!(); await tick(); await tick();
  assert.equal(log.sheets.length, 1, 'the next sheet of the flow is open: still waiting');
  // The flow ends: the last sheet closes and nothing else opens.
  win.openDialog = null;
  closed({ target: { id: 'life-dialog' } }); closed({ target: { id: 'life-dialog' } });
  assert.equal(win.timers.length, 1, 'two closes in a row are one look');
  log.answer = 'denied';
  win.timers.shift()!(); await tick(); await tick();
  assert.equal(log.sheets.length, 2, 'asked again, once it is quiet');
  assert.equal(core.consent, 'denied');
  // Its own closing is not a reason to ask again.
  closed({ target: { id: 'jaw-consent' } });
  assert.equal(win.timers.length, 0);
  // The seconds after settling in belong to the new home.
  const fresh = running();
  const settled = createLife(undefined); settled.onboarding.completedAt = 50_000;
  fresh.core.session({ id: PUBLIC }, false, 5); await tick();
  fresh.core.state(settled, createLife(undefined), client(null, { now: 40_000 })); await tick();
  fresh.core.state(structuredClone(settled), settled, client(null, { now: 52_000 })); await tick();
  assert.equal(fresh.log.sheets.length, 0, 'not in the seconds after settling in');
  fresh.core.state(structuredClone(settled), settled, client(null, { now: 56_000 })); await tick();
  assert.equal(fresh.log.sheets.length, 1);
});

test('the consent question is worded for the quick start: no step it names is one a player may never reach before being asked', () => {
  assert.doesNotMatch(CONSENT.ask, /creating a Sim/i);
  assert.match(CONSENT.ask, /tap Play/);
});
