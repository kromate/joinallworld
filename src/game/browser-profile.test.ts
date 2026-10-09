// The browser's engine (campus stand-ins, nothing that only playing needs: profile.ts) must rebuild and view every life exactly as the
// full engine does after the actual lazy Boutique composition completes its catalogue. A child process runs it on lives the full engine played, with two module hooks that do what vite.config.ts does to the
// browser build: the systems come from systems/browser.ts (campus stand-ins), and profile.ts says PLAYS = false.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { advanceLife, createLife, dispatch, viewLife } from '../life.ts';
import { makeContext } from './util.ts';
import { lagosTime } from './clock.ts';
import { CAMPUS_SLICES, isFreshSlice, needsCampusRules } from '../campus/unilag/slices.ts';
import { DEFAULT_LOOK } from './content/traits.ts';
import { loadCityContent, registerCityForTest } from './cities/registry.ts';
import { FICTIONAL_CITY_ID, FICTIONAL_NEIGHBOUR_CITY_ID, fictionalCity, fictionalNeighbourCity } from './cities/testing/fictionalCity.test-fixture.ts';
import type { ActionBody } from '../types/actions.ts';
import type { LifeContextInit, LifeState } from '../types/life.ts';

const HOOKS = `
import { existsSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
let failedTeachingImport = false;
let teachingResolveCount = 0;
async function teachingBarrier(url) {
  const target = process.env.TEACHING_GATE_BARRIER;
  if (!target || !/\\/living-world\\/teaching-state\\.ts(?:$|\\?)/.test(url) || existsSync(target)) return;
  await new Promise((resolve, reject) => {
    let watcher;
    const finish = (error) => { clearTimeout(timer); watcher?.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('teaching gate barrier timed out')), 20000);
    watcher = watch(dirname(target), (_event, name) => {
      if (name?.toString() === basename(target) && existsSync(target)) finish();
    });
    if (existsSync(target)) finish();
  });
}
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('living-world/teaching-state.ts') && context.parentURL?.endsWith('/src/game/teaching-gate.ts')) {
    teachingResolveCount++;
    const requestMarker = process.env.TEACHING_GATE_REQUEST_MARKER;
    if (requestMarker) writeFileSync(requestMarker, String(teachingResolveCount));
    if (process.env.TEACHING_GATE_FAIL_FIRST === '1' && !failedTeachingImport) {
      failedTeachingImport = true;
      const marker = process.env.TEACHING_GATE_FAIL_MARKER;
      if (marker) writeFileSync(marker, 'failed once');
      throw new Error('injected first teaching-state resolution failure');
    }
    await teachingBarrier(specifier);
  }
  const resolved = await next(specifier, context);
  return /\\/src\\/game\\/systems\\/index\\.ts$/.test(resolved.url) ? { ...resolved, url: resolved.url.replace(/index\\.ts$/, 'browser.ts'), shortCircuit: true } : resolved;
}
export async function load(url, context, next) {
  if (/\\/src\\/game\\/profile\\.ts$/.test(url)) return { format: 'module', source: 'export const PLAYS = false;\\nexport const LEFT_OUT = {};\\n', shortCircuit: true };
  return next(url, context);
}`;
const REGISTER = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(HOOKS)}));`;

/** Rebuilds and views the lives of the file named in argv[1] with the engine this process loads; prints what it saw. */
const url = (path: string): string => pathToFileURL(new URL(path, import.meta.url).pathname).href;
const PROBE = `
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createLife, dispatch, viewLife } from '${url('../life.ts')}';
import { campusFor, loadCampus } from '${url('./campus-gate.ts')}';
import { isStandIn } from '${url('./registry.ts')}';
// The page fetches the rules of the city's conditions when it is idle (src/app/state/idlePreload.ts); until then it shows an open road and the light on.
await import('${url('./conditions/pack.ts')}');
// The fictional cities of the city contract: lives in them must read the same in the browser engine (the city's content comes through the registry).
const { loadCityContent, registerCityForTest } = await import('${url('./cities/registry.ts')}');
const fixtures = await import('${url('./cities/testing/fictionalCity.test-fixture.ts')}');
registerCityForTest(fixtures.fictionalCity); registerCityForTest(fixtures.fictionalNeighbourCity);
await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan'), loadCityContent(fixtures.FICTIONAL_CITY_ID), loadCityContent(fixtures.FICTIONAL_NEIGHBOUR_CITY_ID)]);
const input = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const response = (status, body) => ({ ok: status < 300, status, json: async () => body });
const waitForFile = (target) => new Promise((resolve, reject) => {
  if (existsSync(target)) return resolve();
  let watcher;
  const finish = (error) => { clearTimeout(timer); watcher?.close(); error ? reject(error) : resolve(); };
  const timer = setTimeout(() => finish(new Error('probe marker timed out')), 20000);
  watcher = watch(dirname(target), (_event, name) => { if (name?.toString() === basename(target) && existsSync(target)) finish(); });
  if (existsSync(target)) finish();
});
if (input.mode === 'teaching-cache' || input.mode === 'teaching-newer' || input.mode === 'teaching-retry-connect' || input.mode === 'teaching-switch') {
  const gate = await import('${url('./teaching-gate.ts')}');
  const { createClient } = await import('${url('../client.ts')}');
  let playing = true;
  try { dispatch(createLife(null), { type: 'cancel' }); } catch { playing = false; }
  assert.equal(playing, false, 'this probe executes the browser PLAYS=false branch');
  const startCity = 'lagos';
  const cachedState = input.mode === 'teaching-switch' ? input.plainLagos : input.snapshot;
  const stored = new Map([['joinallworld-life-v1', JSON.stringify({ version: 1, state: cachedState, identity: { name: 'Ada' }, cityId: startCity, ownerId: 'public-1' })]]);
  let markedChanges = 0, lifeRequests = 0;
  const fetchLife = async (path) => {
    if (path === '/api/session') return response(200, { session: { id: 'public-1', name: 'Ada', cities: ['lagos', 'ibadan'] }, serverTime: input.now });
    if (path === '/api/life?city=' + startCity) {
      lifeRequests++;
      const state = input.mode === 'teaching-newer' ? input.plain : input.mode === 'teaching-switch' ? input.plainLagos : input.snapshot;
      return response(200, { state, rev: lifeRequests + 2, serverTime: input.now });
    }
    if (input.mode === 'teaching-switch' && path === '/api/life?city=ibadan') return response(200, { state: input.switchSnapshot, rev: 7, serverTime: input.now });
    throw new Error('unexpected request ' + path);
  };
  const client = createClient({ fetch: fetchLife, now: () => input.now, setTimeout: () => 0, clearTimeout: () => {},
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    onChange: (next) => { if (next.activeAction?.teaching) markedChanges++; },
  });
  if (input.mode === 'teaching-cache') {
    assert.equal(client.state.activeAction, null, 'the marked cache waits for its strict parser');
    const waiting = gate.teachingFor(input.snapshot);
    assert.ok(waiting instanceof Promise);
    await waitForFile(input.requestMarker);
    assert.equal(readFileSync(input.requestMarker, 'utf8'), '1');
    assert.equal(gate.readTeachingSnapshot(input.snapshot.activeAction.teaching), null, 'the strict reader is not installed while the gate import is pending');
    writeFileSync(input.release, 'release');
    await waiting;
    assert.deepEqual(gate.readTeachingSnapshot(input.snapshot.activeAction.teaching), input.snapshot.activeAction.teaching);
    await Promise.resolve();
    const restored = client.state;
    assert.deepEqual(restored.activeAction, input.snapshot.activeAction);
    assert.equal(restored.career.teachingGeneration, input.snapshot.career.teachingGeneration);
    assert.equal(restored.cash, input.snapshot.cash, 'read-only restoration does not change saved money');
    const restoredTeaching = viewLife(restored, { now: restored.t, cityId: 'lagos' }).career.teaching;
    assert.ok(restoredTeaching);
    assert.deepEqual(restoredTeaching.practice, input.snapshot.activeAction.teaching);
    assert.equal(markedChanges, 1, 'the cached marked snapshot is restored once');
    const future = structuredClone(input.snapshot); future.activeAction.teaching.version = 2;
    const corrupt = structuredClone(input.snapshot); corrupt.activeAction.teaching.stage = 'invented';
    const partial = structuredClone(input.snapshot); delete partial.activeAction.teaching;
    for (const hostile of [future, corrupt, partial]) assert.equal(createLife(hostile).activeAction, null, 'future, corrupt, and generation-only markers fail closed');
    client.stop(); process.stdout.write('teaching-cache-ok\\n'); process.exit(0);
  }
  if (input.mode === 'teaching-newer') {
    const connected = await client.connect();
    assert.equal(connected, true, 'the newer plain server snapshot is accepted while the cache parser is pending');
    assert.equal(client.state.cash, input.plain.cash);
    assert.equal(client.state.activeAction, null);
    const waiting = gate.teachingFor(input.snapshot);
    assert.ok(waiting instanceof Promise);
    await waitForFile(input.requestMarker);
    assert.equal(readFileSync(input.requestMarker, 'utf8'), '1');
    assert.equal(gate.readTeachingSnapshot(input.snapshot.activeAction.teaching), null);
    writeFileSync(input.release, 'release');
    await waiting; await Promise.resolve();
    assert.equal(client.state.cash, input.plain.cash);
    assert.equal(client.state.activeAction, null, 'late cached practice cannot overwrite an accepted server snapshot');
    assert.equal(markedChanges, 0);
    client.stop(); process.stdout.write('teaching-newer-ok\\n'); process.exit(0);
  }
  if (input.mode === 'teaching-switch') {
    assert.equal(await client.connect(), true);
    assert.equal(client.state.activeAction, null);
    const switching = client.switchCity('ibadan');
    await waitForFile(input.requestMarker);
    assert.equal(readFileSync(input.requestMarker, 'utf8'), '1');
    assert.equal(gate.readTeachingSnapshot(input.switchSnapshot.activeAction.teaching), null, 'switchCity waits while the parser is unavailable');
    assert.equal(client.cityId, 'ibadan');
    assert.equal(client.state.activeAction, null, 'the marked response is not exposed before validation');
    writeFileSync(input.release, 'release');
    const switched = await switching;
    assert.equal(switched.ok, true, 'switchCity accepts the marked same-owner server response');
    assert.deepEqual(client.state.activeAction.teaching, input.switchSnapshot.activeAction.teaching);
    assert.equal(client.state.cash, input.switchSnapshot.cash);
    client.stop(); process.stdout.write('teaching-switch-ok\\n'); process.exit(0);
  }
  const failed = gate.teachingFor(input.snapshot);
  assert.ok(failed instanceof Promise);
  await assert.rejects(failed, /injected first teaching-state resolution failure/);
  assert.equal(existsSync(input.failureMarker), true, 'the first lazy parser resolution was deliberately rejected');
  assert.equal(readFileSync(input.requestMarker, 'utf8'), '1');
  const connected = await client.connect();
  assert.equal(connected, true, 'connect retries the failed lazy parser for the same-owner server snapshot');
  assert.equal(readFileSync(input.requestMarker, 'utf8'), '2', 'the gate made a second resolve request after the first rejection');
  assert.deepEqual(client.state.activeAction.teaching, input.snapshot.activeAction.teaching);
  assert.equal(client.state.cash, input.snapshot.cash);
  client.stop(); process.stdout.write('teaching-retry-connect-ok\\n'); process.exit(0);
}
if (input.mode === 'client') {
  // The client, given a life that uses the campus (saved on the device, and answered by the server): it fetches the campus rules and keeps all of it.
  const { createClient } = await import('${url('../client.ts')}');
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const wanted = input.lives.find((life) => life.name === 'a student at the campus');
  const stored = new Map([['joinallworld-life-v1', JSON.stringify({ version: 1, state: wanted.raw, identity: { name: 'Ada' }, cityId: 'lagos' })]]);
  const fetchLife = async (path) => (path === '/api/session' ? reply(200, { session: { id: 'public-1', name: 'Ada' }, serverTime: 5000 }) : reply(200, { state: wanted.raw, serverTime: wanted.ctx.now }));
  const client = createClient({ fetch: fetchLife, now: () => wanted.ctx.now, setTimeout: () => 0, clearTimeout: () => {}, randomUUID: () => '11111111-1111-4111-8111-111111111111',
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } });
  const standInAtStart = isStandIn('unilagStudent');
  const before = client.state.unilagStudent.status;
  const connected = await client.connect();
  const { unilagStudent, unilagShuttle, unilagCommunity } = client.state;
  process.stdout.write(JSON.stringify({ client: { standInAtStart, before, connected, standIn: isStandIn('unilagStudent'), status: unilagStudent.status, programme: unilagStudent.programme, rides: unilagShuttle.rides, clubs: unilagCommunity.clubs } }));
  process.exit(0);
}
const results = [];
let playing = true;
try { dispatch(createLife(null), { type: 'cancel' }); } catch { playing = false; }
const { teachingFor } = await import('${url('./teaching-gate.ts')}');
for (const { raw, ctx } of input.lives) {
  let refused = null;
  const waiting = campusFor(raw);
  const teachingWaiting = teachingFor(raw);
  if (waiting) { try { createLife(raw, ctx); } catch (error) { refused = error.name; } await waiting; }
  if (teachingWaiting) await teachingWaiting;
  const state = createLife(raw, ctx);
  const baseView = viewLife(state, ctx);
  const wearablesDeferred = !baseView.onboarding.boutique.some(item => item.kind === 'wearables');
  // Same helper used by BoutiqueApp after opening: keep the catalogue out of startup,
  // then compare its complete projection against the full engine without dropping any expected entries.
  const { withWearableBoutique } = await import('${url('../app/features/life/boutiqueModel.ts')}');
  results.push({ waited: waiting !== null, refused, state, wearablesDeferred,
    view: { ...baseView, onboarding: withWearableBoutique(baseView.onboarding, state) } });
}
await loadCampus();
process.stdout.write(JSON.stringify({ playing, standInsLeft: isStandIn('unilagStudent'), results }));`;

const START = Date.UTC(2026, 0, 5, 8);
const CAMPUS_KEYS = ['unilagStudent', 'unilagCommunity', 'unilagShuttle'];
function probe(input: string, hookEnv: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', `data:text/javascript,${encodeURIComponent(REGISTER)}`, '--input-type=module', '--eval', PROBE, input], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...hookEnv },
  });
}

function player(seed: string, cityId = 'lagos'): { state: LifeState; act(body: ActionBody): void; wait(seconds: number): void; ctx(): LifeContextInit } {
  let now = START;
  const ctx = (): LifeContextInit => makeContext({ now, cityId, seed });
  const state = createLife(null, ctx());
  return {
    state, ctx,
    act(body) { dispatch(state, { ...body, actionId: `${seed}-${now}` }, { ...ctx(), internal: true }); },
    wait(seconds) { now += seconds * 1000; advanceLife(state, seconds, ctx()); },
  };
}

function authoredTeacher(cityId: string, seed: string): { state: LifeState; ctx: LifeContextInit } {
  const context = makeContext({ now: START, cityId, seed });
  const state = createLife({ t: START, job: 'teaching', location: 'park', spot: 'work',
    career: { city: cityId, auto: false, oriented: true, performance: 50 } }, context);
  state.needs.energy = 100; state.needs.hunger = 100;
  const started = dispatch(state, { type: 'activity', actionId: `${seed}-start`, payload: { id: 'teaching-shift' } }, { ...context, internal: true });
  assert.equal(started.ok, true, `${cityId}: full engine starts teaching at the authored workplace`);
  const active = state.activeAction;
  assert.ok(active?.kind === 'activity' && active.id === 'teaching-shift' && active.teaching);
  const answer = dispatch(state, { type: 'career.teach', actionId: `${seed}-first-answer`, payload: {
    generation: active.teachingGeneration, revision: active.teaching.revision, stage: 'diagnose', choice: 'denominator-count',
  } }, { ...context, internal: true });
  assert.equal(answer.ok, true, `${cityId}: the first authored answer is accepted`);
  return { state, ctx: { now: state.t, cityId, trustedSave: true } };
}

/** Lives in the fictional city, played by the full engine: a visitor, a settled resident, a worker mid-shift with a local friend. */
function testCityLives(): { name: string; raw: unknown; ctx: LifeContextInit }[] {
  const out: { name: string; raw: unknown; ctx: LifeContextInit }[] = [];
  const keep = (name: string, p: ReturnType<typeof player>): void => { out.push({ name, raw: JSON.parse(JSON.stringify(p.state)), ctx: { now: p.state.t, cityId: FICTIONAL_CITY_ID } }); };
  const visitor = player('test-visitor', FICTIONAL_CITY_ID);
  keep('test city: a visitor who has not chosen a local unit', visitor);
  for (const [type, payload] of [['onboarding.look', { look: DEFAULT_LOOK }], ['onboarding.traits', { traits: ['clean-pikin', 'musical'] }], ['onboarding.dream', { dream: 'afrobeats-star' }], ['onboarding.lottery', {}], ['onboarding.home', { lga: 'test-central', via: 'manual' }]] as const) visitor.act({ type, payload } as ActionBody);
  keep('test city: settled at home', visitor);
  visitor.act({ type: 'travel', payload: { id: 'test-square', mode: 'trek' } } as ActionBody); visitor.wait(600);
  visitor.act({ type: 'apply-job', payload: { id: 'community-helper' } } as ActionBody);
  visitor.act({ type: 'spot', payload: { id: 'work' } } as ActionBody);
  visitor.act({ type: 'activity', payload: { id: 'test-help-shift' } } as ActionBody); visitor.wait(2);
  keep('test city: mid-shift', visitor);
  visitor.wait(600);
  visitor.act({ type: 'spot', payload: { id: 'people' } } as ActionBody);
  visitor.act({ type: 'activity', payload: { id: 'npc-test-fictional-one-hello' } } as ActionBody); visitor.wait(600);
  keep('test city: a job, a local friend, hours later', visitor);
  return out;
}

function lives(): { name: string; raw: unknown; ctx: LifeContextInit }[] {
  const out: { name: string; raw: unknown; ctx: LifeContextInit }[] = [];
  const keep = (name: string, p: ReturnType<typeof player>): void => { out.push({ name, raw: JSON.parse(JSON.stringify(p.state)), ctx: { now: p.state.t, cityId: 'lagos' } }); };
  out.push({ name: 'nobody', raw: null, ctx: { now: START, cityId: 'lagos' } });
  const fresh = player('fresh'); keep('fresh', fresh);
  const settled = player('settled');
  settled.act({ type: 'onboarding.look', payload: { look: { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' } } });
  settled.act({ type: 'onboarding.traits', payload: { traits: ['musical', 'tech-bro-or-sis'] } });
  settled.act({ type: 'onboarding.dream', payload: { dream: 'yaba-unicorn' } });
  settled.act({ type: 'onboarding.lottery', payload: {} });
  settled.act({ type: 'onboarding.home', payload: { house: 'yaba' } });
  keep('settled at home', settled);
  const wearable = viewLife(settled.state, settled.ctx()).onboarding.boutique.find(item => item.kind === 'wearables' && !item.owned && item.blocked === null);
  assert.ok(wearable, 'the fixture can buy an offered wearable through the full engine');
  const beforeWearable = settled.state.cash;
  settled.act({ type: 'onboarding.boutique-buy', payload: { kind: 'wearables', id: wearable.id } });
  assert.equal(settled.state.cash, beforeWearable - wearable.price);
  assert.ok(settled.state.onboarding.wardrobe.wearables?.some(id => id === wearable.id));
  assert.ok(settled.state.onboarding.look.wearables?.some(id => id === wearable.id));
  keep('settled with a bought and worn layer', settled);
  for (const venue of ['park', 'market', 'gym']) { settled.act({ type: 'travel', id: venue, mode: 'okada' }); settled.wait(600); }
  settled.act({ type: 'travel', id: 'park', mode: 'okada' }); settled.wait(600);
  settled.act({ type: 'spot', payload: { id: 'trees' } }); settled.act({ type: 'activity', id: 'chill' }); settled.wait(5);
  keep('settled, mid-activity', settled);
  settled.wait(3600 * 5);
  keep('settled, hours later', settled);
  settled.act({ type: 'apply-job', id: 'community-helper' }); settled.wait(3600 * 30);
  keep('settled, a day and a half later', settled);
  const student = player('student');
  for (const [type, payload] of [['onboarding.look', { look: { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'plain', skin: 'skin-3', hairColor: 'black', outfitColor: 'green', bottomsColor: 'navy' } }], ['onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }], ['onboarding.dream', { dream: 'yaba-unicorn' }], ['onboarding.lottery', {}], ['onboarding.home', { house: 'yaba' }]] as const) student.act({ type, payload } as ActionBody);
  student.act({ type: 'travel', id: 'unilag', mode: 'okada' }); student.wait(900);
  keep('at the campus', student);
  // A student of the campus: what the server would hold after the application, a ride and a club (rebuilt by the full engine, so it is a valid life).
  const enrolled = JSON.parse(JSON.stringify(student.state)) as Record<string, unknown>;
  enrolled.unilagStudent = { ...(enrolled.unilagStudent as object), status: 'admitted', programme: 'computer', admittedDay: lagosTime(START).day, applicationCount: 1 };
  enrolled.unilagShuttle = { rides: 3 };
  enrolled.unilagCommunity = { ...(enrolled.unilagCommunity as object), clubs: ['debate'] };
  const rebuilt = createLife(enrolled, { now: student.state.t, cityId: 'lagos' });
  out.push({ name: 'a student at the campus', raw: JSON.parse(JSON.stringify(rebuilt)), ctx: { now: rebuilt.t, cityId: 'lagos' } });
  const away = JSON.parse(JSON.stringify(rebuilt)) as Record<string, unknown>;
  away.location = 'park'; away.spot = 'amphitheatre';
  out.push({ name: 'a student, away from the campus', raw: JSON.parse(JSON.stringify(createLife(away, { now: rebuilt.t, cityId: 'lagos' }))), ctx: { now: rebuilt.t, cityId: 'lagos' } });
  out.push(...testCityLives());
  // A life with a home in each city (settled in both, now in one of them): the other home is kept as it is.
  for (const [city, other, lga, house] of [['ibadan', 'lagos', 'ikeja', 'mushin'], ['lagos', 'ibadan', 'ibadan-north', 'ibadan-mokola-room']] as const) {
    const home = { lga, tier: 'starter', living: 'rent', house };
    const two = createLife({ cash: 9000, name: 'Two homes', estate: { city, lga: city === 'lagos' ? 'ikeja' : 'ibadan-north', away: { [other]: home } }, career: { city: other } }, { now: START, cityId: city });
    out.push({ name: `two homes: in ${city} with a home in ${other}`, raw: JSON.parse(JSON.stringify(two)), ctx: { now: START, cityId: city } });
  }
  const teacher = authoredTeacher('lagos', 'teaching-session');
  out.push({ name: 'a teaching shift after its first authored answer', raw: JSON.parse(JSON.stringify(teacher.state)), ctx: teacher.ctx });
  return out;
}

const withoutCampus = (view: unknown): unknown => Object.fromEntries(Object.entries(view as Record<string, unknown>).filter(([key]) => !CAMPUS_KEYS.includes(key)));

test('the browser engine rebuilds and views every life as the full engine does, and refuses a campus life until the campus rules are loaded', async (t) => {
  const registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)];
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan'), loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)]);
  const given = lives();
  for (const registration of registrations) registration.dispose();
  const again = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)];
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan'), loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)]);
  try {
  assert.ok(given.some((life) => CAMPUS_SLICES.some((key) => !isFreshSlice(key, (life.raw as Record<string, unknown> | null)?.[key]))), 'the sample includes a life with campus state');
  assert.ok(given.some((life) => !needsCampusRules(life.raw) && life.raw !== null), 'and lives that do not');
  const dir = mkdtempSync(join(tmpdir(), 'browser-profile-'));
  try {
    const file = join(dir, 'lives.json');
    writeFileSync(file, JSON.stringify({ mode: 'lives', lives: given.map(({ name, raw, ctx }) => ({ name, raw, ctx })) }));
    const clientFile = join(dir, 'client.json');
    writeFileSync(clientFile, JSON.stringify({ mode: 'client', lives: given.map(({ name, raw, ctx }) => ({ name, raw, ctx })) }));
    const clientRun = JSON.parse(probe(clientFile)) as { client: Record<string, unknown> };
    const output = JSON.parse(probe(file)) as
      { playing: boolean; standInsLeft: boolean; results: { waited: boolean; refused: string | null; wearablesDeferred: boolean; state: unknown; view: unknown }[] };
    const campusLife = given.find((life) => life.name === 'a student at the campus');
    const savedStudent = (campusLife?.raw as { unilagStudent: { status: string; programme: string }; unilagShuttle: { rides: number }; unilagCommunity: { clubs: string[] } }) ;
    assert.deepEqual(clientRun.client, { standInAtStart: true, before: 'none', connected: true, standIn: false, status: savedStudent.unilagStudent.status, programme: savedStudent.unilagStudent.programme,
      rides: savedStudent.unilagShuttle.rides, clubs: savedStudent.unilagCommunity.clubs }, 'a client that is given a life with campus state fetches the campus rules and keeps all of it');
    assert.equal(output.playing, false, 'the browser profile cannot play a life');
    assert.equal(output.standInsLeft, false, 'the campus rules were loaded');
    assert.equal(output.results.length, given.length);
    let loaded = false;
    given.forEach((life, index) => {
      const result = output.results[index];
      assert.ok(result, life.name);
      const full = createLife(life.raw, life.ctx);
      assert.deepEqual(result.state, JSON.parse(JSON.stringify(full)), `${life.name}: the rebuilt life`);
      const fullView = JSON.parse(JSON.stringify(viewLife(full, life.ctx))) as Record<string, unknown>;
      assert.equal(result.wearablesDeferred, true, `${life.name}: wearables remain deferred until Boutique opens`);
      const uses = needsCampusRules(life.raw), loadedBefore = loaded;
      assert.equal(result.waited, uses && !loaded, `${life.name}: waits for the campus rules the first time a life uses the campus, and never again`);
      loaded ||= uses;
      const holdsCampusState = CAMPUS_SLICES.some((key) => !isFreshSlice(key, (life.raw as Record<string, unknown> | null)?.[key]));
      assert.equal(result.refused, holdsCampusState && !loadedBefore ? 'CampusNotLoaded' : null, `${life.name}: a stand-in refuses what only the campus rules can rebuild`);
      // Refusal is observed before awaiting the lazy rules; the final view is built after that await.
      // Once this input has loaded the rules, its own view and all subsequent views include campus data.
      if (loaded) assert.deepEqual(result.view, fullView, `${life.name}: the view`);
      else assert.deepEqual(result.view, withoutCampus(fullView), `${life.name}: the view (the campus views arrive with the campus rules)`);
    });
    t.diagnostic(`${given.length} lives, ${given.filter((life) => needsCampusRules(life.raw)).length} using the campus, ${given.filter((life) => life.ctx.cityId === FICTIONAL_CITY_ID).length} in the test city`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally { for (const registration of again) registration.dispose(); }
});

test('the read-only browser hydrates, retries and fences a saved authored teaching session', async () => {
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')]);
  const teacher = authoredTeacher('lagos', 'browser-teaching');
  const ibadanTeacher = authoredTeacher('ibadan', 'browser-teaching-ibadan');
  const snapshot = JSON.parse(JSON.stringify(teacher.state));
  const switchSnapshot = JSON.parse(JSON.stringify(ibadanTeacher.state));
  const cancelled = dispatch(teacher.state, { type: 'cancel', actionId: 'browser-teaching-cancel' }, { now: teacher.state.t, cityId: 'lagos', internal: true });
  assert.equal(cancelled.ok, true);
  const plain = JSON.parse(JSON.stringify(teacher.state));
  const plainLagos = JSON.parse(JSON.stringify(teacher.state));
  const directory = mkdtempSync(join(tmpdir(), 'browser-teaching-profile-'));
  try {
    const fixture = (mode: string, extra: Record<string, string> = {}) => {
      const file = join(directory, `${mode}.json`);
      writeFileSync(file, JSON.stringify({ mode, snapshot, plain, plainLagos, switchSnapshot, now: teacher.state.t, ...extra }));
      return file;
    };
    const cacheRelease = join(directory, 'cache.release');
    const cacheRequest = join(directory, 'cache.requested');
    assert.equal(probe(fixture('teaching-cache', { release: cacheRelease, requestMarker: cacheRequest }), {
      TEACHING_GATE_BARRIER: cacheRelease, TEACHING_GATE_REQUEST_MARKER: cacheRequest,
    }), 'teaching-cache-ok\n');
    const newerRelease = join(directory, 'newer.release');
    const newerRequest = join(directory, 'newer.requested');
    assert.equal(probe(fixture('teaching-newer', { release: newerRelease, requestMarker: newerRequest }), {
      TEACHING_GATE_BARRIER: newerRelease, TEACHING_GATE_REQUEST_MARKER: newerRequest,
    }), 'teaching-newer-ok\n');
    const failureMarker = join(directory, 'first-import-failed');
    const retryRequest = join(directory, 'retry.requested');
    assert.equal(probe(fixture('teaching-retry-connect', { failureMarker, requestMarker: retryRequest }), {
      TEACHING_GATE_FAIL_FIRST: '1', TEACHING_GATE_FAIL_MARKER: failureMarker, TEACHING_GATE_REQUEST_MARKER: retryRequest,
    }), 'teaching-retry-connect-ok\n');
    const switchRelease = join(directory, 'switch.release');
    const switchRequest = join(directory, 'switch.requested');
    assert.equal(probe(fixture('teaching-switch', { release: switchRelease, requestMarker: switchRequest }), {
      TEACHING_GATE_BARRIER: switchRelease, TEACHING_GATE_REQUEST_MARKER: switchRequest,
    }), 'teaching-switch-ok\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
