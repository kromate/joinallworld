// What may leave the game. Hostile payloads: chat text, names, emails, coordinates, cookie secrets and
// query strings must never survive the scrubber, whichever field they hide in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubText, scrubProps, scrubEvent, stripUrl, isEventName, MAX_PROPS } from './scrub.ts';
import { cleanEvent, captureArgs } from './clean.ts';
import { EVENTS, ACTIVATION_FUNNEL, INVITE_FUNNEL, TRACKED_EVENTS, checkProps } from './events.ts';

const SECRET = '5b0f2c1e-7a44-4d0b-9c1d-2f6f6a7e8b90'; // a cookie secret is a UUID, exactly like this
const PUBLIC = '9d1c7e52-3b7a-4f0e-8a55-0c2d4e6f8a10';
const CHAT = 'meet me at the bar tonight, my number is 0803 555 0199';
const EMAIL = 'ada.obi@example.com';
const leaks = (value: unknown) => { const text = JSON.stringify(value); return [SECRET, CHAT, 'meet me', EMAIL, '0803', '6.5244', '3.3792', 'Ada Obi', 'invite=', 'hunter2'].filter((needle) => text.includes(needle)); };

test('scrubText removes emails, ids, cookies, tokens, coordinates, phone numbers, query strings and quoted prose', () => {
  assert.equal(scrubText(`Cannot send "${CHAT}" to ${EMAIL}`), 'Cannot send "[text]" to [email]');
  assert.equal(scrubText(`session ${SECRET} expired`), 'session [id] expired');
  assert.equal(scrubText(`Cookie: sid=${SECRET}; theme=dark`), 'Cookie=[redacted]');
  assert.equal(scrubText('Authorization: Bearer abc.def.ghi'), 'Authorization=[redacted]');
  assert.equal(scrubText('got Bearer abc.def.ghi back'), 'got Bearer [redacted] back');
  assert.equal(scrubText('login password=hunter2 failed'), 'login password=[redacted] failed');
  assert.ok(!scrubText('fetch https://joinallworld.example/api/life?city=lagos&invite=abc123 failed').includes('invite'));
  assert.ok(!scrubText('GET /api/social/search?q=Ada+Obi 500').includes('Ada'));
  assert.equal(scrubText('avatar at x: 12.25, z: -4.5'), 'avatar at x: [pos], z: [pos]');
  assert.equal(scrubText('{"lat":6.5244,"lng":3.3792}'), '{"lat":[pos],"lng":[pos]}');
  assert.equal(scrubText('near 6.5244, 3.3792 now'), 'near [pos] now');
  assert.ok(!scrubText('call +234 803 555 0199 today').includes('555'));
  // Short quoted identifiers are what makes an error readable, and they stay.
  assert.equal(scrubText("Cannot read properties of undefined (reading 'onboarding')"), "Cannot read properties of undefined (reading 'onboarding')");
  assert.equal(scrubText('x'.repeat(5000)).length, 300);
  assert.equal(scrubText({ toString() { throw new Error('boom'); } }), '');
  assert.equal(scrubText(undefined), '');
});

test('stripUrl keeps origin and path only', () => {
  assert.equal(stripUrl('https://play.example/assets/app-abc.js?v=1#frag'), 'https://play.example/assets/app-abc.js');
  assert.equal(stripUrl('https://user:pw@play.example/x?venue=bar'), 'https://play.example/x');
  assert.equal(stripUrl(`https://play.example/api/social/house/${PUBLIC}`), 'https://play.example/api/social/house/[id]');
  assert.equal(stripUrl(null), '');
});

