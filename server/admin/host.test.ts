// OWNER: admin - the admin address (server/admin/host.ts) on the Node host: what it answers, its headers, its own session and its own limits.
// The Worker host's half is in deploy/admin-host.edge.test.ts. Requests carry the Host header by hand (the server tells the two addresses apart by it).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_ROBOTS, adminAddress, adminHostName, adminHostRoute, isAdminHost } from './host.ts';
import { admins, FOUNDER_ADDRESS } from './admin.test.ts';

const SHELL = '<!doctype html><title>Allworld staff</title><div id="app"></div><script type="module" src="/assets/adminshell-test.js"></script>';
const INDEX = '<!doctype html><title>The game</title><div id="app"></div><script type="module" src="/assets/app-test.js"></script>';

test('which host is the admin address, and what it answers', () => {
  assert.equal(adminHostName(undefined, 'https://joinallworld.com'), 'admin.joinallworld.com');
  assert.equal(adminHostName('', 'https://www.example.org'), 'admin.example.org', 'a leading www is dropped');
  assert.equal(adminHostName(undefined, ''), 'admin.joinallworld.com', 'with nothing set, the site\'s own origin');
  assert.equal(adminHostName('Staff.Example.org', 'https://joinallworld.com'), 'staff.example.org', 'the setting wins, lower-cased');
  assert.equal(adminHostName('not a host', 'https://joinallworld.com'), '', 'a malformed setting means no admin address at all');
  assert.equal(adminHostName(undefined, 'http://127.0.0.1:3001'), '', 'an address with no domain gets none');
  assert.ok(isAdminHost('admin.localhost:4173', '') && isAdminHost('ADMIN.localhost', ''));
  assert.ok(isAdminHost('admin.joinallworld.com', 'admin.joinallworld.com') && isAdminHost('admin.joinallworld.com:443', 'admin.joinallworld.com'));
  assert.ok(!isAdminHost('joinallworld.com', 'admin.joinallworld.com') && !isAdminHost('admin.evil.example', 'admin.joinallworld.com') && !isAdminHost(undefined, 'admin.x.com') && !isAdminHost('admin.localhost.evil.com', ''));
  const route = (method: string, path: string) => adminHostRoute(method, path);
  assert.deepEqual(['/', '/players/abc', '/index.html', '/adminshell'].map((path) => route('GET', path)), ['shell', 'shell', 'shell', 'shell']);
  assert.deepEqual(['/assets/a.js', '/favicon.svg'].map((path) => route('GET', path)), ['asset', 'asset']);
  assert.equal(route('GET', '/robots.txt'), 'robots');
  for (const path of ['/api/health', '/api/session', '/api/account', '/api/account/sign-in', '/api/admin/me', '/api/admin/players/x/act']) assert.equal(route(path.includes('sign-in') || path.endsWith('/act') ? 'POST' : 'GET', path), 'api', path);
  for (const path of ['/api/action', '/api/life', '/api/social/me', '/api/mod/overview', '/api/growth/client', '/api/companion/ask', '/socket', '/manifest.webmanifest', '/sitemap.xml', '/sw.js', '/s/abc', '/e/unsubscribe', '/api/accounts', '/api']) assert.equal(route('GET', path), 'notfound', path);
  assert.equal(route('POST', '/api/session'), 'notfound', 'the admin address makes no guest players');
  assert.equal(route('POST', '/'), 'method'); assert.equal(adminAddress('1.2.3.4'), 'admin:1.2.3.4');
});

