import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.js';
import { validatePosition, initialVenuePosition } from './protocol.js';
import { createLife } from '../src/life.js';
import { lagosTime } from '../src/game/clock.js';

const MONDAY = Date.UTC(2026, 9, 5, 8);
const THURSDAY = Date.UTC(2026, 9, 8, 8);
const id = (now = Date.now()) => `${now}:${randomUUID()}`;

async function seedStudent(f, device, { studentId, score = null } = {}) {
  await f.server.store.transact((db) => {
    const session = Object.values(db.sessions).find((item) => item.publicId === device.id);
    const day = lagosTime(f.now()).day;
    const saved = {
      name: device.name,
      location: 'unilag',
      spot: 'senate',
      onboarding: { done: true, required: false, look: {} },
      unilagStudent: {
        status: 'matriculated', programme: 'computer', studentId,
        hostel: { allocations: [], storage: {} }, records: [], lifetime: { scholarshipPaid: false, campusJobDays: [] },
      },
      ...(score === null ? {} : { unilagCommunity: {
        days: [{ day, games: { penalties: score }, teams: { penalties: { studentId, faculty: 'Engineering', hall: null } } }],
        clubs: [], discoveries: [], trail: [], elections: { nominated: [], voted: [] },
      } }),
    };
    session.cities = { lagos: { state: createLife(saved, { now: f.now(), cityId: 'lagos', seed: `seed-${device.id}` }), updatedAt: f.now() } };
  });
}

async function json(res) {
  return { status: res.status, body: await res.json() };
}

test('campus read requires identity and returns the saved-game leaderboard projection', async (t) => {
  const f = await fixture(t);
  f.advance(MONDAY - f.now());
  const anonymous = await json(await f.request('/api/campus?city=lagos'));
  assert.equal(anonymous.status, 401);

  const ada = await f.device('Ada Campus');
  await seedStudent(f, ada, { studentId: 'ULG-2026-000001', score: 4 });
  const result = await json(await f.request('/api/campus?city=lagos', null, ada.cookie));
  assert.equal(result.status, 200);
  assert.equal(result.body.available, true);
  assert.equal(result.body.city, 'lagos');
  assert.equal(result.body.election.phase, 'nominations');
  assert.deepEqual(result.body.leaderboards.players[0], { id: ada.id, studentId: 'ULG-2026-000001', score: 4, results: 1, name: 'Ada Campus' });
});

test('campus nomination uses stored authority and a repeated action id is exactly once', async (t) => {
  const f = await fixture(t);
  f.advance(MONDAY - f.now());
  const ada = await f.device('Ada Campus');
  await seedStudent(f, ada, { studentId: 'ULG-2026-000001' });
  const actionId = id(f.now());
  const body = { cityId: 'lagos', actionId, name: 'Forged Name', studentId: 'ULG-9999-999999' };
  const first = await json(await f.request('/api/campus/nominate', body, ada.cookie));
  const second = await json(await f.request('/api/campus/nominate', body, ada.cookie));
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.code, 'nominated');
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  const election = await f.server.store.read((db) => db.campus?.election);
  assert.equal(election.candidates.length, 1);
  assert.deepEqual(election.candidates[0], {
    id: ada.id, studentId: 'ULG-2026-000001', name: 'Ada Campus', faculty: 'Engineering', hall: null, at: f.now(),
  });
});

test('campus vote rejects unknown candidates transactionally and is idempotent for a valid action', async (t) => {
  const f = await fixture(t);
  f.advance(MONDAY - f.now());
  const ada = await f.device('Ada Campus');
  const bola = await f.device('Bola Campus');
  await seedStudent(f, ada, { studentId: 'ULG-2026-000001' });
  await seedStudent(f, bola, { studentId: 'ULG-2026-000002' });
  const nomination = await json(await f.request('/api/campus/nominate', { cityId: 'lagos', actionId: id(f.now()) }, ada.cookie));
  assert.equal(nomination.body.code, 'nominated');
  f.advance(THURSDAY - f.now());

  const before = await f.server.store.read((db) => structuredClone(db.campus?.election));
  const unknown = await json(await f.request('/api/campus/vote', { cityId: 'lagos', actionId: id(f.now()), candidateId: 'missing-candidate' }, bola.cookie));
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.error, 'invalid_candidate');
  const afterUnknown = await f.server.store.read((db) => structuredClone(db.campus?.election));
  assert.deepEqual(afterUnknown, before);

  const actionId = id(f.now());
  const first = await json(await f.request('/api/campus/vote', { cityId: 'lagos', actionId, candidateId: ada.id }, bola.cookie));
  const second = await json(await f.request('/api/campus/vote', { cityId: 'lagos', actionId, candidateId: ada.id }, bola.cookie));
  assert.equal(first.status, 200);
  assert.equal(first.body.code, 'voted');
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  const election = await f.server.store.read((db) => db.campus.election);
  assert.equal(election.ballots.length, 1);
  assert.deepEqual(election.ballots[0], { studentId: 'ULG-2026-000002', candidateId: ada.id, at: f.now() });
});

test('public action dispatch cannot invoke the server-only campus vote', async (t) => {
  const f = await fixture(t);
  f.advance(MONDAY - f.now());
  const ada = await f.device('Ada Campus');
  await seedStudent(f, ada, { studentId: 'ULG-2026-000001' });
  const result = await json(await f.request('/api/action', {
    actionId: id(f.now()), cityId: 'lagos', type: 'unilag.election.vote', payload: { candidate: ada.id },
  }, ada.cookie));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'server_only');
});

test('position validation uses campus walkability while retaining ordinary venue bounds', () => {
  assert.deepEqual(initialVenuePosition('unilag'), { x: -286, z: -112 });
  assert.deepEqual(validatePosition({ x: -286, z: -112 }, 'unilag'), { x: -286, z: -112 });
  assert.throws(() => validatePosition({ x: 500, z: 0 }, 'unilag'), /invalid_position/);
  assert.throws(() => validatePosition({ x: 25, z: 0 }, 'park'), /invalid_position/);
  assert.deepEqual(validatePosition({ x: 14, z: -3.5 }, 'park'), { x: 14, z: -3.5 });
});
