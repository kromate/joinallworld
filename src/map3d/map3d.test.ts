// The 3D city map: registry, routing, the server-timed trip, the render budget and the battery rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { COUNTRIES, citiesOf, cityAccess, cityEntry, hasCityPack, isPlayable, loadCityPack, projector } from './regions.ts';
import { bridgeRamp, buildNetwork, pointAt, pointInPolygon, roundPolygon } from './roads.ts';
import { tripOf, createTripClock, tripPose, tripShares, TRIP_LOOKS } from './trip.ts';
import type { TripMode, TripSource } from './trip.ts';
import { createMap3D, timeOfDay } from './map3d.ts';
import type { MapRenderer } from './map3d.ts';
import type * as THREE from 'three';
import { LANDMARK_KINDS } from './landmarks.ts';
import { avatarBox, labelShift, nearPoints } from './labels.ts';
import type { ScreenBox, GroundPoint } from './labels.ts';
import { lgaAt } from './lga.ts';
import { shimmer } from './city-build.ts';
import pack from './cities/lagos.ts';
import { VENUES, COMING_SOON, HOME_SPOTS, SCENE_KINDS } from '../game/content/venues.ts';
import { ALL_MODES } from '../game/content/travel.ts';
import { createLife, viewLife } from '../life.ts';
import { goBlock, tripInfo, chosenMode } from '../ui/panels/world-ui.js';

const NOON = Date.UTC(2026, 0, 5, 11), NIGHT = Date.UTC(2026, 0, 5, 22);
const network = buildNetwork(pack);
const keyOf = (id: string, home = 'yaba') => (id === 'home' ? `home:${home}` : id);
const mainland = roundPolygon(pack.land.find((entry) => entry.id === 'mainland')!.points, 2);
const onMainland = (spot: GroundPoint) => pointInPolygon(spot.x, spot.z, mainland);

test('the region registry: Lagos is playable, Ibadan, Abuja and Port Harcourt are coming soon, and a city is data plus a pack', async () => {
  assert.deepEqual(citiesOf('nigeria').map((city) => [city.id, city.status]), [['lagos', 'playable'], ['ibadan', 'soon'], ['abuja', 'soon'], ['port-harcourt', 'soon']]);
  for (const country of Object.values(COUNTRIES)) {
    assert.ok(country.outline.length > 8 && country.name, country.id);
    const flat = projector(country.id, 1000);
    for (const city of Object.values(country.cities)) {
      assert.ok(city.teaser.length > 20 && city.region && Number.isFinite(city.lon) && Number.isFinite(city.lat), `${city.id} has a teaser and a position`);
      const [x, y] = flat.point(city.lon, city.lat);
      assert.ok(x > 0 && x < flat.width && y > 0 && y < flat.height, `${city.id} lies inside its country`);
      assert.equal(hasCityPack(city.id), city.status === 'playable', `${city.id}: playable cities, and only they, have a 3D pack`);
    }
  }
  assert.equal(isPlayable('lagos'), true); assert.equal(isPlayable('ibadan'), false); assert.equal(cityEntry('nowhere'), null);
  // Ibadan has lives on the server but is shown as coming soon: only a player who already has one gets a way in, as a preview.
  assert.equal(cityAccess('lagos', { current: 'lagos' }), 'here');
  assert.equal(cityAccess('ibadan', { current: 'lagos', held: ['lagos'] }), 'soon');
  assert.equal(cityAccess('ibadan', { current: 'lagos', held: ['lagos', 'ibadan'] }), 'preview');
  assert.equal(cityAccess('ibadan', { current: 'ibadan', held: ['ibadan'] }), 'here');
  assert.equal(cityAccess('lagos', { current: 'ibadan', held: ['ibadan'] }), 'enter');
  assert.equal(cityAccess('abuja', { current: 'lagos', held: ['abuja'] }), 'soon', 'a city without server lives is never offered');
  const loaded = await loadCityPack('lagos');
  assert.equal(loaded!.id, 'lagos'); assert.equal(await loadCityPack('abuja'), null);
});

test('the Lagos pack places every venue (the airport and the refinery among them) and every home district, and every scene kind has a landmark', () => {
  assert.deepEqual(Object.keys(pack.sites).sort(), Object.keys(VENUES).filter((id) => id !== 'home').sort(), 'one site per venue, by the venue ids of the game content');
  assert.deepEqual(Object.keys(pack.homes).sort(), Object.keys(HOME_SPOTS).sort());
  assert.deepEqual(Object.keys(pack.soon).sort(), Object.keys(COMING_SOON).sort());
  assert.deepEqual(Object.keys(pack.estates).sort(), Object.keys(HOME_SPOTS).sort(), 'an estate for the Neighbours layer in every home district');
  for (const kind of SCENE_KINDS) assert.ok(LANDMARK_KINDS.includes(kind), `landmark for scene kind ${kind}`);
  // The UNILAG campus stands at Akoka: inside the Lagos Mainland local government.
  const campus = pack.sites.unilag;
  assert.ok(campus, 'the pack has a campus site');
  assert.equal(lgaAt(pack, campus.x, campus.z), 'lagos-mainland');
  // The geography the server prices trips by is respected: mainland venues stand north of the lagoon, the rest south of it.
  for (const [id, venue] of Object.entries(VENUES)) {
    if (id === 'home') continue;
    assert.equal(onMainland(pack.sites[id]!), venue.zone === 'mainland', `${id} is on the ${venue.zone}`);
    if (venue.zone === 'east') assert.ok(pack.sites[id]!.x > 56, `${id} is on the Lekki peninsula`);
  }
  for (const [id, spot] of Object.entries(HOME_SPOTS)) assert.equal(onMainland(pack.homes[id]!), spot.zone === 'mainland', `home ${id}`);
});

