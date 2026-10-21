// Open dev mode (server/open-dev): each convenience works with the setting on, the setting is refused wherever it must never apply,
// and with the setting absent nothing changes. The Worker host is checked at the end (it never imports the open-mode code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { createServer } from './server.ts';
import { openClock } from './open-dev/clock.ts';
import { OPEN_DEV_MARKER, isLoopbackHost, isLoopbackOrigin } from './open-dev/config.ts';
import { PANEL_PATH } from './open-dev/panel.ts';
import { openDevRefusal } from '../deploy/open-dev-refusal.ts';
import { postBlock } from '../src/game/trust/index.ts';
import { linksFrom } from '../src/game/cities/registry.ts';
import { DEFAULT_LOOK } from '../src/game/content/traits.ts';

const T0 = 1_800_000_000_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type Json = Record<string, any>; // eslint-disable-line -- test responses are read field by field

async function boot(t: TestContext, { env, extra = {} }: { env: Record<string, unknown>; extra?: Record<string, unknown> }) {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-open-dev-'));
  let elapsed = 0;
  const server = await createServer({ dataDir: dir, now: () => T0 + elapsed, env, log: () => {}, ...extra });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(dir, { recursive: true, force: true }); });
  async function call(path: string, body?: unknown, cookie = '', method = body === undefined ? 'GET' : 'POST'): Promise<{ status: number; json: Json; cookie: string }> {
    const response = await fetch(base + path, { method, headers: { Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const set = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Json, cookie: set };
  }
  /** A request that names another Host (the admin address), which fetch will not send. */
  const asHost = (host: string, path: string, cookie = ''): Promise<{ status: number; text: string; cookie: string }> => new Promise((resolveRequest, fail) => {
    const request = http.request(base + path, { headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, (response) => {
      let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolveRequest({ status: response.statusCode ?? 0, text, cookie: String(response.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '' }));
    });
    request.on('error', fail); request.end();
  });
  /** A new visitor who pressed Play now. */
  async function player(name: string, city = 'lagos'): Promise<{ cookie: string; life: () => Promise<Json> }> {
    const session = await call('/api/session', { name, onboarding: true });
    const cookie = session.cookie;
    return { cookie, life: async () => (await call(`/api/life?city=${city}`, undefined, cookie)).json.state as Json };
  }
  const act = async (cookie: string, type: string, payload: Json, city = 'lagos'): Promise<Json> => (await call('/api/action', { type, payload, cityId: city, actionId: `${T0 + elapsed}:${crypto.randomUUID()}` }, cookie)).json;
  return { call, asHost, player, act, base, dir, advance: (ms: number) => { elapsed += ms; } };
}
const OPEN = { ALLWORLD_OPEN_DEV: '1' };

test('open mode: a new life from Play now is settled with a home, starts rich with unrestricted money, and can travel at once', async (t) => {
  const f = await boot(t, { env: OPEN });
  const ada = await f.player('Ada');
  const life = await ada.life();
  assert.equal(life.onboarding.stage, 'settled');
  assert.equal(life.onboarding.done, true);
  assert.equal(life.cash, 50_000_000);
  assert.ok(life.social.free >= 49_000_000, 'the money can be gifted and spent at stalls: it is not restricted');
  const link = linksFrom('lagos')[0]!;
  const departed = await f.act(ada.cookie, 'estate.relocate', { to: link.to, mode: link.mode });
  assert.equal(departed.ok, true, 'no "Settle in first"');
  assert.notEqual(departed.code, 'settle_required');
});

test('open mode: the starting cash is a setting', async (t) => {
  const f = await boot(t, { env: { ...OPEN, ALLWORLD_OPEN_DEV_CASH: '12345678' } });
  assert.equal((await (await f.player('Bola')).life()).cash, 12_345_678);
});

test('open mode: waits run faster: a flight arrives in a tenth of the time, and a shift and its four-hour break too', async (t) => {
  const fast = await boot(t, { env: OPEN }), real = await boot(t, { env: { ...OPEN, ALLWORLD_OPEN_DEV_SPEED: '1' } });
  const link = linksFrom('lagos')[0]!, after = Math.ceil(link.seconds * 1000 / 10) + 2000;
  for (const [f, arrives] of [[fast, true], [real, false]] as const) {
    const who = await f.player('Chidi');
    assert.equal((await f.act(who.cookie, 'estate.relocate', { to: link.to, mode: link.mode })).ok, true);
    f.advance(after);
    const origin = await f.call('/api/life?city=lagos', undefined, who.cookie);
    let life = origin.json.state as Json | undefined;
    if (!life) {
      assert.deepEqual([origin.status, origin.json.error], [409, 'city_moved']);
      const destination = await f.call(`/api/life?city=${link.to}`, undefined, who.cookie);
      assert.equal(destination.status, 200);
      assert.ok(destination.json.state);
      life = destination.json.state as Json;
    } else {
      assert.equal(origin.status, 200);
    }
    assert.equal(life.activeAction === null || life.activeAction === undefined, arrives, arrives ? 'arrived' : 'still on the way at real speed');
  }
  const worker = await fast.player('Dayo');
  assert.equal((await fast.act(worker.cookie, 'apply-job', { id: 'community-helper' })).ok, true);
  await fast.act(worker.cookie, 'spot', { id: 'work' });
  assert.equal((await fast.act(worker.cookie, 'activity', { id: 'helper-shift' })).ok, true);
  fast.advance(3000); // 20-second shift: done after 30 seconds of game time
  const done = await worker.life();
  assert.equal(done.activeAction ?? null, null);
  assert.equal(done.completedShifts, 1);
  fast.advance(1_500_000); // the four-hour break is under 25 minutes at ten times
  assert.equal((await fast.act(worker.cookie, 'activity', { id: 'helper-shift' })).ok, true, 'the break is over');
});

test('the clock is monotonic across a restart and never slower than the real one', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-open-clock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let base = T0;
  const file = join(dir, 'clock.json');
  const first = openClock({ base: () => base, speed: 10, file });
  base += 60_000;
  assert.equal(first.now(), T0 + 600_000);
  first.stop();
  const second = openClock({ base: () => base, speed: 10, file });
  assert.equal(second.now(), T0 + 600_000, 'carries on from where it stopped');
  base += 1000;
  assert.equal(second.now(), T0 + 610_000);
  second.stop();
  assert.equal(openClock({ base: () => base, speed: 1, file: null }).now(), base, 'speed 1 is the real clock');
});

test('open mode: the caps that only exist to stop abuse are raised (and are not in normal mode)', async (t) => {
  const open = await boot(t, { env: OPEN }), normal = await boot(t, { env: {} });
  for (const [f, limited] of [[open, false], [normal, true]] as const) {
    const who = await f.player('Ada');
    await who.life();
    const answers: number[] = [];
    for (let i = 0; i < 30; i++) answers.push((await f.call('/api/world/pulse', undefined, who.cookie)).status);
    assert.equal(answers.includes(429), limited, limited ? 'the normal 20 a minute stands' : 'thirty in a minute are fine');
  }
  // Sessions: no 24-hour wait applies to anything open mode set up (see the trust test), and a crowd of new sessions from one address is fine.
  for (let i = 0; i < 40; i++) assert.equal((await open.call('/api/session', { name: `Sim${i}`, onboarding: true })).status, 200);
});

test('open mode: the visitor becomes the local operator (admin tools) without any outside sign-in, on the game and admin addresses', async (t) => {
  const f = await boot(t, { env: OPEN });
  const ada = await f.player('Ada');
  await ada.life();
  assert.equal((await f.call('/api/admin/me', undefined, ada.cookie)).status, 404, 'a visitor is not an admin until they ask');
  const operator = await f.call('/api/account/open-dev/operator', {}, ada.cookie);
  assert.equal(operator.status, 200);
  assert.equal(operator.json.operator, true);
  assert.equal(operator.json.name, 'Ada', 'the visitor keeps their own life');
  assert.ok(operator.cookie);
  const me = await f.call('/api/admin/me', undefined, operator.cookie);
  assert.equal(me.status, 200);
  assert.equal((await f.call('/api/account/open-dev', undefined, operator.cookie)).json.operator, true);
  // The admin address is a separate origin with its own cookie: opening the operator link there signs it in, with a character of its own.
  const link = await f.asHost('admin.localhost', '/api/account/open-dev/operator');
  assert.equal(link.status, 200);
  assert.equal((await f.asHost('admin.localhost', '/api/admin/me', link.cookie)).status, 200);
  assert.equal((await f.call('/api/account/open-dev', undefined, operator.cookie)).json.operator, true, 'the game browser stays signed in');
  // A request from another site's page (no Origin) cannot change anything but the sign-in link.
  const response = await fetch(f.base + '/api/account/open-dev/fund', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ada.cookie }, body: '{}' });
  assert.equal(response.status, 403);
});

