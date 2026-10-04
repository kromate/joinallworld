// OWNER: foundation — the server side of enforced character creation.
// A session created with { onboarding: true } gets lives that must finish creation first;
// every other session behaves exactly as before. Fixture: see server/routes/index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.js';

async function open(f, body) {
  const res = await f.request('/api/session', body);
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).session };
}
const life = async (f, device, city = 'lagos') => (await (await f.request(`/api/life?city=${city}`, null, device.cookie)).json()).state;
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };

test('a session created with onboarding: true must finish character creation before any other action', async t => {
  const f = await fixture(t);
  const ada = await open(f, { name: 'Ada', onboarding: true });
  const start = await life(f, ada);
  assert.deepEqual([start.onboarding.required, start.onboarding.done, start.location, start.cash], [true, false, 'park', 5000]);

  for (const fields of [{ type: 'spot', payload: { id: 'trees' } }, { type: 'activity', id: 'chill' }, { type: 'travel', id: 'library', mode: 'trek' }, { type: 'apply-job', id: 'tech' }, { type: 'cancel' }]) {
    const refused = await f.action(ada.cookie, fields);
    assert.deepEqual([refused.ok, refused.code], [false, 'onboarding_required'], fields.type);
    assert.match(refused.state.message, /Finish creating your Sim first/);
    assert.deepEqual([refused.state.location, refused.state.spot, refused.state.cash, refused.state.job, refused.state.activeAction], ['park', 'amphitheatre', 5000, null, null]);
  }
  // The refusal is a recorded outcome like any other: the same action ID replays it.
  const body = { actionId: `100000:11111111-1111-4111-8111-111111111111`, cityId: 'lagos', type: 'spot', payload: { id: 'trees' } };
  const first = await (await f.request('/api/action', body, ada.cookie)).json();
  const again = await (await f.request('/api/action', body, ada.cookie)).json();
  assert.deepEqual([first.code, again.code, again.duplicate], ['onboarding_required', 'onboarding_required', true]);

  // The other city's life for the same session is enforced too.
  assert.equal((await life(f, ada, 'ibadan')).onboarding.required, true);

  // Creation steps are accepted, and moving in lifts the rule.
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.look', payload: { look: LOOK } })).code, 'look_saved');
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.traits', payload: { traits: ['musical', 'clean-pikin'] } })).code, 'traits_saved');
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } })).code, 'dream_saved');
  const rolled = await f.action(ada.cookie, { type: 'onboarding.lottery', payload: {} });
  assert.equal(rolled.code, 'rolled');
  const house = rolled.state.onboarding.lottery.id === 'ajebutter' ? 'lekki' : 'yaba';
  const moved = await f.action(ada.cookie, { type: 'onboarding.home', payload: { house } });
  assert.deepEqual([moved.code, moved.state.location, moved.state.onboarding.done], ['life_started', 'home', true]);
  assert.equal((await f.action(ada.cookie, { type: 'spot', payload: { id: 'bathroom' } })).code, 'selected');
});

test('a session created without the flag keeps today’s behaviour, and a rename can neither add nor remove the rule', async t => {
  const f = await fixture(t);
  const old = await f.device('Bola'); // { name } only, as every existing client and test sends
  const state = await life(f, old);
  assert.deepEqual([state.onboarding.required, state.onboarding.done], [false, false]);
  assert.equal((await f.action(old.cookie, { type: 'spot', payload: { id: 'trees' } })).code, 'selected');
  // An existing session cannot be switched into enforcement, even before a city's life exists…
  const renamed = await f.request('/api/session', { name: 'Bola B', onboarding: true }, old.cookie);
  assert.equal((await renamed.json()).session.name, 'Bola B');
  assert.equal((await life(f, old, 'ibadan')).onboarding.required, false);
  // …and an enforced session cannot rename its way out.
  const ada = await open(f, { name: 'Ada', onboarding: true });
  assert.equal((await (await f.request('/api/session', { name: 'Ada A' }, ada.cookie)).json()).session.id, ada.id);
  const enforced = await life(f, ada);
  assert.deepEqual([enforced.name, enforced.onboarding.required], ['Ada A', true]);
  assert.equal((await f.action(ada.cookie, { type: 'spot', payload: { id: 'trees' } })).code, 'onboarding_required');
  // Only the literal `true` turns it on.
  for (const value of ['true', 1, { yes: true }, null]) {
    const device = await open(f, { name: 'Chidi', onboarding: value });
    assert.equal((await life(f, device)).onboarding.required, false, JSON.stringify(value));
  }
  const stored = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')).sessions;
  assert.deepEqual(Object.values(stored).map((session) => session.onboarding === true).sort(), [false, false, false, false, false, true]);
});