test('scrubProps keeps numbers, booleans and id-like words; refuses names, prose, emails, positions and every UUID', () => {
  const safe = scrubProps({
    activity_id: 'jog', venue_id: 'park', ms: 123.45678, ok: true, route: 'POST /api/social/house/:host', code: 'storage_unavailable',
    name: 'Ada', nickname: 'Ada Obi', text: CHAT, message: CHAT, body: CHAT, email: EMAIL, contact: EMAIL, x: 12.5, z: -3, lat: 6.5244, position: { x: 1, z: 2 },
    session: SECRET, friend: PUBLIC, sid: SECRET, cookie: `sid=${SECRET}`, url: 'https://play.example/?invite=abc', free: 'two words', nested: { a: 1 }, list: ['a'],
    infinite: Infinity, nan: NaN, fn() {}, 'Bad-Key': 'x', $ip: '10.0.0.1', where: `home:${PUBLIC}`,
  });
  assert.deepEqual(safe, { activity_id: 'jog', venue_id: 'park', ms: 123.457, ok: true, route: 'POST /api/social/house/:host', code: 'storage_unavailable' });
  assert.deepEqual(leaks(safe), []);
  assert.deepEqual(scrubProps(null), {});
  assert.deepEqual(scrubProps('text'), {});
  assert.deepEqual(scrubProps([1, 2]), {});
  assert.equal(Object.keys(scrubProps(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i])))).length, MAX_PROPS);
  // A getter that throws, or a proxy, cannot make it throw.
  assert.deepEqual(scrubProps({ get bad() { throw new Error('boom'); }, fine: 1 }), { fine: 1 });
  assert.deepEqual(scrubProps({ a: 1, b: 2 }, { allow: ['b'] }), { b: 2 });
});

test('scrubEvent rebuilds a Sentry event from allowed fields: hostile data in any field never leaves', () => {
  const hostile = {
    event_id: 'a'.repeat(32), timestamp: 1700000000, platform: 'javascript', level: 'error', release: 'build-7', environment: 'production',
    message: `chat failed: "${CHAT}"`,
    exception: { values: [{ type: 'TypeError', value: `Cannot send "${CHAT}" from ${EMAIL} (sid=${SECRET}) at x: 12.25, z: -4.5`,
      stacktrace: { frames: [{ filename: 'https://play.example/assets/app-abc.js?invite=abc123', function: 'send', lineno: 1, colno: 2, in_app: true, vars: { body: CHAT, cookie: SECRET }, context_line: `const body = "${CHAT}"` }] } }] },
    user: { id: SECRET, ip_address: '197.210.1.2', email: EMAIL, username: 'Ada Obi' },
    request: { url: `https://play.example/?venue=bar&invite=abc123`, query_string: 'invite=abc123', cookies: { sid: SECRET }, data: { body: CHAT }, headers: { Cookie: `sid=${SECRET}`, 'User-Agent': 'Mozilla/5.0 Test', Referer: 'https://x.example/?q=Ada+Obi' } },
    tags: { action_type: 'activity', result_code: 'busy', nickname: 'Ada Obi', chat: CHAT },
    extra: { chunk: 'scene', body: CHAT, position: { x: 12.25, z: -4.5 }, password: 'hunter2', friend: PUBLIC },
    contexts: { game: { screen: 'venue', name: 'Ada Obi' }, device: { name: 'Ada Obi’s iPhone' }, state: { chat: CHAT }, trace: { trace_id: 'b'.repeat(32), span_id: 'c'.repeat(16), data: { url: '?invite=abc' } } },
    breadcrumbs: [
      { category: 'action', timestamp: 1, data: { type: 'activity', code: 'started', body: CHAT } },
      { category: 'console', message: CHAT }, { category: 'ui.click', message: 'button[title="Ada Obi"]' }, { category: 'fetch', data: { url: '/api/social/search?q=Ada+Obi' } },
      { category: 'ui.input', message: CHAT }, { category: 'navigation', data: { to: '/?invite=abc123' } },
    ],
    server_name: 'dev-laptop.local', modules: { ws: '8' }, sdk: { name: 'sentry.javascript.browser', version: '11.4.0', integrations: ['x'] },
  };
  const event = scrubEvent(hostile, { userId: PUBLIC });
  assert.ok(event);
  assert.deepEqual(leaks(event), []);
  assert.deepEqual(event.user, { id: PUBLIC }, 'the user is the public id the telemetry code passed, nothing from the event');
  assert.deepEqual(event.request, { url: 'https://play.example/', headers: { 'User-Agent': 'Mozilla/5.0 Test' } });
  assert.deepEqual(event.tags, { action_type: 'activity', result_code: 'busy' });
  assert.deepEqual(event.extra, { chunk: 'scene' });
  assert.deepEqual(event.breadcrumbs, [{ category: 'action', timestamp: 1, data: { type: 'activity', code: 'started' } }]);
  assert.deepEqual(Object.keys(event.contexts ?? {}).sort(), ['game', 'trace']);
  assert.deepEqual(event.contexts?.game, { screen: 'venue' });
  assert.deepEqual(event.contexts?.trace, { trace_id: 'b'.repeat(32), span_id: 'c'.repeat(16) });
  assert.deepEqual(event.exception?.values[0]?.stacktrace?.frames, [{ filename: 'https://play.example/assets/app-abc.js', function: 'send', lineno: 1, colno: 2, in_app: true }]);
  assert.equal(event.sdk.settings.infer_ip, 'never');
  assert.equal((event as unknown as Record<string, unknown>).server_name, undefined);
  assert.equal(event.release, 'build-7');
  // Without a public id there is no user at all — an id on the event itself is never trusted.
  const bare = scrubEvent(hostile), named = scrubEvent(hostile, { userId: 'Ada Obi' });
  assert.equal(typeof bare, 'object'); assert.notEqual(bare, null); assert.equal(bare?.user, undefined);
  assert.equal(typeof named, 'object'); assert.notEqual(named, null); assert.equal(named?.user, undefined);
});

