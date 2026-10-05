// OWNER: world — skipping a trip for game money ('travel.skip') on the Node host: the route, its receipt, two devices
// pressing at once, where the life is filed, what the character's other device and a watching friend are told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { skipJourney } from './testing/skipJourney.ts';
import type { SkipSocket } from './testing/skipJourney.ts';
import { loadCityContent } from '../src/game/cities/registry.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

test('a trip between cities is skipped once, for the price shown, on the Node host', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const result = await skipJourney({
    now: f.now,
    request: (path, body, cookie) => f.request(path, body, cookie),
    elapse: async (_device, _city, ms) => { f.advance(ms); },
    socket: async (device): Promise<SkipSocket> => {
      const peer = await f.socket(device, { life: true });
      const frames: Record<string, unknown>[] = [];
      peer.ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as Record<string, unknown>); });
      return { send: (value) => peer.ws.send(JSON.stringify(value)), frames };
    },
  });
  assert.deepEqual([result.fare, result.free, result.charged], [3500, 0, 1000]);
});

test('a skip that cannot be paid is refused with the amount missing, and the character stays on its way', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  await f.request('/api/life?city=lagos', null, ada.cookie);
  // A life from before the staged start has ₦5,000: the bus leaves ₦1,500.
  assert.equal((await f.action(ada.cookie, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } })).ok, true);
  // The stored life is set as one that has used its free skip and holds ₦900: the full price (₦1,300) cannot be paid.
  await f.server.store.transact((db) => { const state = db.sessions[ada.cookie.slice(4)]?.cities.lagos?.state; assert.ok(state); state.travel.skipped = true; state.cash = 900; state.ledger = []; state.ledgerDays = []; });
  const refused = await f.action(ada.cookie, { type: 'travel.skip', payload: { quote: 1300 } });
  assert.deepEqual([refused.ok, refused.code, refused.state.cash, refused.state.activeAction?.kind, refused.state.estate.city], [false, 'insufficient_funds', 900, 'intercity', 'lagos']);
  assert.match(refused.state.message, /costs ₦1,300; you have ₦900\. You need ₦400 more/);
  // The price falls as the trip goes on: forty seconds later it is ₦900, and the skip goes through to the last naira.
  f.advance(40000);
  const paid = await f.action(ada.cookie, { type: 'travel.skip', payload: { quote: 900 } });
  assert.deepEqual([paid.ok, paid.code, paid.state.cash, paid.state.estate.city, paid.state.activeAction], [true, 'skipped', 0, 'ibadan', null]);
  // With three seconds or less to go nothing is sold.
  const bola = await f.device('Bola');
  await f.request('/api/life?city=lagos', null, bola.cookie);
  assert.equal((await f.action(bola.cookie, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } })).ok, true);
  f.advance(118000);
  const late = await f.action(bola.cookie, { type: 'travel.skip', payload: {} });
  assert.deepEqual([late.ok, late.code, late.state.cash, late.state.travel.skipped], [false, 'almost_there', 1500, false]);
  // A payload that is not a plain small object never reaches the rules.
  assert.equal((await f.request('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'travel.skip', payload: [1] }, bola.cookie)).status, 400);
});
