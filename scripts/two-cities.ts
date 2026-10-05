#!/usr/bin/env node
import { loadCityContent, cachedCityContent, linksFrom } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan', 'abeokuta', 'ota'].map(loadCityContent));
/**
 * Two cities, one character: the journey from Lagos to Ibadan and back, played end to end against the real server.
 *
 *   npm run two-cities
 *
 * Starts the server in-process on an ephemeral port with a temporary data directory and a clock this script controls, then drives
 * one device exactly as a browser does (HTTP only). What it proves, in order:
 *   1. a new Lagos player settles in a Lagos local government and has a home there
 *   2. the atlas shows Ibadan as an open city with a bus route and a rail route from Lagos, at the fares the city module declares
 *   3. the bus to Ibadan charges its fare once, at departure, and arriving costs nothing more
 *   4. an activity at the University of Ibadan and one at Bower's Tower are done at Ibadan's own venues
 *   5. the visitor stays a visitor: nothing is chosen or bought, its home is still in Lagos, and a guest house is its bed
 *   6. the train back to Lagos charges its fare once
 *   7. the Lagos home, its local government, the job and the wallet are all still there, and cash equals the seed plus the whole ledger
 * A third run plays one more pair of legs with the wait skipped for game money (`runSkippedLegs`, server/testing/skipJourney.ts):
 * the first skip between cities is free, the next is charged the price shown, once.
 * `runTwoCities({ log })` is also run by server/two-cities.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.ts';
import { useSaltSourceForTests } from '../server/life-service.ts';
import { driver, object, JOURNEY_TIME } from '../server/testing/cityJourney.ts';
import type { JourneyHost } from '../server/testing/cityJourney.ts';
import { skipJourney } from '../server/testing/skipJourney.ts';
import type { SkipResult } from '../server/testing/skipJourney.ts';
import { regionInfo } from '../src/map3d/geo/info.ts';
import { cityEntry } from '../src/map3d/regions.ts';
import { ticketArrivalVenue } from '../src/game/cities/runtime.ts';
import type { AddressInfo } from 'node:net';

export interface TwoCitiesResult { steps: number; fares: { bus: number; train: number }; cash: number }
export interface ThreePlacesResult { steps: number; fares: number[]; cash: number }
export interface TwoCitiesOptions { log?: (line: string) => void }

/** The server on an ephemeral port with a temporary data directory and a clock the run controls; `done()` shuts it down and removes the data. */
async function bootServer(salt: string) {
  useSaltSourceForTests(() => salt);
  const folder = await mkdtemp(join(tmpdir(), 'allworld-two-cities-'));
  const clock = { time: JOURNEY_TIME };
  const server = await createServer({ dataDir: folder, now: () => clock.time, distDir: join(folder, 'no-dist') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const host: JourneyHost = {
    now: () => clock.time,
    request: (path, body, cookie) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    elapse: async (_device, _city, ms) => { clock.time += ms; },
    qualify: async () => {}, socket: async () => { throw new Error('no sockets in this script'); }, session: async () => null, seedLegacy: async () => {}, restart: async () => {},
  };
  const done = async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.store.close?.();
    await rm(folder, { recursive: true, force: true });
  };
  return { host, done };
}

const log_blank = () => console.log('');
const naira = (value: number) => `₦${value.toLocaleString('en-NG')}`;
const num = (value: unknown): number => { assert.equal(typeof value, 'number'); return value as number };

export async function runTwoCities({ log = console.log }: TwoCitiesOptions = {}): Promise<TwoCitiesResult> {
  // The server keys every random outcome with a secret salt per life; this process is the server, so the run fixes it and is the same every time.
  useSaltSourceForTests(() => 'two-cities-salt-000001');
  const folder = await mkdtemp(join(tmpdir(), 'allworld-two-cities-'));
  let time = JOURNEY_TIME, step = 0;
  const server = await createServer({ dataDir: folder, now: () => time, distDir: join(folder, 'no-dist') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const host: JourneyHost = {
    now: () => time,
    request: (path, body, cookie) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    elapse: async (_device, _city, ms) => { time += ms; },
    qualify: async () => {}, socket: async () => { throw new Error('no sockets in this script'); }, session: async () => null, seedLegacy: async () => {}, restart: async () => {},
  };
  /** The character pin the server stored for the device: a real move writes a current (version 2) pin that later reads honour. */
  const pinned = (device: { cookie: string }) => server.store.read((db: { sessions: Record<string, { character?: { v?: number; city?: string } }> }) => db.sessions[device.cookie.slice(4)]?.character);
  const say = (title: string, state: Record<string, unknown>, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(52)} ${naira(num(state.cash)).padStart(9)}  ${note}`);
  try {
    const { life, action, finish, conserved, start } = driver(host);
    const ibadan = cachedCityContent('ibadan');
    assert.ok(ibadan);
    log('Two cities · one character, Lagos → Ibadan by bus, Ibadan → Lagos by train');

    // 1. a new Lagos player, settled
    const device = await start('Ada', 'lagos', 'ikeja');
    await action(device, 'lagos', 'apply-job', { id: 'community-helper' });
    const home = await life(device, 'lagos');
    assert.deepEqual([object(home.estate).city, object(home.estate).lga, home.job], ['lagos', 'ikeja', 'community-helper']);
    say('New Lagos player settles in Ikeja, takes a job', home, 'free starter house; community helper');

    // 2. the atlas card for Ibadan, read as the atlas reads it
    assert.equal(cityEntry('ibadan')?.status, 'playable', 'the atlas lists Ibadan as open');
    const card = regionInfo({ kind: 'state', id: 'oyo' }, { cityId: 'ibadan', feature: { name: 'Oyo State' }, current: 'lagos' });
    assert.deepEqual([card.tag, card.city?.name], ['Open', 'Ibadan']);
    const modes = card.routes.map((route) => `${route.mode}:${route.fare}`).sort();
    assert.deepEqual(modes, ['rail:9000', 'road:3500'], 'the card offers the bus and the train at the declared fares');
    say('Atlas: Ibadan is open; bus ₦3,500 and train ₦9,000', home, card.teaser);

    // 3. the bus
    const departed = object((await action(device, 'lagos', 'estate.relocate', { to: 'ibadan', mode: 'road' })).state);
    assert.equal(num(departed.cash), num(home.cash) - 3500, 'the bus fare is charged once, at departure');
    say('Bus to Ibadan departs', departed, 'fare −₦3,500');
    await host.elapse(device, 'lagos', 31000); // the bus takes 30 s
    const arrived = object((await host.request('/api/life?city=lagos', undefined, device.cookie).then((response) => response.json()) as { state: unknown }).state);
    assert.deepEqual([object(arrived.estate).city, object(arrived.estate).lga, num(arrived.cash)], ['ibadan', null, num(departed.cash)]);
    assert.equal(arrived.location, ticketArrivalVenue('ibadan', 'road').id, 'a visitor off the bus arrives at the road terminal of Ibadan');
    assert.ok(ibadan.venues.some((venue) => venue.id === arrived.location && venue.id !== 'home'), 'a visitor arrives at a public Ibadan place');
    const ibadanPin = await pinned(device);
    assert.deepEqual([ibadanPin?.v, ibadanPin?.city], [2, 'ibadan'], 'the move wrote a current pin for Ibadan');
    say(`Arrived in Ibadan at ${String(arrived.location)}`, arrived, 'a visitor; arriving costs nothing more');

    // 4. two activities, at the University of Ibadan and Bower's Tower
    for (const [venueId, activityId, label] of [['ui-campus', 'ibadan-ui-walk', 'University of Ibadan'], ['bowers-tower', 'ibadan-tower-view', 'Bower’s Tower']] as const) {
      const venue = ibadan.venues.find((item) => item.id === venueId);
      assert.ok(venue, venueId);
      const spot = Object.values(venue.definition.spots).find((item) => item.activities?.some((activity) => activity.id === activityId));
      assert.ok(spot, `${venueId} offers ${activityId}`);
      await finish(device, 'ibadan', object((await action(device, 'ibadan', 'travel', { id: venueId, mode: 'trek' })).state));
      await action(device, 'ibadan', 'spot', { id: spot.id });
      const done = await finish(device, 'ibadan', object((await action(device, 'ibadan', 'activity', { id: activityId })).state));
      assert.equal(done.location, venueId);
      say(`${label}: ${activityId}`, done);
    }

    // 5. stays a visitor: nothing is chosen or bought, and a guest house is the bed
    const before = await life(device, 'ibadan');
    assert.deepEqual([object(before.estate).lga, object(before.estate).home], [null, 'lagos'], 'a visitor, with its home in Lagos');
    const room = await host.request('/api/action', { cityId: 'ibadan', type: 'estate.lodge', payload: {}, actionId: `${host.now()}:${globalThis.crypto.randomUUID()}` }, device.cookie).then((response) => response.json()) as { ok: boolean; code: string; state: unknown };
    const lodged = object(room.state);
    assert.ok(room.code === 'rested' && num(lodged.cash) === num(before.cash) - (room.ok ? 2500 : 0), 'a room costs ₦2,500 once, or nothing when the visitor is already rested');
    say(room.ok ? 'Rests at a guest house' : 'Already rested: no room is sold', lodged, room.ok ? 'guest house −₦2,500' : 'nothing charged');
    const settled = lodged;

    // 6. the train
    const left = object((await action(device, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'rail' })).state);
    assert.equal(num(left.cash), num(settled.cash) - 9000, 'the train fare is charged once');
    say('Train to Lagos departs', left, 'fare −₦9,000');
    await host.elapse(device, 'ibadan', 22000); // the train takes 21 s
    const back = object((await host.request('/api/life?city=ibadan', undefined, device.cookie).then((response) => response.json()) as { state: unknown }).state);
    assert.deepEqual([object(back.estate).city, num(back.cash)], ['lagos', num(left.cash)]);

    const lagosPin = await pinned(device);
    assert.deepEqual([lagosPin?.v, lagosPin?.city], [2, 'lagos'], 'the move back wrote a current pin for Lagos');
    // 7. Lagos is still there
    assert.deepEqual([object(back.estate).lga, object(back.estate).living, object(back.estate).tier, back.job], ['ikeja', 'own', 'starter', 'community-helper']);
    // The train home arrives at the Lagos home itself; it can be left for a public place and entered again.
    assert.equal(back.location, 'home', 'the returning character arrives at the Lagos home');
    const out = await finish(device, 'lagos', object((await action(device, 'lagos', 'travel', { id: 'park', mode: 'trek' })).state));
    assert.equal(out.location, 'park');
    const lagosAgain = await finish(device, 'lagos', object((await action(device, 'lagos', 'travel', { id: 'home', mode: 'trek' })).state));
    assert.equal(lagosAgain.location, 'home', 'the Lagos home can be entered');
    conserved(await life(device, 'lagos'));
    say('Back in Lagos: Ikeja home, job and wallet intact', lagosAgain, 'cash = seed + the whole ledger');
    log(`Two cities complete: ${step} steps, bus ${naira(3500)} and train ${naira(9000)} each charged once, ${naira(num(lagosAgain.cash))} in hand.`);
    return { steps: step, fares: { bus: 3500, train: 9000 }, cash: num(lagosAgain.cash) };
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
    await server.store.close?.();
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Four places, one character: Lagos → Ota by bus, Ota → Abeokuta by bus, Abeokuta → Ibadan by train and Ibadan → Lagos by bus. Every
 * fare is charged once at departure, each arrival costs nothing more, each stop is settled in its own local government for free,
 * the Lagos house and the job are still there at the end, and cash equals the seed plus the whole ledger.
 */
export async function runThreePlaces({ log = console.log }: TwoCitiesOptions = {}): Promise<ThreePlacesResult> {
  const { host, done } = await bootServer('three-places-salt-0001');
  let step = 0;
  const say = (title: string, state: Record<string, unknown>, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(52)} ${naira(num(state.cash)).padStart(9)}  ${note}`);
  try {
    const { life, action, conserved, start } = driver(host);
    const content = (city: string) => { const found = cachedCityContent(city); assert.ok(found, city); return found; };
    log('Three places · one character, Lagos → Ota → Abeokuta → Ibadan → Lagos');
    const device = await start('Ada', 'lagos', 'ikeja');
    await action(device, 'lagos', 'apply-job', { id: 'community-helper' });
    const home = await life(device, 'lagos');
    say('New Lagos player settles in Ikeja, takes a job', home, 'free starter house; community helper');

    const fares: number[] = [];
    // [from, to, mode, fare, seconds, the local government of a home bought on the way, or null for a visit]
    const legs = [
      ['lagos', 'ota', 'road', 2000, 26, null],
      ['ota', 'abeokuta', 'road', 2500, 27, null],
      ['abeokuta', 'ibadan', 'rail', 4000, 19, null],
      ['ibadan', 'lagos', 'road', 3500, 30, null],
    ] as const;
    let state = home;
    for (const [from, to, mode, fare, seconds, lga] of legs) {
      const linked = linksFrom(from).find((link) => link.to === to && link.mode === mode);
      assert.deepEqual([linked?.fare, linked?.seconds], [fare, seconds], `${from} to ${to} by ${mode} is declared at ${fare} and ${seconds}s`);
      const departed = object((await action(device, from, 'estate.relocate', { to, mode })).state);
      assert.equal(num(departed.cash), num(state.cash) - fare, `${from} to ${to}: the fare is charged once, at departure`);
      say(`${mode === 'rail' ? 'Train' : 'Bus'} ${from} to ${to} departs`, departed, `fare −${naira(fare)}`);
      await host.elapse(device, from, (seconds + 1) * 1000);
      const arrived = object((await host.request(`/api/life?city=${from}`, undefined, device.cookie).then((response) => response.json()) as { state: unknown }).state);
      assert.deepEqual([object(arrived.estate).city, num(arrived.cash)], [to, num(departed.cash)], 'arriving costs nothing more');
      if (to !== 'lagos') assert.equal(arrived.location, ticketArrivalVenue(to, mode).id, `a visitor off the ${mode === 'rail' ? 'train' : 'bus'} lands at the ${to} ${mode === 'rail' ? 'station' : 'terminal'}`);
      if (to !== 'lagos') assert.ok(content(to).venues.some((venue) => venue.id === arrived.location && venue.id !== 'home'), `a visitor arrives at a public ${to} place`);
      fares.push(fare);
      state = arrived;
      say(`Arrived in ${to} at ${String(arrived.location)}`, arrived, 'arriving costs nothing more');
      if (lga) {
        const settled = object((await action(device, to, 'estate.set-lga', { lga, via: 'manual', home: 'buy' })).state);
        assert.equal(object(settled.estate).lga, lga);
        state = settled;
        say(`Buys a home in ${lga}`, settled, 'a home in another city is bought');
      }
    }
    const back = await life(device, 'lagos');
    assert.deepEqual([object(back.estate).city, object(back.estate).lga, object(back.estate).living, back.job, back.location], ['lagos', 'ikeja', 'own', 'community-helper', 'home']);
    assert.deepEqual([Object.keys(object(object(back.estate).away)), object(back.estate).home], [[], 'lagos'], 'three cities visited, one home: nothing was left behind anywhere');
    conserved(back);
    say('Back in Lagos: Ikeja home, job and wallet intact', back, 'cash = seed + the whole ledger');
    log(`Three places complete: ${step} steps, fares ${fares.map(naira).join(', ')} each charged once, ${naira(num(back.cash))} in hand.`);
    return { steps: step, fares, cash: num(back.cash) };
  } finally {
    await done();
  }
}

/** Lagos → Ibadan → Lagos by bus with both waits skipped: the first skip is free, the second costs the price shown and is charged once. */
export async function runSkippedLegs({ log = console.log }: TwoCitiesOptions = {}): Promise<SkipResult & { steps: number }> {
  const { host, done } = await bootServer('skipped-legs-salt-0001');
  let step = 0;
  try {
    log('Skipped legs · one character, Lagos → Ibadan → Lagos by bus, arriving at once');
    const result = await skipJourney({ now: host.now, request: host.request, elapse: host.elapse }, { log: (title, state, note) => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(52)} ${naira(num(state.cash)).padStart(9)}  ${note}`) });
    log(`Skipped legs complete: ${step} steps, the first skip free, the second ${naira(result.charged)} charged once, ${naira(result.cash)} in hand.`);
    return { ...result, steps: step };
  } finally {
    await done();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await runTwoCities(); log_blank(); await runThreePlaces(); log_blank(); await runSkippedLegs(); }