/** One request with a Host header of our choosing, answered as text. */
function call(base: string, host: string, path: string, { method = 'GET', body, cookie, headers = {} }: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const request = http.request({ host: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { host, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function site(t: import('node:test').TestContext) {
  const dist = await mkdtemp(join(tmpdir(), 'allworld-dist-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), INDEX); await writeFile(join(dist, 'adminshell.html'), SHELL); await writeFile(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  await writeFile(join(dist, 'assets', 'adminshell-test.js'), 'export {}'); await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  t.after(async () => { await rm(dist, { recursive: true, force: true }); });
  return dist;
}
const ADMIN = 'admin.localhost';

test('the admin address serves the admin page and its files and a few routes; the game\'s own address is unchanged', async (t) => {
  const dist = await site(t);
  const a = await admins(t, { distDir: dist });
  const page = await call(a.f.base, ADMIN, '/');
  assert.equal(page.status, 200); assert.match(page.text, /Allworld staff/); assert.doesNotMatch(page.text, /The game/);
  assert.equal((await call(a.f.base, ADMIN, '/players/3f9a1c2e-1111-4222-8333-444455556666')).text, page.text, 'every page path is the same single-page app');
  for (const name of ['x-robots-tag', 'content-security-policy', 'referrer-policy', 'x-frame-options', 'cache-control', 'permissions-policy']) assert.ok(page.headers[name], name);
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow'); assert.equal(page.headers['referrer-policy'], 'no-referrer'); assert.equal(page.headers['x-frame-options'], 'DENY'); assert.equal(page.headers['cache-control'], 'no-store');
  const csp = String(page.headers['content-security-policy']);
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /default-src 'self'/); assert.doesNotMatch(csp, /cloudflareinsights/, 'no analytics beacon on the admin address'); assert.match(String(page.headers['permissions-policy']), /microphone=\(\)/);
  const robots = await call(a.f.base, ADMIN, '/robots.txt'); assert.equal(robots.status, 200); assert.equal(robots.text, ADMIN_ROBOTS); assert.match(robots.text, /Disallow: \//);
  assert.equal((await call(a.f.base, ADMIN, '/assets/adminshell-test.js')).status, 200); assert.equal((await call(a.f.base, ADMIN, '/assets/gone.js')).status, 404);
  assert.equal((await call(a.f.base, ADMIN, '/favicon.svg')).status, 200);
  // everything else is a plain 404: no game page, no sockets, no manifest, no sitemap, no previews, no game routes
  for (const path of ['/manifest.webmanifest', '/sitemap.xml', '/s/abc', '/e/x', '/socket', '/api/life?city=lagos', '/api/social/me', '/api/mod/overview', '/api/companion/ask']) assert.equal((await call(a.f.base, ADMIN, path)).status, 404, path);
  assert.equal((await call(a.f.base, ADMIN, '/api/session', { method: 'POST', body: { name: 'Mallory' }, headers: { origin: `http://${ADMIN}` } })).status, 404, 'no guest players can be made here');
  assert.equal((await call(a.f.base, ADMIN, '/api/action', { method: 'POST', body: {}, headers: { origin: `http://${ADMIN}` } })).status, 404);
  assert.equal((await call(a.f.base, ADMIN, '/', { method: 'POST', body: {} })).status, 405);
  const health = await call(a.f.base, ADMIN, '/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.text).ok, true);
  const account = await call(a.f.base, ADMIN, '/api/account'); assert.equal(account.status, 200); assert.equal(account.headers['cache-control'], 'no-store');
  // the game's own address: its page, its robots file, and no admin page
  const game = await call(a.f.base, '127.0.0.1', '/'); assert.equal(game.status, 200); assert.match(game.text, /The game/); assert.doesNotMatch(String(game.headers['x-robots-tag'] ?? ''), /noindex/);
  assert.equal((await call(a.f.base, '127.0.0.1', '/robots.txt')).text, 'User-agent: *\nAllow: /\n');
  assert.equal((await call(a.f.base, '127.0.0.1', '/adminshell.html')).status, 404); assert.equal((await call(a.f.base, '127.0.0.1', '/adminshell')).status, 200, 'an unknown path is the game page, as before');
  assert.match((await call(a.f.base, '127.0.0.1', '/adminshell')).text, /The game/);
  assert.equal((await call(a.f.base, '127.0.0.1', '/manifest.webmanifest')).status, 200);
});

test('signing in on the admin address binds a session there; the same cookie means nothing on the game, and every admin route refuses a non-admin there', async (t) => {
  const dist = await site(t);
  const a = await admins(t, { distDir: dist });
  const host = (path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) => call(a.f.base, ADMIN, path, { cookie, ...(body !== undefined ? { method: 'POST', body } : {}), headers: { origin: `http://${ADMIN}`, ...headers } });
  // no cookie yet: the admin address does not know this browser
  assert.equal((await host('/api/admin/me', '')).status, 404);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'); // a session bound to the founder's account (made on the test host)
  const me = await host('/api/admin/me', founder.cookie); assert.equal(me.status, 200); assert.equal(JSON.parse(me.text).level, 'root');
  assert.equal((await a.admin('/api/admin/me', founder.cookie)).status, 200, 'the game\'s own address still has the Admin entry');
  // the sign-in itself, on the admin address, with no session before it: a fresh cookie comes back
  const { signToken, claimsFor } = await import('../accounts/test-tokens.ts');
  const idToken = await signToken(a.key, claimsFor('allworld-test-project', a.f.now(), { subject: `Uid${FOUNDER_ADDRESS.replace(/\W/g, '')}`, email: FOUNDER_ADDRESS, n: 777 }));
  const state = JSON.parse((await host('/api/account', '')).text) as { csrf: string | null; enabled: boolean };
  assert.equal(state.enabled, true);
  const signed = await host('/api/account/sign-in', '', { idToken, csrf: state.csrf ?? undefined });
  assert.equal(signed.status, 200, signed.text);
  const set = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  assert.match(set, /sid=/);
  assert.equal((await host('/api/admin/me', set)).status, 200, 'the session made on the admin address is an admin session');
  // a signed-in non-admin is refused on the admin address, with the plain not_found every refusal gives
  const ada = await a.account('ada@example.com', 'Ada');
  assert.equal((await host('/api/admin/me', ada.cookie)).status, 404);
  const routes = (await import('../../src/types/protocol.ts')).HTTP_ROUTE_KEYS.filter((key) => key.includes(' /api/admin/'));
  assert.ok(routes.includes('GET /api/admin/history') && routes.includes('POST /api/admin/players/bulk'));
  let n = 0;
  for (const key of routes) {
    const [method, path] = key.split(' ') as [string, string];
    const response = await host(path.replace(':id', ada.id), ada.cookie, method === 'POST' ? { clientId: a.f.id(), action: 'credit', amount: 1, reason: 'test', ids: [ada.id] } : undefined);
    assert.equal(response.status, 404, `${key} on the admin address`); assert.deepEqual(JSON.parse(response.text), { error: 'not_found' });
    if (++n % 8 === 0) a.f.advance(11 * 60000);
  }
});

test('the admin address counts every address on its own: a flood there never spends the game\'s allowance', async (t) => {
  const dist = await site(t);
  const a = await admins(t, { distDir: dist });
  const junk = { idToken: 'not.a.token' };
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await call(a.f.base, ADMIN, '/api/account/sign-in', { method: 'POST', body: junk, headers: { origin: `http://${ADMIN}` } })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401)); assert.deepEqual(statuses.slice(10), [429, 429]);
  const game = await call(a.f.base, new URL(a.f.base).host, '/api/account/sign-in', { method: 'POST', body: junk, headers: { origin: a.f.base } });
  assert.equal(game.status, 401, 'the same address on the game is not limited by what it did on the admin address');
});
