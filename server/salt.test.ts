// The per-life secret salt (server/life-service.ts): random outcomes cannot be predicted or chosen
// by picking an action ID, the salt never leaves the server, it is stored with the life and it
// survives a restart. Protocol-level only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { settleCity, applyLifeAction, useSaltSourceForTests } from './life-service.ts';
import { createLife, dispatch } from '../src/life.ts';
import { registerSystem } from '../src/game/registry.ts';
import { makeRng } from '../src/game/util.ts';
import { EVENTS } from '../src/game/content/events.ts';

const NOW = Date.UTC(2026, 0, 5, 9);
const SALT = /^[0-9a-f]{32}$/;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A test-only action that reports its roll, registered the way a feature system would be.
registerSystem({
  id: 'saltprobe', stateKeys: ['saltprobe'],
  sanitize(input, state) { state.saltprobe = {}; },
  actions: { 'saltprobe.roll'(state, payload, ctx) { state.message = String(ctx.rng()); return { ok: true, code: 'rolled', state }; } },
});

const session = (name = 'Salt Probe') => ({ publicId: randomUUID(), name, cities: {} });
/** What a client can compute for its own action ID with the public rules: the unkeyed generator. */
const clientGuess = (actionId, cityId = 'lagos') => makeRng(`${cityId}|action|${actionId}`)();

test('a life gets its salt on the server when it is first settled; it is stored beside the state, never in it', () => {
  const s = session();
  const state = settleCity(s, 'lagos', NOW);
  const entry = s.cities.lagos;
  assert.match(entry.salt, SALT);
  assert.equal(entry.state, state);
  assert.equal(JSON.stringify(state).includes(entry.salt), false, 'nothing that sends a state can send the salt');
  assert.equal(Object.values(state).some((value) => value === entry.salt), false);
  // It survives every later settlement and a round trip through storage (JSON).
  const salt = entry.salt;
  settleCity(s, 'lagos', NOW + 5000);
  assert.equal(s.cities.lagos.salt, salt);
  const stored = JSON.parse(JSON.stringify(s));
  settleCity(stored, 'lagos', NOW + 9000);
  assert.equal(stored.cities.lagos.salt, salt, 'hydrating the stored session keeps the salt');
  // Each city's life has its own; so does each player.
  settleCity(s, 'ibadan', NOW);
  assert.match(s.cities.ibadan.salt, SALT);
  assert.notEqual(s.cities.ibadan.salt, salt);
  const someoneElse = session(); settleCity(someoneElse, 'lagos', NOW);
  assert.notEqual(someoneElse.cities.lagos.salt, salt);
  // A life stored before salts existed, or with a damaged one, is given a fresh salt at its next settlement.
  for (const broken of [undefined, '', 'short', 42, null, { toString() { return 'x'.repeat(32); } }, 'has spaces in it, not allowed']) {
    const old = { publicId: randomUUID(), name: 'Old', cities: { lagos: { state: createLife({ name: 'Old' }, { now: NOW }), updatedAt: NOW, ...(broken === undefined ? {} : { salt: broken }) } } };
    settleCity(old, 'lagos', NOW + 1000);
    assert.match(old.cities.lagos.salt, SALT, String(broken));
  }
});