test('open mode: money tops up by name and by amount; trust is set in one step and the new-account wait is behind it', async (t) => {
  const f = await boot(t, { env: OPEN });
  const ada = await f.player('Ada');
  const before = await ada.life();
  assert.equal((await f.call('/api/account/open-dev/fund', { amount: 1000 }, ada.cookie)).json.ok, true);
  assert.equal((await ada.life()).cash, before.cash + 1000);
  assert.equal((await f.call('/api/account/open-dev/fund', { name: 'Ada' })).json.ok, true, 'by name, as the command does');
  assert.equal((await f.call('/api/account/open-dev/fund', { name: 'Nobody' })).status, 404);
  assert.equal((await f.call('/api/account/open-dev/fund', { amount: -5 }, ada.cookie)).status, 400);
  const guest = (await f.call('/api/trust/me', undefined, ada.cookie)).json;
  assert.equal(guest.tier, 'guest');
  assert.equal(guest.can.stall.code, 'account_required');
  const set = await f.call('/api/account/open-dev/trust', {}, ada.cookie);
  assert.equal(set.json.tier, 'phone');
  const trusted = (await f.call('/api/trust/me', undefined, set.cookie || ada.cookie)).json;
  assert.equal(trusted.tier, 'phone');
  assert.equal(trusted.adult, true);
  assert.equal(trusted.can.stall, null, 'a stall can be opened: no tier, age or new-account wait stops it');
  assert.equal((await f.call('/api/account/open-dev/trust', { tier: 'gold' }, ada.cookie)).status, 400);
});

