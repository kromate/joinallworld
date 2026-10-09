import { loadCityContent, playableCityIds, DEFAULT_CITY_ID } from '../game/cities/registry.ts';
await Promise.all(playableCityIds().map(loadCityContent));
// Each city's own scenes are a download of their own: the scene host builds the default city with nothing else loaded, refuses
// a city whose scenes have not arrived (it never draws a stand-in for one), and every venue of a city is drawn from that city's
// download alone. The world adapter waits for the download with bounded retries and builds the venue host when it is here.
// The tests run in order: the first ones need a process in which no city's scenes have been loaded yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_HOST_RAW, SCENE_HOST_GZIP } from '../budgets.ts';
import type * as THREE from 'three';
import { createKit } from './kit.ts';
import type { SceneVenue } from './types.ts';
import { KINDS, buildVenueScene } from './venue-scenes.ts';
import { CITY_KINDS, citySceneDef, cityScenesReady, loadAllCityScenes, loadCityScenes, sceneCityIds, sceneCityOf } from './city-scenes.ts';
import { sceneVenue } from '../venue-world.ts';
import type { ScenesState, WorldAdapterOptions } from '../campus/unilag/world-adapter.ts';
import { cityContent } from '../game/cities/registry.ts';

// Node has no CSS loader. Keep the browser stylesheet intact and stub only its
// side-effect import while this test imports the adapter's pure host seam.
const adapterCssUrl = new URL('../campus/unilag/world-adapter.css', import.meta.url).href;
const cssFixtureHook = registerHooks({
  load(url, context, nextLoad) {
    if (url === adapterCssUrl) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { CAMPUS_VENUE, createWorldAdapter } = await import('../campus/unilag/world-adapter.ts')
  .finally(() => cssFixtureHook.deregister());

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALIASES: Record<string, [string, string]> = { library: ['club', 'speakeasy'], church: ['worship', 'church'], mosque: ['worship', 'mosque'] };
/** The kind and variant a venue's scene is looked up with. */
function asked(venue: SceneVenue): [string, string] {
  const kind = String(venue.scene?.kind), alias = ALIASES[kind];
  return [alias?.[0] ?? kind, typeof venue.scene?.variant === 'string' ? venue.scene.variant : alias?.[1] ?? ''];
}
// Home has its own builder and the campus its own host: neither is a scene kind.
const venuesOf = (cityId: string): SceneVenue[] => cityContent(cityId).venues.filter((venue) => venue.kind !== 'home' && venue.id !== CAMPUS_VENUE).map((venue) => sceneVenue(venue.id, cityId) as unknown as SceneVenue);

function stubRenderer(): THREE.WebGLRenderer {
  return { shadowMap: {}, domElement: { remove() {} }, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} } as unknown as THREE.WebGLRenderer;
}
function stubContainer() {
  const classes = new Set<string>();
  return { classes, appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }), classList: { add: (name: string) => { classes.add(name); }, remove: (name: string) => { classes.delete(name); } } };
}
/** Timers the test fires by hand. */
function manualTimers() {
  const waiting: { run: () => void; ms: number }[] = [];
  return {
    waiting,
    options: { setTimeout: (run: () => void, ms: number) => { const entry = { run, ms }; waiting.push(entry); return entry; }, clearTimeout: (entry: never) => { const at = waiting.indexOf(entry); if (at >= 0) waiting.splice(at, 1); } },
    fire() { const next = waiting.shift(); assert.ok(next, 'a retry is waiting'); next.run(); },
  };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise<void>((done) => setImmediate(done)); };
function adapter(options: WorldAdapterOptions) {
  const container = stubContainer(), seen: ScenesState[] = [], hosts: (string | null)[] = [];
  const world = createWorldAdapter(container as unknown as HTMLElement, { renderer: stubRenderer(), onScenes: (state) => { seen.push(state); }, onHost: (kind) => { hosts.push(kind); }, ...options });
  return { world, container, seen, hosts };
}