test('roads: every place can reach every other along the road graph, across the right bridge, door to door', () => {
  const ids = [...Object.keys(pack.sites), ...Object.keys(pack.homes).map((id) => `home:${id}`)];
  let routes = 0;
  for (const from of ids) for (const to of ids) {
    if (from === to) continue;
    const route = network.route(from, to);
    assert.ok(route, `${from} → ${to}`);
    routes += 1;
    const a = network.places[from]!, b = network.places[to]!, first = route.points[0]!, last = route.points.at(-1)!;
    assert.ok(Math.hypot(first.x - a.door.x, first.z - a.door.z) < 1e-6 && Math.hypot(last.x - b.door.x, last.z - b.door.z) < 1e-6, 'a trip runs from one door to the other');
    assert.ok(route.length >= Math.hypot(a.x - b.x, a.z - b.z) - 9, 'never shorter than the straight line');
    const zone = (id: string) => onMainland(id.startsWith('home:') ? pack.homes[id.slice(5)]! : pack.sites[id]!);
    if (zone(from) !== zone(to)) assert.ok(route.bridges.some((bridge) => ['carter', 'eko', 'third-mainland'].includes(bridge)), `${from} → ${to} crosses the lagoon on a bridge`);
  }
  assert.equal(routes, ids.length * (ids.length - 1));
  assert.deepEqual(network.route('hospital', 'state-house')!.bridges, ['third-mainland'], 'Gbagada to the Marina goes over the Third Mainland Bridge');
  assert.ok(network.route('home:ikoyi', 'palms')!.bridges.includes('link'), 'Ikoyi to Lekki takes the link bridge');
  assert.ok(network.route('park', 'i-fitness')!.bridges.includes('falomo'), 'Lagos Island to Victoria Island takes Falomo Bridge');
  // A bridge is a bridge: its deck rises over the water and comes back down at both ends.
  for (const road of network.roads.filter((item) => item.bridge)) {
    assert.equal(road.points[0]!.y, 0); assert.equal(road.points.at(-1)!.y, 0);
    assert.ok(Math.max(...road.points.map((point) => point.y)) > road.bridge! * 0.95, `${road.id} deck is raised`);
  }
  // Sampling a route is continuous and stays on the route.
  const route = network.route('radio', 'beach')!;
  let previous = pointAt(route, 0);
  for (let d = 0.5; d <= route.length; d += 0.5) { const at = pointAt(route, d); assert.ok(Math.hypot(at.x - previous.x, at.z - previous.z) < 0.51); previous = at; }
  assert.ok(route.bridges.length >= 2, 'Ikeja to the beach crosses twice');
});

test('the trip is the server’s timer: progress is 1 − remaining ÷ duration, re-anchored by every state', () => {
  const life = (active: (NonNullable<TripSource['activeAction']> & { fare?: number }) | null, location = 'home') => ({ location, activeAction: active, travel: { home: 'yaba' } });
  assert.equal(tripOf(life(null)), null);
  assert.equal(tripOf(life({ kind: 'activity', id: 'nap', duration: 10, remaining: 4 })), null);
  assert.equal(tripOf(life({ kind: 'travel', id: 'home', duration: 10, remaining: 4, mode: 'trek' })), null, 'a trip to where you are is no trip');
  const trip = tripOf(life({ kind: 'travel', id: 'park', duration: 12, remaining: 9, mode: 'danfo', fare: 200 }))!;
  assert.deepEqual([trip.from, trip.to, trip.mode, trip.duration, trip.remaining], ['home', 'park', 'danfo', 12, 9]);
  assert.equal(tripOf(life({ kind: 'commute', id: 'cchub', duration: 6, remaining: 6 }))!.mode, 'commute');
  assert.equal(tripOf(life({ kind: 'travel', id: 'park', duration: 5, remaining: 5 }))!.mode, 'danfo', 'an old save without a mode still travels');
  for (const mode of Object.keys(ALL_MODES)) assert.ok(TRIP_LOOKS[mode as TripMode], `a look for travel mode ${mode}`);

  const clock = createTripClock();
  assert.equal(clock.sync(trip, 1000), true, 'a new trip');
  assert.ok(Math.abs(clock.progress(1000) - 0.25) < 1e-9, 'the moment the state arrives, the avatar is exactly where the server says');
  assert.ok(Math.abs(clock.progress(4000) - 0.5) < 1e-9, 'three seconds on, three seconds further');
  assert.equal(clock.progress(99000), 1); assert.equal(clock.remaining(99000), 0);
  // The next poll says the same thing a second later: nothing jumps. A poll delayed by the network never pulls the avatar back.
  assert.equal(clock.sync({ ...trip, remaining: 8 }, 2000), false);
  assert.ok(Math.abs(clock.progress(2000) - (1 - 8 / 12)) < 1e-9);
  clock.sync({ ...trip, remaining: 7.1 }, 3000);
  assert.ok(clock.progress(3000) >= 1 - 7.1 / 12 - 1e-9 && clock.progress(3000) <= 1 - 7 / 12 + 1e-9, 'a late reading is within jitter and keeps the earlier arrival');
  // A reload mid-trip (or a stale local copy replaced by the server's) re-anchors at once.
  clock.sync({ ...trip, remaining: 2 }, 3500);
  assert.ok(Math.abs(clock.progress(3500) - (1 - 2 / 12)) < 1e-9);
});

