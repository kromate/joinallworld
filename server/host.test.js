// The route host itself (server/server.js): one answer per request whatever a route module does,
// working core routes without the room module, the operator's budget, the mute rule for names and
// the per-address vote signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.js';
import { ROUTE_MODULES } from './routes/index.js';
import core from './routes/core.js';
import { outcomeKey } from './routes/core.js';
import { FAILED_PER_ADDRESS, FAILED_TOTAL, OPERATOR_PER_MINUTE } from './routes/moderation.js';

const DAY = 86400000, HOUR = 3600000;
const MONDAY = 4 * DAY - 3600000; // the Monday after the fixture's start, 00:00 Lagos time
const TOKEN = 'operator-token-for-tests-0123456789';

/** Route modules that do everything a route must not. The server has to survive each of them. */
const badRoutes = () => ({
  'GET /api/bad/ping': () => ({ body: { ok: true } }),
  'GET /api/bad/circular': () => { const body = { secret: 'do-not-log-me' }; body.self = body; return { body }; },
  'GET /api/bad/bigint': () => ({ body: { n: 10n } }),
  'GET /api/bad/after': () => ({ body: { ok: true }, after() { throw Error('after failed\nwith a second line'); } }),
  'GET /api/bad/after-async': () => ({ body: { ok: true }, after: async () => { throw Error('late'); } }),
  // Answers the request itself, behind the host's back, and then returns (or throws) as if it had not.
  'GET /api/bad/already-sent': (request) => { request.raw.socket._httpMessage.writeHead(200, { 'Content-Type': 'text/plain' }).end('mine'); return { body: { ok: true }, after() { throw Error('x'); } }; },
  'GET /api/bad/sent-then-throw': (request) => { request.raw.socket._httpMessage.writeHead(200, { 'Content-Type': 'text/plain' }).end('mine'); throw Error('after the answer'); },
  'GET /api/bad/status': () => ({ status: 99999, body: { ok: true } }),
  'GET /api/bad/header': () => ({ body: { ok: true }, headers: { 'Set-Cookie': 'a=b\r\nX-Injected: 1', 'X-Powered-By': 'me', 'Content-Length': '1' } }),
  'GET /api/bad/throw-null': () => { throw null; },
  'GET /api/bad/throw-string': () => { throw 'plain string'; },
  'GET /api/bad/throw-odd': () => { throw { status: 'nope', code: 7, message: { toString() { throw Error('no'); } } }; },
  'GET /api/bad/number': () => 42,
  'GET /api/bad/undefined-body': () => ({ body: undefined }),
});

test('whatever a route module does, each request gets one answer and the server keeps running', async (t) => {
  const logs = [];
  const f = await fixture(t, { routes: [...ROUTE_MODULES, badRoutes], log: (line) => logs.push(line) });
  const call = async (path) => { const res = await f.request(path); const text = await res.text(); return { status: res.status, text, headers: res.headers }; };
  const alive = async () => assert.equal((await call('/api/bad/ping')).status, 200);
  for (const path of ['circular', 'bigint']) {
    const answer = await call(`/api/bad/${path}`);
    assert.deepEqual([answer.status, answer.text, answer.headers.get('content-type')], [500, '{"error":"internal_error"}', 'application/json'], path);
    await alive();
  }
  for (const path of ['after', 'after-async']) { const answer = await call(`/api/bad/${path}`); assert.equal(answer.status, 200, path); assert.equal(JSON.parse(answer.text).ok, true); await alive(); }
  for (const path of ['already-sent', 'sent-then-throw']) { assert.deepEqual([(await call(`/api/bad/${path}`)).text], ['mine'], path); await alive(); }
  assert.deepEqual([(await call('/api/bad/status')).status, (await call('/api/bad/status')).text], [500, '{"error":"internal_error"}']);
  const header = await call('/api/bad/header');
  assert.deepEqual([header.status, header.text, header.headers.get('x-injected'), header.headers.get('x-powered-by')], [500, '{"error":"internal_error"}', null, null], 'a header Node refuses becomes one generic 500');
  for (const path of ['throw-null', 'throw-string', 'throw-odd']) { assert.deepEqual([(await call(`/api/bad/${path}`)).status], [500], path); await alive(); }
  assert.deepEqual([(await call('/api/bad/number')).status, (await call('/api/bad/number')).text], [200, '{}']);
  assert.equal((await call('/api/bad/undefined-body')).text, '{}');
  await alive();
  // Real routes still work, and their own headers still get through.
  const session = await f.request('/api/session', { name: 'Ada' });
  assert.equal(session.status, 200); assert.match(session.headers.get('set-cookie'), /^sid=/);
  // Logged, one line each, with nothing from the body and nothing after the first line of a message.
  assert.ok(logs.length >= 8);
  for (const line of logs) { assert.equal(line.includes('\n'), false); assert.equal(line.includes('do-not-log-me'), false); assert.equal(/sid=|Cookie/i.test(line), false); }
  assert.ok(logs.some((line) => /After-response step of GET \/api\/bad\/after failed: after failed$/.test(line)));
});