test('with no city loaded, the default city builds and every other city with scenes of its own is refused', () => {
  const kit = createKit();
  assert.ok(cityScenesReady(DEFAULT_CITY_ID), 'the default city needs no download');
  assert.equal(sceneCityIds().includes(DEFAULT_CITY_ID), false);
  for (const venue of venuesOf(DEFAULT_CITY_ID)) {
    const entry = buildVenueScene(kit, venue, DEFAULT_CITY_ID);
    assert.equal(entry.kind, asked(venue)[0], `${venue.id} is drawn as its own kind`);
    entry.dispose();
  }
  for (const cityId of sceneCityIds()) {
    assert.equal(cityScenesReady(cityId), false, `${cityId} is not ready before its download`);
    assert.throws(() => buildVenueScene(kit, venuesOf(cityId)[0], cityId), /have not been loaded/, `${cityId}: no stand-in scene is built`);
  }
  // An unknown city has no scenes of its own: it draws with the shared kinds.
  assert.ok(cityScenesReady('test-nowhere'));
  kit.dispose();
});

test('the adapter draws nothing for a city whose scenes are on their way, says so, and builds the venue host when they arrive', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const { world, container, seen, hosts } = adapter({ location: 'national-mosque', cityId: 'abuja', loadScenes: async (cityId) => { await gate; await loadCityScenes(cityId); } });
  assert.equal(world.host, null, 'no host yet');
  assert.equal(world.awaiting, 'abuja');
  assert.ok(container.classes.has('scenes-loading'));
  await settle();
  assert.deepEqual(seen.map((state) => [state.city, state.status]), [['abuja', 'loading']]);
  // What arrives meanwhile is kept for the host.
  world.setState({ location: 'national-mosque', estate: { city: 'abuja' } });
  world.setPlayer({ look: { body: 'woman' }, seed: 'someone', name: 'Ada' });
  assert.equal(world.prepare('millennium-park'), false, 'nothing is prepared without a host');
  assert.equal(world.walkTo(0, 0), false);
  assert.equal(world.host, null);
  release();
  await settle();
  assert.equal(world.host, 'venue');
  assert.equal(world.awaiting, null);
  assert.equal(container.classes.has('scenes-loading'), false);
  assert.deepEqual(hosts, ['venue']);
  assert.deepEqual(seen.map((state) => state.status), ['loading', 'ready']);
  const shown = world.diagnostics() as { location?: string; scenes?: number };
  assert.equal(shown.location, 'national-mosque');
  assert.ok(cityScenesReady('abuja') && !cityScenesReady('kano'), 'only the city that was asked for was fetched');
  assert.ok(citySceneDef('abuja', 'worship', 'fct-mosque'), 'the mosque has its own scene');
  world.dispose();
});

test('a failed download is retried by itself with growing waits, then stops until the player asks again', async () => {
  const timers = manualTimers();
  let attempts = 0, failing = true;
  const { world, seen, hosts } = adapter({ location: 'palace', cityId: 'kano', lazy: timers.options, loadScenes: async (cityId) => { attempts += 1; if (failing) throw new Error('Failed to fetch dynamically imported module'); await loadCityScenes(cityId); } });
  await settle();
  assert.equal(attempts, 1);
  assert.deepEqual(seen.map((state) => [state.status, state.retryInMs]), [['loading', null], ['retrying', 1000]]);
  assert.equal(world.host, null, 'still nothing drawn: no stand-in');
  for (const wait of [2000, 4000, 8000, 16000]) { timers.fire(); await settle(); assert.equal(seen.at(-1)!.retryInMs, wait); }
  timers.fire(); await settle();
  assert.equal(attempts, 6);
  assert.equal(seen.at(-1)!.status, 'failed');
  assert.equal(timers.waiting.length, 0, 'no further attempt by itself');
  assert.equal(world.host, null);
  // The player asks again, and the connection is back.
  failing = false;
  assert.equal(world.retryScenes(), true);
  await settle();
  assert.equal(attempts, 7);
  assert.equal(seen.at(-1)!.status, 'ready');
  assert.equal(world.host, 'venue');
  assert.deepEqual(hosts, ['venue']);
  assert.equal(world.retryScenes(), false, 'nothing is awaited any more');
  world.dispose();
});