test('the place on the route is a pure function of progress: leave on foot, ride along the roads, arrive on foot', () => {
  const route = network.route(keyOf('home'), 'i-fitness')!;
  for (const mode of ['trek', 'keke', 'danfo', 'okada', 'cab', 'car', 'commute']) {
    const start = tripPose(route, 0, mode), end = tripPose(route, 1, mode);
    assert.ok(Math.hypot(start.x - route.points[0]!.x, start.z - route.points[0]!.z) < 0.02, `${mode} starts at the origin door`);
    assert.ok(Math.hypot(end.x - route.points.at(-1)!.x, end.z - route.points.at(-1)!.z) < 0.02, `${mode} ends at the destination door`);
    assert.deepEqual(tripPose(route, 0.37, mode), tripPose(route, 0.37, mode), 'same progress, same pose');
    let previous = start, far = 0;
    for (let p = 0.002; p <= 1; p += 0.002) { const pose = tripPose(route, p, mode); far = Math.max(far, Math.hypot(pose.x - previous.x, pose.z - previous.z)); assert.ok(pose.distance >= previous.distance - 1e-9, 'it only moves forward'); previous = pose; }
    assert.ok(far < route.length * 0.006, `${mode} never jumps (largest step ${far.toFixed(2)})`);
  }
  const phases = (mode: string) => [...new Set(Array.from({ length: 101 }, (_, i) => tripPose(route, i / 100, mode).phase))];
  assert.deepEqual(phases('trek'), ['walk'], 'a trek is walked the whole way');
  assert.deepEqual(phases('danfo'), ['leave', 'ride', 'arrive'], 'a danfo is boarded at the road and left at the road');
  // Trek is the same speed all the way; the walker's stride comes from the distance covered.
  assert.ok(Math.abs(tripPose(route, 0.5, 'trek').distance - route.length / 2) < 1e-6);
  assert.ok(tripPose(route, 0.5, 'trek').step > 20 && tripPose(route, 0.5, 'trek').walking);
  const shares = tripShares(route);
  assert.ok(shares.lead > 0 && shares.lead <= 0.2 && shares.tail > 0 && shares.tail <= 0.2);
  // In the middle of a cross-lagoon ride the vehicle is on a bridge, above the water.
  const onBridge = Array.from({ length: 200 }, (_, i) => tripPose(route, i / 200, 'danfo')).filter((pose) => pose.bridge);
  assert.ok(onBridge.length > 10 && onBridge.some((pose) => pose.y > 1), 'the ride crosses a raised bridge deck');
  assert.ok(onBridge.every((pose) => pose.phase === 'ride'));
});

// ---- the host, with a renderer that only counts and a frame clock the test drives -------------------
/** A hand-made stub standing in for a DOM or WebGL object: the map reads only the members the stub carries. */
const stub = <T>(value: object): T => value as unknown as T;
interface FakeContainer { hidden: boolean; appendChild(): void; getBoundingClientRect: () => { width: number; height: number; left: number; top: number } }
function harness({ reducedMotion = false, home = 'yaba', width = 390, height = 844 } = {}) {
  const calls = { render: 0 }, queue: Array<() => void> = [];
  const renderer = { calls, shadowMap: {}, domElement: {}, info: { render: {} }, setPixelRatio() {}, setSize() {}, setClearColor() {}, dispose() {}, render() { calls.render += 1; } };
  const container: FakeContainer = { hidden: false, appendChild() {}, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) };
  const env = { now: 0, hidden: false, due: 0, arrived: 0 };
  const map = createMap3D(stub<HTMLElement>(container), { pack, renderer: stub<MapRenderer>(renderer), reducedMotion, raf: (fn) => { queue.push(fn as () => void); return queue.length; }, caf: () => { queue.length = 0; }, now: () => env.now, tabHidden: () => env.hidden, onTripDue: () => { env.due += 1; } });
  /** Run every frame that has been asked for, `step` ms apart, up to `limit` frames. Returns how many ran. */
  const pump = (limit = 1000, step = 16) => { let ran = 0; while (queue.length && ran < limit) { env.now += step; queue.shift()!(); ran += 1; } return ran; };
  const state = (more: Record<string, unknown> = {}) => ({ location: 'home', t: NOON, activeAction: null, travel: { home }, ...more });
  return { map, renderer, container, env, queue, pump, state, count: () => map.diagnostics().renderCount };
}
const travelling = (remaining: number, duration = 10, mode = 'danfo', id = 'park') => ({ kind: 'travel', id, duration, remaining, mode, fare: 200 });