test('open mode: seeded players live in several cities and are friends of the visitor', async (t) => {
  const f = await boot(t, { env: OPEN });
  const ada = await f.player('Ada');
  const seeded = await f.call('/api/account/open-dev/seed', {}, ada.cookie);
  assert.equal(seeded.json.players.length, 4);
  assert.ok(new Set(seeded.json.players.map((row: Json) => row.city)).size >= 2, 'residents in more than one city');
  assert.equal(seeded.json.friendships, 4);
  const social = (await f.call('/api/social/me', undefined, ada.cookie)).json;
  const names = (social.friends as Json[]).map((friend) => friend.name);
  for (const name of ['Dev Ada', 'Dev Tunde', 'Dev Ngozi', 'Dev Musa']) assert.ok(names.includes(name), name);
  const again = await f.call('/api/account/open-dev/seed', {}, ada.cookie);
  assert.deepEqual(again.json.players.map((row: Json) => row.created), [false, false, false, false], 'seeding twice makes nobody twice');
  assert.equal((await f.call('/api/account/open-dev/fund', { name: 'Dev Ada' })).json.ok, true);
});

test('open mode: every page carries the marker, the health route says so, optional local features are on, outside requests are refused', async (t) => {
  const f = await boot(t, { env: { ...OPEN, ZEPTOMAIL_AUTH: 'must-not-be-read', COMPANION_API_KEY: 'x' }, extra: { distDir: join(root, 'server') } });
  assert.equal((await f.call('/api/health')).json.openDev, true);
  const script = await fetch(f.base + PANEL_PATH);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /Open dev mode/);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  const wrongHost = await f.asHost('evil.example', '/api/health');
  assert.equal(wrongHost.status, 421, 'a page on another site cannot reach the server by rebinding a name');
  const ada = await f.player('Ada');
  assert.equal((await ada.life()).onboarding.done, true);
  assert.equal(((await f.call('/api/health')).json.companionAi), false, 'what needs an outside key stays off');
});

