import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Work dilemmas and the place actions of regulars are on for every life the server plays: no switch, no option. A life saved before
// they existed loads as it was, and a dilemma that was left waiting on a save is shown and can be answered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { DILEMMAS } from '../src/game/content/dilemmas.ts';
import { activityId } from '../src/game/systems/social.ts';
import type { LifeState } from '../src/types/index.ts';

type Answer = { state?: { career: { dilemmas?: { pending: { id: string } | null } } } };
const MONDAY_10AM = Date.UTC(2026, 0, 5, 9); // Lagos is UTC+1: the market is open and its regulars are in

test('a server with no options plays dilemmas and place actions: a saved waiting dilemma loads, is answered once, and a life saved before them loads unchanged', async (t) => {
  const f = await fixture(t);
  f.advance(MONDAY_10AM - f.now());
  const edit = (cookie: string, change: (state: LifeState) => void) => f.server.store.transact((db) => { const state = db.sessions[cookie.slice(4)]?.cities.lagos?.state; assert.ok(state); change(state); });
  const life = async (cookie: string) => (await (await f.request('/api/life?city=lagos', null, cookie)).json() as Answer).state;
  const first = DILEMMAS.find((item) => !item.jobs || item.jobs.includes('tech'));
  assert.ok(first);
  const choice = first.choices[0];
  assert.ok(choice);

  const old = await f.device('Old save');
  await life(old.cookie);
  await edit(old.cookie, (state) => { state.job = 'tech'; state.location = 'market'; state.spot = 'people'; });
  const before = await life(old.cookie);
  assert.ok(before);
  assert.equal('dilemmas' in before.career, false, 'a life saved before dilemmas carries no new key');
  assert.equal(before.career.dilemmas?.pending ?? null, null, 'and has nothing waiting');
  const haggle = await f.action(old.cookie, { cityId: 'lagos', type: 'activity', payload: { id: activityId('iya-bose', 'haggle') }, actionId: f.id() });
  assert.notEqual(haggle.code, 'unknown_activity', `Haggle exists by default (${haggle.code})`);
  assert.equal(haggle.ok, true, `a regular at the market can be haggled with by default (${haggle.code})`);

  const waiting = await f.device('Waiting');
  await life(waiting.cookie);
  await edit(waiting.cookie, (state) => { state.job = 'tech'; state.career.dilemmas = { pending: { id: first.id, seed: 9 }, seen: [], memory: [] }; });
  assert.equal((await life(waiting.cookie))?.career.dilemmas?.pending?.id, first.id, 'the saved waiting dilemma loads');
  const answered = await f.action(waiting.cookie, { cityId: 'lagos', type: 'career.dilemma', payload: { choice: choice.id }, actionId: f.id() });
  assert.equal(answered.ok, true);
  assert.notEqual(answered.code, 'dilemmas_off');
  assert.equal((await life(waiting.cookie))?.career.dilemmas?.pending ?? null, null, 'it is settled');
  const again = await f.action(waiting.cookie, { cityId: 'lagos', type: 'career.dilemma', payload: { choice: choice.id }, actionId: f.id() });
  assert.equal(again.code, 'no_dilemma', 'it cannot be answered twice');
});