test('battery rule: an open, idle map draws nothing; a trip draws frames; after arrival it is flat again', () => {
  const h = harness();
  h.map.setState(h.state()); h.map.resize();
  assert.ok(h.pump() >= 1, 'opening draws the city');
  const idle = h.count();
  assert.ok(idle >= 1);
  h.env.now += 60000;
  assert.equal(h.queue.length, 0, 'nothing is scheduled while idle');
  assert.equal(h.pump(), 0); assert.equal(h.count(), idle, 'render counter flat while idle');
  h.map.setState(h.state()); h.pump();
  const afterSameState = h.count();
  assert.ok(afterSameState - idle <= 1, 'the same state again costs at most one frame, and no loop');
  assert.equal(h.queue.length, 0);

  // A trip: frames for as long as it runs, and the avatar exactly where the server's timer puts it.
  h.map.setState(h.state({ activeAction: travelling(10) }));
  const start = h.env.now;
  assert.equal(h.pump(60), 60, 'the loop runs during the trip');
  assert.equal(h.count(), afterSameState + 60, 'one draw per frame');
  let trip = h.map.diagnostics().trip!;
  assert.ok(Math.abs(trip.shown! - (h.env.now - start) / 10000) < 0.002, `position matches elapsed ÷ duration (${trip.shown})`);
  // The server reports again one second in: the shown position agrees with remaining ÷ duration.
  h.env.now = start + 3000;
  h.map.setState(h.state({ activeAction: travelling(7) })); h.pump(1);
  trip = h.map.diagnostics().trip!;
  assert.ok(Math.abs(trip.shown! - (1 - (7 - 0.016) / 10)) < 0.002, 'in step with the server’s remaining time');
  assert.equal(trip.phase, 'ride'); assert.deepEqual(trip.bridges, ['carter']);
  // It reaches the door when the server's timer does, asks the host for the arrival, and stops drawing.
  h.env.now = start + 9900; h.pump(1);
  assert.ok(h.map.diagnostics().trip!.shown! < 1);
  h.pump(50);
  assert.equal(h.map.diagnostics().trip!.shown!, 1);
  assert.ok(h.env.due >= 1, 'the host is asked to fetch the arrival');
  assert.equal(h.queue.length, 0, 'at the door, waiting for the server: no loop');
  const waiting = h.count(); h.env.now += 5000; assert.equal(h.pump(), 0); assert.equal(h.count(), waiting);

  // The server moves the player: a short settle (the camera pushes in), then the host is told and everything is still.
  h.map.setState(h.state({ location: 'park' }));
  h.map.arrive(() => { h.env.arrived += 1; });
  assert.equal(h.env.arrived, 0, 'the arrival is shown first');
  const settle = h.pump(200);
  assert.ok(settle > 5 && settle < 80, `a short settle, not a wait (${settle} frames)`);
  assert.equal(h.env.arrived, 1);
  assert.equal(h.map.diagnostics().trip, null);
  const after = h.count(); h.env.now += 60000;
  assert.equal(h.queue.length, 0); assert.equal(h.pump(), 0); assert.equal(h.count(), after, 'render counter flat after arrival');
  h.map.destroy();
});

test('battery rule: nothing is drawn while the map is hidden or the tab is; a trip already running is picked up at the right point', () => {
  const h = harness();
  h.map.setState(h.state()); h.map.resize(); h.pump();
  h.container.hidden = true; h.map.resize();
  const hidden = h.count();
  h.map.setState(h.state({ activeAction: travelling(10) }));
  const start = h.env.now;
  assert.equal(h.queue.length, 0, 'hidden: a trip schedules nothing');
  h.env.now += 4000; h.map.setState(h.state({ activeAction: travelling(6) }));
  assert.equal(h.pump(), 0); assert.equal(h.count(), hidden);
  // The map opens mid-trip: the animation picks up where the server's timer is.
  h.container.hidden = false; h.map.resize();
  assert.equal(h.pump(5), 5);
  assert.ok(Math.abs(h.map.diagnostics().trip!.shown! - (h.env.now - start) / 10000) < 0.002, 'picked up at the right point');
  // The tab is hidden: the loop stops. Shown again: it carries on from the server's time, not from where it stopped.
  h.env.hidden = true; h.map.visibility();
  assert.equal(h.queue.length, 0, 'tab hidden: stopped');
  const paused = h.count(); h.env.now += 3000;
  assert.equal(h.pump(), 0); assert.equal(h.count(), paused);
  h.env.hidden = false; h.map.visibility();
  assert.equal(h.pump(3), 3);
  assert.ok(Math.abs(h.map.diagnostics().trip!.shown! - (h.env.now - start) / 10000) < 0.002);
  h.map.destroy();
  assert.equal(h.queue.length, 0, 'destroyed: nothing left scheduled');
});

test('a cancelled trip stops, walks back to where it started and goes still; a new state mid-way does not disturb it', () => {
  const h = harness();
  h.map.setState(h.state()); h.map.resize(); h.pump();
  h.map.setState(h.state({ activeAction: travelling(10, 10, 'trek') })); h.pump(100);
  const far = h.map.diagnostics().trip!;
  assert.ok(far.shown! > 0.1 && far.phase === 'walk');
  h.map.setState(h.state());                       // the server: no action, same place
  assert.equal(h.map.diagnostics().trip!.returning, true);
  const frames = h.pump(500);
  assert.ok(frames > 3 && frames < 120, `back in under two seconds (${frames} frames)`);
  assert.equal(h.map.diagnostics().trip, null);
  const still = h.count(); h.env.now += 30000; assert.equal(h.pump(), 0); assert.equal(h.count(), still);
  h.map.destroy();
});