test('an automatic retry that succeeds builds the scene without the player doing anything', async () => {
  const timers = manualTimers();
  let attempts = 0;
  const { world } = adapter({ location: 'pleasure-park', cityId: 'port-harcourt', lazy: timers.options, loadScenes: async (cityId) => { attempts += 1; if (attempts === 1) throw new Error('offline'); await loadCityScenes(cityId); } });
  await settle();
  assert.equal(world.host, null);
  timers.fire(); await settle();
  assert.equal(world.host, 'venue');
  assert.equal((world.diagnostics() as { location?: string }).location, 'pleasure-park');
  world.dispose();
});

test('arriving in another city: the old city leaves the screen, the new one is built when its scenes arrive, and a place change meanwhile is kept', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const ready = new Set<string>([DEFAULT_CITY_ID]);
  const { world, hosts } = adapter({ location: 'park', scenesReady: (cityId) => ready.has(cityId), loadScenes: async (cityId) => { await gate; await loadCityScenes(cityId); ready.add(cityId); } });
  assert.equal(world.host, 'venue', 'the default city is built at once');
  world.setState({ location: 'park', estate: { city: DEFAULT_CITY_ID } });
  // The trip ended in Ibadan, at the campus court.
  world.setState({ location: 'ui-campus', estate: { city: 'ibadan' } });
  assert.equal(world.host, null, 'the Lagos scene is not left on screen as Ibadan');
  assert.equal(world.awaiting, 'ibadan');
  assert.equal(world.setLocation('ui-campus'), false, 'the place is the one the state named');
  // The player walks on at once.
  assert.equal(world.setLocation('bowers-tower'), true);
  world.setState({ location: 'bowers-tower', estate: { city: 'ibadan' } });
  assert.equal(world.host, null);
  release();
  await settle();
  assert.equal(world.host, 'venue');
  assert.equal((world.diagnostics() as { location?: string }).location, 'bowers-tower');
  assert.deepEqual(hosts, ['venue', 'venue']);
  // A city whose scenes are here is changed to without putting the host away.
  ready.add('abuja'); await loadCityScenes('abuja');
  world.setState({ location: 'national-mosque', estate: { city: 'abuja' } });
  world.setLocation('national-mosque');
  assert.equal(world.host, 'venue');
  assert.equal(world.awaiting, null);
  assert.deepEqual(hosts, ['venue', 'venue'], 'the same host changed city');
  assert.equal((world.diagnostics() as { location?: string }).location, 'national-mosque');
  world.dispose();
});

test('leaving for a city that is ready while another was awaited builds at once, and the late arrival changes nothing', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const ready = new Set<string>([DEFAULT_CITY_ID]);
  const { world, hosts, seen } = adapter({ location: 'itoku-market', cityId: 'abeokuta', scenesReady: (cityId) => ready.has(cityId), loadScenes: async (cityId) => { await gate; await loadCityScenes(cityId); ready.add(cityId); } });
  assert.equal(world.awaiting, 'abeokuta');
  world.setState({ location: 'park', estate: { city: DEFAULT_CITY_ID } });
  assert.equal(world.host, 'venue');
  assert.equal(world.awaiting, null);
  release();
  await settle();
  assert.deepEqual(hosts, ['venue'], 'no second host for the city that was left');
  assert.equal(seen.some((state) => state.status === 'ready'), false, 'nobody is told about a city that is no longer awaited');
  assert.equal((world.diagnostics() as { location?: string }).location, 'park');
  world.dispose();
});