test('refusal: the setting with a non-loopback bind, public origin, proxy, bad value or bad number never starts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-open-refuse-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const refused = (options: Record<string, unknown>, pattern: RegExp) => assert.rejects(createServer({ dataDir: dir, log: () => {}, ...options }), (error: Error) => error.name === 'OpenDevRefusal' && pattern.test(error.message));
  await refused({ env: OPEN, publicOrigin: 'https://joinallworld.com' }, /localhost address/);
  await refused({ env: OPEN, publicOrigin: 'https://play.example.test:8443' }, /localhost address/);
  await refused({ env: OPEN, trustProxy: true }, /reverse proxy/);
  for (const value of ['0', '', 'true', 'yes']) await refused({ env: { ALLWORLD_OPEN_DEV: value } }, /something other than 1/);
  await refused({ env: { ...OPEN, ALLWORLD_OPEN_DEV_SPEED: '0' } }, /ALLWORLD_OPEN_DEV_SPEED/);
  await refused({ env: { ...OPEN, ALLWORLD_OPEN_DEV_CASH: 'lots' } }, /ALLWORLD_OPEN_DEV_CASH/);
  // A loopback origin is fine, and the bind is checked where the server listens.
  const server = await createServer({ dataDir: dir, log: () => {}, env: OPEN, publicOrigin: 'http://localhost:5173', now: () => T0 });
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  for (const host of ['0.0.0.0', '::', '192.168.1.20', 'example.com']) assert.throws(() => server.listen(0, host), /OpenDevRefusal|not bound to a loopback/, host);
  assert.throws(() => server.listen(0), /not bound to a loopback/, 'no address means every address');
  assert.throws(() => server.listen({ port: 0, host: '10.0.0.5' }), /not bound to a loopback/);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

async function freePort(): Promise<string> {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise((done) => probe.close(done));
  return String(port);
}

test('refusal: the started server process exits with one clear line for a wrong bind or origin, and runs on loopback otherwise', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-open-spawn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await freePort();
  const run = async (env: Record<string, string>, { wait = false }: { wait?: boolean } = {}) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', join(root, 'server/server.ts')], { cwd: root, env: { PATH: process.env.PATH ?? '', DATA_DIR: dir, PORT: port, ...env } });
    // Listen for the exit before anything else: a child that stops early has already sent it.
    const exited = once(child, 'exit') as Promise<[number | null]>;
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    if (wait) { for (let i = 0; i < 300 && !/listening on/.test(output) && child.exitCode === null; i++) await new Promise((done) => setTimeout(done, 100)); child.kill('SIGTERM'); }
    const stuck = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const [code] = await exited;
    clearTimeout(stuck);
    return { code, output };
  };
  const bind = await run({ ALLWORLD_OPEN_DEV: '1', ALLWORLD_OPEN_DEV_BIND: '0.0.0.0' });
  assert.equal(bind.code, 1); assert.match(bind.output, /Open dev mode refused to start: the server is not bound to a loopback address/); assert.doesNotMatch(bind.output, /listening on/);
  const origin = await run({ ALLWORLD_OPEN_DEV: '1', PUBLIC_ORIGIN: 'https://joinallworld.com' });
  assert.equal(origin.code, 1); assert.match(origin.output, /public origin is not a localhost address/);
  const fine = await run({ ALLWORLD_OPEN_DEV: '1' }, { wait: true });
  assert.match(fine.output, /Open dev mode is ON/); assert.match(fine.output, new RegExp(`Allworld server listening on ${port}`));
});

test('normal mode is unchanged: quick start is not settled, cash is the normal start, admin is refused, the waits stand, the open routes do not exist', async (t) => {
  const f = await boot(t, { env: {} });
  const ada = await f.player('Ada');
  const life = await ada.life();
  assert.equal(life.onboarding.stage, 'guest');
  assert.equal(life.onboarding.done, false);
  assert.equal(life.cash, 5000);
  assert.equal(life.onboarding.required, true, 'the look must be confirmed first, as ever');
  assert.equal((await f.act(ada.cookie, 'onboarding.quick-start', { look: DEFAULT_LOOK })).ok, true);
  const link = linksFrom('lagos')[0]!;
  assert.equal((await f.act(ada.cookie, 'estate.relocate', { to: link.to, mode: link.mode })).code, 'settle_required');
  assert.equal((await f.call('/api/admin/me', undefined, ada.cookie)).status, 404);
  for (const [method, path] of [['GET', '/api/account/open-dev'], ['POST', '/api/account/open-dev/operator'], ['POST', '/api/account/open-dev/fund'], ['POST', '/api/account/open-dev/seed']] as const) {
    assert.notEqual((await f.call(path, method === 'POST' ? {} : undefined, ada.cookie)).status, 200, path);
  }
  assert.equal((await f.call('/api/health')).json.openDev, undefined);
  assert.equal((await fetch(f.base + PANEL_PATH)).headers.get('content-type')?.includes('javascript'), false);
  const fresh = (await f.call('/api/trust/me', undefined, ada.cookie)).json;
  assert.equal(fresh.can.stall.code, 'account_required');
  // The 24-hour new-account wait is the rule itself, untouched.
  const refusal = postBlock('stall', { tier: 'phone', adult: true, held: false, now: T0, accountAt: T0 });
  assert.equal(refusal?.code, 'account_too_new');
});