test('reduced motion: the trip is a dot moved once per server report — no frame loop, no camera ease', () => {
  const h = harness({ reducedMotion: true });
  h.map.setState(h.state()); h.map.resize(); h.pump();
  const view = { ...h.map.diagnostics().view };
  h.map.setState(h.state({ activeAction: travelling(10) }));
  assert.equal(h.pump(), 1, 'one frame for the report');
  assert.equal(h.queue.length, 0, 'and no loop');
  assert.deepEqual(h.map.diagnostics().view, view, 'the camera did not move');
  const before = h.count();
  h.env.now += 1000; h.map.setState(h.state({ activeAction: travelling(9) }));
  assert.equal(h.pump(), 1); assert.equal(h.count(), before + 1);
  assert.ok(Math.abs(h.map.diagnostics().trip!.shown! - 0.1) < 0.01);
  h.map.setState(h.state({ location: 'park' }));
  let arrived = 0; h.map.arrive(() => { arrived += 1; });
  assert.equal(arrived, 1, 'no settle to wait for');
  h.map.destroy();
});

test('render budget: the whole city, with every layer on and a trip running, stays under 60k triangles and 40 draw calls', () => {
  const h = harness();
  h.map.setState(h.state({ activeAction: travelling(10, 10, 'danfo', 'beach') })); h.map.resize();
  const ads = { palette: { colours: [{ id: 'green', bg: '#256b45', ink: '#ffffff' }], icons: [{ id: 'star', icon: '⭐' }] },
    billboards: { slots: Object.keys(pack.sites).slice(0, 12).map((near, i) => ({ slot: `bb-${i}`, near, road: 'Road', ad: i % 2 ? { text: '<b>Buy</b> <img src=x onerror=alert(1)>', colour: 'green', icon: 'star', by: { id: 'p', name: 'Ada' } } : null })) },
    sea: { rows: 16, cols: 16, shoreRows: 2, plots: Array.from({ length: 40 }, (_, i) => ({ slot: `sea-${i % 16}-${Math.floor(i / 16)}`, row: i % 16, col: Math.floor(i / 16), text: 'javascript:alert(1)', colour: 'green', icon: 'star', by: { id: 'p', name: 'Ada' } })) } };
  const neighbours = { total: 60, online: 9, districts: Object.keys(HOME_SPOTS).map((id) => ({ id, label: id, count: 30, online: 4, homes: [{ id: 'x', name: 'Ada', online: true, you: false }] })) };
  const ui = { layers: { moving: true, billboards: true, sea: true, neighbours: true, gov: true }, ads, neighbours, gov: { governor: null }, selected: 'park' };
  h.map.ui(ui);
  h.pump(30);
  const d = h.map.diagnostics();
  assert.ok(d.cityTriangles > 30000, `a city, not pins on a board (${d.cityTriangles} triangles)`);
  let meshes = 0, triangles = 0;
  h.map.city.group.parent!.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: true; count?: number };
    if (!mesh.isMesh || !object.visible) return;
    for (let up = object.parent; up; up = up.parent) if (!up.visible) return;
    meshes += 1;
    triangles += ((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position!.count) / 3) * (mesh.isInstancedMesh ? mesh.count! : 1);
  });
  assert.ok(triangles < 60000, `${Math.round(triangles)} triangles in view`);
  assert.ok(meshes <= 40, `${meshes} draw calls`);
  assert.ok(d.counts.houses > 200 && d.counts.trees > 40 && d.counts.vehicles > 20, 'houses, trees and traffic are there');
  // What players typed is carried as plain text for DOM nodes; it is never turned into geometry or markup.
  assert.ok(d.overlayTriangles > 0);
  h.map.destroy();
});

test('every venue has its landmark and label anchor; Home stands in the player’s own district; the lights follow Lagos time', () => {
  const h = harness({ home: 'ikoyi' });
  h.map.setState(h.state()); h.map.resize(); h.pump();
  const places = h.map.city.places;
  for (const id of Object.keys(VENUES)) assert.ok(places[id] && places[id]!.top > 2, `${id} is on the map`);
  for (const id of Object.keys(COMING_SOON)) assert.equal(places[id]!.kind, 'soon');
  assert.equal(places.home!.house, 'ikoyi'); assert.equal(places.home!.district, 'Ikoyi');
  const before = h.count();
  h.map.setState(h.state({ travel: { home: 'lekki' } })); h.pump();
  assert.equal(places.home!.house, 'lekki'); assert.ok(places.home!.x > 56, 'the house moved to Lekki');
  assert.equal(h.count(), before + 1, 'one frame for the move');
  assert.equal(h.map.diagnostics().time, 'day');
  h.map.setState(h.state({ t: NIGHT, travel: { home: 'lekki' } })); h.pump();
  assert.equal(h.map.diagnostics().time, 'night');
  assert.deepEqual([timeOfDay(Date.UTC(2026, 0, 5, 5)), timeOfDay(Date.UTC(2026, 0, 5, 12)), timeOfDay(Date.UTC(2026, 0, 5, 17)), timeOfDay(Date.UTC(2026, 0, 5, 20))], ['dusk', 'day', 'dusk', 'night']);
  h.map.destroy();
});