test('every venue of every city is drawn from its own city\'s download alone', async () => {
  await loadAllCityScenes();
  const kit = createKit();
  for (const cityId of playableCityIds()) {
    assert.ok(cityScenesReady(cityId), cityId);
    for (const venue of venuesOf(cityId)) {
      const [kind, variant] = asked(venue);
      assert.ok(KINDS.includes(kind), `${cityId}/${venue.id}: ${kind} is a scene kind`);
      const own = citySceneDef(cityId, kind, variant);
      // A kind that arrives with a city is only drawn by that city, or replaced by a scene of the venue's own city.
      if (Object.hasOwn(CITY_KINDS, kind)) assert.ok(own, `${cityId}/${venue.id}: ${kind} is not part of this city's download`);
      // No other city has a scene under this name that this city would have needed.
      for (const other of sceneCityIds()) if (other !== cityId && citySceneDef(other, kind, variant) && !Object.hasOwn(CITY_KINDS, kind)) assert.equal(citySceneDef(other, kind, variant), own, `${cityId}/${venue.id}: ${kind}/${variant} is ${other}'s scene`);
      const entry = buildVenueScene(kit, venue, cityId);
      assert.equal(entry.kind, kind, `${cityId}/${venue.id} is drawn as its own kind, not the plain plaza`);
      entry.dispose();
    }
  }
  // The default city draws nothing from another city's download, whichever are loaded.
  for (const venue of venuesOf(DEFAULT_CITY_ID)) assert.equal(citySceneDef(DEFAULT_CITY_ID, ...asked(venue)), null);
  assert.equal(sceneCityOf('worship', 'fct-mosque'), 'abuja');
  assert.equal(sceneCityOf('quad', ''), 'ibadan');
  assert.equal(sceneCityOf('park', 'no-such-variant'), null);
  kit.dispose();
});

// ---- the built bundle ------------------------------------------------------------------------------------------------------------
// The shared scene chunk (the host, the shared kinds, the figures' rig) measured 179.1 kB raw / 68.3 kB gzip once the cities' own
// scenes had left it (532.9 kB / 183.9 kB with all nine cities' scenes inside). The budget is the measurement plus about 4%.
const HOST_BUDGET = { raw: SCENE_HOST_RAW.value, gzip: SCENE_HOST_GZIP.value };
test('the shared scene chunk holds no city\'s own scenes: each is a chunk of its own, fetched on demand', (t) => {
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) { t.diagnostic('no dist/: run `npm run build` to check the scene chunks'); return; }
  const names = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const host = names.filter((name) => /^world-adapter-[\w-]+\.js$/.test(name));
  assert.equal(host.length, 1, 'one shared scene chunk');
  const bytes = readFileSync(join(assets, host[0]!)), code = bytes.toString('utf8');
  const size = { raw: bytes.length, gzip: gzipSync(bytes).length };
  const cities = names.filter((name) => /^city-[\w-]+-scenes(-[ab])?-[\w-]{8}\.js$/.test(name));
  t.diagnostic(`${host[0]} ${size.raw} raw ${size.gzip} gzip; ${cities.map((name) => { const file = readFileSync(join(assets, name)); return `${name} ${file.length} raw ${gzipSync(file).length} gzip`; }).join('; ')}`);
  assert.ok(size.raw <= HOST_BUDGET.raw, `the shared scene chunk is ${size.raw} bytes (budget ${HOST_BUDGET.raw})`);
  assert.ok(size.gzip <= HOST_BUDGET.gzip, `the shared scene chunk is ${size.gzip} bytes gzipped (budget ${HOST_BUDGET.gzip})`);
  assert.deepEqual(cities.map((name) => name.replace(/-[\w-]{8}\.js$/, '')).sort(), ['city-abuja-scenes', 'city-ibadan-scenes', 'city-kano-scenes', 'city-ogun-scenes-a', 'city-ogun-scenes-b', 'city-port-harcourt-scenes']);
  // Static imports only (`from"./x.js"`, `import"./x.js"`): the host must not pull a city's scenes in with itself.
  const eager = [...code.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)].map((match) => match[1] as string);
  assert.deepEqual(eager.filter((name) => /^city-.+-scenes/.test(name) || /^venues-/.test(name)), [], 'no city scene chunk is a static import of the host');
  // And no city's scenes are a static import of another's.
  for (const name of cities) {
    const own = readFileSync(join(assets, name), 'utf8');
    assert.deepEqual([...own.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)].map((match) => match[1] as string).filter((other) => /^city-.+-scenes/.test(other)), [], `${name} needs no other city's scenes`);
  }
});