test('core routes work when the room module is replaced: the room hooks have defaults', async (t) => {
  const f = await fixture(t, { routes: [core], wsModules: [() => ({})], log: () => {} });
  const res = await f.request('/api/session', { name: 'Contract Probe' });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/session', { name: 'Renamed Probe' }, cookie)).status, 200);
  const life = await f.request('/api/life?city=lagos', null, cookie);
  assert.equal(life.status, 200);
  const action = await f.request('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'spot', id: 'trees' }, cookie);
  assert.equal(action.status, 200);
  assert.equal((await f.request('/api/voice-config', null, cookie)).status, 403, 'no room module, so no room to be in');
});

test('socket errors carry a machine code only; anything else is logged, not sent', async (t) => {
  const logs = [];
  const leaky = () => ({ messages: { 'leak-test': () => { throw new TypeError('Cannot read properties of undefined (reading /srv/data/devices.json)'); }, 'coded-test': () => { throw Object.assign(Error('not_allowed_here'), { reason: 'Because.' }); } } });
  const { WS_MODULES } = await import('./ws/index.js');
  const f = await fixture(t, { wsModules: [...WS_MODULES, leaky], log: (line) => logs.push(line) });
  const peer = await f.socket(await f.device('Ada'));
  peer.ws.send(JSON.stringify({ type: 'leak-test' }));
  assert.deepEqual(await peer.next(), { type: 'error', code: 'internal_error', error: 'internal_error' });
  peer.ws.send(JSON.stringify({ type: 'coded-test' }));
  // The sentence the server wrote for the player travels with a coded refusal, as `reason` and repeated as `message`
  // (the field the community panel prints). An uncoded error above carries neither.
  assert.deepEqual(await peer.next(), { type: 'error', code: 'not_allowed_here', error: 'not_allowed_here', reason: 'Because.', message: 'Because.' });
  peer.ws.send('{not json');
  assert.equal((await peer.next()).code, 'invalid_message', 'a frame that is not JSON is a client mistake, with its own code and no log line');
  assert.equal(logs.length, 1);
  assert.ok(logs.some((line) => line.includes('devices.json')), 'the detail is in the server log instead');
});

test('operator token: a valid token has its own budget that nobody else can use up; wrong tokens are capped per address and in total', async (t) => {
  const f = await fixture(t, { moderatorToken: TOKEN, trustProxy: true });
  const mod = (token, address = '41.58.0.1') => fetch(`${f.base}/api/mod/overview`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Forwarded-For': address } });
  // Other clients behind the operator's address exhaust the general per-address limit…
  let limited = 0;
  for (let i = 0; i < 620; i++) if ((await fetch(`${f.base}/api/civic/gov?city=lagos`, { headers: { 'X-Forwarded-For': '41.58.0.1' } })).status === 429) limited += 1;
  assert.ok(limited >= 1, 'the shared address is over its general limit');
  // …and the operator, with the token, is still answered: that budget is separate.
  assert.equal((await mod(TOKEN)).status, 200);
  // Wrong or missing tokens from that address are already refused by the general limit.
  assert.equal((await mod('wrong-token-wrong-token-wrong-token')).status, 429);
  // From a fresh address: 401 for the first ten, then 429 — and a right token still works from there.
  const statuses = [];
  for (let i = 0; i < FAILED_PER_ADDRESS + 2; i++) statuses.push((await mod(i % 2 ? '' : `guess-${i}-guess-guess-guess-guess`, '41.58.0.2')).status);
  assert.deepEqual(statuses, [...Array(FAILED_PER_ADDRESS).fill(401), 429, 429]);
  assert.equal((await mod(TOKEN, '41.58.0.2')).status, 200, 'failed attempts by others never lock the token out');
  // Guessing from many addresses is bounded in total.
  let refused = 0;
  for (let i = 0; i < FAILED_TOTAL; i++) if ((await mod('guess-guess-guess-guess-guess-0', `41.58.1.${i}`)).status === 429) refused += 1;
  assert.equal(refused, 10, `ten wrong tokens were counted above; the 91st new address is the ${FAILED_TOTAL + 1}th, and it and every later one is refused at its first try`);
  assert.equal((await mod('guess-guess-guess-guess-guess-1', '41.58.9.9')).status, 429);
  assert.equal((await mod(TOKEN, '41.58.9.9')).status, 200);
  // The valid token's own budget is finite too.
  let over = 0;
  for (let i = 0; i < OPERATOR_PER_MINUTE + 5; i++) if ((await mod(TOKEN, '41.58.0.3')).status === 429) over += 1;
  assert.equal(over, 5);
  f.advance(600001);
  assert.equal((await mod('', '41.58.0.2')).status, 401, 'the windows pass');
});

test('a muted player cannot put a name in front of others: not a new one, and the same one is not re-announced', async (t) => {
  const f = await fixture(t, { moderatorToken: TOKEN });
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const a = await f.joinRoom(ada); await f.joinRoom(bola);
  // Everything Ada's socket is sent from here on, read without consuming the fixture's queue.
  const heard = []; a.ws.on('message', (data) => heard.push(JSON.parse(data.toString())));
  const presences = async () => { await new Promise((resolve) => setTimeout(resolve, 60)); return heard.splice(0).filter((message) => message.type === 'presence').length; };
  const mute = (minutes) => fetch(`${f.base}/api/mod/mutes`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bola.id, minutes, reason: 'Spam' }) });
  await presences();
  // Before the mute, sending the same name again is announced to the room like any name refresh.
  assert.equal((await f.request('/api/session', { name: 'Bola' }, bola.cookie)).status, 200);
  assert.equal(await presences(), 1);
  assert.equal((await mute(600)).status, 200);
  await presences();
  const before = (await f.server.store.read((db) => Object.values(db.sessions).find((item) => item.publicId === bola.id))).expiresAt;
  f.advance(HOUR);
  const other = await f.request('/api/session', { name: 'Someone Else' }, bola.cookie);
  const refusal = await other.json();
  assert.deepEqual([other.status, refusal.error], [403, 'muted']); assert.match(refusal.reason, /A moderator has muted you/);
  const same = await f.request('/api/session', { name: 'Bola' }, bola.cookie);
  assert.equal(same.status, 200);
  assert.deepEqual((await same.json()).session, { id: bola.id, name: 'Bola', cities: ['lagos'] });
  assert.match(same.headers.get('set-cookie'), /^sid=/, 'the session itself is renewed as for anyone');
  const stored = await f.server.store.read((db) => Object.values(db.sessions).find((item) => item.publicId === bola.id));
  assert.equal(stored.name, 'Bola'); assert.equal(stored.expiresAt, before + HOUR, 'both requests renewed the stored session');
  assert.equal(await presences(), 0, 'nothing was announced to the room for either request');
  // A new device is a new player, not the muted one.
  assert.equal((await f.request('/api/session', { name: 'Bola' })).status, 200);
});