test('scrubEvent drops browser-extension noise and things that are not events', () => {
  for (const scheme of ['chrome-extension', 'moz-extension', 'safari-web-extension']) {
    assert.equal(scrubEvent({ exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ filename: `${scheme}://abcdef/content.js` }] } }] } }), null);
  }
  assert.equal(scrubEvent(null), null);
  assert.equal(scrubEvent('text'), null);
  assert.ok(scrubEvent({}));
});

test('the catalogue: every event is named and described, and its properties pass the scrubber by name', () => {
  for (const [name, spec] of Object.entries(EVENTS)) {
    assert.ok(isEventName(name), name);
    assert.ok(spec.when.length > 10 && spec.why.length > 5, `${name} says when and why`);
    assert.ok(['client', 'server', 'quick-start', 'world', 'growth', 'campus'].includes(spec.from), name);
    const sample = Object.fromEntries(Object.entries(spec.props).map(([key, type]) => [key, type === 'number' ? 1 : type === 'boolean' ? true : 'word']));
    assert.deepEqual(checkProps(name, sample, scrubProps), sample, `${name}: a catalogued property is refused by the scrubber`);
  }
  for (const name of [...ACTIVATION_FUNNEL, ...INVITE_FUNNEL]) assert.ok(EVENTS[name], name);
  assert.ok(TRACKED_EVENTS.includes('landed') && TRACKED_EVENTS.includes('lga_chosen') && TRACKED_EVENTS.includes('mission_completed') && !TRACKED_EVENTS.includes('activity_completed'));
  // The old flow's events are gone, not kept beside the new ones: one definition per event.
  for (const gone of ['character_step_completed', 'character_done', 'first_activity', 'invite_link_created', 'invite_link_opened', 'invite_copresent', 'share_link_opened']) assert.equal(EVENTS[gone], undefined, gone);
  // Listed properties only, each of its listed type; an uncatalogued event gets the generic scrubber.
  assert.deepEqual(checkProps('activity_completed', { activity_id: 'jog', venue_id: 7, extra: 'no' }, scrubProps), { activity_id: 'jog' });
  assert.deepEqual(checkProps('minigame_won', { game: 'ludo', score: 12, player: 'Ada Obi' }, scrubProps), { game: 'ludo', score: 12 });
});

