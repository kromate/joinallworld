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
export async function resolve(specifier, context, next) {
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
import { readFileSync } from 'node:fs';
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
for (const { raw, ctx } of input.lives) {
  let refused = null;
  const waiting = campusFor(raw);
  if (waiting) { try { createLife(raw, ctx); } catch (error) { refused = error.name; } await waiting; }
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
    const probe = (input: string): string => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', `data:text/javascript,${encodeURIComponent(REGISTER)}`, '--input-type=module', '--eval', PROBE, input], { encoding: 'utf8', maxBuffer: 1 << 28 });
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