test('votes per address: by default a vote past the number is counted and flagged for the operator; refusing is opt-in and never reports a refused vote as counted', async (t) => {
  for (const mode of ['flag', 'refuse']) {
    const f = await fixture(t, { moderatorToken: TOKEN, trustProxy: true, votesPerAddress: 2, ...(mode === 'refuse' ? { voteCapMode: 'refuse' } : {}) });
    assert.equal(f.server.store !== undefined, true);
    const call = async (path, body, device, address) => {
      const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(device ? { Cookie: device.cookie } : {}), ...(address ? { 'X-Forwarded-For': address } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, ...(await res.json()) };
    };
    const act = (device, type, payload) => call('/api/action', { actionId: `${f.now()}:${randomUUID()}`, cityId: 'lagos', type, payload }, device);
    const people = [];
    for (const name of ['Ada', 'Bola', 'Chidi', 'Dayo']) people.push(await f.device(name));
    const workDay = async () => {
      for (const device of people) { await act(device, 'apply-job', { id: 'community-helper' }); await act(device, 'spot', { id: 'work' }); assert.equal((await act(device, 'activity', { id: 'helper-shift' })).ok, true); }
      f.advance(21000);
      for (const device of people) await call('/api/life?city=lagos', null, device);
    };
    await workDay(); f.advance(DAY - 21000); await workDay();
    const [ada, bola, chidi, dayo] = people;
    f.advance(MONDAY + 60000 - f.now());
    assert.equal((await call('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Light for all', requestId: f.id() }, ada, '41.58.0.1')).code, 'declared');
    f.advance(MONDAY + 3 * DAY + 9 * HOUR - f.now());
    for (const device of people) assert.equal((await act(device, 'travel', { id: 'polling-unit', mode: 'trek' })).ok, true);
    f.advance(30000);
    const carrier = '102.89.32.7'; // one public address shared by many subscribers
    const vote = (device) => call('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, device, carrier);
    assert.equal((await vote(ada)).code, 'voted'); assert.equal((await vote(bola)).code, 'voted');
    const third = await vote(chidi);
    const audit = (await (await fetch(`${f.base}/api/mod/audit`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).audit;
    if (mode === 'flag') {
      assert.deepEqual([third.ok, third.code, third.gov.election.totalVotes, third.gov.election.yourVote], [true, 'voted', 3, ada.id], 'counted');
      assert.equal((await vote(dayo)).code, 'voted');
      assert.deepEqual(audit.map((line) => line.action).filter((action) => action.startsWith('vote-cap')), ['vote-cap-flag'], 'one line for the operator, not one per vote');
      assert.match(audit.find((line) => line.action === 'vote-cap-flag').detail, /They are all being counted/);
      assert.equal((await call('/api/civic/gov?city=lagos', null, dayo)).election.totalVotes, 4);
    } else {
      assert.deepEqual([third.ok, third.code, third.gov.election.totalVotes, third.gov.election.yourVote], [false, 'address_vote_limit', 2, null], 'refused, and shown as not cast');
      assert.match(third.reason, /Your vote was not counted/);
      assert.notEqual(third.state.message, 'Your vote was counted.');
      assert.deepEqual(audit.map((line) => line.action).filter((action) => action.startsWith('vote-cap')), ['vote-cap']);
      // The refused voter can still vote from another connection, once.
      const elsewhere = await call('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, chidi, '197.210.1.1');
      assert.deepEqual([elsewhere.code, elsewhere.gov.election.totalVotes], ['voted', 3]);
    }
    // Either way, a vote answered `voted` is in the data file.
    await f.flush();
    const stored = await f.server.store.read((db) => Object.values(db.civic.cities.lagos.gov.elections).at(-1).votes);
    assert.equal(Object.keys(stored).length, mode === 'flag' ? 4 : 3);
  }
});

test('the poll outcome key covers what a settlement can decide by chance', () => {
  const base = { cash: 1, ledger: [], location: 'park', activeAction: null, inventory: {}, job: null, completedShifts: 0, message: '', health: { sick: false, cause: null }, travel: { event: null }, skills: { fitness: 0 }, goals: { chain: 0, stars: 0, granted: 0, dreamDone: false } };
  const changes = [(s) => { s.health.sick = true; }, (s) => { s.health.cause = 'rain'; }, (s) => { s.travel.event = { id: 'wallet' }; }, (s) => { s.skills.fitness = 15; }, (s) => { s.goals.stars = 1; }, (s) => { s.goals.chain = 1; }, (s) => { s.cash = 2; }, (s) => { s.message = 'x'; }];
  for (const change of changes) { const next = structuredClone(base); change(next); assert.notEqual(outcomeKey(next), outcomeKey(base)); }
  const drift = structuredClone(base); drift.t = 5; drift.needs = { hunger: 49 };
  assert.equal(outcomeKey(drift), outcomeKey(base), 'the clock and slow need decay alone are not an outcome');
});

// ---- the merged host: pages, the outside-world capabilities, static files and shutdown ------------------------------

/** A route module that registers pages which do everything a page must not, and reports what the host hands a module. */
const pageRoutes = (seen) => (ctx) => {
  seen.ctx = ctx;
  ctx.pages.set('/p/', async ({ path, query, origin, ip, method, ...rest }) => {
    seen.page = { path, origin, ip: typeof ip, method, extra: Object.keys(rest) };
    if (path === '/p/throw') throw Error('page failed\nwith a second line');
    if (path === '/p/nothing') return null;
    if (path === '/p/odd') return { status: 99999, html: '<p>odd</p>', headers: { 'Set-Cookie': 'a=b', 'Content-Security-Policy': "default-src *" } };
    if (path === '/p/private') return { status: 200, cache: false, html: '<p>private</p>' };
    if (path === '/p/missing') return { status: 404, html: '<p>missing</p>' };
    return { status: 200, html: `<p>${query.get('q') === '1' ? 'one' : 'page'}</p>` };
  });
  return {};
};

test('pages (/s/, /e/) are served by the host like any route: one answer, the same limit, fixed headers, a template for telemetry', async (t) => {
  const seen = {}, calls = [];
  const telemetry = { enabled: false, attach() {}, close: async () => {}, started() {}, captureError() {}, socketIn() {}, socketOut() {}, socketClosed() {}, socketFailed() {},
    http: (entry) => calls.push(['http', entry.method, entry.route, entry.status, Object.keys(entry).sort().join()]), httpFailed: (error, entry) => calls.push(['failed', entry.method, entry.route, entry.status, entry.code]) };
  const f = await fixture(t, { routes: [core, pageRoutes(seen)], telemetry, log: () => {} });
  const get = (path, init) => fetch(`${f.base}${path}`, init);
  const page = await get('/p/x?q=1');
  assert.deepEqual([page.status, await page.text()], [200, '<p>one</p>']);
  assert.deepEqual([page.headers.get('content-type'), page.headers.get('x-content-type-options'), page.headers.get('referrer-policy'), page.headers.get('x-frame-options'), page.headers.get('cache-control'), page.headers.get('set-cookie')],
    ['text/html; charset=utf-8', 'nosniff', 'no-referrer', 'DENY', 'public, max-age=300', null]);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/); assert.match(csp, /frame-ancestors 'none'/); assert.ok(!/script-src/.test(csp), 'no script may run on a page');
  // The page is handed the path, the query, the origin, the address and the method — never the request, a header or a cookie.
  assert.deepEqual(seen.page, { path: '/p/x', origin: f.base, ip: 'string', method: 'GET', extra: [] });
  // A page cannot set a header or an impossible status, and an error page or a private page is never cached.
  const odd = await get('/p/odd');
  assert.deepEqual([odd.status, odd.headers.get('set-cookie'), odd.headers.get('content-security-policy')], [200, null, csp]);
  assert.equal((await get('/p/private')).headers.get('cache-control'), 'no-store');
  const missing = await get('/p/missing');
  assert.deepEqual([missing.status, missing.headers.get('cache-control')], [404, 'no-store']);
  // HEAD has the headers and no body; POST is allowed only to a page, is never cached and its body is not read.
  const head = await get('/p/x', { method: 'HEAD' });
  assert.deepEqual([head.status, await head.text()], [200, '']);
  const posted = await get('/p/x', { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.deepEqual([posted.status, posted.headers.get('cache-control'), seen.page.method], [200, 'no-store', 'POST']);
  assert.equal((await get('/not-a-page', { method: 'POST', body: 'x' })).status, 405, 'POST outside /api/ and outside a page is refused');
  assert.equal((await get('/p/nothing', { method: 'POST', body: 'x' })).status, 405);
  // A page that throws is one generic answer, logged by its first line only, and the server carries on.
  const thrown = await get('/p/throw');
  assert.deepEqual([thrown.status, await thrown.json()], [500, { error: 'internal_error' }]);
  assert.equal((await get('/p/x')).status, 200);
  // Telemetry sees a path template and a status — never the path, the query or a body.
  assert.deepEqual(calls.filter((call) => call[2] === '/p/*').slice(0, 2), [['http', 'GET', '/p/*', 200, 'method,ms,route,status'], ['http', 'GET', '/p/*', 200, 'method,ms,route,status']]);
  assert.ok(calls.some((call) => call[0] === 'failed' && call[2] === '/p/*' && call[3] === 500));
  assert.ok(!JSON.stringify(calls).includes('q=1') && !JSON.stringify(calls).includes('/p/x'));
  // The same per-address budget as the API: once it is used up a page is refused like any request.
  let limited = null;
  for (let i = 0; i < 620 && !limited; i++) { const res = await get('/p/x'); if (res.status === 429) limited = await res.json(); else await res.arrayBuffer(); }
  assert.deepEqual(limited, { error: 'rate_limited' });
});

test('ctx.env is an allowlist, ctx.fetch is https-only, bounded and follows no redirect, and key files are private', async (t) => {
  const seen = {}, outbound = [];
  const env = { ZEPTOMAIL_AUTH: 'send-token', EMAIL_FROM_ADDRESS: 'hello@example.com', WHATSAPP_CHANNEL_URL: 'https://whatsapp.com/channel/x', MODERATOR_TOKEN: TOKEN, SENTRY_AUTH_TOKEN: 'secret', PATH: '/usr/bin', HOME: '/root', POSTHOG_KEY: 'phc_x', EMAIL_DAILY_CAP: 5 };
  const f = await fixture(t, { routes: [core, pageRoutes(seen)], env, fetch: async (url, init) => { outbound.push({ url, init }); return { ok: true, status: 200 }; } });
  const { ctx } = seen;
  assert.deepEqual(['ZEPTOMAIL_AUTH', 'EMAIL_FROM_ADDRESS', 'WHATSAPP_CHANNEL_URL'].map((name) => ctx.env(name)), ['send-token', 'hello@example.com', 'https://whatsapp.com/channel/x']);
  for (const name of ['MODERATOR_TOKEN', 'SENTRY_AUTH_TOKEN', 'PATH', 'HOME', 'POSTHOG_KEY', 'DATA_DIR', 'constructor', '__proto__', 'toString', '', undefined, null, 7]) assert.equal(ctx.env(name), '', String(name));
  assert.equal(ctx.env('EMAIL_DAILY_CAP'), '', 'a value that is not a string is not handed out');
  assert.equal(ctx.env('EMAIL_FROM_NAME'), '', 'an allowed name that is not set is the empty string');
  // Outside requests.
  for (const url of ['http://api.zeptomail.com/v1.1/sg/email', 'file:///etc/passwd', 'ftp://example.com/', 'not a url', '//example.com', '']) await assert.rejects(() => ctx.fetch(url, { method: 'POST' }), TypeError, url);
  assert.equal(outbound.length, 0, 'a refused request never reaches the network');
  const own = new AbortController();
  await ctx.fetch('https://api.zeptomail.com/v1.1/sg/email', { method: 'POST', body: '{}', redirect: 'follow', signal: own.signal, headers: { Authorization: 'x' } });
  await ctx.fetch('https://fcm.googleapis.com/fcm/send/abc');
  assert.deepEqual(outbound.map((call) => [call.url, call.init.redirect, call.init.signal instanceof AbortSignal, call.init.method]), [['https://api.zeptomail.com/v1.1/sg/email', 'error', true, 'POST'], ['https://fcm.googleapis.com/fcm/send/abc', 'error', true, undefined]]);
  assert.notEqual(outbound[0].init.signal, own.signal, 'the caller’s signal is combined with the host’s time limit, not trusted alone');
  own.abort(); assert.equal(outbound[0].init.signal.aborted, true, 'and the caller can still cancel');
  // A secret the server makes for itself: made once, readable by the server's user only, and only under a plain name.
  const { stat } = await import('node:fs/promises'), { join } = await import('node:path');
  let made = 0;
  const first = await ctx.keyFile('test-key', async () => { made += 1; return { key: 'k1' }; }), again = await ctx.keyFile('test-key', async () => { made += 1; return { key: 'k2' }; });
  assert.deepEqual([first, again, made], [{ key: 'k1' }, { key: 'k1' }, 1]);
  assert.equal((await stat(join(f.dir, 'keys', 'test-key.json'))).mode & 0o777, 0o600);
  for (const name of ['../escape', 'a/b', 'UPPER', '', '.hidden', 'x'.repeat(40)]) await assert.rejects(() => ctx.keyFile(name, async () => ({})), /Invalid key file name/, name);
});

test('static files: a source map is never served, and the game page carries an absolute preview image', async (t) => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, 'assets'));
  const page = '<!doctype html><head><meta property="og:image" content="/og/allworld.jpg"><meta name="twitter:image" content="/og/allworld.jpg"><meta property="og:image:alt" content="/og/not-an-image"><link rel="icon" href="/icons/icon-192.png"></head><body>game</body>';
  await writeFile(join(dist, 'index.html'), page);
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(dist, 'assets', 'app.js.map'), '{"sources":["../../src/secret.js"]}');
  const f = await fixture(t, { distDir: dist, publicOrigin: 'https://play.example' });
  const get = (path, headers) => fetch(`${f.base}${path}`, { headers });
  assert.deepEqual([(await get('/assets/app.js')).status, (await get('/assets/app.js.map')).status, (await get('/anything.map')).status], [200, 404, 404]);
  assert.deepEqual(await (await get('/assets/app.js.map')).json(), { error: 'not_found' });
  const expected = page.replaceAll('content="/og/allworld.jpg"', 'content="https://play.example/og/allworld.jpg"');
  // The index, and every path that falls back to it (an invite link, a share link on a host without the page).
  for (const path of ['/', '/index.html', '/v/11111111-1111-4111-8111-111111111111', '/some/deep/link']) assert.equal(await (await get(path)).text(), expected, path);
  assert.ok(expected.includes('content="/og/not-an-image"') && expected.includes('href="/icons/icon-192.png"'), 'only the two preview-image tags are rewritten');
  // Without PUBLIC_ORIGIN the request's own host is used — and only if it is made of host characters.
  const g = await fixture(t, { distDir: dist, publicOrigin: '' });
  assert.ok((await (await fetch(`${g.base}/`)).text()).includes(`content="${g.base}/og/allworld.jpg"`));
  const h = await fixture(t, { distDir: dist, publicOrigin: 'javascript:alert(1)//' });
  assert.ok((await (await fetch(`${h.base}/`)).text()).includes(`content="${h.base}/og/allworld.jpg"`), 'a PUBLIC_ORIGIN that is not an origin is ignored');
});