test('normal mode loads none of the open-mode modules', async () => {
  const text = readFileSync(join(root, 'server/server.ts'), 'utf8');
  const statics = [...text.matchAll(/^import .*from '(.+)'/gm)].map((match) => match[1]);
  assert.ok(!statics.some((path) => /open-dev/.test(path ?? '')), 'server.ts reaches open-mode code only through a guarded dynamic import');
  assert.match(text, /env\?\.\['ALLWORLD_OPEN_DEV'\] !== undefined\s*\n?\s*\? \(await import\('\.\/open-dev\/index\.ts'\)\)/);
});

// ---- the Worker host ----------------------------------------------------------------------------------------------------

/** Every file the Worker entry reaches through relative imports (static and dynamic). */
function graphOf(entry: string): Set<string> {
  const seen = new Set<string>(), queue = [resolve(root, entry)];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(resolve(dirname(file), match[1] ?? ''));
  }
  return seen;
}

test('the Worker host: its import graph holds no open-mode code and not the Node host, and it refuses the setting instead of honouring it', async () => {
  const graph = [...graphOf('deploy/cloudflare-worker.ts')].map((file) => file.slice(root.length + 1));
  assert.ok(graph.length > 20, 'the walk found the Worker modules');
  assert.deepEqual(graph.filter((file) => /server\/open-dev\/|scripts\/open-dev/.test(file) || file === 'server/server.ts'), []);
  for (const file of graph) {
    let text = '';
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }
    assert.ok(!text.includes(OPEN_DEV_MARKER), `${file} must not carry the open-mode marker`);
    assert.ok(!/startOpenDev|OpenDevRefusal|open-dev\/index/.test(text), `${file} must not name open-mode code`);
  }
  // The refusal itself: any value, even empty, is refused with a 503; an environment without it is untouched.
  for (const value of ['1', '0', '']) assert.equal(openDevRefusal({ ALLWORLD_OPEN_DEV: value })?.status, 503);
  assert.equal(openDevRefusal({}), null);
  assert.equal(openDevRefusal({ ALLWORLD_OPEN_DEV: undefined }), null);
  assert.match(await openDevRefusal({ ALLWORLD_OPEN_DEV: '1' })!.text(), /never honoured here/);
  // The Worker calls it first thing, before it touches anything else.
  const worker = readFileSync(join(root, 'deploy/cloudflare-worker.ts'), 'utf8');
  assert.match(worker, /async fetch\(request: Request, env: WorkerEnv(?:, ctx\?: \{ waitUntil\(work: Promise<unknown>\): void \})?\): Promise<Response> \{\s*\/\/[^\n]*\n\s*const misconfigured = openDevRefusal\(env\);\s*if \(misconfigured\) return misconfigured;/);
  const local = readFileSync(join(root, 'deploy/local.ts'), 'utf8');
  assert.match(local, /ALLWORLD_OPEN_DEV !== undefined\) \{ console\.error\([^\n]*process\.exit\(1\)/);
  assert.ok(!/ALLWORLD_OPEN_DEV/.test(local.split('\n').filter((line) => /bindings\[/.test(line)).join('\n')), 'the setting is never passed on to the Worker');
});

test('loopback checks', () => {
  for (const host of ['127.0.0.1', '127.0.0.1:5173', 'localhost', 'localhost:3001', 'admin.localhost:5173', '[::1]:5173', '::1', '127.1.2.3']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['0.0.0.0', '::', '192.168.0.4', 'example.com', 'localhost.example.com', '127.0.0.1.evil.test', '', undefined, '10.0.0.1:80']) assert.equal(isLoopbackHost(host), false, String(host));
  assert.equal(isLoopbackOrigin('http://localhost:5173'), true);
  assert.equal(isLoopbackOrigin('https://joinallworld.com'), false);
  assert.equal(isLoopbackOrigin('ftp://localhost'), false);
});
