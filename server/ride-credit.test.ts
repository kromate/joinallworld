// OWNER: world — the ride home on credit on the Node host: taken once however it is sent, two devices, no skip, the debt in the life.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { rideJourney } from './testing/rideJourney.ts';
import { loadCityContent } from '../src/game/cities/registry.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

test('a visitor who cannot pay the way home rides on credit, once, and owes it', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const result = await rideJourney({
    now: f.now,
    request: (path, body, cookie) => f.request(path, body, cookie),
    elapse: async (_device, _city, ms) => { f.advance(ms); },
    edit: async (device, city, change) => { await f.server.store.transact((db) => { const entry = db.sessions[device.cookie.slice(4)]?.cities[city]; assert.ok(entry?.state); change(entry.state as unknown as Record<string, unknown>); }); },
  });
  assert.deepEqual([result.fare, result.debt, result.cash], [3500, 2000, 0]);
});