test('shutdown has one order: modules finish, the world and the store are written, telemetry goes last — and each step runs once', async (t) => {
  const order = [], { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { once } = await import('node:events');
  const { createServer } = await import('./server.js'), { createStore } = await import('./store.js');
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-stop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const real = await createStore(dir);
  const store = new Proxy(real, { get: (target, key) => (key === 'close' ? async () => { order.push('store'); return target.close(); } : Reflect.get(target, key)) });
  const telemetry = { enabled: false, attach() {}, started() {}, captureError() {}, http() {}, httpFailed() {}, socketIn() {}, socketOut() {}, socketClosed() {}, socketFailed() {}, close: async () => { order.push('telemetry'); } };
  const module = (ctx) => { ctx.closing.push(async () => { await new Promise((done) => setTimeout(done, 20)); order.push('module'); }); ctx.closing.push(async () => { order.push('module-that-fails'); throw Error('boom'); }); return {}; };
  const logs = [];
  const server = await createServer({ dataDir: dir, store, telemetry, routes: [core, module], log: (line) => logs.push(line) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const closeShards = server.shards.close.bind(server.shards);
  server.shards.close = async () => { order.push('world'); return closeShards(); };
  await new Promise((done) => server.close(done));
  assert.deepEqual(order, ['module', 'module-that-fails', 'world', 'store', 'telemetry']);
  assert.ok(logs.some((line) => /Shutdown: a module failed: boom/.test(line)), 'a failing step is logged and does not stop the rest');
  await server.flush();
  assert.equal(order.length, 5, 'asking again flushes nothing twice');
});