test('an action on a stored life rolls dice a client cannot compute from its action ID; a replay rolls the same', () => {
  const s = session();
  const roll = (source, actionId) => {
    const copy = JSON.parse(JSON.stringify(source)); // the same stored life, loaded again
    const state = settleCity(copy, 'lagos', NOW);
    return Number(applyLifeAction(state, { type: 'saltprobe.roll', cityId: 'lagos', actionId }, { now: NOW, cityId: 'lagos', actionId }).state.message);
  };
  settleCity(s, 'lagos', NOW);
  const ids = Array.from({ length: 200 }, (_, i) => `${NOW}:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const actual = ids.map((id) => roll(s, id));
  assert.equal(ids.filter((id, i) => clientGuess(id) === actual[i]).length, 0, 'not one of 200 predictions matches');
  assert.deepEqual(ids.slice(0, 20).map((id) => roll(s, id)), actual.slice(0, 20), 'the same action ID on the same life is deterministic');
  // Another player sending the very same IDs gets different rolls: knowing someone else's outcome helps nobody.
  const other = session(); settleCity(other, 'lagos', NOW);
  assert.equal(ids.slice(0, 20).filter((id, i) => roll(other, id) === actual[i]).length, 0);
  // The worker's call shape — applyLifeAction(state, body) with no context — is keyed too.
  const bare = settleCity(JSON.parse(JSON.stringify(s)), 'lagos', NOW);
  assert.equal(Number(applyLifeAction(bare, { type: 'saltprobe.roll', cityId: 'lagos', actionId: ids[0] }).state.message), actual[0]);
  // A caller cannot bring its own salt or its own generator for a stored life.
  const forced = settleCity(JSON.parse(JSON.stringify(s)), 'lagos', NOW);
  assert.equal(Number(applyLifeAction(forced, { type: 'saltprobe.roll', cityId: 'lagos', actionId: ids[0] }, { now: NOW, cityId: 'lagos', actionId: ids[0], salt: 'attacker-chosen-salt', rng: () => 0.999 }).state.message), actual[0]);
});

test('a roadside skill check cannot be forced by searching action IDs', (t) => {
  t.after(() => useSaltSourceForTests());
  // Fixed salts keep this test reproducible; the attack below knows the rules and the IDs, not the salt.
  let made = 0;
  useSaltSourceForTests(() => `roadside-test-salt-${String(made++).padStart(4, '0')}`);
  const event = EVENTS.toll, choice = event.choices.find((item) => item.check);
  const pending = () => {
    const s = session();
    const state = settleCity(s, 'lagos', NOW);
    state.travel.event = { id: event.id, at: NOW }; // a roadside choice is waiting (set directly: this test is about the roll)
    return { s, state };
  };
  // The attack: with the public rules, find action IDs whose check succeeds on a copy of the life.
  const { state: sample } = pending();
  const winners = [];
  for (let i = 0; winners.length < 40 && i < 5000; i++) {
    const actionId = `${NOW}:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const copy = createLife(structuredClone(sample), { now: NOW, cityId: 'lagos' });
    let success = null;
    const off = dispatch(copy, { type: 'world.roadside', payload: { choice: choice.id }, actionId }, { now: NOW, cityId: 'lagos', actionId });
    assert.equal(off.code, 'resolved');
    success = copy.message === choice.check.success.result;
    if (success) winners.push(actionId);
  }
  assert.equal(winners.length, 40, 'the client-side search finds IDs it expects to win with');
  // Sent to the server, each on a fresh life in the same position, those IDs win only as often as chance allows.
  let won = 0;
  for (const actionId of winners) {
    const { state } = pending();
    const result = applyLifeAction(state, { type: 'world.roadside', cityId: 'lagos', actionId, payload: { choice: choice.id } }, { now: NOW, cityId: 'lagos', actionId });
    assert.equal(result.code, 'resolved');
    if (state.message === choice.check.success.result) won += 1;
  }
  assert.ok(won < 40, `${won} of 40 hand-picked IDs succeeded`);
  assert.ok(won > 2 && won < 34, `${won} of 40 is in line with the check's own odds (${choice.check.base}), not with the search`);
});