test('the opening view: a phone opens close on the player, a wide screen on the whole city, and neither costs a frame loop', () => {
  const phone = harness({ home: 'ikoyi' });
  phone.map.setState(phone.state()); phone.map.resize();
  assert.equal(phone.pump(), 1, 'one frame, no ease');
  const near = phone.map.diagnostics().view, whole = phone.map.rig.whole(), home = phone.map.city.places.home!;
  assert.ok(Math.hypot(near.x - home.x, near.z - home.z) < 4, 'centred on the player');
  assert.ok(near.distance < whole.distance * 0.3, `a close view (${Math.round(near.distance)} against ${Math.round(whole.distance)} for the whole city)`);
  // Close means: the streets either side of the player fill the screen, so their places are named in words.
  const span = nearPoints(home, true);
  assert.ok(span[1]!.x - span[0]!.x < 60 && span[1]!.x - span[0]!.x > 40, 'a phone holds about fifty units of city across');
  assert.ok(nearPoints(home, false)[1]!.x - nearPoints(home, false)[0]!.x > span[1]!.x - span[0]!.x, 'a wide screen holds more');
  // Wherever the player is, that is where it opens.
  const away = harness();
  away.map.setState(away.state({ location: 'beach' })); away.map.resize(); away.pump();
  assert.ok(Math.hypot(away.map.diagnostics().view.x - pack.sites.beach!.x, away.map.diagnostics().view.z - pack.sites.beach!.z) < 4);
  const idle = away.count(); away.env.now += 60000;
  assert.equal(away.queue.length, 0); assert.equal(away.pump(), 0); assert.equal(away.count(), idle, 'still once open');
  const desk = harness({ width: 1280, height: 800 });
  desk.map.setState(desk.state()); desk.map.resize(); desk.pump();
  const wide = desk.map.diagnostics().view, all = desk.map.rig.whole();
  assert.deepEqual([wide.x, wide.z, Math.round(wide.distance)], [all.x, all.z, Math.round(all.distance)], 'a wide screen opens on the whole city');
  for (const h of [phone, away, desk]) h.map.destroy();
});

test('a label never covers the player’s piece: it steps up (or down over its own roof) while they overlap, and back when they part', () => {
  const feet = { x: 200, y: 400 }, head = { x: 200, y: 340 };
  const piece = avatarBox(feet, head), tagged = avatarBox(feet, head, { tag: true }), riding = avatarBox(feet, head, { riding: true });
  assert.ok(piece.l < 200 && piece.r > 200 && piece.t <= 340 && piece.b >= 400, 'the box holds the piece from head to feet');
  assert.ok(tagged.t < piece.t - 20 && tagged.r - tagged.l >= 44, 'during a trip it holds the "You" tag too');
  assert.ok(riding.r - riding.l > piece.r - piece.l, 'a vehicle is wider than a walker');
  const label = (x: number, bottom: number, width = 120, height = 32) => ({ l: x - width / 2, r: x + width / 2, t: bottom - height, b: bottom });
  const after = (box: ScreenBox, shift: number) => ({ ...box, t: box.t + shift, b: box.b + shift });
  const covers = (box: ScreenBox, other: ScreenBox) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t;
  assert.equal(labelShift(label(200, 300), piece), 0, 'above the head: left alone');
  assert.equal(labelShift(label(200, 460), piece), 0, 'below the feet: left alone');
  assert.equal(labelShift(label(330, 370), piece), 0, 'beside it: left alone');
  assert.equal(labelShift(label(200, 370), null), 0, 'no piece on screen, nothing to avoid');
  // Over the head and shoulders: it rises until its bottom edge is above the head.
  const high = label(200, 362), up = labelShift(high, piece);
  assert.ok(up < 0 && !covers(after(high, up), piece), `rises clear (${up}px)`);
  assert.ok(labelShift(high, tagged) < up, 'and higher still to clear the "You" tag');
  // Over the feet, where rising would be a long way: it drops over its own roof instead.
  const low = label(200, 428), down = labelShift(low, piece);
  assert.ok(down > 0 && down < 40 && !covers(after(low, down), piece), `drops clear (${down}px)`);
  // The move grows from nothing as the two begin to overlap sideways, so nothing snaps as the avatar walks up.
  const moves: number[] = [];
  for (let x = 290; x >= 200; x -= 2) moves.push(labelShift(label(x, 362), piece));
  assert.equal(moves[0], 0); assert.equal(moves.at(-1), up);
  for (let i = 1; i < moves.length; i++) assert.ok(moves[i]! <= moves[i - 1]! && moves[i - 1]! - moves[i]! <= 12, `a smooth rise (${moves[i - 1]} → ${moves[i]})`);
  // On the map: the piece stands at the door, off the plinth, and a state after arrival names the place as where you are.
  const h = harness();
  h.map.setState(h.state({ activeAction: travelling(10) })); h.map.resize(); h.pump(5);
  h.env.now += 10000; h.pump(50);
  h.map.setState(h.state({ location: 'park' })); h.pump(200);
  const d = h.map.diagnostics();
  assert.equal(d.trip, null); assert.equal(d.loop, false);
  h.map.destroy();
});