test('an analytics event as it leaves: only catalogued properties and the allowed PostHog fields', () => {
  assert.equal(captureArgs({ name: 'Bad Name', props: {} }), null);
  assert.equal(captureArgs({ name: '$autocapture', props: {} }), null);
  const args = captureArgs({ name: 'action_failed', props: { action_type: 'travel', code: 'busy', reason: CHAT, nickname: 'Ada Obi' }, at: 1700000000000, extra: { setOnce: { first_seen_date: '2026-10-04', email: EMAIL } } });
  assert.ok(args);
  const [name, props, options] = args;
  assert.equal(name, 'action_failed');
  assert.deepEqual(props, { action_type: 'travel', code: 'busy' });
  assert.deepEqual(options, { timestamp: new Date(1700000000000), $set_once: { first_seen_date: '2026-10-04' } });

  const sent = cleanEvent({ event: 'action_failed', uuid: 'u1', properties: { ...props, token: 'phc_test', distinct_id: PUBLIC, $lib: 'web', $session_id: 's1', $browser: 'Chrome',
    $current_url: 'https://play.example/?invite=abc123', $referrer: 'https://x.example/?q=Ada+Obi', $raw_user_agent: 'Mozilla', $ip: '197.210.1.2', $screen_height: 900, $timezone: 'Africa/Lagos', $initial_current_url: 'https://play.example/?invite=abc123', title: 'Ada Obi' },
  $set: { nickname: 'Ada Obi', email: EMAIL }, $set_once: { first_seen_date: '2026-10-04', $initial_referrer: 'https://x.example/?q=Ada+Obi' } }, { release: 'build-7', env: 'production' });
  assert.ok(sent);
  assert.deepEqual(sent.properties, { action_type: 'travel', code: 'busy', token: 'phc_test', distinct_id: PUBLIC, $lib: 'web', $session_id: 's1', $browser: 'Chrome', $geoip_disable: true, app: 'allworld', environment: 'production', release: 'build-7' });
  assert.equal(sent.$set, undefined);
  assert.deepEqual(sent.$set_once, { first_seen_date: '2026-10-04' });
  assert.deepEqual(leaks(sent), []);
  // A page view carries the page's origin and path, never its query string.
  const view = cleanEvent({ event: '$pageview', properties: { $current_url: 'https://play.example/?invite=abc123' } }, { location: { href: 'https://play.example/?invite=abc123&venue=bar', pathname: '/', host: 'play.example' } });
  assert.ok(view);
  assert.equal(view.properties.$current_url, 'https://play.example/');
  // Anything the SDK would send by itself is dropped.
  for (const event of ['$autocapture', '$pageleave', '$rageclick', '$exception', '$snapshot', '$web_vitals', '$feature_flag_called']) assert.equal(cleanEvent({ event, properties: {} }), null, event);
});

test('sign-in never reaches telemetry: a signed token in any text is replaced, and credential-like properties are refused', () => {
  const jwt = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJVaWRBZGEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSJ9.c2lnbmF0dXJlLWJ5dGVzLWhlcmU';
  assert.equal(scrubText(`sign-in failed for ${jwt} at step 2`), 'sign-in failed for [token] at step 2');
  assert.equal(scrubText(`{"idToken":"${jwt}"}`).includes('eyJ'), false);
  assert.equal(scrubText('refused: password=correct-horse-battery idToken: abc'), 'refused: password=[redacted] idToken: abc');
  assert.deepEqual(scrubProps({ step: 'verify', password: 'hunter2hunter2', passwd: 'x', id_token: 'abc', idtoken: 'abc', refresh_token: 'abc', credential: 'abc', csrf: 'abc', token: 'abc', email: 'ada', idToken: 'abc', provider: 'google' }), { step: 'verify', provider: 'google' });
  assert.deepEqual(scrubProps({ value: jwt, who: 'ada@example.com' }), {}, 'a token or an address is refused as a VALUE too, whatever its property is called');
});