test('over HTTP: no response carries the salt, the roll is not the predicted one, and the salt survives a restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-salt-'));
  let time = NOW, server;
  const boot = async () => { server = await createServer({ dataDir: dir, now: () => time, distDir: join(dir, 'no-dist') }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  const halt = async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); };
  t.after(async () => { if (server?.listening) await halt(); await rm(dir, { recursive: true, force: true }); });
  let base = await boot();
  const call = async (path, body, cookie) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], text: await response.text() };
  };
  const opened = await call('/api/session', { name: 'Salt Probe' });
  const cookie = opened.cookie;
  const seen = [opened.text, (await call('/api/life?city=lagos', null, cookie)).text];
  const saltOf = () => server.store.read((db) => Object.values(db.sessions)[0].cities.lagos.salt);
  const salt = await saltOf();
  assert.match(salt, SALT);
  let matches = 0;
  const first = [];
  for (let i = 0; i < 25; i++) {
    const actionId = `${time}:${randomUUID()}`;
    const response = await call('/api/action', { actionId, cityId: 'lagos', type: 'saltprobe.roll' }, cookie);
    assert.equal(response.status, 200);
    seen.push(response.text);
    const rolled = Number(JSON.parse(response.text).state.message);
    if (rolled === clientGuess(actionId)) matches += 1;
    first.push([actionId, rolled]);
  }
  assert.equal(matches, 0, 'the client-computed roll never matches what the server rolled');
  seen.push((await call('/api/session', null, cookie)).text, (await call('/api/support/statement?city=lagos', null, cookie)).text);
  for (const text of seen) assert.equal(text.includes(salt), false, 'the salt is in no response');
  // On disk it sits beside the life, in the same file that holds the session secret.
  await server.store.flush();
  const stored = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8'));
  const record = Object.values(stored.sessions)[0];
  assert.equal(record.cities.lagos.salt, salt);
  assert.equal(JSON.stringify(record.cities.lagos.state).includes(salt), false);
  // A restart reads the same salt back; the life is not re-keyed.
  await halt();
  base = await boot();
  time += 5000;
  assert.equal((await call('/api/life?city=lagos', null, cookie)).status, 200);
  assert.equal(await saltOf(), salt);
  // A replayed action ID is answered from its receipt after the restart: one outcome per ID, for good.
  const replay = JSON.parse((await call('/api/action', { actionId: first[0][0], cityId: 'lagos', type: 'saltprobe.roll' }, cookie)).text);
  assert.deepEqual([replay.duplicate, replay.ok, replay.code], [true, true, 'rolled']);
});

test('the salt source can be replaced only by code running inside the server process, never for an existing life, never in production', async (t) => {
  t.after(() => useSaltSourceForTests());
  const existing = session(); settleCity(existing, 'lagos', NOW);
  const before = existing.cities.lagos.salt;
  useSaltSourceForTests(() => 'fixed-test-salt-0001');
  settleCity(existing, 'lagos', NOW + 1000);
  assert.equal(existing.cities.lagos.salt, before, 'a life that has a salt keeps it');
  const made = session(); settleCity(made, 'lagos', NOW);
  assert.equal(made.cities.lagos.salt, 'fixed-test-salt-0001');
  // A source that returns something unusable is an error, not a weak salt.
  for (const bad of [() => '', () => 'short', () => 7, () => 'has spaces in it, not allowed']) {
    useSaltSourceForTests(bad);
    assert.throws(() => settleCity(session(), 'lagos', NOW), /Invalid life salt/);
  }
  useSaltSourceForTests();
  const random = session(); settleCity(random, 'lagos', NOW);
  assert.match(random.cities.lagos.salt, SALT);
  // Refused outright where NODE_ENV says production.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.throws(() => useSaltSourceForTests(() => 'fixed-test-salt-0001'), /not available in production/); }
  finally { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; }
  // And no file that runs in production mentions it: only the module that defines it (tests and scripts/ are not production).
  const offenders = [];
  async function scan(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { if (!['node_modules', 'tooling', '.wrangler'].includes(entry.name)) await scan(path); continue; }
      if (!/\.(js|mjs)$/.test(entry.name) || /\.test\.(js|mjs)$/.test(entry.name) || path === 'server/life-service.ts') continue;
      if ((await readFile(join(root, path), 'utf8')).includes('useSaltSourceForTests')) offenders.push(path);
    }
  }
  for (const directory of ['server', 'src', 'deploy']) await scan(directory);
  assert.deepEqual(offenders, []);
});

test('a fixture device plays with a salted life: the server-side roll differs from the engine run on the returned state', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  const actionId = `${f.now()}:${randomUUID()}`;
  const before = await (await f.request('/api/life?city=lagos', null, ada.cookie)).json();
  // Everything the client holds: the state it was sent and the action it is about to send.
  const local = createLife(before.state, { now: f.now(), cityId: 'lagos' });
  const predicted = Number(dispatch(local, { type: 'saltprobe.roll', actionId }, { now: f.now(), cityId: 'lagos', actionId }).state.message);
  const actual = Number((await (await f.request('/api/action', { actionId, cityId: 'lagos', type: 'saltprobe.roll' }, ada.cookie)).json()).state.message);
  assert.notEqual(actual, predicted);
});