test('bridges meet the road without a kink: gentle ramps, and the link bridge carries on the line of the road at each end', () => {
  assert.equal(bridgeRamp(1.9, 90), 0.24, 'a long bridge keeps a level deck');
  assert.ok(bridgeRamp(2.2, 18) > 0.4 && bridgeRamp(2.2, 18) <= 0.46, 'a short, high one is an arch');
  const heading = (a: GroundPoint, b: GroundPoint) => Math.atan2(b.x - a.x, b.z - a.z);
  const turn = (a: number, b: number) => { const d = Math.abs(a - b) % (Math.PI * 2); return Math.min(d, Math.PI * 2 - d) * 180 / Math.PI; };
  for (const road of network.roads.filter((item) => item.bridge)) {
    let steepest = 0, sharpest = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!, run = Math.hypot(b.x - a.x, b.z - a.z);
      assert.ok(run < 1.6, `${road.id} deck is sampled finely`);
      steepest = Math.max(steepest, Math.abs(b.y - a.y) / run);
      if (i > 1) sharpest = Math.max(sharpest, Math.abs((b.y - a.y) / run - (a.y - road.points[i - 2]!.y) / Math.hypot(a.x - road.points[i - 2]!.x, a.z - road.points[i - 2]!.z)));
    }
    assert.ok(steepest < 0.42, `${road.id} ramp is a slope a road could have (${steepest.toFixed(2)})`);
    assert.ok(sharpest < 0.25, `${road.id} deck bends smoothly (${sharpest.toFixed(2)})`);
  }
  const road = (id: string) => network.roads.find((item) => item.id === id)!.points;
  const link = road('link'), broad = road('broad'), landing = road('link-landing');
  assert.ok(Math.hypot(link[0]!.x - broad.at(-1)!.x, link[0]!.z - broad.at(-1)!.z) < 1e-9 && Math.hypot(link.at(-1)!.x - landing[0]!.x, link.at(-1)!.z - landing[0]!.z) < 1e-9, 'joined end to end');
  assert.ok(turn(heading(broad.at(-2)!, broad.at(-1)!), heading(link[0]!, link[1]!)) < 15, 'Broad Street runs straight onto the bridge');
  assert.ok(turn(heading(link.at(-2)!, link.at(-1)!), heading(landing[0]!, landing[1]!)) < 15, 'and the bridge straight onto Admiralty Way');
  for (let i = 2; i < link.length; i++) assert.ok(turn(heading(link[i - 2]!, link[i - 1]!), heading(link[i - 1]!, link[i]!)) < 14, 'the deck itself has no corner');
  assert.equal(network.roads.find((item) => item.id === 'link')!.pylon, true);
});

test('the water’s shimmer is a static, seamless texture: it tiles, it is subtle, and nothing animates it', () => {
  let low = 1, high = 0;
  for (let i = 0; i <= 64; i++) {
    assert.ok(Math.abs(shimmer(0, i / 64) - shimmer(1, i / 64)) < 1e-9 && Math.abs(shimmer(i / 64, 0) - shimmer(i / 64, 1)) < 1e-9, 'the tile repeats without a seam');
    for (let j = 0; j < 64; j++) { const tone = shimmer(i / 64, j / 64); low = Math.min(low, tone); high = Math.max(high, tone); }
  }
  assert.ok(low > 0.84 && high <= 1 && high - low > 0.05, `subtle: ${low.toFixed(2)}…${high.toFixed(2)} of the water's colour`);
  const h = harness();
  h.map.setState(h.state()); h.map.resize(); h.pump();
  const water = h.map.city.materials.water, map = water.map;
  assert.ok(map && map.image.width === 128 && map.repeat.x > 4 && map.repeat.y > 4, 'a small tile, repeated over the lagoon');
  const version = map.version, offset = [map.offset.x, map.offset.y], idle = h.count();
  // A trip runs the loop (and city.animate with it): the shimmer still does not move, and idle is still idle.
  h.map.setState(h.state({ activeAction: travelling(10) })); h.pump(40);
  assert.equal(map.version, version, 'never re-uploaded'); assert.deepEqual([map.offset.x, map.offset.y], offset, 'never scrolled');
  h.map.setState(h.state()); h.pump(500);
  const still = h.count(); h.env.now += 60000;
  assert.ok(still > idle); assert.equal(h.queue.length, 0); assert.equal(h.pump(), 0); assert.equal(h.count(), still, 'flat when idle');
  h.map.setState(h.state({ t: NIGHT })); h.pump();
  assert.equal(water.map, map, 'the same tile at night: it multiplies the water’s colour');
  h.map.destroy();
});

/** What this test reads of the (untyped) life model and the Ride panel helpers. */
interface LifeStub { location: string }
interface Destination { id: string; kind: string; open: boolean; here: boolean }
interface LifeView { travel: { destinations: Destination[] }; connected?: boolean; session?: { id: string } | null }
interface Block { code: string; reason: string; fix: { kind: string; mode?: string } }
interface TripCard { from: { id: string }; to: { id: string }; mode: { id: string }; fare: number; fraction: number; rule: string }
const createLifeOf = createLife as (saved: Record<string, unknown>, ctx: { now: number; cityId: string }) => LifeStub;
// The test drives viewLife with a minimal life stub, not a full LifeState: one cast at the boundary.
const viewLifeOf = viewLife as unknown as (state: LifeStub, ctx: { now: number; cityId: string }) => LifeView;
const goBlockOf = goBlock as (state: LifeStub, view: LifeView, item: Destination | undefined, mode: unknown) => Block | null;
const chosenModeOf = chosenMode as (item: Destination | undefined, wanted: string) => unknown;
const tripInfoOf = tripInfo as (state: LifeStub, view: LifeView) => TripCard | null;

test('why a trip is refused is always said with what to do about it', () => {
  const ctx = { now: NOON, cityId: 'lagos' };
  const life = (more: Record<string, unknown> = {}) => createLifeOf({ name: 'Ada', cash: 5000, ...more }, ctx);
  const cardOf = (state: LifeStub, id: string, more: Partial<LifeView> = {}) => { const view: LifeView = { ...viewLifeOf(state, ctx), connected: true, session: { id: 'p' }, ...more }; const item = view.travel.destinations.find((entry) => entry.id === id); return { view, item, block: (mode = 'danfo') => goBlockOf(state, view, item, chosenModeOf(item, mode)) }; };
  // Every open venue can be travelled to from a fresh life: nothing blocks a legitimate trip.
  const fresh = life();
  for (const item of viewLifeOf(fresh, ctx).travel.destinations.filter((entry) => entry.kind === 'venue' && entry.open && !entry.here)) {
    assert.equal(cardOf(fresh, item.id).block(), null, `${item.id} can be travelled to`);
    assert.equal(cardOf(fresh, item.id).block('trek'), null);
  }
  // Offline, or the session gone: a Reconnect button.
  assert.equal(fresh.location, 'park');
  const offline = cardOf(fresh, 'cchub', { connected: false }).block();
  assert.equal(offline!.code, 'offline'); assert.equal(offline!.fix.kind, 'reconnect'); assert.match(offline!.reason, /Reconnect/);
  assert.match(cardOf(fresh, 'cchub', { connected: false, session: null }).block()!.reason, /session/);
  // Closed: the opening time and the wait.
  const closed = viewLifeOf(fresh, ctx).travel.destinations.find((entry) => entry.kind === 'venue' && !entry.open);
  assert.ok(closed, 'something is closed at noon');
  const shut = cardOf(fresh, closed.id).block();
  assert.equal(shut!.code, 'closed'); assert.match(shut!.reason, /opens \d+(:\d+)?(AM|PM) \(in /); assert.match(shut!.reason, /open now, or come back/);
  // Not enough cash: the shortfall, and the free way to go.
  const broke = life({ cash: 30 });
  const short = cardOf(broke, 'cchub').block('danfo');
  assert.equal(short!.code, 'insufficient_funds'); assert.match(short!.reason, /you are ₦170 short/); assert.match(short!.reason, /Trekking is free/);
  assert.deepEqual([short!.fix.kind, short!.fix.mode], ['mode', 'trek']);
  assert.equal(cardOf(broke, 'cchub').block('trek'), null, 'the trek itself is never refused for cash');
  // Coming soon (a made-up place: nothing in Lagos is waiting now), and already here.
  (COMING_SOON as Record<string, unknown>).spaceport = { id: 'spaceport', label: 'Spaceport', district: 'Epe', icon: '✈️', description: 'Not built yet.', zone: 'east', map: { x: 90, y: 60 } };
  try { assert.equal(cardOf(fresh, 'spaceport').block()!.code, 'coming_soon'); } finally { delete (COMING_SOON as Record<string, unknown>).spaceport; }
  const here = cardOf(fresh, fresh.location).block();
  assert.equal(here!.code, 'already_here'); assert.equal(here!.fix.kind, 'enter');
  // Already travelling, and busy with an activity: finish or cancel.
  const moving = life({ activeAction: { kind: 'travel', id: 'cchub', duration: 10, remaining: 6, mode: 'danfo', fare: 200 } });
  const again = cardOf(moving, 'beach').block();
  assert.equal(again!.code, 'travelling'); assert.equal(again!.fix.kind, 'cancel'); assert.match(again!.reason, /already on the way to CcHub/);
  const info = tripInfoOf(moving, { ...viewLifeOf(moving, ctx) });
  assert.deepEqual([info!.from.id, info!.to.id, info!.mode.id, info!.fare, Math.round(info!.fraction * 10)], ['park', 'cchub', 'danfo', 200, 4]);
  assert.match(info!.rule, /₦200 fare you paid is not refunded/);
  assert.equal(tripInfoOf(fresh, viewLifeOf(fresh, ctx)), null);
});

test('Three.js and the map stay out of the entry chunk, and only the 3D map may run a frame loop', async () => {
  const main = await readFile('src/life-main.js', 'utf8');
  assert.doesNotMatch(main, /^import .*(map3d|three|city-map|world-map)/m, 'the entry file imports no map code statically');
  assert.match(main, /import\('\.\/map3d\/index\.ts'\)/);
  for (const file of ['src/ui/panels/map.js', 'src/ui/panels/ride.js', 'src/ui/panels/world-ui.js']) assert.doesNotMatch(await readFile(file, 'utf8'), /^import[^;]*(map3d|'three')/m, `${file} is in the first download and must not pull the map in`);
  // The loop lives in one place — the host — where it is tied to motion. Everything else under src/map3d draws when asked.
  for (const name of (await readdir('src/map3d')).filter((item) => item.endsWith('.ts') && !item.endsWith('.test.ts'))) {
    const code = (await readFile(`src/map3d/${name}`, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /setInterval|setAnimationLoop/, name);
    if (name !== 'map3d.ts') assert.doesNotMatch(code, /requestAnimationFrame/, name);
  }
  assert.doesNotMatch((await readFile('src/map3d/map3d.ts', 'utf8')), /shadowMap\.enabled = true/, 'no real-time shadow maps');
});
